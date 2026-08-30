// Shared CORS setup for the Vercel serverless functions. The deployed frontend and the API
// are served from the same Vercel project/origin, so this is mainly a convenience for local
// `vercel dev` testing and any other origin hitting the API directly.
export function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
