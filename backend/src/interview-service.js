import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { RoomAgentDispatch } from "@livekit/protocol";

// Single source of truth for the interview backend's LiveKit logic, used by both the local
// Express server (backend/src/server.js) and the Vercel serverless functions (api/*.js), so
// the two deployment targets can never drift out of sync the way the old duplicated
// api/getToken.js copies once did.

const AGENT_NAME = "ai-interviewer";
// How long a created interview room stays open waiting for the candidate to open the
// shared link and join, before LiveKit reclaims it.
const ROOM_EMPTY_TIMEOUT_SECONDS = 2 * 60 * 60;

export class ServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireLiveKitConfig() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    throw new ServiceError(500, "LiveKit server configuration is missing in environment variables.");
  }
  return { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL };
}

function roomServiceClient() {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = requireLiveKitConfig();
  // RoomServiceClient talks to LiveKit's HTTP twirp API, not the wss:// signaling URL.
  const httpUrl = LIVEKIT_URL.replace(/^ws/, "http");
  return new RoomServiceClient(httpUrl, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
}

function generateRoomName() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "INT-";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Recruiter flow: create an interview room up front, with the job title/questions and the
// agent dispatch baked into the room itself (not into any one participant's token).
export async function createInterview({ jobTitle, questions } = {}) {
  const cleanedQuestions = Array.isArray(questions)
    ? questions.map((q) => String(q).trim()).filter(Boolean)
    : [];

  if (!jobTitle || !String(jobTitle).trim() || cleanedQuestions.length === 0) {
    throw new ServiceError(400, "jobTitle and at least one question are required.");
  }

  const roomName = generateRoomName();

  await roomServiceClient().createRoom({
    name: roomName,
    metadata: JSON.stringify({ jobTitle: String(jobTitle).trim(), questions: cleanedQuestions }),
    emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
    agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
  });

  return { roomName };
}

// Candidate join flow: given a room name from a shared link, confirm the interview still
// exists and return just enough public info (job title) to render the join screen, without
// exposing the full question list to the browser.
export async function lookupInterview(roomName) {
  if (!roomName) {
    throw new ServiceError(400, "roomName is required.");
  }

  const rooms = await roomServiceClient().listRooms([roomName]);
  if (rooms.length === 0) {
    throw new ServiceError(404, "This interview link is invalid or has expired.");
  }

  let jobTitle = "Technical Interview";
  try {
    const metadata = JSON.parse(rooms[0].metadata || "{}");
    if (metadata.jobTitle) jobTitle = metadata.jobTitle;
  } catch {
    // Room predates this metadata shape or was created outside this app; fall back.
  }

  return { roomName, jobTitle };
}

// Implements the LiveKit TokenSource endpoint contract used by the frontend's
// `TokenSource.endpoint(...)` (livekit-client). Agent dispatch is not set here: it was
// already attached to the room itself in createInterview, so a candidate's token only needs
// to grant them access to that existing room.
export async function mintToken({ room_name, participant_name, participant_identity, participant_metadata } = {}) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = requireLiveKitConfig();

  if (!room_name) {
    throw new ServiceError(400, "room_name is required.");
  }

  const participantIdentity = participant_identity || `candidate-${Date.now()}`;

  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
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

  return { serverUrl: LIVEKIT_URL, participantToken: await token.toJwt() };
}
