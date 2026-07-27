import { createInterface } from "node:readline";

import {
  GENERAL_AUDIT_SURFACES,
  GENERAL_EVIDENCE_SOURCES,
  GENERAL_FINDING_SIGNALS,
  GENERAL_FINDING_STATES,
  GENERAL_FRICTION_DISPOSITIONS,
  GENERAL_PRACTICE_ASSESSMENTS,
  PRACTICE_GUIDE_IDS,
  WAYMARK_DIMENSION_IDS,
} from "../domain/general-audit.mjs";

const SERVER_INFO = Object.freeze({
  name: "waymark-checkpoint",
  version: "1.0.0",
});

const STRING = Object.freeze({ type: "string", minLength: 1 });
const NULLABLE_STRING = Object.freeze({ type: ["string", "null"] });
const NON_NEGATIVE_NUMBER_OR_NULL = Object.freeze({
  type: ["number", "null"],
  minimum: 0,
});

function strictObject(properties, required = Object.keys(properties)) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function stringArray({ maximum = 100 } = {}) {
  return {
    type: "array",
    maxItems: maximum,
    items: STRING,
  };
}

const CITATION_SCHEMA = strictObject({
  path: {
    ...STRING,
    description: "Repository-relative path; absolute and parent paths are invalid.",
  },
  startLine: { type: "integer", minimum: 1 },
  endLine: { type: "integer", minimum: 1 },
  symbol: NULLABLE_STRING,
  source: { type: "string", enum: GENERAL_EVIDENCE_SOURCES },
});

function citations({ minimum = 0, maximum = 100 } = {}) {
  return {
    type: "array",
    minItems: minimum,
    maxItems: maximum,
    items: CITATION_SCHEMA,
  };
}

const NAVIGATION_COST_SCHEMA = {
  oneOf: [
    { type: "null" },
    strictObject({
      searches: NON_NEGATIVE_NUMBER_OR_NULL,
      filesOpened: NON_NEGATIVE_NUMBER_OR_NULL,
      fileHops: NON_NEGATIVE_NUMBER_OR_NULL,
      deadEnds: NON_NEGATIVE_NUMBER_OR_NULL,
      commands: NON_NEGATIVE_NUMBER_OR_NULL,
      processedTokens: NON_NEGATIVE_NUMBER_OR_NULL,
      elapsedMs: NON_NEGATIVE_NUMBER_OR_NULL,
    }),
  ],
  description:
    "Measured navigation counters, using null for unavailable values; not a qualitative label.",
};

const FINDING_PROVENANCE_INPUT_SCHEMA = strictObject(
  {
    previousRevisionId: NULLABLE_STRING,
    amendmentReason: NULLABLE_STRING,
    causedByCitations: citations(),
  },
  [],
);

const FINDING_REVISION_SCHEMA = strictObject({
  revisionId: STRING,
  findingId: STRING,
  revisionNumber: { type: "integer", minimum: 1 },
  state: { type: "string", enum: GENERAL_FINDING_STATES },
  signal: { type: "string", enum: GENERAL_FINDING_SIGNALS },
  title: STRING,
  conclusion: STRING,
  dimensionIds: {
    type: "array",
    maxItems: WAYMARK_DIMENSION_IDS.length,
    uniqueItems: true,
    items: { type: "string", enum: WAYMARK_DIMENSION_IDS },
  },
  practiceGuideIds: {
    type: "array",
    maxItems: PRACTICE_GUIDE_IDS.length,
    uniqueItems: true,
    items: { type: "string", enum: PRACTICE_GUIDE_IDS },
  },
  citations: citations(),
  navigationCost: NAVIGATION_COST_SCHEMA,
  provenance: {
    ...FINDING_PROVENANCE_INPUT_SCHEMA,
    description:
      "Revision linkage only. Waymark injects the authenticated auditor identity and checkpoint timestamp.",
  },
});

const KNOWN_PATH_NODE_SCHEMA = strictObject({
  status: { type: "string", const: "known" },
  label: STRING,
  citations: citations({ minimum: 1 }),
});

const UNKNOWN_PATH_NODE_SCHEMA = strictObject({
  status: { type: "string", const: "unknown" },
  label: STRING,
  reason: STRING,
  citations: citations({ maximum: 0 }),
});

const PATH_NODE_SCHEMA = {
  oneOf: [KNOWN_PATH_NODE_SCHEMA, UNKNOWN_PATH_NODE_SCHEMA],
  description:
    "One path node. Known: {status:'known', label, citations:[at least one]}. Unknown: {status:'unknown', label, reason, citations:[]}.",
};

function pathNodes() {
  return {
    type: "array",
    maxItems: 100,
    items: PATH_NODE_SCHEMA,
    description: "Array of behavior-path nodes, never a generic object.",
  };
}

const DIMENSION_PROGRESS_PROPERTIES = Object.freeze({
  dimensionId: { type: "string", enum: WAYMARK_DIMENSION_IDS },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  supportingPositiveFindingIds: stringArray(),
  supportingFrictionFindingIds: stringArray(),
  limitations: stringArray(),
});

const PAYLOAD_SCHEMAS = Object.freeze({
  "general.surface.inspected": strictObject({
    surface: { type: "string", enum: GENERAL_AUDIT_SURFACES },
    summary: STRING,
    citations: citations(),
  }),
  "general.behavior_path.recorded": strictObject({
    pathId: STRING,
    name: STRING,
    entryPoint: PATH_NODE_SCHEMA,
    owner: PATH_NODE_SCHEMA,
    dependencies: pathNodes(),
    consumers: pathNodes(),
    tests: pathNodes(),
  }),
  "general.finding.recorded": strictObject({
    revision: FINDING_REVISION_SCHEMA,
  }),
  "general.finding.revised": strictObject({
    revision: FINDING_REVISION_SCHEMA,
  }),
  "general.dimension.progress": strictObject(DIMENSION_PROGRESS_PROPERTIES),
  "general.dimension.assessed": strictObject({
    ...DIMENSION_PROGRESS_PROPERTIES,
    score: { type: "number", minimum: 0, maximum: 100 },
  }),
  "general.practice.assessed": strictObject({
    principleId: { type: "string", enum: PRACTICE_GUIDE_IDS },
    assessment: { type: "string", enum: GENERAL_PRACTICE_ASSESSMENTS },
    summary: STRING,
    surfacesInspected: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", enum: GENERAL_AUDIT_SURFACES },
    },
    supportingPositiveFindingIds: stringArray(),
    supportingFrictionFindingIds: stringArray(),
    limitations: stringArray(),
    navigationTokenMechanism: STRING,
    recommendationIds: stringArray(),
    workflowEntryPoints: stringArray(),
    workflowConclusion: NULLABLE_STRING,
  }),
  "general.recommendation.recorded": strictObject({
    recommendationId: STRING,
    title: STRING,
    rationale: STRING,
    findingIds: stringArray(),
    dimensionIds: {
      type: "array",
      maxItems: WAYMARK_DIMENSION_IDS.length,
      uniqueItems: true,
      items: { type: "string", enum: WAYMARK_DIMENSION_IDS },
    },
    practiceGuideIds: {
      type: "array",
      maxItems: PRACTICE_GUIDE_IDS.length,
      uniqueItems: true,
      items: { type: "string", enum: PRACTICE_GUIDE_IDS },
    },
    tokenMechanism: STRING,
    validationCheck: STRING,
    limitations: stringArray(),
  }),
  "general.friction.disposition.recorded": strictObject({
    findingId: STRING,
    disposition: { type: "string", enum: GENERAL_FRICTION_DISPOSITIONS },
    recommendationId: NULLABLE_STRING,
    reason: NULLABLE_STRING,
  }),
  "general.synthesis.completed": strictObject({
    outcome: { type: "string", enum: ["completed", "partial"] },
    summary: STRING,
    limitations: stringArray(),
  }),
});

function checkpointVariant(type, payload) {
  return strictObject({
    idempotencyKey: {
      ...STRING,
      description: "Stable unique key for this semantic checkpoint.",
    },
    type: { type: "string", const: type },
    occurredAt: {
      type: ["string", "null"],
      description:
        "ISO-8601 timestamp, or null for the checkpoint server's current time.",
    },
    payload,
  });
}

const CHECKPOINT_TOOL = Object.freeze({
  name: "record",
  description:
    "Persist one Waymark general-audit semantic checkpoint. Call this after each defensible finding, surface inspection, behavior path, dimension update, recommendation, or synthesis.",
  annotations: {
    title: "Record Waymark audit checkpoint",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    oneOf: Object.entries(PAYLOAD_SCHEMAS).map(([type, payload]) =>
      checkpointVariant(type, payload),
    ),
  },
});

const TOOL_EVENT_TYPES = Object.freeze({
  record_surface: "general.surface.inspected",
  record_behavior_path: "general.behavior_path.recorded",
  record_finding: "general.finding.recorded",
  revise_finding: "general.finding.revised",
  record_dimension_progress: "general.dimension.progress",
  assess_dimension: "general.dimension.assessed",
  assess_practice: "general.practice.assessed",
  record_recommendation: "general.recommendation.recorded",
  record_friction_disposition: "general.friction.disposition.recorded",
  complete_synthesis: "general.synthesis.completed",
});

function eventTool(name, type) {
  return Object.freeze({
    name,
    description: `Persist ${type}. The semantic payload fields are top-level after idempotencyKey and occurredAt.`,
    annotations: CHECKPOINT_TOOL.annotations,
    inputSchema: strictObject({
      idempotencyKey: STRING,
      occurredAt: {
        type: ["string", "null"],
        description: "ISO-8601 timestamp, or null to use the checkpoint server time.",
      },
      ...PAYLOAD_SCHEMAS[type].properties,
    }),
  });
}

const CHECKPOINT_TOOLS = Object.freeze([
  ...Object.entries(TOOL_EVENT_TYPES).map(([name, type]) => eventTool(name, type)),
  CHECKPOINT_TOOL,
]);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

const CHECKPOINT_CONFIG = Object.freeze({
  endpoint: requiredEnvironment("WAYMARK_CHECKPOINT_ENDPOINT"),
  authorization: requiredEnvironment("WAYMARK_CHECKPOINT_AUTHORIZATION"),
  runId: requiredEnvironment("WAYMARK_CHECKPOINT_RUN_ID"),
  actor: requiredEnvironment("WAYMARK_CHECKPOINT_ACTOR"),
});

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function failure(id, code, message, data = undefined) {
  send({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function toolResult(value, { isError = false } = {}) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkpointOccurredAt(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value
    : new Date().toISOString();
}

function checkpointPayload(checkpoint, occurredAt) {
  if (
    !["general.finding.recorded", "general.finding.revised"].includes(
      checkpoint.type,
    ) ||
    !isObject(checkpoint.payload?.revision)
  ) {
    return checkpoint.payload;
  }
  const revision = checkpoint.payload.revision;
  const provenance = isObject(revision.provenance)
    ? revision.provenance
    : {};
  return {
    revision: {
      ...revision,
      provenance: {
        previousRevisionId: provenance.previousRevisionId ?? null,
        amendmentReason: provenance.amendmentReason ?? null,
        actor: CHECKPOINT_CONFIG.actor,
        occurredAt,
        causedByCitations: provenance.causedByCitations ?? [],
      },
    },
  };
}

async function recordCheckpoint(value) {
  const checkpoint =
    value === null || typeof value !== "object" || Array.isArray(value)
      ? {}
      : value;
  const occurredAt = checkpointOccurredAt(checkpoint.occurredAt);
  const response = await fetch(CHECKPOINT_CONFIG.endpoint, {
    method: "POST",
    headers: {
      authorization: CHECKPOINT_CONFIG.authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      runId: CHECKPOINT_CONFIG.runId,
      actor: CHECKPOINT_CONFIG.actor,
      idempotencyKey: checkpoint.idempotencyKey,
      type: checkpoint.type,
      payload: checkpointPayload(checkpoint, occurredAt),
      occurredAt,
    }),
  });
  const body = await response.json().catch(() => ({
    status: "rejected",
    error: {
      code: "CHECKPOINT_RESPONSE_INVALID",
      message: `Checkpoint endpoint returned HTTP ${response.status}`,
    },
  }));
  if (!response.ok || body?.status !== "acknowledged") {
    return toolResult(body, { isError: true });
  }
  return toolResult(body);
}

async function recordEventTool(name, value) {
  const type = TOOL_EVENT_TYPES[name];
  const input = isObject(value) ? value : {};
  const { idempotencyKey, occurredAt, ...payload } = input;
  return recordCheckpoint({ idempotencyKey, occurredAt, type, payload });
}

async function handle(message) {
  if (
    message === null ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message.jsonrpc !== "2.0"
  ) {
    failure(null, -32600, "Invalid JSON-RPC request");
    return;
  }
  const { id, method, params } = message;
  if (method === "notifications/initialized") return;
  if (method === "ping") {
    success(id, {});
    return;
  }
  if (method === "initialize") {
    success(id, {
      protocolVersion:
        typeof params?.protocolVersion === "string"
          ? params.protocolVersion
          : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
    return;
  }
  if (method === "tools/list") {
    success(id, { tools: CHECKPOINT_TOOLS });
    return;
  }
  if (method === "tools/call") {
    if (
      params?.name !== CHECKPOINT_TOOL.name &&
      !(params?.name in TOOL_EVENT_TYPES)
    ) {
      success(
        id,
        toolResult(
          {
            status: "rejected",
            error: {
              code: "CHECKPOINT_TOOL_UNKNOWN",
              message: `Unknown tool: ${String(params?.name)}`,
            },
          },
          { isError: true },
        ),
      );
      return;
    }
    try {
      success(
        id,
        params.name === CHECKPOINT_TOOL.name
          ? await recordCheckpoint(params.arguments)
          : await recordEventTool(params.name, params.arguments),
      );
    } catch (error) {
      success(
        id,
        toolResult(
          {
            status: "rejected",
            error: {
              code: error?.code ?? "CHECKPOINT_TOOL_FAILED",
              message: error instanceof Error ? error.message : String(error),
            },
          },
          { isError: true },
        ),
      );
    }
    return;
  }
  if (id !== undefined) failure(id, -32601, `Method not found: ${method}`);
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (line.trim() === "") continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    failure(null, -32700, "Invalid JSON");
    continue;
  }
  await handle(message);
}
