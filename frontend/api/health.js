export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "ai-interview-frontend-serverless-api",
    timestamp: new Date().toISOString(),
  });
}
