const TOKEN_PHASES = [
  "candidate_navigation",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
];

export function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function tokenSource(measurements) {
  if (measurements.length === 0) return null;
  const sources = new Set(measurements.map((measurement) => measurement.source));
  return sources.size === 1 ? measurements[0].source : "mixed";
}

export function summarizeTokens(measurements) {
  if (measurements.length === 0) {
    return {
      totalTokens: null,
      inputTokens: null,
      cachedInputTokens: null,
      uncachedInputTokens: null,
      outputTokens: null,
      unclassifiedTokens: null,
      cacheCreationTokens: null,
      source: null,
    };
  }

  const totalTokens = measurements.reduce(
    (total, measurement) => total + measurement.totalTokens,
    0,
  );
  const sumOptionalField = (field) => {
    const available = measurements
      .map((measurement) => measurement[field])
      .filter((value) => typeof value === "number");
    return available.length === measurements.length
      ? available.reduce((total, value) => total + value, 0)
      : null;
  };
  const inputTokens = sumOptionalField("inputTokens");
  const cachedInputTokens = sumOptionalField("cachedInputTokens");
  const outputTokens = sumOptionalField("outputTokens");
  const cacheCreationTokens = sumOptionalField("cacheCreationTokens");

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens:
      inputTokens === null || cachedInputTokens === null
        ? null
        : Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    unclassifiedTokens:
      inputTokens === null || outputTokens === null
        ? null
        : Math.max(0, totalTokens - inputTokens - outputTokens),
    cacheCreationTokens,
    source: tokenSource(measurements),
  };
}

export function collectTokenContext(report) {
  const tokenMeasurementsByActor = new Map();
  for (const token of report.tokens) {
    const measurements = tokenMeasurementsByActor.get(token.actor) ?? [];
    measurements.push(token);
    tokenMeasurementsByActor.set(token.actor, measurements);
  }

  const latestLiveUsageByActor = new Map();
  const peakContextByActor = new Map();
  const latestRoleProgressByActor = new Map();
  for (const event of report.events) {
    if (
      event.type === "provider.usage.updated" &&
      typeof event.actor === "string"
    ) {
      latestLiveUsageByActor.set(event.actor, event.payload);
      const contextTokens = numberOrNull(event.payload?.context?.totalTokens);
      if (contextTokens !== null) {
        peakContextByActor.set(
          event.actor,
          Math.max(peakContextByActor.get(event.actor) ?? 0, contextTokens),
        );
      }
    }
    if (event.type === "role.progress" && typeof event.actor === "string") {
      latestRoleProgressByActor.set(event.actor, event);
    }
  }

  const candidateNavigationMeasurements = report.tokens.filter(
    (token) => token.phase === "candidate_navigation",
  );
  const tokenUsageByPhase = TOKEN_PHASES.map((phaseName) => ({
    phase: phaseName,
    ...summarizeTokens(
      report.tokens.filter((token) => token.phase === phaseName),
    ),
  }));

  return {
    tokenMeasurementsByActor,
    latestLiveUsageByActor,
    peakContextByActor,
    latestRoleProgressByActor,
    candidateNavigationMeasurements,
    overallTokenUsage: summarizeTokens(report.tokens),
    tokenUsageByPhase,
    candidateNavigationUsage: summarizeTokens(candidateNavigationMeasurements),
  };
}

export function projectTokenUsage({ report, score, tokenContext }) {
  const { run, events } = report;
  const {
    latestLiveUsageByActor,
    peakContextByActor,
    candidateNavigationMeasurements,
    overallTokenUsage,
    tokenUsageByPhase,
    candidateNavigationUsage,
  } = tokenContext;
  const configuredCandidateBudget =
    run.runConditions?.tokenBudgets?.candidate_navigation;
  const candidateTargetTokens =
    positiveNumberOrNull(score?.tokenEfficiency?.target) ??
    positiveNumberOrNull(configuredCandidateBudget?.targetTokens);
  const candidateHardLimitTokens = positiveNumberOrNull(
    configuredCandidateBudget?.hardLimitTokens,
  );
  const candidateLiveUsage = latestLiveUsageByActor.get("candidate");
  const candidateUsedTokens =
    candidateNavigationUsage.totalTokens ??
    numberOrNull(candidateLiveUsage?.cumulative?.totalTokens);
  const candidateTargetMultiple =
    candidateUsedTokens === null || candidateTargetTokens === null
      ? null
      : Math.round((candidateUsedTokens / candidateTargetTokens) * 100) / 100;
  const candidateHardLimitExceeded =
    candidateUsedTokens === null || candidateHardLimitTokens === null
      ? null
      : candidateUsedTokens > candidateHardLimitTokens;
  const candidateContextCapability =
    run.runConditions?.modelContextCapabilities?.candidate;
  const candidateMaximumContextTokens = positiveNumberOrNull(
    candidateContextCapability?.maximumTokens,
  );
  const candidateEffectiveContextTokens = positiveNumberOrNull(
    candidateContextCapability?.effectiveTokens,
  );
  const candidateEffectiveContextPercent = positiveNumberOrNull(
    candidateContextCapability?.effectivePercent,
  );
  const candidateCompletedInSingleSession = events.some(
    (event) =>
      event.actor === "candidate" && event.type === "investigation.completed",
  );
  const candidateProcessedSessionEquivalents =
    candidateUsedTokens === null || candidateEffectiveContextTokens === null
      ? null
      : Math.round(
          (candidateUsedTokens / candidateEffectiveContextTokens) * 100,
        ) / 100;
  const candidateCurrentContextTokens = numberOrNull(
    candidateLiveUsage?.context?.totalTokens,
  );
  const candidateCurrentContextPercent =
    numberOrNull(candidateLiveUsage?.contextPercent) ??
    (candidateCurrentContextTokens === null ||
    candidateEffectiveContextTokens === null
      ? null
      : Math.round(
          (candidateCurrentContextTokens / candidateEffectiveContextTokens) *
            10_000,
        ) / 100);
  const candidatePeakContextTokens =
    peakContextByActor.get("candidate") ?? null;

  const resourceSignals = events
    .filter((event) =>
      ["budget.exceeded", "budget.wrap_up_requested"].includes(event.type),
    )
    .map((event) => ({
      type:
        event.type === "budget.wrap_up_requested"
          ? "partial_budget_report"
          : "hard_token_limit_exceeded",
      actor: event.actor,
      reason:
        typeof event.payload?.reason === "string"
          ? event.payload.reason
          : "budget.exceeded",
      phase:
        typeof event.payload?.phase === "string" ? event.payload.phase : null,
      observedTokens:
        numberOrNull(event.payload?.observedTokens) ??
        numberOrNull(event.payload?.measuredTokens),
      hardLimitTokens: numberOrNull(event.payload?.hardLimitTokens),
      observedCommands: numberOrNull(event.payload?.observedCommands),
      declaredLimit: numberOrNull(event.payload?.declaredLimit),
    }));
  const overrunPhases = new Set(
    resourceSignals
      .filter((issue) => issue.type === "hard_token_limit_exceeded")
      .map((issue) => issue.phase),
  );
  for (const phaseUsage of tokenUsageByPhase) {
    const phaseBudget = run.runConditions?.tokenBudgets?.[phaseUsage.phase];
    const hardLimitTokens = positiveNumberOrNull(phaseBudget?.hardLimitTokens);
    if (
      phaseUsage.totalTokens !== null &&
      hardLimitTokens !== null &&
      phaseUsage.totalTokens > hardLimitTokens &&
      !overrunPhases.has(phaseUsage.phase)
    ) {
      resourceSignals.push({
        type: "hard_token_limit_exceeded",
        actor: null,
        reason: "hard_token_limit_exceeded",
        phase: phaseUsage.phase,
        observedTokens: phaseUsage.totalTokens,
        hardLimitTokens,
        observedCommands: null,
        declaredLimit: null,
      });
    }
  }

  const candidateTargetBasis =
    positiveNumberOrNull(configuredCandidateBudget?.targetTokens) !== null
      ? "run_declared"
      : candidateTargetTokens !== null
        ? "rubric_default"
        : "unavailable";
  const executionConditions = run.runConditions?.execution;
  const candidateMeasurementScope =
    executionConditions?.isolation === "fresh_process" &&
    executionConditions?.contextPolicy === "assignment_only" &&
    executionConditions?.measurementScope === "role_process_only"
      ? "Fresh isolated candidate process with assignment-only context"
      : typeof executionConditions?.measurementScope === "string"
        ? executionConditions.measurementScope
        : "Candidate-navigation phase records only";
  const candidateMeasurementMethod =
    typeof run.runConditions?.tokenAccounting?.policy === "string"
      ? run.runConditions.tokenAccounting.policy
      : candidateNavigationUsage.source === "measured"
        ? "Host-side telemetry"
        : candidateNavigationUsage.source === "provider_reported"
          ? "Provider-reported usage"
          : candidateNavigationUsage.source === "estimated"
            ? "Explicit estimate"
            : candidateLiveUsage
              ? "Provider session log · live"
              : null;

  return {
    resourceSignals,
    candidateNavigationMeasurements,
    tokenUsage: {
      overall: overallTokenUsage,
      byPhase: tokenUsageByPhase,
      candidateBudget: {
        usedTokens: candidateUsedTokens,
        targetTokens: candidateTargetTokens,
        hardLimitTokens: candidateHardLimitTokens,
        targetMultiple: candidateTargetMultiple,
        hardLimitExceeded: candidateHardLimitExceeded,
        efficiencyScore: numberOrNull(score?.tokenEfficiency?.score),
        eligible:
          typeof score?.tokenEfficiency?.eligible === "boolean"
            ? score.tokenEfficiency.eligible
            : null,
        scoreFormula:
          "min(100, targetTokens / max(observedTokens, targetTokens) × 100)",
        targetBasis: candidateTargetBasis,
        measurementScope: candidateMeasurementScope,
        measurementMethod: candidateMeasurementMethod,
        isForecast: false,
      },
      candidateSession: {
        completedInSingleSession: candidateCompletedInSingleSession,
        maximumContextTokens: candidateMaximumContextTokens,
        effectiveContextTokens: candidateEffectiveContextTokens,
        effectiveContextPercent: candidateEffectiveContextPercent,
        currentContextTokens: candidateCurrentContextTokens,
        currentContextPercent: candidateCurrentContextPercent,
        peakContextTokens: candidatePeakContextTokens,
        peakContextSource:
          candidatePeakContextTokens === null
            ? "unavailable"
            : "provider_session_log",
        processedTokens: candidateUsedTokens,
        processedSessionEquivalents: candidateProcessedSessionEquivalents,
        capabilitySource:
          typeof candidateContextCapability?.source === "string"
            ? candidateContextCapability.source
            : "unavailable",
        telemetryReason:
          candidatePeakContextTokens === null
            ? "No provider-session token snapshots have been recorded yet."
            : "Peak observed from normalized Codex provider-session token snapshots.",
      },
      monetaryCost: {
        status: "unavailable",
        amount: null,
        currency: null,
        reason: "No versioned provider pricing snapshot was recorded.",
      },
    },
  };
}
