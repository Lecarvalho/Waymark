import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWaymarkServer } from "../server/waymark-server.mjs";
import {
  resolveReplayJournal,
  runGeneralLiveReplay,
} from "../src/replay/general-live-replay.mjs";

test("zero-cost general replay streams observable fixture states and completes", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-live-replay-"));
  const databasePath = join(directory, "waymark.sqlite");
  const service = await startWaymarkServer({ databasePath, port: 0 });
  t.after(async () => {
    await service.close();
    rmSync(directory, { force: true, recursive: true });
  });

  const snapshots = new Map();
  const result = await runGeneralLiveReplay({
    serviceUrl: service.url,
    delayMs: 0,
    runId: "synthetic-live-replay-test",
    now: () => "2026-07-26T18:00:00.000Z",
    async onStep({ label, runId }) {
      const [reportResponse, summariesResponse] = await Promise.all([
        fetch(`${service.url}/api/runs/${encodeURIComponent(runId)}`),
        fetch(`${service.url}/api/runs/summaries`),
      ]);
      assert.equal(reportResponse.status, 200);
      assert.equal(summariesResponse.status, 200);
      const report = await reportResponse.json();
      const summary = (await summariesResponse.json()).find(
        ({ id }) => id === runId,
      );
      if (!snapshots.has(label)) snapshots.set(label, { report, summary });
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.databasePath, databasePath);

  const firstUsage = snapshots.get("Updated live token usage");
  assert.equal(firstUsage.report.run.status, "active");
  assert.deepEqual(firstUsage.report.tokens, []);
  assert.deepEqual(firstUsage.report.events.at(-1).payload.cumulative, {
    inputTokens: 8_000,
    cachedInputTokens: 6_000,
    outputTokens: 400,
    totalTokens: 8_400,
  });
  assert.deepEqual(firstUsage.summary.generalAudit.auditor.tokenUsage, {
    totalTokens: 8_400,
    inputTokens: 8_000,
    cachedInputTokens: 6_000,
    uncachedInputTokens: 2_000,
    outputTokens: 400,
    unclassifiedTokens: 0,
    cacheCreationTokens: null,
    source: "measured_live",
  });

  const revised = snapshots.get("Revised finding after later evidence");
  assert.equal(
    revised.report.generalAudit.findings["replay-owner-discovery"].revisions
      .length,
    2,
  );
  assert.equal(
    revised.report.generalAudit.findings["replay-owner-discovery"]
      .currentRevision.state,
    "located_late",
  );
  assert.equal(
    revised.summary.generalAudit.observationChannel
      .acceptedSemanticCheckpoints,
    4,
  );

  const completed = snapshots.get("Finalized synthetic run");
  assert.equal(completed.report.run.status, "completed");
  assert.deepEqual(
    { ...completed.report.tokens[0], measuredAt: "<timestamp>" },
    {
    id: "synthetic-live-replay-test-general-research-final",
    runId: "synthetic-live-replay-test",
    eventId: null,
    actor: "synthetic-live-replay-test-auditor",
    phase: "general_research",
    source: "estimated",
    provider: "synthetic_fixture",
    model: "zero-cost-live-replay",
    inputTokens: 64_000,
    outputTokens: 3_600,
    cachedInputTokens: 52_000,
    cacheCreationTokens: null,
    totalTokens: 67_600,
      measuredAt: "<timestamp>",
    },
  );
  assert.equal(completed.report.generalAudit.status, "completed");
  assert.equal(completed.report.generalAudit.findingOrder.length, 2);
  assert.equal(completed.report.generalAudit.recommendations.length, 1);
  assert.equal(completed.report.generalAudit.practices !== undefined, true);
  assert.equal(
    Object.values(completed.report.generalAudit.practices).filter(
      ({ dispositionRecorded }) => dispositionRecorded,
    ).length,
    7,
  );
  assert.equal(
    completed.summary.generalAudit.observationChannel.health,
    "recovered",
  );
  assert.equal(
    completed.summary.generalAudit.observationChannel.semanticDelivery.status,
    "recovered",
  );
  assert.equal(
    completed.summary.generalAudit.observationChannel.providerTools.completed,
    1,
  );
});

test("replay refuses an expected journal that differs from service health", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-live-replay-match-"));
  const databasePath = join(directory, "authoritative.sqlite");
  const service = await startWaymarkServer({ databasePath, port: 0 });
  t.after(async () => {
    await service.close();
    rmSync(directory, { force: true, recursive: true });
  });

  await assert.rejects(
    resolveReplayJournal({
      serviceUrl: service.url,
      databasePath: join(directory, "wrong.sqlite"),
    }),
    /Journal mismatch/,
  );
});

test("replay refuses a stale service before creating a synthetic run", async () => {
  await assert.rejects(
    resolveReplayJournal({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            service: "waymark",
            databasePath: "C:/tmp/stale-waymark.sqlite",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    }),
    /predates live token breakdown support/,
  );
});
