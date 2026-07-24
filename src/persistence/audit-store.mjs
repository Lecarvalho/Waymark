import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  ProtocolValidationError,
  validateAppendEvent,
  validateAuthoritativeCompletion,
  validateCreateRun,
  validateFinishRun,
  validateRecordVerification,
  validateSubmitClaim,
  validateTokenMeasurement,
} from "../protocol/validation.mjs";

export const SCHEMA_VERSION = 2;
export const DEFAULT_DATABASE_PATH = ".waymark/waymark.sqlite";

const RESERVED_ACTOR_PATTERN = /^waymark(?::|$)/;
const RESERVED_EVENT_PREFIXES = ["run.", "score."];

const TOKEN_PHASES = [
  "candidate_navigation",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
];

const TOKEN_SOURCES = ["provider_reported", "estimated"];

export class AuditStoreError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AuditStoreError";
    this.code = code;
    this.details = details;
  }
}

function json(value) {
  return JSON.stringify(value);
}

function parseJson(value) {
  return JSON.parse(value);
}

function mapParticipant(row) {
  return {
    id: row.id,
    runId: row.run_id,
    role: row.role,
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version,
  };
}

function mapRun(row, participants) {
  return {
    id: row.id,
    targetRepositoryPath: row.target_repository_path,
    repositoryIdentity: row.repository_identity,
    commitSha: row.commit_sha,
    task: row.task,
    toolPolicy: parseJson(row.tool_policy_json),
    runConditions: parseJson(row.run_conditions_json),
    protocolVersion: row.protocol_version,
    rubricVersion: row.rubric_version,
    status: row.status,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    participants,
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    actor: row.actor,
    type: row.type,
    payload: parseJson(row.payload_json),
    occurredAt: row.occurred_at,
  };
}

function mapClaim(row) {
  return {
    id: row.id,
    runId: row.run_id,
    subject: row.subject,
    assertion: row.assertion,
    claimant: row.claimant,
    citations: parseJson(row.citations_json),
    confidence: row.confidence,
    criticality: row.criticality,
    createdAt: row.created_at,
  };
}

function mapVerification(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    claimId: row.claim_id,
    verifier: row.verifier,
    method: row.method,
    verdict: row.verdict,
    evidence: parseJson(row.evidence_json),
    createdAt: row.created_at,
  };
}

function mapToken(row) {
  return {
    id: row.id,
    runId: row.run_id,
    eventId: row.event_id,
    actor: row.actor,
    phase: row.phase,
    source: row.source,
    provider: row.provider,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cachedInputTokens: row.cached_input_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    totalTokens: row.total_tokens,
    measuredAt: row.measured_at,
  };
}

export function resolveDatabasePath(databasePath = DEFAULT_DATABASE_PATH) {
  return databasePath === ":memory:" ? databasePath : resolve(databasePath);
}

export function bootstrapDatabase(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  const previousVersion = database.prepare("PRAGMA user_version").get().user_version;
  if (previousVersion > SCHEMA_VERSION) {
    throw new AuditStoreError(
      "SCHEMA_TOO_NEW",
      `Database schema ${previousVersion} is newer than supported schema ${SCHEMA_VERSION}`,
    );
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY,
      target_repository_path TEXT NOT NULL,
      repository_identity TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      task TEXT NOT NULL,
      tool_policy_json TEXT NOT NULL,
      run_conditions_json TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('active', 'completed', 'failed', 'cancelled')
      ),
      created_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS run_participants (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      role TEXT NOT NULL CHECK (
        role IN ('orchestrator', 'candidate', 'independent', 'verifier', 'reporter')
      ),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      model_version TEXT,
      UNIQUE (run_id, role)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      actor TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      UNIQUE (run_id, sequence)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS evidence_claims (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      subject TEXT NOT NULL,
      assertion TEXT NOT NULL,
      claimant TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      criticality TEXT NOT NULL CHECK (
        criticality IN ('critical', 'high', 'medium', 'low')
      ),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS verification_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      claim_id TEXT NOT NULL REFERENCES evidence_claims(id),
      verifier TEXT NOT NULL,
      method TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (
        verdict IN ('verified', 'contradicted', 'unverified')
      ),
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (run_id, sequence)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS token_measurements (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      event_id TEXT REFERENCES audit_events(id),
      actor TEXT NOT NULL,
      phase TEXT NOT NULL CHECK (
        phase IN (
          'candidate_navigation',
          'independent_validation',
          'orchestration',
          'deterministic_verification',
          'report_generation'
        )
      ),
      source TEXT NOT NULL CHECK (
        source IN ('provider_reported', 'estimated')
      ),
      provider TEXT,
      model TEXT,
      input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
      output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
      cached_input_tokens INTEGER NOT NULL CHECK (cached_input_tokens >= 0),
      cache_creation_tokens INTEGER NOT NULL CHECK (cache_creation_tokens >= 0),
      total_tokens INTEGER NOT NULL CHECK (
        total_tokens >= input_tokens + output_tokens
      ),
      measured_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS audit_events_run_sequence
      ON audit_events (run_id, sequence);
    CREATE INDEX IF NOT EXISTS evidence_claims_run
      ON evidence_claims (run_id, created_at, id);
    CREATE INDEX IF NOT EXISTS verification_records_run_claim
      ON verification_records (run_id, claim_id, created_at, id);
    CREATE INDEX IF NOT EXISTS token_measurements_run
      ON token_measurements (run_id, measured_at, id);

    CREATE TRIGGER IF NOT EXISTS run_participants_no_update
      BEFORE UPDATE ON run_participants
      BEGIN SELECT RAISE(ABORT, 'run_participants are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS run_participants_no_delete
      BEFORE DELETE ON run_participants
      BEGIN SELECT RAISE(ABORT, 'run_participants are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_claims_no_update
      BEFORE UPDATE ON evidence_claims
      BEGIN SELECT RAISE(ABORT, 'evidence_claims are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS evidence_claims_no_delete
      BEFORE DELETE ON evidence_claims
      BEGIN SELECT RAISE(ABORT, 'evidence_claims are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS token_measurements_no_update
      BEFORE UPDATE ON token_measurements
      BEGIN SELECT RAISE(ABORT, 'token_measurements are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS token_measurements_no_delete
      BEFORE DELETE ON token_measurements
      BEGIN SELECT RAISE(ABORT, 'token_measurements are append-only'); END;
  `);

  if (previousVersion === 1) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        DROP TRIGGER IF EXISTS verification_records_no_update;
        ALTER TABLE verification_records ADD COLUMN sequence INTEGER;
        WITH ranked AS (
          SELECT
            rowid AS verification_rowid,
            ROW_NUMBER() OVER (
              PARTITION BY run_id
              ORDER BY created_at ASC, rowid ASC
            ) AS assigned_sequence
          FROM verification_records
        )
        UPDATE verification_records
        SET sequence = (
          SELECT assigned_sequence
          FROM ranked
          WHERE ranked.verification_rowid = verification_records.rowid
        );
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS verification_records_run_sequence
      ON verification_records (run_id, sequence);
    CREATE TRIGGER IF NOT EXISTS verification_records_no_update
      BEFORE UPDATE ON verification_records
      BEGIN SELECT RAISE(ABORT, 'verification_records are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS verification_records_no_delete
      BEFORE DELETE ON verification_records
      BEGIN SELECT RAISE(ABORT, 'verification_records are append-only'); END;
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

export class AuditStore {
  #database;
  #closed = false;
  #now;
  #createId;

  constructor({
    databasePath = DEFAULT_DATABASE_PATH,
    now = () => new Date().toISOString(),
    createId = randomUUID,
  } = {}) {
    this.databasePath = resolveDatabasePath(databasePath);
    if (this.databasePath !== ":memory:") {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }
    this.#database = new DatabaseSync(this.databasePath);
    this.#now = now;
    this.#createId = createId;
    bootstrapDatabase(this.#database);
    if (this.databasePath !== ":memory:") {
      this.#database.exec("PRAGMA journal_mode = WAL");
    }
  }

  get schemaVersion() {
    this.#assertOpen();
    return this.#database.prepare("PRAGMA user_version").get().user_version;
  }

  close() {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  createRun(input) {
    this.#assertOpen();
    const run = validateCreateRun(input, this.#dependencies());
    this.#transaction(() => {
      this.#database
        .prepare(`
          INSERT INTO audit_runs (
            id, target_repository_path, repository_identity, commit_sha, task,
            tool_policy_json, run_conditions_json, protocol_version,
            rubric_version, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `)
        .run(
          run.id,
          run.targetRepositoryPath,
          run.repositoryIdentity,
          run.commitSha,
          run.task,
          json(run.toolPolicy),
          json(run.runConditions),
          run.protocolVersion,
          run.rubricVersion,
          run.createdAt,
        );

      const insertParticipant = this.#database.prepare(`
        INSERT INTO run_participants (
          id, run_id, role, provider, model, model_version
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const participant of run.participants) {
        insertParticipant.run(
          participant.id,
          run.id,
          participant.role,
          participant.provider,
          participant.model,
          participant.modelVersion,
        );
      }
    });
    return this.readRun(run.id);
  }

  listRuns({ status, limit = 50 } = {}) {
    this.#assertOpen();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new ProtocolValidationError("limit: must be an integer from 1 through 500");
    }
    const rows =
      status === undefined
        ? this.#database
            .prepare(`
              SELECT * FROM audit_runs
              ORDER BY created_at DESC, id DESC
              LIMIT ?
            `)
            .all(limit)
        : this.#database
            .prepare(`
              SELECT * FROM audit_runs
              WHERE status = ?
              ORDER BY created_at DESC, id DESC
              LIMIT ?
            `)
            .all(status, limit);

    return rows.map((row) => this.#mapRunWithParticipants(row));
  }

  readRun(runId) {
    this.#assertOpen();
    const normalizedRunId = this.#requiredString(runId, "runId");
    const row = this.#database
      .prepare("SELECT * FROM audit_runs WHERE id = ?")
      .get(normalizedRunId);
    if (!row) {
      throw new AuditStoreError("RUN_NOT_FOUND", `Run not found: ${normalizedRunId}`);
    }
    return this.#mapRunWithParticipants(row);
  }

  appendEvent(input) {
    this.#assertOpen();
    const event = validateAppendEvent(input, this.#dependencies());
    if (RESERVED_ACTOR_PATTERN.test(event.actor)) {
      throw new AuditStoreError(
        "RESERVED_AUTHORITY",
        `Actor ${event.actor} is reserved for trusted Waymark operations`,
      );
    }
    if (RESERVED_EVENT_PREFIXES.some((prefix) => event.type.startsWith(prefix))) {
      throw new AuditStoreError(
        "RESERVED_EVENT_TYPE",
        `Event type ${event.type} is reserved for trusted Waymark operations`,
      );
    }
    return this.#transaction(() => {
      this.#assertActiveRun(event.runId);
      const sequence = this.#nextSequence(event.runId);
      this.#database
        .prepare(`
          INSERT INTO audit_events (
            id, run_id, sequence, actor, type, payload_json, occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.id,
          event.runId,
          sequence,
          event.actor,
          event.type,
          json(event.payload),
          event.occurredAt,
        );
      if (event.tokenMeasurement) {
        this.#insertToken({
          ...event.tokenMeasurement,
          runId: event.runId,
          eventId: event.id,
        });
      }
      return { ...event, sequence, tokenMeasurement: undefined };
    });
  }

  readEvents(runId, { afterSequence = 0, limit = 1000 } = {}) {
    this.#assertOpen();
    const normalizedRunId = this.#requiredString(runId, "runId");
    this.#assertRunExists(normalizedRunId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
      throw new ProtocolValidationError(
        "afterSequence: must be a non-negative integer",
      );
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new ProtocolValidationError(
        "limit: must be an integer from 1 through 10000",
      );
    }
    return this.#database
      .prepare(`
        SELECT * FROM audit_events
        WHERE run_id = ? AND sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `)
      .all(normalizedRunId, afterSequence, limit)
      .map(mapEvent);
  }

  submitClaim(input) {
    this.#assertOpen();
    const claim = validateSubmitClaim(input, this.#dependencies());
    return this.#transaction(() => {
      this.#assertActiveRun(claim.runId);
      this.#database
        .prepare(`
          INSERT INTO evidence_claims (
            id, run_id, subject, assertion, claimant, citations_json,
            confidence, criticality, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          claim.id,
          claim.runId,
          claim.subject,
          claim.assertion,
          claim.claimant,
          json(claim.citations),
          claim.confidence,
          claim.criticality,
          claim.createdAt,
        );
      return claim;
    });
  }

  recordVerification(input) {
    this.#assertOpen();
    const verification = validateRecordVerification(
      input,
      this.#dependencies(),
    );
    return this.#transaction(() => {
      this.#assertActiveRun(verification.runId);
      const participant = this.#database
        .prepare(`
          SELECT id, role FROM run_participants
          WHERE run_id = ? AND (id = ? OR role = ?)
          ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END
          LIMIT 1
        `)
        .get(
          verification.runId,
          verification.verifier,
          verification.verifier,
          verification.verifier,
        );
      if (!participant) {
        throw new AuditStoreError(
          "VERIFIER_NOT_PARTICIPANT",
          `Verifier does not resolve to a participant in run ${verification.runId}`,
        );
      }
      if (participant.role !== "verifier" && participant.role !== "orchestrator") {
        throw new AuditStoreError(
          "VERIFIER_NOT_AUTHORIZED",
          `Participant role ${participant.role} cannot record verification verdicts`,
        );
      }
      const claim = this.#database
        .prepare("SELECT run_id FROM evidence_claims WHERE id = ?")
        .get(verification.claimId);
      if (!claim) {
        throw new AuditStoreError(
          "CLAIM_NOT_FOUND",
          `Claim not found: ${verification.claimId}`,
        );
      }
      if (claim.run_id !== verification.runId) {
        throw new AuditStoreError(
          "RUN_MISMATCH",
          "Verification runId does not match the claim runId",
        );
      }
      const sequence = this.#nextVerificationSequence(verification.runId);
      this.#database
        .prepare(`
          INSERT INTO verification_records (
            id, run_id, sequence, claim_id, verifier, method, verdict,
            evidence_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          verification.id,
          verification.runId,
          sequence,
          verification.claimId,
          verification.verifier,
          verification.method,
          verification.verdict,
          json(verification.evidence),
          verification.createdAt,
        );
      return { ...verification, sequence };
    });
  }

  recordTokenMeasurement(input) {
    this.#assertOpen();
    const token = validateTokenMeasurement(input, this.#dependencies());
    return this.#transaction(() => {
      this.#assertActiveRun(token.runId);
      if (token.eventId) {
        const event = this.#database
          .prepare("SELECT run_id FROM audit_events WHERE id = ?")
          .get(token.eventId);
        if (!event) {
          throw new AuditStoreError(
            "EVENT_NOT_FOUND",
            `Event not found: ${token.eventId}`,
          );
        }
        if (event.run_id !== token.runId) {
          throw new AuditStoreError(
            "RUN_MISMATCH",
            "Token measurement runId does not match the event runId",
          );
        }
      }
      this.#insertToken(token);
      return token;
    });
  }

  finishRun(runId, input) {
    this.#assertOpen();
    const normalizedRunId = this.#requiredString(runId, "runId");
    const finish = validateFinishRun(input, { now: this.#now });
    return this.#transaction(() => {
      this.#assertActiveRun(normalizedRunId);
      if (
        finish.status === "completed" &&
        !this.#hasAuthoritativeScore(normalizedRunId)
      ) {
        throw new AuditStoreError(
          "AUTHORITATIVE_SCORE_REQUIRED",
          "A run cannot complete before waymark:scorer records score.completed",
        );
      }
      return this.#finishActiveRun(normalizedRunId, finish);
    });
  }

  completeRunWithAuthoritativeScore(runId, input) {
    this.#assertOpen();
    const normalizedRunId = this.#requiredString(runId, "runId");
    const completion = validateAuthoritativeCompletion(input, {
      now: this.#now,
    });
    return this.#transaction(() => {
      this.#assertActiveRun(normalizedRunId);
      if (this.#hasAuthoritativeScore(normalizedRunId)) {
        throw new AuditStoreError(
          "AUTHORITATIVE_SCORE_EXISTS",
          `Run ${normalizedRunId} already has an authoritative score`,
        );
      }
      const scoreEvent = this.#appendReservedEvent({
        runId: normalizedRunId,
        actor: "waymark:scorer",
        type: "score.completed",
        payload: completion.score,
        occurredAt: completion.finishedAt,
      });
      const finished = this.#finishActiveRun(normalizedRunId, {
        status: "completed",
        summary: completion.summary,
        finishedAt: completion.finishedAt,
      });
      return { ...finished, scoreEvent };
    });
  }

  readSnapshot(runId) {
    this.#assertOpen();
    const run = this.readRun(runId);
    return {
      run,
      events: this.readEvents(run.id, { limit: 10_000 }),
      claims: this.#database
        .prepare(`
          SELECT * FROM evidence_claims
          WHERE run_id = ?
          ORDER BY created_at ASC, id ASC
        `)
        .all(run.id)
        .map(mapClaim),
      verifications: this.#database
        .prepare(`
          SELECT * FROM verification_records
          WHERE run_id = ?
          ORDER BY sequence ASC
        `)
        .all(run.id)
        .map(mapVerification),
      tokens: this.#database
        .prepare(`
          SELECT * FROM token_measurements
          WHERE run_id = ?
          ORDER BY measured_at ASC, id ASC
        `)
        .all(run.id)
        .map(mapToken),
    };
  }

  readReport(runId) {
    const snapshot = this.readSnapshot(runId);
    const latestVerdictByClaim = new Map();
    for (const verification of snapshot.verifications) {
      latestVerdictByClaim.set(verification.claimId, verification.verdict);
    }

    const verdictCounts = {
      verified: 0,
      contradicted: 0,
      unverified: 0,
    };
    for (const verdict of latestVerdictByClaim.values()) {
      verdictCounts[verdict] += 1;
    }

    const tokensByPhase = Object.fromEntries(
      TOKEN_PHASES.map((phase) => [phase, 0]),
    );
    const tokensBySource = Object.fromEntries(
      TOKEN_SOURCES.map((source) => [source, 0]),
    );
    let totalTokens = 0;
    for (const measurement of snapshot.tokens) {
      totalTokens += measurement.totalTokens;
      tokensByPhase[measurement.phase] += measurement.totalTokens;
      tokensBySource[measurement.source] += measurement.totalTokens;
    }

    const claimsWithVerdict = latestVerdictByClaim.size;
    return {
      ...snapshot,
      aggregates: {
        eventCount: snapshot.events.length,
        claimCount: snapshot.claims.length,
        verificationCount: snapshot.verifications.length,
        verifiedClaimCount: verdictCounts.verified,
        contradictedClaimCount: verdictCounts.contradicted,
        unverifiedClaimCount: verdictCounts.unverified,
        claimsWithoutVerdictCount: snapshot.claims.length - claimsWithVerdict,
        verificationCoverage:
          snapshot.claims.length === 0
            ? 0
            : claimsWithVerdict / snapshot.claims.length,
        totalTokens,
        tokensByPhase,
        tokensBySource,
      },
    };
  }

  #dependencies() {
    return { now: this.#now, createId: this.#createId };
  }

  #assertOpen() {
    if (this.#closed) {
      throw new AuditStoreError("STORE_CLOSED", "Audit store is closed");
    }
  }

  #requiredString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ProtocolValidationError(`${name}: must be a non-empty string`);
    }
    return value.trim();
  }

  #assertRunExists(runId) {
    const row = this.#database
      .prepare("SELECT id FROM audit_runs WHERE id = ?")
      .get(runId);
    if (!row) {
      throw new AuditStoreError("RUN_NOT_FOUND", `Run not found: ${runId}`);
    }
  }

  #assertActiveRun(runId) {
    const row = this.#database
      .prepare("SELECT status FROM audit_runs WHERE id = ?")
      .get(runId);
    if (!row) {
      throw new AuditStoreError("RUN_NOT_FOUND", `Run not found: ${runId}`);
    }
    if (row.status !== "active") {
      throw new AuditStoreError(
        "RUN_NOT_ACTIVE",
        `Run ${runId} is ${row.status}; append operations require an active run`,
      );
    }
  }

  #mapRunWithParticipants(row) {
    const participants = this.#database
      .prepare(`
        SELECT * FROM run_participants
        WHERE run_id = ?
        ORDER BY role ASC
      `)
      .all(row.id)
      .map(mapParticipant);
    return mapRun(row, participants);
  }

  #nextSequence(runId) {
    return (
      this.#database
        .prepare(`
          SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
          FROM audit_events
          WHERE run_id = ?
        `)
        .get(runId).next_sequence
    );
  }

  #nextVerificationSequence(runId) {
    return this.#database
      .prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM verification_records
        WHERE run_id = ?
      `)
      .get(runId).next_sequence;
  }

  #hasAuthoritativeScore(runId) {
    return Boolean(
      this.#database
        .prepare(`
          SELECT 1 FROM audit_events
          WHERE run_id = ?
            AND actor = 'waymark:scorer'
            AND type = 'score.completed'
          LIMIT 1
        `)
        .get(runId),
    );
  }

  #appendReservedEvent({ runId, actor, type, payload, occurredAt }) {
    const sequence = this.#nextSequence(runId);
    const id = this.#createId();
    this.#database
      .prepare(`
        INSERT INTO audit_events (
          id, run_id, sequence, actor, type, payload_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, runId, sequence, actor, type, json(payload), occurredAt);
    return {
      id,
      runId,
      sequence,
      actor,
      type,
      payload,
      occurredAt,
    };
  }

  #finishActiveRun(runId, finish) {
    const event = this.#appendReservedEvent({
      runId,
      actor: "waymark",
      type: "run.finished",
      payload: { status: finish.status, summary: finish.summary },
      occurredAt: finish.finishedAt,
    });
    this.#database
      .prepare(`
        UPDATE audit_runs
        SET status = ?, finished_at = ?
        WHERE id = ? AND status = 'active'
      `)
      .run(finish.status, finish.finishedAt, runId);
    return { run: this.readRun(runId), event };
  }

  #insertToken(token) {
    this.#database
      .prepare(`
        INSERT INTO token_measurements (
          id, run_id, event_id, actor, phase, source, provider, model,
          input_tokens, output_tokens, cached_input_tokens,
          cache_creation_tokens, total_tokens, measured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        token.id,
        token.runId,
        token.eventId,
        token.actor,
        token.phase,
        token.source,
        token.provider,
        token.model,
        token.inputTokens,
        token.outputTokens,
        token.cachedInputTokens,
        token.cacheCreationTokens,
        token.totalTokens,
        token.measuredAt,
      );
  }

  #transaction(operation) {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}
