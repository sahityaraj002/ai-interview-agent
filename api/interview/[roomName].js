import { lookupInterview, ServiceError } from "../../backend/src/interview-service.js";
import { applyCors } from "../_cors.js";

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    res.status(200).json(await lookupInterview(req.query.roomName));
  } catch (error) {
    if (error instanceof ServiceError) return res.status(error.status).json({ error: error.message });
    console.error("Lookup interview error:", error);
    res.status(500).json({ error: "Failed to look up the interview." });
  }
}
