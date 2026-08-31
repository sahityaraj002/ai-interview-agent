import { lookupInterview, ServiceError } from "../backend/src/interview-service.js";
import { applyCors } from "./_cors.js";

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const roomName = req.query.roomName || req.query.room;

  try {
    const data = await lookupInterview(roomName);
    return res.status(200).json(data);
  } catch (error) {
    if (error instanceof ServiceError || error?.status) {
      return res.status(error.status || 400).json({ error: error.message });
    }
    console.error("Lookup interview error:", error);
    return res.status(500).json({ error: "Failed to look up the interview." });
  }
}
