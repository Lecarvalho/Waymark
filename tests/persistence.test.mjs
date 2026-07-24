import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

import {
  AuditStore,
  AuditStoreError,
  SCHEMA_VERSION,
} from "../src/persistence/index.mjs";

const temporaryDirectories = [];

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "waymark-persistence-"));
  temporaryDirectories.push(directory);
  return join(directory, "waymark.sqlite");
}

function createRun(store, overrides = {}) {
  return store.createRun({
    id: "run-1",
    targetRepositoryPath: "C:\\repos\\payments",
    repositoryIdentity: "git@example.test:team/payments.git",
    commitSha: "0123456789abcdef",
    task: "Add partial refunds without changing authorization behavior.",
    participants: [
      {
        id: "participant-candidate",
        role: "candidate",
        provider: "openai",
        model: "candidate-model",
      },
      {
        id: "participant-orchestrator",
        role: "orchestrator",
        provider: "openai",
        model: "orchestrator-model",
      },
      {
        id: "participant-independent",
        role: "independent",
        provider: "anthropic",
        model: "independent-model",
      },
    ],
    toolPolicy: { targetRepository: "read-only" },
    runConditions: { cleanCheckout: true },
    protocolVersion: "1.0.0",
    rubricVersion: "1.0.0",
    createdAt: "2026-07-23T12:00:00.000Z",
    ...overrides,
  });
}

test("audit journal, evidence, verdicts, and tokens survive reopen", () => {
  const databasePath = temporaryDatabase();
  let store = new AuditStore({ databasePath });

  const run = createRun(store, { authoritativeScore: 99 });
  assert.equal(store.schemaVersion, SCHEMA_VERSION);
  assert.equal(run.status, "active");
  assert.equal(run.participants.length, 3);
  assert.equal("authoritativeScore" in run, false);

  const firstEvent = store.appendEvent({
    id: "event-1",
    runId: run.id,
    actor: "candidate",
    type: "repository.search",
    payload: { query: "refund", matches: 4 },
    occurredAt: "2026-07-23T12:01:00.000Z",
    tokenMeasurement: {
      id: "token-1",
      actor: "candidate",
      phase: "candidate_navigation",
      source: "provider_reported",
      provider: "openai",
      model: "candidate-model",
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      measuredAt: "2026-07-23T12:01:01.000Z",
    },
  });
  assert.equal(firstEvent.sequence, 1);

  const claim = store.submitClaim({
    id: "claim-1",
    runId: run.id,
    subject: "refund ownership",
    assertion: "Refund orchestration is owned by src/refunds/refund-service.ts.",
    claimant: "candidate",
    citations: [
      {
        path: "src/refunds/refund-service.ts",
        startLine: 14,
        endLine: 72,
        symbol: "RefundService",
      },
    ],
    confidence: 0.93,
    criticality: "critical",
    createdAt: "2026-07-23T12:02:00.000Z",
  });

  const verification = store.recordVerification({
    id: "verification-1",
    runId: run.id,
    claimId: claim.id,
    verifier: "participant-orchestrator",
    method: "static_inspection",
    verdict: "verified",
    evidence: { fileExists: true, symbolFound: true },
    createdAt: "2026-07-23T12:03:00.000Z",
  });
  assert.equal(verification.sequence, 1);
  store.close();

  store = new AuditStore({ databasePath });
  const secondEvent = store.appendEvent({
    id: "event-2",
    runId: run.id,
    actor: "independent",
    type: "claim.reviewed",
    payload: { claimId: claim.id },
    occurredAt: "2026-07-23T12:04:00.000Z",
  });
  assert.equal(secondEvent.sequence, 2);

  store.recordTokenMeasurement({
    id: "token-2",
    runId: run.id,
    eventId: secondEvent.id,
    actor: "independent",
    phase: "independent_validation",
    source: "estimated",
    inputTokens: 70,
    outputTokens: 20,
    totalTokens: 90,
    measuredAt: "2026-07-23T12:04:01.000Z",
  });
  store.recordTokenMeasurement({
    id: "token-3",
    runId: run.id,
    actor: "orchestrator",
    phase: "orchestration",
    source: "measured",
    provider: "codex-host",
    inputTokens: 30,
    outputTokens: 10,
    totalTokens: 40,
    measuredAt: "2026-07-23T12:04:02.000Z",
  });

  assert.throws(
    () =>
      store.finishRun(run.id, {
        status: "completed",
        summary: {},
        finishedAt: "2026-07-23T12:05:00.000Z",
      }),
    (error) =>
      error instanceof AuditStoreError &&
      error.code === "AUTHORITATIVE_SCORE_REQUIRED",
  );

  const finished = store.completeRunWithAuthoritativeScore(run.id, {
    score: {
      rubricVersion: "1.0.0",
      dimensions: { discoveryEfficiency: 82 },
      reliability: 0.91,
    },
    summary: { reason: "evidence ledger complete" },
    finishedAt: "2026-07-23T12:05:00.000Z",
  });
  assert.equal(finished.scoreEvent.sequence, 3);
  assert.equal(finished.scoreEvent.actor, "waymark:scorer");
  assert.equal(finished.scoreEvent.type, "score.completed");
  assert.equal(finished.event.sequence, 4);
  store.close();

  store = new AuditStore({ databasePath });
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "completed");
  assert.deepEqual(
    report.events.map(({ sequence }) => sequence),
    [1, 2, 3, 4],
  );
  assert.equal(report.claims.length, 1);
  assert.equal(report.verifications.length, 1);
  assert.equal(report.aggregates.verificationCoverage, 1);
  assert.equal(report.aggregates.verifiedClaimCount, 1);
  assert.equal(report.aggregates.totalTokens, 280);
  assert.equal(report.aggregates.tokensBySource.provider_reported, 150);
  assert.equal(report.aggregates.tokensBySource.measured, 40);
  assert.equal(report.aggregates.tokensBySource.estimated, 90);
  assert.equal(
    report.tokens.find(({ id }) => id === "token-2").cachedInputTokens,
    null,
  );
  assert.equal(
    report.tokens.find(({ id }) => id === "token-2").cacheCreationTokens,
    null,
  );
  assert.equal("scores" in report, false);
  assert.throws(
    () =>
      store.appendEvent({
        runId: run.id,
        actor: "candidate",
        type: "late.event",
        payload: {},
      }),
    (error) =>
      error instanceof AuditStoreError && error.code === "RUN_NOT_ACTIVE",
  );
  store.close();
});

test("generic event appends cannot impersonate trusted Waymark authority", () => {
  const store = new AuditStore({ databasePath: temporaryDatabase() });
  const run = createRun(store);

  assert.throws(
    () =>
      store.appendEvent({
        runId: run.id,
        actor: "waymark:scorer",
        type: "repository.search",
        payload: {},
      }),
    (error) =>
      error instanceof AuditStoreError && error.code === "RESERVED_AUTHORITY",
  );
  assert.throws(
    () =>
      store.appendEvent({
        runId: run.id,
        actor: "candidate",
        type: "score.completed",
        payload: { score: 100 },
      }),
    (error) =>
      error instanceof AuditStoreError && error.code === "RESERVED_EVENT_TYPE",
  );
  assert.throws(
    () =>
      store.appendEvent({
        runId: run.id,
        actor: "candidate",
        type: "run.finished",
        payload: {},
      }),
    (error) =>
      error instanceof AuditStoreError && error.code === "RESERVED_EVENT_TYPE",
  );

  const cancelled = store.finishRun(run.id, {
    status: "cancelled",
    summary: { reason: "operator cancelled" },
  });
  assert.equal(cancelled.run.status, "cancelled");
  store.close();
});

test("only authorized participants verify and database sequence decides latest verdict", () => {
  const store = new AuditStore({ databasePath: temporaryDatabase() });
  const run = createRun(store);
  const claim = store.submitClaim({
    id: "ordered-claim",
    runId: run.id,
    subject: "consumer inventory",
    assertion: "All refund consumers are statically registered.",
    claimant: "candidate",
    citations: [],
    confidence: 0.99,
    criticality: "critical",
  });

  assert.throws(
    () =>
      store.recordVerification({
        runId: run.id,
        claimId: claim.id,
        verifier: "participant-candidate",
        method: "independent_model",
        verdict: "verified",
        evidence: {},
      }),
    (error) =>
      error instanceof AuditStoreError &&
      error.code === "VERIFIER_NOT_AUTHORIZED",
  );
  assert.throws(
    () =>
      store.recordVerification({
        runId: run.id,
        claimId: claim.id,
        verifier: "not-in-run",
        method: "static_inspection",
        verdict: "verified",
        evidence: {},
      }),
    (error) =>
      error instanceof AuditStoreError &&
      error.code === "VERIFIER_NOT_PARTICIPANT",
  );
  assert.throws(
    () =>
      store.recordVerification({
        runId: run.id,
        claimId: claim.id,
        verifier: "participant-orchestrator",
        method: "candidate_opinion",
        verdict: "verified",
        evidence: {},
      }),
    (error) => error?.code === "INVALID_INPUT",
  );

  const first = store.recordVerification({
    id: "ordered-verification-1",
    runId: run.id,
    claimId: claim.id,
    verifier: "participant-orchestrator",
    method: "static_inspection",
    verdict: "verified",
    evidence: { inspection: "registration file" },
    createdAt: "2026-07-23T13:00:00.000Z",
  });
  const second = store.recordVerification({
    id: "ordered-verification-2",
    runId: run.id,
    claimId: claim.id,
    verifier: "orchestrator",
    method: "executable_probe",
    verdict: "contradicted",
    evidence: { probe: "runtime registration found" },
    createdAt: "2026-07-23T11:00:00.000Z",
  });
  assert.deepEqual([first.sequence, second.sequence], [1, 2]);

  const report = store.readReport(run.id);
  assert.deepEqual(
    report.verifications.map(({ id }) => id),
    ["ordered-verification-1", "ordered-verification-2"],
  );
  assert.equal(report.aggregates.verifiedClaimCount, 0);
  assert.equal(report.aggregates.contradictedClaimCount, 1);
  store.close();
});

test("schema v1 verification rows migrate to monotonic per-run sequence", () => {
  const databasePath = temporaryDatabase();
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE audit_runs (
      id TEXT PRIMARY KEY,
      target_repository_path TEXT NOT NULL,
      repository_identity TEXT NOT NULL,
      commit_sha TEXT NOT NULL,
      task TEXT NOT NULL,
      tool_policy_json TEXT NOT NULL,
      run_conditions_json TEXT NOT NULL,
      protocol_version TEXT NOT NULL,
      rubric_version TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      finished_at TEXT
    ) STRICT;
    CREATE TABLE evidence_claims (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      subject TEXT NOT NULL,
      assertion TEXT NOT NULL,
      claimant TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      criticality TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE verification_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES audit_runs(id),
      claim_id TEXT NOT NULL REFERENCES evidence_claims(id),
      verifier TEXT NOT NULL,
      method TEXT NOT NULL,
      verdict TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TRIGGER verification_records_no_update
      BEFORE UPDATE ON verification_records
      BEGIN SELECT RAISE(ABORT, 'verification_records are append-only'); END;
    INSERT INTO audit_runs VALUES (
      'legacy-run', 'C:\\repo', 'legacy', 'abc', 'task', '{}', '{}',
      '1.0.0', '1.0.0', 'active', '2026-07-23T00:00:00.000Z', NULL
    );
    INSERT INTO evidence_claims VALUES (
      'legacy-claim', 'legacy-run', 'subject', 'assertion', 'candidate', '[]',
      0.8, 'high', '2026-07-23T00:01:00.000Z'
    );
    INSERT INTO verification_records VALUES (
      'legacy-verification-1', 'legacy-run', 'legacy-claim', 'orchestrator',
      'static_inspection', 'verified', '{}', '2026-07-23T00:02:00.000Z'
    );
    INSERT INTO verification_records VALUES (
      'legacy-verification-2', 'legacy-run', 'legacy-claim', 'orchestrator',
      'executable_probe', 'contradicted', '{}', '2026-07-23T00:03:00.000Z'
    );
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const store = new AuditStore({ databasePath });
  assert.equal(store.schemaVersion, 4);
  assert.deepEqual(
    store
      .readSnapshot("legacy-run")
      .verifications.map(({ sequence }) => sequence),
    [1, 2],
  );
  assert.equal(store.readReport("legacy-run").aggregates.contradictedClaimCount, 1);
  store.close();
});

test("sequence allocation is independent and monotonic per run", () => {
  const store = new AuditStore({ databasePath: temporaryDatabase() });
  const firstRun = createRun(store);
  const secondRun = createRun(store, {
    id: "run-2",
    participants: [
      {
        id: "run-2-candidate",
        role: "candidate",
        provider: "openai",
        model: "candidate-model",
      },
      {
        id: "run-2-orchestrator",
        role: "orchestrator",
        provider: "openai",
        model: "orchestrator-model",
      },
    ],
  });

  const sequences = [
    store.appendEvent({
      runId: firstRun.id,
      actor: "candidate",
      type: "file.opened",
      payload: { path: "one.ts" },
    }).sequence,
    store.appendEvent({
      runId: secondRun.id,
      actor: "candidate",
      type: "file.opened",
      payload: { path: "other.ts" },
    }).sequence,
    store.appendEvent({
      runId: firstRun.id,
      actor: "candidate",
      type: "file.opened",
      payload: { path: "two.ts" },
    }).sequence,
  ];

  assert.deepEqual(sequences, [1, 1, 2]);
  assert.deepEqual(
    store.readEvents(firstRun.id, { afterSequence: 1 }).map(({ sequence }) => sequence),
    [2],
  );
  store.close();
});

test("CLI emits stable JSON and reopens the same database", () => {
  const databasePath = temporaryDatabase();
  const cliPath = join(process.cwd(), "bin", "waymark.mjs");
  const input = {
    id: "cli-run",
    targetRepositoryPath: "C:\\repos\\cli-target",
    repositoryIdentity: "cli-target",
    commitSha: "abc123",
    task: "Locate the change surface.",
    participants: [
      {
        id: "cli-candidate",
        role: "candidate",
        provider: "openai",
        model: "candidate",
      },
      {
        id: "cli-orchestrator",
        role: "orchestrator",
        provider: "openai",
        model: "orchestrator",
      },
    ],
    toolPolicy: { targetRepository: "read-only" },
    runConditions: {},
    protocolVersion: "1.0.0",
    rubricVersion: "1.0.0",
  };

  const created = spawnSync(
    process.execPath,
    [
      cliPath,
      "--db",
      databasePath,
      "run",
      "create",
      "--input-json",
      JSON.stringify(input),
    ],
    { encoding: "utf8" },
  );
  assert.equal(created.status, 0, created.stderr);
  const createdOutput = JSON.parse(created.stdout);
  assert.deepEqual(
    {
      ok: createdOutput.ok,
      command: createdOutput.command,
      runId: createdOutput.data.id,
    },
    { ok: true, command: "run create", runId: "cli-run" },
  );

  const read = spawnSync(
    process.execPath,
    [cliPath, "--db", databasePath, "report", "read", "--run", "cli-run"],
    { encoding: "utf8" },
  );
  assert.equal(read.status, 0, read.stderr);
  const readOutput = JSON.parse(read.stdout);
  assert.equal(readOutput.ok, true);
  assert.equal(readOutput.command, "report read");
  assert.equal(readOutput.data.run.task, input.task);
  assert.equal(readOutput.data.aggregates.eventCount, 0);
});
