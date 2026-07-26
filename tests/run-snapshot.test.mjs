import assert from "node:assert/strict";
import test from "node:test";

import { toRunSnapshot as compatibilitySnapshot } from "../server/waymark-server.mjs";
import { toRunSnapshot } from "../server/run-snapshot.mjs";
import { emptyBenchmarkReport } from "./fixtures/service-report-fixtures.mjs";

test("empty benchmark snapshot keeps stable normalized sections", () => {
  const snapshot = toRunSnapshot(emptyBenchmarkReport(), 3);

  assert.deepEqual(
    {
      id: snapshot.id,
      status: snapshot.status,
      repository: snapshot.repository,
      name: snapshot.name,
      task: snapshot.task,
      auditMode: snapshot.auditMode,
      phase: snapshot.phase,
      progress: snapshot.progress,
      startedAt: snapshot.startedAt,
      agentHost: snapshot.agentHost,
      latestEvent: snapshot.latestEvent,
      runCount: snapshot.runCount,
    },
    {
      id: "fixture-task_specific-active",
      status: "running",
      repository: {
        name: "team/payments",
        path: "C:/repos/payments",
        commit: "0123456789ab",
      },
      name: "Trace the refund workflow",
      task: "Trace the refund workflow.",
      auditMode: "task_specific",
      phase: "Discovery",
      progress: 5,
      startedAt: "2026-01-02T03:04:05.000Z",
      agentHost: "Codex",
      latestEvent: "Run created",
      runCount: 3,
    },
  );
  assert.deepEqual(snapshot.calibration, {
    eligible: true,
    status: "eligible",
    issues: [],
    resourceSignals: [],
  });
  assert.deepEqual(snapshot.scoreBreakdown, {
    dimensions: [],
    adequacyPassed: null,
  });
  assert.deepEqual(snapshot.metrics, {
    navigability: null,
    reliability: null,
    candidateTokens: null,
    candidateTokenSource: null,
    claimsChallenged: 0,
    totalClaims: 0,
    verifiedClaims: 0,
    contradictedClaims: 0,
    unverifiedClaims: 0,
    adjudicatedClaims: 0,
    openChallenges: 0,
    candidateConfidence: 0,
    verifiedAccuracy: 0,
  });
  assert.deepEqual(snapshot.tokenUsage.overall, {
    totalTokens: null,
    inputTokens: null,
    cachedInputTokens: null,
    uncachedInputTokens: null,
    outputTokens: null,
    unclassifiedTokens: null,
    cacheCreationTokens: null,
    source: null,
  });
  assert.deepEqual(snapshot.evidence, []);
  assert.deepEqual(snapshot.recommendations, []);
  assert.equal(snapshot.generalAudit, null);
});

test("executable entry preserves the snapshot compatibility export", () => {
  const report = emptyBenchmarkReport({ auditMode: "system_explanation" });
  assert.deepEqual(
    compatibilitySnapshot(report, 1),
    toRunSnapshot(report, 1),
  );
});
