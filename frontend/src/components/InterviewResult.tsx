import { useState, useRef } from "react";

export type InterviewResultData = {
  candidateName: string;
  jobTitle: string;
  status: "Completed" | "Incomplete";
  durationSeconds: number;
  messages: any[];
  audioUrl: string | null;
};

export default function InterviewResult({
  result,
  onNewInterview,
}: {
  result: InterviewResultData;
  onNewInterview: () => void;
}) {
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "candidate" | "ai">("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fullTextTranscript = (result.messages || [])
    .map((m: any) => {
      const isUser =
        m.type === "userTranscript" ||
        m.role === "user" ||
        m.from?.identity === "candidate" ||
        m.sender === "user";
      const txt = m.message || m.content?.text || m.content || "";
      const time = m.timestamp ? ` [${new Date(m.timestamp).toLocaleTimeString()}]` : "";
      return `${isUser ? result.candidateName : "AI Interviewer"}${time}:\n${txt}`;
    })
    .join("\n\n");

  function handleCopyTranscript() {
    navigator.clipboard.writeText(fullTextTranscript);
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2500);
  }

  function handleDownloadTranscript(format: "txt" | "json") {
    let content = "";
    let mime = "text/plain";
    let ext = "txt";

    if (format === "json") {
      content = JSON.stringify(
        {
          candidateName: result.candidateName,
          jobTitle: result.jobTitle,
          status: result.status,
          durationSeconds: result.durationSeconds,
          completedAt: new Date().toISOString(),
          transcript: result.messages,
        },
        null,
        2
      );
      mime = "application/json";
      ext = "json";
    } else {
      content = `AI INTERVIEW REPORT & TRANSCRIPT
Candidate: ${result.candidateName}
Target Role: ${result.jobTitle}
Status: ${result.status}
Duration: ${formatDuration(result.durationSeconds)}
Date: ${new Date().toLocaleString()}

============================================================
TRANSCRIPT
============================================================
${fullTextTranscript}
`;
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-${result.candidateName.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleSpeedChange(speed: number) {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }

  function handlePrint() {
    window.print();
  }

  const filteredMessages = (result.messages || []).filter((m: any) => {
    const isUser =
      m.type === "userTranscript" ||
      m.role === "user" ||
      m.from?.identity === "candidate" ||
      m.sender === "user";

    if (activeFilter === "candidate" && !isUser) return false;
    if (activeFilter === "ai" && isUser) return false;

    if (!searchTerm.trim()) return true;
    const txt = (m.message || m.content?.text || m.content || "").toLowerCase();
    return txt.includes(searchTerm.toLowerCase());
  });

  return (
    <main className="page result-page">
      <section className="result-shell">
        {/* Top Header Card */}
        <div className="result-top">
          <div>
            <div className="eyebrow">
              <span className="live-dot" /> OFFICIAL TECHNICAL INTERVIEW SUMMARY
            </div>
            <h1>Interview {result.status === "Completed" ? "Completed Successfully" : "Ended"}</h1>
            <p>
              Candidate: <strong>{result.candidateName}</strong> · Target Role: <strong>{result.jobTitle}</strong>
            </p>
          </div>
          <div className="result-header-badges">
            <span className={`result-status ${result.status === "Completed" ? "success" : "incomplete"}`}>
              {result.status === "Completed" ? "✓ Completed" : "⚠️ Incomplete"}
            </span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="card stat-card">
            <span className="stat-label">Candidate Name</span>
            <strong className="stat-value">{result.candidateName}</strong>
            <span className="stat-sub">Applicant</span>
          </div>
          <div className="card stat-card">
            <span className="stat-label">Target Position</span>
            <strong className="stat-value">{result.jobTitle}</strong>
            <span className="stat-sub">Evaluated Role</span>
          </div>
          <div className="card stat-card">
            <span className="stat-label">Interview Duration</span>
            <strong className="stat-value">{formatDuration(result.durationSeconds)}</strong>
            <span className="stat-sub">Total Voice Time</span>
          </div>
          <div className="card stat-card">
            <span className="stat-label">Transcript Exchanges</span>
            <strong className="stat-value">{result.messages?.length || 0}</strong>
            <span className="stat-sub">Dialog Turns</span>
          </div>
        </div>

        {/* Audio Recording & Playback Section */}
        {result.audioUrl ? (
          <section className="card result-audio">
            <div className="audio-card-header">
              <div>
                <span className="pill">SESSION AUDIO</span>
                <h2>Interview Voice Recording</h2>
                <p>Full WebRTC high-fidelity candidate and AI interviewer audio recording.</p>
              </div>
              <div className="audio-header-actions">
                <a
                  href={result.audioUrl}
                  download={`interview-audio-${result.candidateName.toLowerCase().replace(/\s+/g, "-")}.webm`}
                  className="button secondary sm-btn"
                  title="Download raw WebM audio"
                >
                  ⬇ Download Recording (.webm)
                </a>
              </div>
            </div>

            <div className="audio-player-group">
              <audio ref={audioRef} controls src={result.audioUrl} className="main-audio-player" />
              
              <div className="playback-speed-controls">
                <span className="speed-lbl">Speed:</span>
                {[1, 1.25, 1.5, 2].map((spd) => (
                  <button
                    key={spd}
                    className={`speed-btn ${playbackSpeed === spd ? "active" : ""}`}
                    onClick={() => handleSpeedChange(spd)}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="card result-audio empty">
            <div className="audio-card-header">
              <div>
                <span className="pill">SESSION AUDIO</span>
                <h2>No Audio Recording Captured</h2>
                <p>Microphone permissions were either denied or session ended before recording initialized.</p>
              </div>
            </div>
          </section>
        )}

        {/* Transcript Section */}
        <section className="card result-transcript">
          <div className="section-heading">
            <div>
              <span className="step">CONVERSATION RECORD</span>
              <h2>Complete Interview Transcript ({result.messages.length} exchanges)</h2>
            </div>
            <div className="transcript-actions-group">
              <button
                className="button secondary sm-btn"
                onClick={handleCopyTranscript}
                title="Copy entire transcript to clipboard"
              >
                {copiedTranscript ? "✓ Copied!" : "📋 Copy All"}
              </button>
              <button
                className="button secondary sm-btn"
                onClick={() => handleDownloadTranscript("txt")}
                title="Export as plain text file"
              >
                ⬇ Export .txt
              </button>
              <button
                className="button secondary sm-btn"
                onClick={() => handleDownloadTranscript("json")}
                title="Export as JSON data"
              >
                ⬇ Export .json
              </button>
              <button
                className="button secondary sm-btn"
                onClick={handlePrint}
                title="Print or save as PDF"
              >
                🖨️ Print / PDF
              </button>
            </div>
          </div>

          {/* Transcript Filter & Search Bar */}
          <div className="transcript-filter-bar">
            <div className="filter-tabs">
              <button
                className={`filter-btn ${activeFilter === "all" ? "active" : ""}`}
                onClick={() => setActiveFilter("all")}
              >
                All ({result.messages.length})
              </button>
              <button
                className={`filter-btn ${activeFilter === "candidate" ? "active" : ""}`}
                onClick={() => setActiveFilter("candidate")}
              >
                👤 Candidate Only
              </button>
              <button
                className={`filter-btn ${activeFilter === "ai" ? "active" : ""}`}
                onClick={() => setActiveFilter("ai")}
              >
                🤖 AI Interviewer Only
              </button>
            </div>

            <div className="search-box">
              <input
                type="text"
                placeholder="Search transcript text…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="transcript-search"
              />
              {searchTerm && (
                <button className="clear-filter" onClick={() => setSearchTerm("")}>✕</button>
              )}
            </div>
          </div>

          <div className="transcript-list">
            {!filteredMessages.length ? (
              <div className="empty-transcript">
                {searchTerm
                  ? "No matching messages found for your search filter."
                  : "No conversation transcript exchanges were recorded during this session."}
              </div>
            ) : (
              filteredMessages.map((message: any, index: number) => {
                const isUser =
                  message.type === "userTranscript" ||
                  message.role === "user" ||
                  message.from?.identity === "candidate" ||
                  message.sender === "user";
                const text =
                  message.message ||
                  message.content?.text ||
                  message.content ||
                  "";

                return (
                  <div
                    className={`message ${isUser ? "candidate" : "ai"}`}
                    key={message.id || index}
                  >
                    <div className="message-header">
                      <div className="message-role">
                        {isUser ? `👤 ${result.candidateName} (Candidate)` : "🤖 AI Interviewer (LiveKit Agent)"}
                      </div>
                      <div className="message-time">
                        {message.timestamp
                          ? new Date(message.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })
                          : `#${index + 1}`}
                      </div>
                    </div>
                    <div className="message-text">
                      {typeof text === "string" ? text : String(text)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Action Buttons */}
        <div className="result-actions">
          <button className="button primary lg-btn" onClick={onNewInterview}>
            Start Another Technical Interview →
          </button>
        </div>
      </section>
    </main>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${secs}`;
}
