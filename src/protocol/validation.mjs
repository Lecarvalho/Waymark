import {
  GENERAL_AUDIT_EVENT_TYPES,
  GENERAL_AUDIT_SURFACES,
  GENERAL_EVIDENCE_SOURCES,
  GENERAL_FINDING_SIGNALS,
  GENERAL_FINDING_STATES,
  GENERAL_FRICTION_DISPOSITIONS,
  GENERAL_PRACTICE_ASSESSMENTS,
  PRACTICE_GUIDE_IDS,
  WAYMARK_DIMENSION_IDS,
} from "../domain/general-audit.mjs";

const RUN_STATUSES = new Set([
  "active",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
const PARTICIPANT_ROLES = new Set([
  "orchestrator",
  "candidate",
  "independent",
  "verifier",
  "reporter",
  "auditor",
]);
const CLAIM_CRITICALITIES = new Set(["critical", "high", "medium", "low"]);
const VERIFICATION_VERDICTS = new Set([
  "verified",
  "contradicted",
  "unverified",
]);
const VERIFICATION_METHODS = new Set([
  "static_inspection",
  "executable_probe",
  "independent_model",
  "none",
]);
const TOKEN_PHASES = new Set([
  "candidate_navigation",
  "general_research",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
]);
const TOKEN_SOURCES = new Set([
  "provider_reported",
  "measured",
  "estimated",
]);
const RECOMMENDATION_PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const PRACTICE_IDS = new Set(["01", "02", "03", "04", "05", "06", "07"]);
const SCORE_DIMENSIONS = new Set([
  "discoveryEfficiency",
  "ownershipClarity",
  "dependencyClarity",
  "changeSurfaceRecall",
  "verificationDiscoverability",
  "instructionQuality",
]);
const GENERAL_EVENT_TYPES = new Set(GENERAL_AUDIT_EVENT_TYPES);
const GENERAL_SURFACES = new Set(GENERAL_AUDIT_SURFACES);
const GENERAL_SOURCES = new Set(GENERAL_EVIDENCE_SOURCES);
const GENERAL_STATES = new Set(GENERAL_FINDING_STATES);
const GENERAL_SIGNALS = new Set(GENERAL_FINDING_SIGNALS);
const GENERAL_DIMENSIONS = new Set(WAYMARK_DIMENSION_IDS);
const GENERAL_PRACTICES = new Set(PRACTICE_GUIDE_IDS);
const GENERAL_PRACTICE_STATES = new Set(GENERAL_PRACTICE_ASSESSMENTS);
const GENERAL_DISPOSITIONS = new Set(GENERAL_FRICTION_DISPOSITIONS);
const GENERAL_AUDITOR_PERMISSION_MODES = new Set([
  "read_only",
  "unrestricted_no_approval",
]);

export class ProtocolValidationError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "ProtocolValidationError";
    this.code = "INVALID_INPUT";
    this.details = details;
  }
}

function fail(path, message) {
  throw new ProtocolValidationError(`${path}: ${message}`, { path, message });
}

function object(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "must be a JSON object");
  }
  return value;
}

function strictObject(value, path, fields) {
  const normalized = object(value, path);
  const allowed = new Set(fields);
  for (const field of Object.keys(normalized)) {
    if (!allowed.has(field)) {
      fail(`${path}.${field}`, "is not an allowed field");
    }
  }
  return normalized;
}

function string(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
  return value.trim();
}

function optionalString(value, path) {
  return value === undefined || value === null ? undefined : string(value, path);
}

function enumeration(value, allowed, path) {
  const normalized = string(value, path);
  if (!allowed.has(normalized)) {
    fail(path, `must be one of: ${[...allowed].join(", ")}`);
  }
  return normalized;
}

function timestamp(value, path, fallback) {
  if (value === undefined || value === null) return fallback;
  const normalized = string(value, path);
  if (Number.isNaN(Date.parse(normalized))) {
    fail(path, "must be an ISO-8601 timestamp");
  }
  return new Date(normalized).toISOString();
}

function integer(value, path, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(path, "must be a non-negative safe integer");
  }
  return value;
}

function optionalInteger(value, path) {
  return value === undefined || value === null
    ? null
    : integer(value, path);
}

function id(value, path, createId) {
  return value === undefined || value === null
    ? createId()
    : string(value, path);
}

function stringArray(value, path, { minimum = 0, maximum = 20 } = {}) {
  if (!Array.isArray(value)) {
    fail(path, "must be an array");
  }
  if (value.length < minimum || value.length > maximum) {
    fail(path, `must contain from ${minimum} through ${maximum} items`);
  }
  return value.map((item, index) => string(item, `${path}[${index}]`));
}

export function validateCreateRun(value, { now, createId }) {
  const input = object(value, "input");
  const name = optionalString(input.name, "name") ?? null;
  if (name !== null && name.length > 72) {
    fail("name", "must be 72 characters or fewer");
  }
  if (!Array.isArray(input.participants) || input.participants.length === 0) {
    fail("participants", "must be a non-empty array");
  }

  const participants = input.participants.map((item, index) => {
    const participant = object(item, `participants[${index}]`);
    return {
      id: id(participant.id, `participants[${index}].id`, createId),
      role: enumeration(
        participant.role,
        PARTICIPANT_ROLES,
        `participants[${index}].role`,
      ),
      provider: string(
        participant.provider,
        `participants[${index}].provider`,
      ),
      model: string(participant.model, `participants[${index}].model`),
      modelVersion:
        optionalString(
          participant.modelVersion,
          `participants[${index}].modelVersion`,
        ) ?? null,
    };
  });

  const runConditions = object(input.runConditions, "runConditions");
  if (runConditions.auditMode === "general") {
    if (
      participants.length !== 1 ||
      participants[0].role !== "auditor"
    ) {
      fail(
        "participants",
        "general audits require exactly one auditor role",
      );
    }
    const auditorPermissionMode =
      runConditions.auditorPermissionMode ?? "read_only";
    enumeration(
      auditorPermissionMode,
      GENERAL_AUDITOR_PERMISSION_MODES,
      "runConditions.auditorPermissionMode",
    );
    if (auditorPermissionMode === "unrestricted_no_approval") {
      const toolPolicy = object(input.toolPolicy, "toolPolicy");
      if (toolPolicy.target !== "full-access") {
        fail(
          "toolPolicy.target",
          "must be full-access for an unrestricted general auditor",
        );
      }
      if (toolPolicy.sandboxMode !== "danger-full-access") {
        fail(
          "toolPolicy.sandboxMode",
          "must be danger-full-access for an unrestricted general auditor",
        );
      }
      if (toolPolicy.approvalPolicy !== "never") {
        fail(
          "toolPolicy.approvalPolicy",
          "must be never for an unrestricted general auditor",
        );
      }
    }
  } else {
    for (const requiredRole of ["candidate", "orchestrator"]) {
      if (!participants.some(({ role }) => role === requiredRole)) {
        fail("participants", `must include a ${requiredRole} role`);
      }
    }
  }

  const roles = new Set();
  for (const participant of participants) {
    if (roles.has(participant.role)) {
      fail("participants", `contains duplicate role: ${participant.role}`);
    }
    roles.add(participant.role);
  }

  return {
    id: id(input.id, "id", createId),
    targetRepositoryPath: string(
      input.targetRepositoryPath,
      "targetRepositoryPath",
    ),
    repositoryIdentity: string(
      input.repositoryIdentity,
      "repositoryIdentity",
    ),
    commitSha: string(input.commitSha, "commitSha"),
    name,
    task: string(input.task, "task"),
    participants,
    toolPolicy: object(input.toolPolicy, "toolPolicy"),
    runConditions,
    protocolVersion: string(input.protocolVersion, "protocolVersion"),
    rubricVersion: string(input.rubricVersion, "rubricVersion"),
    createdAt: timestamp(input.createdAt, "createdAt", now()),
  };
}

function number(value, path, { nullable = false, maximum } = {}) {
  if (nullable && value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    fail(
      path,
      `must be a finite non-negative number${
        maximum === undefined ? "" : ` no greater than ${maximum}`
      }${nullable ? " or null" : ""}`,
    );
  }
  return value;
}

function exactStringArray(
  value,
  path,
  allowed,
  { maximum = 100 } = {},
) {
  const values = stringArray(value, path, { maximum });
  const seen = new Set();
  for (const [index, item] of values.entries()) {
    if (!allowed.has(item)) {
      fail(`${path}[${index}]`, "contains an unsupported value");
    }
    if (seen.has(item)) {
      fail(`${path}[${index}]`, "must not contain duplicates");
    }
    seen.add(item);
  }
  return values;
}

function generalCitation(value, path) {
  const citation = strictObject(value, path, [
    "path",
    "startLine",
    "endLine",
    "symbol",
    "source",
  ]);
  const normalizedPath = string(citation.path, `${path}.path`);
  const slashPath = normalizedPath.replaceAll("\\", "/");
  if (
    slashPath.startsWith("/") ||
    /^[a-zA-Z]:\//.test(slashPath) ||
    slashPath.split("/").includes("..")
  ) {
    fail(`${path}.path`, "must be repository-relative and remain in the repository");
  }
  const startLine = integer(citation.startLine, `${path}.startLine`);
  const endLine = integer(citation.endLine, `${path}.endLine`);
  if (startLine < 1 || endLine < startLine) {
    fail(path, "line numbers must be one-based and ordered");
  }
  return {
    path: normalizedPath,
    startLine,
    endLine,
    symbol: optionalString(citation.symbol, `${path}.symbol`) ?? null,
    source: enumeration(citation.source, GENERAL_SOURCES, `${path}.source`),
  };
}

function generalCitations(value, path, { minimum = 0 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 100) {
    fail(path, `must contain from ${minimum} through 100 citations`);
  }
  return value.map((citation, index) =>
    generalCitation(citation, `${path}[${index}]`),
  );
}

function navigationCost(value, path) {
  if (value === null) return null;
  const cost = strictObject(value, path, [
    "searches",
    "filesOpened",
    "fileHops",
    "deadEnds",
    "commands",
    "processedTokens",
    "elapsedMs",
  ]);
  return Object.fromEntries(
    [
      "searches",
      "filesOpened",
      "fileHops",
      "deadEnds",
      "commands",
      "processedTokens",
      "elapsedMs",
    ].map((field) => [
      field,
      number(cost[field], `${path}.${field}`, { nullable: true }),
    ]),
  );
}

function findingRevision(value, path, { now }) {
  const revision = strictObject(value, path, [
    "revisionId",
    "findingId",
    "revisionNumber",
    "state",
    "signal",
    "title",
    "conclusion",
    "dimensionIds",
    "practiceGuideIds",
    "citations",
    "navigationCost",
    "provenance",
  ]);
  const provenance = strictObject(revision.provenance, `${path}.provenance`, [
    "previousRevisionId",
    "amendmentReason",
    "actor",
    "occurredAt",
    "causedByCitations",
  ]);
  return {
    revisionId: string(revision.revisionId, `${path}.revisionId`),
    findingId: string(revision.findingId, `${path}.findingId`),
    revisionNumber: integer(revision.revisionNumber, `${path}.revisionNumber`),
    state: enumeration(revision.state, GENERAL_STATES, `${path}.state`),
    signal: enumeration(revision.signal, GENERAL_SIGNALS, `${path}.signal`),
    title: string(revision.title, `${path}.title`),
    conclusion: string(revision.conclusion, `${path}.conclusion`),
    dimensionIds: exactStringArray(
      revision.dimensionIds,
      `${path}.dimensionIds`,
      GENERAL_DIMENSIONS,
      { maximum: GENERAL_DIMENSIONS.size },
    ),
    practiceGuideIds: exactStringArray(
      revision.practiceGuideIds,
      `${path}.practiceGuideIds`,
      GENERAL_PRACTICES,
      { maximum: GENERAL_PRACTICES.size },
    ),
    citations: generalCitations(revision.citations, `${path}.citations`),
    navigationCost: navigationCost(
      revision.navigationCost,
      `${path}.navigationCost`,
    ),
    provenance: {
      previousRevisionId:
        optionalString(
          provenance.previousRevisionId,
          `${path}.provenance.previousRevisionId`,
        ) ?? null,
      amendmentReason:
        optionalString(
          provenance.amendmentReason,
          `${path}.provenance.amendmentReason`,
        ) ?? null,
      actor: string(provenance.actor, `${path}.provenance.actor`),
      occurredAt: timestamp(
        provenance.occurredAt,
        `${path}.provenance.occurredAt`,
        now(),
      ),
      causedByCitations: generalCitations(
        provenance.causedByCitations,
        `${path}.provenance.causedByCitations`,
      ),
    },
  };
}

function behaviorPathNode(value, path) {
  const base = object(value, path);
  if (base.status === "known") {
    const node = strictObject(base, path, ["status", "label", "citations"]);
    return {
      status: "known",
      label: string(node.label, `${path}.label`),
      citations: generalCitations(node.citations, `${path}.citations`, {
        minimum: 1,
      }),
    };
  }
  if (base.status === "unknown") {
    const node = strictObject(base, path, [
      "status",
      "label",
      "reason",
      "citations",
    ]);
    const citations = generalCitations(node.citations, `${path}.citations`);
    if (citations.length !== 0) {
      fail(`${path}.citations`, "must be empty for an unknown node");
    }
    return {
      status: "unknown",
      label: string(node.label, `${path}.label`),
      reason: string(node.reason, `${path}.reason`),
      citations,
    };
  }
  fail(`${path}.status`, "must be known or unknown");
}

function behaviorPathNodes(value, path) {
  if (!Array.isArray(value) || value.length > 100) {
    fail(path, "must be an array of no more than 100 nodes");
  }
  return value.map((node, index) => behaviorPathNode(node, `${path}[${index}]`));
}

function dimensionPayload(value, path, { assessed = false } = {}) {
  const payload = strictObject(value, path, [
    "dimensionId",
    "confidence",
    "supportingPositiveFindingIds",
    "supportingFrictionFindingIds",
    "limitations",
    ...(assessed ? ["score"] : []),
  ]);
  const normalized = {
    dimensionId: enumeration(
      payload.dimensionId,
      GENERAL_DIMENSIONS,
      `${path}.dimensionId`,
    ),
    confidence: number(payload.confidence, `${path}.confidence`, {
      maximum: 1,
    }),
    supportingPositiveFindingIds: stringArray(
      payload.supportingPositiveFindingIds,
      `${path}.supportingPositiveFindingIds`,
      { maximum: 100 },
    ),
    supportingFrictionFindingIds: stringArray(
      payload.supportingFrictionFindingIds,
      `${path}.supportingFrictionFindingIds`,
      { maximum: 100 },
    ),
    limitations: stringArray(payload.limitations, `${path}.limitations`, {
      maximum: 100,
    }),
  };
  return assessed
    ? {
        ...normalized,
        score: number(payload.score, `${path}.score`, { maximum: 100 }),
      }
    : normalized;
}

function validateGeneralPayload(type, value, dependencies) {
  const path = "payload";
  switch (type) {
    case "general.audit.started": {
      const payload = strictObject(value, path, [
        "repositoryIdentity",
        "commitSha",
        "protocolVersion",
      ]);
      return {
        repositoryIdentity: string(
          payload.repositoryIdentity,
          `${path}.repositoryIdentity`,
        ),
        commitSha: string(payload.commitSha, `${path}.commitSha`),
        protocolVersion: string(
          payload.protocolVersion,
          `${path}.protocolVersion`,
        ),
      };
    }
    case "general.surface.inspected": {
      const payload = strictObject(value, path, [
        "surface",
        "summary",
        "citations",
      ]);
      return {
        surface: enumeration(payload.surface, GENERAL_SURFACES, `${path}.surface`),
        summary: string(payload.summary, `${path}.summary`),
        citations: generalCitations(payload.citations, `${path}.citations`),
      };
    }
    case "general.behavior_path.recorded": {
      const payload = strictObject(value, path, [
        "pathId",
        "name",
        "entryPoint",
        "owner",
        "dependencies",
        "consumers",
        "tests",
      ]);
      return {
        pathId: string(payload.pathId, `${path}.pathId`),
        name: string(payload.name, `${path}.name`),
        entryPoint: behaviorPathNode(payload.entryPoint, `${path}.entryPoint`),
        owner: behaviorPathNode(payload.owner, `${path}.owner`),
        dependencies: behaviorPathNodes(
          payload.dependencies,
          `${path}.dependencies`,
        ),
        consumers: behaviorPathNodes(payload.consumers, `${path}.consumers`),
        tests: behaviorPathNodes(payload.tests, `${path}.tests`),
      };
    }
    case "general.finding.recorded":
    case "general.finding.revised": {
      const payload = strictObject(value, path, ["revision"]);
      return {
        revision: findingRevision(payload.revision, `${path}.revision`, dependencies),
      };
    }
    case "general.dimension.progress":
      return dimensionPayload(value, path);
    case "general.dimension.assessed":
      return dimensionPayload(value, path, { assessed: true });
    case "general.practice.assessed": {
      const payload = strictObject(value, path, [
        "principleId",
        "assessment",
        "summary",
        "surfacesInspected",
        "supportingPositiveFindingIds",
        "supportingFrictionFindingIds",
        "limitations",
        "navigationTokenMechanism",
        "recommendationIds",
        "workflowEntryPoints",
        "workflowConclusion",
      ]);
      return {
        principleId: enumeration(payload.principleId, GENERAL_PRACTICES, `${path}.principleId`),
        assessment: enumeration(payload.assessment, GENERAL_PRACTICE_STATES, `${path}.assessment`),
        summary: string(payload.summary, `${path}.summary`),
        surfacesInspected: exactStringArray(payload.surfacesInspected, `${path}.surfacesInspected`, GENERAL_SURFACES),
        supportingPositiveFindingIds: stringArray(payload.supportingPositiveFindingIds, `${path}.supportingPositiveFindingIds`, { maximum: 100 }),
        supportingFrictionFindingIds: stringArray(payload.supportingFrictionFindingIds, `${path}.supportingFrictionFindingIds`, { maximum: 100 }),
        limitations: stringArray(payload.limitations, `${path}.limitations`, { maximum: 100 }),
        navigationTokenMechanism: string(payload.navigationTokenMechanism, `${path}.navigationTokenMechanism`),
        recommendationIds: stringArray(payload.recommendationIds, `${path}.recommendationIds`, { maximum: 100 }),
        workflowEntryPoints: payload.workflowEntryPoints === undefined
          ? []
          : stringArray(payload.workflowEntryPoints, `${path}.workflowEntryPoints`, { maximum: 100 }),
        workflowConclusion: optionalString(payload.workflowConclusion, `${path}.workflowConclusion`) ?? null,
      };
    }
    case "general.recommendation.recorded": {
      const payload = strictObject(value, path, [
        "recommendationId",
        "title",
        "rationale",
        "findingIds",
        "dimensionIds",
        "practiceGuideIds",
        "tokenMechanism",
        "validationCheck",
        "limitations",
      ]);
      return {
        recommendationId: string(
          payload.recommendationId,
          `${path}.recommendationId`,
        ),
        title: string(payload.title, `${path}.title`),
        rationale: string(payload.rationale, `${path}.rationale`),
        findingIds: stringArray(payload.findingIds, `${path}.findingIds`, {
          maximum: 100,
        }),
        dimensionIds: exactStringArray(
          payload.dimensionIds,
          `${path}.dimensionIds`,
          GENERAL_DIMENSIONS,
          { maximum: GENERAL_DIMENSIONS.size },
        ),
        practiceGuideIds: exactStringArray(
          payload.practiceGuideIds,
          `${path}.practiceGuideIds`,
          GENERAL_PRACTICES,
          { maximum: GENERAL_PRACTICES.size },
        ),
        tokenMechanism: string(payload.tokenMechanism, `${path}.tokenMechanism`),
        validationCheck: string(payload.validationCheck, `${path}.validationCheck`),
        limitations: stringArray(payload.limitations, `${path}.limitations`, { maximum: 100 }),
      };
    }
    case "general.friction.disposition.recorded": {
      const payload = strictObject(value, path, [
        "findingId",
        "disposition",
        "recommendationId",
        "reason",
      ]);
      return {
        findingId: string(payload.findingId, `${path}.findingId`),
        disposition: enumeration(payload.disposition, GENERAL_DISPOSITIONS, `${path}.disposition`),
        recommendationId: optionalString(payload.recommendationId, `${path}.recommendationId`) ?? null,
        reason: optionalString(payload.reason, `${path}.reason`) ?? null,
      };
    }
    case "general.continuation.recorded": {
      const payload = strictObject(value, path, [
        "continuationId",
        "providerSessionId",
        "reason",
        "inspectedSurfaces",
        "openQuestions",
        "remainingDimensionIds",
      ]);
      return {
        continuationId: string(
          payload.continuationId,
          `${path}.continuationId`,
        ),
        providerSessionId: string(
          payload.providerSessionId,
          `${path}.providerSessionId`,
        ),
        reason: string(payload.reason, `${path}.reason`),
        inspectedSurfaces: exactStringArray(
          payload.inspectedSurfaces,
          `${path}.inspectedSurfaces`,
          GENERAL_SURFACES,
        ),
        openQuestions: stringArray(
          payload.openQuestions,
          `${path}.openQuestions`,
          { maximum: 100 },
        ),
        remainingDimensionIds: exactStringArray(
          payload.remainingDimensionIds,
          `${path}.remainingDimensionIds`,
          GENERAL_DIMENSIONS,
        ),
      };
    }
    case "general.synthesis.completed": {
      const payload = strictObject(value, path, [
        "outcome",
        "summary",
        "limitations",
      ]);
      return {
        outcome: enumeration(
          payload.outcome,
          new Set(["completed", "partial"]),
          `${path}.outcome`,
        ),
        summary: string(payload.summary, `${path}.summary`),
        limitations: stringArray(payload.limitations, `${path}.limitations`, {
          maximum: 100,
        }),
      };
    }
    case "general.audit.interrupted": {
      const payload = strictObject(value, path, ["outcome", "reason"]);
      return {
        outcome: enumeration(
          payload.outcome,
          new Set(["partial", "failed", "cancelled"]),
          `${path}.outcome`,
        ),
        reason: string(payload.reason, `${path}.reason`),
      };
    }
    default:
      fail("type", "must be a supported general-audit checkpoint type");
  }
}

export function validateGeneralCheckpoint(value, { now, createId }) {
  const input = strictObject(value, "input", [
    "id",
    "runId",
    "actor",
    "type",
    "payload",
    "occurredAt",
    "idempotencyKey",
  ]);
  const type = enumeration(input.type, GENERAL_EVENT_TYPES, "type");
  const occurredAt = timestamp(input.occurredAt, "occurredAt", now());
  const actor = string(input.actor, "actor");
  const payload = validateGeneralPayload(type, input.payload, { now, createId });
  if (
    (type === "general.finding.recorded" ||
      type === "general.finding.revised") &&
    (payload.revision.provenance.actor !== actor ||
      payload.revision.provenance.occurredAt !== occurredAt)
  ) {
    fail(
      "payload.revision.provenance",
      "actor and occurredAt must match the checkpoint envelope",
    );
  }
  return {
    id: id(input.id, "id", createId),
    runId: string(input.runId, "runId"),
    actor,
    type,
    payload,
    occurredAt,
    idempotencyKey: string(input.idempotencyKey, "idempotencyKey"),
  };
}

export function validateAppendEvent(value, { now, createId }) {
  const input = object(value, "input");
  const type = string(input.type, "type");
  if (!/^[a-z][a-z0-9_.-]*$/.test(type)) {
    fail("type", "must use lower-case protocol notation");
  }

  return {
    id: id(input.id, "id", createId),
    runId: string(input.runId, "runId"),
    actor: string(input.actor, "actor"),
    type,
    payload: object(input.payload, "payload"),
    occurredAt: timestamp(input.occurredAt, "occurredAt", now()),
    tokenMeasurement:
      input.tokenMeasurement === undefined
        ? undefined
        : validateTokenMeasurement(
            { ...object(input.tokenMeasurement, "tokenMeasurement"), runId: input.runId },
            { now, createId },
          ),
  };
}

export function validateSubmitClaim(value, { now, createId }) {
  const input = object(value, "input");
  if (!Array.isArray(input.citations)) {
    fail("citations", "must be an array");
  }
  const citations = input.citations.map((item, index) => {
    const citation = object(item, `citations[${index}]`);
    const startLine =
      citation.startLine === undefined
        ? undefined
        : integer(citation.startLine, `citations[${index}].startLine`);
    const endLine =
      citation.endLine === undefined
        ? undefined
        : integer(citation.endLine, `citations[${index}].endLine`);
    if (startLine === 0 || endLine === 0) {
      fail(`citations[${index}]`, "line numbers must be greater than zero");
    }
    if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
      fail(`citations[${index}].endLine`, "must not precede startLine");
    }
    return {
      path: string(citation.path, `citations[${index}].path`),
      ...(startLine === undefined ? {} : { startLine }),
      ...(endLine === undefined ? {} : { endLine }),
      ...(citation.symbol === undefined
        ? {}
        : { symbol: string(citation.symbol, `citations[${index}].symbol`) }),
      ...(citation.evidenceHash === undefined
        ? {}
        : {
            evidenceHash: string(
              citation.evidenceHash,
              `citations[${index}].evidenceHash`,
            ),
          }),
    };
  });

  if (typeof input.confidence !== "number" || input.confidence < 0 || input.confidence > 1) {
    fail("confidence", "must be a number from 0 through 1");
  }

  return {
    id: id(input.id, "id", createId),
    runId: string(input.runId, "runId"),
    subject: string(input.subject, "subject"),
    assertion: string(input.assertion, "assertion"),
    claimant: string(input.claimant, "claimant"),
    citations,
    confidence: input.confidence,
    criticality: enumeration(
      input.criticality,
      CLAIM_CRITICALITIES,
      "criticality",
    ),
    createdAt: timestamp(input.createdAt, "createdAt", now()),
  };
}

export function validateRecordVerification(value, { now, createId }) {
  const input = object(value, "input");
  return {
    id: id(input.id, "id", createId),
    runId: string(input.runId, "runId"),
    claimId: string(input.claimId, "claimId"),
    verifier: string(input.verifier, "verifier"),
    method: enumeration(input.method, VERIFICATION_METHODS, "method"),
    verdict: enumeration(
      input.verdict,
      VERIFICATION_VERDICTS,
      "verdict",
    ),
    evidence: object(input.evidence, "evidence"),
    createdAt: timestamp(input.createdAt, "createdAt", now()),
  };
}

export function validateTokenMeasurement(value, { now, createId }) {
  const input = object(value, "input");
  const inputTokens = optionalInteger(input.inputTokens, "inputTokens");
  const outputTokens = optionalInteger(input.outputTokens, "outputTokens");
  const cachedInputTokens = optionalInteger(
    input.cachedInputTokens,
    "cachedInputTokens",
  );
  const cacheCreationTokens = optionalInteger(
    input.cacheCreationTokens,
    "cacheCreationTokens",
  );
  const totalTokens =
    input.totalTokens === undefined || input.totalTokens === null
      ? inputTokens !== null && outputTokens !== null
        ? inputTokens + outputTokens
        : fail(
            "totalTokens",
            "is required when inputTokens or outputTokens is unavailable",
          )
      : integer(input.totalTokens, "totalTokens");

  if (totalTokens < (inputTokens ?? 0) + (outputTokens ?? 0)) {
    fail("totalTokens", "must be at least inputTokens + outputTokens");
  }
  if (
    inputTokens !== null &&
    cachedInputTokens !== null &&
    cachedInputTokens > inputTokens
  ) {
    fail("cachedInputTokens", "must not exceed inputTokens");
  }

  return {
    id: id(input.id, "id", createId),
    runId: string(input.runId, "runId"),
    eventId: optionalString(input.eventId, "eventId") ?? null,
    actor: string(input.actor, "actor"),
    phase: enumeration(input.phase, TOKEN_PHASES, "phase"),
    source: enumeration(input.source, TOKEN_SOURCES, "source"),
    provider: optionalString(input.provider, "provider") ?? null,
    model: optionalString(input.model, "model") ?? null,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    totalTokens,
    measuredAt: timestamp(input.measuredAt, "measuredAt", now()),
  };
}

export function validateFinishRun(value, { now }) {
  const input = object(value, "input");
  const status = enumeration(input.status, RUN_STATUSES, "status");
  if (status === "active") {
    fail("status", "must be a terminal status");
  }
  return {
    status,
    summary:
      input.summary === undefined ? {} : object(input.summary, "summary"),
    finishedAt: timestamp(input.finishedAt, "finishedAt", now()),
  };
}

export function validateReportRecommendations(value, { now, createId }) {
  const input = object(value, "input");
  if (input.scope !== "repository_navigation") {
    fail(
      "scope",
      'must be "repository_navigation"; feature implementation advice is outside Waymark scope',
    );
  }
  if (
    !Array.isArray(input.recommendations) ||
    input.recommendations.length < 1 ||
    input.recommendations.length > 20
  ) {
    fail("recommendations", "must contain from 1 through 20 items");
  }

  const recommendationIds = new Set();
  const recommendations = input.recommendations.map((item, index) => {
    const path = `recommendations[${index}]`;
    const recommendation = object(item, path);
    const recommendationId = id(
      recommendation.id,
      `${path}.id`,
      createId,
    );
    if (recommendationIds.has(recommendationId)) {
      fail(`${path}.id`, "must be unique within the report");
    }
    recommendationIds.add(recommendationId);

    const claimIds = stringArray(
      recommendation.claimIds,
      `${path}.claimIds`,
      { minimum: 1, maximum: 20 },
    );
    if (new Set(claimIds).size !== claimIds.length) {
      fail(`${path}.claimIds`, "must not contain duplicates");
    }

    const practiceIds = stringArray(
      recommendation.practiceIds,
      `${path}.practiceIds`,
      { minimum: 1, maximum: 7 },
    );
    for (const [practiceIndex, practiceId] of practiceIds.entries()) {
      if (!PRACTICE_IDS.has(practiceId)) {
        fail(
          `${path}.practiceIds[${practiceIndex}]`,
          "must be a Practice Guide ID from 01 through 07",
        );
      }
    }

    const affectedDimensions = stringArray(
      recommendation.affectedDimensions,
      `${path}.affectedDimensions`,
      { minimum: 1, maximum: SCORE_DIMENSIONS.size },
    );
    for (const [dimensionIndex, dimension] of affectedDimensions.entries()) {
      if (!SCORE_DIMENSIONS.has(dimension)) {
        fail(
          `${path}.affectedDimensions[${dimensionIndex}]`,
          "must be a scored navigability dimension",
        );
      }
    }

    return {
      id: recommendationId,
      priority: enumeration(
        recommendation.priority,
        RECOMMENDATION_PRIORITIES,
        `${path}.priority`,
      ),
      title: string(recommendation.title, `${path}.title`),
      problem: string(recommendation.problem, `${path}.problem`),
      change: string(recommendation.change, `${path}.change`),
      repositoryChanges: stringArray(
        recommendation.repositoryChanges,
        `${path}.repositoryChanges`,
        { minimum: 1, maximum: 12 },
      ),
      claimIds,
      practiceIds,
      affectedDimensions,
      tokenMechanism: string(
        recommendation.tokenMechanism,
        `${path}.tokenMechanism`,
      ),
      validationChecks: stringArray(
        recommendation.validationChecks,
        `${path}.validationChecks`,
        { minimum: 1, maximum: 12 },
      ),
      limitations:
        recommendation.limitations === undefined
          ? []
          : stringArray(
              recommendation.limitations,
              `${path}.limitations`,
              { maximum: 8 },
            ),
      effort:
        optionalString(recommendation.effort, `${path}.effort`) ?? null,
    };
  });

  return {
    schemaVersion: "waymark-navigation-recommendations/1.0.0",
    scope: "repository_navigation",
    method: "post_run_evidence_review",
    recommendations,
    createdAt: timestamp(input.createdAt, "createdAt", now()),
  };
}

export function validateAuthoritativeCompletion(value, { now }) {
  const input = object(value, "input");
  return {
    score: object(input.score, "score"),
    summary:
      input.summary === undefined ? {} : object(input.summary, "summary"),
    finishedAt: timestamp(input.finishedAt, "finishedAt", now()),
  };
}
