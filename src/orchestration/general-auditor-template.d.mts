import type { AuditRun, RunParticipant } from "../domain/audit";
import type { GeneralAuditReadModel } from "../domain/general-audit.mjs";

export interface GeneralAuditorAssignment {
  runId: string;
  role: "auditor";
  participant: RunParticipant;
  reasoningEffort?: string;
  target: {
    path: string;
    identity: string;
    commitSha: string;
    readOnly: true;
  };
  auditMode: "general";
  task: string;
  executionPolicy: {
    isolation: "fresh_process";
    contextPolicy: "assignment_only";
    measurementScope: "role_process_only";
  };
  toolPolicy: Record<string, unknown>;
  continuation: ReturnType<typeof projectGeneralContinuation> | null;
}

export function createGeneralAuditorAssignment(input: {
  run: AuditRun;
  auditor: RunParticipant;
  continuation: ReturnType<typeof projectGeneralContinuation> | null;
}): GeneralAuditorAssignment;

export function renderGeneralAuditorPrompt(
  assignment: GeneralAuditorAssignment,
): string;

export function projectGeneralContinuation(
  generalAudit: GeneralAuditReadModel,
): {
  status: string;
  inspectedSurfaces: string[];
  remainingSurfaces: string[];
  remainingDimensionIds: string[];
  openQuestions: string[];
  findings: unknown[];
  behaviorPaths: unknown[];
};
