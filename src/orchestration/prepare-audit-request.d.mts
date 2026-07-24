import type { AuditTokenBudgets } from "./types";
import type { ReasoningEffort } from "./provider-capabilities.mjs";

export interface PreparedAuditParticipant {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface PreparedAuditRequest {
  targetRepositoryPath: string;
  auditMode: "general" | "task_specific";
  name: string;
  task: string;
  participants: Record<
    "candidate" | "independent" | "orchestrator",
    PreparedAuditParticipant
  >;
  tokenBudgets: AuditTokenBudgets;
}

export const GENERAL_AUDIT_TASK_SUITE: {
  readonly id: "waymark-general-navigation";
  readonly version: "1.0.0";
  readonly tasks: readonly string[];
};

export function validatePreparedAuditRequest(
  input: PreparedAuditRequest,
): PreparedAuditRequest;

export function buildPreparedAuditRequest(
  input: PreparedAuditRequest,
): string;
