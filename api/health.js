import { applyCors } from "./_cors.js";

export default function handler(req, res) {
  applyCors(res);
  res.status(200).json({ ok: true, service: "ai-interview-serverless-api" });
}
