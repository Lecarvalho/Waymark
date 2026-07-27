import { basename } from "node:path";

import {
  findProgressEvent,
  projectBenchmarkSnapshot,
  readAuthoritativeScore,
} from "./benchmark-run-snapshot.mjs";
import {
  generalAuditPhase,
  generalAuditProgress,
  generalLatestEventText,
  generalRunStatus,
  projectGeneralAuditSnapshot,
} from "./general-audit-snapshot.mjs";
import { projectReportContent } from "./report-content-snapshot.mjs";
import {
  collectTokenContext,
  projectTokenUsage,
  summarizeTokens,
  tokenSource,
} from "./token-usage-snapshot.mjs";

function lastDefinedEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function conciseTaskName(task) {
  const normalized = task.replace(/\s+/g, " ").trim();
  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  const firstThought =
    sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd) : normalized;
  if (firstThought.length <= 72) return firstThought;

  const clipped = firstThought.slice(0, 73);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : 69).trimEnd()}…`;
}

function participantStatus(participant, events, runStatus) {
  const participantActors = new Set(
    [participant.id, participant.role].filter(
      (actor) => typeof actor === "string",
    ),
  );
  const roleEvents = events.filter((event) =>
    participantActors.has(event.actor),
  );
  const hasType = (...types) =>
    roleEvents.some((event) => types.includes(event.type));

  if (
    hasType("investigation.failed", "orchestration.failed", "provider.error") ||
    (hasType("budget.exceeded") &&
      !hasType("investigation.completed", "orchestration.completed"))
  ) {
    return "Failed";
  }
  const generalInterruption = lastDefinedEvent(
    roleEvents,
    (event) => event.type === "general.audit.interrupted",
  );
  if (generalInterruption?.payload?.outcome === "failed") return "Failed";
  if (
    hasType("investigation.interrupted", "orchestration.interrupted") ||
    generalInterruption
  ) {
    return "Interrupted";
  }
  if (
    hasType(
      "investigation.completed",
      "orchestration.completed",
      "general.synthesis.completed",
    )
  ) {
    return "Complete";
  }
  if (runStatus === "active") {
    return roleEvents.length > 0 ? "Active" : "Queued";
  }
  if (runStatus === "completed") {
    return roleEvents.length > 0 ? "Complete" : "Not run";
  }
  return roleEvents.length > 0 ? "Interrupted" : "Not run";
}

function buildChallengeContext(report) {
  const challengeEvents = report.events.filter(
    (event) => event.type === "challenge.raised",
  );
  const resolvedChallengeIds = new Set(
    report.events
      .filter((event) => event.type === "challenge.resolved")
      .map((event) => event.payload?.challengeId)
      .filter((challengeId) => typeof challengeId === "string"),
  );
  const challengeByClaim = new Map();
  for (const challenge of challengeEvents) {
    const claimId = challenge.payload?.claimId;
    const challengeId = challenge.payload?.challengeId;
    if (typeof claimId !== "string" || typeof challengeId !== "string") {
      continue;
    }
    const resolution = lastDefinedEvent(
      report.events,
      (event) =>
        event.type === "challenge.resolved" &&
        event.payload?.challengeId === challengeId,
    );
    challengeByClaim.set(claimId, {
      status: resolution ? "resolved" : "open",
      assessment:
        typeof challenge.payload?.assessment === "string"
          ? challenge.payload.assessment
          : null,
      issue:
        typeof challenge.payload?.issue === "string"
          ? challenge.payload.issue
          : null,
      resolution:
        typeof resolution?.payload?.resolution === "string"
          ? resolution.payload.resolution
          : null,
      disposition:
        typeof resolution?.payload?.disposition === "string"
          ? resolution.payload.disposition
          : null,
    });
  }
  return { challengeEvents, resolvedChallengeIds, challengeByClaim };
}

function buildClaimContext(report) {
  const latestVerificationByClaim = new Map();
  for (const verification of report.verifications) {
    latestVerificationByClaim.set(verification.claimId, verification);
  }
  return {
    latestVerificationByClaim,
    claimsById: new Map(report.claims.map((claim) => [claim.id, claim])),
  };
}

function projectParticipants(report, tokenContext, adjudicatedClaims) {
  return report.run.participants.map((participant) => {
    const verifierCompleted =
      participant.role === "verifier" &&
      report.verifications.length > 0 &&
      adjudicatedClaims === report.claims.length;
    const participantActors = [
      ...new Set(
        [participant.id, participant.role].filter(
          (actor) => typeof actor === "string",
        ),
      ),
    ];
    const participantTokenMeasurements = participantActors.flatMap(
      (actor) => tokenContext.tokenMeasurementsByActor.get(actor) ?? [],
    );
    const participantLiveUsage = participantActors
      .map((actor) => tokenContext.latestLiveUsageByActor.get(actor))
      .find((usage) => usage !== undefined);
    const participantTokenUsage =
      participantTokenMeasurements.length > 0
        ? summarizeTokens(participantTokenMeasurements)
        : participantLiveUsage
          ? summarizeTokens([
              {
                ...participantLiveUsage.cumulative,
                source: "measured_live",
              },
            ])
          : summarizeTokens([]);

    return {
      role: participant.role,
      provider: participant.provider,
      model: participant.model,
      status: verifierCompleted
        ? "Complete"
        : participantStatus(participant, report.events, report.run.status),
      tokens: participantTokenUsage.totalTokens,
      tokenUsage: participantTokenUsage,
      tokenSource:
        tokenSource(participantTokenMeasurements) ??
        (participantLiveUsage ? "measured_live" : null),
    };
  });
}

export function toRunSnapshot(report, runCount, historyReports = [report]) {
  const { run, aggregates } = report;
  const auditMode = run.runConditions?.auditMode ?? "task_specific";
  const authoritativeScore = readAuthoritativeScore(report);
  const tokenContext = collectTokenContext(report);
  const tokenProjection = projectTokenUsage({
    report,
    score: authoritativeScore.score,
    tokenContext,
  });
  const challengeContext = buildChallengeContext(report);
  const claimContext = buildClaimContext(report);
  const verifiedClaims = aggregates.verifiedClaimCount ?? 0;
  const contradictedClaims = aggregates.contradictedClaimCount ?? 0;
  const unverifiedClaims = aggregates.unverifiedClaimCount ?? 0;
  const adjudicatedClaims =
    verifiedClaims + contradictedClaims + unverifiedClaims;
  const status =
    auditMode === "general"
      ? generalRunStatus(report.generalReport, run.status)
      : run.status === "active"
        ? "running"
        : run.status === "completed"
          ? "completed"
          : "failed";
  const progressEvent = findProgressEvent(report.events);
  const benchmark = projectBenchmarkSnapshot({
    report,
    status,
    score: authoritativeScore.score,
    progressEvent,
    tokenContext,
    tokenProjection,
    challengeEvents: challengeContext.challengeEvents,
    resolvedChallengeIds: challengeContext.resolvedChallengeIds,
  });
  const participantSnapshots = projectParticipants(
    report,
    tokenContext,
    adjudicatedClaims,
  );
  const reportContent = projectReportContent({
    report,
    auditMode,
    score: authoritativeScore.score,
    scoreInput: authoritativeScore.input,
    challengeByClaim: challengeContext.challengeByClaim,
    claimsById: claimContext.claimsById,
    latestVerificationByClaim: claimContext.latestVerificationByClaim,
  });
  const progress =
    auditMode === "general"
      ? generalAuditProgress(report.generalReport, status)
      : benchmark.progress;
  const phase =
    auditMode === "general"
      ? generalAuditPhase(report.generalReport, status)
      : benchmark.phase;
  const candidate = run.participants.find(
    (participant) => participant.role === "candidate",
  );
  const orchestrator = run.participants.find(
    (participant) => participant.role === "orchestrator",
  );

  return {
    id: run.id,
    status,
    repository: {
      name: run.repositoryIdentity || basename(run.targetRepositoryPath),
      path: run.targetRepositoryPath,
      commit: run.commitSha.slice(0, 12),
    },
    name: run.name ?? conciseTaskName(run.task),
    task: run.task,
    auditMode,
    calibration: benchmark.calibration,
    phase,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    startedAt: run.createdAt,
    agentHost:
      typeof run.runConditions?.agentHost === "string"
        ? run.runConditions.agentHost
        : "Codex",
    latestEvent:
      auditMode === "general"
        ? generalLatestEventText(report.events)
        : benchmark.latestEvent,
    activeAgentCount: participantSnapshots.filter(
      (participant) =>
        participant.status === "Active" &&
        participant.role !== "reporter" &&
        participant.role !== "verifier",
    ).length,
    models: {
      candidate: candidate?.model ?? "unknown",
      orchestrator: orchestrator?.model ?? "unknown",
    },
    participants: participantSnapshots,
    generalAudit: projectGeneralAuditSnapshot({
      report,
      participantSnapshots,
      status,
      historyReports,
    }),
    evidence: reportContent.evidence,
    practiceFindings: reportContent.practiceFindings,
    practiceProfile: reportContent.practiceProfile,
    recommendations: reportContent.recommendations,
    tokenUsage: tokenProjection.tokenUsage,
    scoreBreakdown: benchmark.scoreBreakdown,
    metrics: benchmark.metrics,
    runCount,
  };
}
