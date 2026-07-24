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
    tokens: number | null;
    tokenSource:
      | "provider_reported"
      | "measured"
      | "estimated"
      | "mixed"
      | null;
  }>;
  evidence: Array<{
    claim: string;
    source: string;
    status: string;
    tone: "good" | "bad" | "warn";
    challenge: {
      status: "open" | "resolved";
      assessment: string | null;
      issue: string | null;
      resolution: string | null;
      disposition: string | null;
    } | null;
  }>;
  practiceFindings: Array<{
    dimensionKey: string;
    dimensionLabel: string;
    score: number;
    weight: number;
    practices: Array<{
      id: string;
      title: string;
    }>;
    measured: string;
    issue: string;
    action: string;
    tokenMechanism: string;
    maximumScoreHeadroom: number;
    headroomStatus: "maximum_not_projection";
  }>;
  recommendations: Array<{
    id: string;
    priority: string;
    title: string;
    description: string;
    problem: string | null;
    change: string | null;
    repositoryChanges: string[];
    practiceIds: string[];
    affectedDimensions: string[];
    tokenMechanism: string | null;
    validationChecks: string[];
    limitations: string[];
    evidence: Array<{
      claimId: string;
      assertion: string;
      path: string;
      startLine: number | null;
      endLine: number | null;
      verdict: string;
      method: string;
    }>;
    projectedPoints: number | null;
    projectionStatus: "modeled" | "unavailable";
    projectionReason: string;
    effort: string | null;
    effortReason: string | null;
    source: "evidence_linked_addendum" | "legacy_event";
  }>;
  tokenUsage: {
    overall: TokenBreakdown;
    byPhase: Array<
      TokenBreakdown & {
        phase:
          | "candidate_navigation"
          | "independent_validation"
          | "orchestration"
          | "deterministic_verification"
          | "report_generation";
      }
    >;
    candidateBudget: {
      usedTokens: number | null;
      targetTokens: number | null;
      hardLimitTokens: number | null;
      targetMultiple: number | null;
      hardLimitExceeded: boolean | null;
      efficiencyScore: number | null;
      eligible: boolean | null;
      scoreFormula: string;
      targetBasis: "run_declared" | "rubric_default" | "unavailable";
      measurementScope: string;
      measurementMethod: string | null;
      isForecast: false;
    };
    monetaryCost: {
      status: "unavailable";
      amount: null;
      currency: null;
      reason: string;
    };
  };
  scoreBreakdown: {
    dimensions: Array<{
      key: string;
      label: string;
      score: number;
      weight: number;
    }>;
    adequacyPassed: boolean | null;
  };
  metrics: {
    navigability: number | null;
    reliability: number | null;
    candidateTokens: number | null;
    candidateTokenSource:
      | "provider_reported"
      | "measured"
      | "estimated"
      | "mixed"
      | null;
    claimsChallenged: number;
    totalClaims: number;
    openChallenges: number;
    candidateConfidence: number;
    verifiedAccuracy: number;
  };
  runCount: number;
};

type TokenSource =
  | "provider_reported"
  | "measured"
  | "estimated"
  | "mixed"
  | null;

type TokenBreakdown = {
  totalTokens: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  uncachedInputTokens: number | null;
  outputTokens: number | null;
  unclassifiedTokens: number | null;
  cacheCreationTokens: number | null;
  source: TokenSource;
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

async function readRunHistory(signal?: AbortSignal) {
  const response = await fetch(`${serviceUrl}/api/runs/summaries`, {
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Waymark service returned ${response.status}.`);
  }

  return (await response.json()) as WaymarkRunSnapshot[];
}

export function useWaymarkLive() {
  const [snapshot, setSnapshot] = useState<WaymarkRunSnapshot | null>(null);
  const [history, setHistory] = useState<WaymarkRunSnapshot[]>([]);
  const [connection, setConnection] =
    useState<ConnectionState>("connecting");

  useEffect(() => {
    const controller = new AbortController();
    let eventSource: EventSource | null = null;
    let refreshSequence = 0;

    const refresh = async () => {
      const sequence = ++refreshSequence;
      try {
        const [next, runs] = await Promise.all([
          readLatestRun(controller.signal),
          readRunHistory(controller.signal),
        ]);
        if (sequence === refreshSequence) {
          setSnapshot(next);
          setHistory(runs);
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
    history,
    connection,
  };
}
