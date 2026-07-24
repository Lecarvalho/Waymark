const RUN_STATUSES = new Set(["active", "completed", "failed", "cancelled"]);
const PARTICIPANT_ROLES = new Set([
  "orchestrator",
  "candidate",
  "independent",
  "verifier",
  "reporter",
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

export function validateCreateRun(value, { now, createId }) {
  const input = object(value, "input");
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

  for (const requiredRole of ["candidate", "orchestrator"]) {
    if (!participants.some(({ role }) => role === requiredRole)) {
      fail("participants", `must include a ${requiredRole} role`);
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
    task: string(input.task, "task"),
    participants,
    toolPolicy: object(input.toolPolicy, "toolPolicy"),
    runConditions: object(input.runConditions, "runConditions"),
    protocolVersion: string(input.protocolVersion, "protocolVersion"),
    rubricVersion: string(input.rubricVersion, "rubricVersion"),
    createdAt: timestamp(input.createdAt, "createdAt", now()),
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

export function validateAuthoritativeCompletion(value, { now }) {
  const input = object(value, "input");
  return {
    score: object(input.score, "score"),
    summary:
      input.summary === undefined ? {} : object(input.summary, "summary"),
    finishedAt: timestamp(input.finishedAt, "finishedAt", now()),
  };
}
