import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { createInterface } from "node:readline";
import test from "node:test";

import {
  createCodexRolloutUsageMonitor,
  createCodexProcessAdapter,
  extractCodexFinalOutput,
  extractCodexRolloutUsage,
  extractCodexUsage,
  normalizeCodexEvent,
} from "../src/orchestration/codex-adapter.mjs";
import { startGeneralCheckpointTransport } from "../src/orchestration/checkpoint-transport.mjs";
import { runGeneralAudit } from "../src/orchestration/general-audit-runner.mjs";
import {
  finalizeDraftRecommendations,
  runInvestigationPhase,
} from "../src/orchestration/process-runner.mjs";
import { AuditStore } from "../src/persistence/index.mjs";
import { toRunSnapshot } from "../server/waymark-server.mjs";

const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fakeProviderPath = fileURLToPath(
  new URL("../fixtures/providers/fake-jsonl-provider.mjs", import.meta.url),
);
const checkpointMcpPath = fileURLToPath(
  new URL("../src/orchestration/waymark-checkpoint-mcp.mjs", import.meta.url),
);

function createGeneralTransportRun(store, id = "checkpoint-general") {
  return store.createRun({
    id,
    targetRepositoryPath: repositoryRoot,
    repositoryIdentity: "waymark-checkpoint-fixture",
    commitSha: "0123456789abcdef",
    task: "Assess repository navigability.",
    participants: [
      {
        id: `${id}-auditor`,
        role: "auditor",
        provider: "codex",
        model: "fake-auditor",
      },
    ],
    toolPolicy: {
      target: "read-only",
      allowed: ["read files"],
      forbidden: ["editing target files"],
    },
    runConditions: { auditMode: "general" },
    protocolVersion: "2.0.0",
    rubricVersion: "general-audit/1.0.0",
  });
}

function createGeneralRunnerRun(store, id = "runner-general") {
  return store.createRun({
    id,
    targetRepositoryPath: repositoryRoot,
    repositoryIdentity: "waymark-general-runner-fixture",
    commitSha: "fedcba9876543210",
    task: "Assess broad repository navigability.",
    participants: [
      {
        id: `${id}-auditor`,
        role: "auditor",
        provider: "codex",
        model: "fake-general-auditor",
      },
    ],
    toolPolicy: {
      target: "read-only",
      allowed: ["read files"],
      forbidden: ["editing target files"],
    },
    runConditions: {
      auditMode: "general",
      auditorReasoningEffort: "high",
      tokenPolicy: "unbounded_by_waymark",
      softUsageNoticeTokens: 100_000,
    },
    protocolVersion: "general-audit-contract/1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  });
}

function generalFakeAdapter(mode) {
  return createCodexProcessAdapter({
    entryPath: fakeProviderPath,
    environment: {
      WAYMARK_FAKE_MODE: mode,
      WAYMARK_FAKE_ROLE: "auditor",
    },
  });
}

async function runCheckpointFakeProvider({
  store,
  run,
  transport,
  mode,
}) {
  const adapter = createCodexProcessAdapter({
    entryPath: fakeProviderPath,
    environment: {
      WAYMARK_FAKE_MODE: mode,
      WAYMARK_FAKE_ROLE: "auditor",
      WAYMARK_FAKE_REPOSITORY_IDENTITY: run.repositoryIdentity,
      WAYMARK_FAKE_COMMIT_SHA: run.commitSha,
      WAYMARK_FAKE_PROTOCOL_VERSION: run.protocolVersion,
    },
  });
  const launch = adapter.attachCheckpointTransport(
    adapter.createLaunchSpec(
      {
        runId: run.id,
        role: "auditor",
        participant: run.participants[0],
        target: {
          path: run.targetRepositoryPath,
          identity: run.repositoryIdentity,
          commitSha: run.commitSha,
          readOnly: true,
        },
      },
      "Structured checkpoint transport integration fixture.",
    ),
    transport,
  );
  const child = spawn(launch.command, launch.arguments, {
    cwd: launch.cwd,
    env: { ...process.env, ...launch.environment },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const event = JSON.parse(line);
    const normalized = adapter.normalizeEvent(event);
    if (normalized === null || normalized === undefined) return;
    store.appendEvent({
      runId: run.id,
      actor: run.participants[0].id,
      type: normalized.type,
      payload: normalized.payload,
    });
    if (
      normalized.type === "provider.session.started" &&
      typeof normalized.payload.providerSessionId === "string"
    ) {
      transport.bindProviderSession(normalized.payload.providerSessionId);
    }
  });
  child.stdin.end(launch.stdin ?? "");
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, exitSignal) => {
      resolve({ exitCode, exitSignal, stderr });
    });
  });
  return result;
}

test("general checkpoint transport preserves acknowledged findings across a provider crash", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-checkpoint-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralTransportRun(store);
  const transport = await startGeneralCheckpointTransport({
    store,
    runId: run.id,
    auditorId: run.participants[0].id,
    provider: run.participants[0].provider,
  });
  t.after(() => transport.close());

  const result = await runCheckpointFakeProvider({
    store,
    run,
    transport,
    mode: "checkpoint-crash-duplicate",
  });

  assert.notEqual(
    result.exitCode,
    0,
    "the fake provider must fail before returning final synthesis",
  );
  assert.match(result.stderr, /simulated provider crash/);
  const activeReport = store.readReport(run.id);
  assert.equal(activeReport.generalAudit.partialReport.available, true);
  assert.equal(
    activeReport.generalAudit.findings["fake-refund-owner"].revisions.length,
    2,
  );
  assert.equal(
    activeReport.generalAudit.findings["fake-refund-owner"].currentRevision
      .state,
    "located_late",
  );
  assert.equal(
    activeReport.events.filter(
      ({ type }) => type === "general.finding.recorded",
    ).length,
    1,
    "duplicate delivery must not append duplicate semantic evidence",
  );
  assert.equal(
    activeReport.events.filter(
      ({ type }) => type === "provider.checkpoint.acknowledged",
    ).length,
    4,
  );
  assert.equal(
    activeReport.events.filter(
      ({ type }) => type === "provider.session.started",
    ).length,
    1,
    "raw provider telemetry remains separate from semantic checkpoints",
  );

  transport.persist({
    runId: run.id,
    actor: run.participants[0].id,
    providerSessionId: "fresh-auditor",
    idempotencyKey: "provider-crash",
    type: "general.audit.interrupted",
    occurredAt: "2026-07-25T14:03:00.000Z",
    payload: {
      outcome: "partial",
      reason: "Provider exited after acknowledged semantic checkpoints.",
    },
  });
  store.finishRun(run.id, {
    status: "partial",
    summary: { reason: "Recovered acknowledged semantic checkpoints." },
  });
  const partialReport = store.readReport(run.id);
  assert.equal(partialReport.run.status, "partial");
  assert.equal(partialReport.generalAudit.status, "partial");
  assert.equal(partialReport.generalAudit.partialReport.available, true);
});

test("general checkpoint transport rejects unauthorized and malformed callbacks diagnostically", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-checkpoint-reject-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralTransportRun(store, "checkpoint-rejections");
  const transport = await startGeneralCheckpointTransport({
    store,
    runId: run.id,
    auditorId: run.participants[0].id,
    provider: run.participants[0].provider,
  });
  t.after(() => transport.close());
  transport.bindProviderSession("session-authorized");

  let response = await fetch(transport.endpoint, {
    method: "POST",
    headers: {
      authorization: "Bearer wrong-capability",
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, "CHECKPOINT_UNAUTHORIZED");

  response = await fetch(transport.endpoint, {
    method: "POST",
    headers: {
      authorization: transport.authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      runId: run.id,
      actor: "not-the-auditor",
      providerSessionId: "session-authorized",
      idempotencyKey: "wrong-actor",
      type: "general.audit.started",
      payload: {},
    }),
  });
  assert.equal(response.status, 403);
  assert.equal(
    (await response.json()).error.code,
    "CHECKPOINT_AUDITOR_MISMATCH",
  );

  const report = store.readReport(run.id);
  const rejections = report.events.filter(
    ({ type }) => type === "provider.checkpoint.rejected",
  );
  assert.equal(rejections.length, 2);
  assert.deepEqual(
    rejections.map(({ payload }) => payload.error.code),
    ["CHECKPOINT_UNAUTHORIZED", "CHECKPOINT_AUDITOR_MISMATCH"],
  );
  assert.equal(
    report.events.some(({ type }) => type.startsWith("general.")),
    false,
  );
  assert.throws(
    () =>
      store.appendEvent({
        runId: run.id,
        actor: run.participants[0].id,
        type: "provider.checkpoint.acknowledged",
        payload: {},
      }),
    (error) => error?.code === "RESERVED_EVENT_TYPE",
  );
});

test("the runner-provisioned MCP tool persists a live semantic checkpoint", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-checkpoint-mcp-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralTransportRun(store, "checkpoint-mcp");
  store.startGeneralAudit({
    runId: run.id,
    actor: run.participants[0].id,
    idempotencyKey: "mcp-general-start",
    payload: {
      repositoryIdentity: run.repositoryIdentity,
      commitSha: run.commitSha,
      protocolVersion: run.protocolVersion,
    },
  });
  const transport = await startGeneralCheckpointTransport({
    store,
    runId: run.id,
    auditorId: run.participants[0].id,
    provider: run.participants[0].provider,
  });
  t.after(() => transport.close());
  transport.bindProviderSession("mcp-session");

  const child = spawn(process.execPath, [checkpointMcpPath], {
    env: {
      ...process.env,
      WAYMARK_CHECKPOINT_RUN_ID: transport.runId,
      WAYMARK_CHECKPOINT_ACTOR: transport.auditorId,
      WAYMARK_CHECKPOINT_ENDPOINT: transport.endpoint,
      WAYMARK_CHECKPOINT_AUTHORIZATION: transport.authorization,
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });
  const pending = new Map();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response);
    pending.delete(response.id);
  });
  let requestId = 0;
  const request = (method, params = {}) =>
    new Promise((resolve) => {
      requestId += 1;
      pending.set(requestId, resolve);
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params })}\n`,
      );
    });

  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "waymark-test", version: "1.0.0" },
  });
  assert.equal(initialized.result.serverInfo.name, "waymark-checkpoint");
  const listed = await request("tools/list");
  assert.deepEqual(
    listed.result.tools.map(({ name }) => name),
    [
      "record_surface",
      "record_behavior_path",
      "record_finding",
      "revise_finding",
      "record_dimension_progress",
      "assess_dimension",
      "assess_practice",
      "record_recommendation",
      "record_friction_disposition",
      "complete_synthesis",
      "record",
    ],
  );
  const recordTool = listed.result.tools.find(({ name }) => name === "record");
  assert.deepEqual(recordTool.annotations, {
    title: "Record Waymark audit checkpoint",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const surfaceVariant = recordTool.inputSchema.oneOf.find(
    (variant) =>
      variant.properties.type.const === "general.surface.inspected",
  );
  assert.deepEqual(
    Object.keys(surfaceVariant.properties.payload.properties).sort(),
    ["citations", "summary", "surface"],
  );
  assert.equal(
    surfaceVariant.properties.payload.additionalProperties,
    false,
  );
  const findingVariant = recordTool.inputSchema.oneOf.find(
    (variant) =>
      variant.properties.type.const === "general.finding.recorded",
  );
  const findingProvenance =
    findingVariant.properties.payload.properties.revision.properties
      .provenance;
  assert.deepEqual(
    Object.keys(findingProvenance.properties).sort(),
    ["amendmentReason", "causedByCitations", "previousRevisionId"],
  );
  const called = await request("tools/call", {
    name: "record_surface",
    arguments: {
      idempotencyKey: "mcp-production-surface",
      surface: "production_code",
      summary: "The MCP tool persisted this checkpoint while the role ran.",
      citations: [],
    },
  });
  const acknowledgement = JSON.parse(called.result.content[0].text);
  assert.equal(called.result.isError, undefined);
  assert.equal(acknowledgement.status, "acknowledged");
  assert.equal(acknowledgement.providerSessionId, "mcp-session");

  const invalidPath = await request("tools/call", {
    name: "record_behavior_path",
    arguments: {
      idempotencyKey: "mcp-behavior-path",
      occurredAt: null,
      pathId: "mcp-path",
      name: "MCP behavior path",
      entryPoint: { status: "invalid", label: "entry", citations: [] },
      owner: { status: "unknown", label: "owner", reason: "Not inspected.", citations: [] },
      dependencies: [],
      consumers: [],
      tests: [],
    },
  });
  assert.equal(invalidPath.result.isError, true);
  const invalidBody = JSON.parse(invalidPath.result.content[0].text);
  assert.equal(invalidBody.error.path, "payload.entryPoint.status");

  const behaviorCalled = await request("tools/call", {
    name: "record_behavior_path",
    arguments: {
      idempotencyKey: "mcp-behavior-path",
      occurredAt: null,
      pathId: "mcp-path",
      name: "MCP behavior path",
      entryPoint: {
        status: "known",
        label: "entry",
        citations: [{
          path: "src/domain/general-audit.mjs",
          startLine: 1,
          endLine: 2,
          symbol: null,
          source: "production_code",
        }],
      },
      owner: {
        status: "unknown",
        label: "owner",
        reason: "Not inspected.",
        citations: [],
      },
      dependencies: [],
      consumers: [],
      tests: [],
    },
  });
  assert.equal(behaviorCalled.result.isError, undefined);

  const findingOccurredAt = "2026-07-25T14:02:00.000Z";
  const findingCalled = await request("tools/call", {
    name: "record_finding",
    arguments: {
      idempotencyKey: "mcp-production-finding",
      occurredAt: findingOccurredAt,
      revision: {
          revisionId: "mcp-production-finding-r1",
          findingId: "mcp-production-finding",
          revisionNumber: 1,
          state: "confirmed",
          signal: "positive",
          title: "The live checkpoint contract is explicit",
          conclusion:
            "The tool schema exposes exact semantic payload fields before the call.",
          dimensionIds: ["discoveryEfficiency"],
          practiceGuideIds: ["canonicalWorkflow"],
          citations: [],
          navigationCost: null,
          provenance: {},
      },
    },
  });
  const findingAcknowledgement = JSON.parse(
    findingCalled.result.content[0].text,
  );
  assert.equal(findingCalled.result.isError, undefined);
  assert.equal(findingAcknowledgement.status, "acknowledged");

  const report = store.readReport(run.id);
  assert.equal(report.generalAudit.surfaces.length, 1);
  assert.equal(report.generalAudit.behaviorPathOrder.length, 1);
  assert.equal(
    report.generalAudit.findings["mcp-production-finding"].currentRevision
      .provenance.actor,
    run.participants[0].id,
  );
  assert.equal(
    report.generalAudit.findings["mcp-production-finding"].currentRevision
      .provenance.occurredAt,
    findingOccurredAt,
  );
  assert.equal(
    report.events.filter(
      ({ type }) => type === "provider.checkpoint.acknowledged",
    ).length,
    3,
  );
  child.stdin.end();
});

test("provider output schemas stay within the strict structured-output subset", () => {
  const schemaPaths = [
    "../src/orchestration/investigation-output.schema.json",
    "../src/orchestration/orchestration-output.schema.json",
    "../src/orchestration/general-audit-output.schema.json",
  ];
  for (const schemaPath of schemaPaths) {
    const schema = JSON.parse(
      readFileSync(fileURLToPath(new URL(schemaPath, import.meta.url)), "utf8"),
    );
    const inspect = (node, path = "$") => {
      if (!node || typeof node !== "object") return;
      assert.equal(
        Object.hasOwn(node, "uniqueItems"),
        false,
        `${schemaPath} ${path} uses unsupported uniqueItems`,
      );
      if (node.type === "object" && node.properties) {
        assert.deepEqual(
          [...(node.required ?? [])].sort(),
          Object.keys(node.properties).sort(),
          `${schemaPath} ${path} must require every declared property`,
        );
      }
      for (const [key, value] of Object.entries(node)) {
        inspect(value, `${path}.${key}`);
      }
    };
    inspect(schema);
  }
});

test("the general runner launches one auditor, streams findings, and completes from coverage", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-runner-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store);

  const result = await runGeneralAudit({
    store,
    runId: run.id,
    adapters: [generalFakeAdapter("general-completed")],
  });

  assert.equal(result.status, "completed");
  assert.equal(result.attempts.length, 1);
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "completed");
  assert.equal(report.generalAudit.auditorAssessedResult !== null, true);
  assert.equal(report.generalAudit.behaviorPathOrder.length, 2);
  assert.equal(
    Object.values(report.generalAudit.practices).filter(
      ({ dispositionRecorded }) => dispositionRecorded,
    ).length,
    7,
  );
  assert.equal(Object.keys(report.generalAudit.frictionDispositions).length, 1);
  const preflight = report.events.find(
    ({ type }) => type === "provider.preflight.completed",
  );
  assert.equal(preflight.payload.sandboxMode, "read-only");
  assert.match(preflight.payload.outputSchema, /general-audit-output\.schema\.json$/);
  assert.match(preflight.payload.checkpointServer, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(preflight.payload.injectedGitSafeDirectory.includes("\\"), false);
  assert.equal(report.aggregates.tokensByPhase.general_research, 200_000);
  assert.equal(
    report.events.some(({ type }) => type === "usage.soft_notice"),
    true,
  );
  assert.equal(
    report.events.some(({ type }) => type.startsWith("budget.")),
    false,
  );
  assert.deepEqual(
    report.run.participants.map(({ role }) => role),
    ["auditor"],
  );
});

test("general provider failure preserves cited findings as a partial report", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-partial-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "runner-general-partial");

  const result = await runGeneralAudit({
    store,
    runId: run.id,
    adapters: [generalFakeAdapter("general-partial-crash")],
  });

  assert.equal(result.status, "partial");
  const report = store.readReport(run.id);
  assert.equal(report.generalAudit.partialReport.available, true);
  assert.equal(report.generalAudit.findingOrder.length, 1);
  assert.match(report.generalAudit.interruption.reason, /exit 7/);
});

test("general final output recovers semantic checkpoints that were not published live", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-fallback-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "runner-general-fallback");

  const result = await runGeneralAudit({
    store,
    runId: run.id,
    adapters: [generalFakeAdapter("general-final-fallback")],
  });

  assert.equal(result.status, "partial");
  const report = store.readReport(run.id);
  assert.deepEqual(report.generalAudit.findingOrder, [
    "fallback-live-evidence",
  ]);
  assert.match(
    report.generalAudit.synthesis.summary,
    /Recovered unpublished checkpoints/,
  );
  assert.equal(
    report.events.filter(
      ({ type, payload }) =>
        type === "provider.checkpoint.acknowledged" &&
        payload.recoverySource === "provider_final_output",
    ).length,
    2,
  );
});

test("general provider failure before usable evidence is failed", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-failed-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "runner-general-failed");

  const result = await runGeneralAudit({
    store,
    runId: run.id,
    adapters: [generalFakeAdapter("failure")],
  });

  assert.equal(result.status, "failed");
  assert.equal(store.readReport(run.id).generalAudit.partialReport.available, false);
});

test("general cancellation preserves the ledger and uses cancelled", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-cancelled-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "runner-general-cancelled");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  t.after(() => clearTimeout(timer));

  const result = await runGeneralAudit({
    store,
    runId: run.id,
    adapters: [generalFakeAdapter("await-interrupt")],
    signal: controller.signal,
    killGraceMs: 50,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(store.readRun(run.id).status, "cancelled");
});

test("general live usage exposes input and output separately before completion", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-live-usage-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "runner-general-live-usage");
  const controller = new AbortController();
  const adapter = generalFakeAdapter("await-interrupt");
  adapter.startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: {
        inputTokens: 55,
        cachedInputTokens: 25,
        outputTokens: 15,
        totalTokens: 70,
      },
      context: {
        inputTokens: 35,
        cachedInputTokens: 20,
        outputTokens: 5,
        totalTokens: 40,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.02,
    });
    return () => {};
  };
  const running = runGeneralAudit({
    store,
    runId: run.id,
    adapters: [adapter],
    signal: controller.signal,
    killGraceMs: 50,
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (
      store
        .readReport(run.id)
        .events.some(({ type }) => type === "provider.usage.updated")
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const snapshot = toRunSnapshot(store.readReport(run.id), 1);
  const usageEvent = store
    .readReport(run.id)
    .events.find(({ type }) => type === "provider.usage.updated");
  assert.equal(Number.isSafeInteger(usageEvent.payload.semanticCheckpointSequence), true);
  assert.equal(usageEvent.payload.marginalTokensWithoutEvidence, 70);
  assert.equal(snapshot.status, "running");
  assert.deepEqual(snapshot.generalAudit.auditor.tokenUsage, {
    totalTokens: 70,
    inputTokens: 55,
    cachedInputTokens: 25,
    uncachedInputTokens: 30,
    outputTokens: 15,
    unclassifiedTokens: 0,
    cacheCreationTokens: null,
    source: "measured_live",
  });
  assert.equal(snapshot.generalAudit.findings.length, 0);

  controller.abort();
  const result = await running;
  assert.equal(result.status, "cancelled");
});

test("general context continuation keeps one auditor identity and projected ledger", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-continuation-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "runner-general-continuation");
  const adapter = generalFakeAdapter("general-continuation");
  adapter.startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: { totalTokens: 2_000 },
      context: { totalTokens: 900 },
      contextWindowTokens: 1_000,
      contextPercent: 90,
    });
    return () => {};
  };

  const result = await runGeneralAudit({
    store,
    runId: run.id,
    adapters: [adapter],
    contextContinuationPercent: 85,
    maxContinuations: 1,
    killGraceMs: 50,
  });

  assert.equal(result.status, "partial");
  assert.equal(result.attempts.length, 2);
  const report = store.readReport(run.id);
  assert.equal(report.generalAudit.continuations.length, 1);
  assert.deepEqual(
    report.run.participants.map(({ id }) => id),
    [run.participants[0].id],
  );
  assert.equal(report.generalAudit.findingOrder.length, 1);
});

test("the CLI routes a general run only through the single-auditor runner", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-cli-general-"));
  const databasePath = join(directory, "audit.sqlite");
  const store = new AuditStore({ databasePath });
  const run = createGeneralRunnerRun(store, "cli-general-run");
  store.close();

  const rejectedBenchmarkLaunch = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      databasePath,
      "investigation",
      "run",
      "--run",
      run.id,
      "--codex-entry",
      fakeProviderPath,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  assert.equal(rejectedBenchmarkLaunch.status, 1);
  assert.equal(
    JSON.parse(rejectedBenchmarkLaunch.stdout).error.code,
    "GENERAL_AUDIT_REQUIRES_SINGLE_AUDITOR",
  );

  const cli = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      databasePath,
      "general",
      "audit",
      "--run",
      run.id,
      "--codex-entry",
      fakeProviderPath,
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        WAYMARK_FAKE_MODE: "general-completed",
        WAYMARK_FAKE_ROLE: "auditor",
      },
    },
  );

  assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
  const output = JSON.parse(cli.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "general audit");
  assert.equal(output.data.status, "completed");
  const reopened = new AuditStore({ databasePath });
  try {
    const report = reopened.readReport(run.id);
    assert.equal(report.run.status, "completed");
    assert.deepEqual(
      report.run.participants.map(({ role }) => role),
      ["auditor"],
    );
    assert.equal(
      report.events.some(({ type }) => type === "investigation.started"),
      false,
    );
    assert.equal(
      report.events.some(({ type }) => type === "orchestration.started"),
      false,
    );
  } finally {
    reopened.close();
  }
});

function createRun(
  store,
  {
    independent = true,
    candidateHardLimit = 500,
    candidateCommandBudget = 6,
    independentCommandBudget = 8,
    auditMode = "task_specific",
  } = {},
) {
  return store.createRun({
    targetRepositoryPath: repositoryRoot,
    repositoryIdentity: "waymark-test",
    commitSha: "0123456789abcdef",
    task:
      auditMode === "general"
        ? "Assess all seven Practice Guide principles"
        : "Locate the owner and change surface for a test feature",
    participants: [
      { role: "orchestrator", provider: "fake", model: "orchestrator" },
      { role: "candidate", provider: "fake", model: "candidate" },
      ...(independent
        ? [{ role: "independent", provider: "fake", model: "independent" }]
        : []),
    ],
    toolPolicy: {
      target: "read-only",
      allowed: ["read files"],
      forbidden: ["editing target files"],
    },
    runConditions: {
      auditMode,
      ...(auditMode === "general"
        ? {
            taskSuite: {
              id: "waymark-general-navigation",
              version: "2.0.0",
            },
          }
        : {}),
      candidateReasoningEffort: "low",
      independentReasoningEffort: "high",
      execution: {
        isolation: "fresh_process",
        sessionPersistence: "local_telemetry_log",
        contextPolicy: "assignment_only",
        measurementScope: "role_process_only",
        shellCommandBudget: {
          candidate: candidateCommandBudget,
          independent: independentCommandBudget,
          orchestrator: 6,
        },
        searchResultLimit: 40,
        fileReadLineLimit: 100,
      },
      tokenBudgets: {
        candidate_navigation: {
          targetTokens: Math.min(100, candidateHardLimit),
          hardLimitTokens: candidateHardLimit,
        },
      },
    },
    protocolVersion: "1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  });
}

function fakeAdapter(
  modeByRole = {},
  usageEnforcement = "post_completion",
  usageMonitor = null,
  resumable = false,
  resumeMode = "report-only",
) {
  return {
    id: "fake",
    requiresFinalOutput: true,
    usageEnforcement,
    supports(participant) {
      return participant.provider === "fake";
    },
    createLaunchSpec(assignment, prompt) {
      return {
        command: process.execPath,
        arguments: [
          fakeProviderPath,
          modeByRole[assignment.role] ?? "success",
          assignment.role,
          ...(assignment.context?.claims?.[0]?.id
            ? [assignment.context.claims[0].id]
            : []),
        ],
        cwd: assignment.target.path,
        stdin: prompt,
      };
    },
    ...(resumable
      ? {
          createResumeLaunchSpec(assignment, prompt) {
            return {
              command: process.execPath,
              arguments: [
                fakeProviderPath,
                resumeMode,
                assignment.role,
                ...(assignment.context?.claims?.[0]?.id
                  ? [assignment.context.claims[0].id]
                  : []),
              ],
              cwd: assignment.target.path,
              stdin: prompt,
            };
          },
        }
      : {}),
    extractUsage: extractCodexUsage,
    extractFinalOutput: extractCodexFinalOutput,
    normalizeEvent: normalizeCodexEvent,
    ...(usageMonitor === null
      ? {}
      : { startUsageMonitor: usageMonitor }),
  };
}

test("fresh candidate and independent processes stream evidence and keep a successful run active", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-orchestration-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store);

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [fakeAdapter()],
  });

  assert.equal(result.status, "active");
  assert.deepEqual(
    result.results.map(({ role, status }) => ({ role, status })),
    [
      { role: "candidate", status: "completed" },
      { role: "independent", status: "completed" },
    ],
  );

  const report = store.readReport(run.id);
  assert.equal(report.run.status, "active");
  assert.deepEqual(
    report.events
      .filter(({ type }) => type === "investigation.started")
      .map(({ actor, type }) => ({ actor, type })),
    [
      { actor: "candidate", type: "investigation.started" },
      { actor: "independent", type: "investigation.started" },
    ],
  );
  assert.equal(
    report.events.filter(({ type }) => type === "provider.tool.completed").length,
    3,
  );
  assert.equal(
    report.events.filter(({ type }) => type === "provider.tool.started").length,
    3,
  );
  assert.equal(
    report.events.filter(({ type }) => type === "investigation.completed").length,
    2,
  );
  const starts = report.events.filter(
    ({ type }) => type === "investigation.started",
  );
  assert.deepEqual(
    starts.map(({ payload }) => payload.reasoningEffort),
    ["low", "high"],
  );
  const completions = report.events.filter(
    ({ type }) => type === "investigation.completed",
  );
  assert.ok(
    completions.every(({ payload }) => payload.result.hasCommandBudget === true),
  );
  assert.ok(
    completions.every(
      ({ payload }) => payload.result.hasForbiddenPolicy === true,
    ),
  );
  assert.ok(
    completions.every(
      ({ payload }) => payload.result.hasDirectReadPolicy === true,
    ),
  );
  assert.equal(report.events.at(-1).type, "phase.changed");
  assert.equal(report.events.at(-1).payload.progress, 65);
  assert.equal(report.tokens.length, 3);
  assert.equal(report.aggregates.tokensByPhase.candidate_navigation, 80);
  assert.equal(report.aggregates.tokensByPhase.independent_validation, 100);
  assert.equal(report.aggregates.tokensByPhase.orchestration, 120);
  assert.ok(report.tokens.every(({ source }) => source === "measured"));
  assert.equal(report.claims.length, 1);
  assert.equal(
    report.events.filter(({ type }) => type === "probe.result").length,
    2,
  );
  assert.ok(
    report.events
      .filter(({ type }) => type === "probe.result")
      .every(
        ({ payload }) =>
          payload.visibility === "validator_only" &&
          payload.recommendationEvidence === false,
      ),
  );
  assert.match(report.claims[0].assertion, /discoverable entry point/i);
  assert.equal(
    report.events.some(({ type }) => type === "orchestration.completed"),
    true,
  );
  assert.equal(
    report.events.some(({ type }) => type === "recommendations.drafted"),
    true,
  );
  assert.equal(toRunSnapshot(report, 1).progress, 65);
  assert.throws(
    () => finalizeDraftRecommendations({ store, runId: run.id }),
    (error) => error.code === "RECOMMENDATION_CLAIM_NOT_VERIFIED",
  );

  store.recordVerification({
    runId: run.id,
    claimId: report.claims[0].id,
    verifier: "orchestrator",
    method: "static_inspection",
    verdict: "verified",
    evidence: {
      citationStatus: "valid",
      independentAssessment: "agree",
    },
  });
  assert.equal(toRunSnapshot(store.readReport(run.id), 1).progress, 85);
  const recommendationEvent = finalizeDraftRecommendations({
    store,
    runId: run.id,
  });
  assert.equal(recommendationEvent.type, "report.recommendations");
  const finalized = store.readReport(run.id);
  const finalizedSnapshot = toRunSnapshot(finalized, 1);
  assert.equal(finalizedSnapshot.progress, 90);
  assert.equal(finalizedSnapshot.recommendations.length, 1);
  assert.equal(
    finalizedSnapshot.recommendations[0].evidence[0].path,
    "package.json",
  );
  assert.match(
    finalizedSnapshot.recommendations[0].repositoryChanges[0],
    /docs\/test-change-surface\.md/,
  );
  assert.equal(
    finalizedSnapshot.recommendations[0].validationChecks.length,
    1,
  );
  assert.equal(finalizedSnapshot.recommendations[0].limitations.length, 1);
  assert.equal(
    finalized.events.at(-2).type,
    "report.recommendations",
  );
  const repeatedRecommendationEvent = finalizeDraftRecommendations({
    store,
    runId: run.id,
  });
  assert.equal(repeatedRecommendationEvent.id, recommendationEvent.id);
  assert.equal(
    store
      .readReport(run.id)
      .events.filter(({ type }) => type === "report.recommendations").length,
    1,
  );
  await assert.rejects(
    () =>
      runInvestigationPhase({
        store,
        runId: run.id,
        adapters: [fakeAdapter()],
      }),
    (error) => error.code === "ORCHESTRATION_ALREADY_STARTED",
  );
});

test("the benchmark runner rejects general audits before launching roles", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-route-guard-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createGeneralRunnerRun(store, "general-route-guard");

  await assert.rejects(
    () =>
      runInvestigationPhase({
        store,
        runId: run.id,
        adapters: [fakeAdapter()],
      }),
    (error) => error.code === "GENERAL_AUDIT_REQUIRES_SINGLE_AUDITOR",
  );
  assert.equal(store.readEvents(run.id, { limit: 10 }).length, 0);
});

test("general runs reject benchmark participant sets at creation", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-role-guard-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());

  assert.throws(
    () => createRun(store, { auditMode: "general" }),
    /general audits require exactly one auditor role/,
  );
});

test("live provider usage and command progress reach the journal before completion", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-live-progress-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, { independent: false });
  const startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: {
        inputTokens: 55,
        cachedInputTokens: 25,
        outputTokens: 15,
        totalTokens: 70,
      },
      context: {
        inputTokens: 35,
        cachedInputTokens: 20,
        outputTokens: 5,
        totalTokens: 40,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.02,
    });
    return () => {};
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter({}, "post_completion", startUsageMonitor),
    ],
  });

  assert.equal(result.status, "active");
  const report = store.readReport(run.id);
  assert.ok(
    report.events.some(
      ({ actor, type }) =>
        actor === "candidate" && type === "provider.usage.updated",
    ),
  );
  assert.ok(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "role.progress" &&
        payload.cumulativeTokens === 70,
    ),
  );
  const snapshot = toRunSnapshot(report, 1);
  assert.equal(snapshot.tokenUsage.candidateSession.currentContextTokens, 40);
  assert.equal(snapshot.tokenUsage.candidateSession.peakContextTokens, 40);
  assert.equal(
    snapshot.tokenUsage.candidateSession.peakContextSource,
    "provider_session_log",
  );
});

test("a resumable provider stops exploration and retains a partial report", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-budget-wrap-up-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  const startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: {
        inputTokens: 65,
        cachedInputTokens: 20,
        outputTokens: 20,
        totalTokens: 85,
      },
      context: {
        inputTokens: 50,
        cachedInputTokens: 15,
        outputTokens: 10,
        totalTokens: 60,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.02,
    });
    return () => {};
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "await-interrupt" },
        "post_completion",
        startUsageMonitor,
        true,
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_budget");
  assert.equal(
    result.results[0].completion.evidenceCompleteness,
    "partial_budget_exhausted",
  );
  const report = store.readReport(run.id);
  const requested = report.events.find(
    ({ actor, type }) =>
      actor === "candidate" && type === "budget.wrap_up_requested",
  );
  assert.equal(requested.payload.wrapUpTriggerTokens, 80);
  assert.equal(requested.payload.reservedTokens, 15);
  assert.equal(requested.payload.plannedReserveTokens, 20);
  assert.equal(requested.payload.contextTokens, 60);
  assert.equal(requested.payload.projectedReportTokens, 155);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.wrap_up_completed" &&
        payload.resultRetained === true,
    ),
    true,
  );
  assert.equal(report.claims.length > 0, true);
  assert.equal(
    report.events.find(
      ({ actor, type }) => actor === "candidate" && type === "probe.result",
    ).payload.status,
    "partial",
  );
  assert.equal(
    report.events.some(({ type }) => type === "orchestration.completed"),
    true,
  );
  const snapshot = toRunSnapshot(report, 1);
  assert.equal(
    snapshot.calibration.status,
    "eligible_with_partial_budget_report",
  );
  assert.equal(snapshot.calibration.eligible, true);
  assert.equal(
    snapshot.calibration.resourceSignals[0].type,
    "partial_budget_report",
  );
  assert.equal(
    snapshot.evidence.some(
      ({ source, status }) =>
        source === "candidate partial report" &&
        status === "Partial - budget reserve",
    ),
    true,
  );
});

test("asynchronous live telemetry stops exploration at the reporting reserve", async (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "waymark-async-budget-wrap-up-"),
  );
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  const startUsageMonitor = ({ onUsage }) => {
    const timer = setTimeout(() => {
      onUsage({
        cumulative: {
          inputTokens: 65,
          cachedInputTokens: 20,
          outputTokens: 20,
          totalTokens: 85,
        },
        context: {
          inputTokens: 50,
          cachedInputTokens: 15,
          outputTokens: 10,
          totalTokens: 60,
        },
        contextWindowTokens: 258_400,
        contextPercent: 0.02,
      });
    }, 25);
    return () => clearTimeout(timer);
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "early-output-await" },
        "post_completion",
        startUsageMonitor,
        true,
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_budget");
  const report = store.readReport(run.id);
  const requested = report.events.find(
    ({ actor, type }) =>
      actor === "candidate" && type === "budget.wrap_up_requested",
  );
  assert.equal(requested.payload.trigger, "reporting_reserve_reached");
  assert.equal(requested.payload.observedTokens, 85);
  assert.match(
    result.results[0].completion.result.probeResult.summary,
    /Budget reserve triggered/i,
  );
  assert.doesNotMatch(
    result.results[0].completion.result.summary,
    /Early placeholder/i,
  );
});

test("a reporting rescue can complete after realistic provider latency", async (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "waymark-delayed-budget-wrap-up-"),
  );
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  const startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: {
        inputTokens: 35,
        cachedInputTokens: 10,
        outputTokens: 5,
        totalTokens: 40,
      },
      context: {
        inputTokens: 45,
        cachedInputTokens: 10,
        outputTokens: 5,
        totalTokens: 50,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.02,
    });
    return () => {};
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "await-interrupt" },
        "post_completion",
        startUsageMonitor,
        true,
        "report-only-delayed",
      ),
    ],
    killGraceMs: 100,
    budgetWrapUpTimeoutMs: 500,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_budget");
  const report = store.readReport(run.id);
  const requested = report.events.find(
    ({ actor, type }) =>
      actor === "candidate" && type === "budget.wrap_up_requested",
  );
  assert.equal(requested.payload.trigger, "projected_report_reserve_reached");
  assert.equal(requested.payload.observedTokens, 40);
  assert.equal(requested.payload.contextTokens, 50);
  assert.equal(requested.payload.reportOutputReserveTokens, 10);
  assert.equal(requested.payload.projectedReportTokens, 100);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.wrap_up_completed" &&
        payload.reportTimeoutMs === 500 &&
        payload.resultRetained === true,
    ),
    true,
  );
});

test("a reporting rescue remains subject to the declared hard token limit", async (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "waymark-bounded-budget-wrap-up-"),
  );
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  let monitorStarts = 0;
  const startUsageMonitor = ({ onUsage }) => {
    monitorStarts += 1;
    if (monitorStarts === 1) {
      onUsage({
        cumulative: {
          inputTokens: 35,
          cachedInputTokens: 10,
          outputTokens: 5,
          totalTokens: 40,
        },
        context: {
          inputTokens: 45,
          cachedInputTokens: 10,
          outputTokens: 5,
          totalTokens: 50,
        },
        contextWindowTokens: 258_400,
        contextPercent: 0.02,
      });
      return () => {};
    }
    const timer = setTimeout(() => {
      onUsage({
        cumulative: {
          inputTokens: 96,
          cachedInputTokens: 30,
          outputTokens: 5,
          totalTokens: 101,
        },
        context: {
          inputTokens: 56,
          cachedInputTokens: 20,
          outputTokens: 5,
          totalTokens: 61,
        },
        contextWindowTokens: 258_400,
        contextPercent: 0.02,
      });
    }, 25);
    return () => clearTimeout(timer);
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "await-interrupt" },
        "post_completion",
        startUsageMonitor,
        true,
        "report-only-delayed",
      ),
    ],
    killGraceMs: 100,
    budgetWrapUpTimeoutMs: 500,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.results[0].status, "budget_exceeded");
  assert.equal(result.results[0].failure.reason, "hard_token_limit_exceeded");
  assert.equal(result.results[0].failure.enforcement, "live_stream_interrupt");
  const report = store.readReport(run.id);
  assert.equal(report.tokens[0].totalTokens, 101);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.wrap_up_failed" &&
        payload.terminationReason === "hard_token_limit" &&
        payload.resultRetained === false,
    ),
    true,
  );
});

test("a telemetry jump past the hard limit still retains a rescue report", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-budget-overshoot-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  const startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: {
        inputTokens: 125,
        cachedInputTokens: 80,
        outputTokens: 25,
        totalTokens: 150,
      },
      context: {
        inputTokens: 60,
        cachedInputTokens: 40,
        outputTokens: 10,
        totalTokens: 70,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.03,
    });
    return () => {};
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "await-interrupt" },
        "post_completion",
        startUsageMonitor,
        true,
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_budget");
  const report = store.readReport(run.id);
  const requested = report.events.find(
    ({ actor, type }) =>
      actor === "candidate" && type === "budget.wrap_up_requested",
  );
  assert.equal(requested.payload.trigger, "telemetry_overshot_hard_limit");
  assert.equal(requested.payload.observedTokens, 150);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.wrap_up_completed" &&
        payload.resultRetained === true &&
        payload.reportingOnly === true,
    ),
    true,
  );
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.exceeded" &&
        payload.resultRetained === true &&
        payload.workflowContinued === true,
    ),
    true,
  );
  assert.equal(report.claims.length > 0, true);
});

test("a post-exit overrun resumes the provider for a rescue report", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-budget-post-exit-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  const startUsageMonitor = ({ onUsage }) => () => {
    onUsage({
      cumulative: {
        inputTokens: 125,
        cachedInputTokens: 80,
        outputTokens: 25,
        totalTokens: 150,
      },
      context: {
        inputTokens: 60,
        cachedInputTokens: 40,
        outputTokens: 10,
        totalTokens: 70,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.03,
    });
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "failure" },
        "post_completion",
        startUsageMonitor,
        true,
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_budget");
  const report = store.readReport(run.id);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.wrap_up_completed" &&
        payload.resultRetained === true,
    ),
    true,
  );
  assert.equal(
    report.events.some(
      ({ actor, type }) =>
        actor === "candidate" && type === "investigation.failed",
    ),
    false,
  );
  assert.equal(report.claims.length > 0, true);
});

test("a rescue report is rejected if the provider calls tools", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-budget-report-tools-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });
  const startUsageMonitor = ({ onUsage }) => {
    onUsage({
      cumulative: {
        inputTokens: 65,
        cachedInputTokens: 20,
        outputTokens: 20,
        totalTokens: 85,
      },
      context: {
        inputTokens: 50,
        cachedInputTokens: 15,
        outputTokens: 10,
        totalTokens: 60,
      },
      contextWindowTokens: 258_400,
      contextPercent: 0.02,
    });
    return () => {};
  };

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "await-interrupt" },
        "post_completion",
        startUsageMonitor,
        true,
        "success",
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "failed");
  const report = store.readReport(run.id);
  const failedWrapUp = report.events.find(
    ({ actor, type }) =>
      actor === "candidate" && type === "budget.wrap_up_failed",
  );
  assert.equal(failedWrapUp.payload.reportToolViolation, true);
  assert.equal(failedWrapUp.payload.resultRetained, false);
});

test("the runner rejects a role on shell command N+1 and counts declined commands", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-command-budget-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateCommandBudget: 6,
  });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [fakeAdapter({ candidate: "command-over-budget-await" })],
    killGraceMs: 100,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.results[0].status, "policy_exceeded");
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "failed");
  assert.equal(
    report.events.filter(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "provider.tool.started" &&
        payload.toolType === "command_execution",
    ).length,
    7,
  );
  const violation = report.events.find(
    ({ actor, type }) =>
      actor === "candidate" && type === "policy.violation",
  );
  assert.equal(violation.payload.reason, "shell_command_budget_exceeded");
  assert.equal(violation.payload.declaredLimit, 6);
  assert.equal(violation.payload.observedCommands, 7);
  assert.equal(violation.payload.blockedCommandsConsumeBudget, true);
  assert.equal(violation.payload.calibrationEligible, false);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "investigation.failed" &&
        payload.reason === "shell_command_budget_exceeded",
    ),
    true,
  );
  assert.equal(report.events.at(-1).type, "run.finished");
  assert.equal(report.events.at(-1).payload.summary.calibrationEligible, false);
  assert.equal(
    report.events.at(-1).payload.summary.reason,
    "shell_command_budget_exceeded",
  );
  assert.equal(
    toRunSnapshot(report, 1).latestEvent,
    "Audit failed: shell command budget exceeded.",
  );
});

test("a command-limit stop retains a no-tools partial report when resumable", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-command-wrap-up-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateCommandBudget: 1,
  });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "command-over-budget-await" },
        "post_completion",
        null,
        true,
        "report-only",
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_policy");
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "active");
  assert.equal(report.claims.length > 0, true);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "budget.wrap_up_requested" &&
        payload.trigger === "shell_command_budget_exceeded",
    ),
    true,
  );
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "candidate" &&
        type === "investigation.completed" &&
        payload.evidenceCompleteness === "partial_policy_exceeded" &&
        payload.calibrationEligible === false,
    ),
    true,
  );
});

test("a command-limit rescue replaces an early structured placeholder", async (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "waymark-command-placeholder-"),
  );
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateCommandBudget: 1,
  });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter(
        { candidate: "early-output-command-over-budget-await" },
        "post_completion",
        null,
        true,
        "report-only",
      ),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_partial_policy");
  assert.doesNotMatch(
    result.results[0].completion.result.summary,
    /Early placeholder/i,
  );
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "active");
  assert.equal(report.claims.length > 0, true);
});

test("completed candidate evidence survives an independent policy failure", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-independent-failure-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: true,
    independentCommandBudget: 1,
  });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter({
        independent: "command-over-budget-await",
      }),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.deepEqual(
    result.results.map(({ role, status }) => ({ role, status })),
    [
      { role: "candidate", status: "completed" },
      { role: "independent", status: "policy_exceeded" },
    ],
  );
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "active");
  assert.equal(report.claims.length > 0, true);
  assert.equal(
    report.events.some(
      ({ actor, type, payload }) =>
        actor === "workflow" &&
        type === "investigation.degraded" &&
        payload.calibrationEligible === false &&
        payload.unavailableRoles[0].role === "independent",
    ),
    true,
  );
  assert.equal(
    report.events.some(
      ({ actor, type }) =>
        actor === "orchestrator" && type === "orchestration.completed",
    ),
    true,
  );
});

test("candidate evidence import rejects findings that are not navigation facts", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-finding-kind-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, { independent: false });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [fakeAdapter({ candidate: "invalid-finding-kind" })],
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failure.reason, "candidate_evidence_import_failed");
  assert.equal(result.failure.error.code, "CANDIDATE_USABLE_FINDINGS_REQUIRED");
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "failed");
  assert.equal(report.claims.length, 0);
  assert.equal(
    report.events.some(
      ({ type, payload }) =>
        type === "orchestration.failed" &&
        payload.error?.code === "CANDIDATE_USABLE_FINDINGS_REQUIRED",
    ),
    true,
  );
});

test("candidate evidence import retains valid findings when a sibling finding is malformed", async (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "waymark-partial-finding-import-"),
  );
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, { independent: false });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter({ candidate: "mixed-valid-and-invalid-findings" }),
    ],
  });

  assert.equal(result.status, "active");
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "active");
  assert.equal(report.claims.length, 1);
  const degraded = report.events.find(
    ({ actor, type, payload }) =>
      actor === "workflow" &&
      type === "investigation.degraded" &&
      payload.reason === "evidence_normalization_required",
  );
  assert.ok(degraded);
  assert.equal(degraded.payload.retainedCandidateClaims, 1);
  assert.equal(
    degraded.payload.issues.some(
      ({ scope, code }) =>
        scope === "finding" && code === "CANDIDATE_FINDING_KIND_REQUIRED",
    ),
    true,
  );
  const snapshot = toRunSnapshot(report, 1);
  assert.equal(snapshot.calibration.eligible, false);
  assert.equal(snapshot.calibration.status, "diagnostic_only");
  assert.equal(snapshot.calibration.issues[0].type, "evidence_degraded");
});

test("a completion-only token overrun remains valid evidence and continues", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-budget-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [fakeAdapter({ candidate: "over-budget" })],
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_over_budget");
  assert.equal(result.results[0].completion.calibrationEligible, true);
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "active");
  assert.equal(report.aggregates.tokensByPhase.candidate_navigation, 110);
  const exceeded = report.events.find(({ type }) => type === "budget.exceeded");
  assert.equal(exceeded.payload.hardLimitTokens, 100);
  assert.equal(exceeded.payload.observedTokens, 110);
  assert.equal(exceeded.payload.enforcement, "post_completion");
  assert.equal(exceeded.payload.calibrationEligible, true);
  assert.equal(exceeded.payload.withinDeclaredResourceEnvelope, false);
  assert.equal(exceeded.payload.resultRetained, true);
  assert.equal(exceeded.payload.workflowContinued, true);
  assert.equal(report.claims.length > 0, true);
  assert.equal(
    report.events.some(({ type }) => type === "orchestration.completed"),
    true,
  );
  assert.equal(report.events.at(-1).type, "phase.changed");
  assert.equal(report.events.at(-1).payload.progress, 65);
  const snapshot = toRunSnapshot(report, 1);
  assert.equal(snapshot.calibration.eligible, true);
  assert.equal(
    snapshot.calibration.status,
    "eligible_with_resource_overrun",
  );
  assert.equal(snapshot.calibration.resourceSignals.length, 1);
  assert.equal(
    snapshot.participants.find(({ role }) => role === "candidate").status,
    "Complete",
  );
});

test("a live hard-limit interrupt retains a completed structured result", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-live-budget-"));
  const store = new AuditStore({ databasePath: join(directory, "audit.sqlite") });
  t.after(() => store.close());
  const run = createRun(store, {
    independent: false,
    candidateHardLimit: 100,
  });

  const result = await runInvestigationPhase({
    store,
    runId: run.id,
    adapters: [
      fakeAdapter({ candidate: "live-over-budget" }, "live"),
    ],
    killGraceMs: 100,
  });

  assert.equal(result.status, "active");
  assert.equal(result.results[0].status, "completed_over_budget");
  assert.equal(result.results[0].completion.calibrationEligible, true);
  const report = store.readReport(run.id);
  const exceeded = report.events.find(({ type }) => type === "budget.exceeded");
  assert.equal(exceeded.payload.enforcement, "live_stream_interrupt");
  assert.equal(exceeded.payload.observedTokens, 110);
  assert.equal(exceeded.payload.resultRetained, true);
  assert.equal(exceeded.payload.workflowContinued, true);
});

test("the Codex adapter uses the JavaScript entry point and isolated exec flags", () => {
  const adapter = createCodexProcessAdapter({ entryPath: fakeProviderPath });
  const assignment = {
      runId: "run-1",
      role: "candidate",
      participant: {
        role: "candidate",
        provider: "openai",
        model: "gpt-test",
      },
      reasoningEffort: "low",
      target: {
        path: repositoryRoot,
        identity: "waymark",
        commitSha: "abc123",
        readOnly: true,
      },
      task: "Inspect the repository",
      executionPolicy: {
        isolation: "fresh_process",
        sessionPersistence: "local_telemetry_log",
        contextPolicy: "assignment_only",
        measurementScope: "role_process_only",
      },
      tokenBudget: { targetTokens: 100, hardLimitTokens: 200 },
      constraints: [],
      expectedEvidence: [],
    };
  const launch = adapter.createLaunchSpec(assignment, "assignment only");

  assert.equal(launch.command, process.execPath);
  assert.equal(launch.arguments[0], fakeProviderPath);
  assert.ok(!launch.arguments.includes("--ephemeral"));
  assert.ok(launch.arguments.includes("--ignore-user-config"));
  assert.ok(launch.arguments.includes("--ignore-rules"));
  assert.ok(launch.arguments.includes("--json"));
  assert.ok(launch.arguments.includes('approval_policy="never"'));
  assert.equal(
    launch.arguments.some((argument) =>
      String(argument).includes("mcp_servers.waymark_checkpoint"),
    ),
    false,
  );
  assert.deepEqual(
    launch.arguments.slice(
      launch.arguments.indexOf("--sandbox"),
      launch.arguments.indexOf("--sandbox") + 2,
    ),
    ["--sandbox", "read-only"],
  );
  assert.equal(launch.arguments.at(-1), "-");
  assert.equal(launch.stdin, "assignment only");
  assert.deepEqual(
    launch.arguments.slice(
      launch.arguments.indexOf("-c"),
      launch.arguments.indexOf("-c") + 2,
    ),
    ["-c", 'model_reasoning_effort="low"'],
  );
  const safeDirectoryIndex = Number(launch.environment.GIT_CONFIG_COUNT) - 1;
  assert.equal(
    launch.environment[`GIT_CONFIG_KEY_${safeDirectoryIndex}`],
    "safe.directory",
  );
  assert.equal(
    launch.environment[`GIT_CONFIG_VALUE_${safeDirectoryIndex}`],
    repositoryRoot.replaceAll("\\", "/"),
  );
  const resume = adapter.createResumeLaunchSpec(
    assignment,
    "report partial findings",
    "session-1",
  );
  assert.deepEqual(resume.arguments.slice(1, 3), ["exec", "resume"]);
  assert.ok(resume.arguments.includes('sandbox_mode="read-only"'));
  assert.equal(resume.arguments.at(-2), "session-1");
  assert.equal(resume.arguments.at(-1), "-");
  assert.equal(resume.stdin, "report partial findings");

  const usage = extractCodexUsage({
    type: "turn.completed",
    usage: {
      input_tokens: 60,
      cached_input_tokens: 50,
      output_tokens: 20,
    },
  });
  assert.equal(usage.totalTokens, 80);
});

test("the Codex adapter pre-approves the runner-owned checkpoint tool for a read-only auditor", () => {
  const adapter = createCodexProcessAdapter({ entryPath: fakeProviderPath });
  const assignment = {
    runId: "general-read-only",
    role: "auditor",
    permissionMode: "read_only",
    participant: {
      role: "auditor",
      provider: "openai",
      model: "gpt-test",
    },
    reasoningEffort: "medium",
    target: {
      path: repositoryRoot,
      identity: "waymark",
      commitSha: "abc123",
      readOnly: true,
    },
  };

  const launch = adapter.createLaunchSpec(assignment, "audit read-only");
  assert.ok(
    launch.arguments.some((argument) =>
      argument.includes('enabled_tools=["record_surface"'),
    ),
  );
  assert.ok(
    launch.arguments.includes(
      'mcp_servers.waymark_checkpoint.tools.record_behavior_path.approval_mode="approve"',
    ),
  );
  assert.ok(
    launch.arguments.includes("mcp_servers.waymark_checkpoint.required=true"),
  );
  assert.deepEqual(
    launch.arguments.slice(
      launch.arguments.indexOf("--sandbox"),
      launch.arguments.indexOf("--sandbox") + 2,
    ),
    ["--sandbox", "read-only"],
  );
});

test("the Codex adapter gives an explicitly unrestricted auditor full access without prompts", () => {
  const adapter = createCodexProcessAdapter({ entryPath: fakeProviderPath });
  const assignment = {
    runId: "general-full-access",
    role: "auditor",
    permissionMode: "unrestricted_no_approval",
    participant: {
      role: "auditor",
      provider: "openai",
      model: "gpt-test",
    },
    reasoningEffort: "medium",
    target: {
      path: repositoryRoot,
      identity: "waymark",
      commitSha: "abc123",
      readOnly: false,
    },
  };

  const launch = adapter.createLaunchSpec(assignment, "audit freely");
  assert.ok(launch.arguments.includes('approval_policy="never"'));
  assert.ok(
    launch.arguments.some((argument) =>
      argument.startsWith("mcp_servers.waymark_checkpoint.command="),
    ),
  );
  assert.ok(
    launch.arguments.includes(
      'mcp_servers.waymark_checkpoint.env_vars=["WAYMARK_CHECKPOINT_RUN_ID","WAYMARK_CHECKPOINT_ACTOR","WAYMARK_CHECKPOINT_ENDPOINT","WAYMARK_CHECKPOINT_AUTHORIZATION"]',
    ),
  );
  assert.ok(
    launch.arguments.some((argument) =>
      argument.includes('enabled_tools=["record_surface"'),
    ),
  );
  assert.ok(
    launch.arguments.includes(
      'mcp_servers.waymark_checkpoint.tools.assess_practice.approval_mode="approve"',
    ),
  );
  assert.ok(
    launch.arguments.includes("mcp_servers.waymark_checkpoint.required=true"),
  );
  const schemaIndex = launch.arguments.indexOf("--output-schema");
  assert.match(
    launch.arguments[schemaIndex + 1],
    /general-audit-output\.schema\.json$/,
  );
  assert.deepEqual(
    launch.arguments.slice(
      launch.arguments.indexOf("--sandbox"),
      launch.arguments.indexOf("--sandbox") + 2,
    ),
    ["--sandbox", "danger-full-access"],
  );
  const attached = adapter.attachCheckpointTransport(launch, {
    runId: "general-full-access",
    auditorId: "general-full-access-auditor",
    endpoint: "http://127.0.0.1:43210/v1/general-checkpoints",
    authorization: "Bearer checkpoint-test",
  });
  assert.equal(
    attached.environment.WAYMARK_CHECKPOINT_ENDPOINT,
    "http://127.0.0.1:43210/v1/general-checkpoints",
  );
  assert.equal(
    attached.environment.WAYMARK_CHECKPOINT_AUTHORIZATION,
    "Bearer checkpoint-test",
  );

  const resume = adapter.createResumeLaunchSpec(
    assignment,
    "continue audit",
    "session-1",
  );
  assert.ok(resume.arguments.includes('sandbox_mode="danger-full-access"'));
  assert.ok(
    resume.arguments.some((argument) =>
      argument.startsWith("mcp_servers.waymark_checkpoint.command="),
    ),
  );
  assert.ok(
    resume.arguments.includes(
      'mcp_servers.waymark_checkpoint.tools.complete_synthesis.approval_mode="approve"',
    ),
  );
});

test("the Codex adapter keeps a bounded reason for policy-blocked tools", () => {
  const normalized = normalizeCodexEvent({
    type: "item.completed",
    item: {
      id: "item-blocked",
      type: "command_execution",
      command: "Get-Content sensitive-source.cs",
      status: "declined",
      exit_code: -1,
      aggregated_output:
        "private source contents that must not persist\nrejected: blocked by policy",
    },
  });

  assert.equal(normalized.type, "provider.tool.completed");
  assert.equal(normalized.payload.failureReason, "blocked by policy");
  assert.equal(normalized.payload.status, "declined");
  assert.equal(normalized.payload.exitCode, -1);
  assert.equal(
    JSON.stringify(normalized).includes("private source contents"),
    false,
  );
  assert.equal("aggregatedOutput" in normalized.payload, false);
  assert.equal("output" in normalized.payload, false);
});

test("the Codex adapter does not infer diagnostics from successful tool output", () => {
  const normalized = normalizeCodexEvent({
    type: "item.completed",
    item: {
      id: "item-success",
      type: "command_execution",
      command: "rg blocked-by-policy docs",
      status: "completed",
      exit_code: 0,
      aggregated_output: "Example text: rejected: blocked by policy",
    },
  });

  assert.equal("failureReason" in normalized.payload, false);
});

test("the Codex rollout monitor normalizes cumulative and context usage", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "waymark-codex-home-"));
  const now = new Date();
  const sessionDirectory = join(
    codexHome,
    "sessions",
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  );
  mkdirSync(sessionDirectory, { recursive: true });
  const providerSessionId = "019f-test-live-usage";
  const rolloutPath = join(
    sessionDirectory,
    `rollout-2026-07-24-${providerSessionId}.jsonl`,
  );
  const tokenRecord = (totalTokens, contextTokens) =>
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: totalTokens - 10,
            cached_input_tokens: 50,
            output_tokens: 10,
            total_tokens: totalTokens,
          },
          last_token_usage: {
            input_tokens: contextTokens - 5,
            cached_input_tokens: 20,
            output_tokens: 5,
            total_tokens: contextTokens,
          },
          model_context_window: 258_400,
        },
      },
    });
  writeFileSync(rolloutPath, `${tokenRecord(110, 65)}\n`);

  const observed = [];
  const stop = createCodexRolloutUsageMonitor({
    providerSessionId,
    codexHome,
    intervalMs: 60_000,
    onUsage: (usage) => observed.push(usage),
  });
  appendFileSync(rolloutPath, tokenRecord(210, 95));
  stop();

  assert.equal(observed.length, 2);
  assert.deepEqual(
    extractCodexRolloutUsage(JSON.parse(tokenRecord(210, 95))),
    observed[1],
  );
  assert.equal(observed[1].cumulative.totalTokens, 210);
  assert.equal(observed[1].context.totalTokens, 95);
  assert.equal(observed[1].contextWindowTokens, 258_400);
});

test("the CLI runs an investigation through the Codex adapter boundary", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-cli-investigation-"));
  const databasePath = join(directory, "audit.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun({
    targetRepositoryPath: repositoryRoot,
    repositoryIdentity: "waymark-cli-test",
    commitSha: "abcdef0123456789",
    task: "Locate a CLI test change surface",
    participants: [
      { role: "orchestrator", provider: "openai", model: "orchestrator" },
      { role: "candidate", provider: "openai", model: "candidate" },
    ],
    toolPolicy: { target: "read-only" },
    runConditions: {
      tokenBudgets: {
        candidate_navigation: {
          targetTokens: 100,
          hardLimitTokens: 500,
        },
      },
    },
    protocolVersion: "1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  });
  store.close();

  const cli = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      databasePath,
      "investigation",
      "run",
      "--run",
      run.id,
      "--codex-entry",
      fakeProviderPath,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
  const output = JSON.parse(cli.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.command, "investigation run");
  assert.equal(output.data.status, "active");

  const reopened = new AuditStore({ databasePath });
  try {
    const report = reopened.readReport(run.id);
    assert.equal(report.run.status, "active");
    assert.equal(
      report.events.some(({ type }) => type === "investigation.completed"),
      true,
    );
    assert.equal(
      report.events.some(({ type }) => type === "orchestration.completed"),
      true,
    );
    reopened.recordVerification({
      runId: run.id,
      claimId: report.claims[0].id,
      verifier: "orchestrator",
      method: "static_inspection",
      verdict: "verified",
      evidence: {
        citationStatus: "valid",
        independentAssessment: "not_checked",
      },
    });
  } finally {
    reopened.close();
  }

  const finalize = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      databasePath,
      "report",
      "finalize",
      "--run",
      run.id,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.equal(finalize.status, 0, `${finalize.stderr}\n${finalize.stdout}`);
  const finalizeOutput = JSON.parse(finalize.stdout);
  assert.equal(finalizeOutput.ok, true);
  assert.equal(finalizeOutput.command, "report finalize");
  assert.equal(finalizeOutput.data.type, "report.recommendations");
});
