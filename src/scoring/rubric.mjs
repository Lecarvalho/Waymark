export const RUBRIC_VERSION = "waymark-navigability/1.0.0";

export const DIMENSION_WEIGHTS = Object.freeze({
  discoveryEfficiency: 0.2,
  ownershipClarity: 0.17,
  dependencyClarity: 0.17,
  changeSurfaceRecall: 0.2,
  verificationDiscoverability: 0.16,
  instructionQuality: 0.1,
});

export const CLAIM_WEIGHTS = Object.freeze({
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
});

export const DETERMINISTIC_METHODS = Object.freeze([
  "executable_probe",
  "static_inspection",
]);

export const ADEQUACY_THRESHOLDS = Object.freeze({
  minimumCriticalDeterministicCoverage: 0.8,
  minimumSupportedAccuracy: 0.7,
  minimumProbePassRate: 0.5,
});

export const SCORE_CAPS = Object.freeze({
  contradictedCriticalClaim: Object.freeze({
    overall: 35,
    reliability: 30,
  }),
  unresolvedCriticalClaim: Object.freeze({
    overall: 55,
    reliability: 55,
  }),
  insufficientCriticalVerification: Object.freeze({
    overall: 65,
    reliability: 60,
  }),
  noExecutableProbe: Object.freeze({
    overall: 75,
    reliability: 65,
  }),
});

export const TOKEN_TARGETS = Object.freeze({
  defaultCandidateNavigationTokens: 12_000,
});
