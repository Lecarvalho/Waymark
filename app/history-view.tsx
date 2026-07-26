"use client";

import type { WaymarkRunSnapshot } from "./use-waymark-live";
import styles from "./history-view.module.css";

function classes(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => styles[name as keyof typeof styles] ?? name)
    .join(" ");
}

function formatTokenCount(value: number | null) {
  if (value === null) return "Unavailable";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
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
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : 69).trimEnd()}â€¦`;
}

type HistoryViewProps = {
  history: WaymarkRunSnapshot[];
  onSelectReport: (runId: string) => void;
};

export function HistoryView({ history, onSelectReport }: HistoryViewProps) {
  const scoredHistory = history.filter(
    (run) => run.metrics.navigability !== null,
  );
  const projectHistory = Array.from(
    history.reduce((projects, run) => {
      const projectKey = run.repository.path || run.repository.name;
      const project = projects.get(projectKey) ?? {
        key: projectKey,
        name: run.repository.name,
        path: run.repository.path,
        runs: [],
      };
      project.runs.push(run);
      projects.set(projectKey, project);
      return projects;
    }, new Map<string, {
      key: string;
      name: string;
      path: string;
      runs: typeof history;
    }>()),
  ).map(([, project]) => {
    const runs = [...project.runs].sort(
      (left, right) =>
        new Date(right.startedAt).getTime() -
        new Date(left.startedAt).getTime(),
    );
    const scoredRuns = runs.filter(
      (run) => run.metrics.navigability !== null,
    );
    const scoreChange =
      scoredRuns.length > 1
        ? (scoredRuns[0].metrics.navigability ?? 0) -
          (scoredRuns.at(-1)?.metrics.navigability ?? 0)
        : null;

    return { ...project, runs, scoreChange };
  });
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
    <div className={classes("page-content history-view")}>
      <section className={classes("history-hero")}>
        <div>
          <span className={classes("section-kicker")}>Local SQLite archive</span>
          <h1>Is the repository getting easier to navigate?</h1>
          <p>
            Compare agent performance across commits, tasks, and model
            capability.
          </p>
        </div>
        <div className={classes("improvement-stat")}>
          <span>Codebases</span>
          <strong>{projectHistory.length}</strong>
          <small>
            {history.length} {history.length === 1 ? "report" : "reports"}
          </small>
        </div>
      </section>

      <section className={classes("panel history-panel")}>
        <div className={classes("panel-heading")}>
          <div>
            <span className={classes("section-kicker")}>Saved reports</span>
            <h2>Reports by codebase</h2>
          </div>
          <span className={classes("muted-action")}>
            {projectHistory.length}{" "}
            {projectHistory.length === 1 ? "project" : "projects"}
          </span>
        </div>
        {history.length === 0 ? (
          <div className={classes("empty-table-state")}>
            No audit runs are stored in SQLite yet.
          </div>
        ) : (
          <div className={classes("project-history-list")}>
            {projectHistory.map((project) => (
              <section
                className={classes("project-history-group")}
                key={project.key}
                aria-labelledby={`project-${project.runs[0].id}`}
              >
                <header className={classes("project-history-heading")}>
                  <div>
                    <h3 id={`project-${project.runs[0].id}`}>
                      {project.name}
                    </h3>
                    <code>{project.path}</code>
                  </div>
                  <div className={classes("project-history-meta")}>
                    <span>
                      {project.runs.length}{" "}
                      {project.runs.length === 1 ? "report" : "reports"}
                    </span>
                    <strong
                      data-status={
                        project.scoreChange !== null &&
                        project.scoreChange < 0
                          ? "negative"
                          : "neutral"
                      }
                    >
                      {project.scoreChange === null
                        ? "Change —"
                        : `Change ${
                            project.scoreChange >= 0 ? "+" : ""
                          }${project.scoreChange}`}
                    </strong>
                  </div>
                </header>
                <div
                  className={classes("history-table")}
                  aria-label={`${project.name} audit reports`}
                >
                  <div className={classes("history-row history-head")}>
                    <span>Date</span>
                    <span>Commit</span>
                    <span>Name</span>
                    <span>Candidate</span>
                    <span>Score</span>
                    <span>Reliability</span>
                    <span>Tokens</span>
                  </div>
                  {project.runs.map((run) => {
                    const tokens = run.tokenUsage.overall.totalTokens;
                    const runName = displayRunName(run.name, run.task);
                    return (
                      <button
                        className={classes("history-row")}
                        data-interactive
                        key={run.id}
                        type="button"
                        onClick={() => onSelectReport(run.id)}
                        aria-label={`Open ${runName} report for ${project.name} from ${new Date(
                          run.startedAt,
                        ).toLocaleDateString()}`}
                      >
                        <span>
                          {new Date(run.startedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                        <code>{run.repository.commit}</code>
                        <strong>{runName}</strong>
                        <code>{run.models.candidate}</code>
                        <span className={classes("history-score")}>
                          {run.metrics.navigability ?? "—"}
                        </span>
                        <span>
                          {run.metrics.reliability === null
                            ? "—"
                            : `${run.metrics.reliability}%`}
                        </span>
                        <span>{formatTokenCount(tokens)}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {modelScores.length > 0 && (
        <section className={classes("history-summary-grid single-summary")}>
          <article className={classes("panel model-compare")}>
            <span className={classes("section-kicker")}>Model frontier</span>
            <h2>Average navigability by candidate model</h2>
            {modelScores.map((model) => (
              <div className={classes("model-bar-row")} key={model.model}>
                <code>{model.model}</code>
                <div>
                  <i style={{ width: `${model.score}%` }} />
                </div>
                <strong>{model.score}</strong>
              </div>
            ))}
            <p>
              Computed only from authoritative scores stored across the
              local archive.
            </p>
          </article>
        </section>
      )}
    </div>
  );
}
