import {
  GENERAL_DIMENSION_WEIGHTS,
  GENERAL_STRONG_SCORE_MINIMUM,
  WAYMARK_DIMENSION_IDS,
} from "../domain/general-audit.mjs";

export const GENERAL_REPORT_SCHEMA_VERSION = "general-report/1.0.0";
export { GENERAL_STRONG_SCORE_MINIMUM };

const INACTIVE_FINDING_STATES = new Set(["contradicted", "retracted"]);
const TOKEN_SOURCES = [
  "provider_reported",
  "measured",
  "estimated",
];
const EVIDENCE_SOURCES = [
  "production_code",
  "test",
  "configuration",
  "workflow",
  "documentation",
  "instruction",
  "generated",
  "external",
];
const SOURCE_SURFACES = {
  production_code: ["production_code"],
  test: ["tests"],
  configuration: ["configuration"],
  workflow: ["workflows"],
  documentation: ["documentation"],
  instruction: ["instructions"],
  generated: ["generated_external"],
  external: ["generated_external"],
};

function unique(values) {
  return [...new Set(values)];
}

function rounded(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function judgmentForScore(score) {
  if (score >= GENERAL_STRONG_SCORE_MINIMUM) return "strong";
  if (score >= 50) return "mixed";
  return "weak";
}

function currentFindingIsSupported(entry) {
  return (
    entry !== undefined &&
    !INACTIVE_FINDING_STATES.has(entry.currentRevision.state) &&
    entry.currentRevision.citations.length > 0
  );
}

function citationKey(citation) {
  return [
    citation.path,
    citation.startLine,
    citation.endLine,
    citation.symbol ?? "",
    citation.source,
  ].join("\u0000");
}

function assembleEvidenceMatrix(ledger) {
  const inspectedSurfaces = new Set(
    ledger.surfaces.map(({ surface }) => surface),
  );

  return Object.fromEntries(
    WAYMARK_DIMENSION_IDS.map((dimensionId) => {
      const revisions = ledger.findingOrder
        .map((findingId) => ledger.findings[findingId])
        .filter((entry) => currentFindingIsSupported(entry))
        .map((entry) => entry.currentRevision)
        .filter((revision) => revision.dimensionIds.includes(dimensionId));

      const bySource = Object.fromEntries(
        EVIDENCE_SOURCES.map((source) => {
          const findingIds = [];
          const citations = [];
          const seenCitations = new Set();

          for (const revision of revisions) {
            const matchingCitations = revision.citations.filter(
              (citation) => citation.source === source,
            );
            if (matchingCitations.length > 0) {
              findingIds.push(revision.findingId);
            }
            for (const citation of matchingCitations) {
              const key = citationKey(citation);
              if (!seenCitations.has(key)) {
                seenCitations.add(key);
                citations.push(citation);
              }
            }
          }

          const inspected = SOURCE_SURFACES[source].some((surface) =>
            inspectedSurfaces.has(surface),
          );

          return [
            source,
            {
              source,
              status:
                citations.length > 0
                  ? "cited"
                  : inspected
                    ? "inspected_no_finding"
                    : "not_inspected",
              citedEvidenceCount: citations.length,
              findingIds: unique(findingIds),
              citations,
            },
          ];
        }),
      );

      return [dimensionId, bySource];
    }),
  );
}

function defaultDimensionLimitation(dimension) {
  if (dimension.assessmentState === "not_assessed") {
    return `No adequate assessment has been recorded for ${dimension.dimensionId}.`;
  }
  return `Evidence for ${dimension.dimensionId} remains incomplete.`;
}

function assembleDimension(ledger, dimensionId) {
  const dimension = ledger.dimensions[dimensionId];
  const positiveIds = dimension.supportingPositiveFindingIds.filter(
    (findingId) => currentFindingIsSupported(ledger.findings[findingId]),
  );
  const frictionIds = dimension.supportingFrictionFindingIds.filter(
    (findingId) => currentFindingIsSupported(ledger.findings[findingId]),
  );
  const supportCount = positiveIds.length + frictionIds.length;
  const judgment =
    dimension.score === null ? null : judgmentForScore(dimension.score);
  const assessmentValid =
    dimension.assessmentState === "assessed" &&
    dimension.score !== null &&
    dimension.score >= 0 &&
    dimension.score <= 100 &&
    dimension.confidence !== null &&
    dimension.confidence >= 0 &&
    dimension.confidence <= 1 &&
    supportCount > 0 &&
    dimension.evidenceCoverage.state === "adequate" &&
    (judgment === "strong" || frictionIds.length > 0);
  const limitations =
    dimension.limitations.length > 0
      ? [...dimension.limitations]
      : assessmentValid
        ? []
        : [defaultDimensionLimitation(dimension)];

  if (
    dimension.assessmentState === "assessed" &&
    judgment !== "strong" &&
    frictionIds.length === 0
  ) {
    limitations.push(
      "Mixed and weak assessments require a current cited friction finding.",
    );
  }

  return {
    dimensionId,
    weight: GENERAL_DIMENSION_WEIGHTS[dimensionId],
    assessmentState: assessmentValid
      ? "assessed"
      : dimension.assessmentState === "not_assessed"
        ? "not_assessed"
        : "in_progress",
    score: assessmentValid ? dimension.score : null,
    judgment: assessmentValid ? judgment : null,
    confidence: dimension.confidence,
    evidenceCoverage: dimension.evidenceCoverage,
    supportingPositiveFindingIds: positiveIds,
    supportingFrictionFindingIds: frictionIds,
    limitations: unique(limitations),
  };
}

function assembleTokens(tokens) {
  const measurements = tokens.filter(
    (measurement) => measurement.phase === "general_research",
  );
  const bySource = Object.fromEntries(TOKEN_SOURCES.map((source) => [source, 0]));
  const totals = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
  };
  const availability = {
    inputTokens: false,
    outputTokens: false,
    cachedInputTokens: false,
    cacheCreationTokens: false,
  };

  for (const measurement of measurements) {
    bySource[measurement.source] += measurement.totalTokens;
    totals.totalTokens += measurement.totalTokens;
    for (const field of Object.keys(availability)) {
      if (measurement[field] !== null && measurement[field] !== undefined) {
        availability[field] = true;
        totals[field] += measurement[field];
      }
    }
  }

  return {
    phase: "general_research",
    measurements,
    measurementCount: measurements.length,
    bySource,
    totals: {
      inputTokens: availability.inputTokens ? totals.inputTokens : null,
      outputTokens: availability.outputTokens ? totals.outputTokens : null,
      cachedInputTokens: availability.cachedInputTokens
        ? totals.cachedInputTokens
        : null,
      cacheCreationTokens: availability.cacheCreationTokens
        ? totals.cacheCreationTokens
        : null,
      totalTokens: totals.totalTokens,
    },
    hardLimitTokens: null,
    tokenEfficiencyScore: null,
  };
}

/**
 * Assemble the report-facing general-audit contract from the durable semantic
 * ledger. This performs fixed arithmetic and consistency filtering only; it
 * does not run benchmark observations or introduce another model judgment.
 */
export function assembleGeneralAuditReport({ run, ledger, tokens }) {
  if (run?.runConditions?.auditMode !== "general") {
    throw new TypeError("A general report requires a general audit run.");
  }
  if (ledger === null || typeof ledger !== "object") {
    throw new TypeError("A projected general-audit ledger is required.");
  }
  if (!Array.isArray(tokens)) {
    throw new TypeError("General report token measurements must be an array.");
  }

  const dimensions = WAYMARK_DIMENSION_IDS.map((dimensionId) =>
    assembleDimension(ledger, dimensionId),
  );
  const assessedDimensions = dimensions.filter(
    (dimension) => dimension.assessmentState === "assessed",
  );
  const assessedWeight = assessedDimensions.reduce(
    (total, dimension) => total + dimension.weight,
    0,
  );
  const weightedPoints = rounded(
    assessedDimensions.reduce(
      (total, dimension) =>
        total + (dimension.score * dimension.weight) / 100,
      0,
    ),
  );
  const coverageComplete = assessedWeight === 100;
  const result = coverageComplete
    ? {
        type: "auditor_assessed",
        label: "Auditor-assessed",
        score: weightedPoints,
        assessedWeight,
      }
    : null;

  const findings = ledger.findingOrder.map(
    (findingId) => ledger.findings[findingId],
  );
  const behaviorPaths = ledger.behaviorPathOrder.map(
    (pathId) => ledger.behaviorPaths[pathId],
  );
  const recommendations = ledger.recommendations.filter(
    (recommendation) =>
      recommendation.findingIds.length > 0 &&
      recommendation.findingIds.every((findingId) =>
        currentFindingIsSupported(ledger.findings[findingId]),
      ),
  );
  const omittedRecommendationCount =
    ledger.recommendations.length - recommendations.length;
  const synthesisComplete = ledger.synthesis !== null;
  const limitations = unique([
    ...dimensions.flatMap((dimension) => dimension.limitations),
    ...(ledger.synthesis?.limitations ?? []),
    ...(ledger.interruption === null ? [] : [ledger.interruption.reason]),
    ...(synthesisComplete
      ? []
      : ["Final auditor synthesis has not been recorded."]),
    ...(omittedRecommendationCount === 0
      ? []
      : [
          `${omittedRecommendationCount} recommendation(s) were omitted because their current findings are unsupported, contradicted, or retracted.`,
        ]),
  ]);

  return {
    schemaVersion: GENERAL_REPORT_SCHEMA_VERSION,
    mode: "general",
    authority: "auditor_assessed",
    run: {
      id: run.id,
      repositoryIdentity: run.repositoryIdentity,
      commitSha: run.commitSha,
      protocolVersion: run.protocolVersion,
      rubricVersion: run.rubricVersion,
      status: run.status,
    },
    ledgerStatus: ledger.status,
    generatedFromSequence: ledger.lastSequence,
    findings,
    behaviorPaths,
    surfaces: ledger.surfaces,
    evidenceCoverage: ledger.evidenceCoverage,
    evidenceMatrix: assembleEvidenceMatrix(ledger),
    dimensions,
    recommendations,
    tokens: assembleTokens(tokens),
    completeness: {
      assessedDimensionCount: assessedDimensions.length,
      requiredDimensionCount: WAYMARK_DIMENSION_IDS.length,
      assessedWeight,
      requiredWeight: 100,
      coverageComplete,
      synthesisComplete,
      reportComplete: coverageComplete && synthesisComplete,
    },
    weightedPoints,
    result,
    synthesis: ledger.synthesis,
    interruption: ledger.interruption,
    limitations,
  };
}
