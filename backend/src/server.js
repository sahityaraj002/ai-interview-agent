import "dotenv/config";
import express from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-interview-backend" });
});

app.post("/getToken", async (req, res) => {
  try {
    const {
      room_name,
      roomName,
      participant_identity,
      participantIdentity,
      participant_name,
      participantName,
      participant_metadata,
      participantMetadata,
      participant_attributes,
      participantAttributes,
      room_config,
      roomConfig,
    } = req.body || {};

    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET || !process.env.LIVEKIT_URL) {
      return res.status(500).json({ error: "LiveKit server configuration is missing in backend .env." });
    }

    const effectiveRoomName = room_name || roomName || `interview-${Date.now()}`;
    const effectiveParticipantIdentity = participant_identity || participantIdentity || `candidate-${Date.now()}`;
    const effectiveParticipantName = participant_name || participantName || "Candidate";
    const effectiveMetadata = participant_metadata || participantMetadata || "";
    const effectiveAttributes = participant_attributes || participantAttributes || {};
    const effectiveRoomConfig = room_config || roomConfig;

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      {
        identity: effectiveParticipantIdentity,
        name: effectiveParticipantName,
        metadata: effectiveMetadata,
        attributes: effectiveAttributes,
        ttl: "30m",
      }
    );

    token.addGrant({
      roomJoin: true,
      room: effectiveRoomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    if (effectiveRoomConfig) {
      token.roomConfig = new RoomConfiguration(effectiveRoomConfig);
    } else {
      token.roomConfig = new RoomConfiguration({
        agents: [
          new RoomAgentDispatch({
            agentName: "ai-interviewer",
          }),
        ],
      });
    }

    const participantToken = await token.toJwt();

    return res.status(201).json({
      server_url: process.env.LIVEKIT_URL,
      serverUrl: process.env.LIVEKIT_URL,
      participant_token: participantToken,
      participantToken: participantToken,
    });
  } catch (error) {
    console.error("Token generation error:", error);
    return res.status(500).json({ error: "Failed to generate LiveKit token." });
  }
});

app.listen(port, () => {
  console.log(`AI Interview backend listening on http://localhost:${port}`);
});
