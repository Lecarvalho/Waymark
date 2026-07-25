import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
    journalPath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
    serviceUrl: "http://127.0.0.1:4318",
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

function preparedGeneralInput() {
  return {
    targetRepositoryPath: "C:\\work\\target",
    journalPath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
    serviceUrl: "http://127.0.0.1:4318",
    auditMode: "general",
    task: "",
    participants: {
      auditor: {
        provider: "openai",
        model: "auditor-model",
        reasoningEffort: "ultra",
      },
    },
    tokenPolicy: "unbounded_by_waymark",
    softUsageNoticeTokens: null,
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

  assert.equal(capabilities.schemaVersion, "1.3.0");
  assert.deepEqual(
    capabilities.auditModes.map(({ id }) => id),
    ["general", "task_specific", "system_explanation"],
  );
  assert.deepEqual(
    capabilities.auditModes.find(({ id }) => id === "general"),
    {
      id: "general",
      label: "General repository audit",
      taskRequired: false,
      description: "Broad, evidence-led repository research by one auditor.",
      probeLabel: null,
      probePlaceholder: null,
      participantRoles: ["auditor"],
      tokenPolicy: "unbounded_by_waymark",
    },
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
      participantRoles: ["candidate", "independent", "orchestrator"],
      tokenPolicy: "hard_phase_budgets",
    },
  );
  assert.equal(capabilities.providers.length, 1);
  assert.equal(capabilities.providers[0].available, true);
  assert.equal(capabilities.providers[0].adapterId, "codex");
  assert.deepEqual(capabilities.providers[0].roles, [
    "auditor",
    "candidate",
    "independent",
    "orchestrator",
  ]);
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
    {
      source: "rubric_default",
      sampleSize: 0,
      historicalAverageTokens: null,
      cappedToRubricDefault: false,
      usedForTarget: false,
      minimumSampleSize: 3,
    },
  );
});

test("provider capabilities derive automatic token targets from completed-run averages", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-capability-budget-"));
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: createFakeCodexEntry(directory),
    environment: {},
    historicalTokenAverages: {
      candidate_navigation: {
        averageTokens: 9_000,
        sampleSize: 4,
      },
    },
  });

  assert.deepEqual(capabilities.tokenBudgetDefaults.candidate_navigation, {
    targetTokens: 9_000,
    hardLimitTokens: 18_000,
  });
  assert.deepEqual(capabilities.tokenBudgetBasis.candidate_navigation, {
    source: "historical_average",
    sampleSize: 4,
    historicalAverageTokens: 9_000,
    cappedToRubricDefault: false,
    usedForTarget: true,
    minimumSampleSize: 3,
  });
  assert.deepEqual(capabilities.tokenBudgetBasis.independent_validation, {
    source: "rubric_default",
    sampleSize: 0,
    historicalAverageTokens: null,
    cappedToRubricDefault: false,
    usedForTarget: false,
    minimumSampleSize: 3,
  });
});

test("historical outliers cannot inflate automatic token budgets", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-capability-cap-"));
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: createFakeCodexEntry(directory),
    environment: {},
    historicalTokenAverages: {
      candidate_navigation: {
        averageTokens: 232_919,
        sampleSize: 1,
      },
      independent_validation: {
        averageTokens: 254_751,
        sampleSize: 1,
      },
    },
  });

  assert.deepEqual(capabilities.tokenBudgetDefaults.candidate_navigation, {
    targetTokens: 12_000,
    hardLimitTokens: 24_000,
  });
  assert.deepEqual(capabilities.tokenBudgetDefaults.independent_validation, {
    targetTokens: 24_000,
    hardLimitTokens: 48_000,
  });
  assert.deepEqual(capabilities.tokenBudgetBasis.candidate_navigation, {
    source: "historical_average",
    sampleSize: 1,
    historicalAverageTokens: 232_919,
    cappedToRubricDefault: true,
    usedForTarget: false,
    minimumSampleSize: 3,
  });
});

test("one low-cost run cannot prematurely lower automatic token budgets", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-capability-sample-"));
  const capabilities = discoverProviderCapabilities({
    codexEntryPath: createFakeCodexEntry(directory),
    environment: {},
    historicalTokenAverages: {
      candidate_navigation: {
        averageTokens: 4_000,
        sampleSize: 1,
      },
    },
  });

  assert.deepEqual(capabilities.tokenBudgetDefaults.candidate_navigation, {
    targetTokens: 12_000,
    hardLimitTokens: 24_000,
  });
  assert.equal(
    capabilities.tokenBudgetBasis.candidate_navigation.usedForTarget,
    false,
  );
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

test("prepared audit prompts are deterministic, concise, and preparation-only", () => {
  const first = buildPreparedAuditRequest(preparedInput());
  const second = buildPreparedAuditRequest(preparedInput());

  assert.equal(first, second);
  assert.match(first, /Run \$waymark-audit/);
  assert.match(first, /C:\\\\work\\\\target/);
  assert.match(first, /Expected journal:/);
  assert.match(
    first,
    /Task: "Add partial refunds with manager approval and idempotency\."/,
  );
  assert.match(first, /candidate-model/);
  assert.match(first, /reasoning=xhigh/);
  assert.match(first, /candidate_navigation=12000\/24000/);
  assert.match(first, /Create one new run/);
  assert.match(first, /preparing it did not start a run/);
  assert.doesNotMatch(first, /Name:/);
  assert.doesNotMatch(first, /Required safeguards:/);
  assert.doesNotMatch(first, /verificationPolicy/);
  assert.doesNotMatch(first, /fresh-process launcher/);
  assert.ok(first.length < 1_100, `prepared prompt is ${first.length} characters`);
});

test("prepared general audits select one auditor without benchmark budgets", () => {
  const prompt = buildPreparedAuditRequest(preparedGeneralInput());
  assert.match(prompt, /Mode: general/);
  assert.match(
    prompt,
    /auditor: provider=openai; model=auditor-model; reasoning=ultra/,
  );
  assert.match(prompt, /Token policy: unbounded_by_waymark/);
  assert.match(prompt, /Token usage: measured/);
  assert.match(prompt, /Soft usage notice: none/);
  assert.match(prompt, /Create one new general run with this auditor/);
  assert.doesNotMatch(prompt, /candidate:/);
  assert.doesNotMatch(prompt, /independent:/);
  assert.doesNotMatch(prompt, /orchestrator:/);
  assert.doesNotMatch(prompt, /Token budgets/);
  assert.doesNotMatch(prompt, /hard/i);
  assert.doesNotMatch(prompt, /waymark-general-navigation/);
  assert.doesNotMatch(prompt, /Orientation: locate the repository map/);
  assert.doesNotMatch(prompt, /Task:/);
  assert.doesNotMatch(prompt, /Question:/);
  assert.doesNotMatch(prompt, /Name:/);
});

test("general preparation ignores stale benchmark selections when modes switch", () => {
  const input = {
    ...preparedGeneralInput(),
    participants: {
      ...preparedInput().participants,
      ...preparedGeneralInput().participants,
    },
    tokenBudgets: preparedInput().tokenBudgets,
  };

  const prompt = buildPreparedAuditRequest(input);
  assert.match(prompt, /auditor-model/);
  assert.doesNotMatch(
    prompt,
    /candidate-model|research-model|orchestrator-model/,
  );
  assert.doesNotMatch(prompt, /candidate_navigation|hardLimitTokens/);
});

test("general preparation retains an optional non-stopping usage notice", () => {
  const input = preparedGeneralInput();
  input.softUsageNoticeTokens = 80_000;

  const prompt = buildPreparedAuditRequest(input);
  assert.match(prompt, /Soft usage notice: 80000 tokens/);
  assert.match(prompt, /Token policy: unbounded_by_waymark/);
});

test("the audit skill owns the single-auditor general contract", () => {
  const skill = readFileSync(
    new URL("../.agents/skills/waymark-audit/SKILL.md", import.meta.url),
    "utf8",
  );
  const protocol = readFileSync(
    new URL(
      "../.agents/skills/waymark-audit/references/protocol.md",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(skill, /exactly one `auditor`/);
  assert.match(skill, /does not use a versioned benchmark task suite/);
  assert.match(skill, /unbounded_by_waymark/);
  assert.match(skill, /documentation.+cannot be the only evidence/is);
  assert.match(protocol, /General terminal outcomes/);
  assert.match(protocol, /`completed`[\s\S]+`partial`[\s\S]+`failed`[\s\S]+`cancelled`/);
  assert.match(protocol, /`auditor_assessed`/);
  assert.match(protocol, /scorer do\s+not score general mode/);
});

test("general mode reaches fresh roles as a seven-principle assessment", () => {
  const [assignment] = createInvestigationAssignments({
    runId: "general-run",
    auditMode: "general",
    target: {
      path: "C:\\work\\target",
      identity: "target",
      commitSha: "0123456789abcdef",
      readOnly: true,
    },
    task: "Versioned general repository suite",
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
  assert.match(prompt, /Audit mode: general/);
  assert.match(prompt, /cold, repository-wide agent-readiness assessment/);
  assert.match(prompt, /all seven Practice Guide principles/);
  assert.match(prompt, /exactly one practiceAssessments item/);
  assert.match(prompt, /generated\/external code boundaries/);
});

test("prepared system explanations measure finding cost instead of prose depth", () => {
  const input = preparedInput();
  input.auditMode = "system_explanation";
  input.task = "How are refunds approved?";

  const prompt = buildPreparedAuditRequest(input);
  assert.match(prompt, /Mode: system_explanation/);
  assert.match(prompt, /Question: "How are refunds approved\?"/);
  assert.doesNotMatch(prompt, /runConditions/);
  assert.doesNotMatch(prompt, /prose depth/);
  assert.doesNotMatch(prompt, /Task:/);
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

test("prepared general requests require their unbounded token policy", () => {
  const input = preparedGeneralInput();
  input.tokenPolicy = "hard_phase_budgets";

  assert.throws(
    () => buildPreparedAuditRequest(input),
    /tokenPolicy must be unbounded_by_waymark/,
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
