"use client";

import type { ReactNode } from "react";
import { PrepareAuditDialog } from "./prepare-audit-dialog";
import type { WaymarkRunSnapshot } from "./use-waymark-live";
import styles from "./shell.module.css";

export type ShellView = "live" | "history" | "guide";

type ShellProps = {
  children: ReactNode;
  connection: "connecting" | "live" | "offline";
  historyLength: number;
  isHistoricalReport: boolean;
  onNavigate: (view: ShellView) => void;
  repositoryCommit: string;
  repositoryName: string;
  snapshot: WaymarkRunSnapshot | null;
  view: ShellView;
};

type EmptyAuditStateProps = {
  connection: "connecting" | "live" | "offline";
};

function classes(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => styles[name as keyof typeof styles] ?? name)
    .join(" ");
}

export function EmptyAuditState({ connection }: EmptyAuditStateProps) {
  return (
    <div className={`page-content ${classes("empty-audit-view")}`}>
      <section className={`panel ${classes("empty-audit-state")}`}>
        <span className={classes("empty-state-mark")} aria-hidden="true">
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
        <div className={classes("empty-state-rule")}>
          <strong>Source of truth</strong>
          <span>Paired agent → audit protocol → SQLite → this dashboard</span>
        </div>
      </section>
    </div>
  );
}

export function Shell({
  children,
  connection,
  historyLength,
  isHistoricalReport,
  onNavigate,
  repositoryCommit,
  repositoryName,
  snapshot,
  view,
}: ShellProps) {
  return (
    <main className={classes("app-shell")}>
      <aside className={classes("sidebar")}>
        <div className={classes("brand")}>
          <span className={classes("brand-mark")} aria-hidden="true">
            W
          </span>
          <span>Waymark</span>
        </div>

        <nav aria-label="Primary navigation">
          <button
            aria-current={view === "live" ? "page" : undefined}
            className={classes("nav-item")}
            onClick={() => onNavigate("live")}
            type="button"
          >
            <span className={classes("nav-symbol")}>◎</span>
            Live audit
          </button>
          <button
            aria-current={view === "history" ? "page" : undefined}
            className={classes("nav-item")}
            onClick={() => onNavigate("history")}
            type="button"
          >
            <span className={classes("nav-symbol")}>↗</span>
            Run history
          </button>
          <button
            aria-current={view === "guide" ? "page" : undefined}
            className={classes("nav-item")}
            onClick={() => onNavigate("guide")}
            type="button"
          >
            <span className={classes("nav-symbol")}>§</span>
            Practice guide
          </button>
        </nav>

        <div className={classes("sidebar-foot")}>
          <div className={classes("archive-status")}>
            <span className={classes("database-icon")} aria-hidden="true" />
            <div>
              <strong>Local archive</strong>
              <span>{historyLength} reports in SQLite</span>
            </div>
          </div>
        </div>
      </aside>

      <section className={classes("workspace")}>
        <header className={classes("topbar")}>
          <div className={classes("repo-switcher")}>
            <span className={classes("repo-label")}>Repository</span>
            <strong>{repositoryName}</strong>
            <code>{repositoryCommit}</code>
          </div>
          <div className={classes("topbar-actions")}>
            <PrepareAuditDialog />
            <span className={classes("local-pill")}>
              <i
                data-status={connection === "live" ? "connected" : "offline"}
                aria-hidden="true"
              />
              {connection === "live"
                ? "Local service"
                : connection === "connecting"
                  ? "Connecting to SQLite"
                  : "Service offline"}
            </span>
            <div
              className={classes("pairing-status")}
              title={
                isHistoricalReport
                  ? "Report loaded from the local SQLite archive"
                  : "Audit input comes from the paired coding agent"
              }
            >
              <span className={classes("pairing-mark")} aria-hidden="true">
                {isHistoricalReport ? "DB" : "CX"}
              </span>
              <span className={classes("pairing-agent")}>
                <small>
                  {isHistoricalReport
                    ? "Saved report"
                    : snapshot
                      ? "Paired session"
                      : "Coding agent"}
                </small>
                <strong>
                  {isHistoricalReport
                    ? new Date(snapshot!.startedAt).toLocaleDateString()
                    : (snapshot?.agentHost ?? "Awaiting audit")}
                </strong>
              </span>
              <i
                className={classes("pairing-state")}
                data-status={
                  snapshot && !isHistoricalReport ? "connected" : "idle"
                }
                aria-label={
                  isHistoricalReport
                    ? "Saved audit report"
                    : snapshot
                      ? "Audit connected"
                      : "No active audit"
                }
              />
            </div>
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}
