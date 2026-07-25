import type { AuditStore } from "../persistence/index.mjs";
import type {
  AuditEvent,
  JsonObject,
  JsonValue,
  RunParticipantInput,
} from "../domain/audit";
import type { AuditAssignment } from "./types";

export interface ProcessLaunchSpec {
  command: string;
  arguments: string[];
  cwd: string;
  stdin?: string;
  environment?: NodeJS.ProcessEnv;
}

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  totalTokens: number;
}

export interface NormalizedProviderEvent {
  type: string;
  payload: JsonObject;
}

export interface ProcessProviderAdapter {
  id: string;
  requiresFinalOutput?: boolean;
  usageEnforcement?: "live" | "post_completion";
  supports(participant: RunParticipantInput): boolean;
  createLaunchSpec(
    assignment: AuditAssignment,
    prompt: string,
  ): ProcessLaunchSpec;
  createResumeLaunchSpec?(
    assignment: AuditAssignment,
    prompt: string,
    providerSessionId: string,
  ): ProcessLaunchSpec;
  attachCheckpointTransport?(
    launch: ProcessLaunchSpec,
    transport: {
      runId: string;
      auditorId: string;
      endpoint: string;
      authorization: string;
    },
  ): ProcessLaunchSpec;
  extractUsage(event: unknown): ProviderUsage | null | undefined;
  extractFinalOutput(event: unknown): JsonValue | undefined;
  normalizeEvent(event: unknown): NormalizedProviderEvent | null | undefined;
}

export class OrchestrationError extends Error {
  code: string;
  details?: unknown;
}

export function runInvestigationPhase(input: {
  store: AuditStore;
  runId: string;
  adapters: ProcessProviderAdapter[];
  signal?: AbortSignal;
  killGraceMs?: number;
  budgetWrapUpTimeoutMs?: number;
}): Promise<{
  runId: string;
  status: "active" | "failed" | "cancelled";
  results: Array<{
    role: "candidate" | "independent";
    status: string;
  }>;
  orchestration?: {
    role: "orchestrator";
    status: string;
  };
}>;

export function finalizeDraftRecommendations(input: {
  store: AuditStore;
  runId: string;
}): AuditEvent;
