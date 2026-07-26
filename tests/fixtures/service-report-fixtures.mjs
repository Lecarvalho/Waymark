export function emptyBenchmarkReport({
  auditMode = "task_specific",
  status = "active",
} = {}) {
  return {
    run: {
      id: `fixture-${auditMode}-${status}`,
      status,
      targetRepositoryPath: "C:/repos/payments",
      repositoryIdentity: "team/payments",
      commitSha: "0123456789abcdef",
      name: null,
      task: "Trace the refund workflow.",
      createdAt: "2026-01-02T03:04:05.000Z",
      participants: [],
      runConditions: {
        auditMode,
        agentHost: "Codex",
      },
    },
    events: [],
    claims: [],
    verifications: [],
    tokens: [],
    generalReport: null,
    aggregates: {
      claimCount: 0,
      verifiedClaimCount: 0,
      contradictedClaimCount: 0,
      unverifiedClaimCount: 0,
      tokensByPhase: {},
    },
  };
}

export function generalHistoryReport({
  id,
  commitSha,
  rubricVersion = "waymark-navigability/1.0.0",
  schemaVersion = "general-audit-report/2.0.0",
  reportComplete = true,
  score = 70,
  createdAt = "2026-01-02T03:04:05.000Z",
} = {}) {
  const dimensions = [
    ["discoveryEfficiency", 20],
    ["ownershipClarity", 17],
    ["dependencyClarity", 17],
    ["changeSurfaceRecall", 20],
    ["verificationDiscoverability", 16],
    ["instructionQuality", 10],
  ].map(([dimensionId, weight]) => ({
    dimensionId,
    weight,
    score,
    assessmentState: reportComplete ? "assessed" : "in_progress",
    evidenceCoverage: {
      state: reportComplete ? "sufficient" : "partial",
      distinctCitationCount: reportComplete ? 2 : 1,
      requirementSatisfied: reportComplete,
    },
  }));
  return {
    run: {
      id,
      repositoryIdentity: "team/payments",
      commitSha,
      rubricVersion,
      status: reportComplete ? "completed" : "partial",
      createdAt,
      finishedAt: createdAt,
      runConditions: { auditMode: "general" },
    },
    events: [],
    generalReport: {
      schemaVersion,
      dimensions,
      findings: [],
      completeness: { reportComplete },
    },
  };
}
