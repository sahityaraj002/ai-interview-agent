import { useState } from "react";
import { API_BASE } from "../api";

const PRESET_ROLES = [
  {
    role: "Backend Developer",
    questions: [
      "Tell me about yourself and your background building scalable backend systems.",
      "How do you design RESTful and GraphQL APIs for high availability?",
      "Can you walk me through a difficult database performance bottleneck you resolved?",
      "How do you handle distributed transactions, caching, and rate limiting?",
    ],
  },
  {
    role: "Full Stack Engineer",
    questions: [
      "Tell me about your technical journey across frontend and backend technologies.",
      "How do you structure React/TypeScript applications for optimal state management?",
      "What is your approach to handling WebRTC or WebSocket real-time communication?",
      "Describe how you secure web applications against common vulnerabilities like XSS and CSRF.",
    ],
  },
  {
    role: "Frontend Specialist",
    questions: [
      "Tell me about yourself and your experience crafting modern web interfaces.",
      "How do you optimize rendering performance, Core Web Vitals, and asset delivery?",
      "How do you approach creating accessible (a11y) and responsive design systems?",
      "What is your experience with modern frameworks like React, Next.js, and Vite?",
    ],
  },
];

// Recruiter-only: configure an interview and get back a shareable link. This screen never
// leads into the LiveKit room itself - only someone who opens the shared link (JoinInterview)
// becomes a participant, and always as the candidate.
export default function CreateInterview() {
  const [jobTitle, setJobTitle] = useState("Backend Developer");
  const [questions, setQuestions] = useState<string[]>(PRESET_ROLES[0].questions);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleSelectPreset(preset: (typeof PRESET_ROLES)[0]) {
    setJobTitle(preset.role);
    setQuestions([...preset.questions]);
  }

  function updateQuestion(index: number, value: string) {
    setQuestions((current) => current.map((q, i) => (i === index ? value : q)));
  }

  function addQuestion() {
    setQuestions((current) => [...current, ""]);
  }

  function removeQuestion(index: number) {
    setQuestions((current) => current.filter((_, i) => i !== index));
  }

  async function handleCreate() {
    const cleaned = questions.map((q) => q.trim()).filter(Boolean);
    if (!jobTitle.trim() || cleaned.length === 0) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API_BASE}/createInterview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobTitle: jobTitle.trim(), questions: cleaned }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Unable to reach the interview service. Please verify the backend is running and configured.");
      }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Failed to create the interview.");

      setShareUrl(`${window.location.origin}/?room=${encodeURIComponent(body.roomName)}`);
    } catch (error: any) {
      setCreateError(error?.message || "Failed to create the interview.");
    } finally {
      setIsCreating(false);
    }
  }

  function handleCopyLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function handleCreateAnother() {
    setShareUrl(null);
    setCreateError(null);
  }

  if (shareUrl) {
    return (
      <main className="page setup-page">
        <section className="hero">
          <div className="eyebrow-badge">
            <span className="live-dot" /> INTERVIEW CREATED
          </div>
          <h1>Share This Link With Your Candidate</h1>
          <p>
            Anyone who opens this link joins directly as the candidate for the{" "}
            <strong>{jobTitle}</strong> interview - they won't see or be able to change this
            configuration.
          </p>
        </section>

        <section className="card setup-card">
          <div className="share-link-box">
            <div className="share-link-info">
              <span className="share-label">CANDIDATE INTERVIEW LINK</span>
              <span className="share-url">{shareUrl}</span>
            </div>
            <button
              type="button"
              className={`button ${copied ? "success-btn" : "primary"}`}
              onClick={handleCopyLink}
            >
              {copied ? "✓ Copied!" : "📋 Copy Link"}
            </button>
          </div>

          <div className="setup-footer">
            <div className="small-note">
              This link stays valid for 2 hours. The AI interviewer joins automatically once
              the candidate connects.
            </div>
            <button type="button" className="button secondary lg-btn" onClick={handleCreateAnother}>
              Create Another Interview
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page setup-page">
      <section className="hero">
        <div className="eyebrow-badge">
          <span className="live-dot" /> LIVEKIT VOICE AI · REAL-TIME INTERVIEW
        </div>
        <h1>AI Technical Interview</h1>
        <p>
          A real-time voice AI interviewer powered by LiveKit, Speech-to-Text, an LLM, and
          Text-to-Speech. Configure the role and questions, then share the interview link
          with your candidate.
        </p>
      </section>

      <section className="card setup-card">
        <div className="section-heading">
          <div>
            <span className="step">STEP 01</span>
            <h2>Role Configuration</h2>
          </div>
          <span className="pill">REAL-TIME VOICE AGENT</span>
        </div>

        <div className="preset-selector">
          <span className="preset-label">Quick Role Presets:</span>
          <div className="preset-chips">
            {PRESET_ROLES.map((preset) => (
              <button
                key={preset.role}
                type="button"
                className={`preset-chip ${jobTitle === preset.role ? "active" : ""}`}
                onClick={() => handleSelectPreset(preset)}
              >
                {preset.role}
              </button>
            ))}
          </div>
        </div>

        <div className="grid-2">
          <label>
            Target Job Title
            <input
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Senior Backend Engineer"
              required
            />
          </label>
        </div>

        <div className="question-header">
          <div>
            <span className="step">STEP 02</span>
            <h2>Interview Questions ({questions.length})</h2>
          </div>
          <button type="button" className="button secondary" onClick={addQuestion}>
            + Add Question
          </button>
        </div>

        <div className="question-list">
          {questions.map((question, index) => (
            <div className="question-row" key={index}>
              <span className="question-number">{index + 1}</span>
              <input
                value={question}
                onChange={(e) => updateQuestion(index, e.target.value)}
                placeholder={`Interview Question ${index + 1}`}
              />
              {questions.length > 1 && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => removeQuestion(index)}
                  aria-label={`Remove question ${index + 1}`}
                  title="Remove question"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="setup-footer">
          <div className="small-note">
            {createError ? (
              <span style={{ color: "#f87171" }}>{createError}</span>
            ) : (
              "You'll get a shareable link for the candidate to join once created."
            )}
          </div>

          <button
            type="button"
            className="button primary lg-btn"
            onClick={handleCreate}
            disabled={isCreating || !jobTitle.trim() || questions.length === 0}
          >
            {isCreating ? "Creating…" : "Create Interview →"}
          </button>
        </div>
      </section>
    </main>
  );
}
