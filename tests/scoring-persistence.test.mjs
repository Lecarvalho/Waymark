import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AuditStore } from "../src/persistence/index.mjs";
import { hashScoreInput, scoreAudit } from "../src/scoring/index.mjs";

test("CLI persists deterministic scoring with reserved authority", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-score-run-"));
  const databasePath = join(directory, "waymark.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun({
    targetRepositoryPath: "C:/repos/example",
    repositoryIdentity: "example",
    commitSha: "abc123",
    task: "Trace a refund change",
    participants: [
      { role: "candidate", provider: "openai", model: "candidate" },
      { role: "orchestrator", provider: "openai", model: "orchestrator" },
    ],
    toolPolicy: { target: "read-only" },
    runConditions: {},
    protocolVersion: "1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  });
  const claim = store.submitClaim({
    runId: run.id,
    subject: "refund owner",
    assertion: "RefundService owns the write path",
    claimant: "candidate",
    citations: [{ path: "src/refunds/RefundService.ts", startLine: 40 }],
    confidence: 0.91,
    criticality: "critical",
  });
  store.recordVerification({
    runId: run.id,
    claimId: claim.id,
    verifier: "orchestrator",
    method: "static_inspection",
    verdict: "verified",
    evidence: { command: "rg RefundService src" },
  });
  store.recordTokenMeasurement({
    runId: run.id,
    actor: "candidate",
    phase: "candidate_navigation",
    source: "provider_reported",
    provider: "openai",
    model: "candidate",
    totalTokens: 6800,
  });
  store.close();

  const fixture = new URL(
    "../fixtures/benchmarks/navigable.json",
    import.meta.url,
  );
  const scoreInputPath = join(directory, "score-input.json");
  const fixtureData = JSON.parse(readFileSync(fixture, "utf8"));
  writeFileSync(
    scoreInputPath,
    JSON.stringify(fixtureData.input.observations),
  );
  const result = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      databasePath,
      "score",
      "calculate",
      "--run",
      run.id,
      "--input-file",
      scoreInputPath,
      "--finish",
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.data.result.overall.score, 98.69);

  const reopened = new AuditStore({ databasePath });
  const report = reopened.readReport(run.id);
  assert.equal(report.tokens[0].inputTokens, null);
  assert.equal(report.tokens[0].outputTokens, null);
  assert.equal(report.tokens[0].cachedInputTokens, null);
  assert.equal(report.tokens[0].cacheCreationTokens, null);
  const scoreEvent = report.events.find(
    (event) => event.type === "score.completed",
  );
  assert.equal(scoreEvent.actor, "waymark:scorer");
  assert.equal(scoreEvent.payload.result.overall.score, 98.69);
  assert.equal(
    hashScoreInput(scoreEvent.payload.input),
    scoreEvent.payload.inputHash,
  );
  assert.deepEqual(
    scoreAudit(scoreEvent.payload.input),
    scoreEvent.payload.result,
  );
  assert.equal(report.run.status, "completed");
  reopened.close();
});

test("generic event command cannot impersonate the scorer", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-forge-"));
  const result = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      join(directory, "waymark.sqlite"),
      "event",
      "append",
      "--run",
      "fake",
      "--actor",
      "waymark:scorer",
      "--type",
      "score.completed",
    ],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 2);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.match(output.error.message, /reserved/);
});
