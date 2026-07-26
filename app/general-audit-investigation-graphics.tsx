"use client";

import { useState } from "react";

import type { GeneralEvidenceCitation } from "../src/domain/general-audit.mjs";
import type { WaymarkDimensionId } from "../src/domain/general-audit.mjs";
import type { GeneralAuditServiceSnapshot } from "./use-waymark-live";
import styles from "./general-audit-investigation-graphics.module.css";

type InvestigationGraphic =
  | "paths"
  | "journeys"
  | "evolution"
  | "priorities"
  | "trends";

type GeneralAuditInvestigationGraphicsProps = {
  report: GeneralAuditServiceSnapshot;
};

const graphicLabels: Record<InvestigationGraphic, string> = {
  paths: "Behavior paths",
  journeys: "Discovery journeys",
  evolution: "Finding evolution",
  priorities: "Impact / effort",
  trends: "Dimension trends",
};

const dimensionLabels: Record<WaymarkDimensionId, string> = {
  discoveryEfficiency: "Discovery efficiency",
  ownershipClarity: "Ownership clarity",
  dependencyClarity: "Dependency clarity",
  changeSurfaceRecall: "Change-surface recall",
  verificationDiscoverability: "Verification discoverability",
  instructionQuality: "Instruction quality",
};

const findingStateLabels = {
  provisional: "Provisional",
  confirmed: "Confirmed",
  located_late: "Located late",
  reframed: "Reframed",
  contradicted: "Contradicted",
  retracted: "Retracted",
  unresolved: "Unresolved",
} as const;

const pathStateLabels = {
  verified_current: "Cited / current",
  difficult_to_discover: "Difficult to discover",
  pending: "Pending / uninspected",
  contradicted: "Contradicted",
} as const;

function formatDate(value: string | null) {
  return value === null
    ? "Date unavailable"
    : new Date(value).toLocaleString();
}

function formatDuration(value: number | null) {
  if (value === null) return "Unavailable";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} s`;
}

function CitationList({
  citations,
}: {
  citations: readonly GeneralEvidenceCitation[];
}) {
  if (citations.length === 0) {
    return <p>No citation was recorded for this element.</p>;
  }

  return (
    <ul className={styles["investigation-citation-list"]}>
      {citations.map((citation, index) => (
        <li
          key={`${citation.path}-${citation.startLine}-${citation.endLine}-${index}`}
        >
          <code>
            {citation.path}:{citation.startLine}
            {citation.endLine === citation.startLine
              ? ""
              : `–${citation.endLine}`}
          </code>
          <span>
            {citation.source.replaceAll("_", " ")}
            {citation.symbol ? ` · ${citation.symbol}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BehaviorPathGraphic({
  report,
}: GeneralAuditInvestigationGraphicsProps) {
  const [selectedPathId, setSelectedPathId] = useState(
    report.behaviorPathViews[0]?.pathId ?? "",
  );
  const selectedPath =
    report.behaviorPathViews.find(
      ({ pathId }) => pathId === selectedPathId,
    ) ?? report.behaviorPathViews[0];

  if (!selectedPath) {
    return (
      <div className="empty-report-state">
        No representative behavior path has been recorded yet.
      </div>
    );
  }

  return (
    <section aria-labelledby="behavior-path-graphic-title">
      <div className={styles["investigation-graphic-heading"]}>
        <div>
          <h3 id="behavior-path-graphic-title">Focused behavior navigation map</h3>
          <p>
            One sampled behavior at a time, including unknown and uninspected
            path elements.
          </p>
        </div>
        {report.behaviorPathViews.length > 1 ? (
          <label>
            <span>Representative behavior</span>
            <select
              onChange={(event) => setSelectedPathId(event.target.value)}
              value={selectedPath.pathId}
            >
              {report.behaviorPathViews.map((path) => (
                <option key={path.pathId} value={path.pathId}>
                  {path.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className={styles["behavior-path-context"]}>
        <strong>{selectedPath.name}</strong>
        <span>Observed {formatDate(selectedPath.observedAt)}</span>
      </div>
      <div className={styles["behavior-path-scroll"]}>
        <ol
          aria-label={`Navigation path for ${selectedPath.name}`}
          className={styles["behavior-path-map"]}
        >
          {selectedPath.groups.map((group, groupIndex) => {
            const edge =
              groupIndex === 0 ? null : selectedPath.edges[groupIndex - 1];
            return (
              <li key={group.kind}>
                {edge ? (
                  <details
                    className={styles["behavior-path-edge"]}
                    data-state={edge.evidenceState}
                  >
                    <summary>
                      <span aria-hidden="true">→</span>
                      <span>
                        {pathStateLabels[edge.evidenceState]} connection
                      </span>
                    </summary>
                    <CitationList citations={edge.citations} />
                  </details>
                ) : null}
                <div className={styles["behavior-path-group"]}>
                  <h4>{group.label}</h4>
                  {group.nodes.map((node) => (
                    <details
                      className={styles["behavior-path-node"]}
                      data-state={node.evidenceState}
                      key={node.nodeId}
                    >
                      <summary>
                        <strong>{node.label}</strong>
                        <span>{pathStateLabels[node.evidenceState]}</span>
                      </summary>
                      {node.reason ? <p>{node.reason}</p> : null}
                      <CitationList citations={node.citations} />
                    </details>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div
        className={styles["investigation-legend"]}
        aria-label="Path state legend"
      >
        {Object.entries(pathStateLabels).map(([state, label]) => (
          <span data-state={state} key={state}>
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function DiscoveryJourneyGraphic({
  report,
}: GeneralAuditInvestigationGraphicsProps) {
  if (report.discoveryJourneys.length === 0) {
    return (
      <div className="empty-report-state">
        No measured navigation-cost journey has been recorded yet.
      </div>
    );
  }

  return (
    <section aria-labelledby="discovery-journey-title">
      <div className={styles["investigation-graphic-heading"]}>
        <div>
          <h3 id="discovery-journey-title">Measured discovery journeys</h3>
          <p>
            Unavailable measurements stay unavailable; no search or file steps
            are reconstructed from inference.
          </p>
        </div>
      </div>
      <div className={styles["discovery-journey-list"]}>
        {report.discoveryJourneys.map((journey) => (
          <details
            data-state={journey.locatedLate ? "located_late" : undefined}
            key={journey.findingId}
            open={journey.locatedLate || undefined}
          >
            <summary>
              <div>
                <strong>{journey.title}</strong>
                <span>{findingStateLabels[journey.state]}</span>
              </div>
              <span>
                {journey.measurementRevisionId
                  ? `Measured at ${journey.measurementRevisionId}`
                  : "Cost measurement unavailable"}
              </span>
            </summary>
            <ol className={styles["discovery-journey-steps"]}>
              {journey.steps.map((step, index) => (
                <li
                  data-availability={step.availability}
                  key={step.kind}
                >
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <span>{step.valueLabel}</span>
                  </div>
                </li>
              ))}
            </ol>
            {journey.amendmentReason ? (
              <p className={styles["journey-amendment"]}>
                <strong>Why the interpretation changed:</strong>{" "}
                {journey.amendmentReason}
              </p>
            ) : null}
            <dl className={styles["journey-measurements"]}>
              <div>
                <dt>File hops</dt>
                <dd>
                  {journey.additionalMeasurements.fileHops ??
                    "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Commands</dt>
                <dd>
                  {journey.additionalMeasurements.commands ??
                    "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Processed tokens</dt>
                <dd>
                  {journey.additionalMeasurements.processedTokens?.toLocaleString() ??
                    "Unavailable"}
                </dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>
                  {formatDuration(
                    journey.additionalMeasurements.elapsedMs,
                  )}
                </dd>
              </div>
            </dl>
            <div className={styles["journey-located-evidence"]}>
              <h4>Evidence at the located target</h4>
              <CitationList citations={journey.locatedByCitations} />
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function FindingEvolutionGraphic({
  report,
}: GeneralAuditInvestigationGraphicsProps) {
  const revisedFindings = report.findings.filter(
    ({ revisions }) => revisions.length > 1,
  );
  const displayedFindings =
    revisedFindings.length > 0 ? revisedFindings : report.findings;

  if (displayedFindings.length === 0) {
    return (
      <div className="empty-report-state">
        Finding evolution appears after the first semantic checkpoint.
      </div>
    );
  }

  return (
    <section aria-labelledby="finding-evolution-title">
      <div className={styles["investigation-graphic-heading"]}>
        <div>
          <h3 id="finding-evolution-title">Finding evolution timeline</h3>
          <p>
            Earlier interpretations remain visible after confirmation,
            reframing, contradiction, or retraction.
          </p>
        </div>
      </div>
      <div className={styles["finding-evolution-list"]}>
        {displayedFindings.map((finding) => (
          <details
            key={finding.findingId}
            open={finding.currentRevision.state === "located_late" || undefined}
          >
            <summary>
              <div>
                <strong>{finding.currentRevision.title}</strong>
                <span>
                  {finding.revisions.length}{" "}
                  {finding.revisions.length === 1 ? "revision" : "revisions"}
                </span>
              </div>
              <span>
                Current: {findingStateLabels[finding.currentRevision.state]}
              </span>
            </summary>
            <ol className={styles["finding-evolution-timeline"]}>
              {finding.revisions.map((revision, index) => (
                <li
                  data-current={
                    index === finding.revisions.length - 1 || undefined
                  }
                  data-state={revision.state}
                  key={revision.revisionId}
                >
                  <div
                    className={styles["evolution-marker"]}
                    aria-hidden="true"
                  >
                    {revision.revisionNumber}
                  </div>
                  <div>
                    <div className={styles["evolution-heading"]}>
                      <strong>
                        {findingStateLabels[revision.state]}
                        {index === finding.revisions.length - 1
                          ? " · current interpretation"
                          : ""}
                      </strong>
                      <time>{formatDate(revision.provenance.occurredAt)}</time>
                    </div>
                    <p>{revision.conclusion}</p>
                    {revision.provenance.amendmentReason ? (
                      <p className={styles["evolution-reason"]}>
                        <strong>Reason:</strong>{" "}
                        {revision.provenance.amendmentReason}
                      </p>
                    ) : null}
                    <details className={styles["evolution-evidence"]}>
                      <summary>
                        Evidence causing this interpretation ·{" "}
                        {
                          revision.provenance.causedByCitations.length
                        }{" "}
                        citations
                      </summary>
                      <CitationList
                        citations={
                          revision.provenance.causedByCitations.length > 0
                            ? revision.provenance.causedByCitations
                            : revision.citations
                        }
                      />
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}

function RecommendationPriorityGraphic({
  report,
}: GeneralAuditInvestigationGraphicsProps) {
  if (report.recommendationPriorities.length === 0) {
    return (
      <div className="empty-report-state">
        No evidence-backed recommendation priority is available yet.
      </div>
    );
  }

  return (
    <section aria-labelledby="recommendation-priority-title">
      <div className={styles["investigation-graphic-heading"]}>
        <div>
          <h3 id="recommendation-priority-title">
            Recommendation impact / effort
          </h3>
          <p>
            Affected rubric weight describes evidence scope, not a projected
            score gain. Effort remains unavailable unless explicitly measured.
          </p>
        </div>
      </div>
      <div className={styles["recommendation-priority-scroll"]}>
        <table className={styles["recommendation-priority-table"]}>
          <caption>
            Evidence-linked recommendation scope compared with recorded
            implementation effort
          </caption>
          <thead>
            <tr>
              <th scope="col">Recommendation</th>
              <th scope="col">Evidence-backed impact</th>
              <th scope="col">Implementation effort</th>
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            {report.recommendationPriorities.map((recommendation) => (
              <tr key={recommendation.recommendationId}>
                <th scope="row">
                  <strong>{recommendation.title}</strong>
                  <span>{recommendation.rationale}</span>
                </th>
                <td>
                  <strong>
                    {recommendation.impact.affectedWeight}% rubric scope
                  </strong>
                  <span>
                    {recommendation.impact.affectedDimensionCount} affected{" "}
                    {recommendation.impact.affectedDimensionCount === 1
                      ? "dimension"
                      : "dimensions"}
                  </span>
                  <small>No projected score gain</small>
                </td>
                <td>
                  <strong>{recommendation.effort.label}</strong>
                  <span>{recommendation.effort.reason}</span>
                </td>
                <td>
                  <span>
                    Findings: {recommendation.findingIds.join(", ")}
                  </span>
                  <span>
                    Dimensions:{" "}
                    {recommendation.dimensionIds
                      .map((dimensionId) => dimensionLabels[dimensionId])
                      .join(", ")}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoricalTrendGraphic({
  report,
}: GeneralAuditInvestigationGraphicsProps) {
  const [dimensionId, setDimensionId] = useState<WaymarkDimensionId>(
    "discoveryEfficiency",
  );
  const points = report.history.compatible.map((run) => {
    const dimension = run.dimensions.find(
      (item) => item.dimensionId === dimensionId,
    );
    return { run, dimension };
  });

  if (points.length === 0) {
    return (
      <div className="empty-report-state">
        No compatible general-audit history is available for this repository.
      </div>
    );
  }

  return (
    <section aria-labelledby="dimension-trend-title">
      <div className={styles["investigation-graphic-heading"]}>
        <div>
          <h3 id="dimension-trend-title">Compatible dimension history</h3>
          <p>
            Only runs with the same rubric, report schema, and dimension
            definitions appear as trend points.
          </p>
        </div>
        <label>
          <span>Dimension</span>
          <select
            onChange={(event) =>
              setDimensionId(event.target.value as WaymarkDimensionId)
            }
            value={dimensionId}
          >
            {report.dimensions.map((dimension) => (
              <option
                key={dimension.dimensionId}
                value={dimension.dimensionId}
              >
                {dimensionLabels[dimension.dimensionId]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles["dimension-trend-chart"]}>
        <ol aria-label={`${dimensionLabels[dimensionId]} audit history`}>
          {points.map(({ run, dimension }) => (
            <li data-partial={run.partial || undefined} key={run.runId}>
              <div className={styles["trend-run-meta"]}>
                <time>{formatDate(run.auditedAt)}</time>
                <code>{run.commitSha.slice(0, 12)}</code>
                <span>
                  {run.partial ? "Partial run" : "Complete run"} ·{" "}
                  {run.status}
                </span>
              </div>
              <div
                aria-label={
                  dimension?.score === null || dimension?.score === undefined
                    ? `${dimensionLabels[dimensionId]} was not assessed`
                    : `${dimensionLabels[dimensionId]} scored ${dimension.score} out of 100`
                }
                className={styles["trend-score"]}
                role="img"
              >
                {dimension?.score !== null &&
                dimension?.score !== undefined ? (
                  <i
                    aria-hidden="true"
                    style={{ width: `${dimension.score}%` }}
                  />
                ) : null}
              </div>
              <strong>
                {dimension?.score === null || dimension?.score === undefined
                  ? "Not assessed"
                  : `${dimension.score}/100`}
              </strong>
              <span className={styles["trend-coverage"]}>
                {dimension?.evidenceCoverage.distinctCitationCount ?? 0} cited{" "}
                {(dimension?.evidenceCoverage.distinctCitationCount ?? 0) === 1
                  ? "source"
                  : "sources"}{" "}
                · {dimension?.evidenceCoverage.state ?? "insufficient"}
              </span>
            </li>
          ))}
        </ol>
      </div>
      {report.history.excluded.length > 0 ? (
        <details className={styles["incompatible-history"]}>
          <summary>
            {report.history.excluded.length} incompatible{" "}
            {report.history.excluded.length === 1 ? "run" : "runs"} excluded
          </summary>
          <ul>
            {report.history.excluded.map((run) => (
              <li key={run.runId}>
                <code>{run.commitSha.slice(0, 12)}</code>
                <span>{formatDate(run.auditedAt)}</span>
                <span>{run.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function GeneralAuditInvestigationGraphics({
  report,
}: GeneralAuditInvestigationGraphicsProps) {
  const [graphic, setGraphic] = useState<InvestigationGraphic>("paths");

  return (
    <section
      aria-labelledby="investigation-graphics-title"
      className={`panel ${styles["investigation-graphics-panel"]}`}
    >
      <div className="panel-heading">
        <div>
          <span className="section-kicker">Investigation evidence</span>
          <h2 id="investigation-graphics-title">
            Why navigation succeeded or stalled
          </h2>
        </div>
        <span className="muted-action">One view at a time</span>
      </div>
      <div
        aria-label="Investigation graphic"
        className={styles["investigation-graphic-tabs"]}
        role="tablist"
      >
        {(Object.keys(graphicLabels) as InvestigationGraphic[]).map(
          (item) => (
            <button
              aria-controls={`investigation-${item}-panel`}
              aria-selected={graphic === item}
              id={`investigation-${item}-tab`}
              key={item}
              onClick={() => setGraphic(item)}
              role="tab"
              type="button"
            >
              {graphicLabels[item]}
            </button>
          ),
        )}
      </div>
      <div
        aria-labelledby={`investigation-${graphic}-tab`}
        className={styles["investigation-graphic-body"]}
        id={`investigation-${graphic}-panel`}
        role="tabpanel"
      >
        {graphic === "paths" ? <BehaviorPathGraphic report={report} /> : null}
        {graphic === "journeys" ? (
          <DiscoveryJourneyGraphic report={report} />
        ) : null}
        {graphic === "evolution" ? (
          <FindingEvolutionGraphic report={report} />
        ) : null}
        {graphic === "priorities" ? (
          <RecommendationPriorityGraphic report={report} />
        ) : null}
        {graphic === "trends" ? (
          <HistoricalTrendGraphic report={report} />
        ) : null}
      </div>
    </section>
  );
}
