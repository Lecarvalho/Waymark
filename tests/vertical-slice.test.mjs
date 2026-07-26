import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWaymarkServer } from "../server/waymark-server.mjs";

function runCli(databasePath, ...arguments_) {
  const result = spawnSync(
    process.execPath,
    ["bin/waymark.mjs", "--db", databasePath, ...arguments_],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  return output.data;
}

function runCliWithEnvironment(databasePath, environment, ...arguments_) {
  const result = spawnSync(
    process.execPath,
    ["bin/waymark.mjs", "--db", databasePath, ...arguments_],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
      env: { ...process.env, ...environment },
    },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  return output.data;
}

test("one audit crosses CLI, SQLite, scoring, service, and report read model", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-vertical-"));
  const databasePath = join(directory, "waymark.sqlite");
  const runInput = {
    targetRepositoryPath: "C:/repos/checkout",
    repositoryIdentity: "checkout",
    commitSha: "fedcba9876543210",
    task: "Add an idempotent partial refund flow",
    participants: [
      { role: "candidate", provider: "openai", model: "candidate-model" },
      {
        role: "orchestrator",
        provider: "openai",
        model: "orchestrator-model",
      },
      { role: "independent", provider: "openai", model: "research-model" },
    ],
    toolPolicy: { target: "read-only" },
    runConditions: { agentHost: "Codex" },
    protocolVersion: "1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  };
  const run = runCli(
    databasePath,
    "run",
    "create",
    "--input-json",
    JSON.stringify(runInput),
  );

  runCli(
    databasePath,
    "event",
    "append",
    "--input-json",
    JSON.stringify({
      runId: run.id,
      actor: "orchestrator",
      type: "phase.changed",
      payload: {
        phase: "Cross-examination",
        progress: 68,
        message: "Challenging the candidate consumer map",
      },
    }),
  );

  const claim = runCli(
    databasePath,
    "claim",
    "submit",
    "--input-json",
    JSON.stringify({
      runId: run.id,
      subject: "refund write path",
      assertion: "RefundService owns the write path",
      claimant: "candidate",
      citations: [{ path: "src/refunds/RefundService.ts", startLine: 40 }],
      confidence: 0.92,
      criticality: "critical",
    }),
  );

  runCli(
    databasePath,
    "verification",
    "record",
    "--input-json",
    JSON.stringify({
      runId: run.id,
      claimId: claim.id,
      verifier: "orchestrator",
      method: "static_inspection",
      verdict: "verified",
      evidence: { command: "rg RefundService src" },
    }),
  );

  runCli(
    databasePath,
    "token",
    "record",
    "--input-json",
    JSON.stringify({
      runId: run.id,
      actor: "candidate",
      phase: "candidate_navigation",
      source: "provider_reported",
      provider: "openai",
      model: "candidate-model",
      totalTokens: 6800,
    }),
  );

  const observations = {
    discovery: {
      relevantLocationsFound: 1,
      relevantLocationsExpected: 1,
      filesOpened: 2,
      deadEnds: 0,
    },
    ownership: {
      correctAnswers: 1,
      totalAnswers: 1,
      ambiguousBoundaries: 0,
    },
    dependencies: {
      requiredEdgesFound: 1,
      requiredEdgesExpected: 1,
      hiddenEdgesEncountered: 0,
    },
    changeSurface: {
      requiredConsumersFound: 1,
      requiredConsumersExpected: 1,
      falsePositiveConsumers: 0,
    },
    verification: {
      workflowsFound: 1,
      workflowsExpected: 1,
      successfulProbes: 1,
      attemptedProbes: 1,
    },
    instructions: {
      applicableRulesFound: 1,
      applicableRulesExpected: 1,
      conflictsEncountered: 0,
    },
  };
  const scoreInputPath = join(directory, "score-input.json");
  writeFileSync(scoreInputPath, JSON.stringify(observations));
  runCli(
    databasePath,
    "score",
    "calculate",
    "--run",
    run.id,
    "--input-file",
    scoreInputPath,
    "--finish",
  );

  const service = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => service.close());

  const response = await fetch(`${service.url}/api/runs/latest`);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.id, run.id);
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.progress, 100);
  assert.equal(snapshot.phase, "Complete");
  assert.ok(snapshot.metrics.navigability > 80);
  assert.equal(snapshot.metrics.reliability, 95);
  assert.equal(snapshot.metrics.candidateTokens, 6800);
  assert.equal(snapshot.metrics.totalClaims, 1);
  assert.equal(snapshot.latestEvent, "Audit completed and saved.");
});

test("a general audit crosses CLI, checkpoints, restart, and the UI read model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-vertical-"));
  const databasePath = join(directory, "waymark.sqlite");
  const run = runCli(
    databasePath,
    "run",
    "create",
    "--input-json",
    JSON.stringify({
      targetRepositoryPath: process.cwd(),
      repositoryIdentity: "waymark-general-fixture",
      commitSha: "0123456789abcdef",
      name: "General repository navigation",
      task: "Broad evidence-led repository navigability assessment",
      participants: [
        { role: "auditor", provider: "codex", model: "fake-general-auditor" },
      ],
      toolPolicy: { target: "read-only" },
      runConditions: {
        auditMode: "general",
        auditorReasoningEffort: "high",
        tokenPolicy: "unbounded_by_waymark",
        softUsageNoticeTokens: 100000,
      },
      protocolVersion: "general-audit-contract/1.0.0",
      rubricVersion: "waymark-navigability/1.0.0",
    }),
  );

  const result = runCliWithEnvironment(
    databasePath,
    {
      WAYMARK_FAKE_MODE: "general-completed",
      WAYMARK_FAKE_ROLE: "auditor",
    },
    "general",
    "audit",
    "--run",
    run.id,
    "--codex-entry",
    join(process.cwd(), "fixtures", "providers", "fake-jsonl-provider.mjs"),
  );
  assert.equal(result.status, "completed");

  const firstService = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  const firstResponse = await fetch(`${firstService.url}/api/runs/latest`);
  assert.equal(firstResponse.status, 200);
  const firstSnapshot = await firstResponse.json();
  await firstService.close();

  assert.equal(firstSnapshot.auditMode, "general");
  assert.equal(firstSnapshot.status, "completed");
  assert.equal(firstSnapshot.generalAudit.status, "completed");
  assert.equal(firstSnapshot.generalAudit.reportComplete, true);
  assert.equal(firstSnapshot.generalAudit.result.label, "Auditor-assessed");
  assert.equal(firstSnapshot.generalAudit.dimensions.length, 6);
  assert.equal(firstSnapshot.generalAudit.findings.length, 2);
  assert.equal(firstSnapshot.generalAudit.behaviorPathViews.length, 2);
  assert.equal(firstSnapshot.generalAudit.tokens.hardLimitTokens, null);
  assert.equal(firstSnapshot.generalAudit.tokens.tokenEfficiencyScore, null);
  assert.deepEqual(
    firstSnapshot.participants.map(({ role }) => role),
    ["auditor"],
  );
  assert.equal(
    firstSnapshot.generalAudit.findings.some(
      ({ currentRevision }) => currentRevision.signal === "friction",
    ),
    true,
  );

  const restartedService = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const reconnectedResponse = await fetch(
      `${restartedService.url}/api/runs/latest`,
    );
    assert.equal(reconnectedResponse.status, 200);
    const reconnectedSnapshot = await reconnectedResponse.json();
    assert.deepEqual(reconnectedSnapshot, firstSnapshot);
  } finally {
    await restartedService.close();
  }
});
