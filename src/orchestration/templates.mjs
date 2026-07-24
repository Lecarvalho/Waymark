export const READ_ONLY_CONSTRAINTS = Object.freeze([
  "Keep the target repository read-only.",
  "Do not install dependencies or generate files in the target.",
  "Cite repository-relative paths with one-based line ranges.",
  "Report unknowns and dead ends explicitly.",
]);

export const FRESH_EXECUTION_POLICY = Object.freeze({
  isolation: "fresh_process",
  sessionPersistence: "ephemeral",
  contextPolicy: "assignment_only",
  measurementScope: "role_process_only",
});

export const DEFAULT_AUDIT_TOKEN_BUDGETS = Object.freeze({
  candidate_navigation: Object.freeze({
    targetTokens: 12_000,
    hardLimitTokens: 24_000,
  }),
  independent_validation: Object.freeze({
    targetTokens: 24_000,
    hardLimitTokens: 48_000,
  }),
  orchestration: Object.freeze({
    targetTokens: 12_000,
    hardLimitTokens: 24_000,
  }),
  deterministic_verification: Object.freeze({
    targetTokens: 6_000,
    hardLimitTokens: 12_000,
  }),
  report_generation: Object.freeze({
    targetTokens: 4_000,
    hardLimitTokens: 8_000,
  }),
});

const CANDIDATE_EVIDENCE = Object.freeze([
  "entry points and relevant locations opened",
  "ownership and dependency answers",
  "required consumers and likely change surface",
  "applicable instructions and verification workflow",
  "atomic claims with confidence and citations",
]);

const INDEPENDENT_EVIDENCE = Object.freeze([
  "independently located owners and consumers",
  "hidden or conflicting dependencies",
  "citation and instruction challenges",
  "safe deterministic verification candidates",
]);

export function resolveAuditTokenBudgets(value) {
  if (value === undefined || value === null) {
    return DEFAULT_AUDIT_TOKEN_BUDGETS;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("runConditions.tokenBudgets must be an object");
  }

  const result = {};
  for (const [phase, fallback] of Object.entries(
    DEFAULT_AUDIT_TOKEN_BUDGETS,
  )) {
    const budget = value[phase] ?? fallback;
    if (typeof budget !== "object" || budget === null || Array.isArray(budget)) {
      throw new TypeError(`tokenBudgets.${phase} must be an object`);
    }
    const { targetTokens, hardLimitTokens } = budget;
    if (!Number.isSafeInteger(targetTokens) || targetTokens < 1) {
      throw new TypeError(
        `tokenBudgets.${phase}.targetTokens must be a positive integer`,
      );
    }
    if (
      !Number.isSafeInteger(hardLimitTokens) ||
      hardLimitTokens < targetTokens
    ) {
      throw new TypeError(
        `tokenBudgets.${phase}.hardLimitTokens must be an integer at least as large as targetTokens`,
      );
    }
    result[phase] = Object.freeze({ targetTokens, hardLimitTokens });
  }
  return Object.freeze(result);
}

export function createInvestigationAssignments(input) {
  const tokenBudgets = resolveAuditTokenBudgets(input.tokenBudgets);
  const candidate = {
    runId: input.runId,
    role: "candidate",
    participant: input.candidate,
    target: input.target,
    task: input.task,
    executionPolicy: FRESH_EXECUTION_POLICY,
    tokenBudget: tokenBudgets.candidate_navigation,
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
      executionPolicy: FRESH_EXECUTION_POLICY,
      tokenBudget: tokenBudgets.independent_validation,
      constraints: READ_ONLY_CONSTRAINTS,
      expectedEvidence: INDEPENDENT_EVIDENCE,
    },
  ]);
}

export function renderAssignmentPrompt(assignment) {
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
    "Execution:",
    "- Run in a fresh process with no inherited conversation history.",
    "- Persist no provider session and measure only this role process.",
    `- Target ${assignment.tokenBudget.targetTokens} processed tokens; hard limit ${assignment.tokenBudget.hardLimitTokens}.`,
    "Constraints:",
    constraints,
    "Return:",
    evidence,
    "Do not assign a Waymark score.",
  ].join("\n");
}
