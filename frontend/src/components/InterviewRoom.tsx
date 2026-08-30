import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  BarVisualizer,
  RoomAudioRenderer,
  useAgent,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useSessionMessages,
  VideoTrack,
} from "@livekit/components-react";
import {
  ConnectionState,
  RoomEvent,
  Track,
  type Room,
} from "livekit-client";
import type { InterviewConfig } from "../App";
import type { InterviewResultData } from "./InterviewResult";

type SessionLike = {
  room?: Room;
  start: () => Promise<void> | void;
  end: () => Promise<void> | void;
};

type RecorderState = {
  recorder: MediaRecorder;
  chunks: Blob[];
  audioContext?: AudioContext;
  destination?: MediaStreamAudioDestinationNode;
  sourceNodes: AudioNode[];
  micStream?: MediaStream;
};

export default function InterviewRoom({
  session,
  config,
  onComplete,
  onCancel,
}: {
  session: SessionLike;
  config: InterviewConfig;
  onComplete: (data: InterviewResultData) => void;
  onCancel: () => void;
}) {
  const connection = useConnectionState(session.room);
  const { localParticipant } = useLocalParticipant({ room: session.room });
  const remoteParticipants = useRemoteParticipants({ room: session.room });

  // Timers & Recording state
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);

  // UI state
  const [isEnding, setIsEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [activeSideTab, setActiveSideTab] = useState<"transcript" | "agenda" | "participants" | null>("transcript");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"gallery" | "speaker">("gallery");
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Media Controls
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [micAudioLevel, setMicAudioLevel] = useState(0);

  // References
  const recorderRef = useRef<RecorderState | null>(null);
  const lastAgentDisconnected = useRef(false);
  const recordingTimerRef = useRef<number | null>(null);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);
  const micStreamRef = useRef<MediaStream | null>(null);

  const { messages } = useSessionMessages(session as any);
  const { state: agentState } = useAgent(session as any);

  const shareableUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/?room=${encodeURIComponent(config.roomId)}`
      : "";

  // Helper for quick toast
  const showToast = useCallback((msg: string) => {
    setCopiedToast(msg);
    setTimeout(() => setCopiedToast(null), 2500);
  }, []);

  // Compute current question progress
  const currentQuestionIndex = (() => {
    if (!messages || messages.length === 0) return 0;
    // Count AI questions asked
    const aiMessages = messages.filter((m: any) => {
      const isUser =
        m.type === "userTranscript" ||
        m.role === "user" ||
        m.from?.identity === "candidate" ||
        m.sender === "user";
      return !isUser;
    });
    // First message is greeting + Q1, each subsequent speech can advance
    const count = Math.max(0, aiMessages.length - 1);
    return Math.min(count, config.questions.length - 1);
  })();

  // 1. Initialize Interview & Recording
  useEffect(() => {
    let mounted = true;

    async function startInterview() {
      try {
        await session.start();
        if (mounted) {
          setStartedAt(Date.now());
          await startRecording();
        }
      } catch (error) {
        console.error("Failed to start interview session:", error);
        onCancel();
      }
    }

    startInterview();

    return () => {
      mounted = false;
      stopRecording();
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Main Call Duration Timer
  useEffect(() => {
    if (!startedAt) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  // 3. Recording Duration Timer
  useEffect(() => {
    if (isRecording) {
      const recTimer = window.setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
      recordingTimerRef.current = recTimer;
      return () => window.clearInterval(recTimer);
    }
  }, [isRecording]);

  // 4. Auto-scroll transcript on new message
  useEffect(() => {
    if (activeSideTab === "transcript") {
      transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, activeSideTab]);

  // 5. Mic Audio Level Analyser for Candidate Visualizer
  useEffect(() => {
    if (!micStreamRef.current || isMicMuted) {
      setMicAudioLevel(0);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let animFrame: number;
    try {
      const stream = micStreamRef.current;
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const checkLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += dataArray[i];
        }
        const avg = sum / bufferLength;
        const normalized = Math.min(100, Math.round((avg / 100) * 100));
        setMicAudioLevel(normalized);
        animFrame = requestAnimationFrame(checkLevel);
      };
      checkLevel();
    } catch (err) {
      console.warn("Audio meter init error:", err);
    }

    return () => {
      cancelAnimationFrame(animFrame);
      audioCtx?.close().catch(() => {});
    };
  }, [isRecording, isMicMuted]);

  // Media controls
  async function toggleMicrophone() {
    if (!session.room) return;
    const nextState = !isMicMuted;
    try {
      await session.room.localParticipant.setMicrophoneEnabled(!nextState);
      setIsMicMuted(nextState);
      showToast(nextState ? "Microphone Muted" : "Microphone Active");
    } catch (err) {
      console.error("Error toggling microphone:", err);
    }
  }

  async function toggleCamera() {
    if (!session.room) return;
    const nextState = !isVideoEnabled;
    try {
      await session.room.localParticipant.setCameraEnabled(nextState);
      setIsVideoEnabled(nextState);
      showToast(nextState ? "Camera Turned On" : "Camera Turned Off");
    } catch (err) {
      console.error("Error toggling camera:", err);
    }
  }

  async function toggleScreenShare() {
    if (!session.room) return;
    const nextState = !isScreenSharing;
    try {
      await session.room.localParticipant.setScreenShareEnabled(nextState);
      setIsScreenSharing(nextState);
      showToast(nextState ? "Screen Sharing Started" : "Screen Sharing Stopped");
    } catch (err) {
      console.error("Error toggling screen share:", err);
    }
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }

  function handleCopyInvite() {
    navigator.clipboard.writeText(shareableUrl);
    showToast("✓ Meeting Link Copied!");
  }

  function handleCopyRoomId() {
    navigator.clipboard.writeText(config.roomId);
    showToast("✓ Client ID Copied!");
  }

  // Audio Recording implementation with mixer
  async function startRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setRecordingError("This browser does not support WebRTC audio recording.");
        return;
      }

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = micStream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();
      const sourceNodes: AudioNode[] = [];

      // Connect Candidate Mic to recording destination
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
      sourceNodes.push(micSource);

      // Capture AI / Remote participants audio elements
      const captureRemoteAudio = () => {
        const audioElements = Array.from(
          document.querySelectorAll("audio")
        ) as HTMLAudioElement[];

        for (const element of audioElements) {
          if ((element as any).__aiInterviewCaptured) continue;
          try {
            const remoteStream = (element as any).captureStream?.() || (element as any).mozCaptureStream?.();
            if (remoteStream) {
              const remoteSource = audioContext.createMediaStreamSource(remoteStream);
              remoteSource.connect(destination);
              sourceNodes.push(remoteSource);
              (element as any).__aiInterviewCaptured = true;
            }
          } catch {
            // Browser security restriction fallback; mic is still recorded
          }
        }
      };

      captureRemoteAudio();
      const poll = window.setInterval(captureRemoteAudio, 1000);
      window.setTimeout(() => window.clearInterval(poll), 20000);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(destination.stream, { mimeType });
      const state: RecorderState = {
        recorder,
        chunks: [],
        audioContext,
        destination,
        sourceNodes,
        micStream,
      };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          state.chunks.push(event.data);
        }
      };

      recorder.start(1000);
      recorderRef.current = state;
      setIsRecording(true);
      setRecordingDuration(0);
    } catch (error: any) {
      console.error("Recording setup failed:", error);
      setRecordingError(error?.message || "Microphone recording could not be started.");
    }
  }

  async function stopRecording(): Promise<string | null> {
    setIsRecording(false);
    const state = recorderRef.current;
    if (!state) return recordingUrl;

    const url = await new Promise<string | null>((resolve) => {
      const finish = () => {
        try {
          const blob = new Blob(state.chunks, { type: "audio/webm" });
          const createdUrl = URL.createObjectURL(blob);
          setRecordingUrl(createdUrl);
          resolve(createdUrl);
        } catch {
          resolve(null);
        }
      };

      if (state.recorder.state === "inactive") {
        finish();
      } else {
        state.recorder.addEventListener("stop", finish, { once: true });
        try {
          state.recorder.stop();
        } catch {
          finish();
        }
      }
    });

    state.sourceNodes.forEach((node) => {
      try { node.disconnect(); } catch {}
    });
    state.micStream?.getTracks().forEach((track) => track.stop());
    try {
      await state.audioContext?.close();
    } catch {}
    recorderRef.current = null;

    return url;
  }

  async function finishInterview(status: "Completed" | "Incomplete") {
    if (isEnding) return;
    setIsEnding(true);
    setShowEndConfirm(false);

    try {
      await session.end();
    } catch (error) {
      console.error("Session end error:", error);
    }

    const audioUrl = await stopRecording();

    onComplete({
      candidateName: config.candidateName,
      jobTitle: config.jobTitle,
      status,
      durationSeconds: elapsed,
      messages: Array.isArray(messages) ? [...messages] : [],
      audioUrl,
    });
  }

  // Handle participant disconnection
  useEffect(() => {
    const room = session.room;
    if (!room) return;

    const onDisconnected = () => {
      if (lastAgentDisconnected.current || isEnding) return;
      lastAgentDisconnected.current = true;
      finishInterview("Incomplete");
    };

    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [session.room, isEnding, messages]);

  const cameraTrack = localParticipant.getTrackPublication(Track.Source.Camera);
  const totalInCall = 1 + (remoteParticipants?.length || 0) + (agentState ? 1 : 0);

  // Filter messages for search
  const filteredMessages = (messages || []).filter((m: any) => {
    if (!transcriptSearch.trim()) return true;
    const txt = (m.message || m.content?.text || m.content || "").toLowerCase();
    return txt.includes(transcriptSearch.toLowerCase());
  });

  return (
    <div className="zoom-app">
      {/* Toast Alert */}
      {copiedToast && (
        <div className="app-toast">
          <span>{copiedToast}</span>
        </div>
      )}

      {/* Top Meeting Header Bar */}
      <header className="zoom-header">
        <div className="header-left">
          {/* Prominent Recording Badge with Live Duration */}
          <div className={`live-rec-badge ${isRecording ? "active" : "standby"}`}>
            <span className="rec-dot-animated" />
            <span className="rec-text">REC</span>
            <span className="rec-time">{formatDuration(recordingDuration)}</span>
          </div>

          <div className="meeting-info-group">
            <h1 className="meeting-title">{config.jobTitle}</h1>
            <span className="candidate-badge">👤 {config.candidateName}</span>
          </div>
        </div>

        <div className="header-center">
          {/* Question Progress Pill */}
          <div className="header-question-pill" onClick={() => setActiveSideTab("agenda")} title="View configured questions">
            <span className="q-pill-label">QUESTION</span>
            <span className="q-pill-val">
              {currentQuestionIndex + 1} of {config.questions.length}
            </span>
            <div className="q-progress-bar">
              <div
                className="q-progress-fill"
                style={{
                  width: `${((currentQuestionIndex + 1) / config.questions.length) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Client ID / Room Code Badge */}
          <div
            className="client-id-badge"
            onClick={handleCopyRoomId}
            title="Click to copy Client ID"
          >
            <span className="id-label">ROOM CODE:</span>
            <span className="id-val">{config.roomId}</span>
            <span className="copy-action-btn">📋</span>
          </div>
        </div>

        <div className="header-right">
          {/* Overall Elapsed Timer */}
          <div className="header-timer" title="Total Interview Duration">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{formatDuration(elapsed)}</span>
          </div>

          {/* WebRTC Connection Status */}
          <div className="connection-pill" title="LiveKit WebRTC Connection">
            <span className={`status-dot ${connection === ConnectionState.Connected ? "live" : ""}`} />
            <span>{connection === ConnectionState.Connected ? "HD Connected" : connection}</span>
          </div>

          {/* Fullscreen Toggle */}
          <button
            className="header-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {isFullscreen ? (
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              ) : (
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              )}
            </svg>
          </button>

          {/* View Mode Toggle */}
          <button
            className="header-btn"
            onClick={() => setViewMode(viewMode === "gallery" ? "speaker" : "gallery")}
            title="Toggle Grid / Speaker View"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
            </svg>
            <span>{viewMode === "gallery" ? "Gallery" : "Speaker"}</span>
          </button>
        </div>
      </header>

      {/* Main Video Call Area */}
      <div className="zoom-body">
        <main className={`zoom-stage ${viewMode} ${activeSideTab ? "with-sidebar" : ""}`}>
          
          {/* AI Interviewer Video Tile */}
          <div className={`video-tile ai-tile ${agentState === "speaking" ? "active-speaker" : ""}`}>
            <div className="ai-orb-stage">
              <div className={`agent-orb ${agentState || "idle"}`}>
                <div className="orb-ring ring-1" />
                <div className="orb-ring ring-2" />
                <div className="orb-core" />
              </div>

              <div className="ai-status-indicator">
                <span className={`ai-state-pill ${agentState || "listening"}`}>
                  {agentState === "speaking"
                    ? "🔊 AI Interviewer Speaking"
                    : agentState === "thinking"
                    ? "⚡ AI Processing Response…"
                    : "👂 AI Listening to Candidate"}
                </span>
              </div>

              <div className="ai-visualizer">
                <BarVisualizer
                  state={agentState}
                  barCount={24}
                  options={{ minHeight: 8, maxHeight: 60 }}
                />
              </div>
            </div>

            <div className="tile-nameplate">
              <div className="nameplate-info">
                <span className="ai-icon-badge">🤖</span>
                <span className="participant-name">AI Technical Interviewer</span>
                <span className="role-tag">Host</span>
              </div>
              <span className={`audio-wave-dot ${agentState === "speaking" ? "active" : ""}`} />
            </div>
          </div>

          {/* Local Candidate Tile */}
          <div className={`video-tile candidate-tile ${micAudioLevel > 15 ? "audio-active" : ""}`}>
            {isVideoEnabled && cameraTrack && cameraTrack.isSubscribed && cameraTrack.track ? (
              <VideoTrack
                trackRef={{ participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }}
                className="video-feed"
              />
            ) : isVideoEnabled ? (
              <LocalVideoPreview />
            ) : (
              <div className="avatar-fallback">
                <div className="avatar-circle">
                  {config.candidateName.charAt(0).toUpperCase()}
                </div>
                <span className="camera-off-label">Camera Turned Off</span>
              </div>
            )}

            {/* Candidate Voice Activity Meter */}
            {!isMicMuted && (
              <div className="candidate-voice-meter" title="Mic Audio Signal">
                <div className="meter-bars">
                  <span className="bar" style={{ height: `${Math.max(15, micAudioLevel * 0.8)}%` }} />
                  <span className="bar" style={{ height: `${Math.max(25, micAudioLevel * 1.0)}%` }} />
                  <span className="bar" style={{ height: `${Math.max(15, micAudioLevel * 0.7)}%` }} />
                </div>
              </div>
            )}

            <div className="tile-nameplate">
              <div className="nameplate-info">
                <span className="participant-name">{config.candidateName} (You)</span>
                {isMicMuted ? (
                  <span className="mute-icon-badge red" title="Microphone Muted">🔇 Muted</span>
                ) : (
                  <span className="mute-icon-badge green" title="Microphone Active">🎙️ Active</span>
                )}
              </div>
              {!isMicMuted && micAudioLevel > 12 && (
                <span className="audio-wave-dot active" />
              )}
            </div>
          </div>

          {/* Remote Participants Tiles (if observers/co-interviewers join) */}
          {remoteParticipants
            ?.filter((p) => !p.identity.startsWith("agent-"))
            .map((p) => {
              const camPub = p.getTrackPublication(Track.Source.Camera);
              return (
                <div key={p.identity} className="video-tile remote-tile">
                  {camPub && camPub.isSubscribed && camPub.track ? (
                    <VideoTrack
                      trackRef={{ participant: p, publication: camPub, source: Track.Source.Camera }}
                      className="video-feed"
                    />
                  ) : (
                    <div className="avatar-fallback">
                      <div className="avatar-circle">
                        {(p.name || p.identity).charAt(0).toUpperCase()}
                      </div>
                      <span className="camera-off-label">Camera Off</span>
                    </div>
                  )}
                  <div className="tile-nameplate">
                    <div className="nameplate-info">
                      <span className="participant-name">{p.name || p.identity}</span>
                      <span className="role-tag guest">Participant</span>
                    </div>
                  </div>
                </div>
              );
            })}
        </main>

        {/* Sidebar Panel */}
        {activeSideTab && (
          <aside className="zoom-sidebar">
            <div className="sidebar-header">
              <div className="sidebar-tabs">
                <button
                  className={`sidebar-tab-btn ${activeSideTab === "transcript" ? "active" : ""}`}
                  onClick={() => setActiveSideTab("transcript")}
                >
                  Transcript ({messages?.length || 0})
                </button>
                <button
                  className={`sidebar-tab-btn ${activeSideTab === "agenda" ? "active" : ""}`}
                  onClick={() => setActiveSideTab("agenda")}
                >
                  Questions ({config.questions.length})
                </button>
                <button
                  className={`sidebar-tab-btn ${activeSideTab === "participants" ? "active" : ""}`}
                  onClick={() => setActiveSideTab("participants")}
                >
                  People ({totalInCall})
                </button>
              </div>
              <button
                className="close-sidebar-btn"
                onClick={() => setActiveSideTab(null)}
                title="Close panel"
              >
                ✕
              </button>
            </div>

            <div className="sidebar-content">
              {/* TRANSCRIPT TAB */}
              {activeSideTab === "transcript" && (
                <div className="transcript-panel">
                  <div className="transcript-toolbar">
                    <div className="search-input-wrap">
                      <input
                        type="text"
                        placeholder="Search conversation…"
                        value={transcriptSearch}
                        onChange={(e) => setTranscriptSearch(e.target.value)}
                        className="transcript-search-input"
                      />
                      {transcriptSearch && (
                        <button className="clear-search" onClick={() => setTranscriptSearch("")}>✕</button>
                      )}
                    </div>
                    <button
                      className="copy-transcript-sm"
                      onClick={() => {
                        const fullText = (messages || [])
                          .map((m: any) => {
                            const isUser =
                              m.type === "userTranscript" ||
                              m.role === "user" ||
                              m.from?.identity === "candidate" ||
                              m.sender === "user";
                            const txt = m.message || m.content?.text || m.content || "";
                            return `${isUser ? config.candidateName : "AI Interviewer"}: ${txt}`;
                          })
                          .join("\n\n");
                        navigator.clipboard.writeText(fullText);
                        showToast("✓ Full Transcript Copied!");
                      }}
                      title="Copy full transcript to clipboard"
                    >
                      📋 Copy
                    </button>
                  </div>

                  <div className="messages-stream">
                    {!filteredMessages.length ? (
                      <div className="empty-state">
                        <div className="empty-icon">💬</div>
                        <p>
                          {transcriptSearch
                            ? "No matching messages found."
                            : "Real-time speech transcription will stream here automatically."}
                        </p>
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
                          <div className={`chat-bubble ${isUser ? "candidate" : "ai"}`} key={message.id || index}>
                            <div className="bubble-header">
                              <span className="bubble-speaker">
                                {isUser ? `👤 ${config.candidateName}` : "🤖 AI Interviewer"}
                              </span>
                              <span className="bubble-time">
                                {message.timestamp
                                  ? new Date(message.timestamp).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })
                                  : ""}
                              </span>
                            </div>
                            <div className="bubble-body">{typeof text === "string" ? text : String(text)}</div>
                          </div>
                        );
                      })
                    )}
                    <div ref={transcriptBottomRef} />
                  </div>
                </div>
              )}

              {/* QUESTIONS AGENDA TAB */}
              {activeSideTab === "agenda" && (
                <div className="agenda-panel">
                  <div className="agenda-intro">
                    <div className="agenda-progress-header">
                      <h4>Configured Questions</h4>
                      <span className="agenda-counter">
                        {currentQuestionIndex + 1} / {config.questions.length}
                      </span>
                    </div>
                    <p>The AI interviewer sequentially navigates each question below.</p>
                  </div>

                  <div className="agenda-list">
                    {config.questions.map((q, idx) => {
                      const isCurrent = idx === currentQuestionIndex;
                      const isPassed = idx < currentQuestionIndex;

                      return (
                        <div
                          className={`agenda-item ${isCurrent ? "current" : ""} ${isPassed ? "completed" : ""}`}
                          key={idx}
                        >
                          <div className="agenda-num">
                            {isPassed ? "✓" : idx + 1}
                          </div>
                          <div className="agenda-content">
                            <div className="agenda-status-tag">
                              {isCurrent ? "CURRENT QUESTION" : isPassed ? "ANSWERED" : `UPCOMING #${idx + 1}`}
                            </div>
                            <div className="agenda-text">{q}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* PARTICIPANTS TAB */}
              {activeSideTab === "participants" && (
                <div className="participants-panel">
                  <div className="participants-list">
                    <div className="participant-item">
                      <div className="p-avatar ai">🤖</div>
                      <div className="p-details">
                        <div className="p-name">AI Interviewer</div>
                        <div className="p-role">LiveKit Voice Agent · Host</div>
                      </div>
                      <div className="p-status green">Active</div>
                    </div>

                    <div className="participant-item">
                      <div className="p-avatar user">
                        {config.candidateName.charAt(0).toUpperCase()}
                      </div>
                      <div className="p-details">
                        <div className="p-name">{config.candidateName} (You)</div>
                        <div className="p-role">Candidate</div>
                      </div>
                      <div className="p-status">
                        {isMicMuted ? "Muted" : micAudioLevel > 15 ? "Speaking" : "Active"}
                      </div>
                    </div>

                    {remoteParticipants
                      ?.filter((p) => !p.identity.startsWith("agent-"))
                      .map((p) => (
                        <div className="participant-item" key={p.identity}>
                          <div className="p-avatar guest">
                            {(p.name || p.identity).charAt(0).toUpperCase()}
                          </div>
                          <div className="p-details">
                            <div className="p-name">{p.name || p.identity}</div>
                            <div className="p-role">Observer / Co-Host</div>
                          </div>
                          <div className="p-status green">Connected</div>
                        </div>
                      ))}
                  </div>

                  <div className="invite-box-sidebar">
                    <div className="invite-box-title">Share Room Access</div>
                    <p>Invite interviewers or observers with Code:</p>
                    <div className="invite-code-pill" onClick={handleCopyRoomId}>
                      <code>{config.roomId}</code>
                      <span>Copy</span>
                    </div>
                    <button className="button primary sm-btn full" onClick={handleCopyInvite}>
                      📋 Copy Shareable Link
                    </button>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Control Dock */}
      <footer className="zoom-dock">
        <div className="dock-group dock-left">
          {/* Mute Button */}
          <button
            className={`dock-btn ${isMicMuted ? "danger" : "active"}`}
            onClick={toggleMicrophone}
            title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
          >
            <div className="dock-icon">
              {isMicMuted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </div>
            <span>{isMicMuted ? "Unmute" : "Mute"}</span>
          </button>

          {/* Camera Button */}
          <button
            className={`dock-btn ${!isVideoEnabled ? "danger" : "active"}`}
            onClick={toggleCamera}
            title={isVideoEnabled ? "Turn Camera Off" : "Turn Camera On"}
          >
            <div className="dock-icon">
              {isVideoEnabled ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              )}
            </div>
            <span>{isVideoEnabled ? "Stop Video" : "Start Video"}</span>
          </button>
        </div>

        <div className="dock-group dock-center">
          {/* Recording Dock Pill Indicator */}
          <div className="dock-rec-indicator" title="Audio recording session active">
            <span className="dock-rec-dot" />
            <div className="dock-rec-labels">
              <span className="dock-rec-title">REC AUDIO</span>
              <span className="dock-rec-duration">{formatDuration(recordingDuration)}</span>
            </div>
          </div>

          {/* Screen Share */}
          <button
            className={`dock-btn ${isScreenSharing ? "sharing" : ""}`}
            onClick={toggleScreenShare}
            title="Share Screen"
          >
            <div className="dock-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
                <path d="M12 7v6M9 10l3-3 3 3" />
              </svg>
            </div>
            <span>{isScreenSharing ? "Stop Share" : "Share Screen"}</span>
          </button>

          {/* Transcript Panel Toggle */}
          <button
            className={`dock-btn ${activeSideTab === "transcript" ? "selected" : ""}`}
            onClick={() => setActiveSideTab(activeSideTab === "transcript" ? null : "transcript")}
            title="Toggle Live Transcript"
          >
            <div className="dock-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {messages?.length > 0 && <span className="dock-badge">{messages.length}</span>}
            </div>
            <span>Transcript</span>
          </button>

          {/* Agenda / Questions */}
          <button
            className={`dock-btn ${activeSideTab === "agenda" ? "selected" : ""}`}
            onClick={() => setActiveSideTab(activeSideTab === "agenda" ? null : "agenda")}
            title="Toggle Question Sequence"
          >
            <div className="dock-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </div>
            <span>Questions</span>
          </button>

          {/* Participants */}
          <button
            className={`dock-btn ${activeSideTab === "participants" ? "selected" : ""}`}
            onClick={() => setActiveSideTab(activeSideTab === "participants" ? null : "participants")}
            title="Toggle Participants"
          >
            <div className="dock-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span className="dock-badge">{totalInCall}</span>
            </div>
            <span>People ({totalInCall})</span>
          </button>

          {/* Share / Invite Link */}
          <button
            className="dock-btn invite"
            onClick={() => setIsInviteModalOpen(true)}
            title="Share Meeting Link & Room Code"
          >
            <div className="dock-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <span>Invite</span>
          </button>
        </div>

        <div className="dock-group dock-right">
          {/* End Call Button */}
          <button
            className="end-call-btn"
            disabled={isEnding}
            onClick={() => setShowEndConfirm(true)}
          >
            End Interview
          </button>
        </div>
      </footer>

      {/* End Interview Confirmation Modal */}
      {showEndConfirm && (
        <div className="modal-backdrop" onClick={() => setShowEndConfirm(false)}>
          <div className="modal-card confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>End Technical Interview?</h3>
              <button className="close-btn" onClick={() => setShowEndConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>
                Are you ready to complete this voice session? Your audio recording and complete transcript will be finalized and compiled into the report.
              </p>
              <div className="end-stats-preview">
                <div className="stat-item">
                  <span className="stat-lbl">Duration</span>
                  <span className="stat-val">{formatDuration(elapsed)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-lbl">Questions</span>
                  <span className="stat-val">{currentQuestionIndex + 1} / {config.questions.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-lbl">Transcript Exchanges</span>
                  <span className="stat-val">{messages?.length || 0}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer actions-row">
              <button className="button secondary" onClick={() => setShowEndConfirm(false)}>
                Continue Interview
              </button>
              <button className="button danger-btn" onClick={() => finishInterview("Completed")}>
                Yes, End & Save Report
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Modal */}
      {isInviteModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsInviteModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Invite Participants to Interview</h3>
              <button className="close-btn" onClick={() => setIsInviteModalOpen(false)}>✕</button>
            </div>

            <div className="modal-body">
              <p className="modal-desc">
                Share this Room Code or direct link with candidates, observers, or co-interviewers to join this live WebRTC room.
              </p>

              <div className="invite-field">
                <label>Room Code / Client ID</label>
                <div className="copy-field">
                  <input readOnly value={config.roomId} />
                  <button
                    className="button secondary"
                    onClick={handleCopyRoomId}
                  >
                    Copy Code
                  </button>
                </div>
              </div>

              <div className="invite-field">
                <label>Direct Join URL</label>
                <div className="copy-field">
                  <input readOnly value={shareableUrl} />
                  <button className="button primary" onClick={handleCopyInvite}>
                    Copy Link
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="button secondary full" onClick={() => setIsInviteModalOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Renderer for LiveKit remote streams */}
      <RoomAudioRenderer />
    </div>
  );
}

function LocalVideoPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn("Camera preview unavailable:", err);
      }
    }
    startCamera();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return <video ref={videoRef} autoPlay playsInline muted className="video-feed local-feed" />;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}
