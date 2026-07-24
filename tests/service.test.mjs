import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWaymarkServer } from "../server/waymark-server.mjs";
import { AuditStore } from "../src/persistence/index.mjs";

test("local service exposes a normalized latest-run snapshot", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-service-"));
  const databasePath = join(directory, "waymark.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun({
    targetRepositoryPath: "C:/repos/example",
    repositoryIdentity: "example",
    commitSha: "1234567890abcdef",
    task: "Add partial refunds",
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
    runConditions: {
      agentHost: "Codex",
      tokenBudgets: {
        candidate_navigation: {
          targetTokens: 12000,
          hardLimitTokens: 24000,
        },
      },
    },
    protocolVersion: "1.0.0",
    rubricVersion: "1.0.0",
  });
  store.appendEvent({
    runId: run.id,
    actor: "orchestrator",
    type: "phase.changed",
    payload: { phase: "Cross-examination", progress: 68 },
  });
  store.recordTokenMeasurement({
    runId: run.id,
    actor: "candidate",
    phase: "candidate_navigation",
    source: "provider_reported",
    provider: "openai",
    model: "candidate-model",
    inputTokens: 47000,
    cachedInputTokens: 40000,
    cacheCreationTokens: 500,
    outputTokens: 1200,
    totalTokens: 48200,
  });
  store.close();

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
  assert.equal(snapshot.repository.name, "example");
  assert.equal(snapshot.repository.commit, "1234567890ab");
  assert.equal(snapshot.phase, "Cross-examination");
  assert.equal(snapshot.progress, 68);
  assert.equal(snapshot.latestEvent, "phase.changed");
  assert.equal(snapshot.metrics.candidateTokens, 48200);
  assert.equal(snapshot.metrics.candidateTokenSource, "provider_reported");
  assert.deepEqual(snapshot.tokenUsage.overall, {
    totalTokens: 48200,
    inputTokens: 47000,
    cachedInputTokens: 40000,
    uncachedInputTokens: 7000,
    outputTokens: 1200,
    unclassifiedTokens: 0,
    cacheCreationTokens: 500,
    source: "provider_reported",
  });
  assert.deepEqual(snapshot.tokenUsage.candidateBudget, {
    usedTokens: 48200,
    targetTokens: 12000,
    hardLimitTokens: 24000,
    targetMultiple: 4.02,
    hardLimitExceeded: true,
    efficiencyScore: null,
    eligible: null,
  });
  assert.equal(
    snapshot.tokenUsage.byPhase.find(
      ({ phase }) => phase === "candidate_navigation",
    ).totalTokens,
    48200,
  );
  assert.equal(snapshot.tokenUsage.monetaryCost.status, "unavailable");
  assert.equal(snapshot.models.candidate, "candidate-model");
  assert.equal(
    snapshot.participants.find(({ role }) => role === "candidate").tokens,
    48200,
  );
  assert.equal(
    snapshot.participants.find(({ role }) => role === "independent").tokens,
    null,
  );
  assert.equal(
    snapshot.participants.find(({ role }) => role === "independent")
      .tokenSource,
    null,
  );

  const summariesResponse = await fetch(`${service.url}/api/runs/summaries`);
  assert.equal(summariesResponse.status, 200);
  const summaries = await summariesResponse.json();
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, run.id);
  assert.equal(summaries[0].repository.name, "example");
});

test("local service remains read-only", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-readonly-"));
  const service = await startWaymarkServer({
    databasePath: join(directory, "waymark.sqlite"),
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => service.close());

  const response = await fetch(`${service.url}/api/runs`, {
    method: "POST",
  });
  assert.equal(response.status, 405);
  assert.deepEqual(await response.json(), { error: "read_only_service" });

  const missing = await fetch(`${service.url}/api/runs/does-not-exist`);
  assert.equal(missing.status, 404);
});
