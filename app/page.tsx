"use client";

import { useState } from "react";
import { BenchmarkAuditView } from "./benchmark-audit-view";
import { GeneralAuditView } from "./general-audit-view";
import { HistoryView } from "./history-view";
import { PracticeGuideView } from "./practice-guide-view";
import { EmptyAuditState, Shell } from "./shell";
import { useWaymarkLive } from "./use-waymark-live";
import benchmarkSummaryStyles from "./benchmark-summary.module.css";

function classes(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(
      (name) =>
        benchmarkSummaryStyles[
          name as keyof typeof benchmarkSummaryStyles
        ] ?? name,
    )
    .join(" ");
}

export default function Home() {
  const [view, setView] = useState<"live" | "history" | "guide">("live");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const {
    snapshot: liveSnapshot,
    history,
    connection,
  } = useWaymarkLive();
  const selectedReport =
    history.find((run) => run.id === selectedReportId) ?? null;
  const snapshot = selectedReport ?? liveSnapshot;
  const isHistoricalReport = selectedReport !== null;
  const isGeneralAudit =
    snapshot?.auditMode === "general" ||
    snapshot?.task.includes("waymark-general-navigation@") === true;

  const showLatestAudit = () => {
    setSelectedReportId(null);
    setView("live");
  };

  const showSavedReport = (runId: string) => {
    setSelectedReportId(runId);
    setView("live");
  };

  const repositoryName = snapshot?.repository.name ?? "No audit selected";
  const repositoryCommit = snapshot?.repository.commit ?? "—";
  return (
    <Shell
      connection={connection}
      historyLength={history.length}
      isHistoricalReport={isHistoricalReport}
      onNavigate={(nextView) => {
        if (nextView === "live") {
          showLatestAudit();
        } else {
          setView(nextView);
        }
      }}
      repositoryCommit={repositoryCommit}
      repositoryName={repositoryName}
      snapshot={snapshot}
      view={view}
    >
      {view === "live" ? (
        snapshot ? (
        <div
          className="page-content"
          data-status={snapshot.status}
        >
          {isHistoricalReport ? (
            <section className={classes("historical-report-banner")} aria-label="Saved report">
              <div>
                <span>Viewing saved report</span>
                <strong>
                  {new Date(snapshot.startedAt).toLocaleString()} ·{" "}
                  {snapshot.repository.commit}
                </strong>
              </div>
              <div>
                <button type="button" onClick={() => setView("history")}>
                  Back to run history
                </button>
                <button type="button" onClick={showLatestAudit}>
                  Return to latest
                </button>
              </div>
            </section>
          ) : null}
          {isGeneralAudit && snapshot.generalAudit ? (
            <GeneralAuditView snapshot={snapshot} />
          ) : (
            <BenchmarkAuditView snapshot={snapshot} />
          )}
        </div>
        ) : (
          <EmptyAuditState connection={connection} />
        )
      ) : view === "history" ? (
        <HistoryView history={history} onSelectReport={showSavedReport} />
      ) : (
        <PracticeGuideView />
      )}
    </Shell>
  );
}
