import { useEffect, useMemo, useState } from "react";
import { TokenSource } from "livekit-client";
import {
  SessionProvider,
  useSession,
} from "@livekit/components-react";
import InterviewSetup from "./components/InterviewSetup";
import InterviewRoom from "./components/InterviewRoom";
import InterviewResult, {
  type InterviewResultData,
} from "./components/InterviewResult";

export type InterviewConfig = {
  roomId: string;
  candidateName: string;
  jobTitle: string;
  questions: string[];
  role?: "host" | "candidate" | "interviewer" | "guest";
};

const TOKEN_ENDPOINT =
  import.meta.env.VITE_TOKEN_ENDPOINT || "/api/getToken";


export default function App() {
  const [config, setConfig] = useState<InterviewConfig | null>(null);
  const [result, setResult] = useState<InterviewResultData | null>(null);
  const [initialRoomId, setInitialRoomId] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get("room") || params.get("clientId") || params.get("roomId");
    if (roomParam) {
      setInitialRoomId(roomParam);
    }
  }, []);

  const tokenSource = useMemo(
    () => TokenSource.endpoint(TOKEN_ENDPOINT),
    []
  );

  if (result) {
    return (
      <InterviewResult
        result={result}
        onNewInterview={() => {
          setResult(null);
          setConfig(null);
          // clear query param without reload
          if (window.history.replaceState) {
            const url = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: url }, "", url);
          }
        }}
      />
    );
  }

  if (!config) {
    return (
      <InterviewSetup
        initialRoomId={initialRoomId}
        onStart={(nextConfig) => {
          setConfig(nextConfig);
        }}
      />
    );
  }

  return (
    <SessionShell
      tokenSource={tokenSource}
      config={config}
      onComplete={(data) => setResult(data)}
      onCancel={() => setConfig(null)}
    />
  );
}

function SessionShell({
  tokenSource,
  config,
  onComplete,
  onCancel,
}: {
  tokenSource: ReturnType<typeof TokenSource.endpoint>;
  config: InterviewConfig;
  onComplete: (data: InterviewResultData) => void;
  onCancel: () => void;
}) {
  const session = useSession(tokenSource, {
    roomName: config.roomId,
    agentName: "ai-interviewer",
    participantName: config.candidateName,
    participantMetadata: JSON.stringify({
      candidateName: config.candidateName,
      jobTitle: config.jobTitle,
      questions: config.questions,
      roomId: config.roomId,
      role: config.role || "candidate",
    }),
  });

  return (
    <SessionProvider session={session}>
      <InterviewRoom
        session={session}
        config={config}
        onComplete={onComplete}
        onCancel={onCancel}
      />
    </SessionProvider>
  );
}
