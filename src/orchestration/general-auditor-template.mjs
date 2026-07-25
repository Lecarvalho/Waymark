import {
  GENERAL_AUDIT_SURFACES,
  GENERAL_DIMENSION_WEIGHTS,
  GENERAL_EVIDENCE_SOURCES,
  PRACTICE_GUIDE_IDS,
  WAYMARK_DIMENSION_IDS,
} from "../domain/general-audit.mjs";

const PRACTICE_GUIDE_LABELS = Object.freeze({
  organizeAroundBehavior: "organize around behavior",
  explicitDependencyDirection: "make dependency direction explicit",
  conceptOwningNames: "name files for the concept they own",
  canonicalWorkflow: "provide one canonical workflow",
  proximateInstructions: "put instructions close to the code",
  testsMirrorBehavior: "make tests mirror behavior",
  separateGeneratedExternal: "separate generated and external code",
});

function json(value) {
  return JSON.stringify(value, null, 2);
}

function continuationContext(value) {
  if (value === null) return [];
  return [
    "",
    "Continuation state (projected from acknowledged checkpoints only):",
    json(value),
    "Continue the same auditor role. Re-check open questions and remaining coverage; do not repeat completed research unless a finding needs revision.",
  ];
}

export function createGeneralAuditorAssignment({ run, auditor, continuation }) {
  return {
    runId: run.id,
    role: "auditor",
    participant: auditor,
    reasoningEffort: run.runConditions.auditorReasoningEffort,
    target: {
      path: run.targetRepositoryPath,
      identity: run.repositoryIdentity,
      commitSha: run.commitSha,
      readOnly: true,
    },
    auditMode: "general",
    task: run.task,
    executionPolicy: {
      isolation: "fresh_process",
      contextPolicy: "assignment_only",
      measurementScope: "role_process_only",
    },
    toolPolicy: run.toolPolicy,
    continuation,
  };
}

export function renderGeneralAuditorPrompt(assignment) {
  const practiceGuide = PRACTICE_GUIDE_IDS.map(
    (id) => `- ${id}: ${PRACTICE_GUIDE_LABELS[id]}`,
  );
  const dimensions = WAYMARK_DIMENSION_IDS.map(
    (id) => `- ${id}: ${GENERAL_DIMENSION_WEIGHTS[id]}%`,
  );
  return [
    "You are the sole Waymark general-audit auditor in a fresh provider process.",
    "You have assignment-only context. Do not assume or reference any controlling conversation.",
    `Repository: ${assignment.target.identity}`,
    `Commit: ${assignment.target.commitSha}`,
    `Read-only target: ${assignment.target.path}`,
    `Audit task: ${assignment.task}`,
    "",
    "Boundary:",
    "- Measure AI coding navigability only, not security, correctness, maintainability, accessibility, or general code quality.",
    "- Keep the target repository read-only. Do not install, format, generate, or edit.",
    "- You are the only model role. Do not launch candidate, independent, orchestrator, verifier, or reporter roles.",
    "- Completion is driven by cited evidence coverage. There is no Waymark token ceiling or token-efficiency score.",
    "",
    "Required repository surfaces:",
    ...GENERAL_AUDIT_SURFACES.map((surface) => `- ${surface}`),
    "",
    "Allowed evidence-source labels:",
    ...GENERAL_EVIDENCE_SOURCES.map((source) => `- ${source}`),
    "",
    "Practice Guide:",
    ...practiceGuide,
    "",
    "Weighted dimensions:",
    ...dimensions,
    "",
    "Research requirements:",
    "- Record favorable evidence and navigation friction; do not infer success from missing evidence.",
    "- Code-structure, naming, ownership, dependency, behavior-organization, and test-mirroring conclusions require production-code or test citations.",
    "- Attempt at least two representative behavior/runtime paths when present. Connect entry point, owner, dependencies, consumers, and tests; mark unknown nodes explicitly.",
    "- Checkpoint after each defensible semantic finding or meaningful revision, not after each file read.",
    "- Revisit provisional findings. If later evidence locates or changes one, append a located_late or reframed revision with the observed navigation cost.",
    "- Assess a dimension only after its evidence requirements were attempted. Preserve not_assessed when evidence remains insufficient.",
    "",
    "Checkpoint channel:",
    "- The environment provides WAYMARK_CHECKPOINT_RUN_ID, WAYMARK_CHECKPOINT_ACTOR, WAYMARK_CHECKPOINT_ENDPOINT, and WAYMARK_CHECKPOINT_AUTHORIZATION.",
    "- POST JSON with Authorization set to WAYMARK_CHECKPOINT_AUTHORIZATION. Every envelope is:",
    json({
      runId: "<WAYMARK_CHECKPOINT_RUN_ID>",
      actor: "<WAYMARK_CHECKPOINT_ACTOR>",
      providerSessionId: "<current provider session id>",
      idempotencyKey: "<stable unique semantic key>",
      type: "<general semantic event type>",
      occurredAt: "<ISO-8601 timestamp>",
      payload: {},
    }),
    "- The runner has already recorded general.audit.started. Do not send another start event.",
    "- Supported event types are general.surface.inspected, general.behavior_path.recorded, general.finding.recorded, general.finding.revised, general.dimension.progress, general.dimension.assessed, general.recommendation.recorded, and general.synthesis.completed.",
    "- Follow the repository-local Waymark protocol shapes exactly when it is available. A rejected checkpoint must be corrected before relying on it.",
    "- A finding revision includes stable findingId/revisionId, revisionNumber, state, signal, title, conclusion, dimensionIds, practiceGuideIds, citations, navigationCost, and provenance.",
    "- Each citation includes repository-relative path, one-based startLine/endLine, symbol (or null), and evidence source.",
    "- Finish with general.synthesis.completed. Use completed only when all six dimensions have adequate assessed evidence; otherwise use partial when usable cited evidence exists.",
    ...continuationContext(assignment.continuation),
  ].join("\n");
}

export function projectGeneralContinuation(generalAudit) {
  const inspectedSurfaces = [
    ...new Set(generalAudit.surfaces.map(({ surface }) => surface)),
  ];
  const remainingDimensionIds = Object.values(generalAudit.dimensions)
    .filter(({ assessmentState }) => assessmentState !== "assessed")
    .map(({ dimensionId }) => dimensionId);
  const openQuestions = [
    ...remainingDimensionIds.map(
      (dimensionId) => `Complete adequate evidence for ${dimensionId}.`,
    ),
    ...(generalAudit.behaviorPathOrder.length < 2
      ? [
          `Record ${2 - generalAudit.behaviorPathOrder.length} additional representative behavior path(s) when the repository contains them.`,
        ]
      : []),
  ];
  return {
    status: generalAudit.status,
    inspectedSurfaces,
    remainingSurfaces: GENERAL_AUDIT_SURFACES.filter(
      (surface) => !inspectedSurfaces.includes(surface),
    ),
    remainingDimensionIds,
    openQuestions,
    findings: generalAudit.findingOrder.map((findingId) => {
      const finding = generalAudit.findings[findingId];
      return {
        findingId,
        currentRevision: finding.currentRevision,
        navigationCostHistory: finding.navigationCostHistory,
      };
    }),
    behaviorPaths: generalAudit.behaviorPathOrder.map(
      (pathId) => generalAudit.behaviorPaths[pathId],
    ),
  };
}
