# AI Interview Agent

A voice-based AI interviewer built with **LiveKit Agents**: a candidate joins a LiveKit room
with their camera on, an AI interviewer greets them, asks a configured list of questions one
at a time over voice, and produces a transcript and video recording at the end.

> **Not hearing the AI speak?** This is almost always one specific setup step, not a bug:
> Groq's TTS model requires a one-time terms acceptance per account before it will
> synthesize any audio. See section 5 below - `console.groq.com/playground?model=canopylabs%2Forpheus-v1-english`.
> Until that's accepted, the agent generates and logs its questions correctly but every TTS
> call fails with `model_terms_required`, so nothing is ever spoken.

## What this implements

- LiveKit Agents worker for the real-time AI interviewer (STT → LLM → TTS).
- React + Vite frontend using LiveKit's Session/Agent hooks.
- Node.js + Express backend that mints LiveKit tokens and dispatches the agent.
- **Separate recruiter and candidate roles**: a recruiter configures the job title and
  questions and gets a shareable link; only someone who opens that link can join, and they
  always join as the candidate. There is no path from the shared link back to the
  configuration screen.
- Job title/questions supplied via room metadata (set once, at creation) and the
  candidate's name via participant metadata (set when they join) - never hard-coded into
  the agent's conversation logic.
- Questions are asked in the configured order.
- Automatic interview completion after the final answer, with the frontend transitioning
  to the results screen on its own (no manual step needed).
- Candidate-disconnect handling.
- Basic STT / LLM / TTS failure handling, differentiated per stage, without losing the
  candidate's place in the interview.
- Live, clearly-labeled conversation transcript.
- Candidate camera on for the duration of the interview, with a self-view tile and a
  camera on/off toggle; a denied/failed camera degrades to voice-only rather than blocking
  the interview.
- Browser-side interview recording - candidate camera video mixed with candidate mic + AI
  voice audio into one video file (falls back to audio-only if the camera isn't available)
  - and playback.
- Final result screen: candidate, status, duration, full transcript, recording playback.
- Problem-solving answer included below.

## Architecture

```text
Recruiter                                Candidate
    |                                        |
    | POST /createInterview                  | GET /interview/:roomName (validate + preview)
    v                                        | POST /getToken (mint candidate token)
Node.js + Express  <----------------------------
    |
    | Room created with jobTitle/questions in room metadata
    | + agent dispatch attached to the room itself
    v
LiveKit Cloud (WebRTC room)
    |
    v
LiveKit Agent (Python)
    |
    +--> STT: Groq whisper-large-v3-turbo
    +--> LLM: Groq openai/gpt-oss-120b
    +--> TTS: Groq canopylabs/orpheus-v1-english
```

The frontend never talks to LiveKit's API keys directly - it asks the backend to create
rooms and mint tokens, and the backend is the only thing that decides which agent gets
dispatched into a room (baked in at room-creation time, not something a client can
influence via its token request).

## Project structure

```text
ai-interview-agent/
├── agent/            # Python LiveKit Agents worker
│   ├── agent.py
│   ├── requirements.txt
│   └── .env.example
├── backend/           # Express token/health API
│   ├── src/server.js
│   ├── package.json
│   └── .env.example
├── frontend/          # React + Vite UI
│   ├── src/
│   │   ├── components/
│   │   │   ├── CreateInterview.tsx    (recruiter: configure + get a link)
│   │   │   ├── JoinInterview.tsx      (candidate: reached only via the link)
│   │   │   ├── InterviewRoom.tsx
│   │   │   └── InterviewResult.tsx
│   │   ├── App.tsx
│   │   ├── api.ts
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.ts
├── .env.example
└── README.md
```

## 1. Prerequisites

- Node.js 20+
- Python 3.10+
- A LiveKit Cloud project (URL, API key, API secret)
- A Groq API key (free, no credit card - see section 5 below)
- A modern browser with microphone and camera permission (camera is optional - denying it
  degrades to a voice-only interview rather than blocking it)

## 2. Environment variables

Each service has its own env file - see `.env.example` at the repo root for a pointer, or
copy directly:

**`agent/.env.example` → `agent/.env.local`**
```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
GROQ_API_KEY=your_groq_api_key
```

**`backend/.env.example` → `backend/.env`**
```env
PORT=3001
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
FRONTEND_ORIGIN=http://localhost:5173
```

**`frontend/.env.example` → `frontend/.env`** (optional for local dev - see the comment in
the file; `npm run dev` proxies `/api/*` to the backend automatically)
```env
VITE_TOKEN_ENDPOINT=http://localhost:3001/getToken
```

> If you're setting this up from a fresh LiveKit Cloud project, generate a new API
> key/secret pair from the LiveKit dashboard and use those - never reuse credentials that
> have ever been committed to a git repository, public or private.

## 3. Install and run

Run each service in its own terminal.

### Terminal 1 — Agent

```bash
cd agent
python -m venv .venv
```

Windows: `.venv\Scripts\activate` · macOS/Linux: `source .venv/bin/activate`

```bash
pip install -r requirements.txt
python agent.py dev
```

### Terminal 2 — Backend

```bash
cd backend
npm install
npm run dev
```

Runs on `http://localhost:3001`.

### Terminal 3 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (normally `http://localhost:5173`).

## 4. Interview flow

**Recruiter (create):**
1. Opens the app at `/`, picks a job title, edits the question list, clicks "Create
   Interview".
2. The backend creates a new LiveKit room up front, with the job title/questions stored in
   the room's metadata and the `ai-interviewer` agent's dispatch attached to the room
   itself - not to any participant's token, so the client never gets a say in which agent
   joins.
3. The recruiter gets a shareable link (`/?room=<id>`) and never becomes a participant in
   the room themselves.

**Candidate (join, via the shared link only):**
4. Opening the link calls the backend to confirm the room still exists and to read back
   just the job title (not the question list) for display.
5. Candidate enters their name and clicks "Join Interview" - this is the only screen
   reachable from the link, there's no way to get to the recruiter's create/configure form
   from here. Joining publishes both microphone and camera; recording starts immediately.
6. The agent reads the room's metadata (job title/questions) merged with the candidate's
   own participant metadata (name), greets them by name, and asks question 1.
7. Candidate answers by voice → STT transcribes it → the LLM generates a short
   acknowledgment plus the next configured question → TTS speaks it.
8. Steps 6-7 repeat until the last question has been answered, at which point the agent
   gives a short closing statement.
9. The agent then leaves the room. The frontend detects this (via LiveKit's agent-state
   tracking) and automatically shows the result screen - no manual "end interview" click
   required, though that option is always available if the candidate wants to stop early.
10. The result screen shows status, duration, the full labeled transcript, and playback of
    the recording (candidate camera video mixed with candidate mic + AI voice audio,
    client-side).

**On access control**: the assignment explicitly excludes authentication, so "restricted"
here means structural, not identity-verified - possession of the link is what makes you the
candidate, and the link's room id is the only credential involved. The room closes itself
2 hours after creation if nobody joins (`emptyTimeout` in `backend/src/server.js`).

## 5. Why these AI providers?

**STT — Groq `whisper-large-v3-turbo`**, **LLM — Groq `openai/gpt-oss-120b`**,
**TTS — Groq `canopylabs/orpheus-v1-english`**. Groq runs all three on its own LPU hardware
behind a single, genuinely free API key (no credit card, rate-limited rather than metered),
which made it the practical choice for this assignment. Using one provider for all three
also keeps credential/config management simple while still demonstrating the required
STT → LLM → TTS pipeline through LiveKit's plugin architecture; swapping any one of them
for another LiveKit-supported provider (OpenAI, Deepgram, Cartesia, etc.) is a one-line
change in `agent/agent.py`.

> Groq's hosted model lineup changes over time - `agent/agent.py` was verified directly
> against the `GET /openai/v1/models` list for the account this was built with. If a model
> 404s later, check `console.groq.com` for its current name. The TTS model
> (`canopylabs/orpheus-v1-english`) also requires a one-time terms acceptance per Groq
> account/org at `console.groq.com/playground?model=canopylabs%2Forpheus-v1-english` -
> without it, TTS fails with a `model_terms_required` error.

## 6. Candidate metadata

Configuration is split across two LiveKit metadata scopes, matching who actually knows
each piece of information and when:

**Room metadata** (set once, by the backend, when the recruiter creates the interview):
```json
{
  "jobTitle": "Backend Developer",
  "questions": [
    "Tell me about yourself.",
    "What is your experience with Node.js?",
    "Tell me about a challenging project you worked on.",
    "How do you handle database performance issues?"
  ]
}
```

**Participant metadata** (set by the frontend when the candidate joins):
```json
{ "candidateName": "Jordan" }
```

The agent merges both (room metadata as the base, participant metadata layered on top) so
the candidate's own identity is never something they could use to overwrite the
recruiter-configured role or questions.

## 7. Failure handling

The interview's state machine only ever commits an advance to the next question
(`current_index`) *after* the response has actually finished being spoken successfully.
This took a real fix to get right: `AgentSession`'s `speech_created` event fires the instant
a response *starts* being generated - before the LLM has produced anything or TTS has
synthesized a single frame - not after it succeeds. Committing state there (an earlier
version of this code did) would advance the question, or close the interview, before
knowing whether the response was ever actually delivered. The fix is to take the
`SpeechHandle` that `speech_created` hands over and `await handle.wait_for_playout()` on it
(which never raises) and then check `handle.exception()` before deciding to commit - see
`InterviewAgent.on_speech_result` in `agent/agent.py`. If anything fails mid-turn, the
candidate simply stays on the same question - nothing is skipped, and the interview's
closing statement is guaranteed to have fully played before the session closes.

- **STT failure**: logged; the agent asks the candidate to repeat their last answer. State
  is untouched.
- **LLM failure**: logged; the agent gives a brief apology and continues with the *same*
  question it was already on - the failed turn never advanced `current_index`.
- **TTS failure**: logged only (attempting to speak again after a TTS failure would likely
  fail the same way, so the agent waits for the candidate's next turn instead of
  compounding the failure).
- **Candidate disconnect**: LiveKit Agents' `RoomInputOptions.close_on_disconnect` (on by
  default) automatically closes the agent session when the linked candidate participant
  disconnects, so the agent doesn't keep running against an empty room. On the frontend,
  losing the LiveKit connection immediately produces an "Incomplete" result with whatever
  transcript/recording was captured up to that point.

## 8. Problem-solving question

**Scenario:** The candidate is answering question 2 and the LLM request fails.

**What should happen to the interview?** It stays exactly where it is - on question 2. The
candidate's answer was received, but since the LLM never produced a valid follow-up, that
turn is treated as not-yet-completed rather than silently accepted.

**Should the agent retry the current question?** Not automatically via a retry loop - that
adds complexity the assignment explicitly says isn't required. Instead, the agent speaks a
short apology and repeats the *current* question, giving the candidate a natural,
conversational way to answer again.

**Should it move to the next question?** No. Advancing on failure would silently lose the
candidate's answer and skip content from the interview. The implementation never advances
`current_index` inside the turn-handling callback itself - it only marks that a turn is
*pending*. The advance is only committed once the resulting `SpeechHandle` has actually
finished playing out with no exception (`on_speech_result`, awaiting
`handle.wait_for_playout()` then checking `handle.exception()`).

**How is state preserved?** `current_index` and `completed` live on the running
`InterviewAgent` instance and are only ever mutated in one place (`on_speech_result`),
gated on that handle's own success - a failed handle simply returns without committing. A
separate failure handler runs on the LLM/STT/TTS `error` event, logs which stage failed,
clears the pending-advance flag, and speaks a fallback - it never touches the index itself.
Because the question list itself comes from room metadata (not the agent's momentary
conversation state), even a full agent restart could reconstruct where the candidate should
resume.

## 9. What is intentionally not implemented

Per the assignment: candidate scoring, cheating detection, ECS/Kubernetes/auto-scaling,
DynamoDB, authentication, billing, complex dashboards, CI/CD, and production
infrastructure. The frontend also stays a single 1:1 candidate/AI call - no screen-share,
no multi-party/observer mode - since the assignment describes an AI-conducted interview,
not a video conferencing product; the candidate's camera is on so the recording captures
them, not because a second human is meant to be watching live.

## 10. Recording

Recording is done client-side: the candidate's microphone and the AI's incoming audio
track(s) are mixed via the Web Audio API into a single audio stream, and the candidate's own
published camera track is added alongside it into one `MediaStream` (`InterviewRoom.tsx`,
`startRecording`). `MediaRecorder` captures that combined stream into a local WebM file
(`video/webm` when the camera is available, falling back to `audio/webm` if it's denied or
unsupported), played back on the result screen. This matches the assignment's allowance for
local, non-production-grade recording. For production, this would move server-side to
LiveKit Egress.

## 11. Demo checklist

```text
Start Interview → AI greets candidate by name → AI asks question 1 → candidate answers →
AI responds and asks question 2 → ... → final answer → AI closing statement →
interview auto-completes → transcript displayed (AI vs. candidate clearly labeled) →
audio playback works
```
