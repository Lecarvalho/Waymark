export const READ_ONLY_CONSTRAINTS = Object.freeze([
  "Keep the target repository read-only.",
  "Do not install dependencies or generate files in the target.",
  "Cite repository-relative paths with one-based line ranges.",
  "Report unknowns and dead ends explicitly.",
  "Use direct read-only command shapes only: rg for bounded discovery/search and Get-Content -LiteralPath with -TotalCount or Select-Object -Skip/-First for bounded reads.",
  "Do not use shell variables, .NET file APIs, output redirection, command substitution, or commands that can write.",
  "Do not retry a declined or failed command with a syntactic variant; record the dead end unless a different allowed read is essential.",
]);

export const FRESH_EXECUTION_POLICY = Object.freeze({
  isolation: "fresh_process",
  sessionPersistence: "local_telemetry_log",
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
  "atomic repository-navigation facts with confidence and citations that support the entire assertion",
  "a separate concise probeResult proving task understanding for validator use only",
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
  "repository-navigation recommendations linked only to supplied navigation-fact claims",
  "a named repository change and repeatable before/after check per recommendation",
]);
const SYSTEM_EXPLANATION_CONSTRAINTS = Object.freeze([
  "This is a system-lookup probe. Find enough cited evidence to answer the short question correctly; do not infer a requested code change.",
  "Keep the answer concise. Explanatory depth and prose length do not improve the result.",
  "The primary measurement is navigation cost: processed tokens, searches, file hops, dead ends, and effort before a supported answer.",
  "Do not treat hypothetical change-surface recall as required evidence in this mode.",
]);
const GENERAL_PRACTICE_IDS = Object.freeze([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
]);
const GENERAL_AUDIT_CONSTRAINTS = Object.freeze([
  "This is the versioned General repository audit. Perform a cold, repository-wide agent-readiness assessment rather than a single feature probe.",
  "Assess all seven Practice Guide principles: 01 behavior organization, 02 dependency direction, 03 concept naming, 04 canonical workflow, 05 proximal instructions, 06 behavior-mirroring tests, and 07 generated/external code boundaries.",
  "Sample at least two representative behavior areas or runtime paths when the repository contains them; state the sample and do not imply exhaustive coverage.",
  "Return exactly one practiceAssessments item for every Practice Guide ID from 01 through 07.",
  "Every strong, mixed, or weak practice assessment must reference one or more finding indexes whose full assertions are supported by citations. Use not_assessed with a concrete limitation when evidence is insufficient.",
  "Record both effective repository signals and missing or costly patterns. Mixed and weak assessments must explain the extra searches, file hops, ambiguity, hidden edges, command hunting, or unsafe edit risk they create.",
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
  const auditMode = input.auditMode ?? "task_specific";
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
    auditMode,
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
      ...(auditMode === "general" ? GENERAL_AUDIT_CONSTRAINTS : []),
      ...(auditMode === "system_explanation"
        ? SYSTEM_EXPLANATION_CONSTRAINTS
        : []),
      "Each finding must have kind navigation_fact and state one atomic fact about discoverability, ownership clarity, dependency clarity, change-surface visibility, verification discoverability, or instruction quality.",
      "Each navigation finding must name one Waymark dimension and state the concrete navigation friction: searches, file hops, ambiguity, hidden edges, or an undiscoverable verification path.",
      "Do not put probe-feature behavior, implementation advice, desired future architecture, or a proposed feature change surface in findings.",
      "Valid finding example: 'No repository map connects the notification producers and worker; locating the surface required searches across three projects.' Invalid finding example: 'The worker resolves IEmailSender per message.' Put the invalid example's kind of feature behavior only in probeResult.",
      "Every finding must include at least one line-range citation that supports the entire assertion.",
      "Record feature-surface understanding only in probeResult. It exists to let validators judge navigation adequacy and must not contain implementation advice.",
      ...(auditMode === "general"
        ? [
            "Tag every general-audit finding with one or more practiceIds from 01 through 07.",
            "Use probeResult to summarize the sampled repository surfaces and whether the seven-principle assessment is adequate; it remains validator-only.",
          ]
        : [
            "Return an empty practiceAssessments array; repository-wide practice profiling belongs only to general mode.",
          ]),
      ...(input.additionalConstraints?.candidate ?? []),
    ]),
    expectedEvidence:
      auditMode === "general"
        ? Object.freeze([
            ...CANDIDATE_EVIDENCE,
            "exactly seven practice assessments with cited finding references, including positive signals, gaps, and sampling limitations",
          ])
        : CANDIDATE_EVIDENCE,
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
      auditMode,
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
        ...(auditMode === "general" ? GENERAL_AUDIT_CONSTRAINTS : []),
        ...(auditMode === "system_explanation"
          ? SYSTEM_EXPLANATION_CONSTRAINTS
          : []),
        ...(auditMode === "general"
          ? [
              "Independently return exactly seven practiceAssessments items and challenge shallow, single-path, or unsupported coverage.",
              "Tag every general-audit finding with one or more practiceIds from 01 through 07.",
            ]
          : [
              "Return an empty practiceAssessments array; repository-wide practice profiling belongs only to general mode.",
            ]),
        ...(input.additionalConstraints?.independent ?? []),
      ]),
      expectedEvidence:
        auditMode === "general"
          ? Object.freeze([
              ...INDEPENDENT_EVIDENCE,
              "an independent seven-principle practice assessment and explicit coverage challenges",
            ])
          : INDEPENDENT_EVIDENCE,
    },
  ]);
}

export function createOrchestratorAssignment(input) {
  const auditMode = input.auditMode ?? "task_specific";
  const independentUnavailable =
    input.context?.researchCoverage?.independent === "unavailable";
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
    auditMode,
    task: input.task,
    executionPolicy: FRESH_EXECUTION_POLICY,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    tokenBudget: tokenBudgets.orchestration,
    ...(Number.isSafeInteger(input.shellCommandBudget)
      ? { shellCommandBudget: input.shellCommandBudget }
      : {}),
    constraints: Object.freeze([
      ...READ_ONLY_CONSTRAINTS,
      ...(auditMode === "general" ? GENERAL_AUDIT_CONSTRAINTS : []),
      ...(auditMode === "system_explanation"
        ? SYSTEM_EXPLANATION_CONSTRAINTS
        : []),
      ...(input.additionalConstraints ?? []),
      "Use only the supplied claim IDs in challenges, verification requests, and recommendations.",
      "Recommendation claim IDs must reference atomic repository-navigation facts. Never use probe results, feature behavior, implementation advice, desired architecture, or proposed feature change-surface assertions as recommendation evidence.",
      "If a proposed recommendation lacks a supported factual claim, omit that recommendation rather than citing a speculative claim.",
      "Recommend repository navigation improvements, never implementation of the probe feature.",
      "Write every user-facing recommendation field about navigation friction and repository-level remedies: discoverability, ownership clarity, dependency clarity, verification discoverability, or token efficiency.",
      "Do not restate probe-feature behavior or propose the probe feature's implementation in recommendation titles, problems, changes, steps, token mechanisms, or validation checks; claim IDs are provenance only.",
      "Do not assign or predict a Waymark score.",
      ...(auditMode === "general"
        ? [
            independentUnavailable
              ? "Return exactly seven practiceProfile items, ordered 01 through 07, using candidate evidence only; independent research is unavailable, so state that limitation and do not imply independent agreement."
              : "Return exactly seven practiceProfile items, ordered 01 through 07, after reconciling candidate and independent assessments.",
            "Every strong, mixed, or weak profile item must cite supplied candidate claim IDs; every mixed or weak item must link one or more recommendation IDs.",
            "Use not_assessed only when bounded evidence cannot support a result, with no claim IDs and at least one concrete limitation.",
            "Make recommendations a prioritized repository-wide improvement backlog. Cover every verified mixed or weak practice, merge duplicates, and retain exact repository paths and validation checks.",
          ]
        : [
            "Return an empty practiceProfile array; repository-wide practice profiling belongs only to general mode.",
          ]),
    ]),
    expectedEvidence:
      auditMode === "general"
        ? Object.freeze([
            ...ORCHESTRATOR_EVIDENCE,
            `a complete reconciled practice profile for IDs ${GENERAL_PRACTICE_IDS.join(", ")}`,
          ])
        : ORCHESTRATOR_EVIDENCE,
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
    `Audit mode: ${assignment.auditMode}`,
    `${
      assignment.auditMode === "system_explanation"
        ? "Explanation question"
        : "Task"
    }: ${assignment.task}`,
    "Execution:",
    "- Run in a fresh process with no inherited conversation history.",
    "- Start a new non-resumed provider session; its local rollout log is used only for normalized live telemetry.",
    `- Target ${assignment.tokenBudget.targetTokens} processed tokens; hard limit ${assignment.tokenBudget.hardLimitTokens}.`,
    "- Waymark reserves at least the final 20% of the hard limit for a structured partial report. It may interrupt earlier when replaying the current context would otherwise leave too little reporting budget.",
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
