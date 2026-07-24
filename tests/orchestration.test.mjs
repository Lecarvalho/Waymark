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

function createRun(
  store,
  {
    independent = true,
    candidateHardLimit = 500,
    candidateCommandBudget = 6,
  } = {},
) {
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
    toolPolicy: {
      target: "read-only",
      allowed: ["read files"],
      forbidden: ["editing target files"],
    },
    runConditions: {
      candidateReasoningEffort: "low",
      independentReasoningEffort: "high",
      execution: {
        isolation: "fresh_process",
        sessionPersistence: "ephemeral",
        contextPolicy: "assignment_only",
        measurementScope: "role_process_only",
        shellCommandBudget: {
          candidate: candidateCommandBudget,
          independent: 8,
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
          ...(assignment.context?.claims?.[0]?.id
            ? [assignment.context.claims[0].id]
            : []),
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
  assert.equal(report.events.at(-1).type, "phase.changed");
  assert.equal(report.events.at(-1).payload.progress, 65);
  assert.equal(report.tokens.length, 3);
  assert.equal(report.aggregates.tokensByPhase.candidate_navigation, 80);
  assert.equal(report.aggregates.tokensByPhase.independent_validation, 100);
  assert.equal(report.aggregates.tokensByPhase.orchestration, 120);
  assert.ok(report.tokens.every(({ source }) => source === "measured"));
  assert.equal(report.claims.length, 1);
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
    adapters: [fakeAdapter({ candidate: "command-over-budget" })],
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
});

test("candidate evidence import rejects findings that are not repository facts", async (t) => {
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
  assert.equal(result.failure.error.code, "CANDIDATE_FINDING_KIND_REQUIRED");
  const report = store.readReport(run.id);
  assert.equal(report.run.status, "failed");
  assert.equal(report.claims.length, 0);
  assert.equal(
    report.events.some(
      ({ type, payload }) =>
        type === "orchestration.failed" &&
        payload.error?.code === "CANDIDATE_FINDING_KIND_REQUIRED",
    ),
    true,
  );
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
