import { useMemo, useState } from "react";
import { TokenSource } from "livekit-client";
import {
  SessionProvider,
  useSession,
} from "@livekit/components-react";
import CreateInterview from "./components/CreateInterview";
import JoinInterview from "./components/JoinInterview";
import InterviewRoom from "./components/InterviewRoom";
import InterviewResult, {
  type InterviewResultData,
} from "./components/InterviewResult";
import { TOKEN_ENDPOINT } from "./api";

export type InterviewConfig = {
  roomId: string;
  candidateName: string;
  jobTitle: string;
  questions: string[];
};

function getRoomIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("room");
}

export default function App() {
  const [config, setConfig] = useState<InterviewConfig | null>(null);
  const [result, setResult] = useState<InterviewResultData | null>(null);
  const [roomIdFromUrl] = useState<string | null>(getRoomIdFromUrl);

  const tokenSource = useMemo(() => TokenSource.endpoint(TOKEN_ENDPOINT), []);

  if (result) {
    return (
      <InterviewResult
        result={result}
        onNewInterview={() => {
          setResult(null);
          setConfig(null);
          if (window.history.replaceState) {
            const url = window.location.origin + window.location.pathname;
            window.history.replaceState({}, "", url);
          }
        }}
      />
    );
  }

  if (!config) {
    // A shared interview link (?room=...) always leads to the candidate join screen -
    // never to the recruiter's create/configure form.
    return roomIdFromUrl ? (
      <JoinInterview roomId={roomIdFromUrl} onJoin={setConfig} />
    ) : (
      <CreateInterview />
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
    participantName: config.candidateName,
    // Only the candidate's own identity - jobTitle/questions already live in the room's
    // metadata, set by the recruiter when the interview was created.
    participantMetadata: JSON.stringify({ candidateName: config.candidateName }),
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
