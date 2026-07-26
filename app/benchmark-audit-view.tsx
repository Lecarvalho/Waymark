"use client";

import { useRef } from "react";
import type { WaymarkRunSnapshot } from "./use-waymark-live";
import styles from "./benchmark-audit-view.module.css";
import summaryStyles from "./benchmark-summary.module.css";
import executionStyles from "./benchmark-execution.module.css";
import tokenStyles from "./benchmark-token-usage.module.css";
import evidenceStyles from "./benchmark-evidence.module.css";
import recommendationStyles from "./benchmark-recommendations.module.css";
import practiceStyles from "./benchmark-practice.module.css";

const styleMaps = [styles, summaryStyles, executionStyles, tokenStyles, evidenceStyles, recommendationStyles, practiceStyles];

function classes(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((name) => {
      const matches = styleMaps
        .map((styleMap) => styleMap[name as keyof typeof styleMap])
        .filter((match): match is string => Boolean(match));
      return matches.length > 0 ? matches : [name];
    })
    .join(" ");
}

type Phase = {
  label: string;
  detail: string;
  status: "complete" | "active" | "queued" | "failed" | "interrupted";
};

const phases: Phase[] = [
  {
    label: "Candidate run",
    detail: "Maps repository navigation evidence",
    status: "complete",
  },
  {
    label: "Blind research",
    detail: "Independently traces the same audit scope",
    status: "complete",
  },
  {
    label: "Cross-examination",
    detail: "Challenges claims and drafts recommendations",
    status: "active",
  },
  {
    label: "Verification",
    detail: "Deterministically checks repository evidence",
    status: "queued",
  },
  {
    label: "Scoring",
    detail: "Calculates the score from locked evidence",
    status: "queued",
  },
];

function participantPhaseStatus(status: string | undefined): Phase["status"] {
  if (status === "Active") return "active";
  if (status === "Complete") return "complete";
  if (status === "Failed") return "failed";
  if (status === "Interrupted") return "interrupted";
  return "queued";
}

function RunningSignal({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <span
      className={classes("running-signal")}
      data-compact={compact || undefined}
      role={compact ? undefined : "status"}
      aria-live={compact ? undefined : "polite"}
    >
      <span className={classes("running-spinner")} aria-hidden="true" />
      <span>{label}</span>
      <span className={classes("running-dots")} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

const tokenPhaseLabels = {
  candidate_navigation: "Candidate navigation",
  independent_validation: "Independent validation",
  orchestration: "Orchestration",
  deterministic_verification: "Deterministic verification",
  report_generation: "Report generation",
} as const;

function formatTokenCount(value: number | null) {
  if (value === null) return "Unavailable";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function formatTokenSource(
  source:
    | "provider_reported"
    | "measured"
    | "measured_live"
    | "estimated"
    | "mixed"
    | null,
) {
  if (source === "provider_reported") return "Provider-reported";
  if (source === "measured") return "Measured by the agent host";
  if (source === "measured_live") return "Live session telemetry";
  if (source === "estimated") return "Explicitly estimated";
  if (source === "mixed") return "Mixed measurement sources";
  return "Usage unavailable";
}

function displayRunName(name: string | undefined, task: string) {
  if (name?.trim()) return name;

  const normalized = task.replace(/\s+/g, " ").trim();
  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  const firstThought =
    sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd) : normalized;
  if (firstThought.length <= 72) return firstThought;

  const clipped = firstThought.slice(0, 73);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : 69).trimEnd()}…`;
}

type BenchmarkAuditViewProps = {
  snapshot: WaymarkRunSnapshot;
};

export function BenchmarkAuditView({ snapshot }: BenchmarkAuditViewProps) {
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const auditTask = snapshot?.task ?? "";
  const auditPhase = snapshot?.phase ?? "";
  const auditStatusLabel =
    snapshot?.status === "failed" ? "Failed" : auditPhase;
  const auditProgress = snapshot?.progress ?? 0;
  const navigability = snapshot?.metrics.navigability ?? null;
  const reliability = snapshot?.metrics.reliability ?? null;
  const candidateParticipant = snapshot?.participants.find(
    ({ role }) => role === "candidate",
  );
  const candidateTokens =
    snapshot?.metrics.candidateTokens ??
    snapshot?.tokenUsage.candidateBudget.usedTokens ??
    candidateParticipant?.tokens ??
    null;
  const candidateTokenSource =
    snapshot?.metrics.candidateTokenSource ??
    candidateParticipant?.tokenSource ??
    null;
  const totalClaims = snapshot?.metrics.totalClaims ?? 0;
  const adjudicatedClaims = snapshot?.metrics.adjudicatedClaims ?? 0;
  const openChallenges = snapshot?.metrics.openChallenges ?? 0;
  const displayedEvent = snapshot?.latestEvent ?? "";
  const phaseParticipantRoles = [
    "candidate",
    "independent",
    "orchestrator",
    "verifier",
  ] as const;
  const displayedPhases = phases.map((phase, index) => {
    if (!snapshot) return phase;
    if (snapshot.status === "completed") {
      return { ...phase, status: "complete" as const };
    }
    if (index === phases.length - 1) {
      return {
        ...phase,
        status:
          snapshot.status === "running" &&
          snapshot.phase.toLowerCase() === "scoring"
            ? ("active" as const)
            : ("queued" as const),
      };
    }
    const participant = snapshot.participants.find(
      ({ role }) => role === phaseParticipantRoles[index],
    );
    return {
      ...phase,
      status: participantPhaseStatus(participant?.status),
    };
  });
  const displayedEvidence = snapshot?.evidence ?? [];
  const displayedRecommendations = snapshot?.recommendations ?? [];
  const isGeneralAudit =
    snapshot?.auditMode === "general" ||
    snapshot?.task.includes("waymark-general-navigation@") === true;
  const probeSummary = isGeneralAudit
    ? "Seven-principle agent-readiness suite"
    : displayRunName(undefined, auditTask);
  const practiceProfile = snapshot?.practiceProfile ?? null;
  const practiceStatusCounts = practiceProfile
    ? practiceProfile.items.reduce(
        (counts, item) => {
          counts[item.status] += 1;
          return counts;
        },
        { strong: 0, mixed: 0, weak: 0, not_assessed: 0 },
      )
    : { strong: 0, mixed: 0, weak: 0, not_assessed: 0 };
  const verifiedClaims =
    snapshot?.metrics.verifiedClaims ??
    displayedEvidence.filter((row) => row.status.startsWith("Verified")).length;
  const contradictedClaims =
    snapshot?.metrics.contradictedClaims ??
    displayedEvidence.filter((row) => row.status === "Contradicted").length;
  const tokenUsage = snapshot?.tokenUsage ?? null;
  const finalizedAuditTokens = tokenUsage?.overall.totalTokens ?? null;
  const liveParticipantTokens =
    snapshot?.participants.reduce(
      (total, participant) =>
        participant.tokenSource === "measured_live" &&
        participant.tokens !== null
          ? total + participant.tokens
          : total,
      0,
    ) ?? 0;
  const hasLiveParticipantTokens =
    snapshot?.participants.some(
      (participant) =>
        participant.tokenSource === "measured_live" &&
        participant.tokens !== null,
    ) ?? false;
  const totalAuditTokens =
    finalizedAuditTokens === null && !hasLiveParticipantTokens
      ? null
      : (finalizedAuditTokens ?? 0) + liveParticipantTokens;
  const candidateBudget = tokenUsage?.candidateBudget ?? null;
  const candidateSession = tokenUsage?.candidateSession ?? null;
  const candidateTokenBreakdown =
    tokenUsage?.byPhase.find(
      (phase) => phase.phase === "candidate_navigation",
    ) ?? null;
  const executionTokenPhases = [
    "candidate_navigation",
    "independent_validation",
    "orchestration",
    "deterministic_verification",
    "report_generation",
  ] as const;
  const executionStages = displayedPhases.map((phase, index) => {
    const participantRole = phaseParticipantRoles[index];
    const participant = participantRole
      ? snapshot?.participants.find(({ role }) => role === participantRole)
      : null;
    const usage = tokenUsage?.byPhase.find(
      ({ phase: phaseName }) => phaseName === executionTokenPhases[index],
    );
    const phaseTokens = usage?.totalTokens ?? participant?.tokens ?? null;
    const isLiveTokenMeasurement =
      usage?.totalTokens === null &&
      participant?.tokenSource === "measured_live" &&
      participant.tokens !== null;
    const owner =
      index === 4
        ? "Waymark · deterministic scorer"
        : participant
          ? `${participant.role
              .split("_")
              .map((word) => word[0].toUpperCase() + word.slice(1))
              .join(" ")} · ${participant.model}`
          : index === 3
            ? "Verifier · deterministic"
            : "Owner pending";
    return {
      ...phase,
      owner,
      tokens: formatTokenCount(phaseTokens),
      tokenSource: usage?.source ?? participant?.tokenSource ?? null,
      isLiveTokenMeasurement,
    };
  });
  const cachedInputShare =
    tokenUsage?.overall.inputTokens &&
    tokenUsage.overall.cachedInputTokens !== null
      ? Math.round(
          (tokenUsage.overall.cachedInputTokens /
            tokenUsage.overall.inputTokens) *
            1000,
        ) / 10
      : null;
  const tokenCompositionTotal = finalizedAuditTokens ?? 0;
  const compositionWidth = (value: number | null) =>
    tokenCompositionTotal > 0 && value !== null
      ? `${(value / tokenCompositionTotal) * 100}%`
      : "0%";
  const candidateOverTarget =
    candidateBudget?.targetMultiple !== null &&
    candidateBudget?.targetMultiple !== undefined &&
    candidateBudget.targetMultiple > 1;
  const candidateConfidence = snapshot?.metrics.candidateConfidence ?? 0;
  const verifiedAccuracy = snapshot?.metrics.verifiedAccuracy ?? 0;
  const confidenceGap = candidateConfidence - verifiedAccuracy;
  const hasResolvedEvidence = displayedEvidence.some(
    (row) =>
      row.status.startsWith("Verified") || row.status === "Contradicted",
  );
  const showCalibrationWarning =
    !hasResolvedEvidence || confidenceGap > 5 || contradictedClaims > 0;
  const scoreDimensions = snapshot?.scoreBreakdown?.dimensions ?? [];

  return (
    <>
    <section
      className={classes("audit-hero")}
      data-status={snapshot.status}
    >
      <div className={classes("hero-copy")}>
        <div className={classes("audit-context")}>
          <span>
            {snapshot.status === "running"
              ? "Live audit"
              : "Audit report"}
          </span>
          <span aria-hidden="true">/</span>
          <strong>{auditStatusLabel}</strong>
        </div>
        <h1>
          {snapshot.status === "running"
            ? "How hard is this repository to navigate?"
            : isGeneralAudit
              ? "Repository agent-readiness report"
              : "Repository navigation report"}
        </h1>
        <details className={classes("probe-details")}>
          <summary>
            <span>
              {isGeneralAudit
                ? "General repository audit"
                : "Navigation probe"}
            </span>
            <strong>{probeSummary}</strong>
            <span className={classes("probe-details-toggle")}>Scope</span>
          </summary>
          <div className={classes("probe-details-content")}>
            <span>Full probe</span>
            <p>{auditTask}</p>
          </div>
        </details>
      </div>
        <div className={classes("hero-meta")}>
          <span>
            Started {new Date(snapshot.startedAt).toLocaleString()}
          </span>
          <span>Read-only target</span>
          <span>
            {snapshot.calibration.status ===
            "eligible_with_resource_overrun"
              ? "Benchmark valid · resource reference exceeded"
              : snapshot.calibration.status ===
                  "eligible_with_partial_budget_report"
                ? "Benchmark valid · partial budget report"
              : snapshot.calibration.eligible
                ? "Calibration eligible"
                : "Diagnostic only · protocol issue"}
          </span>
          {snapshot.status === "running" ? (
            <span>{snapshot.activeAgentCount} active agents</span>
          ) : null}
        </div>
      {snapshot.status !== "completed" ? (
        <div
          className={classes("audit-completion")}
          aria-label={`Audit ${auditProgress} percent complete`}
        >
          <div className={classes("completion-value")}>
            <span>Audit completion</span>
            <strong>{auditProgress}%</strong>
          </div>
          <div className={classes("completion-track")} aria-hidden="true">
            <span style={{ width: `${auditProgress}%` }} />
          </div>
          {snapshot.status === "running" ? (
          <RunningSignal label={`${auditPhase} in progress`} />
          ) : (
            <small>Audit failed</small>
          )}
        </div>
      ) : null}
    </section>

    <section className={classes("metric-grid")} aria-label="Audit metrics">
      <article className={classes("metric-card score-card")}>
        <div className={classes("metric-label")}>Navigability</div>
        <div className={classes("metric-value")}>
          {navigability ?? "—"}
          <span>/100</span>
        </div>
        <div className={classes("metric-foot")}>
          {navigability === null
            ? snapshot.status === "failed"
              ? "Unavailable — audit failed before scoring"
              : "Authoritative score appears after verification"
            : "Authoritative deterministic score"}
        </div>
      </article>
      <article className={classes("metric-card")}>
        <div className={classes("metric-label")}>Audit reliability</div>
        <div className={classes("metric-value")}>
          {reliability ?? "—"}
          <span>%</span>
        </div>
        <div className={classes("meter")}>
          <span style={{ width: `${reliability ?? 0}%` }} />
        </div>
        <div className={classes("metric-foot")}>
          {reliability === null
            ? snapshot.status === "failed"
              ? "Unavailable — audit failed before scoring"
              : "Pending deterministic verification"
            : reliability >= 80
              ? "Strong evidence coverage"
              : reliability >= 60
                ? "Moderate evidence coverage"
                : "Limited evidence coverage"}
        </div>
      </article>
      <article className={classes("metric-card")}>
        <div className={classes("metric-label")}>
          Candidate processed tokens
        </div>
        <div className={classes("metric-value")}>
          {candidateTokens === null
            ? "—"
            : (candidateTokens / 1000).toFixed(1)}
          {candidateTokens === null ? null : <span>k</span>}
        </div>
        <div className={classes("metric-foot token-metric-foot")}>
          <span>
            {formatTokenSource(candidateTokenSource)}
            {candidateBudget?.isForecast === false
              ? " · observed run"
              : ""}
          </span>
          {candidateBudget?.efficiencyScore !== null &&
          candidateBudget?.efficiencyScore !== undefined ? (
            <strong
              data-status={candidateOverTarget ? "over" : "within"}
            >
              Efficiency {candidateBudget.efficiencyScore}/100
            </strong>
          ) : null}
        </div>
      </article>
      <article className={classes("metric-card")}>
        <div className={classes("metric-label")}>Verified claims</div>
        <div className={classes("metric-value")}>
          {verifiedClaims}
          <span>/{totalClaims}</span>
        </div>
        <div className={classes("metric-foot")}>
          {openChallenges > 0 ? (
            <span className={classes("trend")} data-tone="warn">
              {openChallenges} open{" "}
              {openChallenges === 1 ? "challenge" : "challenges"}
            </span>
          ) : contradictedClaims > 0 ? (
            <span className={classes("trend")} data-tone="down">
              {contradictedClaims} contradicted
            </span>
          ) : (
            `${adjudicatedClaims}/${totalClaims} claims adjudicated`
          )}
        </div>
      </article>
    </section>

    {
      <section
        className={classes("live-grid")}
        data-layout={snapshot.status === "completed" ? "details" : "consolidated"}
      >
        <article className={classes("panel phase-panel execution-panel")}>
        <div className={classes("panel-heading")}>
          <div>
            <span className={classes("section-kicker")}>Execution</span>
            <h2>Audit stages and owners</h2>
          </div>
          {snapshot.status === "running" ? (
            <RunningSignal compact label="Running" />
          ) : (
            <span className={classes("running-badge")}>
              {snapshot.status === "failed" ? "Failed" : "Saved"}
            </span>
          )}
        </div>

        <ol className={classes("phase-list")}>
          {executionStages.map((phase, index) => {
            const phaseStatus = phase.status;
            return (
            <li
              className={classes("phase")}
              data-status={phaseStatus}
              key={phase.label}
            >
              <div className={classes("phase-index")}>
                {phaseStatus === "complete"
                  ? "✓"
                  : phaseStatus === "failed"
                    ? "!"
                    : phaseStatus === "interrupted"
                      ? "×"
                    : index + 1}
              </div>
              <div className={classes("phase-copy")}>
                <strong>{phase.label}</strong>
                <span>{phase.detail}</span>
                <code>{phase.owner}</code>
              </div>
              <div className={classes("phase-result")}>
                <span className={classes("phase-state")}>{phaseStatus}</span>
                <strong
                  data-status={
                    phase.isLiveTokenMeasurement ? "live" : "recorded"
                  }
                  title={formatTokenSource(phase.tokenSource)}
                >
                  {phase.tokens}
                  {phase.isLiveTokenMeasurement ? <small>live</small> : null}
                </strong>
              </div>
            </li>
            );
          })}
        </ol>

        <div
          className={classes("live-event")}
          data-status={snapshot.status === "running" ? "live" : "recorded"}
        >
          <span className={classes("event-pulse")} aria-hidden="true" />
          <div>
            <small>Latest observable event</small>
            <strong>{displayedEvent}</strong>
          </div>
          <time>
            {snapshot.status === "running" ? "Listening" : "Latest"}
          </time>
        </div>

        {tokenUsage || hasLiveParticipantTokens ? (
          <div className={classes("token-plain-language")}>
            <strong>
              {formatTokenCount(totalAuditTokens)} processed
              {hasLiveParticipantTokens ? " · live" : ""}
            </strong>
            {hasLiveParticipantTokens ? (
              <span>
                {formatTokenCount(finalizedAuditTokens)} finalized ·{" "}
                {formatTokenCount(liveParticipantTokens)} active participant
              </span>
            ) : tokenUsage ? (
              <span>
                {formatTokenCount(tokenUsage.overall.cachedInputTokens)} cached
                input ·{" "}
                {formatTokenCount(tokenUsage.overall.uncachedInputTokens)} new
                input ·{" "}
                {formatTokenCount(tokenUsage.overall.outputTokens)} output
              </span>
            ) : null}
            <small>
              {hasLiveParticipantTokens
                ? "Live total combines finalized phases with current participant session telemetry. The detailed composition settles when the active phase finishes."
                : "Processed totals accumulate across model/tool turns. Cached input is included once; this is not the active context size or a full-price token estimate."}
            </small>
          </div>
        ) : null}

        <details className={classes("run-methodology")}>
          <summary>
            <span>Token accounting and methodology</span>
            <strong>{formatTokenCount(totalAuditTokens)}</strong>
          </summary>
          <div className={classes("token-stack")}>
          <div className={classes("token-stack-head")}>
            <span>
              {hasLiveParticipantTokens
                ? "Finalized token composition"
                : "Total processed tokens"}
            </span>
            <strong>{formatTokenCount(finalizedAuditTokens)}</strong>
          </div>
          {tokenUsage ? (
            <>
              <div
                className={classes("token-composition")}
                aria-label="Cached input, uncached input, output, and unclassified token composition"
              >
                <span
                  data-token-kind="cached"
                  style={{
                    width: compositionWidth(
                      tokenUsage.overall.cachedInputTokens,
                    ),
                  }}
                />
                <span
                  data-token-kind="uncached"
                  style={{
                    width: compositionWidth(
                      tokenUsage.overall.uncachedInputTokens,
                    ),
                  }}
                />
                <span
                  data-token-kind="output"
                  style={{
                    width: compositionWidth(
                      tokenUsage.overall.outputTokens,
                    ),
                  }}
                />
                <span
                  data-token-kind="unclassified"
                  style={{
                    width: compositionWidth(
                      tokenUsage.overall.unclassifiedTokens,
                    ),
                  }}
                />
              </div>

              <div className={classes("token-breakdown-grid")}>
                <div>
                  <span>Cached input</span>
                  <strong>
                    {formatTokenCount(
                      tokenUsage.overall.cachedInputTokens,
                    )}
                  </strong>
                  <small>
                    {cachedInputShare === null
                      ? "Share unavailable"
                      : `${cachedInputShare}% of input`}
                  </small>
                </div>
                <div>
                  <span>Uncached input</span>
                  <strong>
                    {formatTokenCount(
                      tokenUsage.overall.uncachedInputTokens,
                    )}
                  </strong>
                  <small>New context processed</small>
                </div>
                <div>
                  <span>Output</span>
                  <strong>
                    {formatTokenCount(
                      tokenUsage.overall.outputTokens,
                    )}
                  </strong>
                  <small>Model-generated tokens</small>
                </div>
              </div>

              <div
                className={classes("token-budget-callout")}
                data-status={candidateOverTarget ? "over" : "within"}
              >
                <div>
                  <span>Candidate navigation budget</span>
                  <strong>
                    {formatTokenCount(
                      candidateBudget?.usedTokens ?? null,
                    )}
                    {candidateBudget?.targetTokens === null ||
                    candidateBudget?.targetTokens === undefined
                      ? ""
                      : ` / ${formatTokenCount(
                          candidateBudget.targetTokens,
                        )} target`}
                  </strong>
                </div>
                <div>
                  <strong>
                    {candidateBudget?.targetMultiple === null ||
                    candidateBudget?.targetMultiple === undefined
                      ? "Not measured"
                      : `${candidateBudget.targetMultiple.toFixed(
                          1,
                        )}× target`}
                  </strong>
                  <span>
                    {candidateBudget?.hardLimitTokens === null ||
                    candidateBudget?.hardLimitTokens === undefined
                      ? "No hard limit declared for this run"
                      : candidateBudget.hardLimitExceeded
                        ? `Hard limit ${formatTokenCount(
                            candidateBudget.hardLimitTokens,
                          )} exceeded`
                        : `Within ${formatTokenCount(
                            candidateBudget.hardLimitTokens,
                          )} hard limit`}
                  </span>
                </div>
              </div>

              <div
                className={classes("token-budget-callout")}
                data-status="within"
              >
                <div>
                  <span>Fresh-session capability</span>
                  <strong>
                    {candidateSession?.completedInSingleSession
                      ? "Completed in one session"
                      : snapshot.status === "failed"
                        ? "Did not complete"
                        : "In progress"}
                  </strong>
                </div>
                <div>
                  <strong>
                    {formatTokenCount(
                      candidateSession?.effectiveContextTokens ?? null,
                    )}{" "}
                    effective context
                  </strong>
                  <span>
                    {candidateSession?.processedSessionEquivalents ===
                      null ||
                    candidateSession?.processedSessionEquivalents ===
                      undefined
                      ? "Processed-session equivalent pending"
                      : `${candidateSession.processedSessionEquivalents.toFixed(
                          2,
                        )}× capacity processed cumulatively`}
                  </span>
                </div>
              </div>

              <div className={classes("token-methodology")}>
                <div className={classes("token-methodology-heading")}>
                  <div>
                    <span className={classes("section-kicker")}>
                      Candidate efficiency calculation
                    </span>
                    <strong>
                      {candidateBudget?.efficiencyScore === null ||
                      candidateBudget?.efficiencyScore === undefined
                        ? "Not eligible for scoring"
                        : `${candidateBudget.efficiencyScore}/100`}
                    </strong>
                  </div>
                  <span className={classes("methodology-state")}>
                    Observed, not forecast
                  </span>
                </div>
                <code className={classes("token-equation")}>
                  {candidateBudget?.usedTokens === null ||
                  candidateBudget?.usedTokens === undefined ||
                  candidateBudget?.targetTokens === null ||
                  candidateBudget?.targetTokens === undefined
                    ? candidateBudget?.scoreFormula ??
                      "Token formula unavailable"
                    : `min(100, ${candidateBudget.targetTokens.toLocaleString()} ÷ max(${candidateBudget.usedTokens.toLocaleString()}, ${candidateBudget.targetTokens.toLocaleString()}) × 100) = ${
                        candidateBudget.efficiencyScore ?? "ineligible"
                      }`}
                </code>
                <div className={classes("candidate-token-grid")}>
                  <div>
                    <span>Processed</span>
                    <strong>
                      {formatTokenCount(
                        candidateTokenBreakdown?.totalTokens ?? null,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Input</span>
                    <strong>
                      {formatTokenCount(
                        candidateTokenBreakdown?.inputTokens ?? null,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Cached subset</span>
                    <strong>
                      {formatTokenCount(
                        candidateTokenBreakdown?.cachedInputTokens ??
                          null,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Uncached input</span>
                    <strong>
                      {formatTokenCount(
                        candidateTokenBreakdown?.uncachedInputTokens ??
                          null,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Output</span>
                    <strong>
                      {formatTokenCount(
                        candidateTokenBreakdown?.outputTokens ?? null,
                      )}
                    </strong>
                  </div>
                </div>
                <dl className={classes("token-methodology-notes")}>
                  <div>
                    <dt>Target basis</dt>
                    <dd>
                      {candidateBudget?.targetBasis === "run_declared"
                        ? "Declared policy target for this run"
                        : candidateBudget?.targetBasis ===
                            "rubric_default"
                          ? "Default target from the scored rubric"
                          : "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>Measurement</dt>
                    <dd>
                      {candidateBudget?.measurementMethod ??
                        "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>Scope</dt>
                    <dd>
                      {candidateBudget?.measurementScope ??
                        "Unavailable"}
                      </dd>
                  </div>
                  <div>
                    <dt>Current context occupancy</dt>
                    <dd>
                      {candidateSession?.currentContextTokens ===
                        null ||
                      candidateSession?.currentContextTokens ===
                        undefined
                        ? "Waiting for provider session telemetry"
                        : `${formatTokenCount(
                            candidateSession.currentContextTokens,
                          )}${
                            candidateSession.currentContextPercent ===
                              null ||
                            candidateSession.currentContextPercent ===
                              undefined
                              ? ""
                              : ` · ${candidateSession.currentContextPercent.toFixed(
                                  1,
                                )}%`
                          }`}
                    </dd>
                  </div>
                  <div>
                    <dt>Peak context occupancy</dt>
                    <dd>
                      {candidateSession?.peakContextTokens === null ||
                      candidateSession?.peakContextTokens === undefined
                        ? `Unavailable · ${
                            candidateSession?.telemetryReason ??
                            "not recorded"
                          }`
                        : `${formatTokenCount(
                            candidateSession.peakContextTokens,
                          )} · provider session log`}
                    </dd>
                  </div>
                  <div>
                    <dt>Context capability source</dt>
                    <dd>
                      {candidateSession?.capabilitySource ??
                        "Unavailable"}
                    </dd>
                  </div>
                </dl>
                <p>
                  Processed tokens equal input plus output. Cached input
                  is already included in input and is not added again.
                  Cumulative processed tokens are work/cost, not peak
                  context occupancy. Single-session completion proves
                  capability; context pressure comes from normalized
                  local provider-session snapshots when available.
                </p>
              </div>

              <div className={classes("token-phase-list")}>
                <div className={classes("token-phase-heading")}>
                  <span>Audit phase</span>
                  <span>Processed</span>
                </div>
                {tokenUsage.byPhase.map((phase) => (
                  <div key={phase.phase}>
                    <span>{tokenPhaseLabels[phase.phase]}</span>
                    <strong>
                      {formatTokenCount(phase.totalTokens)}
                    </strong>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          </div>
        </details>
      </article>
      </section>
    }

    <dialog
      className={classes("evidence-dialog")}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          evidenceDialog.current?.close();
        }
      }}
      ref={evidenceDialog}
    >
      <div className={classes("evidence-dialog-frame")}>
        <div className={classes("evidence-dialog-heading")}>
          <div>
            <span className={classes("section-kicker")}>Audit validation</span>
            <h2>Evidence behind the score</h2>
            <p>
              These navigation claims let validators reproduce and
              challenge the score. Probe-feature findings stay in the
              validator record and are not recommendation evidence.
            </p>
          </div>
          <button
            aria-label="Close audit evidence"
            className={classes("evidence-dialog-close")}
            onClick={() => evidenceDialog.current?.close()}
            type="button"
          >
            ×
          </button>
        </div>
      <section className={classes("evidence-grid")}>
      <article className={classes("panel evidence-panel")}>
        <div className={classes("panel-heading")}>
          <div>
            <span className={classes("section-kicker")}>Truth ledger</span>
            <h2>
              {snapshot.status === "completed"
                ? "Verified evidence"
                : "Evidence under review"}
            </h2>
          </div>
          <span className={classes("muted-action")}>
            {totalClaims} total claims
          </span>
        </div>

        <div className={classes("evidence-table")} role="table">
          <div className={classes("evidence-header")} role="row">
            <span role="columnheader">Claim</span>
            <span role="columnheader">Strongest evidence</span>
            <span role="columnheader">Status</span>
          </div>
          {displayedEvidence.length === 0 ? (
            <div className={classes("empty-table-state")}>
              No claims have been recorded for this audit.
            </div>
          ) : (
            displayedEvidence.map((row) => (
              <div className={classes("evidence-row")} role="row" key={row.claim}>
                <div className={classes("evidence-claim")} role="cell">
                  <strong>{row.claim}</strong>
                  {row.challenge ? (
                    <details className={classes("evidence-challenge")}>
                      <summary>
                        {row.challenge.status === "resolved"
                          ? "Qualification"
                          : "Open challenge"}
                      </summary>
                      <p>
                        {row.challenge.status === "resolved"
                          ? (row.challenge.resolution ??
                            "Challenge resolved.")
                          : (row.challenge.issue ??
                            "Challenge remains open.")}
                      </p>
                    </details>
                  ) : null}
                </div>
                <code role="cell">{row.source}</code>
                <span
                  className={classes("evidence-status")}
                  data-tone={row.tone}
                  role="cell"
                >
                  {row.status}
                </span>
              </div>
            ))
          )}
        </div>
      </article>

      <article className={classes("panel confidence-panel")}>
        <div className={classes("panel-heading")}>
          <div>
            <span className={classes("section-kicker")}>Score basis</span>
            <h2>Why {navigability}/100</h2>
          </div>
          <div className={classes("calibration-summary")}>
            <span>Confidence {candidateConfidence}%</span>
            <span>Verified {verifiedAccuracy}%</span>
          </div>
        </div>
        {showCalibrationWarning ? (
          <>
        <div className={classes("confidence-visual")}>
          <div className={classes("confidence-row")}>
            <span>Agent confidence</span>
            <div className={classes("confidence-track")}>
              <i
                className={classes("claimed")}
                style={{ width: `${candidateConfidence}%` }}
              />
            </div>
            <strong>{candidateConfidence}%</strong>
          </div>
          <div className={classes("confidence-row")}>
            <span>Verified accuracy</span>
            <div className={classes("confidence-track")}>
              <i
                className={classes("verified")}
                style={{ width: `${verifiedAccuracy}%` }}
              />
            </div>
            <strong>{verifiedAccuracy}%</strong>
          </div>
        </div>
        <div className={classes("calibration-callout")}>
          <span>
            {hasResolvedEvidence
              ? `${confidenceGap > 0 ? "−" : "+"}${Math.abs(
                  confidenceGap,
                )} pts`
              : "Pending"}
          </span>
          <p>
            {hasResolvedEvidence
              ? confidenceGap > 0
                ? "Candidate confidence is ahead of verified accuracy."
                : "Verified accuracy meets or exceeds candidate confidence."
              : "No claim has a deterministic verdict yet, so calibration cannot be measured."}
          </p>
        </div>
          </>
        ) : null}

        {scoreDimensions.length > 0 ? (
          <div className={classes("score-breakdown")}>
            <div className={classes("score-breakdown-heading")}>
              <div>
                <span className={classes("section-kicker")}>Dimensions</span>
                <h3>Weighted breakdown</h3>
              </div>
              <span>
                {snapshot.scoreBreakdown.adequacyPassed
                  ? "Adequacy passed"
                  : "Adequacy not met"}
              </span>
            </div>
            <div className={classes("score-dimension-list")}>
              {scoreDimensions.map((dimension) => (
                <div className={classes("score-dimension")} key={dimension.key}>
                  <span>{dimension.label}</span>
                  <div aria-hidden="true">
                    <i style={{ width: `${dimension.score}%` }} />
                  </div>
                  <strong>{dimension.score}</strong>
                  <small>
                    {Math.round(dimension.weight * 100)}% weight
                  </small>
                </div>
              ))}
            </div>
            <p>
              Navigability scores path-finding quality. The separate
              observed candidate token-efficiency score is{" "}
              {candidateBudget?.efficiencyScore ?? "unavailable"}/100;
              it compares this isolated run with its declared target,
              not with a forecast.
            </p>
          </div>
        ) : null}
      </article>
      </section>
      </div>
    </dialog>

      {isGeneralAudit ? (
        <section className={classes("panel general-practice-panel")}>
          <div className={classes("panel-heading")}>
            <div>
              <span className={classes("section-kicker")}>
                General repository audit
              </span>
              <h2>Seven-principle agent-readiness profile</h2>
            </div>
            <span className={classes("muted-action")}>
              {practiceProfile?.available
                ? `${practiceProfile.assessedCount}/${practiceProfile.totalCount} assessed`
                : "Profile unavailable"}
            </span>
          </div>

          {practiceProfile?.available ? (
            <>
              <div
                className={classes("practice-profile-summary")}
                aria-label="Practice profile summary"
              >
                <span data-status="strong">
                  <strong>{practiceStatusCounts.strong}</strong> strong
                </span>
                <span data-status="mixed">
                  <strong>{practiceStatusCounts.mixed}</strong> mixed
                </span>
                <span data-status="weak">
                  <strong>{practiceStatusCounts.weak}</strong> weak
                </span>
                <span data-status="not_assessed">
                  <strong>{practiceStatusCounts.not_assessed}</strong>{" "}
                  not assessed
                </span>
              </div>

              <div className={classes("practice-profile-list")}>
                {practiceProfile.items.map((item) => (
                  <details
                    className={classes("practice-profile-item")}
                    data-status={item.status}
                    key={item.practiceId}
                  >
                    <summary>
                      <span className={classes("practice-profile-number")}>
                        {item.practiceId}
                      </span>
                      <span className={classes("practice-profile-copy")}>
                        <strong>{item.title}</strong>
                        <small>{item.assessment}</small>
                      </span>
                      <span className={classes("practice-profile-status")}>
                        {item.status === "not_assessed"
                          ? "Not assessed"
                          : item.status}
                      </span>
                      <span aria-hidden="true">+</span>
                    </summary>
                    <div className={classes("practice-profile-detail")}>
                      <section>
                        <h3>Navigation-token effect</h3>
                        <p>{item.tokenImpact}</p>
                      </section>

                      <section>
                        <h3>Verified repository evidence</h3>
                        {item.evidence.length > 0 ? (
                          <ul className={classes("practice-profile-evidence")}>
                            {item.evidence.map((evidence, index) => (
                              <li
                                key={`${evidence.path}-${evidence.startLine}-${index}`}
                              >
                                <code>
                                  {evidence.path}
                                  {evidence.startLine
                                    ? `:${evidence.startLine}`
                                    : ""}
                                </code>
                                <span>{evidence.assertion}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No verified evidence was available.</p>
                        )}
                      </section>

                      {item.recommendations.length > 0 ? (
                        <section>
                          <h3>Linked improvements</h3>
                          <ul className={classes("practice-profile-links")}>
                            {item.recommendations.map(
                              (recommendation) => (
                                <li key={recommendation.id}>
                                  <a
                                    href={`#recommendation-${recommendation.id}`}
                                  >
                                    <span>
                                      {recommendation.priority}
                                    </span>
                                    {recommendation.title}
                                  </a>
                                </li>
                              ),
                            )}
                          </ul>
                        </section>
                      ) : null}

                      {item.limitations.length > 0 ? (
                        <section>
                          <h3>Coverage limits</h3>
                          <ul>
                            {item.limitations.map((limitation) => (
                              <li key={limitation}>{limitation}</li>
                            ))}
                          </ul>
                        </section>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            </>
          ) : (
            <div className={classes("practice-profile-legacy")}>
              <strong>This saved report uses the earlier general probe.</strong>
              <p>
                {practiceProfile?.reason ??
                  "This report predates the seven-principle general-audit profile. Run a new General repository audit to assess every Practice Guide principle."}
              </p>
            </div>
          )}
        </section>
      ) : null}

      <section className={classes("panel recommendation-panel")}>
      <div className={classes("panel-heading")}>
        <div>
          <span className={classes("section-kicker")}>
            {isGeneralAudit ? "Improvement backlog" : "Primary outcome"}
          </span>
          <h2>
            {isGeneralAudit
              ? "Prioritized repository improvements"
              : "How to improve token efficiency"}
          </h2>
        </div>
        <div className={classes("recommendation-header-actions")}>
          <span className={classes("muted-action")}>
            {displayedRecommendations.length} prioritized
          </span>
          <button
            className={classes("evidence-button")}
            onClick={() => evidenceDialog.current?.showModal()}
            type="button"
          >
            Audit evidence
            <span>{totalClaims}</span>
          </button>
        </div>
      </div>
      <div className={classes("recommendation-list")}>
        {displayedRecommendations.length === 0 ? (
          <div className={classes("empty-report-state")}>
            Navigability recommendations will appear after the reporter
            converts verified navigation friction into repository
            changes.
          </div>
        ) : (
          displayedRecommendations.map((item) => (
            <details
              className={classes("recommendation-detail")}
              id={`recommendation-${item.id}`}
              key={item.id}
            >
              <summary>
                <span className={classes("priority")}>{item.priority}</span>
                <div className={classes("recommendation-copy")}>
                  <h3>{item.title}</h3>
                  <p>{item.problem ?? item.description}</p>
                  {item.change ? (
                    <p className={classes("recommendation-action-preview")}>
                      <strong>Improve:</strong> {item.change}
                    </p>
                  ) : null}
                </div>
                <div className={classes("recommendation-summary-meta")}>
                  <strong>
                    {item.evidence.length > 0
                      ? "Evidence linked"
                      : "Evidence pending"}
                  </strong>
                  {item.effort ? <span>{item.effort}</span> : null}
                </div>
                <span
                  className={classes("recommendation-toggle")}
                  aria-hidden="true"
                >
                  +
                </span>
              </summary>

              <div className={classes("recommendation-detail-body")}>
                {item.tokenMechanism ? (
                  <section className={classes("recommendation-token-effect")}>
                    <h4>Why this should reduce navigation tokens</h4>
                    <p>{item.tokenMechanism}</p>
                  </section>
                ) : null}

                {item.repositoryChanges.length > 0 ? (
                  <section className={classes("recommendation-steps")}>
                    <h4>What to change in the repository</h4>
                    <ol>
                      {item.repositoryChanges.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {item.validationChecks.length > 0 ? (
                  <section className={classes("recommendation-checks")}>
                    <h4>How to verify navigation improved</h4>
                    <ul>
                      {item.validationChecks.map((check) => (
                        <li key={check}>{check}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {item.limitations.length > 0 ? (
                  <section className={classes("recommendation-limitations")}>
                    <h4>Known limitations</h4>
                    <ul>
                      {item.limitations.map((limitation) => (
                        <li key={limitation}>{limitation}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

              </div>
            </details>
          ))
        )}
      </div>
      </section>

    </>
  );
}
