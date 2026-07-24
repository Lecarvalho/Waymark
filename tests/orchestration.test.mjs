import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import test from "node:test";

import {
  createCodexProcessAdapter,
  extractCodexFinalOutput,
  extractCodexUsage,
  normalizeCodexEvent,
} from "../src/orchestration/codex-adapter.mjs";
import { runInvestigationPhase } from "../src/orchestration/process-runner.mjs";
import { AuditStore } from "../src/persistence/index.mjs";

const repositoryRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fakeProviderPath = fileURLToPath(
  new URL("../fixtures/providers/fake-jsonl-provider.mjs", import.meta.url),
);

function createRun(store, { independent = true, candidateHardLimit = 500 } = {}) {
  return store.createRun({
    targetRepositoryPath: repositoryRoot,
    repositoryIdentity: "waymark-test",
    commitSha: "0123456789abcdef",
    task: "Locate the owner and change surface for a test feature",
    participants: [
      { role: "orchestrator", provider: "fake", model: "orchestrator" },
      { role: "candidate", provider: "fake", model: "candidate" },
      ...(independent
        ? [{ role: "independent", provider: "fake", model: "independent" }]
        : []),
    ],
    toolPolicy: { target: "read-only" },
    runConditions: {
      execution: {
        isolation: "fresh_process",
        sessionPersistence: "ephemeral",
        contextPolicy: "assignment_only",
        measurementScope: "role_process_only",
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

function fakeAdapter(modeByRole = {}, usageEnforcement = "post_completion") {
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
        ],
        cwd: assignment.target.path,
        stdin: prompt,
      };
    },
    extractUsage: extractCodexUsage,
    extractFinalOutput: extractCodexFinalOutput,
    normalizeEvent: normalizeCodexEvent,
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
    report.events.slice(0, 2).map(({ actor, type }) => ({ actor, type })),
    [
      { actor: "candidate", type: "investigation.started" },
      { actor: "independent", type: "investigation.started" },
    ],
  );
  assert.equal(
    report.events.filter(({ type }) => type === "provider.tool.completed").length,
    2,
  );
  assert.equal(
    report.events.filter(({ type }) => type === "investigation.completed").length,
    2,
  );
  assert.equal(report.events.at(-1).type, "phase.changed");
  assert.equal(report.tokens.length, 2);
  assert.equal(report.aggregates.tokensByPhase.candidate_navigation, 80);
  assert.equal(report.aggregates.tokensByPhase.independent_validation, 100);
  assert.ok(report.tokens.every(({ source }) => source === "measured"));
});

test("a completion-only token overrun is persisted and disqualifies the run", async (t) => {
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

  assert.equal(result.status, "failed");
  assert.equal(result.results[0].status, "budget_exceeded");
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "failed");
  assert.equal(report.aggregates.tokensByPhase.candidate_navigation, 110);
  const exceeded = report.events.find(({ type }) => type === "budget.exceeded");
  assert.equal(exceeded.payload.hardLimitTokens, 100);
  assert.equal(exceeded.payload.observedTokens, 110);
  assert.equal(exceeded.payload.enforcement, "post_completion");
  assert.equal(exceeded.payload.calibrationEligible, false);
  assert.equal(report.events.at(-1).type, "run.finished");
  assert.equal(report.events.at(-1).payload.summary.calibrationEligible, false);
});

test("a provider with live usage is interrupted at its hard limit", async (t) => {
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

  assert.equal(result.status, "failed");
  const report = store.readReport(run.id);
  const exceeded = report.events.find(({ type }) => type === "budget.exceeded");
  assert.equal(exceeded.payload.enforcement, "live_stream_interrupt");
  assert.equal(exceeded.payload.observedTokens, 110);
});

test("the Codex adapter uses the JavaScript entry point and isolated exec flags", () => {
  const adapter = createCodexProcessAdapter({ entryPath: fakeProviderPath });
  const launch = adapter.createLaunchSpec(
    {
      runId: "run-1",
      role: "candidate",
      participant: {
        role: "candidate",
        provider: "openai",
        model: "gpt-test",
      },
      target: {
        path: repositoryRoot,
        identity: "waymark",
        commitSha: "abc123",
        readOnly: true,
      },
      task: "Inspect the repository",
      executionPolicy: {
        isolation: "fresh_process",
        sessionPersistence: "ephemeral",
        contextPolicy: "assignment_only",
        measurementScope: "role_process_only",
      },
      tokenBudget: { targetTokens: 100, hardLimitTokens: 200 },
      constraints: [],
      expectedEvidence: [],
    },
    "assignment only",
  );

  assert.equal(launch.command, process.execPath);
  assert.equal(launch.arguments[0], fakeProviderPath);
  assert.ok(launch.arguments.includes("--ephemeral"));
  assert.ok(launch.arguments.includes("--ignore-user-config"));
  assert.ok(launch.arguments.includes("--json"));
  assert.deepEqual(
    launch.arguments.slice(
      launch.arguments.indexOf("--sandbox"),
      launch.arguments.indexOf("--sandbox") + 2,
    ),
    ["--sandbox", "read-only"],
  );
  assert.equal(launch.arguments.at(-1), "-");
  assert.equal(launch.stdin, "assignment only");

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
  } finally {
    reopened.close();
  }
});
