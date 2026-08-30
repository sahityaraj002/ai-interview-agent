import { useEffect, useRef, useState } from "react";
import {
  BarVisualizer,
  RoomAudioRenderer,
  useAgent,
  useConnectionState,
  useLocalParticipant,
  useSessionMessages,
  VideoTrack,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, type Room, type RemoteTrack } from "livekit-client";
import type { InterviewConfig } from "../App";
import type { InterviewResultData } from "./InterviewResult";

type SessionLike = {
  room?: Room;
  start: (options?: any) => Promise<void> | void;
  end: () => Promise<void> | void;
};

type RecorderState = {
  recorder: MediaRecorder;
  chunks: Blob[];
  audioContext: AudioContext;
  micStream: MediaStream;
  sourceNodes: AudioNode[];
  remoteSources: Map<string, AudioNode>;
  onTrackSubscribed: (track: RemoteTrack) => void;
  onTrackUnsubscribed: (track: RemoteTrack) => void;
  hasVideo: boolean;
};

// Waits briefly for the candidate's camera track to actually be published before recording
// starts, so the video isn't missing its first few seconds (or missing entirely) just
// because publishing hadn't finished yet when startRecording() ran.
function waitForLocalCameraTrack(room: Room, timeoutMs = 4000): Promise<MediaStreamTrack | null> {
  const existing = room.localParticipant.getTrackPublication(Track.Source.Camera);
  if (existing?.track?.mediaStreamTrack) return Promise.resolve(existing.track.mediaStreamTrack);

  return new Promise((resolve) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      room.off(RoomEvent.LocalTrackPublished, onPublished);
    };
    const onPublished = (publication: any) => {
      if (publication.source === Track.Source.Camera && publication.track?.mediaStreamTrack) {
        cleanup();
        resolve(publication.track.mediaStreamTrack);
      }
    };
    const timer = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    room.on(RoomEvent.LocalTrackPublished, onPublished);
  });
}

// States in which the agent has actually joined and is doing something (as opposed to
// still connecting, or having finished/failed). Used to tell "the interview genuinely
// finished" apart from "the agent never showed up in the first place".
const AGENT_ACTIVE_STATES = new Set([
  "pre-connect-buffering",
  "initializing",
  "idle",
  "listening",
  "thinking",
  "speaking",
]);

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
  const agent = useAgent(session as any);
  const { messages } = useSessionMessages(session as any);
  const { localParticipant, cameraTrack, isCameraEnabled, lastCameraError } = useLocalParticipant({
    room: session.room,
  });

  const [elapsed, setElapsed] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [micAudioLevel, setMicAudioLevel] = useState(0);
  const [isEnding, setIsEnding] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // Refs, not state: these back logic that must always see the latest value the instant
  // it's needed (a Date.now() timestamp, an event handler fired from outside React, a
  // guard against double-completion) rather than whatever was captured when a closure was
  // created on some earlier render.
  const startedAtRef = useRef<number | null>(null);
  const endingRef = useRef(false);
  const hasAgentConnectedRef = useRef(false);
  const recorderRef = useRef<RecorderState | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const finishInterviewRef = useRef<((status: "Completed" | "Incomplete") => Promise<void>) | undefined>(undefined);

  // 1. Start the session + recording once.
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Camera runs for the whole interview, start to end; a failed camera publish
        // (e.g. permission denied) surfaces separately via lastCameraError below and
        // doesn't block the voice interview itself.
        await session.start({ tracks: { microphone: { enabled: true }, camera: { enabled: true } } });
        if (!mounted) return;
        startedAtRef.current = Date.now();
        await startRecording();
      } catch (error: any) {
        console.error("Failed to start interview session:", error);
        if (mounted) {
          setStartError(
            error?.name === "NotAllowedError"
              ? "Microphone access was denied. Please allow microphone access and try again."
              : error?.message || "Could not connect to the interview room."
          );
        }
      }
    })();

    return () => {
      mounted = false;
      stopRecording();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Single elapsed-time clock, ticking from the real start timestamp.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 3. Auto-scroll transcript.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 4. Candidate mic level meter, for the "speaking" indicator.
  useEffect(() => {
    if (!micStreamRef.current || isMicMuted) {
      setMicAudioLevel(0);
      return;
    }

    const stream = micStreamRef.current;
    let audioCtx: AudioContext | null = null;
    let raf = 0;
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        setMicAudioLevel(Math.min(100, Math.round((avg / 100) * 100)));
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (err) {
      console.warn("Mic level meter unavailable:", err);
    }

    return () => {
      cancelAnimationFrame(raf);
      audioCtx?.close().catch(() => {});
    };
  }, [isMicMuted, isRecording]);

  async function finishInterview(status: "Completed" | "Incomplete") {
    if (endingRef.current) return;
    endingRef.current = true;
    setIsEnding(true);
    setShowEndConfirm(false);

    try {
      await session.end();
    } catch (error) {
      console.error("Session end error:", error);
    }

    const recording = await stopRecording();
    const durationSeconds = startedAtRef.current
      ? Math.floor((Date.now() - startedAtRef.current) / 1000)
      : elapsed;

    onComplete({
      candidateName: config.candidateName,
      jobTitle: config.jobTitle,
      status,
      durationSeconds,
      messages: Array.isArray(messages) ? [...messages] : [],
      recordingUrl: recording.url,
      hasVideo: recording.hasVideo,
    });
  }
  finishInterviewRef.current = finishInterview;

  // 5. Candidate's own connection drops (network issue, tab closed, or our own
  // session.end() from finishInterview) -> fires exactly once, always with the latest
  // finishInterview via the ref, never a stale closure.
  useEffect(() => {
    const room = session.room;
    if (!room) return;
    const onDisconnected = () => {
      finishInterviewRef.current?.("Incomplete");
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
    };
  }, [session.room]);

  // 6. Auto-completion: the agent leaves the room (ctx.room.disconnect() on the agent
  // side, see agent.py) once the interview is done. useAgent() reports that as
  // state === "disconnected" with isFinished === true. Only trust it once the agent has
  // actually been seen active - otherwise a dispatch failure would look the same.
  useEffect(() => {
    if (AGENT_ACTIVE_STATES.has(agent.state)) {
      hasAgentConnectedRef.current = true;
    }
    if (agent.state === "disconnected" && hasAgentConnectedRef.current) {
      finishInterviewRef.current?.("Completed");
    }
  }, [agent.state]);

  const agentFailed = agent.state === "failed" && !hasAgentConnectedRef.current;

  async function toggleMicrophone() {
    if (!session.room) return;
    const nextMuted = !isMicMuted;
    try {
      await session.room.localParticipant.setMicrophoneEnabled(!nextMuted);
      setIsMicMuted(nextMuted);
    } catch (err) {
      console.error("Error toggling microphone:", err);
    }
  }

  async function toggleCamera() {
    if (!session.room) return;
    try {
      await session.room.localParticipant.setCameraEnabled(!isCameraEnabled);
    } catch (err) {
      console.error("Error toggling camera:", err);
    }
  }

  // Mixes the candidate's mic with every remote (agent) audio track, plus the candidate's
  // own camera video (if published), into one recording. Audio mixing is wired directly off
  // LiveKit's track-subscription events rather than polling the DOM for <audio> elements;
  // video reuses the same camera track already being published to the room, rather than
  // opening the camera a second time.
  async function startRecording() {
    const room = session.room;
    if (!room) return;

    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setRecordingError("This browser does not support recording.");
        return;
      }

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = micStream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const destination = audioContext.createMediaStreamDestination();
      const sourceNodes: AudioNode[] = [];
      const remoteSources = new Map<string, AudioNode>();

      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);
      sourceNodes.push(micSource);

      const attach = (track: RemoteTrack) => {
        if (track.kind !== Track.Kind.Audio || !track.mediaStreamTrack) return;
        const key = track.sid || track.mediaStreamTrack.id;
        if (remoteSources.has(key)) return;
        try {
          const remoteStream = new MediaStream([track.mediaStreamTrack]);
          const source = audioContext.createMediaStreamSource(remoteStream);
          source.connect(destination);
          remoteSources.set(key, source);
        } catch (err) {
          console.warn("Could not mix a remote audio track into the recording:", err);
        }
      };
      const detach = (track: RemoteTrack) => {
        const key = track.sid || track.mediaStreamTrack?.id;
        const source = key ? remoteSources.get(key) : undefined;
        if (source) {
          try {
            source.disconnect();
          } catch {
            /* already disconnected */
          }
          remoteSources.delete(key!);
        }
      };

      room.remoteParticipants.forEach((participant) => {
        participant.audioTrackPublications.forEach((pub) => {
          if (pub.track) attach(pub.track);
        });
      });
      room.on(RoomEvent.TrackSubscribed, attach);
      room.on(RoomEvent.TrackUnsubscribed, detach);

      const cameraTrack = await waitForLocalCameraTrack(room);
      const recordingStream = new MediaStream([
        ...(cameraTrack ? [cameraTrack] : []),
        ...destination.stream.getAudioTracks(),
      ]);

      const candidateMimeTypes = cameraTrack
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["audio/webm;codecs=opus", "audio/webm"];
      const mimeType =
        candidateMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ||
        (cameraTrack ? "video/webm" : "audio/webm");

      const recorder = new MediaRecorder(recordingStream, { mimeType });
      const state: RecorderState = {
        recorder,
        chunks: [],
        audioContext,
        micStream,
        sourceNodes,
        remoteSources,
        onTrackSubscribed: attach,
        onTrackUnsubscribed: detach,
        hasVideo: Boolean(cameraTrack),
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) state.chunks.push(event.data);
      };

      recorder.start(1000);
      recorderRef.current = state;
      setIsRecording(true);
    } catch (error: any) {
      console.error("Recording setup failed:", error);
      setRecordingError(error?.message || "Recording could not be started.");
    }
  }

  async function stopRecording(): Promise<{ url: string | null; hasVideo: boolean }> {
    setIsRecording(false);
    const state = recorderRef.current;
    const room = session.room;
    if (!state) return { url: null, hasVideo: false };
    recorderRef.current = null;

    room?.off(RoomEvent.TrackSubscribed, state.onTrackSubscribed);
    room?.off(RoomEvent.TrackUnsubscribed, state.onTrackUnsubscribed);

    const url = await new Promise<string | null>((resolve) => {
      const finish = () => {
        try {
          const blob = new Blob(state.chunks, { type: state.recorder.mimeType || "video/webm" });
          resolve(URL.createObjectURL(blob));
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

    [...state.sourceNodes, ...state.remoteSources.values()].forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    state.micStream.getTracks().forEach((track) => track.stop());
    await state.audioContext.close().catch(() => {});

    return { url, hasVideo: state.hasVideo };
  }

  const statusLabel =
    agent.state === "speaking"
      ? "AI Interviewer Speaking"
      : agent.state === "thinking"
      ? "AI Processing Response…"
      : agent.state === "failed"
      ? "AI Interviewer Failed to Join"
      : agent.state === "disconnected"
      ? "Interview Finished"
      : hasAgentConnectedRef.current
      ? "AI Listening"
      : "Connecting AI Interviewer…";

  if (startError) {
    return (
      <div className="room-app room-start-error">
        <div className="modal-card">
          <div className="modal-header">
            <h3>Couldn't Start the Interview</h3>
          </div>
          <div className="modal-body">
            <p>{startError}</p>
          </div>
          <div className="modal-footer actions-row">
            <button className="button primary" onClick={onCancel}>
              Back to Setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="room-app">
      <header className="room-header">
        <div className="room-header-left">
          <h1 className="room-title">{config.jobTitle}</h1>
          <span className="room-candidate-badge">👤 {config.candidateName}</span>
        </div>
        <div className="room-header-right">
          <div className={`rec-badge ${isRecording ? "active" : "standby"}`} title={recordingError || "Session recording"}>
            <span className="rec-dot" />
            <span>{isRecording ? "REC" : "REC unavailable"}</span>
          </div>
          <div className="header-timer" title="Interview duration">
            {formatDuration(elapsed)}
          </div>
          <div className="connection-pill">
            <span className={`status-dot ${connection === ConnectionState.Connected ? "live" : ""}`} />
            {connection === ConnectionState.Connected ? "Connected" : connection}
          </div>
        </div>
      </header>

      {agentFailed && (
        <div className="agent-failed-banner">
          <strong>The AI interviewer could not join the room.</strong>
          <span>Check that the agent worker is running, then try again.</span>
          <button className="button secondary sm-btn" onClick={onCancel}>
            Back to Setup
          </button>
        </div>
      )}

      {lastCameraError && (
        <div className="agent-failed-banner">
          <strong>Camera unavailable.</strong>
          <span>Continuing as a voice-only interview - {lastCameraError.message}</span>
        </div>
      )}

      <main className="room-body">
        <section className="ai-panel">
          <div className={`agent-orb ${agent.state}`}>
            <div className="orb-ring ring-1" />
            <div className="orb-ring ring-2" />
            <div className="orb-core" />
          </div>
          <span className={`ai-state-pill ${agent.state}`}>{statusLabel}</span>
          <div className="ai-visualizer">
            <BarVisualizer
              state={agent.state as any}
              trackRef={(agent as any).microphoneTrack}
              barCount={20}
              options={{ minHeight: 8, maxHeight: 56 }}
            />
          </div>

          <div className="candidate-pip">
            {isCameraEnabled && cameraTrack?.track ? (
              <VideoTrack
                trackRef={{ participant: localParticipant, publication: cameraTrack, source: Track.Source.Camera }}
                className="candidate-pip-video"
              />
            ) : (
              <div className="candidate-pip-fallback">{config.candidateName.charAt(0).toUpperCase()}</div>
            )}
            <span className="candidate-pip-label">{config.candidateName}</span>
          </div>
        </section>

        <section className="transcript-panel">
          <div className="transcript-header">
            <h2>Conversation</h2>
            <span className="transcript-count">{messages?.length || 0} exchanges</span>
          </div>
          <div className="messages-stream">
            {!messages || messages.length === 0 ? (
              <div className="empty-state">
                <p>The live transcript will appear here as the interview progresses.</p>
              </div>
            ) : (
              messages.map((message: any, index: number) => {
                const isCandidate = message.type === "userTranscript";
                const text = message.message ?? message.content?.text ?? message.content ?? "";
                return (
                  <div className={`chat-bubble ${isCandidate ? "candidate" : "ai"}`} key={message.id || index}>
                    <div className="bubble-header">
                      <span className="bubble-speaker">
                        {isCandidate ? `👤 ${config.candidateName}` : "🤖 AI Interviewer"}
                      </span>
                    </div>
                    <div className="bubble-body">{typeof text === "string" ? text : String(text)}</div>
                  </div>
                );
              })
            )}
            <div ref={transcriptEndRef} />
          </div>
        </section>
      </main>

      <footer className="room-dock">
        <button
          className={`dock-btn ${isMicMuted ? "danger" : "active"} ${!isMicMuted && micAudioLevel > 15 ? "speaking" : ""}`}
          onClick={toggleMicrophone}
          title={isMicMuted ? "Unmute Microphone" : "Mute Microphone"}
        >
          {isMicMuted ? "🔇 Unmute" : "🎙️ Mute"}
        </button>

        <button
          className={`dock-btn ${isCameraEnabled ? "active" : "danger"}`}
          onClick={toggleCamera}
          title={isCameraEnabled ? "Turn Camera Off" : "Turn Camera On"}
        >
          {isCameraEnabled ? "📷 Camera On" : "🚫 Camera Off"}
        </button>

        <button className="end-call-btn" disabled={isEnding} onClick={() => setShowEndConfirm(true)}>
          End Interview
        </button>
      </footer>

      {showEndConfirm && (
        <div className="modal-backdrop" onClick={() => setShowEndConfirm(false)}>
          <div className="modal-card confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>End the Interview?</h3>
              <button className="close-btn" onClick={() => setShowEndConfirm(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p>Your recording and transcript so far will be saved to the result screen.</p>
              <div className="end-stats-preview">
                <div className="stat-item">
                  <span className="stat-lbl">Duration</span>
                  <span className="stat-val">{formatDuration(elapsed)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-lbl">Exchanges</span>
                  <span className="stat-val">{messages?.length || 0}</span>
                </div>
              </div>
            </div>
            <div className="modal-footer actions-row">
              <button className="button secondary" onClick={() => setShowEndConfirm(false)}>
                Continue Interview
              </button>
              <button className="button danger-btn" onClick={() => finishInterview("Completed")}>
                Yes, End Interview
              </button>
            </div>
          </div>
        </div>
      )}

      <RoomAudioRenderer />
    </div>
  );
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}
