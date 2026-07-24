import type {
  AuditAssignment,
  AuditExecutionPolicy,
  AuditMode,
  AuditTokenBudgets,
  OrchestrationCapabilities,
  RepositoryTarget,
} from "./types";
import type { JsonObject, RunParticipantInput } from "../domain/audit";

export const READ_ONLY_CONSTRAINTS: readonly string[];
export const FRESH_EXECUTION_POLICY: Readonly<AuditExecutionPolicy>;
export const DEFAULT_AUDIT_TOKEN_BUDGETS: Readonly<AuditTokenBudgets>;

export interface AssignmentTemplateInput {
  runId: string;
  target: RepositoryTarget;
  auditMode?: AuditMode;
  task: string;
  candidate: RunParticipantInput;
  capabilities: OrchestrationCapabilities;
  tokenBudgets?: AuditTokenBudgets;
  reasoningEfforts?: {
    candidate?: AuditAssignment["reasoningEffort"];
    independent?: AuditAssignment["reasoningEffort"];
  };
  shellCommandBudgets?: {
    candidate?: number;
    independent?: number;
  };
  additionalConstraints?: {
    candidate?: readonly string[];
    independent?: readonly string[];
  };
}

export interface OrchestratorAssignmentTemplateInput {
  runId: string;
  target: RepositoryTarget;
  auditMode?: AuditMode;
  task: string;
  orchestrator: RunParticipantInput;
  tokenBudgets?: AuditTokenBudgets;
  reasoningEffort?: AuditAssignment["reasoningEffort"];
  shellCommandBudget?: number;
  additionalConstraints?: readonly string[];
  context: JsonObject;
}

export function resolveAuditTokenBudgets(
  value: unknown,
): Readonly<AuditTokenBudgets>;

export function createInvestigationAssignments(
  input: AssignmentTemplateInput,
): readonly AuditAssignment[];
export function createOrchestratorAssignment(
  input: OrchestratorAssignmentTemplateInput,
): AuditAssignment;

export function renderAssignmentPrompt(assignment: AuditAssignment): string;
