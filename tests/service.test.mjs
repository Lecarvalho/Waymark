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

function generalRunInput(id) {
  return {
    id,
    targetRepositoryPath: "C:/repos/payments",
    repositoryIdentity: "team/payments",
    commitSha: "0123456789abcdef",
    task: "Assess repository navigability.",
    participants: [
      {
        id: `${id}-auditor`,
        role: "auditor",
        provider: "codex",
        model: "gpt-5.6",
      },
    ],
    toolPolicy: { targetRepository: "read-only" },
    runConditions: { auditMode: "general", agentHost: "Codex" },
    protocolVersion: "general-audit/2.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  };
}

function generalCitation(path = "src/refunds/refund-service.ts") {
  return {
    path,
    startLine: 10,
    endLine: 30,
    symbol: "RefundService",
    source: "production_code",
  };
}

function generalRevision({
  actor,
  occurredAt,
  revisionNumber = 1,
  state = "provisional",
  previousRevisionId = null,
  navigationCost = {
    searches: 4,
    filesOpened: 7,
    fileHops: 3,
    deadEnds: 2,
    commands: 5,
    processedTokens: 1800,
    elapsedMs: 92000,
  },
}) {
  const evidence = generalCitation();
  return {
    revisionId: `service-revision-${revisionNumber}`,
    findingId: "service-finding",
    revisionNumber,
    state,
    signal: "friction",
    title:
      state === "located_late"
        ? "Refund owner exists but was located late"
        : "Refund owner was not initially discoverable",
    conclusion:
      state === "located_late"
        ? "A consumer trace found the owner after four searches."
        : "The first ownership searches did not locate the owner.",
    dimensionIds: ["discoveryEfficiency", "ownershipClarity"],
    practiceGuideIds: ["conceptOwningNames"],
    citations: [evidence],
    navigationCost,
    provenance: {
      previousRevisionId,
      amendmentReason:
        previousRevisionId === null
          ? null
          : "A later consumer trace exposed the owning service.",
      actor,
      occurredAt,
      causedByCitations: [evidence],
    },
  };
}

function generalCheckpoint(run, key, payload, occurredAt) {
  return {
    runId: run.id,
    actor: run.participants[0].id,
    idempotencyKey: key,
    payload,
    occurredAt,
  };
}

function createSseReader(response) {
  assert.equal(response.status, 200);
  assert.ok(response.body);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  return {
    async next(eventName) {
      const timeout = AbortSignal.timeout(8_000);
      while (!timeout.aborted) {
        const boundary = buffered.indexOf("\n\n");
        if (boundary >= 0) {
          const block = buffered.slice(0, boundary);
          buffered = buffered.slice(boundary + 2);
          const name = block
            .split("\n")
            .find((line) => line.startsWith("event: "))
            ?.slice("event: ".length);
          if (name === eventName) return block;
          continue;
        }
        const read = reader.read();
        const result = await Promise.race([
          read,
          new Promise((_, reject) => {
            timeout.addEventListener(
              "abort",
              () => reject(new Error(`Timed out waiting for SSE ${eventName}`)),
              { once: true },
            );
          }),
        ]);
        if (result.done) {
          throw new Error(`SSE closed before ${eventName}`);
        }
        buffered += decoder.decode(result.value, { stream: true }).replaceAll(
          "\r\n",
          "\n",
        );
      }
      throw new Error(`Timed out waiting for SSE ${eventName}`);
    },
    cancel() {
      return reader.cancel();
    },
  };
}

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
                "Link paths cited by claim 397ac7cd-0764-4657-9cb6-090f055cae3c.",
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
                "Resolve verification 4b96299d-acde-425b-b796-10676911b2c2.",
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
  assert.deepEqual(
    {
      verifiedClaims: snapshot.metrics.verifiedClaims,
      contradictedClaims: snapshot.metrics.contradictedClaims,
      unverifiedClaims: snapshot.metrics.unverifiedClaims,
      adjudicatedClaims: snapshot.metrics.adjudicatedClaims,
    },
    {
      verifiedClaims: 1,
      contradictedClaims: 0,
      unverifiedClaims: 0,
      adjudicatedClaims: 1,
    },
  );
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

test("terminal unverified verdicts count as adjudicated and complete verifier work", () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-adjudicated-"));
  const databasePath = join(directory, "waymark.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun({
    targetRepositoryPath: "C:/repos/example",
    repositoryIdentity: "example",
    commitSha: "1234567890abcdef",
    task: "Trace a bounded upload",
    participants: [
      { role: "candidate", provider: "openai", model: "candidate-model" },
      { role: "verifier", provider: "openai", model: "verifier-model" },
      { role: "orchestrator", provider: "openai", model: "orchestrator-model" },
    ],
    toolPolicy: { target: "read-only" },
    runConditions: { agentHost: "Codex" },
    protocolVersion: "1.0.0",
    rubricVersion: "waymark-navigability/1.0.0",
  });
  for (const [index, assertion] of [
    "The upload command is owned by src/upload.ts.",
    "The retry limit is configured in src/config.ts.",
  ].entries()) {
    const claim = store.submitClaim({
      id: `claim-${index + 1}`,
      runId: run.id,
      subject: `fact ${index + 1}`,
      assertion,
      claimant: "candidate",
      citations: [
        {
          path: index === 0 ? "src/upload.ts" : "src/config.ts",
          startLine: 1,
          endLine: 2,
        },
      ],
      confidence: 0.8,
      criticality: "high",
    });
    store.recordVerification({
      id: `verification-${index + 1}`,
      runId: run.id,
      claimId: claim.id,
      verifier: "verifier",
      method: index === 0 ? "static_inspection" : "none",
      verdict: index === 0 ? "verified" : "unverified",
      evidence: {
        citationStatus: "valid",
        independentAssessment: "not_checked",
      },
    });
  }
  store.appendEvent({
    runId: run.id,
    actor: "verifier",
    type: "policy.violation",
    payload: { reason: "later_report_failure" },
  });
  store.finishRun(run.id, {
    status: "failed",
    summary: { reason: "report_finalization_failed" },
  });

  const snapshot = toRunSnapshot(store.readReport(run.id), 1);
  store.close();

  assert.equal(snapshot.progress, 85);
  assert.equal(snapshot.metrics.verifiedClaims, 1);
  assert.equal(snapshot.metrics.unverifiedClaims, 1);
  assert.equal(snapshot.metrics.adjudicatedClaims, 2);
  assert.equal(
    snapshot.participants.find(({ role }) => role === "verifier").status,
    "Complete",
  );
});

test("general snapshots expose partial evidence and reconstruct identically after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-service-"));
  const databasePath = join(directory, "waymark.sqlite");
  const store = new AuditStore({ databasePath });
  const run = store.createRun(generalRunInput("general-partial-service"));
  const auditor = run.participants[0].id;
  store.startGeneralAudit(
    generalCheckpoint(
      run,
      "start",
      {
        repositoryIdentity: run.repositoryIdentity,
        commitSha: run.commitSha,
        protocolVersion: run.protocolVersion,
      },
      "2026-07-25T18:00:00.000Z",
    ),
  );
  store.appendEvent({
    runId: run.id,
    actor: auditor,
    type: "provider.session.started",
    payload: {
      provider: "codex",
      providerSessionId: "provider-session-1",
    },
  });
  store.recordGeneralSurface(
    generalCheckpoint(
      run,
      "surface",
      {
        surface: "production_code",
        summary: "Inspected the refund command and owning service.",
        citations: [generalCitation()],
      },
      "2026-07-25T18:01:00.000Z",
    ),
  );
  const findingAt = "2026-07-25T18:02:00.000Z";
  store.recordGeneralFinding(
    generalCheckpoint(
      run,
      "finding",
      {
        revision: generalRevision({
          actor: auditor,
          occurredAt: findingAt,
        }),
      },
      findingAt,
    ),
  );
  store.recordGeneralBehaviorPath(
    generalCheckpoint(
      run,
      "behavior-path",
      {
        pathId: "refund-request",
        name: "Create a partial refund",
        entryPoint: {
          status: "known",
          label: "POST /refunds",
          citations: [generalCitation("src/refunds/refund-router.ts")],
        },
        owner: {
          status: "known",
          label: "RefundService",
          citations: [generalCitation()],
        },
        dependencies: [
          {
            status: "unknown",
            label: "payment provider boundary",
            reason: "The generated provider client was not available.",
            citations: [],
          },
        ],
        consumers: [],
        tests: [
          {
            status: "unknown",
            label: "partial refund integration test",
            reason: "No matching test was located.",
            citations: [],
          },
        ],
      },
      "2026-07-25T18:02:15.000Z",
    ),
  );
  store.recordGeneralDimensionProgress(
    generalCheckpoint(
      run,
      "dimension-progress",
      {
        dimensionId: "ownershipClarity",
        confidence: 0.65,
        supportingPositiveFindingIds: [],
        supportingFrictionFindingIds: ["service-finding"],
        limitations: ["Only the refund path has been traced."],
      },
      "2026-07-25T18:02:30.000Z",
    ),
  );
  store.recordGeneralRecommendation(
    generalCheckpoint(
      run,
      "recommendation",
      {
        recommendationId: "expose-refund-owner",
        title: "Expose the refund owner",
        rationale: "Reduce repeated searches from the refund route.",
        findingIds: ["service-finding"],
        dimensionIds: ["ownershipClarity"],
      },
      "2026-07-25T18:02:45.000Z",
    ),
  );
  store.recordTokenMeasurement({
    runId: run.id,
    actor: auditor,
    phase: "general_research",
    source: "provider_reported",
    provider: "codex",
    model: "gpt-5.6",
    inputTokens: 2000,
    outputTokens: 400,
    totalTokens: 2400,
  });
  store.interruptGeneralAudit(
    generalCheckpoint(
      run,
      "interrupted",
      {
        outcome: "partial",
        reason: "Provider exited before dimension synthesis.",
      },
      "2026-07-25T18:03:00.000Z",
    ),
  );
  store.finishRun(run.id, {
    status: "partial",
    summary: { reason: "provider_exit_after_evidence" },
    finishedAt: "2026-07-25T18:03:00.000Z",
  });
  store.close();

  const firstService = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  const firstResponse = await fetch(`${firstService.url}/api/runs/latest`);
  const firstSnapshot = await firstResponse.json();
  await firstService.close();

  assert.equal(firstSnapshot.status, "partial");
  assert.equal(firstSnapshot.phase, "Partial report");
  assert.equal(firstSnapshot.auditMode, "general");
  assert.equal(firstSnapshot.generalAudit.status, "partial");
  assert.equal(firstSnapshot.generalAudit.auditor.id, auditor);
  assert.equal(firstSnapshot.generalAudit.auditor.status, "Interrupted");
  assert.equal(firstSnapshot.generalAudit.auditor.tokens, 2400);
  assert.equal(
    firstSnapshot.generalAudit.auditor.tokenSource,
    "provider_reported",
  );
  assert.equal(firstSnapshot.generalAudit.providerSession.id, "provider-session-1");
  assert.equal(firstSnapshot.generalAudit.providerSession.status, "interrupted");
  assert.equal(firstSnapshot.generalAudit.tokens.totals.totalTokens, 2400);
  assert.equal(firstSnapshot.generalAudit.findings.length, 1);
  assert.equal(firstSnapshot.generalAudit.surfaces.length, 1);
  assert.equal(firstSnapshot.generalAudit.behaviorPaths.length, 1);
  assert.equal(
    firstSnapshot.generalAudit.behaviorPaths[0].dependencies[0].status,
    "unknown",
  );
  assert.equal(firstSnapshot.generalAudit.recommendations.length, 1);
  assert.equal(firstSnapshot.generalAudit.dimensions.length, 6);
  assert.equal(
    firstSnapshot.generalAudit.dimensions.filter(
      ({ assessmentState }) => assessmentState === "not_assessed",
    ).length,
    5,
  );
  assert.equal(
    firstSnapshot.generalAudit.dimensions.find(
      ({ dimensionId }) => dimensionId === "ownershipClarity",
    ).assessmentState,
    "in_progress",
  );
  assert.equal(
    firstSnapshot.generalAudit.evidenceCoverage.ownershipClarity.bySource
      .production_code,
    1,
  );
  assert.equal(firstSnapshot.generalAudit.completeness.assessedWeight, 0);
  assert.equal(firstSnapshot.generalAudit.result, null);
  assert.equal(firstSnapshot.generalAudit.reportComplete, false);
  assert.equal(firstSnapshot.generalAudit.synthesis, null);
  assert.ok(firstSnapshot.generalAudit.latestCheckpointSequence > 0);

  const restartedService = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  const restartedResponse = await fetch(
    `${restartedService.url}/api/runs/latest`,
  );
  const restartedSnapshot = await restartedResponse.json();
  await restartedService.close();

  assert.deepEqual(restartedSnapshot.generalAudit, firstSnapshot.generalAudit);
});

test("SSE publishes incremental general findings and a later revision", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "waymark-general-sse-"));
  const databasePath = join(directory, "waymark.sqlite");
  const writer = new AuditStore({ databasePath });
  const run = writer.createRun(generalRunInput("general-sse-service"));
  const auditor = run.participants[0].id;
  const service = await startWaymarkServer({
    databasePath,
    host: "127.0.0.1",
    port: 0,
  });
  const streamResponse = await fetch(`${service.url}/api/events`);
  const stream = createSseReader(streamResponse);
  t.after(async () => {
    await stream.cancel();
    await service.close();
    writer.close();
  });
  await stream.next("ready");

  writer.startGeneralAudit(
    generalCheckpoint(
      run,
      "start",
      {
        repositoryIdentity: run.repositoryIdentity,
        commitSha: run.commitSha,
        protocolVersion: run.protocolVersion,
      },
      "2026-07-25T19:00:00.000Z",
    ),
  );
  await stream.next("changed");

  const findingAt = "2026-07-25T19:01:00.000Z";
  writer.recordGeneralFinding(
    generalCheckpoint(
      run,
      "finding",
      {
        revision: generalRevision({
          actor: auditor,
          occurredAt: findingAt,
        }),
      },
      findingAt,
    ),
  );
  await stream.next("changed");
  const findingSnapshot = await (
    await fetch(`${service.url}/api/runs/latest`)
  ).json();
  assert.equal(findingSnapshot.status, "running");
  assert.equal(findingSnapshot.phase, "Repository survey");
  assert.equal(findingSnapshot.generalAudit.findings.length, 1);
  assert.equal(
    findingSnapshot.generalAudit.findings[0].currentRevision.state,
    "provisional",
  );
  assert.equal(findingSnapshot.generalAudit.findings[0].revisions.length, 1);

  const revisedAt = "2026-07-25T19:02:00.000Z";
  writer.reviseGeneralFinding(
    generalCheckpoint(
      run,
      "revision",
      {
        revision: generalRevision({
          actor: auditor,
          occurredAt: revisedAt,
          revisionNumber: 2,
          state: "located_late",
          previousRevisionId: "service-revision-1",
          navigationCost: null,
        }),
      },
      revisedAt,
    ),
  );
  await stream.next("changed");
  const revisedSnapshot = await (
    await fetch(`${service.url}/api/runs/latest`)
  ).json();

  assert.equal(
    revisedSnapshot.generalAudit.findings[0].currentRevision.state,
    "located_late",
  );
  assert.equal(revisedSnapshot.generalAudit.findings[0].revisions.length, 2);
  assert.equal(
    revisedSnapshot.generalAudit.findings[0].navigationCostHistory.length,
    1,
  );
  assert.ok(
    revisedSnapshot.generalAudit.latestCheckpointSequence >
      findingSnapshot.generalAudit.latestCheckpointSequence,
  );
  assert.match(revisedSnapshot.latestEvent, /Revised finding to located_late/);
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
