import { useEffect, useState } from "react";
import { API_BASE } from "../api";
import type { InterviewConfig } from "../App";

type LookupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; jobTitle: string };

// Reached only via a shared interview link (?room=...). Whoever opens this link is always
// the candidate - there is no path from here back to the recruiter's create/configure form.
export default function JoinInterview({
  roomId,
  onJoin,
}: {
  roomId: string;
  onJoin: (config: InterviewConfig) => void;
}) {
  const [lookup, setLookup] = useState<LookupState>({ status: "loading" });
  const [candidateName, setCandidateName] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/interview/${encodeURIComponent(roomId)}`);
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error(
            res.status === 404
              ? "This interview link is invalid or has expired."
              : "Unable to reach the interview service. Please verify the backend is running."
          );
        }
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "This interview link is invalid or has expired.");
        if (!cancelled) setLookup({ status: "ready", jobTitle: body.jobTitle });
      } catch (error: any) {
        if (!cancelled) {
          setLookup({
            status: "error",
            message: error?.message || "This interview link is invalid or has expired.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  function handleJoin() {
    if (lookup.status !== "ready" || !candidateName.trim()) return;
    onJoin({
      roomId,
      candidateName: candidateName.trim(),
      jobTitle: lookup.jobTitle,
      questions: [],
    });
  }

  return (
    <main className="page setup-page">
      <section className="hero">
        <div className="eyebrow-badge">
          <span className="live-dot" /> LIVEKIT VOICE AI · REAL-TIME INTERVIEW
        </div>
        <h1>You're Invited to an Interview</h1>
        <p>Join the voice interview below - the AI interviewer will guide you through it.</p>
      </section>

      <section className="card setup-card join-card">
        {lookup.status === "loading" && <div className="small-note">Loading interview details…</div>}

        {lookup.status === "error" && (
          <div className="section-heading">
            <div>
              <span className="step">LINK UNAVAILABLE</span>
              <h2>{lookup.message}</h2>
            </div>
          </div>
        )}

        {lookup.status === "ready" && (
          <>
            <div className="section-heading">
              <div>
                <span className="step">ROLE</span>
                <h2>{lookup.jobTitle}</h2>
              </div>
              <span className="pill">CANDIDATE JOIN</span>
            </div>

            <div className="grid-2">
              <label>
                Your Name
                <input
                  value={candidateName}
                  onChange={(e) => setCandidateName(e.target.value)}
                  placeholder="e.g. Jordan"
                  autoFocus
                  required
                />
              </label>
            </div>

            <div className="setup-footer">
              <div className="small-note">
                Make sure your microphone is ready - the AI interviewer will greet you and
                ask its first question as soon as you join.
              </div>
              <button
                type="button"
                className="button primary lg-btn"
                onClick={handleJoin}
                disabled={!candidateName.trim()}
              >
                Join Interview →
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
