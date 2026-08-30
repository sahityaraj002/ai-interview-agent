import "dotenv/config";
import express from "express";
import cors from "cors";
import { createInterview, lookupInterview, mintToken, ServiceError } from "./interview-service.js";

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);
app.use(express.json({ limit: "100kb" }));

function sendError(res, error, fallbackMessage) {
  if (error instanceof ServiceError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ai-interview-backend" });
});

app.post("/createInterview", async (req, res) => {
  try {
    res.status(201).json(await createInterview(req.body || {}));
  } catch (error) {
    sendError(res, error, "Failed to create the interview room.");
  }
});

app.get("/interview/:roomName", async (req, res) => {
  try {
    res.json(await lookupInterview(req.params.roomName));
  } catch (error) {
    sendError(res, error, "Failed to look up the interview.");
  }
});

app.post("/getToken", async (req, res) => {
  try {
    res.status(201).json(await mintToken(req.body || {}));
  } catch (error) {
    sendError(res, error, "Failed to generate LiveKit token.");
  }
});

app.listen(port, () => {
  console.log(`AI Interview backend listening on http://localhost:${port}`);
});
