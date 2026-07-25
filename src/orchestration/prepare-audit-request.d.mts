import type { AuditTokenBudgets } from "./types";
import type { ReasoningEffort } from "./provider-capabilities.mjs";

export interface PreparedAuditParticipant {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

interface PreparedAuditRequestBase {
  targetRepositoryPath: string;
  journalPath: string;
  serviceUrl: string;
  task: string;
}

export interface PreparedGeneralAuditRequest
  extends PreparedAuditRequestBase {
  auditMode: "general";
  participants: {
    auditor: PreparedAuditParticipant;
  };
  tokenPolicy: "unbounded_by_waymark";
  softUsageNoticeTokens?: number | null;
}

export interface PreparedBenchmarkAuditRequest
  extends PreparedAuditRequestBase {
  auditMode: "task_specific" | "system_explanation";
  participants: Record<
    "candidate" | "independent" | "orchestrator",
    PreparedAuditParticipant
  >;
  tokenBudgets: AuditTokenBudgets;
}

export type PreparedAuditRequest =
  | PreparedGeneralAuditRequest
  | PreparedBenchmarkAuditRequest;

export function validatePreparedAuditRequest(
  input: PreparedAuditRequest,
): (PreparedAuditRequest & { name: string }) & {
  tokenPolicy: "unbounded_by_waymark" | "hard_phase_budgets";
};

export function inferAuditName(input: {
  auditMode: PreparedAuditRequest["auditMode"];
  task: string;
}): string;

export function buildPreparedAuditRequest(
  input: PreparedAuditRequest,
): string;
