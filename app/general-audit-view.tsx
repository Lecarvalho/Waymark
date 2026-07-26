"use client";

import { useState } from "react";

import type { WaymarkRunSnapshot } from "./use-waymark-live";
import { GeneralAuditGraphics } from "./general-audit-graphics";

type GeneralAuditViewProps = {
  snapshot: WaymarkRunSnapshot;
};

type GeneralTab = "progress" | "evidence" | "recommendations";

const findingStateLabels = {
  provisional: "Provisional",
  confirmed: "Confirmed",
  located_late: "Located late",
  reframed: "Reframed",
  contradicted: "Contradicted",
  retracted: "Retracted",
  unresolved: "Unresolved",
} as const;

const auditStatusLabels = {
  running: "Running",
  completed: "Completed",
  partial: "Partial report",
  failed: "Failed",
  cancelled: "Cancelled",
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

function formatFindingState(
  state: keyof typeof findingStateLabels,
  amendmentReason: string | null,
) {
  if (state === "located_late") {
    return amendmentReason
      ? `Located late — exists, but was hard to discover. ${amendmentReason}`
      : "Located late — exists, but was hard to discover.";
  }
  return findingStateLabels[state];
}

function formatCostLabel(value: number | null, singular: string) {
  if (value === null) return null;
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

export function GeneralAuditView({ snapshot }: GeneralAuditViewProps) {
  const [tab, setTab] = useState<GeneralTab>("evidence");
  const report = snapshot.generalAudit;

  if (!report) return null;

  const assessedDimensions = report.dimensions.filter(
    ({ assessmentState }) => assessmentState === "assessed",
  ).length;
  const missingDimensions = report.dimensions.filter(
    ({ assessmentState }) => assessmentState !== "assessed",
  );
  const auditorTokens =
    report.auditor?.tokens ?? report.tokens.totals.totalTokens ?? null;
  const stages = [
    {
      label: "Repository survey",
      detail: `${new Set(report.surfaces.map(({ surface }) => surface)).size}/9 repository surfaces inspected`,
      complete: report.surfaces.length >= 9,
      started: report.surfaces.length > 0,
    },
    {
      label: "Behavior tracing",
      detail: `${report.behaviorPaths.length}/2 representative paths recorded`,
      complete: report.behaviorPaths.length >= 2,
      started: report.behaviorPaths.length > 0,
    },
    {
      label: "Dimension assessment",
      detail: `${assessedDimensions}/6 weighted dimensions assessed`,
      complete: assessedDimensions === 6,
      started: report.dimensions.some(
        ({ assessmentState }) => assessmentState !== "not_assessed",
      ),
    },
    {
      label: "Synthesis",
      detail: report.synthesis
        ? "Auditor synthesis recorded"
        : "Final synthesis not yet recorded",
      complete: report.synthesis !== null,
      started: report.synthesis !== null || report.recommendations.length > 0,
    },
  ];
  const currentStageIndex = stages.findIndex(({ complete }) => !complete);

  return (
    <>
      <section
        className={`general-audit-hero status-${snapshot.status}`}
        aria-labelledby="general-audit-title"
      >
        <div>
          <div className="audit-context">
            <span>General repository audit</span>
            <span aria-hidden="true">/</span>
            <strong>{auditStatusLabels[snapshot.status]}</strong>
          </div>
          <h1 id="general-audit-title">Repository navigability assessment</h1>
          <p>
            One auditor is tracing how agents discover behavior, ownership,
            dependencies, change surfaces, verification, and instructions.
          </p>
          <div className="general-hero-meta">
            <span>Read-only target</span>
            <span>Checkpoint {report.latestCheckpointSequence}</span>
            <span>{snapshot.progress}% coverage progress</span>
          </div>
        </div>
        <div
          className="general-progress"
          aria-label={`General audit ${snapshot.progress} percent complete`}
        >
          <span>Evidence coverage progress</span>
          <strong>{snapshot.progress}%</strong>
          <div aria-hidden="true">
            <i style={{ width: `${snapshot.progress}%` }} />
          </div>
          <small>
            Coverage drives completion. General audits have no hard token limit.
          </small>
        </div>
      </section>

      {snapshot.status !== "running" ? (
        <section
          className={`general-outcome status-${snapshot.status}`}
          role="status"
        >
          <strong>{auditStatusLabels[snapshot.status]}</strong>
          <p>
            {snapshot.status === "partial"
              ? `Usable cited evidence was preserved, but ${
                  missingDimensions.length
                } required ${
                  missingDimensions.length === 1 ? "dimension is" : "dimensions are"
                } still incomplete${
                  report.completeness.synthesisComplete
                    ? "."
                    : " and final synthesis is missing."
                }`
              : snapshot.status === "failed"
                ? report.findings.length === 0
                  ? "No usable report evidence was recovered."
                  : "The run failed, but acknowledged findings remain visible below."
                : snapshot.status === "cancelled"
                  ? "The user stopped this audit. Durable cited findings remain available."
                  : "Required coverage and auditor synthesis are complete."}
          </p>
        </section>
      ) : null}

      <section className="general-metric-strip" aria-label="General audit metrics">
        <article>
          <span>Assessed weight</span>
          <strong>{report.completeness.assessedWeight}%</strong>
          <small>
            {assessedDimensions}/6 dimensions have adequate evidence
          </small>
        </article>
        <article>
          <span>Auditor-assessed result</span>
          <strong>{report.result ? `${report.result.score}/100` : "Not eligible"}</strong>
          <small>
            {report.result
              ? "All required dimensions are supported"
              : "No overall score until all six dimensions are assessed"}
          </small>
        </article>
        <article className="is-activity">
          <span>Auditor tokens</span>
          <strong>{formatTokenCount(auditorTokens)}</strong>
          <small>{formatTokenSource(report.auditor?.tokenSource ?? null)}</small>
        </article>
        <article>
          <span>Semantic findings</span>
          <strong>{report.findings.length}</strong>
          <small>
            {report.findings.reduce(
              (total, finding) => total + finding.revisions.length,
              0,
            )}{" "}
            preserved revisions
          </small>
        </article>
      </section>

      <section className="general-auditor-strip" aria-label="General audit owner">
        <div>
          <span className="general-auditor-mark" aria-hidden="true">
            A
          </span>
          <div>
            <small>Single general auditor</small>
            <strong>
              {report.auditor
                ? `${report.auditor.model} · ${report.auditor.provider}`
                : "Auditor identity unavailable"}
            </strong>
          </div>
        </div>
        <div>
          <span>Role status</span>
          <strong>{report.auditor?.status ?? "Not reported"}</strong>
        </div>
        <div className="is-activity">
          <span>Live measurement</span>
          <strong>{formatTokenCount(auditorTokens)} tokens</strong>
        </div>
      </section>

      <div className="general-report-tabs" role="tablist" aria-label="General audit report">
        {(["progress", "evidence", "recommendations"] as const).map((item) => (
          <button
            aria-controls={`general-${item}-panel`}
            aria-selected={tab === item}
            className={tab === item ? "is-active" : ""}
            id={`general-${item}-tab`}
            key={item}
            onClick={() => setTab(item)}
            role="tab"
            type="button"
          >
            {item === "progress"
              ? "Progress"
              : item === "evidence"
                ? `Evidence · ${report.findings.length}`
                : `Recommendations · ${report.recommendations.length}`}
          </button>
        ))}
      </div>

      {tab === "progress" ? (
        <div
          aria-labelledby="general-progress-tab"
          className="general-tab-panel"
          id="general-progress-panel"
          role="tabpanel"
        >
          <section className="panel general-flow-panel">
            <div className="panel-heading">
              <div>
                <span className="section-kicker">General flow</span>
                <h2>Coverage-led audit stages</h2>
              </div>
              <span className="muted-action">{snapshot.phase}</span>
            </div>
            <ol className="general-stage-list">
              {stages.map((stage, index) => {
                const state = stage.complete
                  ? "complete"
                  : snapshot.status === "running" &&
                      (index === currentStageIndex || stage.started)
                    ? "active"
                    : snapshot.status === "failed"
                      ? "failed"
                      : "queued";
                return (
                  <li className={`status-${state}`} key={stage.label}>
                    <span aria-hidden="true">
                      {state === "complete" ? "✓" : index + 1}
                    </span>
                    <div>
                      <strong>{stage.label}</strong>
                      <small>{stage.detail}</small>
                    </div>
                    <em>{state}</em>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="general-activity-grid">
            <article className="panel">
              <span className="section-kicker">Raw activity</span>
              <h2>Observable provider stream</h2>
              <p>{snapshot.latestEvent || "No provider activity reported yet."}</p>
              <dl>
                <div>
                  <dt>Session</dt>
                  <dd>{report.providerSession.status}</dd>
                </div>
                <div>
                  <dt>Latest activity</dt>
                  <dd>
                    {report.providerSession.latestActivityType ?? "Unavailable"}
                  </dd>
                </div>
              </dl>
            </article>
            <article className="panel is-semantic">
              <span className="section-kicker">Semantic checkpoints</span>
              <h2>Durable report evidence</h2>
              <p>
                {report.findings.length} findings and{" "}
                {report.latestCheckpointSequence} acknowledged checkpoint events
                survive provider or interface restarts.
              </p>
              <dl>
                <div>
                  <dt>Dimensions assessed</dt>
                  <dd>{assessedDimensions}/6</dd>
                </div>
                <div>
                  <dt>Synthesis</dt>
                  <dd>
                    {report.completeness.synthesisComplete
                      ? "Recorded"
                      : "Incomplete"}
                  </dd>
                </div>
              </dl>
            </article>
          </section>

          <GeneralAuditGraphics report={report} />
        </div>
      ) : null}

      {tab === "evidence" ? (
        <section
          aria-labelledby="general-evidence-tab"
          className="panel general-tab-panel general-finding-panel"
          id="general-evidence-panel"
          role="tabpanel"
        >
          <div className="panel-heading">
            <div>
              <span className="section-kicker">Semantic finding ledger</span>
              <h2>Evidence as it was learned</h2>
            </div>
            <span className="muted-action">
              Ordered by checkpoint sequence
            </span>
          </div>
          {report.findings.length === 0 ? (
            <div className="empty-report-state">
              No semantic findings have been acknowledged yet. Raw activity does
              not become report evidence until a checkpoint is recorded.
            </div>
          ) : (
            <div className="general-finding-list">
              {report.findings.map((finding, index) => {
                const revision = finding.currentRevision;
                const cost = revision.navigationCost;
                const costLabels = cost
                  ? [
                      formatCostLabel(cost.searches, "search"),
                      formatCostLabel(cost.filesOpened, "file opened"),
                      formatCostLabel(cost.fileHops, "file hop"),
                      formatCostLabel(cost.deadEnds, "dead end"),
                      formatCostLabel(cost.commands, "command"),
                      cost.processedTokens === null
                        ? null
                        : `${formatTokenCount(cost.processedTokens)} tokens`,
                    ].filter(Boolean)
                  : [];
                return (
                  <details
                    className={`general-finding state-${revision.state} signal-${revision.signal}`}
                    key={finding.findingId}
                  >
                    <summary>
                      <span className="general-checkpoint-number">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{revision.title}</strong>
                        <p>{revision.conclusion}</p>
                      </div>
                      <span className="general-finding-state">
                        {findingStateLabels[revision.state]}
                      </span>
                      <span aria-hidden="true">+</span>
                    </summary>
                    <div className="general-finding-detail">
                      <section className="general-amendment">
                        <h3>Current state</h3>
                        <p>
                          {formatFindingState(
                            revision.state,
                            revision.provenance.amendmentReason,
                          )}
                        </p>
                        <small>
                          Revision {revision.revisionNumber} ·{" "}
                          {new Date(
                            revision.provenance.occurredAt,
                          ).toLocaleString()}
                        </small>
                      </section>
                      <section>
                        <h3>Citations</h3>
                        {revision.citations.length > 0 ? (
                          <ul className="general-citation-list">
                            {revision.citations.map((citation, citationIndex) => (
                              <li
                                key={`${citation.path}-${citation.startLine}-${citationIndex}`}
                              >
                                <code>
                                  {citation.path}:{citation.startLine}
                                  {citation.endLine !== citation.startLine
                                    ? `–${citation.endLine}`
                                    : ""}
                                </code>
                                <span>
                                  {citation.source.replaceAll("_", " ")}
                                  {citation.symbol ? ` · ${citation.symbol}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>No citation was attached to this revision.</p>
                        )}
                      </section>
                      <section>
                        <h3>Navigation cost</h3>
                        {costLabels.length > 0 ? (
                          <ul className="general-cost-list">
                            {costLabels.map((label) => (
                              <li key={label}>{label}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No navigation-cost observation was recorded.</p>
                        )}
                      </section>
                      <section>
                        <h3>Revision history</h3>
                        <ol className="general-revision-list">
                          {finding.revisions.map((item) => (
                            <li key={item.revisionId}>
                              <div>
                                <strong>
                                  Revision {item.revisionNumber} ·{" "}
                                  {findingStateLabels[item.state]}
                                </strong>
                                <time>
                                  {new Date(
                                    item.provenance.occurredAt,
                                  ).toLocaleString()}
                                </time>
                              </div>
                              <p>{item.conclusion}</p>
                              {item.provenance.amendmentReason ? (
                                <small>
                                  Amendment: {item.provenance.amendmentReason}
                                </small>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      </section>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {tab === "recommendations" ? (
        <section
          aria-labelledby="general-recommendations-tab"
          className="panel general-tab-panel general-recommendation-panel"
          id="general-recommendations-panel"
          role="tabpanel"
        >
          <div className="panel-heading">
            <div>
              <span className="section-kicker">Evidence-linked improvements</span>
              <h2>Recommendations</h2>
            </div>
            <span className="muted-action">
              {report.recommendations.length} available
            </span>
          </div>
          {report.recommendations.length === 0 ? (
            <div className="empty-report-state">
              Recommendations appear only after the auditor links a repository
              improvement to durable findings.
            </div>
          ) : (
            <div className="general-recommendation-list">
              {report.recommendations.map((recommendation, index) => (
                <article key={recommendation.recommendationId}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{recommendation.title}</h3>
                    <p>{recommendation.rationale}</p>
                    <small>
                      Supported by {recommendation.findingIds.length}{" "}
                      {recommendation.findingIds.length === 1
                        ? "finding"
                        : "findings"}{" "}
                      · {recommendation.dimensionIds.length} dimensions
                    </small>
                  </div>
                </article>
              ))}
            </div>
          )}
          {report.synthesis ? (
            <aside className="general-synthesis">
              <strong>Auditor synthesis</strong>
              <p>{report.synthesis.summary}</p>
            </aside>
          ) : (
            <aside className="general-synthesis is-incomplete">
              <strong>Synthesis incomplete</strong>
              <p>
                Current findings remain usable, but the auditor has not recorded
                a final synthesis.
              </p>
            </aside>
          )}
        </section>
      ) : null}
    </>
  );
}
