import assert from "node:assert/strict";
import test from "node:test";

import {
  GeneralAuditProjectionError,
  projectGeneralAudit,
} from "../src/domain/general-audit.mjs";

const occurredAt = "2026-07-25T12:00:00.000Z";

function event(sequence, type, payload, overrides = {}) {
  return {
    id: `event-${sequence}`,
    runId: "general-run-1",
    sequence,
    actor: "auditor",
    type,
    occurredAt,
    payload,
    ...overrides,
  };
}

function started(sequence = 1) {
  return event(sequence, "general.audit.started", {
    repositoryIdentity: "example/checkout",
    commitSha: "0123456789abcdef",
    protocolVersion: "general-audit/2.0.0",
  });
}

function citation(
  source,
  path = "src/checkout/submit-order.ts",
  startLine = 10,
) {
  return {
    path,
    startLine,
    endLine: startLine + 4,
    symbol: null,
    source,
  };
}

function navigationCost(overrides = {}) {
  return {
    searches: null,
    filesOpened: null,
    fileHops: null,
    deadEnds: null,
    commands: null,
    processedTokens: null,
    elapsedMs: null,
    ...overrides,
  };
}

function revision({
  findingId,
  revisionNumber = 1,
  revisionId = `${findingId}-revision-${revisionNumber}`,
  previousRevisionId = null,
  amendmentReason = null,
  state = "provisional",
  signal = "friction",
  title = "Focused verification command appears absent",
  conclusion = "No focused verification command was located.",
  dimensionIds = ["verificationDiscoverability"],
  practiceGuideIds = ["canonicalWorkflow"],
  citations = [],
  causedByCitations = [],
  cost = null,
  timestamp = occurredAt,
} = {}) {
  return {
    revisionId,
    findingId,
    revisionNumber,
    state,
    signal,
    title,
    conclusion,
    dimensionIds,
    practiceGuideIds,
    citations,
    navigationCost: cost,
    provenance: {
      previousRevisionId,
      amendmentReason,
      actor: "auditor",
      occurredAt: timestamp,
      causedByCitations,
    },
  };
}

test("a located-late finding preserves its provisional revision and navigation cost", () => {
  const commandCitation = citation(
    "configuration",
    "package.json",
    12,
  );
  const initial = revision({
    findingId: "finding-verification-command",
    cost: navigationCost({
      searches: 4,
      filesOpened: 6,
      fileHops: 5,
      deadEnds: 2,
      commands: 3,
      processedTokens: 2100,
      elapsedMs: 48000,
    }),
  });
  const locatedLate = revision({
    findingId: "finding-verification-command",
    revisionNumber: 2,
    previousRevisionId: initial.revisionId,
    amendmentReason:
      "The command exists in a nested package manifest found after four searches.",
    state: "located_late",
    title: "Focused verification command is difficult to discover",
    conclusion:
      "The command exists, but locating it required four searches and five file hops.",
    citations: [commandCitation],
    causedByCitations: [commandCitation],
  });

  const projection = projectGeneralAudit([
    started(),
    event(2, "general.finding.recorded", { revision: initial }),
    event(3, "general.finding.revised", { revision: locatedLate }),
  ]);
  const finding = projection.findings["finding-verification-command"];

  assert.equal(finding.currentRevision.state, "located_late");
  assert.equal(finding.revisions.length, 2);
  assert.equal(
    finding.revisions[0].conclusion,
    "No focused verification command was located.",
  );
  assert.equal(finding.revisions[1].provenance.previousRevisionId, initial.revisionId);
  assert.equal(finding.navigationCostHistory.length, 1);
  assert.equal(finding.navigationCostHistory[0].observation.searches, 4);
  assert.equal(projection.partialReport.available, true);
  assert.equal(projection.partialReport.revisionCount, 2);
});

test("a revision must reference the current prior revision", () => {
  const initial = revision({ findingId: "finding-owner" });
  const wrongPrior = revision({
    findingId: "finding-owner",
    revisionNumber: 2,
    previousRevisionId: "some-other-revision",
    amendmentReason: "New evidence changed the conclusion.",
    state: "reframed",
  });

  assert.throws(
    () =>
      projectGeneralAudit([
        started(),
        event(2, "general.finding.recorded", { revision: initial }),
        event(3, "general.finding.revised", { revision: wrongPrior }),
      ]),
    (error) =>
      error instanceof GeneralAuditProjectionError &&
      error.code === "wrong_prior_revision",
  );
});

test("documentation-only evidence cannot complete a code-backed dimension", () => {
  const documentationCitation = citation(
    "documentation",
    "docs/architecture.md",
    20,
  );
  const ownerFinding = revision({
    findingId: "finding-owner",
    state: "confirmed",
    signal: "positive",
    title: "Checkout ownership is documented",
    conclusion: "The architecture guide names the checkout owner.",
    dimensionIds: ["ownershipClarity"],
    practiceGuideIds: ["conceptOwningNames"],
    citations: [documentationCitation],
    causedByCitations: [documentationCitation],
  });
  const progress = event(3, "general.dimension.progress", {
    dimensionId: "ownershipClarity",
    confidence: 0.6,
    supportingPositiveFindingIds: ["finding-owner"],
    supportingFrictionFindingIds: [],
    limitations: ["No production-code or test citation has been located."],
  });
  const events = [
    started(),
    event(2, "general.finding.recorded", { revision: ownerFinding }),
    progress,
  ];
  const projection = projectGeneralAudit(events);
  const ownership = projection.dimensions.ownershipClarity;

  assert.equal(ownership.assessmentState, "in_progress");
  assert.equal(ownership.score, null);
  assert.equal(ownership.evidenceCoverage.bySource.documentation, 1);
  assert.equal(ownership.evidenceCoverage.codeOrTestCitationCount, 0);
  assert.equal(ownership.evidenceCoverage.requirementSatisfied, false);
  assert.equal(ownership.evidenceCoverage.state, "insufficient");

  assert.throws(
    () =>
      projectGeneralAudit([
        ...events,
        event(4, "general.dimension.assessed", {
          ...progress.payload,
          score: 82,
        }),
      ]),
    (error) =>
      error instanceof GeneralAuditProjectionError &&
      error.code === "insufficient_dimension_evidence",
  );
});

test("partial dimension assessments expose assessed weight without normalization", () => {
  const sourceCitation = citation("production_code");
  const instructionCitation = citation(
    "instruction",
    "AGENTS.md",
    1,
  );
  const ownerFinding = revision({
    findingId: "finding-owner",
    state: "confirmed",
    signal: "positive",
    title: "Checkout behavior has a named owner",
    conclusion: "The checkout module owns order submission.",
    dimensionIds: ["ownershipClarity"],
    practiceGuideIds: ["organizeAroundBehavior", "conceptOwningNames"],
    citations: [sourceCitation],
    causedByCitations: [sourceCitation],
  });
  const instructionFinding = revision({
    findingId: "finding-instructions",
    state: "confirmed",
    signal: "positive",
    title: "Repository instructions are explicit",
    conclusion: "Repository instructions identify the canonical checks.",
    dimensionIds: ["instructionQuality"],
    practiceGuideIds: ["proximateInstructions", "canonicalWorkflow"],
    citations: [instructionCitation],
    causedByCitations: [instructionCitation],
  });

  const projection = projectGeneralAudit([
    started(),
    event(2, "general.finding.recorded", { revision: ownerFinding }),
    event(3, "general.finding.recorded", { revision: instructionFinding }),
    event(4, "general.dimension.assessed", {
      dimensionId: "ownershipClarity",
      score: 80,
      confidence: 0.9,
      supportingPositiveFindingIds: ["finding-owner"],
      supportingFrictionFindingIds: [],
      limitations: [],
    }),
    event(5, "general.dimension.assessed", {
      dimensionId: "instructionQuality",
      score: 90,
      confidence: 0.95,
      supportingPositiveFindingIds: ["finding-instructions"],
      supportingFrictionFindingIds: [],
      limitations: [],
    }),
  ]);

  assert.equal(projection.assessedWeight, 27);
  assert.equal(projection.weightedPoints, 22.6);
  assert.equal(projection.auditorAssessedResult, null);
  assert.equal(projection.dimensions.discoveryEfficiency.score, null);
  assert.equal(
    projection.dimensions.discoveryEfficiency.assessmentState,
    "not_assessed",
  );
});

test("contradicted support stays in history but cannot support the current assessment", () => {
  const sourceCitation = citation("production_code");
  const initial = revision({
    findingId: "finding-owner",
    state: "confirmed",
    signal: "positive",
    title: "Checkout behavior has a named owner",
    conclusion: "The checkout module owns order submission.",
    dimensionIds: ["ownershipClarity"],
    practiceGuideIds: ["conceptOwningNames"],
    citations: [sourceCitation],
    causedByCitations: [sourceCitation],
  });
  const contradictionCitation = citation(
    "production_code",
    "src/orders/submit-order.ts",
    30,
  );
  const contradicted = revision({
    findingId: "finding-owner",
    revisionNumber: 2,
    previousRevisionId: initial.revisionId,
    amendmentReason: "A second production path owns the write boundary.",
    state: "contradicted",
    signal: "unknown",
    title: "Checkout ownership is split",
    conclusion: "The original single-owner conclusion is contradicted.",
    dimensionIds: ["ownershipClarity"],
    practiceGuideIds: ["conceptOwningNames"],
    citations: [contradictionCitation],
    causedByCitations: [contradictionCitation],
  });

  const projection = projectGeneralAudit([
    started(),
    event(2, "general.finding.recorded", { revision: initial }),
    event(3, "general.dimension.assessed", {
      dimensionId: "ownershipClarity",
      score: 88,
      confidence: 0.9,
      supportingPositiveFindingIds: ["finding-owner"],
      supportingFrictionFindingIds: [],
      limitations: [],
    }),
    event(4, "general.finding.revised", { revision: contradicted }),
  ]);

  assert.equal(projection.findings["finding-owner"].revisions.length, 2);
  assert.equal(
    projection.findings["finding-owner"].currentRevision.state,
    "contradicted",
  );
  assert.deepEqual(
    projection.dimensions.ownershipClarity.supportingPositiveFindingIds,
    [],
  );
  assert.equal(
    projection.dimensions.ownershipClarity.assessmentState,
    "in_progress",
  );
  assert.equal(projection.dimensions.ownershipClarity.score, null);
  assert.equal(projection.assessedWeight, 0);
});

test("behavior paths retain explicit unknown nodes", () => {
  const sourceCitation = citation("production_code");
  const projection = projectGeneralAudit([
    started(),
    event(2, "general.behavior_path.recorded", {
      pathId: "path-submit-order",
      name: "Submit an order",
      entryPoint: {
        status: "known",
        label: "POST /orders",
        citations: [sourceCitation],
      },
      owner: {
        status: "known",
        label: "submitOrder",
        citations: [sourceCitation],
      },
      dependencies: [
        {
          status: "unknown",
          label: "payment boundary",
          reason: "The generated client target was not available.",
          citations: [],
        },
      ],
      consumers: [],
      tests: [
        {
          status: "unknown",
          label: "order submission integration test",
          reason: "No matching test was located.",
          citations: [],
        },
      ],
    }),
  ]);

  const path = projection.behaviorPaths["path-submit-order"];
  assert.equal(path.dependencies[0].status, "unknown");
  assert.equal(path.tests[0].status, "unknown");
});

test("the projector is deterministic and rejects non-relative citations", () => {
  const sourceCitation = citation("production_code");
  const finding = revision({
    findingId: "finding-deterministic",
    state: "confirmed",
    signal: "positive",
    dimensionIds: ["discoveryEfficiency"],
    citations: [sourceCitation],
    causedByCitations: [sourceCitation],
  });
  const events = [
    started(),
    event(2, "general.finding.recorded", { revision: finding }),
  ];

  assert.deepEqual(
    projectGeneralAudit(events),
    projectGeneralAudit(structuredClone(events)),
  );

  const escapedCitation = citation(
    "production_code",
    "../outside-repository.ts",
  );
  assert.throws(
    () =>
      projectGeneralAudit([
        started(),
        event(2, "general.finding.recorded", {
          revision: revision({
            findingId: "finding-escaped",
            citations: [escapedCitation],
          }),
        }),
      ]),
    (error) =>
      error instanceof GeneralAuditProjectionError &&
      error.code === "non_relative_citation_path",
  );
});
