import type { AuditStore } from "../persistence/index.mjs";
import type { ProcessProviderAdapter } from "./process-runner.mjs";

export class GeneralAuditRunnerError extends Error {
  code: string;
  details?: unknown;
}

export function runGeneralAudit(input: {
  store: AuditStore;
  runId: string;
  adapters: ProcessProviderAdapter[];
  signal?: AbortSignal;
  killGraceMs?: number;
  softUsageNoticeTokens?: number | number[] | null;
  contextContinuationPercent?: number;
  maxContinuations?: number;
  noProgressPolicy?: {
    identicalSearchLimit?: number;
    repeatedFailureLimit?: number;
    toolEventsWithoutEvidenceLimit?: number;
  };
}): Promise<{
  runId: string;
  status: "completed" | "partial" | "failed" | "cancelled";
  attempts: Array<Record<string, unknown>>;
}>;
