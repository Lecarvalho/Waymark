import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RUBRIC_VERSION,
  buildScoreInput,
  canonicalScoreInputJson,
  hashScoreInput,
  scoreAudit,
} from "../src/scoring/index.mjs";

async function fixture(name) {
  const contents = await readFile(
    new URL(`../fixtures/benchmarks/${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(contents);
}

test("the navigable benchmark scores above the hostile benchmark", async () => {
  const navigable = scoreAudit((await fixture("navigable")).input);
  const hostile = scoreAudit((await fixture("hostile-legacy")).input);

  assert.equal(navigable.rubricVersion, RUBRIC_VERSION);
  assert.ok(navigable.overall.score > hostile.overall.score);
  assert.ok(
    navigable.overall.score - hostile.overall.score >= 30,
    "controlled benchmarks should have a useful calibration separation",
  );
  assert.equal(navigable.adequacy.passed, true);
  assert.equal(hostile.adequacy.passed, false);
});

test("confidently wrong critical claims produce a visible gap and hard caps", async () => {
  const result = scoreAudit((await fixture("confidently-wrong")).input);

  assert.equal(result.evidence.confidenceGapStatus, "severely_overconfident");
  assert.ok(result.evidence.confidenceGap > 0.5);
  assert.ok(result.overall.score <= 35);
  assert.ok(result.reliability.score <= 30);
  assert.equal(result.overall.capped, true);
  assert.equal(result.adequacy.passed, false);
  assert.equal(result.tokenEfficiency.eligible, false);
  assert.equal(result.tokenEfficiency.score, null);
  assert.deepEqual(result.ignoredCandidateScores, [
    "discoveryEfficiency",
    "overall",
    "reliability",
  ]);
});

test("the same evidence reproduces the exact same score", async () => {
  const input = (await fixture("navigable")).input;

  assert.deepEqual(scoreAudit(input), scoreAudit(structuredClone(input)));
});

test("candidate-provided values cannot influence authoritative scores", async () => {
  const input = (await fixture("navigable")).input;
  const low = scoreAudit({
    ...input,
    candidateProvidedScores: { overall: 1, reliability: 1 },
  });
  const high = scoreAudit({
    ...input,
    candidateProvidedScores: { overall: 100, reliability: 100 },
  });

  assert.deepEqual(low, high);
  assert.throws(
    () => scoreAudit({ ...input, finalScore: 100 }),
    /reserved for the deterministic scorer/,
  );
});

test("token efficiency uses candidate navigation tokens only and requires adequacy", async () => {
  const input = (await fixture("navigable")).input;
  const baseline = scoreAudit(input);
  const expensiveValidation = scoreAudit({
    ...input,
    tokens: {
      ...input.tokens,
      validation: {
        count: 999999,
        source: "estimated",
      },
      reportGeneration: {
        count: 888888,
        source: "estimated",
      },
    },
  });

  assert.equal(baseline.tokenEfficiency.eligible, true);
  assert.equal(baseline.tokenEfficiency.score, 100);
  assert.equal(
    baseline.tokenEfficiency.score,
    expensiveValidation.tokenEfficiency.score,
  );
  assert.equal(baseline.overall.score, expensiveValidation.overall.score);
});

test("zero candidate navigation tokens are missing data, not perfect efficiency", async () => {
  const input = (await fixture("navigable")).input;
  const result = scoreAudit({
    ...input,
    tokens: {
      ...input.tokens,
      candidateNavigation: {
        ...input.tokens.candidateNavigation,
        count: 0,
      },
    },
  });

  assert.equal(result.adequacy.passed, true);
  assert.equal(result.tokenEfficiency.eligible, false);
  assert.equal(result.tokenEfficiency.score, null);
  assert.equal(
    result.tokenEfficiency.reason,
    "missing_token_measurement",
  );
});

test("persisted criticalities and evidence map into canonical scorer input", async () => {
  const observations = (await fixture("navigable")).input.observations;
  const criticalities = ["critical", "high", "medium", "low"];
  const claims = criticalities.map((criticality, index) => ({
    id: `claim-${index}`,
    confidence: 0.8,
    criticality,
    citations: [{ path: `src/file-${index}.ts`, startLine: 1 }],
  }));
  const verifications = claims.flatMap((claim, index) => [
    {
      id: `independent-${index}`,
      claimId: claim.id,
      method: "independent_model",
      verdict: "verified",
      createdAt: "2026-07-23T10:00:00.000Z",
    },
    {
      id: `deterministic-${index}`,
      claimId: claim.id,
      method: index === 0 ? "executable_probe" : "static_inspection",
      verdict: "verified",
      createdAt: "2026-07-23T09:00:00.000Z",
    },
  ]);
  const report = {
    run: {
      id: "run-persisted",
      rubricVersion: RUBRIC_VERSION,
    },
    claims,
    verifications,
    tokens: [
      {
        phase: "candidate_navigation",
        source: "provider_reported",
        totalTokens: 7100,
      },
      {
        phase: "independent_validation",
        source: "estimated",
        totalTokens: 2400,
      },
      {
        phase: "report_generation",
        source: "provider_reported",
        totalTokens: 900,
      },
    ],
  };

  const built = buildScoreInput(report, observations);
  assert.deepEqual(
    built.claims.map((claim) => claim.criticality),
    criticalities,
  );
  assert.ok(
    built.claims.every((claim) =>
      ["executable_probe", "static_inspection"].includes(
        claim.verificationMethod,
      ),
    ),
    "deterministic verification must outrank later model agreement",
  );
  assert.equal(built.tokens.candidateNavigation.count, 7100);
  assert.equal(built.tokens.validation.count, 2400);
  assert.equal(built.tokens.reportGeneration.count, 900);
  assert.equal(built.canonicalHash.length, 64);
  assert.doesNotThrow(() => scoreAudit(built));
});

test("canonical score input hashes ignore object key insertion order", () => {
  const first = { observations: { alpha: 1, beta: 2 }, claims: [] };
  const second = { claims: [], observations: { beta: 2, alpha: 1 } };

  assert.equal(canonicalScoreInputJson(first), canonicalScoreInputJson(second));
  assert.equal(hashScoreInput(first), hashScoreInput(second));
});
