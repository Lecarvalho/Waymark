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
  "observed existing consumers and dependency edges",
  "applicable instructions and verification workflow",
  "atomic current-repository facts with confidence and citations that support the entire assertion",
]);

const INDEPENDENT_EVIDENCE = Object.freeze([
  "independently located owners and consumers",
  "hidden or conflicting dependencies",
  "citation and instruction challenges",
  "safe deterministic verification candidates",
]);
const ORCHESTRATOR_EVIDENCE = Object.freeze([
  "cross-examination of every candidate claim that needs qualification",
  "deterministic verification requests with concrete checks",
  "repository-navigation recommendations linked only to supplied current-repository fact claims",
  "a named repository change and repeatable before/after check per recommendation",
]);
const REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

function resolveReasoningEffort(value, role) {
  if (value === undefined || value === null) return undefined;
  if (!REASONING_EFFORTS.has(value)) {
    throw new TypeError(
      `runConditions.${role}ReasoningEffort must be a supported reasoning effort`,
    );
  }
  return value;
}

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
  const candidateReasoningEffort = resolveReasoningEffort(
    input.reasoningEfforts?.candidate,
    "candidate",
  );
  const independentReasoningEffort = resolveReasoningEffort(
    input.reasoningEfforts?.independent,
    "independent",
  );
  const candidate = {
    runId: input.runId,
    role: "candidate",
    participant: input.candidate,
    target: input.target,
    task: input.task,
    executionPolicy: FRESH_EXECUTION_POLICY,
    ...(candidateReasoningEffort
      ? { reasoningEffort: candidateReasoningEffort }
      : {}),
    tokenBudget: tokenBudgets.candidate_navigation,
    ...(Number.isSafeInteger(input.shellCommandBudgets?.candidate)
      ? { shellCommandBudget: input.shellCommandBudgets.candidate }
      : {}),
    constraints: Object.freeze([
      ...READ_ONLY_CONSTRAINTS,
      "Each finding must have kind repository_fact and state one atomic fact about the repository as it exists at the target commit.",
      "Do not put implementation advice, desired future architecture, or a proposed change surface in findings.",
      "Every finding must include at least one line-range citation that supports the entire assertion.",
      ...(input.additionalConstraints?.candidate ?? []),
    ]),
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
      ...(independentReasoningEffort
        ? { reasoningEffort: independentReasoningEffort }
        : {}),
      tokenBudget: tokenBudgets.independent_validation,
      ...(Number.isSafeInteger(input.shellCommandBudgets?.independent)
        ? { shellCommandBudget: input.shellCommandBudgets.independent }
        : {}),
      constraints: Object.freeze([
        ...READ_ONLY_CONSTRAINTS,
        ...(input.additionalConstraints?.independent ?? []),
      ]),
      expectedEvidence: INDEPENDENT_EVIDENCE,
    },
  ]);
}

export function createOrchestratorAssignment(input) {
  const tokenBudgets = resolveAuditTokenBudgets(input.tokenBudgets);
  const reasoningEffort = resolveReasoningEffort(
    input.reasoningEffort,
    "orchestrator",
  );
  return Object.freeze({
    runId: input.runId,
    role: "orchestrator",
    participant: input.orchestrator,
    target: input.target,
    task: input.task,
    executionPolicy: FRESH_EXECUTION_POLICY,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    tokenBudget: tokenBudgets.orchestration,
    ...(Number.isSafeInteger(input.shellCommandBudget)
      ? { shellCommandBudget: input.shellCommandBudget }
      : {}),
    constraints: Object.freeze([
      ...READ_ONLY_CONSTRAINTS,
      ...(input.additionalConstraints ?? []),
      "Use only the supplied claim IDs in challenges, verification requests, and recommendations.",
      "Recommendation claim IDs must reference atomic current-repository facts, never implementation advice, desired architecture, or proposed change-surface assertions.",
      "If a proposed recommendation lacks a supported factual claim, omit that recommendation rather than citing a speculative claim.",
      "Recommend repository navigation improvements, never implementation of the probe feature.",
      "Do not assign or predict a Waymark score.",
    ]),
    expectedEvidence: ORCHESTRATOR_EVIDENCE,
    context: input.context,
  });
}

export function renderAssignmentPrompt(assignment) {
  const constraints = assignment.constraints
    .map((constraint) => `- ${constraint}`)
    .join("\n");
  const evidence = assignment.expectedEvidence
    .map((item) => `- ${item}`)
    .join("\n");

  const prompt = [
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
  ];
  if (assignment.context) {
    prompt.push(
      "Assignment evidence (JSON):",
      JSON.stringify(assignment.context),
    );
  }
  return prompt.join("\n");
}
