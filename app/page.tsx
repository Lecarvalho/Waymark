"use client";

import { useState } from "react";
import { BenchmarkAuditView } from "./benchmark-audit-view";
import { GeneralAuditView } from "./general-audit-view";
import { HistoryView } from "./history-view";
import { PracticeGuideView } from "./practice-guide-view";
import { EmptyAuditState, Shell } from "./shell";
import { useWaymarkLive } from "./use-waymark-live";
import benchmarkSummaryStyles from "./benchmark-summary.module.css";
import channelStyles from "./general-audit-channel.module.css";

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

function GeneralAuditChannelStatus({
  snapshot,
}: {
  snapshot: NonNullable<ReturnType<typeof useWaymarkLive>["snapshot"]>;
}) {
  const channel = snapshot.generalAudit?.observationChannel;
  if (!channel) return null;

  const healthLabel = {
    waiting: "Waiting",
    healthy: "Healthy",
    degraded: "Warnings",
    recovered: "Recovered",
    failed: "Failed",
  }[channel.health as "waiting" | "healthy" | "degraded" | "recovered" | "failed"];
  const providerDiagnosticsStatus =
    channel.providerDiagnostics?.status ??
    (channel.providerTools.declined > 0 || channel.providerTools.failed > 0
      ? "warnings"
      : "clean");
  return (
    <section
      aria-label="General audit observation channel"
      className={channelStyles.status}
      data-health={channel.health}
      role="status"
    >
      <div className={channelStyles.summary}>
        <span>Semantic delivery</span>
        <strong>{healthLabel}</strong>
        <small>
          {channel.acceptedSemanticCheckpoints > 0
            ? "Durable semantic evidence is reaching the journal."
            : "Waiting for durable semantic evidence."}
        </small>
      </div>
      <dl>
        <div>
          <dt>Accepted checkpoints</dt>
          <dd>{channel.acceptedSemanticCheckpoints}</dd>
        </div>
        <div>
          <dt>Provider tools</dt>
          <dd>{providerDiagnosticsStatus}</dd>
          <small>
            {channel.providerTools.completed} completed ·{" "}
            {channel.providerTools.declined} declined ·{" "}
            {channel.providerTools.failed} failed
          </small>
        </div>
        <div>
          <dt>Rejected checkpoints</dt>
          <dd>{channel.rejectedSemanticCheckpoints}</dd>
        </div>
      </dl>
      {channel.latestFailureReason ? (
        <p>
          <span>Latest recorded issue</span>
          <strong>{channel.latestFailureReason}</strong>
          {channel.latestFailureCommand ? (
            <code>{channel.latestFailureCommand}</code>
          ) : null}
        </p>
      ) : null}
      {channel.semanticDelivery?.latestError ? (
        <p>
          <span>
            Rejected {channel.semanticDelivery.latestError.semanticType ?? "checkpoint"} at{" "}
            {channel.semanticDelivery.latestError.path ?? "unknown field"} · sequence{" "}
            {channel.semanticDelivery.latestError.sequence}
          </span>
          <strong>{channel.semanticDelivery.latestError.message}</strong>
          {channel.semanticDelivery.latestError.expectedShape ? (
            <small>{channel.semanticDelivery.latestError.expectedShape}</small>
          ) : null}
        </p>
      ) : null}
    </section>
  );
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
            <>
              <GeneralAuditChannelStatus snapshot={snapshot} />
              <GeneralAuditView snapshot={snapshot} />
            </>
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
        <PracticeGuideView snapshot={snapshot} />
      )}
    </Shell>
  );
}
