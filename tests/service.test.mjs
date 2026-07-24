import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  startWaymarkServer,
  toRunSnapshot,
} from "../server/waymark-server.mjs";
import { AuditStore } from "../src/persistence/index.mjs";
import { hashScoreInput, scoreAudit } from "../src/scoring/index.mjs";

test("snapshot explains authoritative dimensions and qualified claims", () => {
  const scoreInput = {
    observations: {
      discovery: {
        relevantLocationsFound: 4,
        relevantLocationsExpected: 5,
        filesOpened: 6,
        deadEnds: 1,
      },
      ownership: {
        correctAnswers: 2,
        totalAnswers: 3,
        ambiguousBoundaries: 0,
      },
      dependencies: {
        requiredEdgesFound: 3,
        requiredEdgesExpected: 4,
        hiddenEdgesEncountered: 1,
      },
      changeSurface: {
        requiredConsumersFound: 3,
        requiredConsumersExpected: 4,
        falsePositiveConsumers: 0,
      },
      verification: {
        workflowsFound: 1,
        workflowsExpected: 2,
        successfulProbes: 1,
        attemptedProbes: 1,
      },
      instructions: {
        applicableRulesFound: 1,
        applicableRulesExpected: 2,
        conflictsEncountered: 0,
      },
    },
    claims: [
      {
        id: "claim-1",
        criticality: "critical",
        candidateConfidence: 0.9,
        verdict: "verified",
        verificationMethod: "executable_probe",
        citationStatus: "valid",
        independentAssessment: "disagree",
      },
    ],
    tokens: {
      candidateNavigation: {
        count: 12000,
        source: "measured",
        target: 12000,
      },
      validation: { count: 1000, source: "measured" },
      reportGeneration: { count: 0, source: "unavailable" },
    },
  };
  const score = scoreAudit(scoreInput);
  const report = {
    run: {
      id: "qualified-run",
      status: "completed",
      repositoryIdentity: "example",
      targetRepositoryPath: "C:/repos/example",
      commitSha: "1234567890abcdef",
      task: "Trace a bounded upload",
      createdAt: "2026-07-24T00:00:00.000Z",
      runConditions: { agentHost: "Codex" },
      participants: [
        { role: "candidate", provider: "openai", model: "candidate" },
        { role: "orchestrator", provider: "openai", model: "orchestrator" },
      ],
    },
    events: [
      {
        sequence: 1,
        actor: "orchestrator",
        type: "challenge.raised",
        payload: {
          challengeId: "challenge-1",
          claimId: "claim-1",
          assessment: "qualify",
          issue: "The adjacent guard was omitted.",
        },
      },
      {
        sequence: 2,
        actor: "orchestrator",
        type: "challenge.resolved",
        payload: {
          challengeId: "challenge-1",
          claimId: "claim-1",
          disposition: "qualified",
          resolution: "Retain the claim with the adjacent guard noted.",
        },
      },
      {
        sequence: 3,
        actor: "orchestrator",
        type: "recommendation.created",
        payload: {
          priority: "high",
          title: "Map upload ownership",
          detail: "Link ingress, hashing, cleanup, and charging.",
        },
      },
      {
        sequence: 4,
        actor: "waymark:scorer",
        type: "score.completed",
        payload: {
          input: scoreInput,
          inputHash: hashScoreInput(scoreInput),
          result: score,
        },
      },
      {
        sequence: 5,
        actor: "waymark",
        type: "run.finished",
        payload: { status: "completed", summary: {} },
      },
      {
        sequence: 6,
        actor: "waymark:reporter",
        type: "report.recommendations",
        payload: {
          schemaVersion:
            "waymark-navigation-recommendations/1.0.0",
          scope: "repository_navigation",
          method: "post_run_evidence_review",
          recommendations: [
            {
              id: "recommendation-verified",
              priority: "P0",
              title: "Expose the upload ownership path",
              problem:
                "The probe required repeated searches across layers.",
              change:
                "Add a feature map beside the owning application command.",
              repositoryChanges: [
                "Link the entry point, owner, consumers, and focused tests.",
              ],
              claimIds: ["claim-1"],
              practiceIds: ["01", "02"],
              affectedDimensions: [
                "ownershipClarity",
                "dependencyClarity",
              ],
              tokenMechanism:
                "One owner removes repeated cross-layer searches.",
              validationChecks: [
                "A fresh agent finds the owner without a global search.",
              ],
              limitations: ["Point impact is not modeled."],
              effort: null,
            },
          ],
        },
      },
    ],
    claims: [
      {
        id: "claim-1",
        assertion: "The upload path retains a whole-file array.",
        confidence: 0.9,
        citations: [{ path: "src/Upload.cs", startLine: 12 }],
      },
    ],
    verifications: [
      {
        claimId: "claim-1",
        verdict: "verified",
        method: "executable_probe",
      },
    ],
    tokens: [
      {
        actor: "candidate",
        phase: "candidate_navigation",
        source: "measured",
        inputTokens: 11000,
        cachedInputTokens: null,
        cacheCreationTokens: null,
        outputTokens: 1000,
        totalTokens: 12000,
      },
    ],
    aggregates: {
      verifiedClaimCount: 1,
      contradictedClaimCount: 0,
      claimCount: 1,
      tokensByPhase: { candidate_navigation: 12000 },
    },
  };

  const snapshot = toRunSnapshot(report, 1);
  assert.equal(snapshot.scoreBreakdown.dimensions.length, 6);
  assert.equal(snapshot.scoreBreakdown.adequacyPassed, true);
  assert.equal(snapshot.evidence[0].status, "Verified · qualified");
  assert.equal(
    snapshot.evidence[0].challenge.resolution,
    "Retain the claim with the adjacent guard noted.",
  );
  assert.equal(
    snapshot.recommendations[0].description,
    "The probe required repeated searches across layers.",
  );
  assert.equal(snapshot.recommendations[0].source, "evidence_linked_addendum");
  assert.equal(
    snapshot.recommendations[0].change,
    "Add a feature map beside the owning application command.",
  );
  assert.deepEqual(snapshot.recommendations[0].repositoryChanges, [
    "Link the entry point, owner, consumers, and focused tests.",
  ]);
  assert.deepEqual(snapshot.recommendations[0].validationChecks, [
    "A fresh agent finds the owner without a global search.",
  ]);
  assert.equal(snapshot.recommendations[0].evidence.length, 1);
  assert.deepEqual(snapshot.recommendations[0].evidence[0], {
    claimId: "claim-1",
    assertion: "The upload path retains a whole-file array.",
    path: "src/Upload.cs",
    startLine: 12,
    endLine: null,
    verdict: "verified",
    method: "executable_probe",
  });
  assert.equal(snapshot.recommendations[0].projectedPoints, null);
  assert.equal(snapshot.recommendations[0].projectionStatus, "unavailable");
  assert.match(
    snapshot.recommendations[0].projectionReason,
    /versioned deterministic impact model/,
  );
  assert.equal(snapshot.recommendations[0].effort, null);
  assert.equal(snapshot.practiceFindings.length, 6);
  assert.ok(
    snapshot.practiceFindings.some(
      (finding) =>
        finding.dimensionKey === "discoveryEfficiency" &&
        finding.measured ===
          "4/5 relevant locations found; 6 files opened; 1 dead end." &&
        finding.practices.some(
          (practice) =>
            practice.id === "03" &&
            practice.title === "Name files for the concept they own",
        ),
    ),
  );
  assert.ok(
    snapshot.practiceFindings.every(
      (finding) =>
        finding.maximumScoreHeadroom > 0 &&
        finding.headroomStatus === "maximum_not_projection",
    ),
  );
  assert.equal(snapshot.tokenUsage.overall.cachedInputTokens, null);
  assert.equal(snapshot.tokenUsage.overall.uncachedInputTokens, null);
  assert.equal(
    snapshot.tokenUsage.candidateBudget.scoreFormula,
    "min(100, targetTokens / max(observedTokens, targetTokens) × 100)",
  );
  assert.equal(snapshot.tokenUsage.candidateBudget.isForecast, false);
});

test("local service exposes a normalized latest-run snapshot", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-service-"));
  const databasePath = join(directory, "waymark.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun({
    targetRepositoryPath: "C:/repos/example",
    repositoryIdentity: "example",
    commitSha: "1234567890abcdef",
    name: "Partial refund change surface",
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
  assert.equal(snapshot.name, "Partial refund change surface");
  assert.equal(snapshot.phase, "Cross-examination");
  assert.equal(snapshot.progress, 68);
  assert.equal(snapshot.latestEvent, "phase.changed");
  assert.equal(snapshot.activeAgentCount, 1);
  assert.equal(
    snapshot.participants.find(({ role }) => role === "orchestrator").status,
    "Active",
  );
  assert.equal(
    snapshot.participants.find(({ role }) => role === "candidate").status,
    "Queued",
  );
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
    scoreFormula:
      "min(100, targetTokens / max(observedTokens, targetTokens) × 100)",
    targetBasis: "run_declared",
    measurementScope: "Candidate-navigation phase records only",
    measurementMethod: "Provider-reported usage",
    isForecast: false,
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

test("local service projects failed and interrupted participant states", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-failed-service-"));
  const databasePath = join(directory, "waymark.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun({
    targetRepositoryPath: "C:/repos/example",
    repositoryIdentity: "example",
    commitSha: "1234567890abcdef",
    task: "Trace a bounded upload",
    participants: [
      { role: "candidate", provider: "openai", model: "candidate-model" },
      { role: "independent", provider: "openai", model: "research-model" },
      { role: "orchestrator", provider: "openai", model: "orchestrator-model" },
    ],
    toolPolicy: { target: "read-only" },
    runConditions: { agentHost: "Codex" },
    protocolVersion: "1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  });
  store.appendEvent({
    runId: run.id,
    actor: "candidate",
    type: "investigation.started",
    payload: { phase: "candidate_navigation", progress: 8 },
  });
  store.appendEvent({
    runId: run.id,
    actor: "candidate",
    type: "budget.exceeded",
    payload: { hardLimitTokens: 12000, measuredTokens: 18000 },
  });
  store.appendEvent({
    runId: run.id,
    actor: "independent",
    type: "investigation.interrupted",
    payload: { reason: "candidate budget exceeded" },
  });
  store.finishRun(run.id, {
    status: "failed",
    summary: { reason: "candidate_navigation_budget_exceeded" },
  });
  store.close();

  const service = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  t.after(() => service.close());

  const response = await fetch(`${service.url}/api/runs/latest`);
  const snapshot = await response.json();
  assert.equal(snapshot.status, "failed");
  assert.equal(snapshot.activeAgentCount, 0);
  assert.match(snapshot.latestEvent, /candidate navigation budget exceeded/);
  assert.equal(
    snapshot.participants.find(({ role }) => role === "candidate").status,
    "Failed",
  );
  assert.equal(
    snapshot.participants.find(({ role }) => role === "independent").status,
    "Interrupted",
  );
  assert.equal(
    snapshot.participants.find(({ role }) => role === "orchestrator").status,
    "Not run",
  );
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
