export const GENERAL_AUDIT_EVENT_TYPES = Object.freeze([
  "general.audit.started",
  "general.surface.inspected",
  "general.behavior_path.recorded",
  "general.finding.recorded",
  "general.finding.revised",
  "general.dimension.progress",
  "general.dimension.assessed",
  "general.practice.assessed",
  "general.recommendation.recorded",
  "general.friction.disposition.recorded",
  "general.continuation.recorded",
  "general.synthesis.completed",
  "general.audit.interrupted",
]);

export const GENERAL_FINDING_STATES = Object.freeze([
  "provisional",
  "confirmed",
  "located_late",
  "reframed",
  "contradicted",
  "retracted",
  "unresolved",
]);

export const GENERAL_FINDING_SIGNALS = Object.freeze([
  "positive",
  "friction",
  "unknown",
]);

export const GENERAL_EVIDENCE_SOURCES = Object.freeze([
  "production_code",
  "test",
  "configuration",
  "workflow",
  "documentation",
  "instruction",
  "generated",
  "external",
]);

export const WAYMARK_DIMENSION_IDS = Object.freeze([
  "discoveryEfficiency",
  "ownershipClarity",
  "dependencyClarity",
  "changeSurfaceRecall",
  "verificationDiscoverability",
  "instructionQuality",
]);

export const PRACTICE_GUIDE_IDS = Object.freeze([
  "organizeAroundBehavior",
  "explicitDependencyDirection",
  "conceptOwningNames",
  "canonicalWorkflow",
  "proximateInstructions",
  "testsMirrorBehavior",
  "separateGeneratedExternal",
]);

export const PRACTICE_GUIDE_CATALOG = Object.freeze([
  Object.freeze({ id: "organizeAroundBehavior", uiId: "01", title: "Organize around behavior" }),
  Object.freeze({ id: "explicitDependencyDirection", uiId: "02", title: "Make dependency direction explicit" }),
  Object.freeze({ id: "conceptOwningNames", uiId: "03", title: "Name files for the concept they own" }),
  Object.freeze({ id: "canonicalWorkflow", uiId: "04", title: "Provide one canonical workflow" }),
  Object.freeze({ id: "proximateInstructions", uiId: "05", title: "Put instructions close to the code" }),
  Object.freeze({ id: "testsMirrorBehavior", uiId: "06", title: "Make tests mirror behavior" }),
  Object.freeze({ id: "separateGeneratedExternal", uiId: "07", title: "Separate generated and external code" }),
]);

export const GENERAL_PRACTICE_ASSESSMENTS = Object.freeze([
  "strong",
  "mixed",
  "weak",
  "not_assessed",
]);

export const GENERAL_FRICTION_DISPOSITIONS = Object.freeze([
  "covered",
  "consolidated",
  "accepted_limitation",
  "deferred",
]);

export const GENERAL_AUDIT_SURFACES = Object.freeze([
  "production_code",
  "tests",
  "dependency_paths",
  "consumers",
  "configuration",
  "workflows",
  "generated_external",
  "documentation",
  "instructions",
]);

export const GENERAL_DIMENSION_WEIGHTS = Object.freeze({
  discoveryEfficiency: 20,
  ownershipClarity: 17,
  dependencyClarity: 17,
  changeSurfaceRecall: 20,
  verificationDiscoverability: 16,
  instructionQuality: 10,
});

export const GENERAL_STRONG_SCORE_MINIMUM = 80;

export const GENERAL_DIMENSION_EVIDENCE_REQUIREMENTS = Object.freeze({
  discoveryEfficiency: Object.freeze({ requiresCodeOrTestEvidence: false }),
  ownershipClarity: Object.freeze({ requiresCodeOrTestEvidence: true }),
  dependencyClarity: Object.freeze({ requiresCodeOrTestEvidence: true }),
  changeSurfaceRecall: Object.freeze({ requiresCodeOrTestEvidence: true }),
  verificationDiscoverability: Object.freeze({
    requiresCodeOrTestEvidence: false,
  }),
  instructionQuality: Object.freeze({ requiresCodeOrTestEvidence: false }),
});

const EVENT_TYPE_SET = new Set(GENERAL_AUDIT_EVENT_TYPES);
const FINDING_STATE_SET = new Set(GENERAL_FINDING_STATES);
const FINDING_SIGNAL_SET = new Set(GENERAL_FINDING_SIGNALS);
const EVIDENCE_SOURCE_SET = new Set(GENERAL_EVIDENCE_SOURCES);
const DIMENSION_ID_SET = new Set(WAYMARK_DIMENSION_IDS);
const PRACTICE_GUIDE_ID_SET = new Set(PRACTICE_GUIDE_IDS);
const PRACTICE_ASSESSMENT_SET = new Set(GENERAL_PRACTICE_ASSESSMENTS);
const FRICTION_DISPOSITION_SET = new Set(GENERAL_FRICTION_DISPOSITIONS);
const SURFACE_SET = new Set(GENERAL_AUDIT_SURFACES);
const INACTIVE_FINDING_STATES = new Set(["contradicted", "retracted"]);

export class GeneralAuditProjectionError extends Error {
  constructor(code, message, eventId = null) {
    super(message);
    this.name = "GeneralAuditProjectionError";
    this.code = code;
    this.eventId = eventId;
  }
}

function fail(code, message, eventId = null) {
  throw new GeneralAuditProjectionError(code, message, eventId);
}

function emptySourceCounts() {
  return Object.fromEntries(
    GENERAL_EVIDENCE_SOURCES.map((source) => [source, 0]),
  );
}

function emptyCoverage(dimensionId) {
  const requirement =
    GENERAL_DIMENSION_EVIDENCE_REQUIREMENTS[dimensionId];
  return {
    bySource: emptySourceCounts(),
    distinctCitationCount: 0,
    codeOrTestCitationCount: 0,
    requiresCodeOrTestEvidence: requirement.requiresCodeOrTestEvidence,
    requirementSatisfied: !requirement.requiresCodeOrTestEvidence,
    state: "insufficient",
  };
}

function emptyDimension(dimensionId) {
  return {
    dimensionId,
    weight: GENERAL_DIMENSION_WEIGHTS[dimensionId],
    assessmentState: "not_assessed",
    score: null,
    confidence: null,
    evidenceCoverage: emptyCoverage(dimensionId),
    supportingPositiveFindingIds: [],
    supportingFrictionFindingIds: [],
    limitations: [],
  };
}

function emptyPractice(principle) {
  return {
    principleId: principle.id,
    uiId: principle.uiId,
    title: principle.title,
    assessment: "not_assessed",
    summary: "No repository-specific assessment has been recorded.",
    surfacesInspected: [],
    supportingPositiveFindingIds: [],
    supportingFrictionFindingIds: [],
    limitations: ["Repository-specific evidence has not yet been recorded."],
    navigationTokenMechanism: "Unavailable until this principle is assessed.",
    recommendationIds: [],
    workflowEntryPoints: [],
    workflowConclusion: null,
    dispositionRecorded: false,
    assessedAt: null,
    actor: null,
  };
}

function initialState() {
  return {
    runId: null,
    status: "not_started",
    repositoryIdentity: null,
    commitSha: null,
    protocolVersion: null,
    startedAt: null,
    finishedAt: null,
    lastSequence: 0,
    findings: {},
    findingOrder: [],
    behaviorPaths: {},
    behaviorPathOrder: [],
    surfaces: [],
    dimensions: Object.fromEntries(
      WAYMARK_DIMENSION_IDS.map((dimensionId) => [
        dimensionId,
        emptyDimension(dimensionId),
      ]),
    ),
    evidenceCoverage: Object.fromEntries(
      WAYMARK_DIMENSION_IDS.map((dimensionId) => [
        dimensionId,
        emptyCoverage(dimensionId),
      ]),
    ),
    recommendations: [],
    frictionDispositions: {},
    practices: Object.fromEntries(
      PRACTICE_GUIDE_CATALOG.map((principle) => [
        principle.id,
        emptyPractice(principle),
      ]),
    ),
    continuations: [],
    assessedWeight: 0,
    weightedPoints: 0,
    auditorAssessedResult: null,
    synthesis: null,
    interruption: null,
    partialReport: {
      available: false,
      usableCitationCount: 0,
      findingCount: 0,
      revisionCount: 0,
    },
  };
}

function validateFiniteNumber(value, field, eventId, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail(
      "invalid_number",
      `${field} must be a finite non-negative number${nullable ? " or null" : ""}.`,
      eventId,
    );
  }
}

function validateIdentifier(value, field, eventId) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("invalid_identifier", `${field} must be a non-empty string.`, eventId);
  }
}

function cloneCitation(citation, eventId) {
  if (!citation || typeof citation !== "object") {
    fail("invalid_citation", "A citation must be an object.", eventId);
  }
  validateIdentifier(citation.path, "citation.path", eventId);
  const slashPath = citation.path.replaceAll("\\", "/");
  if (
    slashPath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(slashPath) ||
    slashPath.split("/").includes("..")
  ) {
    fail(
      "non_relative_citation_path",
      "citation.path must be repository-relative and must not escape the repository.",
      eventId,
    );
  }
  validateFiniteNumber(citation.startLine, "citation.startLine", eventId);
  validateFiniteNumber(citation.endLine, "citation.endLine", eventId);
  if (citation.startLine < 1 || citation.endLine < citation.startLine) {
    fail(
      "invalid_citation_range",
      "Citation lines must be one-based and endLine must not precede startLine.",
      eventId,
    );
  }
  if (!EVIDENCE_SOURCE_SET.has(citation.source)) {
    fail(
      "invalid_evidence_source",
      `Unknown evidence source: ${citation.source}.`,
      eventId,
    );
  }
  if (citation.symbol !== null && typeof citation.symbol !== "string") {
    fail(
      "invalid_citation_symbol",
      "citation.symbol must be a string or null.",
      eventId,
    );
  }
  return {
    path: citation.path,
    startLine: citation.startLine,
    endLine: citation.endLine,
    symbol: citation.symbol,
    source: citation.source,
  };
}

function cloneCitations(citations, eventId) {
  if (!Array.isArray(citations)) {
    fail("invalid_citations", "citations must be an array.", eventId);
  }
  return citations.map((citation) => cloneCitation(citation, eventId));
}

function cloneNavigationCost(observation, eventId) {
  if (observation === null) return null;
  if (!observation || typeof observation !== "object") {
    fail(
      "invalid_navigation_cost",
      "navigationCost must be an object or null.",
      eventId,
    );
  }
  const fields = [
    "searches",
    "filesOpened",
    "fileHops",
    "deadEnds",
    "commands",
    "processedTokens",
    "elapsedMs",
  ];
  const cloned = {};
  for (const field of fields) {
    if (!(field in observation)) {
      fail(
        "missing_navigation_measurement",
        `navigationCost.${field} must be present and use null when unavailable.`,
        eventId,
      );
    }
    validateFiniteNumber(
      observation[field],
      `navigationCost.${field}`,
      eventId,
      { nullable: true },
    );
    cloned[field] = observation[field];
  }
  return cloned;
}

function cloneRevision(revision, event, expectedKind) {
  if (!revision || typeof revision !== "object") {
    fail("invalid_finding_revision", "revision must be an object.", event.id);
  }
  validateIdentifier(revision.revisionId, "revision.revisionId", event.id);
  validateIdentifier(revision.findingId, "revision.findingId", event.id);
  validateFiniteNumber(
    revision.revisionNumber,
    "revision.revisionNumber",
    event.id,
  );
  if (!Number.isInteger(revision.revisionNumber) || revision.revisionNumber < 1) {
    fail(
      "invalid_revision_number",
      "revision.revisionNumber must be a positive integer.",
      event.id,
    );
  }
  if (!FINDING_STATE_SET.has(revision.state)) {
    fail(
      "invalid_finding_state",
      `Unknown finding state: ${revision.state}.`,
      event.id,
    );
  }
  if (!FINDING_SIGNAL_SET.has(revision.signal)) {
    fail(
      "invalid_finding_signal",
      `Unknown finding signal: ${revision.signal}.`,
      event.id,
    );
  }
  validateIdentifier(revision.title, "revision.title", event.id);
  validateIdentifier(revision.conclusion, "revision.conclusion", event.id);

  if (
    !Array.isArray(revision.dimensionIds) ||
    revision.dimensionIds.some((id) => !DIMENSION_ID_SET.has(id))
  ) {
    fail(
      "invalid_dimension_ids",
      "revision.dimensionIds contains an unknown dimension.",
      event.id,
    );
  }
  if (
    !Array.isArray(revision.practiceGuideIds) ||
    revision.practiceGuideIds.some((id) => !PRACTICE_GUIDE_ID_SET.has(id))
  ) {
    fail(
      "invalid_practice_ids",
      "revision.practiceGuideIds contains an unknown Practice Guide ID.",
      event.id,
    );
  }
  if (!revision.provenance || typeof revision.provenance !== "object") {
    fail(
      "invalid_revision_provenance",
      "revision.provenance must be an object.",
      event.id,
    );
  }
  if (
    revision.provenance.actor !== event.actor ||
    revision.provenance.occurredAt !== event.occurredAt
  ) {
    fail(
      "revision_provenance_mismatch",
      "Revision actor and timestamp must match the semantic checkpoint.",
      event.id,
    );
  }
  if (expectedKind === "recorded") {
    if (
      revision.revisionNumber !== 1 ||
      revision.provenance.previousRevisionId !== null ||
      revision.provenance.amendmentReason !== null
    ) {
      fail(
        "invalid_initial_revision",
        "An initial finding must be revision 1 with no predecessor or amendment reason.",
        event.id,
      );
    }
  } else {
    validateIdentifier(
      revision.provenance.previousRevisionId,
      "revision.provenance.previousRevisionId",
      event.id,
    );
    validateIdentifier(
      revision.provenance.amendmentReason,
      "revision.provenance.amendmentReason",
      event.id,
    );
  }

  return {
    revisionId: revision.revisionId,
    findingId: revision.findingId,
    revisionNumber: revision.revisionNumber,
    state: revision.state,
    signal: revision.signal,
    title: revision.title,
    conclusion: revision.conclusion,
    dimensionIds: [...new Set(revision.dimensionIds)],
    practiceGuideIds: [...new Set(revision.practiceGuideIds)],
    citations: cloneCitations(revision.citations, event.id),
    navigationCost: cloneNavigationCost(revision.navigationCost, event.id),
    provenance: {
      previousRevisionId: revision.provenance.previousRevisionId,
      amendmentReason: revision.provenance.amendmentReason,
      actor: revision.provenance.actor,
      occurredAt: revision.provenance.occurredAt,
      causedByCitations: cloneCitations(
        revision.provenance.causedByCitations,
        event.id,
      ),
    },
  };
}

function clonePathNode(node, eventId) {
  if (!node || typeof node !== "object") {
    fail("invalid_behavior_path_node", "A behavior path node is required.", eventId);
  }
  validateIdentifier(node.label, "behavior path node label", eventId);
  if (node.status === "known") {
    const citations = cloneCitations(node.citations, eventId);
    if (citations.length === 0) {
      fail(
        "uncited_behavior_path_node",
        "A known behavior path node requires at least one citation.",
        eventId,
      );
    }
    return { status: "known", label: node.label, citations };
  }
  if (node.status === "unknown") {
    validateIdentifier(node.reason, "unknown behavior path reason", eventId);
    if (!Array.isArray(node.citations) || node.citations.length !== 0) {
      fail(
        "invalid_unknown_path_citations",
        "An unknown behavior path node must use an empty citations array.",
        eventId,
      );
    }
    return {
      status: "unknown",
      label: node.label,
      reason: node.reason,
      citations: [],
    };
  }
  fail(
    "invalid_behavior_path_status",
    "Behavior path node status must be known or unknown.",
    eventId,
  );
}

function clonePathNodeList(nodes, field, eventId) {
  if (!Array.isArray(nodes)) {
    fail("invalid_behavior_path", `${field} must be an array.`, eventId);
  }
  return nodes.map((node) => clonePathNode(node, eventId));
}

function activeCurrentRevisions(state) {
  return Object.values(state.findings)
    .map((entry) => entry.currentRevision)
    .filter((revision) => !INACTIVE_FINDING_STATES.has(revision.state));
}

function citationKey(citation) {
  return [
    citation.path,
    citation.startLine,
    citation.endLine,
    citation.symbol ?? "",
    citation.source,
  ].join("\u0000");
}

function coverageFor(dimensionId, revisions) {
  const bySource = emptySourceCounts();
  const citationKeys = new Set();
  let codeOrTestCitationCount = 0;
  for (const revision of revisions) {
    for (const citation of revision.citations) {
      const key = citationKey(citation);
      if (citationKeys.has(key)) continue;
      citationKeys.add(key);
      bySource[citation.source] += 1;
      if (citation.source === "production_code" || citation.source === "test") {
        codeOrTestCitationCount += 1;
      }
    }
  }
  const requirement =
    GENERAL_DIMENSION_EVIDENCE_REQUIREMENTS[dimensionId];
  const hasEvidence = citationKeys.size > 0;
  const requirementSatisfied =
    !requirement.requiresCodeOrTestEvidence || codeOrTestCitationCount > 0;
  return {
    bySource,
    distinctCitationCount: citationKeys.size,
    codeOrTestCitationCount,
    requiresCodeOrTestEvidence: requirement.requiresCodeOrTestEvidence,
    requirementSatisfied,
    state: hasEvidence && requirementSatisfied ? "adequate" : "insufficient",
  };
}

function validateDimensionSupport(state, payload, eventId) {
  if (!DIMENSION_ID_SET.has(payload.dimensionId)) {
    fail(
      "invalid_dimension_id",
      `Unknown dimension: ${payload.dimensionId}.`,
      eventId,
    );
  }
  validateFiniteNumber(payload.confidence, "confidence", eventId);
  if (payload.confidence > 1) {
    fail("invalid_confidence", "confidence must be between 0 and 1.", eventId);
  }
  if (
    !Array.isArray(payload.supportingPositiveFindingIds) ||
    !Array.isArray(payload.supportingFrictionFindingIds) ||
    !Array.isArray(payload.limitations)
  ) {
    fail(
      "invalid_dimension_payload",
      "Dimension support and limitations must be arrays.",
      eventId,
    );
  }
  const positiveIds = [...new Set(payload.supportingPositiveFindingIds)];
  const frictionIds = [...new Set(payload.supportingFrictionFindingIds)];
  const overlap = positiveIds.find((id) => frictionIds.includes(id));
  if (overlap) {
    fail(
      "conflicting_dimension_support",
      `Finding ${overlap} cannot be both positive and friction support.`,
      eventId,
    );
  }
  const validateIds = (ids, signal) => {
    for (const findingId of ids) {
      const entry = state.findings[findingId];
      if (!entry) {
        fail(
          "unknown_supporting_finding",
          `Dimension support references unknown finding ${findingId}.`,
          eventId,
        );
      }
      const revision = entry.currentRevision;
      if (INACTIVE_FINDING_STATES.has(revision.state)) {
        fail(
          "inactive_supporting_finding",
          `Finding ${findingId} is ${revision.state} and cannot support a current assessment.`,
          eventId,
        );
      }
      if (revision.signal !== signal) {
        fail(
          "mismatched_supporting_signal",
          `Finding ${findingId} is not a ${signal} finding.`,
          eventId,
        );
      }
      if (!revision.dimensionIds.includes(payload.dimensionId)) {
        fail(
          "mismatched_supporting_dimension",
          `Finding ${findingId} does not support ${payload.dimensionId}.`,
          eventId,
        );
      }
    }
  };
  validateIds(positiveIds, "positive");
  validateIds(frictionIds, "friction");
  return {
    positiveIds,
    frictionIds,
    limitations: payload.limitations.map((limitation) => {
      validateIdentifier(limitation, "dimension limitation", eventId);
      return limitation;
    }),
  };
}

function recomputeDerivedState(state) {
  const activeRevisions = activeCurrentRevisions(state);
  for (const dimensionId of WAYMARK_DIMENSION_IDS) {
    const allDimensionRevisions = activeRevisions.filter((revision) =>
      revision.dimensionIds.includes(dimensionId),
    );
    state.evidenceCoverage[dimensionId] = coverageFor(
      dimensionId,
      allDimensionRevisions,
    );

    const dimension = state.dimensions[dimensionId];
    const activePositiveIds = dimension.supportingPositiveFindingIds.filter(
      (findingId) => {
        const revision = state.findings[findingId]?.currentRevision;
        return revision && !INACTIVE_FINDING_STATES.has(revision.state);
      },
    );
    const activeFrictionIds = dimension.supportingFrictionFindingIds.filter(
      (findingId) => {
        const revision = state.findings[findingId]?.currentRevision;
        return revision && !INACTIVE_FINDING_STATES.has(revision.state);
      },
    );
    const supportingRevisions = [...activePositiveIds, ...activeFrictionIds].map(
      (findingId) => state.findings[findingId].currentRevision,
    );
    dimension.supportingPositiveFindingIds = activePositiveIds;
    dimension.supportingFrictionFindingIds = activeFrictionIds;
    dimension.evidenceCoverage = coverageFor(
      dimensionId,
      supportingRevisions.length > 0
        ? supportingRevisions
        : allDimensionRevisions,
    );
    if (
      dimension.assessmentState === "assessed" &&
      (supportingRevisions.length === 0 ||
        dimension.evidenceCoverage.state !== "adequate")
    ) {
      dimension.assessmentState = "in_progress";
      dimension.score = null;
      if (
        !dimension.limitations.includes(
          "Current supporting evidence no longer satisfies assessment coverage.",
        )
      ) {
        dimension.limitations = [
          ...dimension.limitations,
          "Current supporting evidence no longer satisfies assessment coverage.",
        ];
      }
    }
  }

  const assessedDimensions = Object.values(state.dimensions).filter(
    (dimension) =>
      dimension.assessmentState === "assessed" &&
      dimension.evidenceCoverage.state === "adequate",
  );
  state.assessedWeight = assessedDimensions.reduce(
    (total, dimension) => total + dimension.weight,
    0,
  );
  state.weightedPoints = assessedDimensions.reduce(
    (total, dimension) => total + (dimension.score * dimension.weight) / 100,
    0,
  );
  state.auditorAssessedResult =
    state.assessedWeight === 100 ? state.weightedPoints : null;

  const revisions = Object.values(state.findings).flatMap(
    (entry) => entry.revisions,
  );
  const usableCitationCount = new Set(
    revisions.flatMap((revision) => revision.citations.map(citationKey)),
  ).size;
  state.partialReport = {
    available: usableCitationCount > 0,
    usableCitationCount,
    findingCount: state.findingOrder.length,
    revisionCount: revisions.length,
  };
}

function validateEventEnvelope(event, state) {
  if (!event || typeof event !== "object") {
    fail("invalid_event", "Every event must be an object.");
  }
  validateIdentifier(event.id, "event.id", event.id ?? null);
  validateIdentifier(event.runId, "event.runId", event.id);
  validateIdentifier(event.actor, "event.actor", event.id);
  validateIdentifier(event.occurredAt, "event.occurredAt", event.id);
  if (!EVENT_TYPE_SET.has(event.type)) {
    fail("unknown_event_type", `Unknown event type: ${event.type}.`, event.id);
  }
  if (!Number.isInteger(event.sequence) || event.sequence <= state.lastSequence) {
    fail(
      "invalid_event_sequence",
      "Event sequence must be a strictly increasing positive integer.",
      event.id,
    );
  }
  if (state.runId !== null && state.runId !== event.runId) {
    fail(
      "mixed_run_stream",
      "A projection cannot combine events from different runs.",
      event.id,
    );
  }
  if (event.type !== "general.audit.started" && state.status === "not_started") {
    fail(
      "audit_not_started",
      "The first semantic checkpoint must be general.audit.started.",
      event.id,
    );
  }
  if (
    ["completed", "partial", "failed", "cancelled"].includes(state.status)
  ) {
    fail(
      "event_after_terminal",
      `Cannot project ${event.type} after terminal status ${state.status}.`,
      event.id,
    );
  }
}

function applyStarted(state, event) {
  if (state.status !== "not_started") {
    fail("duplicate_audit_start", "The audit has already started.", event.id);
  }
  validateIdentifier(
    event.payload.repositoryIdentity,
    "repositoryIdentity",
    event.id,
  );
  validateIdentifier(event.payload.commitSha, "commitSha", event.id);
  validateIdentifier(
    event.payload.protocolVersion,
    "protocolVersion",
    event.id,
  );
  state.runId = event.runId;
  state.status = "active";
  state.repositoryIdentity = event.payload.repositoryIdentity;
  state.commitSha = event.payload.commitSha;
  state.protocolVersion = event.payload.protocolVersion;
  state.startedAt = event.occurredAt;
}

function applySurfaceInspected(state, event) {
  if (!SURFACE_SET.has(event.payload.surface)) {
    fail(
      "invalid_audit_surface",
      `Unknown general-audit surface: ${event.payload.surface}.`,
      event.id,
    );
  }
  validateIdentifier(event.payload.summary, "surface summary", event.id);
  state.surfaces.push({
    surface: event.payload.surface,
    summary: event.payload.summary,
    citations: cloneCitations(event.payload.citations, event.id),
    inspectedAt: event.occurredAt,
    actor: event.actor,
  });
}

function applyBehaviorPathRecorded(state, event) {
  const payload = event.payload;
  validateIdentifier(payload.pathId, "pathId", event.id);
  validateIdentifier(payload.name, "behavior path name", event.id);
  if (state.behaviorPaths[payload.pathId]) {
    fail(
      "duplicate_behavior_path",
      `Behavior path ${payload.pathId} is already recorded.`,
      event.id,
    );
  }
  state.behaviorPaths[payload.pathId] = {
    pathId: payload.pathId,
    name: payload.name,
    entryPoint: clonePathNode(payload.entryPoint, event.id),
    owner: clonePathNode(payload.owner, event.id),
    dependencies: clonePathNodeList(
      payload.dependencies,
      "dependencies",
      event.id,
    ),
    consumers: clonePathNodeList(payload.consumers, "consumers", event.id),
    tests: clonePathNodeList(payload.tests, "tests", event.id),
    observedAt: event.occurredAt,
    actor: event.actor,
  };
  state.behaviorPathOrder.push(payload.pathId);
}

function applyFindingRecorded(state, event) {
  const revision = cloneRevision(event.payload.revision, event, "recorded");
  if (state.findings[revision.findingId]) {
    fail(
      "duplicate_finding",
      `Finding ${revision.findingId} is already recorded.`,
      event.id,
    );
  }
  state.findings[revision.findingId] = {
    findingId: revision.findingId,
    currentRevision: revision,
    revisions: [revision],
    navigationCostHistory:
      revision.navigationCost === null
        ? []
        : [
            {
              revisionId: revision.revisionId,
              observation: revision.navigationCost,
            },
          ],
  };
  state.findingOrder.push(revision.findingId);
}

function applyFindingRevised(state, event) {
  const revision = cloneRevision(event.payload.revision, event, "revised");
  const entry = state.findings[revision.findingId];
  if (!entry) {
    fail(
      "unknown_finding",
      `Cannot revise unknown finding ${revision.findingId}.`,
      event.id,
    );
  }
  const previous = entry.currentRevision;
  if (
    revision.provenance.previousRevisionId !== previous.revisionId ||
    revision.revisionNumber !== previous.revisionNumber + 1
  ) {
    fail(
      "wrong_prior_revision",
      `Finding ${revision.findingId} must revise ${previous.revisionId} as revision ${previous.revisionNumber + 1}.`,
      event.id,
    );
  }
  if (
    (revision.state === "located_late" || revision.state === "reframed") &&
    revision.provenance.amendmentReason.trim().length === 0
  ) {
    fail(
      "missing_revision_explanation",
      `${revision.state} revisions must explain the new conclusion.`,
      event.id,
    );
  }
  if (
    entry.revisions.some(
      (existing) => existing.revisionId === revision.revisionId,
    )
  ) {
    fail(
      "duplicate_revision",
      `Revision ${revision.revisionId} is already present.`,
      event.id,
    );
  }
  entry.currentRevision = revision;
  entry.revisions = [...entry.revisions, revision];
  if (revision.navigationCost !== null) {
    entry.navigationCostHistory = [
      ...entry.navigationCostHistory,
      {
        revisionId: revision.revisionId,
        observation: revision.navigationCost,
      },
    ];
  }
}

function applyDimensionProgress(state, event, assessed) {
  const payload = event.payload;
  const support = validateDimensionSupport(state, payload, event.id);
  const supportingRevisions = [
    ...support.positiveIds,
    ...support.frictionIds,
  ].map((findingId) => state.findings[findingId].currentRevision);
  const coverage = coverageFor(payload.dimensionId, supportingRevisions);
  if (assessed) {
    validateFiniteNumber(payload.score, "score", event.id);
    if (payload.score > 100) {
      fail("invalid_dimension_score", "score must be between 0 and 100.", event.id);
    }
    if (supportingRevisions.length === 0 || coverage.state !== "adequate") {
      fail(
        "insufficient_dimension_evidence",
        `${payload.dimensionId} cannot be assessed without adequate cited evidence.`,
        event.id,
      );
    }
    if (
      payload.score >= GENERAL_STRONG_SCORE_MINIMUM &&
      support.positiveIds.length === 0
    ) {
      fail(
        "strong_assessment_requires_positive_evidence",
        `${payload.dimensionId} cannot receive a strong assessment without a current cited positive finding.`,
        event.id,
      );
    }
    if (
      payload.score < GENERAL_STRONG_SCORE_MINIMUM &&
      support.frictionIds.length === 0
    ) {
      fail(
        "non_strong_assessment_requires_friction",
        `${payload.dimensionId} cannot receive a mixed or weak assessment without a current cited friction finding.`,
        event.id,
      );
    }
  }
  state.dimensions[payload.dimensionId] = {
    dimensionId: payload.dimensionId,
    weight: GENERAL_DIMENSION_WEIGHTS[payload.dimensionId],
    assessmentState: assessed ? "assessed" : "in_progress",
    score: assessed ? payload.score : null,
    confidence: payload.confidence,
    evidenceCoverage: coverage,
    supportingPositiveFindingIds: support.positiveIds,
    supportingFrictionFindingIds: support.frictionIds,
    limitations: support.limitations,
  };
}

function validatePracticeFindingIds(state, payload, eventId, field, signal) {
  if (!Array.isArray(payload[field])) {
    fail("invalid_practice_support", `${field} must be an array.`, eventId);
  }
  const ids = [...new Set(payload[field])];
  for (const findingId of ids) {
    const revision = state.findings[findingId]?.currentRevision;
    if (!revision) {
      fail("unknown_practice_finding", `Practice support references unknown finding ${findingId}.`, eventId);
    }
    if (INACTIVE_FINDING_STATES.has(revision.state) || revision.signal !== signal) {
      fail("invalid_practice_finding", `Finding ${findingId} is not current ${signal} evidence.`, eventId);
    }
    if (!revision.practiceGuideIds.includes(payload.principleId)) {
      fail("mismatched_practice_finding", `Finding ${findingId} does not reference ${payload.principleId}.`, eventId);
    }
  }
  return ids;
}

function applyPracticeAssessed(state, event) {
  const payload = event.payload;
  if (!PRACTICE_GUIDE_ID_SET.has(payload.principleId)) {
    fail("invalid_practice_id", `Unknown Practice Guide principle ${payload.principleId}.`, event.id);
  }
  if (!PRACTICE_ASSESSMENT_SET.has(payload.assessment)) {
    fail("invalid_practice_assessment", "Practice assessment must be strong, mixed, weak, or not_assessed.", event.id);
  }
  validateIdentifier(payload.summary, "practice summary", event.id);
  validateIdentifier(payload.navigationTokenMechanism, "navigationTokenMechanism", event.id);
  if (!Array.isArray(payload.surfacesInspected) || payload.surfacesInspected.some((surface) => !SURFACE_SET.has(surface))) {
    fail("invalid_practice_surfaces", "surfacesInspected contains an unknown surface.", event.id);
  }
  if (!Array.isArray(payload.limitations) || !Array.isArray(payload.recommendationIds)) {
    fail("invalid_practice_arrays", "Practice limitations and recommendationIds must be arrays.", event.id);
  }
  const positiveIds = validatePracticeFindingIds(
    state, payload, event.id, "supportingPositiveFindingIds", "positive",
  );
  const frictionIds = validatePracticeFindingIds(
    state, payload, event.id, "supportingFrictionFindingIds", "friction",
  );
  if (payload.assessment === "strong" && positiveIds.length === 0) {
    fail("strong_practice_requires_positive_evidence", "A strong Practice Guide assessment requires cited positive evidence.", event.id);
  }
  if (["mixed", "weak"].includes(payload.assessment) && frictionIds.length === 0) {
    fail("non_strong_practice_requires_friction", "A mixed or weak Practice Guide assessment requires cited friction.", event.id);
  }
  if (payload.assessment === "not_assessed" && payload.limitations.length === 0) {
    fail("not_assessed_requires_limitation", "A not_assessed principle requires an explicit evidence limitation.", event.id);
  }
  if (payload.principleId === "canonicalWorkflow") {
    if (!Array.isArray(payload.workflowEntryPoints) || payload.workflowEntryPoints.length === 0) {
      fail("canonical_workflow_requires_entry_points", "canonicalWorkflow requires discovered workflowEntryPoints.", event.id);
    }
    validateIdentifier(payload.workflowConclusion, "workflowConclusion", event.id);
  }
  for (const limitation of payload.limitations) {
    validateIdentifier(limitation, "practice limitation", event.id);
  }
  const codeJudgmentPrinciples = new Set([
    "organizeAroundBehavior",
    "explicitDependencyDirection",
    "conceptOwningNames",
    "testsMirrorBehavior",
  ]);
  if (payload.assessment !== "not_assessed" && codeJudgmentPrinciples.has(payload.principleId)) {
    const citedRevisions = [...positiveIds, ...frictionIds].map(
      (findingId) => state.findings[findingId].currentRevision,
    );
    if (!citedRevisions.some((revision) =>
      revision.citations.some(({ source }) => source === "production_code" || source === "test"))) {
      fail("practice_requires_code_or_test_evidence", `${payload.principleId} requires production-code or test evidence.`, event.id);
    }
  }
  state.practices[payload.principleId] = {
    ...state.practices[payload.principleId],
    assessment: payload.assessment,
    summary: payload.summary,
    surfacesInspected: [...new Set(payload.surfacesInspected)],
    supportingPositiveFindingIds: positiveIds,
    supportingFrictionFindingIds: frictionIds,
    limitations: [...payload.limitations],
    navigationTokenMechanism: payload.navigationTokenMechanism,
    recommendationIds: [...new Set(payload.recommendationIds)],
    workflowEntryPoints: [...(payload.workflowEntryPoints ?? [])],
    workflowConclusion: payload.workflowConclusion ?? null,
    dispositionRecorded: true,
    assessedAt: event.occurredAt,
    actor: event.actor,
  };
}

function applyRecommendationRecorded(state, event) {
  const payload = event.payload;
  validateIdentifier(payload.recommendationId, "recommendationId", event.id);
  validateIdentifier(payload.title, "recommendation title", event.id);
  validateIdentifier(payload.rationale, "recommendation rationale", event.id);
  validateIdentifier(payload.tokenMechanism, "recommendation tokenMechanism", event.id);
  validateIdentifier(payload.validationCheck, "recommendation validationCheck", event.id);
  if (
    state.recommendations.some(
      (recommendation) =>
        recommendation.recommendationId === payload.recommendationId,
    )
  ) {
    fail(
      "duplicate_recommendation",
      `Recommendation ${payload.recommendationId} is already recorded.`,
      event.id,
    );
  }
  if (
    !Array.isArray(payload.findingIds) ||
    payload.findingIds.length === 0 ||
    payload.findingIds.some((findingId) => !state.findings[findingId])
  ) {
    fail(
      "unknown_recommendation_finding",
      "Recommendation findingIds must reference at least one recorded finding.",
      event.id,
    );
  }
  for (const findingId of payload.findingIds) {
    const revision = state.findings[findingId].currentRevision;
    if (
      INACTIVE_FINDING_STATES.has(revision.state) ||
      revision.citations.length === 0 ||
      revision.signal !== "friction"
    ) {
      fail(
        "unsupported_recommendation_finding",
        `Recommendation finding ${findingId} must be current, cited friction.`,
        event.id,
      );
    }
  }
  if (!Array.isArray(payload.practiceGuideIds) || payload.practiceGuideIds.some((id) => !PRACTICE_GUIDE_ID_SET.has(id))) {
    fail("invalid_recommendation_practice", "Recommendation practiceGuideIds contains an unknown principle.", event.id);
  }
  if (!Array.isArray(payload.limitations)) {
    fail("invalid_recommendation_limitations", "Recommendation limitations must be an array.", event.id);
  }
  if (
    !Array.isArray(payload.dimensionIds) ||
    payload.dimensionIds.some((dimensionId) => !DIMENSION_ID_SET.has(dimensionId))
  ) {
    fail(
      "invalid_recommendation_dimension",
      "Recommendation dimensionIds contains an unknown dimension.",
      event.id,
    );
  }
  for (const dimensionId of payload.dimensionIds) {
    if (
      !payload.findingIds.some((findingId) =>
        state.findings[findingId].currentRevision.dimensionIds.includes(
          dimensionId,
        ),
      )
    ) {
      fail(
        "unsupported_recommendation_dimension",
        `Recommendation dimension ${dimensionId} is not supported by a referenced current finding.`,
        event.id,
      );
    }
  }
  state.recommendations.push({
    recommendationId: payload.recommendationId,
    title: payload.title,
    rationale: payload.rationale,
    findingIds: [...new Set(payload.findingIds)],
    dimensionIds: [...new Set(payload.dimensionIds)],
    practiceGuideIds: [...new Set(payload.practiceGuideIds)],
    tokenMechanism: payload.tokenMechanism,
    validationCheck: payload.validationCheck,
    limitations: [...payload.limitations],
    recordedAt: event.occurredAt,
    actor: event.actor,
  });
}

function applyContinuationRecorded(state, event) {
  const payload = event.payload;
  validateIdentifier(payload.continuationId, "continuationId", event.id);
  validateIdentifier(payload.providerSessionId, "providerSessionId", event.id);
  validateIdentifier(payload.reason, "continuation reason", event.id);
  if (
    !Array.isArray(payload.inspectedSurfaces) ||
    payload.inspectedSurfaces.some((surface) => !SURFACE_SET.has(surface))
  ) {
    fail(
      "invalid_continuation_surfaces",
      "Continuation inspectedSurfaces contains an unknown surface.",
      event.id,
    );
  }
  if (
    !Array.isArray(payload.remainingDimensionIds) ||
    payload.remainingDimensionIds.some(
      (dimensionId) => !DIMENSION_ID_SET.has(dimensionId),
    )
  ) {
    fail(
      "invalid_continuation_dimensions",
      "Continuation remainingDimensionIds contains an unknown dimension.",
      event.id,
    );
  }
  if (!Array.isArray(payload.openQuestions)) {
    fail(
      "invalid_continuation_questions",
      "Continuation openQuestions must be an array.",
      event.id,
    );
  }
  for (const question of payload.openQuestions) {
    validateIdentifier(question, "continuation open question", event.id);
  }
  if (
    state.continuations.some(
      ({ continuationId }) => continuationId === payload.continuationId,
    )
  ) {
    fail(
      "duplicate_continuation",
      `Continuation ${payload.continuationId} is already recorded.`,
      event.id,
    );
  }
  state.continuations.push({
    continuationId: payload.continuationId,
    providerSessionId: payload.providerSessionId,
    reason: payload.reason,
    inspectedSurfaces: [...new Set(payload.inspectedSurfaces)],
    openQuestions: [...payload.openQuestions],
    remainingDimensionIds: [...new Set(payload.remainingDimensionIds)],
    recordedAt: event.occurredAt,
    actor: event.actor,
  });
}

function applyFrictionDispositionRecorded(state, event) {
  const payload = event.payload;
  validateIdentifier(payload.findingId, "findingId", event.id);
  if (!FRICTION_DISPOSITION_SET.has(payload.disposition)) {
    fail("invalid_friction_disposition", "Unknown friction disposition.", event.id);
  }
  const revision = state.findings[payload.findingId]?.currentRevision;
  if (!revision || revision.signal !== "friction" || INACTIVE_FINDING_STATES.has(revision.state)) {
    fail("invalid_disposition_finding", "A disposition requires a current friction finding.", event.id);
  }
  const linksRecommendation = ["covered", "consolidated"].includes(payload.disposition);
  if (linksRecommendation) {
    validateIdentifier(payload.recommendationId, "recommendationId", event.id);
    const recommendation = state.recommendations.find(
      ({ recommendationId }) => recommendationId === payload.recommendationId,
    );
    if (!recommendation || !recommendation.findingIds.includes(payload.findingId)) {
      fail("invalid_disposition_recommendation", "The linked recommendation must exist and cite this finding.", event.id);
    }
  } else {
    validateIdentifier(payload.reason, "disposition reason", event.id);
  }
  state.frictionDispositions[payload.findingId] = {
    findingId: payload.findingId,
    disposition: payload.disposition,
    recommendationId: linksRecommendation ? payload.recommendationId : null,
    reason: linksRecommendation ? null : payload.reason,
    recordedAt: event.occurredAt,
    actor: event.actor,
  };
}

function applySynthesisCompleted(state, event) {
  if (!["completed", "partial"].includes(event.payload.outcome)) {
    fail(
      "invalid_synthesis_outcome",
      "Synthesis outcome must be completed or partial.",
      event.id,
    );
  }
  validateIdentifier(event.payload.summary, "synthesis summary", event.id);
  if (!Array.isArray(event.payload.limitations)) {
    fail(
      "invalid_synthesis_limitations",
      "Synthesis limitations must be an array.",
      event.id,
    );
  }
  recomputeDerivedState(state);
  const recordedPractices = Object.values(state.practices).filter(
    ({ dispositionRecorded }) => dispositionRecorded,
  );
  if (
    event.payload.outcome === "completed" &&
    recordedPractices.length !== PRACTICE_GUIDE_IDS.length
  ) {
    fail(
      "incomplete_practice_profile",
      "Synthesis requires one repository-specific disposition for all seven Practice Guide principles.",
      event.id,
    );
  }
  for (const practice of recordedPractices) {
    const missingRecommendation = practice.recommendationIds.find(
      (recommendationId) =>
        !state.recommendations.some(
          (recommendation) => recommendation.recommendationId === recommendationId,
        ),
    );
    if (missingRecommendation) {
      fail(
        "unknown_practice_recommendation",
        `Practice ${practice.principleId} references unknown recommendation ${missingRecommendation}.`,
        event.id,
      );
    }
    if (
      ["mixed", "weak"].includes(practice.assessment) &&
      practice.recommendationIds.length === 0 &&
      practice.limitations.length === 0
    ) {
      fail(
        "undisposed_practice_friction",
        `Practice ${practice.principleId} requires a recommendation or explicit limitation.`,
        event.id,
      );
    }
  }
  const undisposedFriction = activeCurrentRevisions(state)
    .filter(({ signal }) => signal === "friction")
    .map(({ findingId }) => findingId)
    .filter((findingId) => !state.frictionDispositions[findingId]);
  if (event.payload.outcome === "completed" && undisposedFriction.length > 0) {
    fail(
      "undisposed_friction",
      `Current friction findings require dispositions: ${undisposedFriction.join(", ")}.`,
      event.id,
    );
  }
  if (
    event.payload.outcome === "completed" &&
    state.auditorAssessedResult === null
  ) {
    fail(
      "incomplete_dimension_assessment",
      "A completed general audit requires adequate assessments for all dimensions.",
      event.id,
    );
  }
  if (
    event.payload.outcome === "partial" &&
    !state.partialReport.available
  ) {
    fail(
      "partial_without_evidence",
      "A partial audit requires usable cited evidence.",
      event.id,
    );
  }
  state.status = event.payload.outcome;
  state.finishedAt = event.occurredAt;
  state.synthesis = {
    summary: event.payload.summary,
    limitations: event.payload.limitations.map((limitation) => {
      validateIdentifier(limitation, "synthesis limitation", event.id);
      return limitation;
    }),
  };
}

function applyAuditInterrupted(state, event) {
  if (!["partial", "failed", "cancelled"].includes(event.payload.outcome)) {
    fail(
      "invalid_interruption_outcome",
      "Interruption outcome must be partial, failed, or cancelled.",
      event.id,
    );
  }
  validateIdentifier(event.payload.reason, "interruption reason", event.id);
  recomputeDerivedState(state);
  if (
    event.payload.outcome === "partial" &&
    !state.partialReport.available
  ) {
    fail(
      "partial_without_evidence",
      "A partial audit requires usable cited evidence.",
      event.id,
    );
  }
  if (event.payload.outcome === "failed" && state.partialReport.available) {
    fail(
      "failed_with_usable_evidence",
      "An interrupted audit with usable cited evidence must be partial, not failed.",
      event.id,
    );
  }
  state.status = event.payload.outcome;
  state.finishedAt = event.occurredAt;
  state.interruption = {
    reason: event.payload.reason,
    outcome: event.payload.outcome,
  };
}

const EVENT_APPLIERS = {
  "general.audit.started": applyStarted,
  "general.surface.inspected": applySurfaceInspected,
  "general.behavior_path.recorded": applyBehaviorPathRecorded,
  "general.finding.recorded": applyFindingRecorded,
  "general.finding.revised": applyFindingRevised,
  "general.dimension.progress": (state, event) =>
    applyDimensionProgress(state, event, false),
  "general.dimension.assessed": (state, event) =>
    applyDimensionProgress(state, event, true),
  "general.practice.assessed": applyPracticeAssessed,
  "general.recommendation.recorded": applyRecommendationRecorded,
  "general.friction.disposition.recorded": applyFrictionDispositionRecorded,
  "general.continuation.recorded": applyContinuationRecorded,
  "general.synthesis.completed": applySynthesisCompleted,
  "general.audit.interrupted": applyAuditInterrupted,
};

/**
 * Fold normalized semantic checkpoints into the current general-audit read
 * model. Provider telemetry is intentionally not part of this event stream.
 */
export function projectGeneralAudit(events) {
  if (!Array.isArray(events)) {
    fail("invalid_event_stream", "events must be an array.");
  }
  const state = initialState();
  const eventIds = new Set();
  for (const event of events) {
    validateEventEnvelope(event, state);
    if (eventIds.has(event.id)) {
      fail("duplicate_event", `Event ${event.id} is duplicated.`, event.id);
    }
    eventIds.add(event.id);
    EVENT_APPLIERS[event.type](state, event);
    state.lastSequence = event.sequence;
    recomputeDerivedState(state);
  }
  return state;
}
