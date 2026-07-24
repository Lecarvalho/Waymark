import {
  ADEQUACY_THRESHOLDS,
  CLAIM_WEIGHTS,
  DETERMINISTIC_METHODS,
  DIMENSION_WEIGHTS,
  RUBRIC_VERSION,
  SCORE_CAPS,
  TOKEN_TARGETS,
} from "./rubric.mjs";

const RESERVED_AUTHORITY_FIELDS = [
  "authoritativeScore",
  "finalScore",
  "reliabilityScore",
  "score",
];

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function ratio(numerator, denominator, whenEmpty = 0) {
  return denominator === 0 ? whenEmpty : clamp(numerator / denominator);
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative integer`);
  }
}

function assertCountPair(object, numerator, denominator, path) {
  assertNonNegativeInteger(object[numerator], `${path}.${numerator}`);
  assertNonNegativeInteger(object[denominator], `${path}.${denominator}`);

  if (object[numerator] > object[denominator]) {
    throw new RangeError(
      `${path}.${numerator} cannot exceed ${path}.${denominator}`,
    );
  }
}

function assertObservations(observations) {
  assertObject(observations, "observations");

  const sections = [
    "discovery",
    "ownership",
    "dependencies",
    "changeSurface",
    "verification",
    "instructions",
  ];
  for (const section of sections) {
    assertObject(observations[section], `observations.${section}`);
  }

  assertCountPair(
    observations.discovery,
    "relevantLocationsFound",
    "relevantLocationsExpected",
    "observations.discovery",
  );
  assertNonNegativeInteger(
    observations.discovery.filesOpened,
    "observations.discovery.filesOpened",
  );
  assertNonNegativeInteger(
    observations.discovery.deadEnds,
    "observations.discovery.deadEnds",
  );

  assertCountPair(
    observations.ownership,
    "correctAnswers",
    "totalAnswers",
    "observations.ownership",
  );
  assertNonNegativeInteger(
    observations.ownership.ambiguousBoundaries,
    "observations.ownership.ambiguousBoundaries",
  );

  assertCountPair(
    observations.dependencies,
    "requiredEdgesFound",
    "requiredEdgesExpected",
    "observations.dependencies",
  );
  assertNonNegativeInteger(
    observations.dependencies.hiddenEdgesEncountered,
    "observations.dependencies.hiddenEdgesEncountered",
  );

  assertCountPair(
    observations.changeSurface,
    "requiredConsumersFound",
    "requiredConsumersExpected",
    "observations.changeSurface",
  );
  assertNonNegativeInteger(
    observations.changeSurface.falsePositiveConsumers,
    "observations.changeSurface.falsePositiveConsumers",
  );

  assertCountPair(
    observations.verification,
    "workflowsFound",
    "workflowsExpected",
    "observations.verification",
  );
  assertCountPair(
    observations.verification,
    "successfulProbes",
    "attemptedProbes",
    "observations.verification",
  );

  assertCountPair(
    observations.instructions,
    "applicableRulesFound",
    "applicableRulesExpected",
    "observations.instructions",
  );
  assertNonNegativeInteger(
    observations.instructions.conflictsEncountered,
    "observations.instructions.conflictsEncountered",
  );
}

export function validateScoringObservations(observations) {
  assertObservations(observations);
  return structuredClone(observations);
}

function assertClaims(claims) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new TypeError("claims must be a non-empty array");
  }

  const identifiers = new Set();
  for (const [index, claim] of claims.entries()) {
    const path = `claims[${index}]`;
    assertObject(claim, path);

    if (typeof claim.id !== "string" || claim.id.length === 0) {
      throw new TypeError(`${path}.id must be a non-empty string`);
    }
    if (identifiers.has(claim.id)) {
      throw new RangeError(`${path}.id must be unique`);
    }
    identifiers.add(claim.id);

    if (!Object.hasOwn(CLAIM_WEIGHTS, claim.criticality)) {
      throw new RangeError(`${path}.criticality is not supported`);
    }
    if (!["verified", "contradicted", "unverified"].includes(claim.verdict)) {
      throw new RangeError(`${path}.verdict is not supported`);
    }
    if (
      ![
        ...DETERMINISTIC_METHODS,
        "independent_model",
        "none",
      ].includes(claim.verificationMethod)
    ) {
      throw new RangeError(`${path}.verificationMethod is not supported`);
    }
    if (!["valid", "invalid", "missing"].includes(claim.citationStatus)) {
      throw new RangeError(`${path}.citationStatus is not supported`);
    }
    if (
      typeof claim.candidateConfidence !== "number" ||
      claim.candidateConfidence < 0 ||
      claim.candidateConfidence > 1
    ) {
      throw new RangeError(
        `${path}.candidateConfidence must be between 0 and 1`,
      );
    }
    if (
      !["agree", "disagree", "not_checked"].includes(
        claim.independentAssessment,
      )
    ) {
      throw new RangeError(`${path}.independentAssessment is not supported`);
    }
  }
}

function assertTokens(tokens) {
  assertObject(tokens, "tokens");
  for (const field of [
    "candidateNavigation",
    "validation",
    "reportGeneration",
  ]) {
    assertObject(tokens[field], `tokens.${field}`);
    assertNonNegativeInteger(tokens[field].count, `tokens.${field}.count`);
    if (!["provider_reported", "estimated"].includes(tokens[field].source)) {
      throw new RangeError(`tokens.${field}.source is not supported`);
    }
  }

  if (tokens.candidateNavigation.target !== undefined) {
    if (
      !Number.isInteger(tokens.candidateNavigation.target) ||
      tokens.candidateNavigation.target <= 0
    ) {
      throw new RangeError(
        "tokens.candidateNavigation.target must be a positive integer",
      );
    }
  }
}

function assertNoAuthoritativeScore(input) {
  for (const field of RESERVED_AUTHORITY_FIELDS) {
    if (Object.hasOwn(input, field)) {
      throw new Error(
        `Input field "${field}" is reserved for the deterministic scorer`,
      );
    }
  }
}

function dimension(score, weight, factors) {
  return Object.freeze({
    score: round(clamp(score) * 100),
    weight,
    factors: Object.freeze(factors),
  });
}

function calculateDimensions(observations) {
  const discovery = observations.discovery;
  const discoveryRecall = ratio(
    discovery.relevantLocationsFound,
    discovery.relevantLocationsExpected,
    1,
  );
  const irrelevantFiles = Math.max(
    0,
    discovery.filesOpened - discovery.relevantLocationsFound,
  );
  const navigationNoise = discovery.deadEnds + irrelevantFiles * 0.25;
  const discoveryDirectness = ratio(
    discovery.relevantLocationsFound,
    discovery.relevantLocationsFound + navigationNoise,
    discovery.relevantLocationsExpected === 0 ? 1 : 0,
  );

  const ownership = observations.ownership;
  const ownershipAccuracy = ratio(
    ownership.correctAnswers,
    ownership.totalAnswers,
    1,
  );
  const ownershipBoundaryClarity =
    1 -
    ratio(
      ownership.ambiguousBoundaries,
      Math.max(ownership.totalAnswers, 1),
    );

  const dependencies = observations.dependencies;
  const dependencyRecall = ratio(
    dependencies.requiredEdgesFound,
    dependencies.requiredEdgesExpected,
    1,
  );
  const dependencyPredictability =
    1 -
    ratio(
      dependencies.hiddenEdgesEncountered,
      Math.max(dependencies.requiredEdgesExpected, 1),
    );

  const changeSurface = observations.changeSurface;
  const consumerRecall = ratio(
    changeSurface.requiredConsumersFound,
    changeSurface.requiredConsumersExpected,
    1,
  );
  const consumerPrecision = ratio(
    changeSurface.requiredConsumersFound,
    changeSurface.requiredConsumersFound +
      changeSurface.falsePositiveConsumers,
    changeSurface.requiredConsumersExpected === 0 ? 1 : 0,
  );

  const verification = observations.verification;
  const workflowRecall = ratio(
    verification.workflowsFound,
    verification.workflowsExpected,
    1,
  );
  const probeSuccess = ratio(
    verification.successfulProbes,
    verification.attemptedProbes,
  );

  const instructions = observations.instructions;
  const instructionRecall = ratio(
    instructions.applicableRulesFound,
    instructions.applicableRulesExpected,
    1,
  );
  const instructionConsistency =
    1 -
    ratio(
      instructions.conflictsEncountered,
      Math.max(instructions.applicableRulesExpected, 1),
    );

  return Object.freeze({
    discoveryEfficiency: dimension(
      discoveryRecall * 0.75 + discoveryDirectness * 0.25,
      DIMENSION_WEIGHTS.discoveryEfficiency,
      {
        relevantLocationRecall: round(discoveryRecall),
        navigationDirectness: round(discoveryDirectness),
      },
    ),
    ownershipClarity: dimension(
      ownershipAccuracy * 0.8 + ownershipBoundaryClarity * 0.2,
      DIMENSION_WEIGHTS.ownershipClarity,
      {
        answerAccuracy: round(ownershipAccuracy),
        boundaryClarity: round(ownershipBoundaryClarity),
      },
    ),
    dependencyClarity: dimension(
      dependencyRecall * 0.8 + dependencyPredictability * 0.2,
      DIMENSION_WEIGHTS.dependencyClarity,
      {
        requiredEdgeRecall: round(dependencyRecall),
        edgePredictability: round(dependencyPredictability),
      },
    ),
    changeSurfaceRecall: dimension(
      consumerRecall * 0.85 + consumerPrecision * 0.15,
      DIMENSION_WEIGHTS.changeSurfaceRecall,
      {
        consumerRecall: round(consumerRecall),
        consumerPrecision: round(consumerPrecision),
      },
    ),
    verificationDiscoverability: dimension(
      workflowRecall * 0.7 + probeSuccess * 0.3,
      DIMENSION_WEIGHTS.verificationDiscoverability,
      {
        workflowRecall: round(workflowRecall),
        executableProbeSuccess: round(probeSuccess),
      },
    ),
    instructionQuality: dimension(
      instructionRecall * 0.75 + instructionConsistency * 0.25,
      DIMENSION_WEIGHTS.instructionQuality,
      {
        applicableRuleRecall: round(instructionRecall),
        instructionConsistency: round(instructionConsistency),
      },
    ),
  });
}

function summarizeClaims(claims) {
  let totalWeight = 0;
  let verifiedWeight = 0;
  let contradictedWeight = 0;
  let resolvedWeight = 0;
  let deterministicWeight = 0;
  let validCitationWeight = 0;
  let candidateConfidenceWeight = 0;
  let criticalCount = 0;
  let criticalVerified = 0;
  let criticalContradicted = 0;
  let criticalUnverified = 0;
  let criticalDeterministic = 0;
  let independentCheckedWeight = 0;
  let independentAgreementWeight = 0;

  for (const claim of claims) {
    const weight = CLAIM_WEIGHTS[claim.criticality];
    const isDeterministic = DETERMINISTIC_METHODS.includes(
      claim.verificationMethod,
    );

    totalWeight += weight;
    candidateConfidenceWeight += claim.candidateConfidence * weight;

    if (claim.verdict === "verified") {
      verifiedWeight += weight;
      resolvedWeight += weight;
    } else if (claim.verdict === "contradicted") {
      contradictedWeight += weight;
      resolvedWeight += weight;
    }

    if (isDeterministic && claim.verdict !== "unverified") {
      deterministicWeight += weight;
    }
    if (claim.citationStatus === "valid") {
      validCitationWeight += weight;
    }
    if (claim.independentAssessment !== "not_checked") {
      independentCheckedWeight += weight;
      if (claim.independentAssessment === "agree") {
        independentAgreementWeight += weight;
      }
    }

    if (claim.criticality === "critical") {
      criticalCount += 1;
      if (claim.verdict === "verified") criticalVerified += 1;
      if (claim.verdict === "contradicted") criticalContradicted += 1;
      if (claim.verdict === "unverified") criticalUnverified += 1;
      if (isDeterministic && claim.verdict !== "unverified") {
        criticalDeterministic += 1;
      }
    }
  }

  const supportedAccuracy = ratio(verifiedWeight, totalWeight);
  const candidateConfidence = ratio(
    candidateConfidenceWeight,
    totalWeight,
  );
  const confidenceGap = round(candidateConfidence - supportedAccuracy);

  return Object.freeze({
    claimCount: claims.length,
    criticalCount,
    criticalVerified,
    criticalContradicted,
    criticalUnverified,
    verificationCoverage: round(ratio(deterministicWeight, totalWeight)),
    resolutionCoverage: round(ratio(resolvedWeight, totalWeight)),
    resolvedAccuracy: round(ratio(verifiedWeight, resolvedWeight)),
    supportedAccuracy: round(supportedAccuracy),
    contradictionRate: round(ratio(contradictedWeight, totalWeight)),
    citationValidity: round(ratio(validCitationWeight, totalWeight)),
    criticalAccuracy: round(
      ratio(
        criticalVerified,
        criticalVerified + criticalContradicted,
      ),
    ),
    criticalDeterministicCoverage: round(
      ratio(criticalDeterministic, criticalCount),
    ),
    independentAgreement: round(
      ratio(independentAgreementWeight, independentCheckedWeight),
    ),
    candidateConfidence: round(candidateConfidence),
    confidenceGap,
    confidenceGapStatus:
      confidenceGap > 0.25
        ? "severely_overconfident"
        : confidenceGap > 0.1
          ? "overconfident"
          : confidenceGap < -0.1
            ? "underconfident"
            : "aligned",
  });
}

function calculateGates(claimSummary, observations) {
  const probePassRate = ratio(
    observations.verification.successfulProbes,
    observations.verification.attemptedProbes,
  );
  const checks = Object.freeze({
    hasCriticalClaims: claimSummary.criticalCount > 0,
    noContradictedCriticalClaims:
      claimSummary.criticalContradicted === 0,
    criticalVerificationAdequate:
      claimSummary.criticalDeterministicCoverage >=
      ADEQUACY_THRESHOLDS.minimumCriticalDeterministicCoverage,
    supportedAccuracyAdequate:
      claimSummary.supportedAccuracy >=
      ADEQUACY_THRESHOLDS.minimumSupportedAccuracy,
    executableProbeAdequate:
      observations.verification.attemptedProbes > 0 &&
      probePassRate >= ADEQUACY_THRESHOLDS.minimumProbePassRate,
  });

  return Object.freeze({
    passed: Object.values(checks).every(Boolean),
    checks,
    probePassRate: round(probePassRate),
  });
}

function calculateCaps(claimSummary, observations) {
  let overall = 100;
  let reliability = 100;
  const reasons = [];

  function apply(reason, cap) {
    overall = Math.min(overall, cap.overall);
    reliability = Math.min(reliability, cap.reliability);
    reasons.push(reason);
  }

  if (claimSummary.criticalContradicted > 0) {
    apply(
      "contradicted_critical_claim",
      SCORE_CAPS.contradictedCriticalClaim,
    );
  } else if (claimSummary.criticalUnverified > 0) {
    apply(
      "unresolved_critical_claim",
      SCORE_CAPS.unresolvedCriticalClaim,
    );
  }

  if (
    claimSummary.criticalDeterministicCoverage <
    ADEQUACY_THRESHOLDS.minimumCriticalDeterministicCoverage
  ) {
    apply(
      "insufficient_critical_verification",
      SCORE_CAPS.insufficientCriticalVerification,
    );
  }

  if (observations.verification.attemptedProbes === 0) {
    apply("no_executable_probe", SCORE_CAPS.noExecutableProbe);
  }

  return Object.freeze({
    overall,
    reliability,
    reasons: Object.freeze(reasons),
  });
}

function calculateReliability(claimSummary, caps) {
  const raw =
    claimSummary.verificationCoverage * 0.3 +
    claimSummary.resolutionCoverage * 0.2 +
    claimSummary.resolvedAccuracy * 0.2 +
    claimSummary.citationValidity * 0.15 +
    claimSummary.criticalAccuracy * 0.1 +
    claimSummary.independentAgreement * 0.05;
  const confidencePenalty = clamp(claimSummary.confidenceGap) * 40;
  const contradictionPenalty = claimSummary.contradictionRate * 25;
  const uncapped = clamp(
    raw * 100 - confidencePenalty - contradictionPenalty,
    0,
    100,
  );
  const score = Math.min(uncapped, caps.reliability);

  return Object.freeze({
    score: round(score),
    rawScore: round(uncapped),
    cap: caps.reliability,
    capped: score < uncapped,
    verificationCoverage: claimSummary.verificationCoverage,
    resolutionCoverage: claimSummary.resolutionCoverage,
    citationValidity: claimSummary.citationValidity,
    confidenceGap: claimSummary.confidenceGap,
    confidenceGapStatus: claimSummary.confidenceGapStatus,
  });
}

function calculateTokenEfficiency(tokens, adequacyPassed) {
  const candidate = tokens.candidateNavigation;
  const target =
    candidate.target ?? TOKEN_TARGETS.defaultCandidateNavigationTokens;

  if (candidate.count === 0) {
    return Object.freeze({
      eligible: false,
      score: null,
      reason: "missing_token_measurement",
      candidateNavigationTokens: 0,
      target,
      source: candidate.source,
    });
  }

  if (!adequacyPassed) {
    return Object.freeze({
      eligible: false,
      score: null,
      reason: "adequacy_gate_failed",
      candidateNavigationTokens: candidate.count,
      target,
      source: candidate.source,
    });
  }

  const score = clamp(target / Math.max(candidate.count, target)) * 100;

  return Object.freeze({
    eligible: true,
    score: round(score),
    reason: null,
    candidateNavigationTokens: candidate.count,
    target,
    source: candidate.source,
  });
}

/**
 * Produce a deterministic navigability score from independently collected
 * observations and evidence. Values under candidateProvidedScores are retained
 * only as an audit trail of ignored field names; their values are never read.
 */
export function scoreAudit(input) {
  assertObject(input, "input");
  assertNoAuthoritativeScore(input);
  assertObservations(input.observations);
  assertClaims(input.claims);
  assertTokens(input.tokens);

  if (
    input.candidateProvidedScores !== undefined &&
    (!input.candidateProvidedScores ||
      typeof input.candidateProvidedScores !== "object" ||
      Array.isArray(input.candidateProvidedScores))
  ) {
    throw new TypeError("candidateProvidedScores must be an object");
  }

  const dimensions = calculateDimensions(input.observations);
  const claimSummary = summarizeClaims(input.claims);
  const gates = calculateGates(claimSummary, input.observations);
  const caps = calculateCaps(claimSummary, input.observations);

  const rawOverall = Object.values(dimensions).reduce(
    (total, item) => total + item.score * item.weight,
    0,
  );
  const overall = Math.min(rawOverall, caps.overall);

  return Object.freeze({
    rubricVersion: RUBRIC_VERSION,
    overall: Object.freeze({
      score: round(overall),
      rawScore: round(rawOverall),
      cap: caps.overall,
      capped: overall < rawOverall,
    }),
    dimensions,
    reliability: calculateReliability(claimSummary, caps),
    tokenEfficiency: calculateTokenEfficiency(input.tokens, gates.passed),
    adequacy: gates,
    evidence: claimSummary,
    caps,
    ignoredCandidateScores: Object.freeze(
      Object.keys(input.candidateProvidedScores ?? {}).sort(),
    ),
    tokenAccounting: Object.freeze({
      candidateNavigation: Object.freeze({ ...input.tokens.candidateNavigation }),
      validation: Object.freeze({ ...input.tokens.validation }),
      reportGeneration: Object.freeze({ ...input.tokens.reportGeneration }),
    }),
  });
}
