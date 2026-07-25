import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  AuditStore,
  AuditStoreError,
} from "../src/persistence/index.mjs";

const temporaryDirectories = [];

after(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function temporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-ledger-"));
  temporaryDirectories.push(directory);
  return join(directory, "waymark.sqlite");
}

function generalRunInput(id = "general-run") {
  return {
    id,
    targetRepositoryPath: "C:\\repos\\payments",
    repositoryIdentity: "team/payments",
    commitSha: "0123456789abcdef",
    task: "Assess repository navigability.",
    participants: [
      {
        id: `${id}-auditor`,
        role: "auditor",
        provider: "openai",
        model: "auditor-model",
      },
    ],
    toolPolicy: { targetRepository: "read-only" },
    runConditions: { auditMode: "general" },
    protocolVersion: "2.0.0",
    rubricVersion: "general-audit/1.0.0",
    createdAt: "2026-07-25T12:00:00.000Z",
  };
}

function citation(path = "src/refunds/refund-service.ts", source = "production_code") {
  return {
    path,
    startLine: 10,
    endLine: 30,
    symbol: "RefundService",
    source,
  };
}

function initialRevision(actor, occurredAt) {
  return {
    revisionId: "revision-1",
    findingId: "finding-refund-owner",
    revisionNumber: 1,
    state: "provisional",
    signal: "friction",
    title: "Refund owner was not initially discoverable",
    conclusion: "The first ownership searches did not locate the refund owner.",
    dimensionIds: ["discoveryEfficiency", "ownershipClarity"],
    practiceGuideIds: ["conceptOwningNames"],
    citations: [citation()],
    navigationCost: {
      searches: 4,
      filesOpened: 7,
      fileHops: 3,
      deadEnds: 2,
      commands: 5,
      processedTokens: 1800,
      elapsedMs: 92000,
    },
    provenance: {
      previousRevisionId: null,
      amendmentReason: null,
      actor,
      occurredAt,
      causedByCitations: [citation()],
    },
  };
}

function locatedLateRevision(actor, occurredAt, previousRevisionId = "revision-1") {
  return {
    revisionId: "revision-2",
    findingId: "finding-refund-owner",
    revisionNumber: 2,
    state: "located_late",
    signal: "friction",
    title: "Refund owner exists but was located late",
    conclusion:
      "The refund owner exists, but required four searches and three file hops.",
    dimensionIds: ["discoveryEfficiency", "ownershipClarity"],
    practiceGuideIds: ["conceptOwningNames"],
    citations: [citation()],
    navigationCost: null,
    provenance: {
      previousRevisionId,
      amendmentReason: "A later consumer trace exposed the owning service.",
      actor,
      occurredAt,
      causedByCitations: [citation("src/refunds/refund-router.ts")],
    },
  };
}

function checkpoint({
  runId = "general-run",
  actor = "general-run-auditor",
  key,
  payload,
  occurredAt,
  id,
}) {
  return {
    ...(id ? { id } : {}),
    runId,
    actor,
    idempotencyKey: key,
    payload,
    occurredAt,
  };
}

test("general checkpoints persist revisions idempotently and survive partial completion", () => {
  const databasePath = temporaryDatabase();
  let store = new AuditStore({ databasePath });
  const run = store.createRun(generalRunInput());

  store.startGeneralAudit(
    checkpoint({
      id: "event-start",
      key: "start",
      occurredAt: "2026-07-25T12:01:00.000Z",
      payload: {
        repositoryIdentity: run.repositoryIdentity,
        commitSha: run.commitSha,
        protocolVersion: run.protocolVersion,
      },
    }),
  );
  const recordedAt = "2026-07-25T12:02:00.000Z";
  const findingInput = checkpoint({
    id: "event-finding",
    key: "finding-1",
    occurredAt: recordedAt,
    payload: {
      revision: initialRevision("general-run-auditor", recordedAt),
    },
  });
  const first = store.recordGeneralFinding(findingInput);
  const retried = store.recordGeneralFinding({
    ...findingInput,
    id: "ignored-on-retry",
  });
  assert.equal(retried.id, first.id);
  assert.equal(retried.sequence, first.sequence);

  assert.throws(
    () =>
      store.recordGeneralSurface(
        checkpoint({
          key: "finding-1",
          payload: {
            surface: "production_code",
            summary: "Different payload for the same key.",
            citations: [],
          },
        }),
      ),
    (error) =>
      error instanceof AuditStoreError &&
      error.code === "IDEMPOTENCY_CONFLICT",
  );
  store.close();

  store = new AuditStore({ databasePath });
  const revisedAt = "2026-07-25T12:03:00.000Z";
  store.reviseGeneralFinding(
    checkpoint({
      id: "event-revision",
      key: "finding-2",
      occurredAt: revisedAt,
      payload: {
        revision: locatedLateRevision("general-run-auditor", revisedAt),
      },
    }),
  );
  store.recordTokenMeasurement({
    id: "general-token",
    runId: run.id,
    actor: "general-run-auditor",
    phase: "general_research",
    source: "provider_reported",
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
  });

  const projected = store.readReport(run.id).generalAudit;
  assert.equal(projected.findings["finding-refund-owner"].revisions.length, 2);
  assert.equal(
    projected.findings["finding-refund-owner"].currentRevision.state,
    "located_late",
  );
  assert.equal(
    projected.findings["finding-refund-owner"].navigationCostHistory[0]
      .observation.searches,
    4,
  );

  assert.throws(
    () =>
      store.reviseGeneralFinding(
        checkpoint({
          key: "bad-prior",
          occurredAt: "2026-07-25T12:04:00.000Z",
          payload: {
            revision: {
              ...locatedLateRevision(
                "general-run-auditor",
                "2026-07-25T12:04:00.000Z",
                "not-the-current-revision",
              ),
              revisionId: "revision-3",
              revisionNumber: 3,
            },
          },
        }),
      ),
    (error) =>
      error instanceof AuditStoreError && error.code === "WRONG_PRIOR_REVISION",
  );

  store.interruptGeneralAudit(
    checkpoint({
      id: "event-interrupted",
      key: "interrupted",
      occurredAt: "2026-07-25T12:05:00.000Z",
      payload: {
        outcome: "partial",
        reason: "Provider process ended before final synthesis.",
      },
    }),
  );
  store.finishRun(run.id, {
    status: "partial",
    summary: { reason: "Recovered cited findings." },
    finishedAt: "2026-07-25T12:05:01.000Z",
  });
  store.close();

  store = new AuditStore({ databasePath });
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "partial");
  assert.equal(report.generalAudit.status, "partial");
  assert.equal(report.generalAudit.partialReport.available, true);
  assert.equal(report.aggregates.tokensByPhase.general_research, 1200);
  assert.equal(report.events.filter((event) => event.type.startsWith("general.")).length, 4);
  store.close();
});

test("general checkpoint authority, mode, strict fields, and cross-run support are enforced", () => {
  const store = new AuditStore({ databasePath: temporaryDatabase() });
  const general = store.createRun(generalRunInput());
  const benchmark = store.createRun({
    ...generalRunInput("benchmark-run"),
    participants: [
      {
        id: "benchmark-candidate",
        role: "candidate",
        provider: "openai",
        model: "candidate",
      },
      {
        id: "benchmark-orchestrator",
        role: "orchestrator",
        provider: "openai",
        model: "orchestrator",
      },
    ],
    runConditions: { auditMode: "task_specific" },
  });

  assert.throws(
    () =>
      store.startGeneralAudit(
        checkpoint({
          runId: benchmark.id,
          actor: "benchmark-candidate",
          key: "wrong-mode",
          payload: {
            repositoryIdentity: benchmark.repositoryIdentity,
            commitSha: benchmark.commitSha,
            protocolVersion: benchmark.protocolVersion,
          },
        }),
      ),
    (error) =>
      error instanceof AuditStoreError &&
      error.code === "GENERAL_CHECKPOINT_MODE_MISMATCH",
  );

  assert.throws(
    () =>
      store.startGeneralAudit({
        ...checkpoint({
          key: "unknown-field",
          payload: {
            repositoryIdentity: general.repositoryIdentity,
            commitSha: general.commitSha,
            protocolVersion: general.protocolVersion,
          },
        }),
        unexpected: true,
      }),
    (error) => error?.code === "INVALID_INPUT",
  );

  assert.throws(
    () =>
      store.startGeneralAudit(
        checkpoint({
          actor: "someone-else",
          key: "wrong-actor",
          payload: {
            repositoryIdentity: general.repositoryIdentity,
            commitSha: general.commitSha,
            protocolVersion: general.protocolVersion,
          },
        }),
      ),
    (error) =>
      error instanceof AuditStoreError &&
      error.code === "GENERAL_AUDITOR_NOT_AUTHORIZED",
  );
  store.close();
});

test("CLI records and reconstructs general finding revisions", () => {
  const databasePath = temporaryDatabase();
  const cliPath = join(process.cwd(), "bin", "waymark.mjs");
  const runInput = generalRunInput("cli-general");
  const invoke = (...arguments_) =>
    spawnSync(
      process.execPath,
      [cliPath, "--db", databasePath, ...arguments_],
      { encoding: "utf8" },
    );

  let result = invoke(
    "run",
    "create",
    "--input-json",
    JSON.stringify(runInput),
  );
  assert.equal(result.status, 0, result.stdout);

  result = invoke(
    "general",
    "start",
    "--input-json",
    JSON.stringify({
      runId: runInput.id,
      actor: "cli-general-auditor",
      idempotencyKey: "cli-start",
      occurredAt: "2026-07-25T12:01:00.000Z",
      payload: {
        repositoryIdentity: runInput.repositoryIdentity,
        commitSha: runInput.commitSha,
        protocolVersion: runInput.protocolVersion,
      },
    }),
  );
  assert.equal(result.status, 0, result.stdout);

  const findingAt = "2026-07-25T12:02:00.000Z";
  result = invoke(
    "general",
    "finding",
    "--input-json",
    JSON.stringify({
      runId: runInput.id,
      actor: "cli-general-auditor",
      idempotencyKey: "cli-finding",
      occurredAt: findingAt,
      payload: {
        revision: initialRevision("cli-general-auditor", findingAt),
      },
    }),
  );
  assert.equal(result.status, 0, result.stdout);

  const revisionAt = "2026-07-25T12:03:00.000Z";
  const revisionInput = {
    runId: runInput.id,
    actor: "cli-general-auditor",
    idempotencyKey: "cli-revision",
    occurredAt: revisionAt,
    payload: {
      revision: locatedLateRevision("cli-general-auditor", revisionAt),
    },
  };
  result = invoke(
    "general",
    "revise",
    "--input-json",
    JSON.stringify(revisionInput),
  );
  assert.equal(result.status, 0, result.stdout);
  const firstRevisionOutput = JSON.parse(result.stdout);

  result = invoke(
    "general",
    "revise",
    "--input-json",
    JSON.stringify(revisionInput),
  );
  assert.equal(result.status, 0, result.stdout);
  assert.equal(
    JSON.parse(result.stdout).data.sequence,
    firstRevisionOutput.data.sequence,
  );

  result = invoke("report", "read", "--run", runInput.id);
  assert.equal(result.status, 0, result.stdout);
  const report = JSON.parse(result.stdout).data;
  assert.equal(
    report.generalAudit.findings["finding-refund-owner"].revisions.length,
    2,
  );
});
