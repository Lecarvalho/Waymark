const INTERNAL_AUDIT_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

const SCORE_DIMENSION_LABELS = Object.freeze({
  discoveryEfficiency: "Discovery",
  ownershipClarity: "Ownership",
  dependencyClarity: "Dependencies",
  changeSurfaceRecall: "Change surface",
  verificationDiscoverability: "Verification",
  instructionQuality: "Instructions",
});

const PRACTICE_CATALOG = Object.freeze({
  "01": "Organize around behavior",
  "02": "Make dependency direction explicit",
  "03": "Name files for the concept they own",
  "04": "Provide one canonical workflow",
  "05": "Put instructions close to the code",
  "06": "Make tests mirror behavior",
  "07": "Separate generated and external code",
});

const PRACTICE_FINDING_DEFINITIONS = Object.freeze({
  discoveryEfficiency: {
    observationKey: "discovery",
    practiceIds: ["01", "03"],
    measured: (value) =>
      `${value.relevantLocationsFound}/${value.relevantLocationsExpected} relevant locations found; ${value.filesOpened} files opened; ${value.deadEnds} dead ${value.deadEnds === 1 ? "end" : "ends"}.`,
    issue: (value) =>
      `${Math.max(0, value.relevantLocationsExpected - value.relevantLocationsFound)} expected locations were missed and ${value.deadEnds} searches ended without useful evidence.`,
    action:
      "Use the feature vocabulary in directory and file names, then add a short feature-area index that links the behavior's entry point, owner, consumers, and tests.",
    tokenMechanism:
      "Stronger retrieval signals reduce repeated filename searches, broad text scans, and dead-end file reads.",
  },
  ownershipClarity: {
    observationKey: "ownership",
    practiceIds: ["01", "03"],
    measured: (value) =>
      `${value.correctAnswers}/${value.totalAnswers} ownership questions answered; ${value.ambiguousBoundaries} ambiguous ${value.ambiguousBoundaries === 1 ? "boundary" : "boundaries"}.`,
    issue: (value) =>
      `${Math.max(0, value.totalAnswers - value.correctAnswers)} ownership questions could not be answered from the discovered structure.`,
    action:
      "Give the behavior one obvious owning module and name its ingress, orchestration, persistence, and cleanup files for the concepts they own.",
    tokenMechanism:
      "Clear ownership prevents agents from reopening neighboring layers to decide where a change belongs.",
  },
  dependencyClarity: {
    observationKey: "dependencies",
    practiceIds: ["02"],
    measured: (value) =>
      `${value.requiredEdgesFound}/${value.requiredEdgesExpected} required dependency edges traced; ${value.hiddenEdgesEncountered} hidden ${value.hiddenEdgesEncountered === 1 ? "edge" : "edges"} encountered.`,
    issue: (value) =>
      `${Math.max(0, value.requiredEdgesExpected - value.requiredEdgesFound)} required dependency edges remained undiscovered and ${value.hiddenEdgesEncountered} ${value.hiddenEdgesEncountered === 1 ? "was" : "were"} hidden behind indirect wiring.`,
    action:
      "Document and enforce the dependency path from ingress through application ownership to storage, vendor work, charging, cancellation, and cleanup.",
    tokenMechanism:
      "Predictable dependency direction reduces follow-up reads needed to reconstruct runtime wiring and side effects.",
  },
  changeSurfaceRecall: {
    observationKey: "changeSurface",
    practiceIds: ["01", "02"],
    measured: (value) =>
      `${value.requiredConsumersFound}/${value.requiredConsumersExpected} required consumers found; ${value.falsePositiveConsumers} false positives.`,
    issue: (value) =>
      `${Math.max(0, value.requiredConsumersExpected - value.requiredConsumersFound)} required consumers were absent from the candidate's change surface.`,
    action:
      "Co-locate or cross-link the behavior's consumers and make outward calls explicit at the owning module boundary.",
    tokenMechanism:
      "A visible change surface avoids repeated global searches and later rework caused by missed consumers.",
  },
  verificationDiscoverability: {
    observationKey: "verification",
    practiceIds: ["04", "06"],
    measured: (value) =>
      `${value.workflowsFound}/${value.workflowsExpected} verification workflows found; ${value.successfulProbes}/${value.attemptedProbes} probes succeeded.`,
    issue: (value) =>
      `${Math.max(0, value.workflowsExpected - value.workflowsFound)} expected verification workflows were not discoverable from the implementation path.`,
    action:
      "Publish one canonical verification command and place or index acceptance tests beside the behavior they verify.",
    tokenMechanism:
      "An obvious feedback loop reduces command hunting, speculative reads, and failed verification attempts.",
  },
  instructionQuality: {
    observationKey: "instructions",
    practiceIds: ["05"],
    measured: (value) =>
      `${value.applicableRulesFound}/${value.applicableRulesExpected} applicable rules found; ${value.conflictsEncountered} ${value.conflictsEncountered === 1 ? "conflict" : "conflicts"}.`,
    issue: (value) =>
      `${Math.max(0, value.applicableRulesExpected - value.applicableRulesFound)} applicable ${
        value.applicableRulesExpected - value.applicableRulesFound === 1
          ? "rule was"
          : "rules were"
      } not found close enough to the audited behavior.`,
    action:
      "Put concise module-specific constraints beside the feature while keeping repository-wide commands at the root.",
    tokenMechanism:
      "Local instructions reduce exploratory searches and wrong turns caused by distant or implicit constraints.",
  },
});

function lastDefinedEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function userFacingText(value) {
  return typeof value === "string" && !INTERNAL_AUDIT_ID.test(value)
    ? value
    : null;
}

function userFacingList(values) {
  return Array.isArray(values)
    ? values.filter((value) => userFacingText(value) !== null)
    : [];
}

function buildPracticeFindings(score, scoreInput) {
  const observations = scoreInput?.observations;
  if (!observations || typeof observations !== "object") return [];

  return Object.entries(PRACTICE_FINDING_DEFINITIONS)
    .flatMap(([dimensionKey, definition]) => {
      const dimension = score?.dimensions?.[dimensionKey];
      const observation = observations[definition.observationKey];
      if (
        !dimension ||
        typeof dimension.score !== "number" ||
        typeof dimension.weight !== "number" ||
        !observation ||
        dimension.score >= 100
      ) {
        return [];
      }

      return [
        {
          dimensionKey,
          dimensionLabel: SCORE_DIMENSION_LABELS[dimensionKey],
          score: dimension.score,
          weight: dimension.weight,
          practices: definition.practiceIds.map((id) => ({
            id,
            title: PRACTICE_CATALOG[id],
          })),
          measured: definition.measured(observation),
          issue: definition.issue(observation),
          action: definition.action,
          tokenMechanism: definition.tokenMechanism,
          maximumScoreHeadroom:
            Math.round((100 - dimension.score) * dimension.weight * 100) / 100,
          headroomStatus: "maximum_not_projection",
        },
      ];
    })
    .sort(
      (left, right) =>
        right.maximumScoreHeadroom - left.maximumScoreHeadroom ||
        left.dimensionLabel.localeCompare(right.dimensionLabel),
    );
}

function projectStructuredRecommendations({
  events,
  claimsById,
  latestVerificationByClaim,
}) {
  const event = lastDefinedEvent(
    events,
    (candidate) =>
      candidate.type === "report.recommendations" &&
      candidate.actor === "waymark:reporter" &&
      candidate.payload?.scope === "repository_navigation" &&
      Array.isArray(candidate.payload?.recommendations),
  );
  const recommendations =
    event?.payload.recommendations.map((recommendation) => ({
      id: recommendation.id,
      priority: recommendation.priority,
      title:
        userFacingText(recommendation.title) ?? "Improve repository navigation",
      description:
        userFacingText(recommendation.problem) ??
        "Verified navigation friction needs a repository-level remedy.",
      problem: userFacingText(recommendation.problem),
      change: userFacingText(recommendation.change),
      repositoryChanges: userFacingList(recommendation.repositoryChanges),
      practiceIds: recommendation.practiceIds,
      affectedDimensions: recommendation.affectedDimensions,
      tokenMechanism: userFacingText(recommendation.tokenMechanism),
      validationChecks: userFacingList(recommendation.validationChecks),
      limitations: userFacingList(recommendation.limitations),
      evidence: recommendation.claimIds.flatMap((claimId) => {
        const claim = claimsById.get(claimId);
        const verification = latestVerificationByClaim.get(claimId);
        if (!claim) return [];
        return claim.citations.map((citation) => ({
          claimId,
          assertion: claim.assertion,
          path: citation.path,
          startLine: citation.startLine ?? null,
          endLine: citation.endLine ?? null,
          verdict: verification?.verdict ?? "unverified",
          method: verification?.method ?? "none",
        }));
      }),
      projectedPoints: null,
      projectionStatus: "unavailable",
      projectionReason:
        "This audit did not record a versioned deterministic impact model.",
      effort: recommendation.effort,
      effortReason:
        recommendation.effort === null
          ? "Repository change effort was not recorded for this audit."
          : null,
      source: "evidence_linked_addendum",
    })) ?? null;
  return { event, recommendations };
}

function projectLegacyRecommendations(events) {
  return events
    .filter((event) => event.type === "recommendation.created")
    .map((event) => {
      const projection = event.payload.projection;
      const hasDeterministicProjection =
        event.actor === "waymark:projector" &&
        projection?.method === "deterministic" &&
        typeof projection?.version === "string" &&
        typeof projection?.points === "number" &&
        Number.isFinite(projection.points);
      const effort =
        typeof event.payload.effort === "string"
          ? event.payload.effort
          : typeof event.payload.effort?.label === "string"
            ? event.payload.effort.label
            : typeof event.payload.cost === "string"
              ? event.payload.cost
              : null;
      return {
        id: event.id,
        priority:
          typeof event.payload.priority === "string"
            ? event.payload.priority
            : "P1",
        title:
          userFacingText(event.payload.title) ?? "Improve repository navigation",
        description:
          userFacingText(event.payload.description) ??
          userFacingText(event.payload.detail) ??
          "",
        problem: null,
        change: null,
        repositoryChanges: [],
        practiceIds: Array.isArray(event.payload.practiceIds)
          ? event.payload.practiceIds.filter(
              (id) => typeof id === "string" && PRACTICE_CATALOG[id],
            )
          : [],
        affectedDimensions: Array.isArray(event.payload.affectedDimensions)
          ? event.payload.affectedDimensions.filter(
              (key) =>
                typeof key === "string" && SCORE_DIMENSION_LABELS[key],
            )
          : [],
        tokenMechanism: userFacingText(event.payload.tokenMechanism),
        validationChecks: [],
        limitations: [],
        evidence: [],
        projectedPoints: hasDeterministicProjection ? projection.points : null,
        projectionStatus: hasDeterministicProjection
          ? "modeled"
          : "unavailable",
        projectionReason: hasDeterministicProjection
          ? `Deterministic projection ${projection.version}`
          : "This audit did not record a versioned deterministic impact model.",
        effort,
        effortReason:
          effort === null
            ? "Implementation effort was not recorded for this audit."
            : null,
        source: "legacy_event",
      };
    });
}

function projectPracticeProfile({
  events,
  auditMode,
  claimsById,
  latestVerificationByClaim,
  structuredRecommendations,
}) {
  const event = lastDefinedEvent(
    events,
    (candidate) =>
      candidate.type === "report.practice_profile" &&
      candidate.actor === "waymark:reporter" &&
      candidate.payload?.scope === "general_repository" &&
      Array.isArray(candidate.payload?.items),
  );
  const items =
    event?.payload.items.map((item) => ({
      practiceId: item.practiceId,
      title: PRACTICE_CATALOG[item.practiceId] ?? "Unknown practice",
      status: item.status,
      assessment:
        userFacingText(item.assessment) ??
        "No repository-specific assessment was recorded.",
      tokenImpact:
        userFacingText(item.tokenImpact) ??
        "The navigation-token mechanism was not recorded.",
      limitations: userFacingList(item.limitations),
      evidence: Array.isArray(item.claimIds)
        ? item.claimIds.flatMap((claimId) => {
            const claim = claimsById.get(claimId);
            const verification = latestVerificationByClaim.get(claimId);
            if (!claim) return [];
            return claim.citations.map((citation) => ({
              assertion: claim.assertion,
              path: citation.path,
              startLine: citation.startLine ?? null,
              endLine: citation.endLine ?? null,
              verdict: verification?.verdict ?? "unverified",
              method: verification?.method ?? "none",
            }));
          })
        : [],
      recommendations: Array.isArray(item.recommendationIds)
        ? item.recommendationIds.flatMap((recommendationId) => {
            const recommendation = structuredRecommendations?.find(
              ({ id }) => id === recommendationId,
            );
            return recommendation
              ? [
                  {
                    id: recommendation.id,
                    priority: recommendation.priority,
                    title: recommendation.title,
                  },
                ]
              : [];
          })
        : [],
    })) ?? [];
  return {
    available: event !== undefined,
    schemaVersion:
      typeof event?.payload?.schemaVersion === "string"
        ? event.payload.schemaVersion
        : null,
    suite:
      event?.payload?.suite && typeof event.payload.suite === "object"
        ? event.payload.suite
        : null,
    assessedCount: items.filter(({ status }) => status !== "not_assessed")
      .length,
    totalCount: 7,
    items,
    reason:
      event !== undefined
        ? null
        : auditMode === "general"
          ? "This report predates the seven-principle general-audit profile. Run a new General repository audit to assess every Practice Guide principle."
          : "Repository-wide practice profiling is available only in General repository audits.",
  };
}

export function projectReportContent({
  report,
  auditMode,
  score,
  scoreInput,
  challengeByClaim,
  claimsById,
  latestVerificationByClaim,
}) {
  const { event: structuredRecommendationEvent, recommendations } =
    projectStructuredRecommendations({
      events: report.events,
      claimsById,
      latestVerificationByClaim,
    });
  const partialBudgetEvidence = report.events
    .filter(
      (event) =>
        event.type === "budget.wrap_up_completed" &&
        typeof event.payload?.summary === "string",
    )
    .map((event) => ({
      claim: [event.payload.summary, ...userFacingList(event.payload.deadEnds)]
        .join(" "),
      source: `${event.actor} partial report`,
      status: "Partial - budget reserve",
      challenge: null,
      tone: "warn",
    }));
  const evidence = [
    ...partialBudgetEvidence,
    ...report.claims.map((claim) => {
      const verification = latestVerificationByClaim.get(claim.id);
      const challenge = challengeByClaim.get(claim.id) ?? null;
      const qualified =
        challenge?.status === "resolved" &&
        challenge?.disposition === "qualified";
      return {
        claim: claim.assertion,
        source: claim.citations[0]
          ? `${claim.citations[0].path}${
              claim.citations[0].startLine
                ? `:${claim.citations[0].startLine}`
                : ""
            }`
          : "No citation",
        status:
          verification?.verdict === "verified"
            ? qualified
              ? "Verified · qualified"
              : "Verified"
            : verification?.verdict === "contradicted"
              ? "Contradicted"
              : "Unverified",
        challenge,
        tone:
          verification?.verdict === "verified" && !qualified
            ? "good"
            : verification?.verdict === "contradicted"
              ? "bad"
              : "warn",
      };
    }),
  ];

  return {
    evidence,
    practiceFindings: buildPracticeFindings(score, scoreInput),
    practiceProfile: projectPracticeProfile({
      events: report.events,
      auditMode,
      claimsById,
      latestVerificationByClaim,
      structuredRecommendations: recommendations,
    }),
    recommendations:
      recommendations ?? projectLegacyRecommendations(report.events),
    hasStructuredRecommendations: structuredRecommendationEvent !== undefined,
  };
}

export { SCORE_DIMENSION_LABELS };
