"use client";

import { useEffect, useState } from "react";

export type WaymarkRunSnapshot = {
  id: string;
  status: "running" | "completed" | "failed";
  repository: {
    name: string;
    path: string;
    commit: string;
  };
  task: string;
  phase: string;
  progress: number;
  startedAt: string;
  agentHost: string;
  activeAgentCount: number;
  latestEvent: string;
  models: {
    candidate: string;
    orchestrator: string;
  };
  participants: Array<{
    role: string;
    provider: string;
    model: string;
    status: string;
    tokens: number;
  }>;
  evidence: Array<{
    claim: string;
    source: string;
    status: string;
    tone: "good" | "bad" | "warn";
  }>;
  recommendations: Array<{
    priority: string;
    title: string;
    description: string;
    gain: string;
    cost: string;
  }>;
  metrics: {
    navigability: number | null;
    reliability: number | null;
    candidateTokens: number;
    claimsChallenged: number;
    totalClaims: number;
    openChallenges: number;
    candidateConfidence: number;
    verifiedAccuracy: number;
  };
  runCount: number;
};

type ConnectionState = "connecting" | "live" | "offline";

const serviceUrl =
  process.env.NEXT_PUBLIC_WAYMARK_SERVICE_URL ?? "http://127.0.0.1:4318";

async function readLatestRun(signal?: AbortSignal) {
  const response = await fetch(`${serviceUrl}/api/runs/latest`, {
    cache: "no-store",
    signal,
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Waymark service returned ${response.status}.`);
  }

  return (await response.json()) as WaymarkRunSnapshot;
}

export function useWaymarkLive() {
  const [snapshot, setSnapshot] = useState<WaymarkRunSnapshot | null>(null);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");

  useEffect(() => {
    const controller = new AbortController();
    let eventSource: EventSource | null = null;
    let refreshSequence = 0;

    const refresh = async () => {
      const sequence = ++refreshSequence;
      try {
        const next = await readLatestRun(controller.signal);
        if (sequence === refreshSequence) {
          setSnapshot(next);
          setConnection("live");
        }
      } catch {
        if (!controller.signal.aborted && sequence === refreshSequence) {
          setConnection("offline");
        }
      }
    };

    void refresh();

    eventSource = new EventSource(`${serviceUrl}/api/events`);
    eventSource.onopen = () => setConnection("live");
    eventSource.addEventListener("ready", () => void refresh());
    eventSource.addEventListener("changed", () => void refresh());
    eventSource.addEventListener("heartbeat", () => setConnection("live"));
    eventSource.onerror = () => setConnection("offline");

    return () => {
      controller.abort();
      eventSource?.close();
    };
  }, []);

  return {
    snapshot,
    connection,
    isLiveData: snapshot !== null,
  };
}
