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
from livekit.plugins import openai

load_dotenv(".env.local")
load_dotenv(".env")
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ai-interviewer")

AGENT_NAME = "ai-interviewer"


def read_candidate_metadata(ctx: JobContext, participant: Any = None) -> dict[str, Any]:
    """Read candidate configuration from remote participant or room."""
    if participant and getattr(participant, "metadata", None):
        try:
            data = json.loads(participant.metadata)
            if isinstance(data, dict) and (data.get("questions") or data.get("candidateName")):
                return data
        except json.JSONDecodeError:
            pass

    for p in ctx.room.remote_participants.values():
        raw = p.metadata or "{}"
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and (data.get("questions") or data.get("candidateName")):
                return data
        except json.JSONDecodeError:
            logger.warning("Invalid candidate metadata from %s", p.identity)
    return {}


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
        if not new_message.text_content:
            raise StopResponse()

        idx = self.current_index

        if idx >= len(self.questions):
            raise StopResponse()

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

    async def mark_successful_speech(self) -> None:
        """Advance only after a speech response was successfully created."""
        if not self.pending_advance or self.completed:
            return

        self.pending_advance = False

        if self.current_index < len(self.questions) - 1:
            self.current_index += 1
        else:
            self.completed = True
            if self._closing_task is None:
                self._closing_task = asyncio.create_task(self.close_after_grace_period())

    async def close_after_grace_period(self) -> None:
        # Give TTS/audio a short window to finish before closing the agent session.
        await asyncio.sleep(5)
        try:
            await self.session.aclose()
        except Exception:
            logger.exception("Error while closing completed interview")

    async def handle_model_error(self, error: Exception) -> None:
        """Keep the current question unchanged on an LLM/TTS pipeline error."""
        logger.exception("AI pipeline error: %s", error)

        self.pending_advance = False

        if self.completed:
            return

        question = self.questions[self.current_index]
        try:
            await self.session.say(
                "I'm sorry, I had a temporary problem processing that answer. "
                f"Let's try that question again: {question}"
            )
        except Exception:
            logger.exception("Fallback speech also failed")


server = AgentServer()


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    # Wait until the candidate participant is present so metadata is available.
    participant = await ctx.wait_for_participant()

    config = read_candidate_metadata(ctx, participant)

    candidate_name = str(config.get("candidateName") or "Candidate")
    job_title = str(config.get("jobTitle") or "Technical Interview")
    questions = config.get("questions")

    if not isinstance(questions, list) or not questions:
        questions = [
            "Tell me about yourself.",
            "What is your experience with Node.js?",
            "Tell me about a challenging project you worked on.",
            "How do you handle database performance issues?",
        ]

    questions = [str(q).strip() for q in questions if str(q).strip()]

    agent = InterviewAgent(candidate_name, job_title, questions)

    session = AgentSession(
        stt=openai.STT(model="gpt-4o-mini-transcribe", language="en"),
        llm=openai.responses.LLM(model="gpt-4.1"),
        tts=openai.TTS(
            model="gpt-4o-mini-tts",
            voice="ash",
            instructions="Speak clearly, professionally, warmly, and at a moderate pace.",
        ),
    )

    @session.on("speech_created")
    def on_speech_created(event) -> None:
        # This event means a response has been created by the agent pipeline.
        asyncio.create_task(agent.mark_successful_speech())

    @session.on("error")
    def on_error(event) -> None:
        error = getattr(event, "error", event)
        asyncio.create_task(agent.handle_model_error(error))

    @session.on("user_input_transcribed")
    def on_transcript(event) -> None:
        if event.is_final:
            logger.info("Candidate: %s", event.transcript)

    @session.on("close")
    def on_close(event) -> None:
        logger.info("Interview session closed: %s", event)

    await session.start(
        agent=agent,
        room=ctx.room,
    )

    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
