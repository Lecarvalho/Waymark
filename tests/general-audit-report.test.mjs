import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";

import {
  GeneralAuditProjectionError,
  projectGeneralAudit,
} from "../src/domain/general-audit.mjs";
import { AuditStore } from "../src/persistence/index.mjs";
import { assembleGeneralAuditReport } from "../src/reporting/general-audit-report.mjs";

const run = {
  id: "general-report-run",
  repositoryIdentity: "team/payments",
  commitSha: "0123456789abcdef",
  protocolVersion: "general-audit-contract/1.0.0",
  rubricVersion: "waymark-navigability/1.0.0",
  status: "active",
  runConditions: { auditMode: "general" },
};

function citation(source = "production_code", path = "src/payments/owner.ts") {
  return {
    path,
    startLine: 10,
    endLine: 20,
    symbol: "PaymentOwner",
    source,
  };
}

function event(sequence, type, payload) {
  return {
    id: `event-${sequence}`,
    runId: run.id,
    sequence,
    actor: "general-report-auditor",
    type,
    payload,
    occurredAt: `2026-07-25T16:${String(sequence).padStart(2, "0")}:00.000Z`,
  };
}

function started() {
  return event(1, "general.audit.started", {
    repositoryIdentity: run.repositoryIdentity,
    commitSha: run.commitSha,
    protocolVersion: run.protocolVersion,
  });
}

function findingRevision({
  findingId,
  signal = "positive",
  state = "confirmed",
  dimensionId,
  source = "production_code",
  path,
  revisionNumber = 1,
  previousRevisionId = null,
  amendmentReason = null,
  occurredAt,
}) {
  const evidence = citation(source, path);
  return {
    revisionId: `${findingId}-revision-${revisionNumber}`,
    findingId,
    revisionNumber,
    state,
    signal,
    title: `${findingId} title`,
    conclusion: `${findingId} evidence-backed conclusion`,
    dimensionIds: [dimensionId],
    practiceGuideIds: ["organizeAroundBehavior"],
    citations: [evidence],
    navigationCost:
      revisionNumber === 1
        ? {
            searches: 3,
            filesOpened: 4,
            fileHops: 2,
            deadEnds: 1,
            commands: 3,
            processedTokens: 900,
            elapsedMs: 30_000,
          }
        : null,
    provenance: {
      previousRevisionId,
      amendmentReason,
      actor: "general-report-auditor",
      occurredAt,
      causedByCitations: [evidence],
    },
  };
}

function reportFrom(events, tokens = []) {
  return assembleGeneralAuditReport({
    run,
    ledger: projectGeneralAudit(events),
    tokens,
  });
}

function completePositiveEvents() {
  const dimensions = [
    ["discoveryEfficiency", "workflow", "package.json"],
    ["ownershipClarity", "production_code", "src/payments/owner.ts"],
    ["dependencyClarity", "production_code", "src/payments/dependencies.ts"],
    ["changeSurfaceRecall", "test", "tests/payments.test.mjs"],
    [
      "verificationDiscoverability",
      "workflow",
      ".github/workflows/test.yml",
    ],
    ["instructionQuality", "instruction", "AGENTS.md"],
  ];
  const events = [started()];
  let sequence = 2;
  for (const [dimensionId, source, path] of dimensions) {
    const findingId = `positive-${dimensionId}`;
    const occurredAt = `2026-07-25T16:${String(sequence).padStart(2, "0")}:00.000Z`;
    events.push(
      event(sequence++, "general.finding.recorded", {
        revision: findingRevision({
          findingId,
          dimensionId,
          source,
          path,
          occurredAt,
        }),
      }),
    );
    events.push(
      event(sequence++, "general.dimension.assessed", {
        dimensionId,
        score: 90,
        confidence: 0.9,
        supportingPositiveFindingIds: [findingId],
        supportingFrictionFindingIds: [],
        limitations: [],
      }),
    );
  }
  events.push(
    event(sequence, "general.synthesis.completed", {
      outcome: "completed",
      summary: "All required dimensions have adequate cited evidence.",
      limitations: [],
    }),
  );
  return events;
}

test("a complete all-positive ledger produces a fixed auditor-assessed result", () => {
  const report = reportFrom(completePositiveEvents(), [
    {
      id: "general-token",
      runId: run.id,
      eventId: null,
      actor: "general-report-auditor",
      phase: "general_research",
      source: "provider_reported",
      provider: "openai",
      model: "auditor",
      inputTokens: 900,
      outputTokens: 100,
      cachedInputTokens: null,
      cacheCreationTokens: null,
      totalTokens: 1000,
      measuredAt: "2026-07-25T16:30:00.000Z",
    },
  ]);

  assert.equal(report.authority, "auditor_assessed");
  assert.deepEqual(report.result, {
    type: "auditor_assessed",
    label: "Auditor-assessed",
    score: 90,
    assessedWeight: 100,
  });
  assert.equal(report.completeness.assessedWeight, 100);
  assert.equal(report.completeness.reportComplete, true);
  assert.equal(report.tokens.totals.totalTokens, 1000);
  assert.equal(report.tokens.hardLimitTokens, null);
  assert.equal(report.tokens.tokenEfficiencyScore, null);
  assert.equal(report.findings.length, 6);
});

test("four assessed dimensions retain exact weight and never produce an overall result", () => {
  const events = completePositiveEvents().slice(0, 9);
  const report = reportFrom(events);

  assert.equal(report.completeness.assessedDimensionCount, 4);
  assert.equal(report.completeness.assessedWeight, 74);
  assert.equal(report.weightedPoints, 66.6);
  assert.equal(report.result, null);
  assert.equal(report.completeness.coverageComplete, false);
  assert.equal(report.completeness.synthesisComplete, false);
  assert.match(
    report.dimensions[4].limitations[0],
    /No adequate assessment has been recorded/,
  );
});

test("documentation-only code evidence stays not assessed in the report", () => {
  const occurredAt = "2026-07-25T16:02:00.000Z";
  const report = reportFrom([
    started(),
    event(2, "general.finding.recorded", {
      revision: findingRevision({
        findingId: "documented-owner",
        dimensionId: "ownershipClarity",
        source: "documentation",
        path: "ARCHITECTURE.md",
        occurredAt,
      }),
    }),
    event(3, "general.dimension.progress", {
      dimensionId: "ownershipClarity",
      confidence: 0.6,
      supportingPositiveFindingIds: ["documented-owner"],
      supportingFrictionFindingIds: [],
      limitations: ["No source or test citation was located."],
    }),
  ]);

  const ownership = report.dimensions.find(
    ({ dimensionId }) => dimensionId === "ownershipClarity",
  );
  assert.equal(ownership.assessmentState, "in_progress");
  assert.equal(ownership.score, null);
  assert.equal(ownership.evidenceCoverage.requirementSatisfied, false);
  assert.equal(report.result, null);
});

test("mixed assessments require cited friction while strong positive assessments do not", () => {
  const occurredAt = "2026-07-25T16:02:00.000Z";
  const positiveEvents = [
    started(),
    event(2, "general.finding.recorded", {
      revision: findingRevision({
        findingId: "positive-discovery",
        dimensionId: "discoveryEfficiency",
        source: "workflow",
        path: "package.json",
        occurredAt,
      }),
    }),
  ];

  assert.throws(
    () =>
      projectGeneralAudit([
        ...positiveEvents,
        event(3, "general.dimension.assessed", {
          dimensionId: "discoveryEfficiency",
          score: 70,
          confidence: 0.8,
          supportingPositiveFindingIds: ["positive-discovery"],
          supportingFrictionFindingIds: [],
          limitations: [],
        }),
      ]),
    (error) =>
      error instanceof GeneralAuditProjectionError &&
      error.code === "non_strong_assessment_requires_friction",
  );
});

test("located-late timelines remain evidence and unsupported recommendations are omitted", () => {
  const firstAt = "2026-07-25T16:02:00.000Z";
  const revisedAt = "2026-07-25T16:03:00.000Z";
  const initial = findingRevision({
    findingId: "late-owner",
    signal: "friction",
    state: "provisional",
    dimensionId: "ownershipClarity",
    occurredAt: firstAt,
  });
  const locatedLate = findingRevision({
    findingId: "late-owner",
    signal: "friction",
    state: "located_late",
    dimensionId: "ownershipClarity",
    revisionNumber: 2,
    previousRevisionId: initial.revisionId,
    amendmentReason: "A consumer trace exposed the owner.",
    occurredAt: revisedAt,
  });
  const events = [
    started(),
    event(2, "general.finding.recorded", { revision: initial }),
    event(3, "general.finding.revised", { revision: locatedLate }),
    event(4, "general.dimension.assessed", {
      dimensionId: "ownershipClarity",
      score: 65,
      confidence: 0.75,
      supportingPositiveFindingIds: [],
      supportingFrictionFindingIds: ["late-owner"],
      limitations: ["Ownership was discoverable only through a consumer trace."],
    }),
    event(5, "general.recommendation.recorded", {
      recommendationId: "name-owner",
      title: "Expose the payment owner",
      rationale: "Reduce repeated ownership searches.",
      findingIds: ["late-owner"],
      dimensionIds: ["ownershipClarity"],
    }),
  ];
  const report = reportFrom(events);

  assert.equal(report.findings[0].revisions.length, 2);
  assert.equal(report.findings[0].currentRevision.state, "located_late");
  assert.equal(report.findings[0].navigationCostHistory.length, 1);
  assert.equal(report.recommendations.length, 1);
  assert.equal(report.completeness.synthesisComplete, false);
  assert.match(report.limitations.at(-1), /synthesis has not been recorded/);
});

test("a recommendation is removed from the current report when its finding is retracted", () => {
  const firstAt = "2026-07-25T16:02:00.000Z";
  const retractedAt = "2026-07-25T16:04:00.000Z";
  const initial = findingRevision({
    findingId: "obsolete-friction",
    signal: "friction",
    state: "confirmed",
    dimensionId: "discoveryEfficiency",
    source: "workflow",
    path: "package.json",
    occurredAt: firstAt,
  });
  const retracted = findingRevision({
    findingId: "obsolete-friction",
    signal: "unknown",
    state: "retracted",
    dimensionId: "discoveryEfficiency",
    source: "workflow",
    path: "package.json",
    revisionNumber: 2,
    previousRevisionId: initial.revisionId,
    amendmentReason: "A canonical command was found in the inspected workflow.",
    occurredAt: retractedAt,
  });
  const report = reportFrom([
    started(),
    event(2, "general.finding.recorded", { revision: initial }),
    event(3, "general.recommendation.recorded", {
      recommendationId: "document-command",
      title: "Document the verification command",
      rationale: "Reduce command discovery work.",
      findingIds: ["obsolete-friction"],
      dimensionIds: ["discoveryEfficiency"],
    }),
    event(4, "general.finding.revised", { revision: retracted }),
  ]);

  assert.equal(report.findings[0].revisions.length, 2);
  assert.equal(report.recommendations.length, 0);
  assert.ok(
    report.limitations.some((limitation) =>
      limitation.includes("1 recommendation(s) were omitted"),
    ),
  );
});

test("a failed provider still yields a useful cited partial report without synthesis", () => {
  const occurredAt = "2026-07-25T16:02:00.000Z";
  const report = reportFrom([
    started(),
    event(2, "general.finding.recorded", {
      revision: findingRevision({
        findingId: "partial-finding",
        signal: "friction",
        state: "confirmed",
        dimensionId: "discoveryEfficiency",
        source: "workflow",
        path: "package.json",
        occurredAt,
      }),
    }),
    event(3, "general.audit.interrupted", {
      outcome: "partial",
      reason: "Provider exited before final synthesis.",
    }),
  ]);

  assert.equal(report.ledgerStatus, "partial");
  assert.equal(report.findings.length, 1);
  assert.equal(report.result, null);
  assert.equal(report.completeness.synthesisComplete, false);
  assert.ok(
    report.limitations.includes("Provider exited before final synthesis."),
  );
});

test("the benchmark scorer refuses a general run before reading observations", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-score-guard-"));
  const databasePath = join(directory, "audit.sqlite");
  const store = new AuditStore({ databasePath });
  store.createRun({
    id: "general-score-guard",
    targetRepositoryPath: process.cwd(),
    repositoryIdentity: "waymark",
    commitSha: "0123456789abcdef",
    task: "Assess repository navigability.",
    participants: [
      {
        id: "general-score-guard-auditor",
        role: "auditor",
        provider: "codex",
        model: "auditor",
      },
    ],
    toolPolicy: { target: "read-only" },
    runConditions: { auditMode: "general" },
    protocolVersion: run.protocolVersion,
    rubricVersion: run.rubricVersion,
  });
  store.close();

  const cli = spawnSync(
    process.execPath,
    [
      "bin/waymark.mjs",
      "--db",
      databasePath,
      "score",
      "calculate",
      "--run",
      "general-score-guard",
      "--finish",
      "--input-json",
      "{}",
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  const output = JSON.parse(cli.stdout);

  assert.equal(cli.status, 1);
  assert.equal(
    output.error.code,
    "GENERAL_AUDIT_NOT_DETERMINISTICALLY_SCORED",
  );
});
