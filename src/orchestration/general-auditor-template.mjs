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
  const permissionMode =
    run.runConditions.auditorPermissionMode ?? "read_only";
  return {
    runId: run.id,
    role: "auditor",
    participant: auditor,
    reasoningEffort: run.runConditions.auditorReasoningEffort,
    target: {
      path: run.targetRepositoryPath,
      identity: run.repositoryIdentity,
      commitSha: run.commitSha,
      readOnly: permissionMode === "read_only",
    },
    auditMode: "general",
    task: run.task,
    executionPolicy: {
      isolation: "fresh_process",
      contextPolicy: "assignment_only",
      measurementScope: "role_process_only",
    },
    toolPolicy: run.toolPolicy,
    permissionMode,
    continuation,
  };
}

export function renderGeneralAuditorPrompt(assignment) {
  const unrestricted =
    assignment.permissionMode === "unrestricted_no_approval";
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
    `Starting commit (provenance only): ${assignment.target.commitSha}`,
    `${unrestricted ? "Full-access target" : "Read-only target"}: ${assignment.target.path}`,
    `Audit task: ${assignment.task}`,
    "",
    "Boundary:",
    "- Measure AI coding navigability only, not security, correctness, maintainability, accessibility, or general code quality.",
    "- The repository may evolve while this audit runs. Inspect and cite what is present when you read it; do not fail or stop solely because HEAD or worktree status changes.",
    ...(unrestricted
      ? [
          "- The user explicitly authorized unrestricted command execution without approval prompts.",
          "- You may run any command needed for the audit, including compound shell commands, repository workflows, and networked tools.",
          "- Full access is for command compatibility only. Do not modify, create, delete, install, format, or generate anything in the target repository.",
          "- This remains a navigation audit. Do not implement product changes.",
        ]
      : [
          "- Keep the target repository read-only. Do not install, format, generate, or edit.",
        ]),
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
    "- Record one cited repository-specific assessment for every Practice Guide principle. Each must list inspected surfaces, positive evidence, friction, unknowns/limitations, and the navigation-token mechanism.",
    "- For canonicalWorkflow, enumerate actual README commands, package scripts, CI commands, developer wrappers, stack-specific harnesses, and agent instructions, then state whether they converge, are equivalent wrappers, or conflict.",
    "- For organizeAroundBehavior and conceptOwningNames, connect representative behavior names and concept-owning files to entry points, owners, consumers, and tests; a filename search alone is inadequate.",
    "- Every current friction finding requires an explicit disposition: covered/consolidated into a recommendation, accepted as a limitation, or deferred for insufficient evidence.",
    "- Every mixed or weak Practice Guide assessment must link a recommendation or state an explicit limitation.",
    "",
    "Read-only command recipe:",
    "- Prefer `rg --files`, one narrow `rg -n` query over selected files, and direct bounded `Get-Content` reads.",
    "- Avoid PowerShell arrays, loops, dynamic command construction, target-obscuring pipelines, and cross-shell composition.",
    "- Use the injected Git safe-directory configuration; do not override repository trust globally.",
    "- Treat search exit 1 with no matches as evidence. Do not repeat the same query unless its scope changes.",
    "- Split large reads into bounded, independently useful probes.",
    "",
    "Checkpoint channel:",
    "- Use the Waymark MCP server's event-specific tools after each defensible semantic finding or meaningful revision.",
    "- Do not inspect checkpoint environment variables or use shell, PowerShell, curl, or another HTTP client to publish checkpoints.",
    "- The runner owns run, auditor, authorization, and provider-session identity. Each tool takes idempotencyKey, occurredAt, and its semantic fields directly.",
    json({
      idempotencyKey: "<stable unique semantic key>",
      occurredAt: "<ISO-8601 timestamp>",
    }),
    "- Treat a checkpoint as durable only when the tool returns `status: acknowledged`. Correct and retry a rejected checkpoint before relying on it.",
    "- The runner has already recorded general.audit.started. Do not send another start event.",
    "- Tools are record_surface, record_behavior_path, record_finding, revise_finding, record_dimension_progress, assess_dimension, assess_practice, record_recommendation, record_friction_disposition, and complete_synthesis.",
    "- The MCP tool schema is authoritative. Do not add fields.",
    "- Finding tools take a `revision` object with stable findingId/revisionId, revisionNumber, state, signal, title, conclusion, dimensionIds, practiceGuideIds, citations, navigationCost, and provenance linkage.",
    "- Finding provenance input contains only previousRevisionId, amendmentReason, and causedByCitations. The checkpoint server injects authenticated actor identity and the effective checkpoint timestamp.",
    "- navigationCost is null or measured numeric counters from the tool schema; never use qualitative levels or prose observations there.",
    "- Each citation includes repository-relative path, one-based startLine/endLine, symbol (or null), and evidence source.",
    "- Complete behavior-path example:",
    json({
      idempotencyKey: "behavior-save-path",
      occurredAt: null,
      pathId: "save-path",
      name: "Save a record",
      entryPoint: {
        status: "known",
        label: "Save command",
        citations: [{ path: "src/save.ts", startLine: 10, endLine: 14, symbol: "save", source: "production_code" }],
      },
      owner: {
        status: "known",
        label: "Save service",
        citations: [{ path: "src/save-service.ts", startLine: 4, endLine: 20, symbol: "SaveService", source: "production_code" }],
      },
      dependencies: [{
        status: "known",
        label: "Repository",
        citations: [{ path: "src/repository.ts", startLine: 1, endLine: 12, symbol: "Repository", source: "production_code" }],
      }],
      consumers: [{
        status: "unknown",
        label: "External consumers",
        reason: "No caller was found in inspected production surfaces.",
        citations: [],
      }],
      tests: [{
        status: "known",
        label: "Save behavior test",
        citations: [{ path: "tests/save.test.ts", startLine: 8, endLine: 30, symbol: null, source: "test" }],
      }],
    }),
    "- Finish with complete_synthesis only after all seven Practice Guide dispositions and every friction disposition are durable. Use completed only when all six dimensions also have adequate assessed evidence; otherwise use partial when usable cited evidence exists.",
    "",
    "Final fallback:",
    "- Return the required structured object with `unpublishedCheckpoints`.",
    "- Include only semantic checkpoints that did not receive an acknowledged MCP response. Encode each payload object exactly as JSON in `payloadJson`; use an empty array when all live checkpoints were acknowledged.",
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
  const remainingPracticeGuideIds = Object.values(generalAudit.practices)
    .filter(({ dispositionRecorded }) => !dispositionRecorded)
    .map(({ principleId }) => principleId);
  const openQuestions = [
    ...remainingDimensionIds.map(
      (dimensionId) => `Complete adequate evidence for ${dimensionId}.`,
    ),
    ...remainingPracticeGuideIds.map(
      (principleId) => `Record a repository-specific disposition for ${principleId}.`,
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
    remainingPracticeGuideIds,
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
    practices: generalAudit.practices,
    frictionDispositions: generalAudit.frictionDispositions,
  };
}
