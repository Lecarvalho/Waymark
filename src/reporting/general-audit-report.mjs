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

function citationsMatch(left, right) {
  return citationKey(left) === citationKey(right);
}

function findingStateForCitations(ledger, citations) {
  const matchingStates = ledger.findingOrder
    .map((findingId) => ledger.findings[findingId]?.currentRevision)
    .filter(
      (revision) =>
        revision !== undefined &&
        revision.citations.some((findingCitation) =>
          citations.some((citation) =>
            citationsMatch(findingCitation, citation),
          ),
        ),
    )
    .map((revision) => revision.state);

  if (
    matchingStates.some(
      (state) => state === "contradicted" || state === "retracted",
    )
  ) {
    return "contradicted";
  }
  if (matchingStates.includes("located_late")) {
    return "difficult_to_discover";
  }
  return "verified_current";
}

function assemblePathNode(ledger, node, kind, index) {
  if (node.status === "unknown") {
    return {
      nodeId: `${kind}-${index}`,
      kind,
      status: "unknown",
      evidenceState: "pending",
      label: node.label,
      reason: node.reason,
      citations: [],
    };
  }

  return {
    nodeId: `${kind}-${index}`,
    kind,
    status: "known",
    evidenceState: findingStateForCitations(ledger, node.citations),
    label: node.label,
    reason: null,
    citations: node.citations,
  };
}

function uninspectedPathNode(kind, label) {
  return {
    nodeId: `${kind}-uninspected`,
    kind,
    status: "uninspected",
    evidenceState: "pending",
    label: `No ${label.toLowerCase()} recorded`,
    reason: `The behavior-path checkpoint did not record a ${label.toLowerCase()} node.`,
    citations: [],
  };
}

function pathGroup(ledger, kind, label, nodes) {
  const projected = nodes.map((node, index) =>
    assemblePathNode(ledger, node, kind, index),
  );
  return {
    kind,
    label,
    nodes:
      projected.length > 0
        ? projected
        : [uninspectedPathNode(kind, label)],
  };
}

function pathEdgeState(nodes) {
  const states = nodes.map(({ evidenceState }) => evidenceState);
  if (states.includes("contradicted")) return "contradicted";
  if (states.includes("difficult_to_discover")) {
    return "difficult_to_discover";
  }
  if (states.includes("pending")) return "pending";
  return "verified_current";
}

function assembleBehaviorPathViews(ledger, behaviorPaths) {
  return behaviorPaths.map((path) => {
    const groups = [
      pathGroup(ledger, "entry_point", "Entry point", [path.entryPoint]),
      pathGroup(ledger, "owner", "Owner", [path.owner]),
      pathGroup(ledger, "dependency", "Dependencies", path.dependencies),
      pathGroup(ledger, "consumer", "Consumers", path.consumers),
      pathGroup(ledger, "test", "Tests", path.tests),
    ];
    const edges = groups.slice(1).map((group, index) => {
      const citations = unique(
        group.nodes.flatMap(({ citations: nodeCitations }) =>
          nodeCitations.map(citationKey),
        ),
      ).map((key) =>
        group.nodes
          .flatMap(({ citations: nodeCitations }) => nodeCitations)
          .find((citation) => citationKey(citation) === key),
      );
      return {
        edgeId: `${groups[index].kind}-to-${group.kind}`,
        fromKind: groups[index].kind,
        toKind: group.kind,
        evidenceState: pathEdgeState(group.nodes),
        citations,
      };
    });

    return {
      pathId: path.pathId,
      name: path.name,
      observedAt: path.observedAt,
      groups,
      edges,
    };
  });
}

function measuredJourneyStep(kind, label, value, unit, pluralUnit = `${unit}s`) {
  return {
    kind,
    label,
    value,
    valueLabel:
      value === null
        ? "Unavailable"
        : `${value.toLocaleString()} ${value === 1 ? unit : pluralUnit}`,
    availability: value === null ? "unavailable" : "measured",
  };
}

function assembleDiscoveryJourneys(findings) {
  return findings
    .filter(
      ({ currentRevision, navigationCostHistory }) =>
        currentRevision.state === "located_late" ||
        navigationCostHistory.length > 0,
    )
    .map((finding) => {
      const latestObservation = finding.navigationCostHistory.at(-1) ?? null;
      const cost = latestObservation?.observation ?? null;
      const revision = finding.currentRevision;
      return {
        findingId: finding.findingId,
        title: revision.title,
        state: revision.state,
        locatedLate: revision.state === "located_late",
        measurementRevisionId: latestObservation?.revisionId ?? null,
        locatedAt: revision.provenance.occurredAt,
        locatedByCitations:
          revision.provenance.causedByCitations.length > 0
            ? revision.provenance.causedByCitations
            : revision.citations,
        amendmentReason: revision.provenance.amendmentReason,
        steps: [
          measuredJourneyStep(
            "searches",
            "Searches",
            cost?.searches ?? null,
            "search",
            "searches",
          ),
          measuredJourneyStep(
            "files_opened",
            "Files opened",
            cost?.filesOpened ?? null,
            "file",
          ),
          measuredJourneyStep(
            "dead_ends",
            "Dead ends",
            cost?.deadEnds ?? null,
            "dead end",
          ),
          {
            kind: "target_located",
            label: revision.state === "located_late"
              ? "Target located late"
              : "Target interpretation",
            value: null,
            valueLabel: new Date(
              revision.provenance.occurredAt,
            ).toISOString(),
            availability: "recorded",
          },
        ],
        additionalMeasurements: {
          fileHops: cost?.fileHops ?? null,
          commands: cost?.commands ?? null,
          processedTokens: cost?.processedTokens ?? null,
          elapsedMs: cost?.elapsedMs ?? null,
        },
      };
    });
}

function assembleRecommendationPriorities(recommendations) {
  return recommendations.map((recommendation) => ({
    ...recommendation,
    impact: {
      linkedFindingCount: recommendation.findingIds.length,
      affectedDimensionCount: recommendation.dimensionIds.length,
      affectedWeight: recommendation.dimensionIds.reduce(
        (total, dimensionId) =>
          total + GENERAL_DIMENSION_WEIGHTS[dimensionId],
        0,
      ),
      projectedScoreGain: null,
      label: "Evidence-linked scope",
    },
    effort: {
      status: "unavailable",
      label: "Not recorded",
      reason:
        "The general-audit checkpoint contract does not record implementation-effort estimates.",
    },
  }));
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
    behaviorPathViews: assembleBehaviorPathViews(ledger, behaviorPaths),
    discoveryJourneys: assembleDiscoveryJourneys(findings),
    surfaces: ledger.surfaces,
    evidenceCoverage: ledger.evidenceCoverage,
    evidenceMatrix: assembleEvidenceMatrix(ledger),
    dimensions,
    recommendations,
    recommendationPriorities:
      assembleRecommendationPriorities(recommendations),
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
