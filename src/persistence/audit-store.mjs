import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  GENERAL_AUDIT_EVENT_TYPES,
  GeneralAuditProjectionError,
  projectGeneralAudit,
} from "../domain/general-audit.mjs";
import {
  ProtocolValidationError,
  validateAppendEvent,
  validateAuthoritativeCompletion,
  validateCreateRun,
  validateFinishRun,
  validateGeneralCheckpoint,
  validateRecordVerification,
  validateReportRecommendations,
  validateSubmitClaim,
  validateTokenMeasurement,
} from "../protocol/validation.mjs";

export const SCHEMA_VERSION = 6;
export const DEFAULT_DATABASE_PATH = ".waymark/waymark.sqlite";

const RESERVED_ACTOR_PATTERN = /^waymark(?::|$)/;
const RESERVED_EVENT_PREFIXES = ["run.", "score.", "general."];
const GENERAL_AUDIT_EVENT_TYPE_SET = new Set(GENERAL_AUDIT_EVENT_TYPES);

const TOKEN_PHASES = [
  "candidate_navigation",
  "general_research",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
];

const TOKEN_SOURCES = ["provider_reported", "measured", "estimated"];

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
    name: row.name ?? null,
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
      name TEXT,
      task TEXT NOT NULL,
      tool_policy_json TEXT NOT NULL,
      run_conditions_json TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('active', 'completed', 'partial', 'failed', 'cancelled')
      ),
      created_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS run_participants (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      role TEXT NOT NULL CHECK (
        role IN (
          'orchestrator',
          'candidate',
          'independent',
          'verifier',
          'reporter',
          'auditor'
        )
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
      idempotency_key TEXT,
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
          'general_research',
          'independent_validation',
          'orchestration',
          'deterministic_verification',
          'report_generation'
        )
      ),
      source TEXT NOT NULL CHECK (
        source IN ('provider_reported', 'measured', 'estimated')
      ),
      provider TEXT,
      model TEXT,
      input_tokens INTEGER CHECK (input_tokens >= 0),
      output_tokens INTEGER CHECK (output_tokens >= 0),
      cached_input_tokens INTEGER CHECK (cached_input_tokens >= 0),
      cache_creation_tokens INTEGER CHECK (cache_creation_tokens >= 0),
      total_tokens INTEGER NOT NULL CHECK (
        total_tokens >= COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
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

  if (previousVersion > 0 && previousVersion < 3) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        DROP TRIGGER IF EXISTS token_measurements_no_update;
        DROP TRIGGER IF EXISTS token_measurements_no_delete;
        DROP INDEX IF EXISTS token_measurements_run;

        CREATE TABLE token_measurements_v3 (
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
            source IN ('provider_reported', 'measured', 'estimated')
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

        INSERT INTO token_measurements_v3 (
          id,
          run_id,
          event_id,
          actor,
          phase,
          source,
          provider,
          model,
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_creation_tokens,
          total_tokens,
          measured_at
        )
        SELECT
          id,
          run_id,
          event_id,
          actor,
          phase,
          source,
          provider,
          model,
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_creation_tokens,
          total_tokens,
          measured_at
        FROM token_measurements;

        DROP TABLE token_measurements;
        ALTER TABLE token_measurements_v3 RENAME TO token_measurements;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (previousVersion > 0 && previousVersion < 4) {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        DROP TRIGGER IF EXISTS token_measurements_no_update;
        DROP TRIGGER IF EXISTS token_measurements_no_delete;
        DROP INDEX IF EXISTS token_measurements_run;

        CREATE TABLE token_measurements_v4 (
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
            source IN ('provider_reported', 'measured', 'estimated')
          ),
          provider TEXT,
          model TEXT,
          input_tokens INTEGER CHECK (input_tokens >= 0),
          output_tokens INTEGER CHECK (output_tokens >= 0),
          cached_input_tokens INTEGER CHECK (cached_input_tokens >= 0),
          cache_creation_tokens INTEGER CHECK (cache_creation_tokens >= 0),
          total_tokens INTEGER NOT NULL CHECK (
            total_tokens >=
              COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
          ),
          measured_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO token_measurements_v4 (
          id,
          run_id,
          event_id,
          actor,
          phase,
          source,
          provider,
          model,
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_creation_tokens,
          total_tokens,
          measured_at
        )
        SELECT
          id,
          run_id,
          event_id,
          actor,
          phase,
          source,
          provider,
          model,
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_creation_tokens,
          total_tokens,
          measured_at
        FROM token_measurements;

        DROP TABLE token_measurements;
        ALTER TABLE token_measurements_v4 RENAME TO token_measurements;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  if (previousVersion > 0 && previousVersion < 5) {
    database.exec("ALTER TABLE audit_runs ADD COLUMN name TEXT");
  }

  if (previousVersion > 0 && previousVersion < 6) {
    const auditEventsHaveIdempotencyKey = database
      .prepare("PRAGMA table_info(audit_events)")
      .all()
      .some((column) => column.name === "idempotency_key");
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        DROP TRIGGER IF EXISTS run_participants_no_update;
        DROP TRIGGER IF EXISTS run_participants_no_delete;
        DROP TRIGGER IF EXISTS token_measurements_no_update;
        DROP TRIGGER IF EXISTS token_measurements_no_delete;
        DROP INDEX IF EXISTS token_measurements_run;

        CREATE TABLE audit_runs_v6 (
          id TEXT PRIMARY KEY,
          target_repository_path TEXT NOT NULL,
          repository_identity TEXT NOT NULL,
          commit_sha TEXT NOT NULL,
          name TEXT,
          task TEXT NOT NULL,
          tool_policy_json TEXT NOT NULL,
          run_conditions_json TEXT NOT NULL,
          protocol_version TEXT NOT NULL,
          rubric_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK (
            status IN ('active', 'completed', 'partial', 'failed', 'cancelled')
          ),
          created_at TEXT NOT NULL,
          finished_at TEXT
        ) STRICT;

        INSERT INTO audit_runs_v6
        SELECT
          id,
          target_repository_path,
          repository_identity,
          commit_sha,
          name,
          task,
          tool_policy_json,
          run_conditions_json,
          protocol_version,
          rubric_version,
          status,
          created_at,
          finished_at
        FROM audit_runs;

        DROP TABLE audit_runs;
        ALTER TABLE audit_runs_v6 RENAME TO audit_runs;

        CREATE TABLE run_participants_v6 (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES audit_runs(id),
          role TEXT NOT NULL CHECK (
            role IN (
              'orchestrator',
              'candidate',
              'independent',
              'verifier',
              'reporter',
              'auditor'
            )
          ),
          provider TEXT NOT NULL,
          model TEXT NOT NULL,
          model_version TEXT,
          UNIQUE (run_id, role)
        ) STRICT;

        INSERT INTO run_participants_v6
        SELECT id, run_id, role, provider, model, model_version
        FROM run_participants;

        DROP TABLE run_participants;
        ALTER TABLE run_participants_v6 RENAME TO run_participants;

        CREATE TABLE token_measurements_v6 (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL REFERENCES audit_runs(id),
          event_id TEXT REFERENCES audit_events(id),
          actor TEXT NOT NULL,
          phase TEXT NOT NULL CHECK (
            phase IN (
              'candidate_navigation',
              'general_research',
              'independent_validation',
              'orchestration',
              'deterministic_verification',
              'report_generation'
            )
          ),
          source TEXT NOT NULL CHECK (
            source IN ('provider_reported', 'measured', 'estimated')
          ),
          provider TEXT,
          model TEXT,
          input_tokens INTEGER CHECK (input_tokens >= 0),
          output_tokens INTEGER CHECK (output_tokens >= 0),
          cached_input_tokens INTEGER CHECK (cached_input_tokens >= 0),
          cache_creation_tokens INTEGER CHECK (cache_creation_tokens >= 0),
          total_tokens INTEGER NOT NULL CHECK (
            total_tokens >=
              COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)
          ),
          measured_at TEXT NOT NULL
        ) STRICT;

        INSERT INTO token_measurements_v6
        SELECT
          id,
          run_id,
          event_id,
          actor,
          phase,
          source,
          provider,
          model,
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_creation_tokens,
          total_tokens,
          measured_at
        FROM token_measurements;

        DROP TABLE token_measurements;
        ALTER TABLE token_measurements_v6 RENAME TO token_measurements;
      `);
      if (!auditEventsHaveIdempotencyKey) {
        database.exec(
          "ALTER TABLE audit_events ADD COLUMN idempotency_key TEXT",
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.exec("PRAGMA foreign_keys = ON");
    }
    const foreignKeyIssue = database.prepare("PRAGMA foreign_key_check").get();
    if (foreignKeyIssue) {
      throw new AuditStoreError(
        "MIGRATION_FOREIGN_KEY_FAILURE",
        `Schema migration left an invalid foreign key in ${foreignKeyIssue.table}`,
        foreignKeyIssue,
      );
    }
  }

  database.exec(`
    CREATE INDEX IF NOT EXISTS token_measurements_run
      ON token_measurements (run_id, measured_at, id);
    CREATE TRIGGER IF NOT EXISTS token_measurements_no_update
      BEFORE UPDATE ON token_measurements
      BEGIN SELECT RAISE(ABORT, 'token_measurements are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS token_measurements_no_delete
      BEFORE DELETE ON token_measurements
      BEGIN SELECT RAISE(ABORT, 'token_measurements are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS run_participants_no_update
      BEFORE UPDATE ON run_participants
      BEGIN SELECT RAISE(ABORT, 'run_participants are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS run_participants_no_delete
      BEFORE DELETE ON run_participants
      BEGIN SELECT RAISE(ABORT, 'run_participants are immutable'); END;
    CREATE UNIQUE INDEX IF NOT EXISTS audit_events_run_idempotency
      ON audit_events (run_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
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
            id, target_repository_path, repository_identity, commit_sha, name, task,
            tool_policy_json, run_conditions_json, protocol_version,
            rubric_version, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        `)
        .run(
          run.id,
          run.targetRepositoryPath,
          run.repositoryIdentity,
          run.commitSha,
          run.name,
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

  readCompletedTokenAverages({ auditMode } = {}) {
    this.#assertOpen();
    if (
      auditMode !== undefined &&
      (typeof auditMode !== "string" || auditMode.trim() === "")
    ) {
      throw new TypeError("auditMode must be a non-empty string");
    }
    const rows = this.#database
      .prepare(`
        SELECT
          phase,
          COUNT(*) AS sample_count,
          AVG(run_tokens) AS average_tokens
        FROM (
          SELECT
            token_measurements.run_id,
            token_measurements.phase,
            SUM(token_measurements.total_tokens) AS run_tokens
          FROM token_measurements
          INNER JOIN audit_runs
            ON audit_runs.id = token_measurements.run_id
          WHERE audit_runs.status = 'completed'
            AND (
              ? IS NULL
              OR COALESCE(
                json_extract(audit_runs.run_conditions_json, '$.auditMode'),
                'task_specific'
              ) = ?
            )
          GROUP BY token_measurements.run_id, token_measurements.phase
        )
        GROUP BY phase
      `)
      .all(auditMode ?? null, auditMode ?? null);
    const byPhase = new Map(rows.map((row) => [row.phase, row]));

    return Object.fromEntries(
      TOKEN_PHASES.map((phase) => {
        const row = byPhase.get(phase);
        return [
          phase,
          {
            averageTokens: row ? Math.round(row.average_tokens) : null,
            sampleSize: row ? Number(row.sample_count) : 0,
          },
        ];
      }),
    );
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

  appendGeneralCheckpoint(input) {
    this.#assertOpen();
    const checkpoint = validateGeneralCheckpoint(input, this.#dependencies());
    return this.#transaction(() => {
      const existing = this.#database
        .prepare(`
          SELECT * FROM audit_events
          WHERE run_id = ? AND idempotency_key = ?
          LIMIT 1
        `)
        .get(checkpoint.runId, checkpoint.idempotencyKey);
      if (existing) {
        const persisted = mapEvent(existing);
        if (
          persisted.actor !== checkpoint.actor ||
          persisted.type !== checkpoint.type ||
          json(persisted.payload) !== json(checkpoint.payload)
        ) {
          throw new AuditStoreError(
            "IDEMPOTENCY_CONFLICT",
            `Idempotency key ${checkpoint.idempotencyKey} is already bound to a different checkpoint`,
          );
        }
        return persisted;
      }

      this.#assertActiveRun(checkpoint.runId);
      const run = this.readRun(checkpoint.runId);
      if (run.runConditions.auditMode !== "general") {
        throw new AuditStoreError(
          "GENERAL_CHECKPOINT_MODE_MISMATCH",
          `Run ${checkpoint.runId} is not a general audit`,
        );
      }
      const auditor = run.participants.find(
        (participant) => participant.role === "auditor",
      );
      if (!auditor || auditor.id !== checkpoint.actor) {
        throw new AuditStoreError(
          "GENERAL_AUDITOR_NOT_AUTHORIZED",
          `Actor ${checkpoint.actor} is not the auditor for run ${checkpoint.runId}`,
        );
      }
      if (
        checkpoint.type === "general.audit.started" &&
        (checkpoint.payload.repositoryIdentity !== run.repositoryIdentity ||
          checkpoint.payload.commitSha !== run.commitSha ||
          checkpoint.payload.protocolVersion !== run.protocolVersion)
      ) {
        throw new AuditStoreError(
          "GENERAL_START_RUN_MISMATCH",
          "The general audit start checkpoint must match persisted run provenance",
        );
      }

      const sequence = this.#nextSequence(checkpoint.runId);
      const event = {
        id: checkpoint.id,
        runId: checkpoint.runId,
        sequence,
        actor: checkpoint.actor,
        type: checkpoint.type,
        payload: checkpoint.payload,
        occurredAt: checkpoint.occurredAt,
      };
      const existingGeneralEvents = this.readEvents(checkpoint.runId, {
        limit: 10_000,
      }).filter((candidate) =>
        GENERAL_AUDIT_EVENT_TYPE_SET.has(candidate.type),
      );
      try {
        projectGeneralAudit([...existingGeneralEvents, event]);
      } catch (error) {
        if (error instanceof GeneralAuditProjectionError) {
          throw new AuditStoreError(
            error.code.toUpperCase(),
            error.message,
            { eventId: error.eventId },
          );
        }
        throw error;
      }

      this.#database
        .prepare(`
          INSERT INTO audit_events (
            id,
            run_id,
            sequence,
            actor,
            type,
            payload_json,
            occurred_at,
            idempotency_key
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.id,
          event.runId,
          event.sequence,
          event.actor,
          event.type,
          json(event.payload),
          event.occurredAt,
          checkpoint.idempotencyKey,
        );
      return event;
    });
  }

  startGeneralAudit(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.audit.started",
    });
  }

  recordGeneralSurface(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.surface.inspected",
    });
  }

  recordGeneralBehaviorPath(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.behavior_path.recorded",
    });
  }

  recordGeneralFinding(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.finding.recorded",
    });
  }

  reviseGeneralFinding(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.finding.revised",
    });
  }

  recordGeneralDimensionProgress(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.dimension.progress",
    });
  }

  assessGeneralDimension(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.dimension.assessed",
    });
  }

  recordGeneralRecommendation(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.recommendation.recorded",
    });
  }

  completeGeneralSynthesis(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.synthesis.completed",
    });
  }

  interruptGeneralAudit(input) {
    return this.appendGeneralCheckpoint({
      ...input,
      type: "general.audit.interrupted",
    });
  }

  appendReportRecommendations(runId, input) {
    this.#assertOpen();
    const normalizedRunId = this.#requiredString(runId, "runId");
    const reportRecommendations = validateReportRecommendations(
      input,
      this.#dependencies(),
    );

    return this.#transaction(() => {
      const run = this.readRun(normalizedRunId);
      if (!["active", "completed"].includes(run.status)) {
        throw new AuditStoreError(
          "RUN_NOT_REPORTABLE",
          `Run ${normalizedRunId} is ${run.status}; report recommendations require an active or completed run`,
        );
      }

      const report = this.readReport(normalizedRunId);
      const claims = new Map(report.claims.map((claim) => [claim.id, claim]));
      for (const recommendation of reportRecommendations.recommendations) {
        for (const claimId of recommendation.claimIds) {
          if (!claims.has(claimId)) {
            throw new AuditStoreError(
              "RECOMMENDATION_CLAIM_NOT_FOUND",
              `Recommendation ${recommendation.id} references unknown claim ${claimId}`,
            );
          }
          const deterministicVerification = report.verifications
            .filter(
              (verification) =>
                verification.claimId === claimId &&
                ["static_inspection", "executable_probe"].includes(
                  verification.method,
                ),
            )
            .sort(
              (left, right) =>
                (left.sequence ?? 0) - (right.sequence ?? 0),
            )
            .at(-1);
          if (deterministicVerification?.verdict !== "verified") {
            throw new AuditStoreError(
              "RECOMMENDATION_CLAIM_NOT_VERIFIED",
              `Recommendation ${recommendation.id} requires a deterministically verified claim: ${claimId}`,
            );
          }
        }
      }

      return this.#appendReservedEvent({
        runId: normalizedRunId,
        actor: "waymark:reporter",
        type: "report.recommendations",
        payload: {
          schemaVersion: reportRecommendations.schemaVersion,
          scope: reportRecommendations.scope,
          method: reportRecommendations.method,
          recommendations: reportRecommendations.recommendations,
        },
        occurredAt: reportRecommendations.createdAt,
      });
    });
  }

  appendReportPracticeProfile(runId, input) {
    this.#assertOpen();
    const normalizedRunId = this.#requiredString(runId, "runId");
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      input.scope !== "general_repository" ||
      typeof input.schemaVersion !== "string" ||
      input.schemaVersion.trim() === "" ||
      !Array.isArray(input.items) ||
      input.items.length !== 7
    ) {
      throw new ProtocolValidationError(
        "practiceProfile: must contain a schema version, general_repository scope, and exactly seven items",
      );
    }

    return this.#transaction(() => {
      const run = this.readRun(normalizedRunId);
      if (!["active", "completed"].includes(run.status)) {
        throw new AuditStoreError(
          "RUN_NOT_REPORTABLE",
          `Run ${normalizedRunId} is ${run.status}; a practice profile requires an active or completed run`,
        );
      }
      return this.#appendReservedEvent({
        runId: normalizedRunId,
        actor: "waymark:reporter",
        type: "report.practice_profile",
        payload: {
          schemaVersion: input.schemaVersion,
          scope: input.scope,
          suite: input.suite ?? null,
          items: input.items,
        },
        occurredAt:
          typeof input.createdAt === "string"
            ? input.createdAt
            : this.#now(),
      });
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
      const run = this.readRun(normalizedRunId);
      if (run.runConditions.auditMode === "general") {
        const projection = this.#projectGeneralAudit(normalizedRunId);
        if (projection.status !== finish.status) {
          throw new AuditStoreError(
            "GENERAL_TERMINAL_STATUS_MISMATCH",
            `General ledger status ${projection.status} cannot finish the run as ${finish.status}`,
          );
        }
      } else {
        if (finish.status === "partial") {
          throw new AuditStoreError(
            "PARTIAL_STATUS_REQUIRES_GENERAL_AUDIT",
            "Only a general audit can finish with partial status",
          );
        }
        if (
          finish.status === "completed" &&
          !this.#hasAuthoritativeScore(normalizedRunId)
        ) {
          throw new AuditStoreError(
            "AUTHORITATIVE_SCORE_REQUIRED",
            "A run cannot complete before waymark:scorer records score.completed",
          );
        }
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
      if (this.readRun(normalizedRunId).runConditions.auditMode === "general") {
        throw new AuditStoreError(
          "GENERAL_AUDIT_NOT_DETERMINISTICALLY_SCORED",
          "General audits complete from auditor synthesis, not the benchmark scorer",
        );
      }
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
    const generalAudit =
      snapshot.run.runConditions.auditMode === "general"
        ? projectGeneralAudit(
            snapshot.events.filter((event) =>
              GENERAL_AUDIT_EVENT_TYPE_SET.has(event.type),
            ),
          )
        : null;
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
      generalAudit,
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

  #projectGeneralAudit(runId) {
    return projectGeneralAudit(
      this.readEvents(runId, { limit: 10_000 }).filter((event) =>
        GENERAL_AUDIT_EVENT_TYPE_SET.has(event.type),
      ),
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
