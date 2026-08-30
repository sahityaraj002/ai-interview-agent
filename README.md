# AI Interview Agent

A clean, assignment-focused AI voice interviewer built from the provided technical assignment.

## What this implements

- LiveKit Agents for the real-time AI interviewer.
- React + Vite frontend.
- Node.js + Express token backend.
- OpenAI STT → LLM → TTS.
- Candidate name, job title, and interview questions supplied as metadata/configuration.
- Questions are asked in the configured order.
- Graceful interview completion after the final answer.
- Candidate disconnect handling.
- Basic STT/LLM/TTS failure handling and logging.
- Live conversation transcript in the browser.
- Browser-side interview audio recording and playback.
- Final interview result screen with candidate, status, duration, transcript, and audio.
- Problem-solving answer included below.

The assignment explicitly requires LiveKit Agents, voice interaction, STT/LLM/TTS, configurable questions, completion, failure handling, conversation display, and audio recording/playback. fileciteturn0file0L226-L251

## Architecture

```text
React Frontend
    |
    | HTTPS / TokenSource
    v
Node.js + Express
    |
    | LiveKit JWT + room config / agent dispatch
    v
LiveKit Cloud
    |
    | WebRTC audio
    v
LiveKit Agent (Python)
    |
    +--> STT: OpenAI gpt-4o-mini-transcribe
    +--> LLM: OpenAI gpt-4.1
    +--> TTS: OpenAI gpt-4o-mini-tts
```

LiveKit's current frontend architecture recommends a Session + TokenSource flow, and a production token endpoint keeps LiveKit API keys on the backend. The project follows that model.

## Project structure

```text
ai-interview-agent/
├── agent/
│   ├── agent.py
│   ├── requirements.txt
│   └── .env.example
├── backend/
│   ├── src/server.js
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── InterviewSetup.tsx
│   │   │   ├── InterviewRoom.tsx
│   │   │   └── InterviewResult.tsx
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── styles.css
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── index.html
├── .env.example
└── README.md
```

## 1. Prerequisites

- Node.js 20+
- Python 3.10+
- A LiveKit Cloud project
- LiveKit API key and secret
- OpenAI API key
- A modern browser with microphone permission

The assignment says a LiveKit Cloud / LiveKit-based implementation is expected and encourages using official LiveKit and provider documentation. fileciteturn0file0L252-L260

## 2. Environment variables

### Agent

Copy `agent/.env.example` to `agent/.env.local`.

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
OPENAI_API_KEY=your_openai_api_key
```

### Backend

Copy `backend/.env.example` to `backend/.env`.

```env
PORT=3001
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
FRONTEND_ORIGIN=http://localhost:5173
```

### Frontend

Copy `frontend/.env.example` to `frontend/.env`.

```env
VITE_TOKEN_ENDPOINT=http://localhost:3001/getToken
```

## 3. Install and run

### Terminal 1 — Agent

```bash
cd agent
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
```

macOS/Linux:

```bash
source .venv/bin/activate
```

Then:

```bash
pip install -r requirements.txt
python agent.py dev
```

If your LiveKit CLI installation uses the `lk` command, the equivalent is:

```bash
lk agent dev agent.py
```

The important part is that the worker is running and registered with the same LiveKit project.

### Terminal 2 — Backend

```bash
cd backend
npm install
npm run dev
```

Backend runs on:

```text
http://localhost:3001
```

### Terminal 3 — Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the URL shown by Vite, normally:

```text
http://localhost:5173
```

## 4. Interview flow

1. Candidate enters name.
2. Candidate enters job title.
3. Candidate can edit the provided question list.
4. Frontend sends candidate information as LiveKit participant metadata.
5. Frontend starts a LiveKit Session.
6. LiveKit dispatches the `ai-interviewer` agent.
7. Agent reads the metadata.
8. Agent greets the candidate.
9. Agent asks question 1.
10. Candidate answers by voice.
11. STT converts the answer to text.
12. LLM generates a short interviewer response.
13. TTS converts it to speech.
14. Agent asks the next exact configured question.
15. After the final answer, the agent gives a closing message and closes its session.
16. Frontend shows the complete transcript.
17. Browser-side recording becomes available for playback.

The required basic flow and ordered-question behavior come directly from the assignment. fileciteturn0file0L11-L31 fileciteturn0file0L34-L42

## 5. Why these AI providers?

### STT — OpenAI `gpt-4o-mini-transcribe`

It is directly supported by the LiveKit OpenAI STT plugin. The current LiveKit documentation shows Python support and the OpenAI STT plugin. citeturn1search0

### LLM — OpenAI `gpt-4.1`

LiveKit's current OpenAI integration supports the OpenAI Responses API and documents `gpt-4.1` as a supported model. citeturn1search11

### TTS — OpenAI `gpt-4o-mini-tts`

LiveKit documents this model in its OpenAI TTS plugin, including the `voice` and `instructions` parameters. citeturn1search1

Using one provider for all three layers keeps the assignment simple and reduces integration complexity while still demonstrating the required STT → LLM → TTS architecture.

## 6. Candidate metadata

The frontend sends a payload like:

```json
{
  "candidateName": "Sahitya",
  "jobTitle": "Backend Developer",
  "questions": [
    "Tell me about yourself.",
    "What is your experience with Node.js?",
    "Tell me about a challenging project you worked on.",
    "How do you handle database performance issues?"
  ]
}
```

This follows the assignment's candidate-information structure. fileciteturn0file0L43-L55

The agent reads the participant metadata instead of hard-coding the questions into the conversation itself.

## 7. Failure handling

### STT failure

The agent logs the error and uses a short spoken fallback asking the candidate to repeat the answer. The interview state is not advanced.

### LLM failure

The current question index is not intentionally advanced until a successful response is created. The agent says a short fallback and repeats the current question.

### TTS failure

The failure is logged. The interview state remains intact so the current question is not skipped.

### Candidate disconnect

The agent session closes naturally when the room/session ends. The frontend stops recording and shows the current transcript as an incomplete result if the candidate leaves early.

The assignment explicitly asks for basic handling of STT, LLM, TTS failures and early candidate departure, without requiring a complex retry framework. fileciteturn0file0L75-L87

## 8. Problem-solving question

**Scenario:** The candidate is answering question 2 and the LLM request fails.

### What should happen?

The interview should remain on question 2. It must not silently move to question 3 because the candidate's current answer has not been successfully processed.

### Should the agent retry?

For this assignment, a complex retry framework is not necessary. A practical approach is:

1. Preserve the current question index.
2. Log the LLM error.
3. Give the candidate a short fallback message.
4. Repeat the current question / ask the candidate to answer again.
5. Only advance the question after a successful AI response.

### How is state preserved?

The question index lives inside the running agent instance and is only committed when the response for the current turn is successfully created. The candidate metadata remains available in the room participant metadata, so the original ordered question list can also be reconstructed if needed.

This directly addresses the assignment's requested reasoning. fileciteturn0file0L137-L152

## 9. Audio recording

The assignment allows local recording or cloud storage and explicitly says production-grade recording is not required. fileciteturn0file0L106-L114

This implementation uses browser-side `MediaRecorder` and combines the candidate microphone stream with the agent audio available through browser audio elements. It creates a local WebM recording for playback after the interview.

For production, move recording to LiveKit Egress or another controlled storage system.

## 10. What is intentionally NOT implemented

The assignment says these are not required:

- Candidate scoring
- Cheating detection
- ECS
- Kubernetes
- Auto-scaling
- DynamoDB
- Authentication
- Billing
- Complex dashboards
- CI/CD
- Production infrastructure

So this project stays focused on the working interviewer rather than adding unrelated infrastructure. fileciteturn0file0L238-L251

## 11. Demo checklist

Record a demo showing:

```text
Start Interview
    ↓
AI greeting
    ↓
AI asks question
    ↓
Candidate answers
    ↓
AI responds
    ↓
Next question
    ↓
Final answer
    ↓
Interview completes
    ↓
Conversation displayed
    ↓
Audio playback
```

This matches the assignment's requested demo sequence. fileciteturn0file0L206-L224

## 12. Interview discussion points

Be ready to explain:

- Why LiveKit instead of ordinary HTTP requests?
- Why WebRTC?
- Why the agent is Python while the application backend is Node.js?
- How participant metadata carries the candidate configuration.
- How LiveKit agent dispatch works.
- How STT, LLM and TTS are connected.
- How question order is maintained.
- What happens when the LLM fails during question 2.
- Why the frontend does not contain LiveKit API secrets.
- Why browser recording is acceptable for this assignment.
- What you would change for production.

## Official documentation used

- LiveKit React quickstart: urlLiveKit React quickstartturn0search1
- LiveKit authentication/token endpoint: urlLiveKit token endpoint documentationturn3search0
- LiveKit session management: urlLiveKit Session managementturn4search3
- LiveKit AgentSession: urlLiveKit AgentSessionturn1search3
- LiveKit OpenAI STT: urlLiveKit OpenAI STTturn1search0
- LiveKit OpenAI TTS: urlLiveKit OpenAI TTSturn1search1
- LiveKit OpenAI LLM: urlLiveKit OpenAI LLMturn1search11
#   a i - i n t e r v i e w - a g e n t  
 