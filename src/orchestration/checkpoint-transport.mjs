import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const MAX_CHECKPOINT_BYTES = 1_048_576;
const CHECKPOINT_PATH = "/v1/general-checkpoints";

export class CheckpointTransportError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = "CheckpointTransportError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CheckpointTransportError(
      "CHECKPOINT_ENVELOPE_INVALID",
      `${name} must be a non-empty string`,
    );
  }
  return value;
}

function checkpointEnvelope(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CheckpointTransportError(
      "CHECKPOINT_ENVELOPE_INVALID",
      "checkpoint must be an object",
    );
  }
  const allowed = new Set([
    "runId",
    "actor",
    "providerSessionId",
    "idempotencyKey",
    "type",
    "payload",
    "occurredAt",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new CheckpointTransportError(
        "CHECKPOINT_ENVELOPE_INVALID",
        `checkpoint contains unknown field: ${key}`,
      );
    }
  }
  if (
    value.payload === null ||
    typeof value.payload !== "object" ||
    Array.isArray(value.payload)
  ) {
    throw new CheckpointTransportError(
      "CHECKPOINT_ENVELOPE_INVALID",
      "payload must be an object",
    );
  }
  return {
    runId: requiredString(value.runId, "runId"),
    actor: requiredString(value.actor, "actor"),
    providerSessionId:
      value.providerSessionId === undefined
        ? null
        : requiredString(value.providerSessionId, "providerSessionId"),
    idempotencyKey: requiredString(value.idempotencyKey, "idempotencyKey"),
    type: requiredString(value.type, "type"),
    payload: value.payload,
    ...(value.occurredAt === undefined
      ? {}
      : { occurredAt: requiredString(value.occurredAt, "occurredAt") }),
  };
}

function safeDiagnosticString(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.slice(0, 512)
    : null;
}

function jsonResponse(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function authorizationMatches(header, token) {
  if (typeof header !== "string") return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readJsonBody(request) {
  let byteCount = 0;
  const chunks = [];
  for await (const chunk of request) {
    byteCount += chunk.length;
    if (byteCount > MAX_CHECKPOINT_BYTES) {
      throw new CheckpointTransportError(
        "CHECKPOINT_TOO_LARGE",
        `checkpoint body exceeds ${MAX_CHECKPOINT_BYTES} bytes`,
        413,
      );
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CheckpointTransportError(
      "CHECKPOINT_JSON_INVALID",
      "checkpoint body must be valid JSON",
    );
  }
}

function transportFailure(error) {
  return {
    code: error?.code ?? "CHECKPOINT_REJECTED",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Starts a loopback-only structured callback endpoint for one active general
 * auditor. The endpoint can append only validated semantic checkpoints to the
 * supplied Waymark store.
 */
export async function startGeneralCheckpointTransport({
  store,
  runId,
  auditorId,
  provider,
  host = "127.0.0.1",
}) {
  requiredString(runId, "runId");
  requiredString(auditorId, "auditorId");
  requiredString(provider, "provider");
  const token = randomBytes(32).toString("base64url");
  let providerSessionId = null;
  let closed = false;

  const appendDiagnostic = (type, payload) => {
    try {
      return store.appendGeneralCheckpointDiagnostic({
        runId,
        actor: auditorId,
        type,
        payload: { provider, ...payload },
      });
    } catch {
      return null;
    }
  };

  const rejectCheckpoint = (error, value = null) => {
    const failure = transportFailure(error);
    appendDiagnostic("provider.checkpoint.rejected", {
      providerSessionId: safeDiagnosticString(value?.providerSessionId),
      idempotencyKey: safeDiagnosticString(value?.idempotencyKey),
      semanticType: safeDiagnosticString(value?.type),
      error: failure,
    });
    return failure;
  };

  const persist = (value) => {
    let envelope;
    try {
      envelope = checkpointEnvelope(value);
      if (envelope.runId !== runId) {
        throw new CheckpointTransportError(
          "CHECKPOINT_RUN_MISMATCH",
          `checkpoint runId does not match transport run ${runId}`,
          403,
        );
      }
      if (envelope.actor !== auditorId) {
        throw new CheckpointTransportError(
          "CHECKPOINT_AUDITOR_MISMATCH",
          `checkpoint actor does not match auditor ${auditorId}`,
          403,
        );
      }
      if (providerSessionId === null) {
        throw new CheckpointTransportError(
          "PROVIDER_SESSION_NOT_BOUND",
          "provider session must be bound before recording checkpoints",
          409,
        );
      }
      if (
        envelope.providerSessionId !== null &&
        envelope.providerSessionId !== providerSessionId
      ) {
        throw new CheckpointTransportError(
          "PROVIDER_SESSION_MISMATCH",
          "checkpoint providerSessionId does not match the bound session",
          403,
        );
      }
      const event = store.appendGeneralCheckpoint({
        runId,
        actor: auditorId,
        idempotencyKey: envelope.idempotencyKey,
        type: envelope.type,
        payload: envelope.payload,
        ...(envelope.occurredAt === undefined
          ? {}
          : { occurredAt: envelope.occurredAt }),
      });
      appendDiagnostic("provider.checkpoint.acknowledged", {
        providerSessionId,
        idempotencyKey: envelope.idempotencyKey,
        semanticType: envelope.type,
        eventId: event.id,
        eventSequence: event.sequence,
      });
      return {
        status: "acknowledged",
        runId,
        actor: auditorId,
        providerSessionId,
        idempotencyKey: envelope.idempotencyKey,
        eventId: event.id,
        sequence: event.sequence,
      };
    } catch (error) {
      rejectCheckpoint(error, envelope ?? value);
      throw error;
    }
  };

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== CHECKPOINT_PATH) {
      jsonResponse(response, 404, {
        status: "rejected",
        error: {
          code: "CHECKPOINT_ENDPOINT_NOT_FOUND",
          message: "checkpoint endpoint not found",
        },
      });
      return;
    }
    if (!authorizationMatches(request.headers.authorization, token)) {
      const error = new CheckpointTransportError(
        "CHECKPOINT_UNAUTHORIZED",
        "checkpoint authorization is invalid",
        401,
      );
      rejectCheckpoint(error);
      jsonResponse(response, error.statusCode, {
        status: "rejected",
        error: transportFailure(error),
      });
      return;
    }
    try {
      const value = await readJsonBody(request);
      const acknowledgement = persist(value);
      jsonResponse(response, 200, acknowledgement);
    } catch (error) {
      const normalized =
        error instanceof CheckpointTransportError
          ? error
          : new CheckpointTransportError(
              error?.code ?? "CHECKPOINT_REJECTED",
              error instanceof Error ? error.message : String(error),
              error?.code === "INVALID_INPUT" ? 400 : 409,
            );
      if (
        normalized.code === "CHECKPOINT_JSON_INVALID" ||
        normalized.code === "CHECKPOINT_TOO_LARGE"
      ) {
        rejectCheckpoint(normalized);
      }
      jsonResponse(response, normalized.statusCode, {
        status: "rejected",
        error: transportFailure(normalized),
      });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new CheckpointTransportError(
      "CHECKPOINT_LISTENER_FAILED",
      "checkpoint listener did not expose a TCP address",
      500,
    );
  }
  const endpoint = `http://${host}:${address.port}${CHECKPOINT_PATH}`;

  return {
    runId,
    auditorId,
    endpoint,
    authorization: `Bearer ${token}`,
    bindProviderSession(sessionId) {
      const normalized = requiredString(sessionId, "providerSessionId");
      if (providerSessionId !== null && providerSessionId !== normalized) {
        throw new CheckpointTransportError(
          "PROVIDER_SESSION_ALREADY_BOUND",
          `transport is already bound to provider session ${providerSessionId}`,
          409,
        );
      }
      providerSessionId = normalized;
      return providerSessionId;
    },
    rotateProviderSession(sessionId) {
      providerSessionId = requiredString(sessionId, "providerSessionId");
      return providerSessionId;
    },
    persist,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
