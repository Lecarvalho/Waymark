import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startWaymarkServer } from "../server/waymark-server.mjs";
import {
  buildPreparedAuditRequest,
  inferAuditName,
} from "../src/orchestration/prepare-audit-request.mjs";
import { discoverProviderCapabilities } from "../src/orchestration/provider-capabilities.mjs";
import {
  createInvestigationAssignments,
  renderAssignmentPrompt,
} from "../src/orchestration/templates.mjs";
import { AuditStore } from "../src/persistence/index.mjs";

function createFakeCodexEntry(directory) {
  const entryPath = join(directory, "codex.js");
  writeFileSync(entryPath, "#!/usr/bin/env node\n", "utf8");
  return entryPath;
}

function preparedInput() {
  return {
    targetRepositoryPath: "C:\\work\\target",
    auditMode: "task_specific",
    task: "Add partial refunds with manager approval and idempotency.",
    participants: {
      candidate: {
        provider: "openai",
        model: "candidate-model",
        reasoningEffort: "high",
      },
      independent: {
        provider: "openai",
        model: "research-model",
        reasoningEffort: "medium",
      },
      orchestrator: {
        provider: "openai",
        model: "orchestrator-model",
        reasoningEffort: "xhigh",
      },
    },
    tokenBudgets: {
      candidate_navigation: {
        targetTokens: 12_000,
        hardLimitTokens: 24_000,
      },
      independent_validation: {
        targetTokens: 24_000,
        hardLimitTokens: 48_000,
      },
      orchestration: {
        targetTokens: 12_000,
        hardLimitTokens: 24_000,
      },
      deterministic_verification: {
        targetTokens: 6_000,
        hardLimitTokens: 12_000,
      },
      report_generation: {
        targetTokens: 4_000,
        hardLimitTokens: 8_000,
      },
    },
  };
}

test("provider capabilities discover installed adapters and model-specific reasoning", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-capabilities-"));
  const entryPath = createFakeCodexEntry(directory);
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: entryPath,
    environment: {
      WAYMARK_CODEX_MODELS_JSON: JSON.stringify([
        {
          id: "candidate-model",
          label: "Candidate model",
          reasoningEfforts: ["low", "high"],
        },
        {
          id: "orchestrator-model",
          reasoningEfforts: ["medium", "xhigh"],
        },
      ]),
    },
  });

  assert.equal(capabilities.schemaVersion, "1.2.0");
  assert.deepEqual(
    capabilities.auditModes.map(({ id }) => id),
    ["general", "task_specific", "system_explanation"],
  );
  assert.deepEqual(
    capabilities.auditModes.find(({ id }) => id === "system_explanation"),
    {
      id: "system_explanation",
      label: "System explanation",
      taskRequired: true,
      description:
        "Measures the navigation cost of finding a supported answer about existing behavior.",
      probeLabel: "What should the agent find?",
      probePlaceholder: "How are refunds approved?",
    },
  );
  assert.equal(capabilities.providers.length, 1);
  assert.equal(capabilities.providers[0].available, true);
  assert.equal(capabilities.providers[0].adapterId, "codex");
  assert.deepEqual(capabilities.providers[0].models[0], {
    id: "candidate-model",
    label: "Candidate model",
    reasoningEfforts: ["low", "high"],
  });
  assert.deepEqual(capabilities.providers[0].models[1].reasoningEfforts, [
    "medium",
    "xhigh",
  ]);
  assert.equal(
    capabilities.tokenBudgetDefaults.candidate_navigation.hardLimitTokens,
    24_000,
  );
  assert.deepEqual(
    capabilities.tokenBudgetBasis.candidate_navigation,
    { source: "rubric_default", sampleSize: 0 },
  );
});

test("provider capabilities derive automatic token targets from completed-run averages", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-capability-budget-"));
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: createFakeCodexEntry(directory),
    environment: {},
    historicalTokenAverages: {
      candidate_navigation: {
        averageTokens: 15_250,
        sampleSize: 4,
      },
    },
  });

  assert.deepEqual(capabilities.tokenBudgetDefaults.candidate_navigation, {
    targetTokens: 15_250,
    hardLimitTokens: 30_500,
  });
  assert.deepEqual(capabilities.tokenBudgetBasis.candidate_navigation, {
    source: "historical_average",
    sampleSize: 4,
  });
  assert.deepEqual(capabilities.tokenBudgetBasis.independent_validation, {
    source: "rubric_default",
    sampleSize: 0,
  });
});

test("provider capability failure remains explicit and exposes no model catalog", () => {
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: join(tmpdir(), "missing-waymark-codex.js"),
    environment: {},
  });

  assert.equal(capabilities.providers[0].available, false);
  assert.match(
    capabilities.providers[0].unavailableReason,
    /not available/i,
  );
  assert.deepEqual(capabilities.providers[0].models, []);
});

test("default Codex capabilities expose every locally supported model", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-default-models-"));
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: createFakeCodexEntry(directory),
    environment: {},
  });
  const models = capabilities.providers[0].models;

  assert.deepEqual(
    models.map(({ id }) => id),
    [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ],
  );
  assert.deepEqual(
    models.find(({ id }) => id === "gpt-5.6-luna")?.reasoningEfforts,
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.deepEqual(
    models.find(({ id }) => id === "gpt-5.6-sol")?.reasoningEfforts,
    ["low", "medium", "high", "xhigh", "max", "ultra"],
  );
  assert.deepEqual(
    models.find(({ id }) => id === "gpt-5.4-mini")?.reasoningEfforts,
    ["low", "medium", "high", "xhigh"],
  );
});

test("prepared audit prompts are deterministic, self-contained, and preparation-only", () => {
  const first = buildPreparedAuditRequest(preparedInput());
  const second = buildPreparedAuditRequest(preparedInput());

  assert.equal(first, second);
  assert.match(first, /Use \$waymark-audit/);
  assert.match(first, /C:\\\\work\\\\target/);
  assert.match(
    first,
    /Concise name: "Add partial refunds with manager approval and idempotency"/,
  );
  assert.match(first, /candidate-model/);
  assert.match(first, /reasoning=xhigh/);
  assert.match(first, /candidate_navigation: target=12000; hard_limit=24000/);
  assert.match(first, /final 20% .* reserved for reporting/i);
  assert.match(first, /resume the same provider session/i);
  assert.match(first, /final 20% .* reserved for reporting/i);
  assert.match(first, /resume the same provider session/i);
  assert.match(first, /fresh assignment-only role processes/);
  assert.match(first, /preparing or copying it in Waymark did not create or start a run/);
  assert.match(first, /immutable repository identity and commit/);
});

test("prepared general audits require the versioned suite instead of a task", () => {
  const input = preparedInput();
  input.auditMode = "general";
  input.task = "";

  const prompt = buildPreparedAuditRequest(input);
  assert.match(prompt, /waymark-general-navigation@1\.0\.0/);
  assert.match(prompt, /Concise name: "General repository navigation"/);
  assert.match(prompt, /Orientation: locate the repository map/);
  assert.match(prompt, /Verification discovery: locate the documented validation command/);
  assert.match(prompt, /Do not invent a feature request/);
  assert.doesNotMatch(prompt, /Use this engineering task verbatim/);
});

test("prepared system explanations measure finding cost instead of prose depth", () => {
  const input = preparedInput();
  input.auditMode = "system_explanation";
  input.task = "How are refunds approved?";

  const prompt = buildPreparedAuditRequest(input);
  assert.match(prompt, /Audit mode: system_explanation/);
  assert.match(
    prompt,
    /Record runConditions\.auditMode as "system_explanation"/,
  );
  assert.match(prompt, /Use this short system question verbatim/);
  assert.match(prompt, /prose length is not the objective/);
  assert.match(prompt, /navigation tokens, searches, file hops, dead ends/);
  assert.match(prompt, /Do not propose or implement a feature change/);
  assert.match(prompt, /Do not treat missing hypothetical change-surface recall as a failure/);
  assert.doesNotMatch(prompt, /Use this engineering task verbatim/);
});

test("system-explanation mode reaches fresh role assignments", () => {
  const [assignment] = createInvestigationAssignments({
    runId: "explanation-run",
    auditMode: "system_explanation",
    target: {
      path: "C:\\work\\target",
      identity: "target",
      commitSha: "0123456789abcdef",
      readOnly: true,
    },
    task: "How are refunds approved?",
    candidate: {
      role: "candidate",
      provider: "openai",
      model: "candidate-model",
    },
    capabilities: {
      parallelAgents: false,
      independentResearcher: null,
    },
  });

  const prompt = renderAssignmentPrompt(assignment);
  assert.match(prompt, /Audit mode: system_explanation/);
  assert.match(prompt, /Explanation question: How are refunds approved/);
  assert.match(prompt, /primary measurement is navigation cost/);
  assert.match(prompt, /Do not treat hypothetical change-surface recall/);
});

test("audit names are inferred from the first concise task thought", () => {
  assert.equal(
    inferAuditName({
      auditMode: "task_specific",
      task: "Add partial refunds with manager approval. Preserve idempotency.",
    }),
    "Add partial refunds with manager approval",
  );
  assert.equal(
    inferAuditName({
      auditMode: "general",
      task: "",
    }),
    "General repository navigation",
  );
  assert.ok(
    inferAuditName({
      auditMode: "task_specific",
      task: "Trace a deliberately long navigation probe across repository ownership boundaries, indirect consumers, verification workflows, and scoped instructions.",
    }).length <= 72,
  );
});

test("prepared audit requests reject invalid hard limits", () => {
  const input = preparedInput();
  input.tokenBudgets.candidate_navigation.hardLimitTokens = 11_999;

  assert.throws(
    () => buildPreparedAuditRequest(input),
    /hardLimitTokens must be an integer at least as large as targetTokens/,
  );
});

test("read-only service exposes capabilities without creating an audit run", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-capability-service-"));
  const databasePath = join(directory, "waymark.sqlite");
  const entryPath = createFakeCodexEntry(directory);
  const service = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
    providerCapabilityOptions: {
      codexEntryPath: entryPath,
      environment: {
        WAYMARK_CODEX_MODELS_JSON: JSON.stringify([
          {
            id: "local-model",
            reasoningEfforts: ["medium"],
          },
        ]),
      },
    },
  });
  t.after(() => service.close());

  const response = await fetch(`${service.url}/api/provider-capabilities`);
  assert.equal(response.status, 200);
  const capabilities = await response.json();
  assert.equal(capabilities.providers[0].models[0].id, "local-model");
  assert.equal(
    capabilities.auditModes.some(({ id }) => id === "system_explanation"),
    true,
  );

  const invalidMode = await fetch(
    `${service.url}/api/provider-capabilities?auditMode=unknown`,
  );
  assert.equal(invalidMode.status, 400);
  assert.deepEqual(await invalidMode.json(), {
    error: "invalid_audit_mode",
  });

  const mutation = await fetch(`${service.url}/api/provider-capabilities`, {
    method: "POST",
    body: "{}",
    headers: { "content-type": "application/json" },
  });
  assert.equal(mutation.status, 405);
  assert.deepEqual(await mutation.json(), { error: "read_only_service" });

  await service.close();
  const store = new AuditStore({ databasePath });
  t.after(() => store.close());
  assert.deepEqual(store.listRuns({ limit: 10 }), []);
});
