"use client";

import { useState } from "react";

import type {
  GeneralAuditReport,
  GeneralEvidenceMatrixCell,
  GeneralReportDimension,
} from "../src/reporting/general-audit-report.mjs";
import type {
  GeneralEvidenceSource,
  WaymarkDimensionId,
} from "../src/domain/general-audit.mjs";

type GeneralAuditGraphicsProps = {
  report: GeneralAuditReport;
};

type SelectedCell = {
  dimensionId: WaymarkDimensionId;
  source: GeneralEvidenceSource;
} | null;

const dimensionLabels: Record<WaymarkDimensionId, string> = {
  discoveryEfficiency: "Discovery efficiency",
  ownershipClarity: "Ownership clarity",
  dependencyClarity: "Dependency clarity",
  changeSurfaceRecall: "Change-surface recall",
  verificationDiscoverability: "Verification discoverability",
  instructionQuality: "Instruction quality",
};

const sourceLabels: Record<
  GeneralEvidenceSource,
  { short: string; full: string }
> = {
  production_code: { short: "Code", full: "Production code" },
  test: { short: "Tests", full: "Tests" },
  configuration: { short: "Config", full: "Configuration" },
  workflow: { short: "Flows", full: "Workflows" },
  documentation: { short: "Docs", full: "Documentation" },
  instruction: { short: "Instr.", full: "Instructions" },
  generated: { short: "Gen.", full: "Generated code" },
  external: { short: "Ext.", full: "External code" },
};

const evidenceSources = Object.keys(sourceLabels) as GeneralEvidenceSource[];

function formatAssessmentState(
  state: GeneralReportDimension["assessmentState"],
) {
  if (state === "not_assessed") return "Not assessed";
  if (state === "in_progress") return "In progress";
  return "Assessed";
}

function formatConfidence(confidence: number | null) {
  return confidence === null
    ? "Not reported"
    : `${Math.round(confidence * 100)}%`;
}

function findSupportingFindings(
  report: GeneralAuditReport,
  dimension: GeneralReportDimension,
) {
  const supportingIds = new Set([
    ...dimension.supportingPositiveFindingIds,
    ...dimension.supportingFrictionFindingIds,
  ]);
  return report.findings.filter(({ findingId }) =>
    supportingIds.has(findingId),
  );
}

function MatrixCellMark({ cell }: { cell: GeneralEvidenceMatrixCell }) {
  if (cell.status === "cited") {
    return (
      <>
        <strong>{cell.citedEvidenceCount}</strong>
        <span>cited</span>
      </>
    );
  }
  if (cell.status === "inspected_no_finding") {
    return (
      <>
        <strong aria-hidden="true">—</strong>
        <span>inspected</span>
      </>
    );
  }
  return (
    <>
      <strong aria-hidden="true">·</strong>
      <span>not inspected</span>
    </>
  );
}

function cellAccessibleLabel(
  dimensionId: WaymarkDimensionId,
  cell: GeneralEvidenceMatrixCell,
) {
  const prefix = `${dimensionLabels[dimensionId]}, ${sourceLabels[cell.source].full}`;
  if (cell.status === "cited") {
    return `${prefix}: ${cell.citedEvidenceCount} cited ${
      cell.citedEvidenceCount === 1 ? "citation" : "citations"
    }. Activate to inspect linked findings and citations.`;
  }
  if (cell.status === "inspected_no_finding") {
    return `${prefix}: surface inspected with no finding linked to this dimension. Activate for details.`;
  }
  return `${prefix}: not inspected. Activate for details.`;
}

export function GeneralAuditGraphics({
  report,
}: GeneralAuditGraphicsProps) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const selected =
    selectedCell === null
      ? null
      : report.evidenceMatrix[selectedCell.dimensionId][selectedCell.source];
  const selectedFindings =
    selectedCell === null || selected === null
      ? []
      : report.findings.filter(({ findingId }) =>
          selected.findingIds.includes(findingId),
        );

  return (
    <>
      <section
        className="panel general-dimension-panel"
        aria-labelledby="weighted-dimensions-title"
      >
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Weighted assessment</span>
            <h2 id="weighted-dimensions-title">
              Navigability by dimension
            </h2>
          </div>
          <div className="dimension-result-summary">
            <span>
              {report.completeness.assessedWeight}% of 100% assessed
            </span>
            <strong>
              {report.result
                ? `Auditor-assessed ${report.result.score}/100`
                : "Overall result unavailable"}
            </strong>
          </div>
        </div>
        <p className="general-graphic-intro">
          Bars show the auditor score only after adequate evidence. Unassessed
          dimensions remain blank rather than appearing as zero.
        </p>
        <div className="weighted-dimension-list">
          {report.dimensions.map((dimension) => {
            const supportingFindings = findSupportingFindings(report, dimension);
            const citationCount =
              dimension.evidenceCoverage.distinctCitationCount;
            return (
              <details
                className={`weighted-dimension status-${dimension.assessmentState}`}
                key={dimension.dimensionId}
              >
                <summary>
                  <div className="weighted-dimension-title">
                    <strong>{dimensionLabels[dimension.dimensionId]}</strong>
                    <span>{dimension.weight}% fixed weight</span>
                  </div>
                  <div className="weighted-dimension-state">
                    <strong>
                      {formatAssessmentState(dimension.assessmentState)}
                    </strong>
                    <span>
                      Confidence {formatConfidence(dimension.confidence)}
                    </span>
                  </div>
                  <div
                    className="weighted-dimension-bar"
                    aria-label={
                      dimension.score === null
                        ? `${dimensionLabels[dimension.dimensionId]} has no score`
                        : `${dimensionLabels[dimension.dimensionId]} score ${dimension.score} out of 100`
                    }
                    role="img"
                  >
                    {dimension.score !== null ? (
                      <i
                        aria-hidden="true"
                        style={{ width: `${dimension.score}%` }}
                      />
                    ) : null}
                  </div>
                  <strong className="weighted-dimension-score">
                    {dimension.score === null
                      ? "No score"
                      : `${dimension.score}/100`}
                  </strong>
                  <span className="weighted-dimension-coverage">
                    {citationCount} cited{" "}
                    {citationCount === 1 ? "citation" : "citations"} ·{" "}
                    {dimension.evidenceCoverage.state}
                  </span>
                  <span className="weighted-dimension-toggle" aria-hidden="true">
                    +
                  </span>
                </summary>
                <div className="weighted-dimension-detail">
                  <section>
                    <h3>Supporting findings</h3>
                    {supportingFindings.length > 0 ? (
                      <ul>
                        {supportingFindings.map((finding) => (
                          <li key={finding.findingId}>
                            <strong>{finding.currentRevision.title}</strong>
                            <span>
                              {finding.currentRevision.signal} ·{" "}
                              {finding.currentRevision.state.replaceAll(
                                "_",
                                " ",
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No supporting finding is linked yet.</p>
                    )}
                  </section>
                  <section>
                    <h3>Coverage and limitations</h3>
                    <p>
                      {dimension.evidenceCoverage.requirementSatisfied
                        ? "Current evidence requirement satisfied."
                        : "Current evidence requirement not satisfied."}
                    </p>
                    {dimension.limitations.length > 0 ? (
                      <ul>
                        {dimension.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>No dimension limitation was recorded.</p>
                    )}
                  </section>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section
        className="panel evidence-matrix-panel"
        aria-labelledby="evidence-matrix-title"
      >
        <div className="panel-heading">
          <div>
            <span className="section-kicker">Evidence coverage</span>
            <h2 id="evidence-matrix-title">Coverage by source</h2>
          </div>
          <span className="muted-action">
            {report.findings.length} current findings
          </span>
        </div>
        <p className="general-graphic-intro">
          Select a cell to inspect its linked findings and citations. A checked
          surface without dimension evidence is kept distinct from an
          uninspected surface.
        </p>
        <div className="evidence-matrix-scroll">
          <table className="evidence-matrix">
            <caption>
              Evidence coverage across six navigability dimensions and eight
              repository source types
            </caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                {evidenceSources.map((source) => (
                  <th scope="col" key={source}>
                    <abbr title={sourceLabels[source].full}>
                      {sourceLabels[source].short}
                    </abbr>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.dimensions.map((dimension) => {
                const cells = report.evidenceMatrix[dimension.dimensionId];
                const documentationOnly =
                  dimension.evidenceCoverage.requiresCodeOrTestEvidence &&
                  cells.documentation.citedEvidenceCount > 0 &&
                  cells.production_code.citedEvidenceCount === 0 &&
                  cells.test.citedEvidenceCount === 0;
                return (
                  <tr
                    className={
                      documentationOnly ? "is-documentation-only" : undefined
                    }
                    key={dimension.dimensionId}
                  >
                    <th scope="row">
                      <strong>{dimensionLabels[dimension.dimensionId]}</strong>
                      {documentationOnly ? (
                        <span>Documentation only · code support required</span>
                      ) : (
                        <span>
                          {formatAssessmentState(dimension.assessmentState)}
                        </span>
                      )}
                    </th>
                    {evidenceSources.map((source) => {
                      const cell = cells[source];
                      const isSelected =
                        selectedCell?.dimensionId === dimension.dimensionId &&
                        selectedCell.source === source;
                      return (
                        <td
                          className={`matrix-status-${cell.status}`}
                          key={source}
                        >
                          <button
                            aria-controls="evidence-matrix-detail"
                            aria-label={cellAccessibleLabel(
                              dimension.dimensionId,
                              cell,
                            )}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelectedCell(
                                isSelected
                                  ? null
                                  : {
                                      dimensionId: dimension.dimensionId,
                                      source,
                                    },
                              )
                            }
                            type="button"
                          >
                            <MatrixCellMark cell={cell} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="evidence-matrix-legend" aria-label="Coverage legend">
          <span className="matrix-status-cited">Cited evidence</span>
          <span className="matrix-status-inspected_no_finding">
            Inspected · no linked finding
          </span>
          <span className="matrix-status-not_inspected">Not inspected</span>
        </div>
        <aside
          aria-live="polite"
          className={`evidence-matrix-detail ${selected ? "has-selection" : ""}`}
          id="evidence-matrix-detail"
        >
          {selected && selectedCell ? (
            <>
              <div>
                <span>Selected coverage</span>
                <h3>
                  {dimensionLabels[selectedCell.dimensionId]} ·{" "}
                  {sourceLabels[selectedCell.source].full}
                </h3>
                <p>{cellAccessibleLabel(selectedCell.dimensionId, selected)}</p>
              </div>
              {selected.citations.length > 0 ? (
                <ul>
                  {selected.citations.map((citation) => (
                    <li
                      key={`${citation.path}-${citation.startLine}-${citation.endLine}-${citation.symbol ?? ""}`}
                    >
                      <code>
                        {citation.path}:{citation.startLine}
                        {citation.endLine === citation.startLine
                          ? ""
                          : `–${citation.endLine}`}
                      </code>
                      <span>
                        {citation.symbol ?? "Repository citation"} ·{" "}
                        {selectedFindings
                          .filter((finding) =>
                            finding.currentRevision.citations.some(
                              (item) =>
                                item.path === citation.path &&
                                item.startLine === citation.startLine &&
                                item.endLine === citation.endLine &&
                                item.source === citation.source,
                            ),
                          )
                          .map((finding) => finding.currentRevision.title)
                          .join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {selected.status === "inspected_no_finding"
                    ? "The repository surface was inspected, but no cited finding currently links this source to the selected dimension."
                    : "No inspection checkpoint or cited finding currently covers this source for the selected dimension."}
                </p>
              )}
            </>
          ) : (
            <p>Select a coverage cell to reveal its evidence.</p>
          )}
        </aside>
      </section>
    </>
  );
}
