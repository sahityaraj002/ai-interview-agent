import { AccessToken } from "livekit-server-sdk";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";

export default async function handler(req, res) {
  // CORS support
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

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

    const livekitApiKey = process.env.LIVEKIT_API_KEY;
    const livekitApiSecret = process.env.LIVEKIT_API_SECRET;
    const livekitUrl = process.env.LIVEKIT_URL;

    if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
      return res.status(500).json({
        error: "LiveKit server configuration is missing in environment variables (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).",
      });
    }

    const effectiveRoomName = room_name || roomName || `interview-${Date.now()}`;
    const effectiveParticipantIdentity =
      participant_identity || participantIdentity || `candidate-${Date.now()}`;
    const effectiveParticipantName =
      participant_name || participantName || "Candidate";
    const effectiveMetadata = participant_metadata || participantMetadata || "";
    const effectiveAttributes = participant_attributes || participantAttributes || {};
    const effectiveRoomConfig = room_config || roomConfig;

    const token = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: effectiveParticipantIdentity,
      name: effectiveParticipantName,
      metadata: effectiveMetadata,
      attributes: effectiveAttributes,
      ttl: "30m",
    });

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
      server_url: livekitUrl,
      serverUrl: livekitUrl,
      participant_token: participantToken,
      participantToken: participantToken,
    });
  } catch (error) {
    console.error("Token generation error:", error);
    return res.status(500).json({ error: "Failed to generate LiveKit token." });
  }
}
