import "dotenv/config";
import express from "express";
import cors from "cors";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { RoomAgentDispatch } from "@livekit/protocol";

const AGENT_NAME = "ai-interviewer";
// How long a created interview room stays open waiting for the candidate to open the
// shared link and join, before LiveKit reclaims it.
const ROOM_EMPTY_TIMEOUT_SECONDS = 2 * 60 * 60;

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);
app.use(express.json({ limit: "100kb" }));

function requireLiveKitConfig(res) {
  if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
    res.status(500).json({ error: "LiveKit server configuration is missing in backend .env." });
    return false;
  }
  return true;
}

function roomServiceClient() {
  // RoomServiceClient talks to LiveKit's HTTP twirp API, not the wss:// signaling URL.
  const httpUrl = process.env.LIVEKIT_URL.replace(/^ws/, "http");
  return new RoomServiceClient(httpUrl, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

function generateRoomName() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "INT-";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-interview-backend" });
});

// Recruiter flow: create an interview room up front, with the job title/questions and the
// agent dispatch baked into the room itself (not into any one participant's token). Returns
// only a room name - the recruiter never becomes a participant in their own room.
app.post("/createInterview", async (req, res) => {
  try {
    if (!requireLiveKitConfig(res)) return;

    const { jobTitle, questions } = req.body || {};
    const cleanedQuestions = Array.isArray(questions)
      ? questions.map((q) => String(q).trim()).filter(Boolean)
      : [];

    if (!jobTitle || !String(jobTitle).trim() || cleanedQuestions.length === 0) {
      return res.status(400).json({ error: "jobTitle and at least one question are required." });
    }

    const roomName = generateRoomName();

    await roomServiceClient().createRoom({
      name: roomName,
      metadata: JSON.stringify({ jobTitle: String(jobTitle).trim(), questions: cleanedQuestions }),
      emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
    });

    return res.status(201).json({ roomName });
  } catch (error) {
    console.error("Create interview error:", error);
    return res.status(500).json({ error: "Failed to create the interview room." });
  }
});

// Candidate join flow: given a room name from a shared link, confirm the interview still
// exists and return just enough public info (job title) to render the join screen, without
// exposing the full question list to the browser.
app.get("/interview/:roomName", async (req, res) => {
  try {
    if (!requireLiveKitConfig(res)) return;

    const rooms = await roomServiceClient().listRooms([req.params.roomName]);
    if (rooms.length === 0) {
      return res.status(404).json({ error: "This interview link is invalid or has expired." });
    }

    let jobTitle = "Technical Interview";
    try {
      const metadata = JSON.parse(rooms[0].metadata || "{}");
      if (metadata.jobTitle) jobTitle = metadata.jobTitle;
    } catch {
      // Room predates this metadata shape or was created outside this app; fall back.
    }

    return res.json({ roomName: req.params.roomName, jobTitle });
  } catch (error) {
    console.error("Lookup interview error:", error);
    return res.status(500).json({ error: "Failed to look up the interview." });
  }
});

// Implements the LiveKit TokenSource endpoint contract used by the frontend's
// `TokenSource.endpoint(...)` (livekit-client). That client always sends its request body
// with snake_case proto field names (room_name, participant_name, ...). Agent dispatch is
// not set here: it was already attached to the room itself in /createInterview, so a
// candidate's token only needs to grant them access to that existing room.
app.post("/getToken", async (req, res) => {
  try {
    if (!requireLiveKitConfig(res)) return;

    const { room_name, participant_name, participant_identity, participant_metadata } = req.body || {};

    if (!room_name) {
      return res.status(400).json({ error: "room_name is required." });
    }

    const participantIdentity = participant_identity || `candidate-${Date.now()}`;

    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: participantIdentity,
      name: participant_name || "Candidate",
      metadata: participant_metadata || "",
      ttl: "30m",
    });

    token.addGrant({
      roomJoin: true,
      room: room_name,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return res.status(201).json({
      serverUrl: process.env.LIVEKIT_URL,
      participantToken: await token.toJwt(),
    });
  } catch (error) {
    console.error("Token generation error:", error);
    return res.status(500).json({ error: "Failed to generate LiveKit token." });
  }
});

app.listen(port, () => {
  console.log(`AI Interview backend listening on http://localhost:${port}`);
});
