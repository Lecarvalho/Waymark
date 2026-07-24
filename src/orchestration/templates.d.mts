import type {
  AuditAssignment,
  AuditExecutionPolicy,
  AuditTokenBudgets,
  OrchestrationCapabilities,
  RepositoryTarget,
} from "./types";
import type { RunParticipantInput } from "../domain/audit";

export const READ_ONLY_CONSTRAINTS: readonly string[];
export const FRESH_EXECUTION_POLICY: Readonly<AuditExecutionPolicy>;
export const DEFAULT_AUDIT_TOKEN_BUDGETS: Readonly<AuditTokenBudgets>;

export interface AssignmentTemplateInput {
  runId: string;
  target: RepositoryTarget;
  task: string;
  candidate: RunParticipantInput;
  capabilities: OrchestrationCapabilities;
  tokenBudgets?: AuditTokenBudgets;
}

export function resolveAuditTokenBudgets(
  value: unknown,
): Readonly<AuditTokenBudgets>;

export function createInvestigationAssignments(
  input: AssignmentTemplateInput,
): readonly AuditAssignment[];

export function renderAssignmentPrompt(assignment: AuditAssignment): string;
