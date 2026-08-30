import { createInterview, ServiceError } from "../backend/src/interview-service.js";
import { applyCors } from "./_cors.js";

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  try {
    res.status(201).json(await createInterview(req.body || {}));
  } catch (error) {
    if (error instanceof ServiceError) return res.status(error.status).json({ error: error.message });
    console.error("Create interview error:", error);
    res.status(500).json({ error: "Failed to create the interview room." });
  }
}
