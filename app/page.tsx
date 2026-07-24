"use client";

import { useEffect, useMemo, useState } from "react";
import { useWaymarkLive } from "./use-waymark-live";

type Phase = {
  label: string;
  detail: string;
  status: "complete" | "active" | "queued";
};

const phases: Phase[] = [
  {
    label: "Candidate run",
    detail: "Implementation map submitted",
    status: "complete",
  },
  {
    label: "Blind research",
    detail: "Two independent maps completed",
    status: "complete",
  },
  {
    label: "Cross-examination",
    detail: "Resolving 4 disputed claims",
    status: "active",
  },
  {
    label: "Verification",
    detail: "Deterministic checks queued",
    status: "queued",
  },
  {
    label: "Scoring",
    detail: "Waiting for evidence lock",
    status: "queued",
  },
];

const agents = [
  {
    role: "Candidate",
    model: "gpt-5.6-terra",
    status: "Complete",
    accent: "blue",
    tokens: "48.2k",
    note: "Submitted 17 claims · 82% confidence",
  },
  {
    role: "Orchestrator",
    model: "gpt-5.6-sol",
    status: "Questioning",
    accent: "lime",
    tokens: "36.8k",
    note: "Tracing dynamic refund registration",
  },
  {
    role: "Independent researcher",
    model: "gpt-5.6-sol",
    status: "Responding",
    accent: "amber",
    tokens: "31.4k",
    note: "Cited 3 consumers missed by candidate",
  },
];

const evidenceRows = [
  {
    claim: "RefundService owns the write path",
    source: "RefundService.java:140",
    status: "Verified",
    tone: "good",
  },
  {
    claim: "Order history updates synchronously",
    source: "OrderEventsListener.java:88",
    status: "Contradicted",
    tone: "bad",
  },
  {
    claim: "Admin API is the only consumer",
    source: "3 additional call sites",
    status: "Disputed",
    tone: "warn",
  },
  {
    claim: "Refund tests run with verify:payments",
    source: "package.json:31",
    status: "Verified",
    tone: "good",
  },
];

const recommendations = [
  {
    priority: "P0",
    title: "Create a canonical refund entry point",
    description:
      "Four competing service entry points made ownership ambiguous across all three agents.",
    gain: "+8.4",
    cost: "Medium migration",
  },
  {
    priority: "P1",
    title: "Split payment orchestration from order mutation",
    description:
      "The current 3,842-line service requires roughly 24.6k context tokens before a safe change map emerges.",
    gain: "+5.7",
    cost: "126 consumers",
  },
  {
    priority: "P1",
    title: "Add a billing-local agent guide",
    description:
      "Idempotency, event timing, and verification rules are discoverable only through implementation archaeology.",
    gain: "+3.1",
    cost: "Low effort",
  },
];

const events = [
  "Orchestrator challenged the claimed transaction boundary",
  "Independent researcher cited PaymentEventsConsumer.java:204",
  "Verifier confirmed 9 of 11 static dependency edges",
  "Candidate confidence recalibrated from 82% to 61%",
];

const history = [
  {
    date: "Jul 23",
    commit: "a8c41ef",
    model: "gpt-5.6-terra",
    task: "Partial refunds",
    score: 42,
    reliability: 87,
    tokens: "48.2k",
  },
  {
    date: "Jul 10",
    commit: "7b923d1",
    model: "gpt-5.6-terra",
    task: "Invoice adjustments",
    score: 37,
    reliability: 84,
    tokens: "62.9k",
  },
  {
    date: "Jun 28",
    commit: "f130a4c",
    model: "gpt-5.6-sol",
    task: "Payment retry policy",
    score: 61,
    reliability: 92,
    tokens: "55.6k",
  },
];

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

export default function Home() {
  const [streaming, setStreaming] = useState(true);
  const [eventIndex, setEventIndex] = useState(0);
  const [view, setView] = useState<"live" | "history" | "guide">("live");
  const [reportSection, setReportSection] = useState<
    "progress" | "evidence" | "recommendations"
  >("progress");
  const [openPractice, setOpenPractice] = useState("01");
  const [structureView, setStructureView] = useState<
    "recommended" | "hostile"
  >("recommended");
  const { snapshot, connection, isLiveData } = useWaymarkLive();

  useEffect(() => {
    if (!streaming) return;

    const timer = window.setInterval(() => {
      setEventIndex((current) => (current + 1) % events.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, [streaming]);

  const currentEvent = useMemo(() => events[eventIndex], [eventIndex]);
  const repositoryName = snapshot?.repository.name ?? "meridian-commerce";
  const repositoryCommit = snapshot?.repository.commit ?? "a8c41ef";
  const auditTask =
    snapshot?.task ??
    "Add partial refunds requiring manager approval, idempotency, and order-history visibility.";
  const auditPhase = snapshot?.phase ?? "Cross-examination";
  const auditProgress = snapshot?.progress ?? 68;
  const navigability = snapshot ? snapshot.metrics.navigability : 42;
  const reliability = snapshot ? snapshot.metrics.reliability : 87;
  const candidateTokens = snapshot?.metrics.candidateTokens ?? 48200;
  const totalClaims = snapshot?.metrics.totalClaims ?? 17;
  const claimsChallenged = snapshot?.metrics.claimsChallenged ?? 7;
  const openChallenges = snapshot?.metrics.openChallenges ?? 4;
  const displayedEvent = snapshot?.latestEvent ?? currentEvent;
  const activePhaseIndex = snapshot
    ? Math.max(
        0,
        phases.findIndex(
          (phase) =>
            phase.label.toLowerCase() === snapshot.phase.toLowerCase(),
        ),
      )
    : 2;
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
          accent: ["blue", "lime", "amber"][index] ?? "blue",
          tokens: `${(participant.tokens / 1000).toFixed(1)}k`,
          note: `${participant.provider} · ${snapshot.phase}`,
        }))
    : agents;
  const displayedEvidence = snapshot ? snapshot.evidence : evidenceRows;
  const displayedRecommendations = snapshot
    ? snapshot.recommendations
    : recommendations;
  const totalAuditTokens = snapshot
    ? snapshot.participants.reduce(
        (total, participant) => total + participant.tokens,
        0,
      )
    : 123600;
  const candidateConfidence =
    snapshot?.metrics.candidateConfidence ?? 82;
  const verifiedAccuracy = snapshot?.metrics.verifiedAccuracy ?? 53;
  const confidenceGap = candidateConfidence - verifiedAccuracy;

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
              <span>{snapshot?.runCount ?? 12} reports in SQLite</span>
            </div>
          </div>
          <div className="prototype-note">
            <span>{isLiveData ? "Local service" : "Demo mode"}</span>
            {isLiveData ? "Live SQLite data" : "Example audit data"}
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
              {connection === "live" ? "Local service" : "Demo fallback"}
            </span>
            <div
              className="pairing-status"
              title="Audit input comes from the paired coding agent"
            >
              <span className="pairing-mark" aria-hidden="true">
                CX
              </span>
              <span className="pairing-agent">
                <small>Paired session</small>
                <strong>Codex</strong>
              </span>
              <i className="pairing-state" aria-label="Connected" />
            </div>
          </div>
        </header>

        {view === "live" ? (
          <div className="page-content">
            <section className="audit-hero">
              <div className="hero-copy">
                <div className="audit-context">
                  <span>Live audit</span>
                  <span aria-hidden="true">/</span>
                  <strong>{auditPhase}</strong>
                </div>
                <h1>How hard is this change to understand?</h1>
                <p>
                  Simulating: “{auditTask}”
                </p>
                <div className="hero-meta">
                  <span>Started 14m ago</span>
                  <span>Read-only target</span>
                  <span>{snapshot?.activeAgentCount ?? 3} active agents</span>
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
                <small>{auditPhase} in progress</small>
              </div>
            </section>

            <section className="metric-grid" aria-label="Audit metrics">
              <article className="metric-card score-card">
                <div className="metric-label">Projected navigability</div>
                <div className="metric-value">
                  {navigability ?? "—"}
                  <span>/100</span>
                </div>
                <div className="metric-foot">
                  {snapshot ? (
                    "Authoritative score appears after verification"
                  ) : (
                    <>
                      <span className="trend down">↓ 19</span>
                      Candidate estimate was 61
                    </>
                  )}
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
                    : "Strong evidence coverage"}
                </div>
              </article>
              <article className="metric-card">
                <div className="metric-label">Candidate tokens</div>
                <div className="metric-value">
                  {(candidateTokens / 1000).toFixed(1)}
                  <span>k</span>
                </div>
                <div className="metric-foot">
                  5.3k per verified obligation
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
                <span>{snapshot?.activeAgentCount ?? 3} active</span>
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
                <span>3 early signals</span>
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
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setStreaming((value) => !value)}
                  >
                    {streaming ? "Ⅱ Pause stream" : "▶ Resume stream"}
                  </button>
                </div>

                <ol className="phase-list">
                  {phases.map((phase, index) => {
                    const phaseStatus = snapshot
                      ? index < activePhaseIndex
                        ? "complete"
                        : index === activePhaseIndex
                          ? "active"
                          : "queued"
                      : phase.status;

                    return (
                    <li className={`phase ${phaseStatus}`} key={phase.label}>
                      <div className="phase-index">
                        {phaseStatus === "complete" ? "✓" : index + 1}
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

                <div className={`live-event ${streaming ? "is-live" : ""}`}>
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
                  <span className="running-badge">2 working</span>
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
                    <span>Total audit consumption</span>
                    <strong>
                      {(totalAuditTokens / 1000).toFixed(1)}k tokens
                    </strong>
                  </div>
                  {snapshot ? (
                    <p className="live-token-note">
                      Provider-reported and estimated measurements remain
                      separate in the stored report.
                    </p>
                  ) : (
                    <>
                      <div
                        className="stacked-bar"
                        aria-label="Token usage by agent"
                      >
                        <span className="candidate" style={{ width: "39%" }} />
                        <span
                          className="orchestrator"
                          style={{ width: "35%" }}
                        />
                        <span className="researcher" style={{ width: "26%" }} />
                      </div>
                      <div className="token-legend">
                        <span>
                          <i className="candidate" /> Candidate 39%
                        </span>
                        <span>
                          <i className="orchestrator" /> Validation 35%
                        </span>
                        <span>
                          <i className="researcher" /> Research 26%
                        </span>
                      </div>
                    </>
                  )}
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
                  {displayedEvidence.map((row) => (
                    <div className="evidence-row" role="row" key={row.claim}>
                      <strong role="cell">{row.claim}</strong>
                      <code role="cell">{row.source}</code>
                      <span className={`evidence-status ${row.tone}`} role="cell">
                        {row.status}
                      </span>
                    </div>
                  ))}
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
                  <span>
                    {confidenceGap > 0 ? "−" : "+"}
                    {Math.abs(confidenceGap)} pts
                  </span>
                  <p>
                    Candidate confidence is materially ahead of the evidence.
                    Final score is capped until critical consumers are resolved.
                  </p>
                </div>
                <div className="gate-list">
                  <div>
                    <span className="gate-mark pass">✓</span>
                    Primary implementation found
                  </div>
                  <div>
                    <span className="gate-mark review">!</span>
                    Consumer recall below threshold
                  </div>
                  <div>
                    <span className="gate-mark pending">·</span>
                    Executable probe pending
                  </div>
                </div>
              </article>
              </section>
            )}

            {reportSection === "recommendations" && (
              <section className="panel recommendation-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Early signal</span>
                  <h2>Likely highest-impact improvements</h2>
                </div>
                <span className="muted-action">Final after scoring</span>
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
                <span>90-day change</span>
                <strong>+11.4</strong>
                <small>navigability points</small>
              </div>
            </section>

            <section className="panel history-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">Saved reports</span>
                  <h2>Recent audit runs</h2>
                </div>
                <span className="muted-action">12 local records</span>
              </div>
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
                {history.map((run) => (
                  <div className="history-row" role="row" key={run.commit}>
                    <span>{run.date}</span>
                    <code>{run.commit}</code>
                    <strong>{run.task}</strong>
                    <code>{run.model}</code>
                    <span className="history-score">{run.score}</span>
                    <span>{run.reliability}%</span>
                    <span>{run.tokens}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="history-summary-grid">
              <article className="panel model-compare">
                <span className="section-kicker">Model frontier</span>
                <h2>Capability gap</h2>
                <div className="model-bar-row">
                  <code>gpt-5.6-sol</code>
                  <div>
                    <i style={{ width: "74%" }} />
                  </div>
                  <strong>74</strong>
                </div>
                <div className="model-bar-row">
                  <code>gpt-5.6-terra</code>
                  <div>
                    <i style={{ width: "53%" }} />
                  </div>
                  <strong>53</strong>
                </div>
                <p>
                  Goal: narrow the model gap until the standard model performs
                  within 10 points of the frontier model.
                </p>
              </article>
              <article className="panel savings-card">
                <span className="section-kicker">Potential</span>
                <h2>Cheaper models are becoming viable</h2>
                <strong>31%</strong>
                <p>
                  estimated inference-cost reduction if the current top three
                  navigability recommendations are completed.
                </p>
              </article>
            </section>
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
