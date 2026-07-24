import { statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  AuditStore,
  DEFAULT_DATABASE_PATH,
  resolveDatabasePath,
} from "../src/persistence/index.mjs";
import { discoverProviderCapabilities } from "../src/orchestration/provider-capabilities.mjs";
import { hashScoreInput, scoreAudit } from "../src/scoring/index.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4318;
const AUDIT_MODES = new Set([
  "general",
  "task_specific",
  "system_explanation",
]);
const TOKEN_PHASES = [
  "candidate_navigation",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
];

function json(response, status, value) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function databaseSignature(databasePath) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .map((path) => {
      try {
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return "missing";
      }
    })
    .join("|");
}

function lastDefinedEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

const INTERNAL_AUDIT_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

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

function tokenSource(measurements) {
  if (measurements.length === 0) return null;
  const sources = new Set(measurements.map((measurement) => measurement.source));
  return sources.size === 1 ? measurements[0].source : "mixed";
}

function summarizeTokens(measurements) {
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

function positiveNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function verifyAuthoritativeScore(event) {
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

const PHASE_LABELS = Object.freeze({
  candidate_navigation: "Candidate run",
  parallel_investigation: "Candidate run",
  independent_validation: "Blind research",
  orchestration: "Cross-examination",
  cross_examination: "Cross-examination",
  deterministic_verification: "Verification",
  report_generation: "Scoring",
});

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
      `${Math.max(
        0,
        value.relevantLocationsExpected - value.relevantLocationsFound,
      )} expected locations were missed and ${value.deadEnds} searches ended without useful evidence.`,
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
      `${Math.max(
        0,
        value.totalAnswers - value.correctAnswers,
      )} ownership questions could not be answered from the discovered structure.`,
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
      `${Math.max(
        0,
        value.requiredEdgesExpected - value.requiredEdgesFound,
      )} required dependency edges remained undiscovered and ${value.hiddenEdgesEncountered} ${value.hiddenEdgesEncountered === 1 ? "was" : "were"} hidden behind indirect wiring.`,
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
      `${Math.max(
        0,
        value.requiredConsumersExpected - value.requiredConsumersFound,
      )} required consumers were absent from the candidate's change surface.`,
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
      `${Math.max(
        0,
        value.workflowsExpected - value.workflowsFound,
      )} expected verification workflows were not discoverable from the implementation path.`,
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
      `${Math.max(
        0,
        value.applicableRulesExpected - value.applicableRulesFound,
      )} applicable ${
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

function phaseLabel(value) {
  if (typeof value !== "string") return null;
  return PHASE_LABELS[value] ?? value;
}

function participantStatus(role, events, runStatus) {
  const roleEvents = events.filter((event) => event.actor === role);
  const hasType = (...types) =>
    roleEvents.some((event) => types.includes(event.type));

  if (
    hasType("investigation.failed", "orchestration.failed") ||
    (hasType("budget.exceeded") &&
      !hasType("investigation.completed", "orchestration.completed"))
  ) {
    return "Failed";
  }
  if (hasType("investigation.interrupted", "orchestration.interrupted")) {
    return "Interrupted";
  }
  if (hasType("investigation.completed", "orchestration.completed")) {
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

export function toRunSnapshot(report, runCount) {
  const { run, events, aggregates } = report;
  const authoritativeScoreEvent = lastDefinedEvent(
    events,
    (event) =>
      event.type === "score.completed" &&
      event.actor === "waymark:scorer",
  );
  const authoritativeScore = verifyAuthoritativeScore(authoritativeScoreEvent);
  const score = authoritativeScore.score;
  const progressEvent = lastDefinedEvent(
    events,
    (event) =>
      event.type === "phase.changed" &&
      ["workflow", "orchestrator"].includes(event.actor) &&
      (typeof event.payload?.progress === "number" ||
        typeof event.payload?.phase === "string"),
  );
  const challengeEvents = events.filter(
    (event) => event.type === "challenge.raised",
  );
  const challengedClaimIds = new Set(
    challengeEvents
      .map((event) => event.payload?.claimId)
      .filter((claimId) => typeof claimId === "string"),
  );
  const resolvedChallengeIds = new Set(
    events
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
      events,
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
  const latestVerificationByClaim = new Map();
  for (const verification of report.verifications) {
    latestVerificationByClaim.set(verification.claimId, verification);
  }
  const claimsById = new Map(
    report.claims.map((claim) => [claim.id, claim]),
  );
  const tokensByActor = new Map();
  const tokenMeasurementsByActor = new Map();
  for (const token of report.tokens) {
    tokensByActor.set(
      token.actor,
      (tokensByActor.get(token.actor) ?? 0) + token.totalTokens,
    );
    const measurements = tokenMeasurementsByActor.get(token.actor) ?? [];
    measurements.push(token);
    tokenMeasurementsByActor.set(token.actor, measurements);
  }
  const latestLiveUsageByActor = new Map();
  const peakContextByActor = new Map();
  const latestRoleProgressByActor = new Map();
  for (const event of events) {
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
  const overallTokenUsage = summarizeTokens(report.tokens);
  const tokenUsageByPhase = TOKEN_PHASES.map((phaseName) => ({
    phase: phaseName,
    ...summarizeTokens(
      report.tokens.filter((token) => token.phase === phaseName),
    ),
  }));
  const candidateNavigationUsage = summarizeTokens(
    candidateNavigationMeasurements,
  );
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
  const candidate = run.participants.find(
    (participant) => participant.role === "candidate",
  );
  const orchestrator = run.participants.find(
    (participant) => participant.role === "orchestrator",
  );
  const repositoryName =
    run.repositoryIdentity || basename(run.targetRepositoryPath);
  const status =
    run.status === "active"
      ? "running"
      : run.status === "completed"
        ? "completed"
        : "failed";
  const recordedProgress = numberOrNull(progressEvent?.payload?.progress) ?? 0;
  const investigationRoles = run.participants
    .filter(({ role }) => ["candidate", "independent"].includes(role))
    .map(({ role }) => role);
  const investigationRoleProgress =
    investigationRoles.length === 0
      ? 0
      : investigationRoles.reduce(
          (total, role) =>
            total + commandProgress(latestRoleProgressByActor.get(role)),
          0,
        ) / investigationRoles.length;
  const orchestrationRoleProgress = commandProgress(
    latestRoleProgressByActor.get("orchestrator"),
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
  const recommendationsFinalized = events.some(
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
  const phase =
    status === "completed"
      ? "Complete"
      : (phaseLabel(progressEvent?.payload?.phase) ?? "Discovery");
  const overall =
    numberOrNull(score?.overall?.score);
  const reliability =
    numberOrNull(score?.reliability?.score);
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
      event.actor === "candidate" &&
      event.type === "investigation.completed",
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
        typeof event.payload?.phase === "string"
          ? event.payload.phase
          : null,
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
    const hardLimitTokens = positiveNumberOrNull(
      phaseBudget?.hardLimitTokens,
    );
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
  const calibrationIssues = events
    .filter((event) => event.type === "policy.violation")
    .map((event) => ({
      type: "policy_violation",
      actor: event.actor,
      reason:
        typeof event.payload?.reason === "string"
          ? event.payload.reason
          : event.type,
      phase:
        typeof event.payload?.phase === "string"
          ? event.payload.phase
          : null,
      observedTokens: null,
      hardLimitTokens: null,
      observedCommands: numberOrNull(event.payload?.observedCommands),
      declaredLimit: numberOrNull(event.payload?.declaredLimit),
    }));
  const calibration = {
    eligible: calibrationIssues.length === 0,
    status:
      calibrationIssues.length > 0
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
    issues: calibrationIssues,
    resourceSignals,
  };
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
  const latestEvent = events.at(-1);
  const latestEventText =
    typeof latestEvent?.payload?.message === "string"
      ? latestEvent.payload.message
      : latestEvent?.type === "report.recommendations"
        ? "Evidence-linked recommendations added."
        : latestEvent?.type === "run.finished"
          ? run.status === "completed"
            ? calibration.status === "eligible_with_resource_overrun"
              ? "Audit completed and saved with a resource overrun."
              : calibration.status === "eligible_with_partial_budget_report"
                ? "Audit completed and saved with a partial budget report."
              : calibration.eligible
                ? "Audit completed and saved."
                : "Audit completed and saved as diagnostic-only."
            : `Audit failed: ${humanizeReason(
                latestEvent.payload?.summary?.reason,
              )}.`
          : latestEvent?.type ?? "Run created";
  const participantSnapshots = run.participants.map((participant) => {
    const verifierCompleted =
      participant.role === "verifier" &&
      report.verifications.length > 0 &&
      adjudicatedClaims === report.claims.length;

    return {
      role: participant.role,
      provider: participant.provider,
      model: participant.model,
      status: verifierCompleted
        ? "Complete"
        : participantStatus(participant.role, events, run.status),
      tokens: tokensByActor.has(participant.role)
        ? tokensByActor.get(participant.role)
        : (numberOrNull(
            latestLiveUsageByActor.get(participant.role)?.cumulative
              ?.totalTokens,
          ) ?? null),
      tokenSource: tokenSource(
        tokenMeasurementsByActor.get(participant.role) ?? [],
      ) ?? (latestLiveUsageByActor.has(participant.role) ? "measured_live" : null),
    };
  });
  const structuredRecommendationEvent = lastDefinedEvent(
    events,
    (event) =>
      event.type === "report.recommendations" &&
      event.actor === "waymark:reporter" &&
      event.payload?.scope === "repository_navigation" &&
      Array.isArray(event.payload?.recommendations),
  );
  const structuredRecommendations =
    structuredRecommendationEvent?.payload.recommendations.map(
      (recommendation) => ({
        id: recommendation.id,
        priority: recommendation.priority,
        title:
          userFacingText(recommendation.title) ??
          "Improve repository navigation",
        description:
          userFacingText(recommendation.problem) ??
          "Verified navigation friction needs a repository-level remedy.",
        problem: userFacingText(recommendation.problem),
        change: userFacingText(recommendation.change),
        repositoryChanges: userFacingList(
          recommendation.repositoryChanges,
        ),
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
      }),
    ) ?? null;
  const partialBudgetEvidence = events
    .filter(
      (event) =>
        event.type === "budget.wrap_up_completed" &&
        typeof event.payload?.summary === "string",
    )
    .map((event) => ({
      claim: [
        event.payload.summary,
        ...userFacingList(event.payload.deadEnds),
      ].join(" "),
      source: `${event.actor} partial report`,
      status: "Partial - budget reserve",
      challenge: null,
      tone: "warn",
    }));

  return {
    id: run.id,
    status,
    repository: {
      name: repositoryName,
      path: run.targetRepositoryPath,
      commit: run.commitSha.slice(0, 12),
    },
    name: run.name ?? conciseTaskName(run.task),
    task: run.task,
    calibration,
    phase,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    startedAt: run.createdAt,
    agentHost:
      typeof run.runConditions?.agentHost === "string"
        ? run.runConditions.agentHost
        : "Codex",
    latestEvent: latestEventText,
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
    evidence: [...partialBudgetEvidence, ...report.claims.map((claim) => {
      const verification = latestVerificationByClaim.get(claim.id);
      const challenge = challengeByClaim.get(claim.id) ?? null;
      const qualified =
        challenge?.status === "resolved" &&
        challenge?.disposition === "qualified";
      const statusText =
        verification?.verdict === "verified"
          ? qualified
            ? "Verified · qualified"
            : "Verified"
          : verification?.verdict === "contradicted"
            ? "Contradicted"
            : "Unverified";
      return {
        claim: claim.assertion,
        source: claim.citations[0]
          ? `${claim.citations[0].path}${
              claim.citations[0].startLine
                ? `:${claim.citations[0].startLine}`
                : ""
            }`
          : "No citation",
        status: statusText,
        challenge,
        tone:
          verification?.verdict === "verified" && !qualified
            ? "good"
            : verification?.verdict === "contradicted"
              ? "bad"
              : "warn",
      };
    })],
    practiceFindings: buildPracticeFindings(
      score,
      authoritativeScore.input,
    ),
    recommendations:
      structuredRecommendations ??
      events
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
              userFacingText(event.payload.title) ??
              "Improve repository navigation",
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
            affectedDimensions: Array.isArray(
              event.payload.affectedDimensions,
            )
              ? event.payload.affectedDimensions.filter(
                  (key) =>
                    typeof key === "string" &&
                    SCORE_DIMENSION_LABELS[key],
                )
              : [],
            tokenMechanism:
              userFacingText(event.payload.tokenMechanism),
            validationChecks: [],
            limitations: [],
            evidence: [],
            projectedPoints: hasDeterministicProjection
              ? projection.points
              : null,
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
        }),
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
        candidateNavigationMeasurements.length === 0
          ? null
          : aggregates.tokensByPhase.candidate_navigation,
      candidateTokenSource: tokenSource(candidateNavigationMeasurements),
      claimsChallenged: challengedClaimIds.size,
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
    runCount,
  };
}

export async function startWaymarkServer({
  databasePath = process.env.WAYMARK_DB_PATH ?? DEFAULT_DATABASE_PATH,
  host = process.env.WAYMARK_HOST ?? DEFAULT_HOST,
  port = Number(process.env.WAYMARK_PORT ?? DEFAULT_PORT),
  providerCapabilityOptions,
} = {}) {
  const resolvedDatabasePath = resolveDatabasePath(databasePath);
  const store = new AuditStore({ databasePath: resolvedDatabasePath });
  const clients = new Set();

  const broadcast = (event = "changed") => {
    const payload = `event: ${event}\ndata: ${JSON.stringify({
      at: new Date().toISOString(),
    })}\n\n`;
    for (const response of clients) response.write(payload);
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-origin": "*",
      });
      response.end();
      return;
    }

    if (request.method !== "GET") {
      json(response, 405, { error: "read_only_service" });
      return;
    }

    try {
      if (url.pathname === "/health") {
        json(response, 200, {
          ok: true,
          service: "waymark",
          databasePath: resolvedDatabasePath,
        });
        return;
      }

      if (url.pathname === "/api/provider-capabilities") {
        const auditMode =
          url.searchParams.get("auditMode") ?? "task_specific";
        if (!AUDIT_MODES.has(auditMode)) {
          json(response, 400, { error: "invalid_audit_mode" });
          return;
        }
        json(
          response,
          200,
          discoverProviderCapabilities({
            ...providerCapabilityOptions,
            historicalTokenAverages: store.readCompletedTokenAverages({
              auditMode,
            }),
          }),
        );
        return;
      }

      if (url.pathname === "/api/events") {
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream",
        });
        response.write(
          `event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
        );
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }

      if (url.pathname === "/api/runs") {
        json(response, 200, store.listRuns({ limit: 100 }));
        return;
      }

      if (url.pathname === "/api/runs/summaries") {
        const runs = store.listRuns({ limit: 100 });
        json(
          response,
          200,
          runs.map((run) =>
            toRunSnapshot(store.readReport(run.id), runs.length),
          ),
        );
        return;
      }

      if (url.pathname === "/api/runs/latest") {
        const runs = store.listRuns({ limit: 500 });
        if (runs.length === 0) {
          json(response, 404, { error: "no_runs" });
          return;
        }
        json(
          response,
          200,
          toRunSnapshot(store.readReport(runs[0].id), runs.length),
        );
        return;
      }

      const eventsMatch = url.pathname.match(
        /^\/api\/runs\/([^/]+)\/events$/,
      );
      if (eventsMatch) {
        json(
          response,
          200,
          store.readEvents(decodeURIComponent(eventsMatch[1]), {
            afterSequence: Number(url.searchParams.get("after") ?? 0),
            limit: 10_000,
          }),
        );
        return;
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch) {
        json(
          response,
          200,
          store.readReport(decodeURIComponent(runMatch[1])),
        );
        return;
      }

      json(response, 404, { error: "not_found" });
    } catch (error) {
      const status =
        error?.code === "NOT_FOUND" || error?.code === "RUN_NOT_FOUND"
          ? 404
          : 500;
      json(response, status, {
        error: error?.code ?? "service_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  let signature = databaseSignature(resolvedDatabasePath);
  const changeTimer = setInterval(() => {
    const next = databaseSignature(resolvedDatabasePath);
    if (next !== signature) {
      signature = next;
      broadcast();
    }
  }, 500);
  changeTimer.unref();

  const heartbeatTimer = setInterval(() => broadcast("heartbeat"), 20_000);
  heartbeatTimer.unref();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    server,
    close: async () => {
      clearInterval(changeTimer);
      clearInterval(heartbeatTimer);
      for (const response of clients) response.end();
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  try {
    const service = await startWaymarkServer();
    process.stdout.write(`Waymark service listening at ${service.url}\n`);
    const stop = async () => {
      await service.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
