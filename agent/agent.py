import asyncio
import json
import logging
from typing import Any

from dotenv import load_dotenv

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    cli,
    llm,
    StopResponse,
)
from livekit.agents.llm import LLMError
from livekit.agents.stt import STTError
from livekit.agents.tts import TTSError
from livekit.agents.voice import SpeechHandle
from livekit.plugins import groq

load_dotenv(".env.local")
load_dotenv(".env")
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-interviewer")

AGENT_NAME = "ai-interviewer"

DEFAULT_QUESTIONS = [
    "Tell me about yourself.",
    "What is your experience with Node.js?",
    "Tell me about a challenging project you worked on.",
    "How do you handle database performance issues?",
]


def read_candidate_metadata(ctx: JobContext, participant: Any = None) -> dict[str, Any]:
    """Build interview config from room metadata (jobTitle/questions, set by the recruiter
    when the room was created) merged with participant metadata (candidateName, set by
    whoever actually joins as the candidate). Room metadata is the base so a candidate's
    identity never overrides the recruiter-configured job/questions; participant metadata
    is applied on top so the candidate's own name always wins.
    """
    config: dict[str, Any] = {}

    def merge(identity: str, raw: str | None) -> None:
        if not raw:
            return
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Invalid metadata JSON from %s", identity)
            return
        if isinstance(data, dict):
            config.update({k: v for k, v in data.items() if v})

    merge("room", ctx.room.metadata)
    if participant is not None:
        merge(participant.identity, getattr(participant, "metadata", None))
    else:
        for p in ctx.room.remote_participants.values():
            merge(p.identity, p.metadata)

    return config


class InterviewAgent(Agent):
    def __init__(self, candidate_name: str, job_title: str, questions: list[str]):
        self.candidate_name = candidate_name
        self.job_title = job_title
        self.questions = questions
        self.current_index = 0
        self.pending_advance = False
        self.completed = False
        self._closing_task: asyncio.Task | None = None

        question_list = "\n".join(
            f"{i + 1}. {question}" for i, question in enumerate(questions)
        )

        super().__init__(
            instructions=f"""
You are a professional AI voice interviewer.

Candidate name: {candidate_name}
Target job: {job_title}

Interview questions, in exact order:
{question_list}

Rules:
- Conduct a concise, natural voice interview.
- Use the candidate's name naturally, but do not overuse it.
- Never skip, reorder, invent, or substantially rewrite the configured questions.
- After each candidate answer, briefly acknowledge the answer, then ask the next configured question exactly.
- Do not score the candidate.
- Do not give long explanations.
- Do not ask extra interview questions.
- When the final configured question has been answered, give a short professional closing.
- The final response must not contain another interview question.
""",
        )

    async def on_enter(self) -> None:
        self.session.generate_reply(
            instructions=(
                f"Introduce yourself as the AI interviewer, greet {self.candidate_name}, "
                f"mention that this is the {self.job_title} interview, and then ask the "
                f"first configured question exactly: {self.questions[0]}"
            )
        )

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        if self.completed:
            raise StopResponse()

        if not new_message.text_content:
            raise StopResponse()

        idx = self.current_index
        self.pending_advance = True

        if idx < len(self.questions) - 1:
            next_question = self.questions[idx + 1]
            turn_ctx.add_message(
                role="assistant",
                content=(
                    "For this response, briefly acknowledge the candidate's answer. "
                    f"Then ask this exact next question and nothing else: {next_question}"
                ),
            )
        else:
            turn_ctx.add_message(
                role="assistant",
                content=(
                    "This was the final answer. Briefly thank the candidate and say the "
                    "interview is complete. Do not ask another question."
                ),
            )

    async def on_user_turn_exceeded(self, ev) -> None:
        await self.session.say(
            "Thanks. Please keep your answer focused on the interview question."
        )

    async def on_speech_result(self, handle: SpeechHandle, was_pending: bool) -> None:
        """Advance only after a speech response has actually finished playing successfully.

        `speech_created` (which triggers this) fires the instant a SpeechHandle is created -
        before the LLM has generated anything or TTS has produced a single frame - not after
        the pipeline succeeds. Committing state there would advance the question (or close
        the interview) before knowing whether the response ever actually got spoken. Instead,
        this waits for the specific handle to finish (`wait_for_playout` never raises; failures
        show up via `handle.exception()`) and only then decides whether to commit.

        `was_pending` is a snapshot of `pending_advance` taken synchronously at the moment
        `speech_created` fired, so it always refers to *this* handle - not whatever
        `pending_advance` happens to be by the time this coroutine resumes.
        """
        await handle.wait_for_playout()

        if not was_pending or self.completed:
            return

        self.pending_advance = False

        if handle.exception() is not None:
            # The failure itself is already logged/handled via the "error" event
            # (handle_pipeline_error); here we just make sure a failed turn never commits.
            logger.info(
                "Turn for question %d/%d failed to play out - not advancing",
                self.current_index + 1,
                len(self.questions),
            )
            return

        if self.current_index < len(self.questions) - 1:
            self.current_index += 1
            logger.info("Advanced to question %d/%d", self.current_index + 1, len(self.questions))
        else:
            self.completed = True
            logger.info("Final answer played out successfully; closing interview")
            if self._closing_task is None:
                self._closing_task = asyncio.create_task(self.close_after_grace_period())

    async def close_after_grace_period(self) -> None:
        # By this point the closing remarks have already finished playing (this only runs
        # after on_speech_result confirms successful playout), so this is just a short
        # buffer for the final audio frames to flush over WebRTC before closing.
        await asyncio.sleep(2)
        try:
            await self.session.aclose()
        except Exception:
            logger.exception("Error while closing completed interview")

    async def handle_pipeline_error(self, stage: str, error: Exception) -> None:
        """Handle STT/LLM/TTS failures without losing interview state.

        The current question index is left untouched (pending_advance is cleared so a
        stale success can't sneak an advance through after the fact), and a short spoken
        fallback is given per failing stage. No retry framework - just enough to keep the
        interview alive and on the right question.
        """
        logger.error("%s failure on question %d/%d: %s", stage.upper(), self.current_index + 1, len(self.questions), error)

        self.pending_advance = False

        if self.completed:
            return

        question = self.questions[self.current_index]
        fallback = {
            "stt": "Sorry, I didn't quite catch that. Could you repeat your last answer?",
            "llm": f"Sorry, I had a brief technical issue. Let's continue: {question}",
        }.get(stage)

        if fallback is None:
            # TTS itself is failing - speaking again would likely fail too. Log and wait
            # for the candidate's next turn rather than compounding the failure.
            return

        try:
            await self.session.say(fallback)
        except Exception:
            logger.exception("Fallback speech also failed after %s error", stage)


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    await ctx.connect()

    # Wait until the candidate participant is present so metadata is available.
    participant = await ctx.wait_for_participant()

    config = read_candidate_metadata(ctx, participant)

    candidate_name = str(config.get("candidateName") or participant.name or "Candidate").strip() or "Candidate"
    job_title = str(config.get("jobTitle") or "Technical Interview").strip() or "Technical Interview"
    questions = [str(q).strip() for q in (config.get("questions") or []) if str(q).strip()]
    if not questions:
        questions = DEFAULT_QUESTIONS

    agent = InterviewAgent(candidate_name, job_title, questions)

    session = AgentSession(
        stt=groq.STT(model="whisper-large-v3-turbo", language="en"),
        llm=groq.LLM(model="openai/gpt-oss-120b"),
        tts=groq.TTS(model="canopylabs/orpheus-v1-english", voice="autumn"),
    )

    @session.on("speech_created")
    def on_speech_created(event) -> None:
        # Snapshot pending_advance synchronously, right as the handle is created - not
        # inside the task, where it could reflect a different (later) turn by the time the
        # coroutine actually runs.
        asyncio.create_task(agent.on_speech_result(event.speech_handle, agent.pending_advance))

    @session.on("error")
    def on_error(event) -> None:
        error = getattr(event, "error", event)
        if isinstance(error, STTError):
            stage = "stt"
        elif isinstance(error, LLMError):
            stage = "llm"
        elif isinstance(error, TTSError):
            stage = "tts"
        else:
            stage = "unknown"
        asyncio.create_task(agent.handle_pipeline_error(stage, error))

    @session.on("user_input_transcribed")
    def on_transcript(event) -> None:
        if event.is_final:
            logger.info("Candidate: %s", event.transcript)

    @session.on("close")
    def on_close(event) -> None:
        # Covers every way the session can end: our own close_after_grace_period() on
        # normal completion, and the SDK's built-in close_on_disconnect behavior when the
        # candidate leaves early. Disconnecting here is what actually signals completion to
        # the candidate's frontend (useAgent().isFinished) and lets this job exit instead of
        # idling in an empty room.
        logger.info("Interview session closed: %s", getattr(event, "reason", event))
        asyncio.create_task(ctx.room.disconnect())

    await session.start(
        agent=agent,
        room=ctx.room,
    )


if __name__ == "__main__":
    cli.run_app(server)
