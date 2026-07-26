import { hashScoreInput, scoreAudit } from "../src/scoring/index.mjs";
import {
  numberOrNull,
  tokenSource,
} from "./token-usage-snapshot.mjs";
import { SCORE_DIMENSION_LABELS } from "./report-content-snapshot.mjs";

const PHASE_LABELS = Object.freeze({
  candidate_navigation: "Candidate run",
  parallel_investigation: "Candidate run",
  independent_validation: "Blind research",
  orchestration: "Cross-examination",
  cross_examination: "Cross-examination",
  deterministic_verification: "Verification",
  report_generation: "Scoring",
});

function lastDefinedEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function positiveNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function phaseLabel(value) {
  if (typeof value !== "string") return null;
  return PHASE_LABELS[value] ?? value;
}

function commandProgress(event) {
  const declared = positiveNumberOrNull(event?.payload?.declaredCommands);
  if (declared === null) return 0;
  const started = Math.max(0, numberOrNull(event.payload.startedCommands) ?? 0);
  const completed = Math.max(
    0,
    numberOrNull(event.payload.completedCommands) ?? 0,
  );
  const activeCredit = started > completed ? 0.5 : 0;
  return Math.min(1, (completed + activeCredit) / declared);
}

function humanizeReason(value) {
  return typeof value === "string" && value.length > 0
    ? value.replaceAll("_", " ")
    : "unknown failure";
}

export function readAuthoritativeScore(report) {
  const event = lastDefinedEvent(
    report.events,
    (candidate) =>
      candidate.type === "score.completed" &&
      candidate.actor === "waymark:scorer",
  );
  if (!event) return { input: null, score: {} };
  const input = event.payload?.input;
  const inputHash = event.payload?.inputHash;
  if (
    !input ||
    typeof input !== "object" ||
    typeof inputHash !== "string" ||
    hashScoreInput(input) !== inputHash
  ) {
    return { input: null, score: {} };
  }

  try {
    return { input, score: scoreAudit(input) };
  } catch {
    return { input: null, score: {} };
  }
}

export function findProgressEvent(events) {
  return lastDefinedEvent(
    events,
    (event) =>
      event.type === "phase.changed" &&
      ["workflow", "orchestrator"].includes(event.actor) &&
      (typeof event.payload?.progress === "number" ||
        typeof event.payload?.phase === "string"),
  );
}

function projectCalibration(events, resourceSignals) {
  const issues = events
    .filter((event) =>
      ["policy.violation", "investigation.degraded"].includes(event.type),
    )
    .map((event) => ({
      type:
        event.type === "policy.violation"
          ? "policy_violation"
          : "evidence_degraded",
      actor: event.actor,
      reason:
        typeof event.payload?.reason === "string"
          ? event.payload.reason
          : typeof event.payload?.message === "string"
            ? event.payload.message
            : event.type,
      phase:
        typeof event.payload?.phase === "string" ? event.payload.phase : null,
      observedTokens: null,
      hardLimitTokens: null,
      observedCommands: numberOrNull(event.payload?.observedCommands),
      declaredLimit: numberOrNull(event.payload?.declaredLimit),
    }));
  return {
    eligible: issues.length === 0,
    status:
      issues.length > 0
        ? "diagnostic_only"
        : resourceSignals.some(
              (signal) => signal.type === "hard_token_limit_exceeded",
            )
          ? "eligible_with_resource_overrun"
          : resourceSignals.some(
                (signal) => signal.type === "partial_budget_report",
              )
            ? "eligible_with_partial_budget_report"
            : "eligible",
    issues,
    resourceSignals,
  };
}

function benchmarkLatestEventText(report, calibration) {
  const latestEvent = report.events.at(-1);
  if (typeof latestEvent?.payload?.message === "string") {
    return latestEvent.payload.message;
  }
  if (latestEvent?.type === "report.recommendations") {
    return "Evidence-linked recommendations added.";
  }
  if (latestEvent?.type === "run.finished") {
    if (report.run.status !== "completed") {
      return `Audit failed: ${humanizeReason(
        latestEvent.payload?.summary?.reason,
      )}.`;
    }
    if (calibration.status === "eligible_with_resource_overrun") {
      return "Audit completed and saved with a resource overrun.";
    }
    if (calibration.status === "eligible_with_partial_budget_report") {
      return "Audit completed and saved with a partial budget report.";
    }
    return calibration.eligible
      ? "Audit completed and saved."
      : "Audit completed and saved as diagnostic-only.";
  }
  return latestEvent?.type ?? "Run created";
}

export function projectBenchmarkSnapshot({
  report,
  status,
  score,
  progressEvent,
  tokenContext,
  tokenProjection,
  challengeEvents,
  resolvedChallengeIds,
}) {
  const { aggregates } = report;
  const verifiedClaims = aggregates.verifiedClaimCount ?? 0;
  const contradictedClaims = aggregates.contradictedClaimCount ?? 0;
  const unverifiedClaims = aggregates.unverifiedClaimCount ?? 0;
  const resolvedClaims = verifiedClaims + contradictedClaims;
  const adjudicatedClaims =
    verifiedClaims + contradictedClaims + unverifiedClaims;
  const candidateConfidence =
    report.claims.length === 0
      ? 0
      : report.claims.reduce((total, claim) => total + claim.confidence, 0) /
        report.claims.length;
  const recordedProgress = numberOrNull(progressEvent?.payload?.progress) ?? 0;
  const investigationRoles = report.run.participants
    .filter(({ role }) => ["candidate", "independent"].includes(role))
    .map(({ role }) => role);
  const investigationRoleProgress =
    investigationRoles.length === 0
      ? 0
      : investigationRoles.reduce(
          (total, role) =>
            total +
            commandProgress(tokenContext.latestRoleProgressByActor.get(role)),
          0,
        ) / investigationRoles.length;
  const orchestrationRoleProgress = commandProgress(
    tokenContext.latestRoleProgressByActor.get("orchestrator"),
  );
  const liveRoleProgress =
    recordedProgress < 40
      ? 5 + Math.round(investigationRoleProgress * 34)
      : recordedProgress < 65
        ? 40 + Math.round(orchestrationRoleProgress * 24)
        : recordedProgress;
  const verificationProgress =
    report.claims.length === 0 || report.verifications.length === 0
      ? 0
      : 65 +
        Math.round(
          (Math.min(adjudicatedClaims, report.claims.length) /
            report.claims.length) *
            20,
        );
  const recommendationsFinalized = report.events.some(
    (event) =>
      event.actor === "waymark:reporter" &&
      event.type === "report.recommendations",
  );
  const progress =
    status === "completed"
      ? 100
      : Math.max(
          recordedProgress,
          liveRoleProgress,
          verificationProgress,
          recommendationsFinalized ? 90 : 0,
        );
  const calibration = projectCalibration(
    report.events,
    tokenProjection.resourceSignals,
  );
  const overall = numberOrNull(score?.overall?.score);
  const reliability = numberOrNull(score?.reliability?.score);

  return {
    calibration,
    progress,
    phase:
      status === "completed"
        ? "Complete"
        : (phaseLabel(progressEvent?.payload?.phase) ?? "Discovery"),
    latestEvent: benchmarkLatestEventText(report, calibration),
    scoreBreakdown: {
      dimensions:
        score?.dimensions && typeof score.dimensions === "object"
          ? Object.entries(score.dimensions)
              .filter(
                ([key, dimension]) =>
                  SCORE_DIMENSION_LABELS[key] &&
                  typeof dimension?.score === "number" &&
                  typeof dimension?.weight === "number",
              )
              .map(([key, dimension]) => ({
                key,
                label: SCORE_DIMENSION_LABELS[key],
                score: dimension.score,
                weight: dimension.weight,
              }))
          : [],
      adequacyPassed:
        typeof score?.adequacy?.passed === "boolean"
          ? score.adequacy.passed
          : null,
    },
    metrics: {
      navigability: overall,
      reliability,
      candidateTokens:
        tokenProjection.candidateNavigationMeasurements.length === 0
          ? null
          : aggregates.tokensByPhase.candidate_navigation,
      candidateTokenSource: tokenSource(
        tokenProjection.candidateNavigationMeasurements,
      ),
      claimsChallenged: new Set(
        challengeEvents
          .map((event) => event.payload?.claimId)
          .filter((claimId) => typeof claimId === "string"),
      ).size,
      totalClaims: aggregates.claimCount,
      verifiedClaims,
      contradictedClaims,
      unverifiedClaims,
      adjudicatedClaims,
      openChallenges: Math.max(
        0,
        challengeEvents.length - resolvedChallengeIds.size,
      ),
      candidateConfidence: Math.round(candidateConfidence * 100),
      verifiedAccuracy:
        resolvedClaims === 0
          ? 0
          : Math.round((verifiedClaims / resolvedClaims) * 100),
    },
  };
}
