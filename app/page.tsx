"use client";

import { useState } from "react";
import { useWaymarkLive } from "./use-waymark-live";

type Phase = {
  label: string;
  detail: string;
  status: "complete" | "active" | "queued" | "failed" | "interrupted";
};

const phases: Phase[] = [
  {
    label: "Candidate run",
    detail: "The candidate maps the requested change",
    status: "complete",
  },
  {
    label: "Blind research",
    detail: "Independent agents trace the same task",
    status: "complete",
  },
  {
    label: "Cross-examination",
    detail: "Claims and assumptions are challenged",
    status: "active",
  },
  {
    label: "Verification",
    detail: "Evidence is checked against the repository",
    status: "queued",
  },
  {
    label: "Scoring",
    detail: "The locked evidence produces the final score",
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

const activePhaseByRole: Record<string, string> = {
  candidate: "Candidate run",
  independent: "Blind research",
  orchestrator: "Cross-examination",
  verifier: "Verification",
  reporter: "Scoring",
};

const practicePairs = [
  {
    number: "01",
    title: "Organize around behavior",
    principle:
      "Keep the files needed for one change near each other so the agent can build a complete mental model with fewer searches.",
    goodTitle: "Domain and feature modules",
    goodExample:
      "src/orders/\n  create-order.ts\n  cancel-order.ts\n  order-repository.ts\n\nsrc/payments/\n  collect-payment.ts\n  payment-provider.ts",
    badTitle: "Layer-wide dumping grounds",
    badExample:
      "src/\n  controllers/\n  services/\n  repositories/\n  helpers/\n  models/",
  },
  {
    number: "02",
    title: "Make dependency direction explicit",
    principle:
      "Agents should be able to predict what a component may import before opening every file.",
    goodTitle: "Stable inward dependencies",
    goodExample:
      "API → Application → Domain\n          ↓\n    Infrastructure\n\nDomain owns interfaces.\nInfrastructure implements them.",
    badTitle: "Hidden and mixed dependencies",
    badExample:
      "HTTP handling + SQL + business rules\ninside one function\n\nGlobal database\nGlobal current user\nCircular service imports",
  },
  {
    number: "03",
    title: "Name files for the concept they own",
    principle:
      "Precise names give search and retrieval systems useful signals. Generic names create expensive ambiguity.",
    goodTitle: "Specific and cohesive",
    goodExample:
      "calculate-refund.ts\nrefund-policy.ts\nrefund-repository.ts\nissue-refund.test.ts",
    badTitle: "Generic and overloaded",
    badExample:
      "helpers.ts\nutils.ts\ncommon.ts\nmisc.ts\nmanager.ts",
  },
  {
    number: "04",
    title: "Provide one canonical workflow",
    principle:
      "There should be one obvious command for setup, verification, and development—shared by humans, agents, and CI.",
    goodTitle: "One executable contract",
    goodExample:
      "make setup\nmake dev\nmake test\nmake lint\nmake typecheck\nmake verify",
    badTitle: "Conflicting sources of truth",
    badExample:
      "README: npm test\nCI: pnpm run test:ci\nDeveloper script: yarn verify\nPackage: ./check-new.sh",
  },
  {
    number: "05",
    title: "Put instructions close to the code",
    principle:
      "Repository-wide rules belong at the root; unusual domain constraints belong beside the affected module.",
    goodTitle: "Scoped, accurate guidance",
    goodExample:
      "AGENTS.md\nsrc/billing/AGENTS.md\n\n• Monetary values use integer cents\n• Payment operations are idempotent\n• Run make verify",
    badTitle: "Distant or stale knowledge",
    badExample:
      "One enormous wiki page\nUndocumented payment rules\nDead setup commands\nComments that contradict CI",
  },
  {
    number: "06",
    title: "Make tests mirror behavior",
    principle:
      "The agent should find the correct feedback loop from the implementation path without searching the whole repository.",
    goodTitle: "Predictable test mapping",
    goodExample:
      "src/orders/create-order.ts\nsrc/orders/create-order.test.ts\n\ntests/integration/orders-api.test.ts\ntests/end-to-end/checkout.test.ts",
    badTitle: "Anonymous test inventory",
    badExample:
      "tests/test1.ts\ntests/test-new.ts\ntests/regression-final.ts\ntests/misc-tests.ts",
  },
  {
    number: "07",
    title: "Separate generated and external code",
    principle:
      "Agents must know which files express product intent and which will be overwritten or should not be edited.",
    goodTitle: "Visible ownership boundaries",
    goodExample:
      "src/          # hand-written\ngenerated/    # do not edit\nvendor/       # external\nthird_party/  # external",
    badTitle: "Everything mixed together",
    badExample:
      "src/hand-written.ts\nsrc/generated-file.ts\nsrc/copied-library-with-local-edits.ts",
  },
];

const agentQuestions = [
  "Where does this behavior live?",
  "What is allowed to depend on what?",
  "How do I run and test it?",
  "Which conventions must I follow?",
  "What else could this change break?",
];

const recommendedTree = `project/
├── README.md
├── AGENTS.md
├── ARCHITECTURE.md
├── .env.example
├── Makefile
├── docs/
│   ├── decisions/
│   └── runbooks/
├── src/
│   ├── accounts/
│   │   ├── README.md
│   │   ├── domain/
│   │   ├── application/
│   │   ├── infrastructure/
│   │   └── tests/
│   └── billing/
├── tests/
│   ├── integration/
│   └── end-to-end/
├── scripts/
├── migrations/
├── fixtures/
└── generated/`;

const hostileTree = `project/
├── app-new.ts
├── app-final.ts
├── app-final-fixed.ts
├── common/
│   ├── helpers.ts
│   └── utils.ts
├── old/
├── backup/
├── temp/
├── services/
│   └── service.ts     # 8,000 lines
├── config.ts          # globals + secrets
├── tests.ts
└── README.md          # stale`;

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
    | "estimated"
    | "mixed"
    | null,
) {
  if (source === "provider_reported") return "Provider-reported";
  if (source === "measured") return "Measured by the agent host";
  if (source === "estimated") return "Explicitly estimated";
  if (source === "mixed") return "Mixed measurement sources";
  return "Usage unavailable";
}

export default function Home() {
  const [view, setView] = useState<"live" | "history" | "guide">("live");
  const [reportSection, setReportSection] = useState<
    "progress" | "evidence" | "recommendations"
  >("progress");
  const [openPractice, setOpenPractice] = useState("01");
  const [structureView, setStructureView] = useState<
    "recommended" | "hostile"
  >("recommended");
  const { snapshot, history, connection } = useWaymarkLive();

  const repositoryName = snapshot?.repository.name ?? "No audit selected";
  const repositoryCommit = snapshot?.repository.commit ?? "—";
  const auditTask = snapshot?.task ?? "";
  const auditPhase = snapshot?.phase ?? "";
  const auditStatusLabel =
    snapshot?.status === "failed" ? "Failed" : auditPhase;
  const auditProgress = snapshot?.progress ?? 0;
  const navigability = snapshot?.metrics.navigability ?? null;
  const reliability = snapshot?.metrics.reliability ?? null;
  const candidateTokens = snapshot?.metrics.candidateTokens ?? null;
  const candidateTokenSource =
    snapshot?.metrics.candidateTokenSource ?? null;
  const totalClaims = snapshot?.metrics.totalClaims ?? 0;
  const claimsChallenged = snapshot?.metrics.claimsChallenged ?? 0;
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
  const displayedAgents = snapshot
    ? snapshot.participants
        .filter((participant) =>
          ["candidate", "orchestrator", "independent"].includes(
            participant.role,
          ),
        )
        .map((participant, index) => ({
          role: participant.role
            .split("_")
            .map((word) => word[0].toUpperCase() + word.slice(1))
            .join(" "),
          model: participant.model,
          status: participant.status,
          accent:
            participant.status === "Failed"
              ? "red"
              : participant.status === "Interrupted"
                ? "amber"
                : (["blue", "lime", "amber"][index] ?? "blue"),
          tokens:
            participant.tokens === null
              ? "Unavailable"
              : formatTokenCount(participant.tokens),
          note: `${participant.provider} · ${
            participant.tokenSource === "provider_reported"
              ? "provider-reported"
              : participant.tokenSource === "measured"
                ? "host-measured"
                : participant.tokenSource === "estimated"
                  ? "estimated"
                  : participant.tokenSource === "mixed"
                    ? "mixed sources"
                    : "usage unavailable"
          } · ${
            participant.status === "Active"
              ? (activePhaseByRole[participant.role] ?? snapshot.phase)
              : participant.status
          }`,
        }))
    : [];
  const displayedEvidence = snapshot?.evidence ?? [];
  const displayedRecommendations = snapshot?.recommendations ?? [];
  const tokenUsage = snapshot?.tokenUsage ?? null;
  const totalAuditTokens = tokenUsage?.overall.totalTokens ?? null;
  const candidateBudget = tokenUsage?.candidateBudget ?? null;
  const cachedInputShare =
    tokenUsage?.overall.inputTokens &&
    tokenUsage.overall.cachedInputTokens !== null
      ? Math.round(
          (tokenUsage.overall.cachedInputTokens /
            tokenUsage.overall.inputTokens) *
            1000,
        ) / 10
      : null;
  const tokenCompositionTotal = totalAuditTokens ?? 0;
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
  const scoreDimensions = snapshot?.scoreBreakdown?.dimensions ?? [];
  const scoredHistory = history.filter(
    (run) => run.metrics.navigability !== null,
  );
  const historyChange =
    scoredHistory.length > 1
      ? (scoredHistory[0].metrics.navigability ?? 0) -
        (scoredHistory.at(-1)?.metrics.navigability ?? 0)
      : null;
  const modelScores = Array.from(
    scoredHistory.reduce((models, run) => {
      const model = run.models.candidate;
      const scores = models.get(model) ?? [];
      scores.push(run.metrics.navigability ?? 0);
      models.set(model, scores);
      return models;
    }, new Map<string, number[]>()),
  ).map(([model, scores]) => ({
    model,
    score: Math.round(
      scores.reduce((total, score) => total + score, 0) / scores.length,
    ),
  }));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            W
          </span>
          <span>Waymark</span>
        </div>

        <nav aria-label="Primary navigation">
          <button
            className={`nav-item ${view === "live" ? "active" : ""}`}
            onClick={() => setView("live")}
            type="button"
          >
            <span className="nav-symbol">◎</span>
            Live audit
          </button>
          <button
            className={`nav-item ${view === "history" ? "active" : ""}`}
            onClick={() => setView("history")}
            type="button"
          >
            <span className="nav-symbol">↗</span>
            Run history
          </button>
          <button
            className={`nav-item ${view === "guide" ? "active" : ""}`}
            onClick={() => setView("guide")}
            type="button"
          >
            <span className="nav-symbol">§</span>
            Practice guide
          </button>
          <button className="nav-item" disabled type="button">
            <span className="nav-symbol">◇</span>
            Benchmarks
            <span className="soon">Soon</span>
          </button>
        </nav>

          <div className="sidebar-foot">
            <div className="archive-status">
            <span className="database-icon" aria-hidden="true" />
            <div>
              <strong>Local archive</strong>
              <span>{history.length} reports in SQLite</span>
            </div>
          </div>
          <div className="prototype-note">
            <span>
              {connection === "live" ? "Local service" : "Service status"}
            </span>
            {connection === "live"
              ? "Showing SQLite data only"
              : connection === "connecting"
                ? "Connecting to SQLite"
                : "Local service offline"}
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="repo-switcher">
            <span className="repo-label">Repository</span>
            <strong>{repositoryName}</strong>
            <code>{repositoryCommit}</code>
          </div>
          <div className="topbar-actions">
            <span className="local-pill">
              <i
                className={connection === "live" ? "" : "is-offline"}
                aria-hidden="true"
              />
              {connection === "live"
                ? "Local service"
                : connection === "connecting"
                  ? "Connecting"
                  : "Service offline"}
            </span>
            <div
              className="pairing-status"
              title="Audit input comes from the paired coding agent"
            >
              <span className="pairing-mark" aria-hidden="true">
                CX
              </span>
              <span className="pairing-agent">
                <small>{snapshot ? "Paired session" : "Coding agent"}</small>
                <strong>{snapshot?.agentHost ?? "Awaiting audit"}</strong>
              </span>
              <i
                className={`pairing-state ${snapshot ? "" : "is-idle"}`}
                aria-label={snapshot ? "Audit connected" : "No active audit"}
              />
            </div>
          </div>
        </header>

        {view === "live" ? (
          snapshot ? (
          <div className="page-content">
            <section className="audit-hero">
              <div className="hero-copy">
                <div className="audit-context">
                  <span>Live audit</span>
                  <span aria-hidden="true">/</span>
                  <strong>{auditStatusLabel}</strong>
                </div>
                <h1>How hard is this change to understand?</h1>
                <p>
                  Simulating: “{auditTask}”
                </p>
                <div className="hero-meta">
                  <span>
                    Started {new Date(snapshot.startedAt).toLocaleString()}
                  </span>
                  <span>Read-only target</span>
                  <span>{snapshot.activeAgentCount} active agents</span>
                </div>
                <div className="agent-source-note">
                  <span aria-hidden="true">↳</span>
                  <p>
                    <strong>Controlled from your coding agent.</strong> Prompts
                    stay in Codex, Claude Code, or another paired session;
                    Waymark observes progress and preserves the report.
                  </p>
                </div>
              </div>
              <div
                className="audit-completion"
                aria-label={`Audit ${auditProgress} percent complete`}
              >
                <div className="completion-value">
                  <span>Audit completion</span>
                  <strong>{auditProgress}%</strong>
                </div>
                <div className="completion-track" aria-hidden="true">
                  <span style={{ width: `${auditProgress}%` }} />
                </div>
                <small>
                  {snapshot.status === "completed"
                    ? "Audit complete"
                    : snapshot.status === "failed"
                      ? "Audit failed"
                      : `${auditPhase} in progress`}
                </small>
              </div>
            </section>

            <section className="metric-grid" aria-label="Audit metrics">
              <article className="metric-card score-card">
                <div className="metric-label">Navigability</div>
                <div className="metric-value">
                  {navigability ?? "—"}
                  <span>/100</span>
                </div>
                <div className="metric-foot">
                  {navigability === null
                    ? "Authoritative score appears after verification"
                    : "Authoritative deterministic score"}
                </div>
              </article>
              <article className="metric-card">
                <div className="metric-label">Audit reliability</div>
                <div className="metric-value">
                  {reliability ?? "—"}
                  <span>%</span>
                </div>
                <div className="meter">
                  <span style={{ width: `${reliability ?? 0}%` }} />
                </div>
                <div className="metric-foot">
                  {reliability === null
                    ? "Pending deterministic verification"
                    : reliability >= 80
                      ? "Strong evidence coverage"
                      : reliability >= 60
                        ? "Moderate evidence coverage"
                        : "Limited evidence coverage"}
                </div>
              </article>
              <article className="metric-card">
                <div className="metric-label">
                  Candidate navigation tokens
                </div>
                <div className="metric-value">
                  {candidateTokens === null
                    ? "—"
                    : (candidateTokens / 1000).toFixed(1)}
                  {candidateTokens === null ? null : <span>k</span>}
                </div>
                <div className="metric-foot token-metric-foot">
                  <span>{formatTokenSource(candidateTokenSource)}</span>
                  {candidateBudget?.efficiencyScore !== null &&
                  candidateBudget?.efficiencyScore !== undefined ? (
                    <strong
                      className={
                        candidateOverTarget ? "is-over" : "is-within"
                      }
                    >
                      Efficiency {candidateBudget.efficiencyScore}/100
                    </strong>
                  ) : null}
                </div>
              </article>
              <article className="metric-card">
                <div className="metric-label">Claims challenged</div>
                <div className="metric-value">
                  {claimsChallenged}
                  <span>/{totalClaims}</span>
                </div>
                <div className="metric-foot">
                  <span className="trend warn">{openChallenges} open</span>
                  {Math.max(0, claimsChallenged - openChallenges)} resolved
                </div>
              </article>
            </section>

            <nav className="report-tabs" aria-label="Audit report sections">
              <button
                className={reportSection === "progress" ? "active" : ""}
                onClick={() => setReportSection("progress")}
                type="button"
              >
                Progress
                <span>{snapshot.activeAgentCount} active</span>
              </button>
              <button
                className={reportSection === "evidence" ? "active" : ""}
                onClick={() => setReportSection("evidence")}
                type="button"
              >
                Evidence
                <span>{totalClaims} claims</span>
              </button>
              <button
                className={reportSection === "recommendations" ? "active" : ""}
                onClick={() => setReportSection("recommendations")}
                type="button"
              >
                Recommendations
                <span>{displayedRecommendations.length} findings</span>
              </button>
            </nav>

            {reportSection === "progress" && (
              <section className="live-grid">
              <article className="panel phase-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">Pipeline</span>
                    <h2>Audit progress</h2>
                  </div>
                  <span className="running-badge">
                    {snapshot.status === "running"
                      ? "Live updates"
                      : snapshot.status === "failed"
                        ? "Failed"
                        : "Saved"}
                  </span>
                </div>

                <ol className="phase-list">
                  {displayedPhases.map((phase, index) => {
                    const phaseStatus = phase.status;
                    return (
                    <li className={`phase ${phaseStatus}`} key={phase.label}>
                      <div className="phase-index">
                        {phaseStatus === "complete"
                          ? "✓"
                          : phaseStatus === "failed"
                            ? "!"
                            : phaseStatus === "interrupted"
                              ? "×"
                            : index + 1}
                      </div>
                      <div className="phase-copy">
                        <strong>{phase.label}</strong>
                        <span>{phase.detail}</span>
                      </div>
                      <span className="phase-state">{phaseStatus}</span>
                    </li>
                    );
                  })}
                </ol>

                <div
                  className={`live-event ${
                    snapshot.status === "running" ? "is-live" : ""
                  }`}
                >
                  <span className="event-pulse" aria-hidden="true" />
                  <div>
                    <small>Latest observable event</small>
                    <strong>{displayedEvent}</strong>
                  </div>
                  <time>now</time>
                </div>
              </article>

              <article className="panel agent-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">Research team</span>
                    <h2>Agent activity</h2>
                  </div>
                  <span className="running-badge">
                    {snapshot.activeAgentCount} active
                  </span>
                </div>

                <div className="agent-list">
                  {displayedAgents.map((agent) => (
                    <div className="agent-row" key={agent.role}>
                      <div className={`agent-avatar ${agent.accent}`}>
                        {agent.role
                          .split(" ")
                          .map((word) => word[0])
                          .join("")}
                      </div>
                      <div className="agent-copy">
                        <div>
                          <strong>{agent.role}</strong>
                          <span className={`agent-status ${agent.accent}`}>
                            {agent.status}
                          </span>
                        </div>
                        <code>{agent.model}</code>
                        <p>{agent.note}</p>
                      </div>
                      <div className="agent-tokens">
                        <strong>{agent.tokens}</strong>
                        <span>tokens</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="token-stack">
                  <div className="token-stack-head">
                    <span>Total processed tokens</span>
                    <strong>{formatTokenCount(totalAuditTokens)}</strong>
                  </div>
                  {tokenUsage ? (
                    <>
                      <div
                        className="token-composition"
                        aria-label="Cached input, uncached input, output, and unclassified token composition"
                      >
                        <span
                          className="is-cached"
                          style={{
                            width: compositionWidth(
                              tokenUsage.overall.cachedInputTokens,
                            ),
                          }}
                        />
                        <span
                          className="is-uncached"
                          style={{
                            width: compositionWidth(
                              tokenUsage.overall.uncachedInputTokens,
                            ),
                          }}
                        />
                        <span
                          className="is-output"
                          style={{
                            width: compositionWidth(
                              tokenUsage.overall.outputTokens,
                            ),
                          }}
                        />
                        <span
                          className="is-unclassified"
                          style={{
                            width: compositionWidth(
                              tokenUsage.overall.unclassifiedTokens,
                            ),
                          }}
                        />
                      </div>

                      <div className="token-breakdown-grid">
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
                        <div>
                          <span>Currency cost</span>
                          <strong>Unavailable</strong>
                          <small>No pricing snapshot</small>
                        </div>
                      </div>

                      <div
                        className={`token-budget-callout ${
                          candidateOverTarget ? "is-over" : "is-within"
                        }`}
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

                      <div className="token-phase-list">
                        <div className="token-phase-heading">
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
                  <p className="live-token-note">
                    Cached input is included in processed tokens, but is shown
                    separately because its provider price can differ. Dollar
                    cost remains unavailable without a versioned pricing
                    snapshot.
                  </p>
                </div>
              </article>
              </section>
            )}

            {reportSection === "evidence" && (
              <section className="evidence-grid">
              <article className="panel evidence-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">Truth ledger</span>
                    <h2>Evidence under review</h2>
                  </div>
                  <span className="muted-action">
                    {totalClaims} total claims
                  </span>
                </div>

                <div className="evidence-table" role="table">
                  <div className="evidence-header" role="row">
                    <span role="columnheader">Claim</span>
                    <span role="columnheader">Strongest evidence</span>
                    <span role="columnheader">Status</span>
                  </div>
                  {displayedEvidence.length === 0 ? (
                    <div className="empty-table-state">
                      No claims have been recorded for this audit.
                    </div>
                  ) : (
                    displayedEvidence.map((row) => (
                      <div className="evidence-row" role="row" key={row.claim}>
                        <div className="evidence-claim" role="cell">
                          <strong>{row.claim}</strong>
                          {row.challenge ? (
                            <small>
                              {row.challenge.status === "resolved"
                                ? (row.challenge.resolution ??
                                  "Challenge resolved.")
                                : (row.challenge.issue ??
                                  "Challenge remains open.")}
                            </small>
                          ) : null}
                        </div>
                        <code role="cell">{row.source}</code>
                        <span
                          className={`evidence-status ${row.tone}`}
                          role="cell"
                        >
                          {row.status}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </article>

              <article className="panel confidence-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">Calibration</span>
                    <h2>Confidence vs. truth</h2>
                  </div>
                </div>
                <div className="confidence-visual">
                  <div className="confidence-row">
                    <span>Agent confidence</span>
                    <div className="confidence-track">
                      <i
                        className="claimed"
                        style={{ width: `${candidateConfidence}%` }}
                      />
                    </div>
                    <strong>{candidateConfidence}%</strong>
                  </div>
                  <div className="confidence-row">
                    <span>Verified accuracy</span>
                    <div className="confidence-track">
                      <i
                        className="verified"
                        style={{ width: `${verifiedAccuracy}%` }}
                      />
                    </div>
                    <strong>{verifiedAccuracy}%</strong>
                  </div>
                </div>
                <div className="calibration-callout">
                  <span>{hasResolvedEvidence ? `${confidenceGap > 0 ? "−" : "+"}${Math.abs(confidenceGap)} pts` : "Pending"}</span>
                  <p>
                    {hasResolvedEvidence
                      ? confidenceGap > 0
                        ? "Candidate confidence is ahead of verified accuracy."
                        : "Verified accuracy meets or exceeds candidate confidence."
                      : "No claim has a deterministic verdict yet, so calibration cannot be measured."}
                  </p>
                </div>

                {scoreDimensions.length > 0 ? (
                  <div className="score-breakdown">
                    <div className="score-breakdown-heading">
                      <div>
                        <span className="section-kicker">Score basis</span>
                        <h3>Why {navigability}/100</h3>
                      </div>
                      <span>
                        {snapshot.scoreBreakdown.adequacyPassed
                          ? "Adequacy passed"
                          : "Adequacy not met"}
                      </span>
                    </div>
                    <div className="score-dimension-list">
                      {scoreDimensions.map((dimension) => (
                        <div className="score-dimension" key={dimension.key}>
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
                      candidate token-efficiency score is{" "}
                      {candidateBudget?.efficiencyScore ?? "unavailable"}/100.
                    </p>
                  </div>
                ) : null}
              </article>
              </section>
            )}

            {reportSection === "recommendations" && (
              <section className="panel recommendation-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">
                    {snapshot.status === "completed"
                      ? "Verified findings"
                      : "Early signal"}
                  </span>
                  <h2>Likely highest-impact improvements</h2>
                </div>
                <span className="muted-action">
                  {snapshot.status === "completed"
                    ? "Scored report"
                    : "Final after scoring"}
                </span>
              </div>
              <div className="recommendation-list">
                {displayedRecommendations.length === 0 ? (
                  <div className="empty-report-state">
                    Recommendations will appear after the reporter converts
                    verified findings into repository changes.
                  </div>
                ) : (
                  displayedRecommendations.map((item) => (
                    <article className="recommendation" key={item.title}>
                      <span className="priority">{item.priority}</span>
                      <div className="recommendation-copy">
                        <h3>{item.title}</h3>
                        <p>{item.description}</p>
                      </div>
                      <div className="recommendation-impact">
                        <strong>{item.gain}</strong>
                        <span>projected pts</span>
                      </div>
                      <span className="cost-pill">{item.cost}</span>
                    </article>
                  ))
                )}
              </div>
              </section>
            )}
          </div>
          ) : (
            <div className="page-content empty-audit-view">
              <section className="panel empty-audit-state">
                <span className="empty-state-mark" aria-hidden="true">
                  ◎
                </span>
                <span className="section-kicker">
                  {connection === "offline"
                    ? "Local service unavailable"
                    : "SQLite archive is empty"}
                </span>
                <h1>No audit data yet</h1>
                <p>
                  {connection === "offline"
                    ? "Start the Waymark development service to read the local audit archive."
                    : "Waymark does not invent report content. Start an audit from your paired coding agent and its real evidence, scores, and token usage will appear here."}
                </p>
                <div className="empty-state-rule">
                  <strong>Source of truth</strong>
                  <span>
                    Paired agent → audit protocol → SQLite → this dashboard
                  </span>
                </div>
              </section>
            </div>
          )
        ) : view === "history" ? (
          <div className="page-content history-view">
            <section className="history-hero">
              <div>
                <span className="section-kicker">Local SQLite archive</span>
                <h1>Is the repository getting easier to navigate?</h1>
                <p>
                  Compare agent performance across commits, tasks, and model
                  capability.
                </p>
              </div>
              <div className="improvement-stat">
                <span>Archive change</span>
                <strong>
                  {historyChange === null
                    ? "—"
                    : `${historyChange >= 0 ? "+" : ""}${historyChange}`}
                </strong>
                <small>
                  {historyChange === null
                    ? "Needs two scored runs"
                    : "newest versus oldest"}
                </small>
              </div>
            </section>

            <section className="panel history-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Saved reports</span>
                  <h2>Recent audit runs</h2>
                </div>
                <span className="muted-action">
                  {history.length} local records
                </span>
              </div>
              {history.length === 0 ? (
                <div className="empty-table-state">
                  No audit runs are stored in SQLite yet.
                </div>
              ) : (
                <div className="history-table" role="table">
                  <div className="history-row history-head" role="row">
                    <span>Date</span>
                    <span>Commit</span>
                    <span>Task</span>
                    <span>Candidate</span>
                    <span>Score</span>
                    <span>Reliability</span>
                    <span>Tokens</span>
                  </div>
                  {history.map((run) => {
                    const tokens = run.tokenUsage.overall.totalTokens;
                    return (
                      <div className="history-row" role="row" key={run.id}>
                        <span>
                          {new Date(run.startedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                        <code>{run.repository.commit}</code>
                        <strong>{run.task}</strong>
                        <code>{run.models.candidate}</code>
                        <span className="history-score">
                          {run.metrics.navigability ?? "—"}
                        </span>
                        <span>
                          {run.metrics.reliability === null
                            ? "—"
                            : `${run.metrics.reliability}%`}
                        </span>
                        <span>{formatTokenCount(tokens)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {modelScores.length > 0 && (
            <section className="history-summary-grid single-summary">
              <article className="panel model-compare">
                <span className="section-kicker">Model frontier</span>
                <h2>Average navigability by candidate model</h2>
                {modelScores.map((model) => (
                  <div className="model-bar-row" key={model.model}>
                    <code>{model.model}</code>
                    <div>
                      <i style={{ width: `${model.score}%` }} />
                    </div>
                    <strong>{model.score}</strong>
                  </div>
                ))}
                <p>
                  Computed only from authoritative scores stored in the local
                  archive.
                </p>
              </article>
            </section>
            )}
          </div>
        ) : (
          <div className="page-content guide-view">
            <section className="guide-hero">
              <div>
                <span className="section-kicker">Static reference · v1.0</span>
                <h1>The agent-ready codebase</h1>
                <p>
                  A practical standard for reducing uncertainty, context cost,
                  and wrong turns during agentic coding. This guide evaluates
                  AI navigability—not security or general software quality.
                </p>
              </div>
              <aside className="guide-thesis">
                <span>Design target</span>
                <strong>Low uncertainty</strong>
                <p>
                  Boring, consistent, modular code usually outperforms clever
                  code for both humans and agents.
                </p>
              </aside>
            </section>

            <section className="question-panel">
              <div className="question-intro">
                <span className="section-kicker">Orientation test</span>
                <h2>A model should answer these quickly</h2>
              </div>
              <ol>
                {agentQuestions.map((question, index) => (
                  <li key={question}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    {question}
                  </li>
                ))}
              </ol>
            </section>

            <section className="practice-section">
              <div className="practice-heading">
                <div>
                  <span className="section-kicker">Seven principles</span>
                  <h2>Good patterns and their costly opposites</h2>
                </div>
                <p>
                  Each recommendation is about the work an agent must do to
                  locate, understand, change, and verify behavior.
                </p>
              </div>

              <div className="practice-list">
                {practicePairs.map((practice) => {
                  const isOpen = openPractice === practice.number;

                  return (
                    <article
                      className={`practice-card ${isOpen ? "is-open" : ""}`}
                      key={practice.number}
                    >
                      <button
                        aria-expanded={isOpen}
                        className="practice-toggle"
                        onClick={() =>
                          setOpenPractice(isOpen ? "" : practice.number)
                        }
                        type="button"
                      >
                        <span className="practice-number">
                          {practice.number}
                        </span>
                        <span className="practice-summary">
                          <strong>{practice.title}</strong>
                          <span>{practice.principle}</span>
                        </span>
                        <span className="practice-toggle-icon" aria-hidden="true">
                          {isOpen ? "−" : "+"}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="practice-comparison">
                          <div className="practice-example good-practice">
                            <div className="example-label">
                              <span aria-hidden="true">✓</span>
                              <strong>Good</strong>
                              <small>{practice.goodTitle}</small>
                            </div>
                            <pre>{practice.goodExample}</pre>
                          </div>
                          <div className="practice-example bad-practice">
                            <div className="example-label">
                              <span aria-hidden="true">×</span>
                              <strong>Bad</strong>
                              <small>{practice.badTitle}</small>
                            </div>
                            <pre>{practice.badExample}</pre>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="tree-section">
              <div className="practice-heading">
                <div>
                  <span className="section-kicker">Repository shape</span>
                  <h2>Two codebases, two very different journeys</h2>
                </div>
                <p>
                  Folder names are not the goal. Predictability, ownership, and
                  a short path from behavior to verification are.
                </p>
              </div>
              <div
                className="structure-switcher"
                aria-label="Repository structure example"
              >
                <button
                  className={structureView === "recommended" ? "active" : ""}
                  onClick={() => setStructureView("recommended")}
                  type="button"
                >
                  Recommended
                </button>
                <button
                  className={structureView === "hostile" ? "active" : ""}
                  onClick={() => setStructureView("hostile")}
                  type="button"
                >
                  Model-hostile
                </button>
              </div>

              <div className="tree-grid single-tree">
                {structureView === "recommended" ? (
                  <article className="tree-card recommended-tree">
                    <div>
                      <span className="tree-mark">✓</span>
                      <h3>Recommended structure</h3>
                      <small>Clear ownership and verification paths</small>
                    </div>
                    <pre>{recommendedTree}</pre>
                  </article>
                ) : (
                  <article className="tree-card hostile-tree">
                    <div>
                      <span className="tree-mark">×</span>
                      <h3>Model-hostile structure</h3>
                      <small>Ambiguous ownership and competing truths</small>
                    </div>
                    <pre>{hostileTree}</pre>
                  </article>
                )}
              </div>
            </section>

            <section className="guide-close">
              <span className="section-kicker">Practical target</span>
              <h2>Optimize for low uncertainty, not fewer files.</h2>
              <div className="target-points">
                <span>One obvious location for each behavior</span>
                <span>One owner for each concept</span>
                <span>One canonical verification workflow</span>
                <span>Explicit boundaries and fast feedback</span>
                <span>Small amounts of accurate documentation</span>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
