import type {
  AuditAssignment,
  OrchestrationCapabilities,
  RepositoryTarget,
} from "./types";
import type { RunParticipantInput } from "../domain/audit";

export const READ_ONLY_CONSTRAINTS = Object.freeze([
  "Keep the target repository read-only.",
  "Do not install dependencies or generate files in the target.",
  "Cite repository-relative paths with one-based line ranges.",
  "Report unknowns and dead ends explicitly.",
] as const);

const CANDIDATE_EVIDENCE = Object.freeze([
  "entry points and relevant locations opened",
  "ownership and dependency answers",
  "required consumers and likely change surface",
  "applicable instructions and verification workflow",
  "atomic claims with confidence and citations",
] as const);

const INDEPENDENT_EVIDENCE = Object.freeze([
  "independently located owners and consumers",
  "hidden or conflicting dependencies",
  "citation and instruction challenges",
  "safe deterministic verification candidates",
] as const);

export interface AssignmentTemplateInput {
  runId: string;
  target: RepositoryTarget;
  task: string;
  candidate: RunParticipantInput;
  capabilities: OrchestrationCapabilities;
}

export function createInvestigationAssignments(
  input: AssignmentTemplateInput,
): readonly AuditAssignment[] {
  const candidate: AuditAssignment = {
    runId: input.runId,
    role: "candidate",
    participant: input.candidate,
    target: input.target,
    task: input.task,
    constraints: READ_ONLY_CONSTRAINTS,
    expectedEvidence: CANDIDATE_EVIDENCE,
  };

  const independent = input.capabilities.independentResearcher;
  if (!input.capabilities.parallelAgents || independent === null) {
    return Object.freeze([candidate]);
  }

  return Object.freeze([
    candidate,
    {
      runId: input.runId,
      role: "independent",
      participant: independent,
      target: input.target,
      task: input.task,
      constraints: READ_ONLY_CONSTRAINTS,
      expectedEvidence: INDEPENDENT_EVIDENCE,
    },
  ]);
}

export function renderAssignmentPrompt(assignment: AuditAssignment): string {
  const constraints = assignment.constraints
    .map((constraint) => `- ${constraint}`)
    .join("\n");
  const evidence = assignment.expectedEvidence
    .map((item) => `- ${item}`)
    .join("\n");

  return [
    `Act as the Waymark ${assignment.role} for run ${assignment.runId}.`,
    `Inspect ${assignment.target.path} at commit ${assignment.target.commitSha}.`,
    `Task: ${assignment.task}`,
    "Constraints:",
    constraints,
    "Return:",
    evidence,
    "Do not assign a Waymark score.",
  ].join("\n");
}
