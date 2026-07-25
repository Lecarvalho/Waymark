import type { AuditTokenBudgets } from "./types";
import type { ReasoningEffort } from "./provider-capabilities.mjs";

export interface PreparedAuditParticipant {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface PreparedAuditRequest {
  targetRepositoryPath: string;
  journalPath: string;
  serviceUrl: string;
  auditMode: "general" | "task_specific" | "system_explanation";
  task: string;
  participants: Record<
    "candidate" | "independent" | "orchestrator",
    PreparedAuditParticipant
  >;
  tokenBudgets: AuditTokenBudgets;
}

export function validatePreparedAuditRequest(
  input: PreparedAuditRequest,
): PreparedAuditRequest & { name: string };

export function inferAuditName(input: {
  auditMode: PreparedAuditRequest["auditMode"];
  task: string;
}): string;

export function buildPreparedAuditRequest(
  input: PreparedAuditRequest,
): string;
