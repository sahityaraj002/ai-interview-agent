import { useEffect, useState } from "react";
import type { InterviewConfig } from "../App";

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

function generateRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "INT-";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export default function InterviewSetup({
  initialRoomId,
  onStart,
}: {
  initialRoomId?: string;
  onStart: (config: InterviewConfig) => void;
}) {
  const [activeTab, setActiveTab] = useState<"create" | "join">(
    initialRoomId ? "join" : "create"
  );

  // Host / Create State
  const [candidateName, setCandidateName] = useState("Sahitya");
  const [jobTitle, setJobTitle] = useState("Backend Developer");
  const [roomId, setRoomId] = useState(initialRoomId || generateRoomId());
  const [questions, setQuestions] = useState<string[]>(PRESET_ROLES[0].questions);
  const [copiedLink, setCopiedLink] = useState(false);

  // Join State
  const [joinName, setJoinName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState(initialRoomId || "");
  const [joinRole, setJoinRole] = useState<"candidate" | "interviewer">("candidate");

  useEffect(() => {
    if (initialRoomId) {
      setJoinRoomId(initialRoomId);
      setRoomId(initialRoomId);
      setActiveTab("join");
    }
  }, [initialRoomId]);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  const shareableUrl = `${origin}/?room=${encodeURIComponent(roomId)}`;

  function handleCopyShareLink() {
    navigator.clipboard.writeText(shareableUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  }

  function handleGenerateNewId() {
    const newId = generateRoomId();
    setRoomId(newId);
  }

  function handleSelectPreset(preset: typeof PRESET_ROLES[0]) {
    setJobTitle(preset.role);
    setQuestions([...preset.questions]);
  }

  function updateQuestion(index: number, value: string) {
    setQuestions((current) =>
      current.map((q, i) => (i === index ? value : q))
    );
  }

  function addQuestion() {
    setQuestions((current) => [...current, ""]);
  }

  function removeQuestion(index: number) {
    setQuestions((current) => current.filter((_, i) => i !== index));
  }

  function handleStartHost() {
    const cleaned = questions.map((q) => q.trim()).filter(Boolean);
    if (!candidateName.trim() || !jobTitle.trim() || cleaned.length === 0 || !roomId.trim()) {
      return;
    }

    onStart({
      roomId: roomId.trim(),
      candidateName: candidateName.trim(),
      jobTitle: jobTitle.trim(),
      questions: cleaned,
      role: "host",
    });
  }

  function handleJoinMeeting() {
    if (!joinName.trim() || !joinRoomId.trim()) {
      return;
    }

    onStart({
      roomId: joinRoomId.trim(),
      candidateName: joinName.trim(),
      jobTitle: "Live Technical Interview",
      questions: questions,
      role: joinRole,
    });
  }

  return (
    <main className="page setup-page">
      <section className="hero">
        <div className="eyebrow-badge">
          <span className="live-dot" /> LIVEKIT VOICE AI · REAL-TIME WEBRTC INTERVIEW
        </div>
        <h1>AI Technical Interview Room</h1>
        <p>
          Real-time voice AI interviewer powered by LiveKit WebRTC, Speech-to-Text, LLM reasoning, and natural Text-to-Speech.
          Complete with live audio recording, live transcripts, and instant analytics.
        </p>
      </section>

      {/* Mode Tabs */}
      <div className="setup-tabs">
        <button
          className={`tab-button ${activeTab === "create" ? "active" : ""}`}
          onClick={() => setActiveTab("create")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Configure & Start Interview
        </button>
        <button
          className={`tab-button ${activeTab === "join" ? "active" : ""}`}
          onClick={() => setActiveTab("join")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" />
          </svg>
          Join with Room Code
          {initialRoomId && <span className="tab-pill">Direct Link</span>}
        </button>
      </div>

      {activeTab === "create" ? (
        <section className="card setup-card">
          <div className="section-heading">
            <div>
              <span className="step">STEP 01</span>
              <h2>Candidate & Role Configuration</h2>
            </div>
            <span className="pill">REAL-TIME VOICE AGENT</span>
          </div>

          {/* Preset Quick Select */}
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
              Candidate Name
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="e.g. Sahitya"
                required
              />
            </label>

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

          {/* Client ID / Room Code & Share Link Section */}
          <div className="room-id-section">
            <div className="room-id-header">
              <label>
                Room Code / Client ID
                <div className="room-input-row">
                  <input
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    placeholder="e.g. INT-8492"
                    className="room-code-input"
                  />
                  <button
                    type="button"
                    className="button secondary sm-btn"
                    onClick={handleGenerateNewId}
                    title="Generate New Random Code"
                  >
                    🎲 Regenerate ID
                  </button>
                </div>
              </label>
            </div>

            <div className="share-link-box">
              <div className="share-link-info">
                <span className="share-label">SHAREABLE MEETING LINK (OPTIONAL OBSERVER/CO-HOST)</span>
                <span className="share-url">{shareableUrl}</span>
              </div>
              <button
                type="button"
                className={`button ${copiedLink ? "success-btn" : "secondary"}`}
                onClick={handleCopyShareLink}
              >
                {copiedLink ? "✓ Copied!" : "📋 Copy Link"}
              </button>
            </div>
          </div>

          <div className="question-header">
            <div>
              <span className="step">STEP 02</span>
              <h2>Configured Interview Questions ({questions.length})</h2>
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
              The AI interviewer will ask these questions sequentially and automatically record the session audio & transcript.
            </div>

            <button
              type="button"
              className="button primary lg-btn"
              onClick={handleStartHost}
              disabled={!candidateName.trim() || !jobTitle.trim() || questions.length === 0}
            >
              Start Live Interview Session →
            </button>
          </div>
        </section>
      ) : (
        /* JOIN TAB */
        <section className="card setup-card join-card">
          <div className="section-heading">
            <div>
              <span className="step">ROOM JOIN</span>
              <h2>Join an Ongoing Interview Room</h2>
            </div>
            <span className="pill">WEBRTC MULTI-PARTY</span>
          </div>

          <div className="grid-2">
            <label>
              Your Name
              <input
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="e.g. Sahitya or Alex"
                required
              />
            </label>

            <label>
              Room Code / Client ID
              <input
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.toUpperCase())}
                placeholder="e.g. INT-8492"
                required
              />
            </label>
          </div>

          <div className="role-selection">
            <label>Join Role</label>
            <div className="role-options">
              <button
                type="button"
                className={`role-btn ${joinRole === "candidate" ? "active" : ""}`}
                onClick={() => setJoinRole("candidate")}
              >
                👤 Candidate
              </button>
              <button
                type="button"
                className={`role-btn ${joinRole === "interviewer" ? "active" : ""}`}
                onClick={() => setJoinRole("interviewer")}
              >
                👀 Observer / Co-Interviewer
              </button>
            </div>
          </div>

          <div className="setup-footer">
            <div className="small-note">
              Enter the Room Code provided by the host to connect directly into the active WebRTC room.
            </div>

            <button
              type="button"
              className="button primary lg-btn"
              onClick={handleJoinMeeting}
              disabled={!joinName.trim() || !joinRoomId.trim()}
            >
              Join Room Now →
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
