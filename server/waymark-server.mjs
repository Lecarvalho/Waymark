import { statSync } from "node:fs";
import { createServer } from "node:http";
import { basename } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  AuditStore,
  DEFAULT_DATABASE_PATH,
  resolveDatabasePath,
} from "../src/persistence/index.mjs";
import { hashScoreInput, scoreAudit } from "../src/scoring/index.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4318;
const TOKEN_PHASES = [
  "candidate_navigation",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
];

function json(response, status, value) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function databaseSignature(databasePath) {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]
    .map((path) => {
      try {
        const stat = statSync(path);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return "missing";
      }
    })
    .join("|");
}

function lastDefinedEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function tokenSource(measurements) {
  if (measurements.length === 0) return null;
  const sources = new Set(measurements.map((measurement) => measurement.source));
  return sources.size === 1 ? measurements[0].source : "mixed";
}

function summarizeTokens(measurements) {
  if (measurements.length === 0) {
    return {
      totalTokens: null,
      inputTokens: null,
      cachedInputTokens: null,
      uncachedInputTokens: null,
      outputTokens: null,
      unclassifiedTokens: null,
      cacheCreationTokens: null,
      source: null,
    };
  }

  const totalTokens = measurements.reduce(
    (total, measurement) => total + measurement.totalTokens,
    0,
  );
  const inputTokens = measurements.reduce(
    (total, measurement) => total + measurement.inputTokens,
    0,
  );
  const cachedInputTokens = measurements.reduce(
    (total, measurement) => total + measurement.cachedInputTokens,
    0,
  );
  const outputTokens = measurements.reduce(
    (total, measurement) => total + measurement.outputTokens,
    0,
  );

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens),
    outputTokens,
    unclassifiedTokens: Math.max(
      0,
      totalTokens - inputTokens - outputTokens,
    ),
    cacheCreationTokens: measurements.reduce(
      (total, measurement) => total + measurement.cacheCreationTokens,
      0,
    ),
    source: tokenSource(measurements),
  };
}

function positiveNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function verifyAuthoritativeScore(event) {
  if (!event) return {};
  const input = event.payload?.input;
  const inputHash = event.payload?.inputHash;
  if (
    !input ||
    typeof input !== "object" ||
    typeof inputHash !== "string" ||
    hashScoreInput(input) !== inputHash
  ) {
    return {};
  }

  try {
    return scoreAudit(input);
  } catch {
    return {};
  }
}

export function toRunSnapshot(report, runCount) {
  const { run, events, aggregates } = report;
  const authoritativeScoreEvent = lastDefinedEvent(
    events,
    (event) =>
      event.type === "score.completed" &&
      event.actor === "waymark:scorer",
  );
  const score = verifyAuthoritativeScore(authoritativeScoreEvent);
  const progressEvent = lastDefinedEvent(
    events,
    (event) =>
      typeof event.payload?.progress === "number" ||
      typeof event.payload?.phase === "string",
  );
  const challengeEvents = events.filter(
    (event) => event.type === "challenge.raised",
  );
  const challengedClaimIds = new Set(
    challengeEvents
      .map((event) => event.payload?.claimId)
      .filter((claimId) => typeof claimId === "string"),
  );
  const resolvedChallengeIds = new Set(
    events
      .filter((event) => event.type === "challenge.resolved")
      .map((event) => event.payload?.challengeId)
      .filter((challengeId) => typeof challengeId === "string"),
  );
  const latestVerificationByClaim = new Map();
  for (const verification of report.verifications) {
    latestVerificationByClaim.set(verification.claimId, verification);
  }
  const tokensByActor = new Map();
  const tokenMeasurementsByActor = new Map();
  for (const token of report.tokens) {
    tokensByActor.set(
      token.actor,
      (tokensByActor.get(token.actor) ?? 0) + token.totalTokens,
    );
    const measurements = tokenMeasurementsByActor.get(token.actor) ?? [];
    measurements.push(token);
    tokenMeasurementsByActor.set(token.actor, measurements);
  }
  const candidateNavigationMeasurements = report.tokens.filter(
    (token) => token.phase === "candidate_navigation",
  );
  const overallTokenUsage = summarizeTokens(report.tokens);
  const tokenUsageByPhase = TOKEN_PHASES.map((phaseName) => ({
    phase: phaseName,
    ...summarizeTokens(
      report.tokens.filter((token) => token.phase === phaseName),
    ),
  }));
  const candidateNavigationUsage = summarizeTokens(
    candidateNavigationMeasurements,
  );
  const resolvedClaims =
    aggregates.verifiedClaimCount + aggregates.contradictedClaimCount;
  const candidateConfidence =
    report.claims.length === 0
      ? 0
      : report.claims.reduce((total, claim) => total + claim.confidence, 0) /
        report.claims.length;
  const candidate = run.participants.find(
    (participant) => participant.role === "candidate",
  );
  const orchestrator = run.participants.find(
    (participant) => participant.role === "orchestrator",
  );
  const repositoryName =
    run.repositoryIdentity || basename(run.targetRepositoryPath);
  const status =
    run.status === "active"
      ? "running"
      : run.status === "completed"
        ? "completed"
        : "failed";
  const progress =
    status === "completed"
      ? 100
      : (numberOrNull(progressEvent?.payload?.progress) ?? 0);
  const phase =
    status === "completed"
      ? "Complete"
      : typeof progressEvent?.payload?.phase === "string"
        ? progressEvent.payload.phase
        : "Discovery";
  const overall =
    numberOrNull(score?.overall?.score);
  const reliability =
    numberOrNull(score?.reliability?.score);
  const configuredCandidateBudget =
    run.runConditions?.tokenBudgets?.candidate_navigation;
  const candidateTargetTokens =
    positiveNumberOrNull(score?.tokenEfficiency?.target) ??
    positiveNumberOrNull(configuredCandidateBudget?.targetTokens);
  const candidateHardLimitTokens = positiveNumberOrNull(
    configuredCandidateBudget?.hardLimitTokens,
  );
  const candidateUsedTokens = candidateNavigationUsage.totalTokens;
  const candidateTargetMultiple =
    candidateUsedTokens === null || candidateTargetTokens === null
      ? null
      : Math.round((candidateUsedTokens / candidateTargetTokens) * 100) / 100;
  const candidateHardLimitExceeded =
    candidateUsedTokens === null || candidateHardLimitTokens === null
      ? null
      : candidateUsedTokens > candidateHardLimitTokens;
  const latestEvent = events.at(-1);
  const latestEventText =
    typeof latestEvent?.payload?.message === "string"
      ? latestEvent.payload.message
      : latestEvent?.type === "run.finished"
        ? "Audit completed and saved."
        : latestEvent?.type ?? "Run created";

  return {
    id: run.id,
    status,
    repository: {
      name: repositoryName,
      path: run.targetRepositoryPath,
      commit: run.commitSha.slice(0, 12),
    },
    task: run.task,
    phase,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    startedAt: run.createdAt,
    agentHost:
      typeof run.runConditions?.agentHost === "string"
        ? run.runConditions.agentHost
        : "Codex",
    latestEvent: latestEventText,
    activeAgentCount:
      status === "running"
        ? run.participants.filter(
            (participant) =>
              participant.role !== "reporter" &&
              participant.role !== "verifier",
          ).length
        : 0,
    models: {
      candidate: candidate?.model ?? "unknown",
      orchestrator: orchestrator?.model ?? "unknown",
    },
    participants: run.participants.map((participant) => ({
      role: participant.role,
      provider: participant.provider,
      model: participant.model,
      status: status === "running" ? "Active" : "Complete",
      tokens: tokensByActor.has(participant.role)
        ? tokensByActor.get(participant.role)
        : null,
      tokenSource: tokenSource(
        tokenMeasurementsByActor.get(participant.role) ?? [],
      ),
    })),
    evidence: report.claims.map((claim) => {
      const verification = latestVerificationByClaim.get(claim.id);
      const statusText =
        verification?.verdict === "verified"
          ? "Verified"
          : verification?.verdict === "contradicted"
            ? "Contradicted"
            : "Unverified";
      return {
        claim: claim.assertion,
        source: claim.citations[0]
          ? `${claim.citations[0].path}${
              claim.citations[0].startLine
                ? `:${claim.citations[0].startLine}`
                : ""
            }`
          : "No citation",
        status: statusText,
        tone:
          verification?.verdict === "verified"
            ? "good"
            : verification?.verdict === "contradicted"
              ? "bad"
              : "warn",
      };
    }),
    recommendations: events
      .filter((event) => event.type === "recommendation.created")
      .map((event) => ({
        priority:
          typeof event.payload.priority === "string"
            ? event.payload.priority
            : "P1",
        title:
          typeof event.payload.title === "string"
            ? event.payload.title
            : "Untitled recommendation",
        description:
          typeof event.payload.description === "string"
            ? event.payload.description
            : "",
        gain:
          typeof event.payload.gain === "string" ? event.payload.gain : "—",
        cost:
          typeof event.payload.cost === "string"
            ? event.payload.cost
            : "Unestimated",
      })),
    tokenUsage: {
      overall: overallTokenUsage,
      byPhase: tokenUsageByPhase,
      candidateBudget: {
        usedTokens: candidateUsedTokens,
        targetTokens: candidateTargetTokens,
        hardLimitTokens: candidateHardLimitTokens,
        targetMultiple: candidateTargetMultiple,
        hardLimitExceeded: candidateHardLimitExceeded,
        efficiencyScore: numberOrNull(score?.tokenEfficiency?.score),
        eligible:
          typeof score?.tokenEfficiency?.eligible === "boolean"
            ? score.tokenEfficiency.eligible
            : null,
      },
      monetaryCost: {
        status: "unavailable",
        amount: null,
        currency: null,
        reason: "No versioned provider pricing snapshot was recorded.",
      },
    },
    metrics: {
      navigability: overall,
      reliability,
      candidateTokens:
        candidateNavigationMeasurements.length === 0
          ? null
          : aggregates.tokensByPhase.candidate_navigation,
      candidateTokenSource: tokenSource(candidateNavigationMeasurements),
      claimsChallenged: challengedClaimIds.size,
      totalClaims: aggregates.claimCount,
      openChallenges: Math.max(
        0,
        challengeEvents.length - resolvedChallengeIds.size,
      ),
      candidateConfidence: Math.round(candidateConfidence * 100),
      verifiedAccuracy:
        resolvedClaims === 0
          ? 0
          : Math.round(
              (aggregates.verifiedClaimCount / resolvedClaims) * 100,
            ),
    },
    runCount,
  };
}

export async function startWaymarkServer({
  databasePath = process.env.WAYMARK_DB_PATH ?? DEFAULT_DATABASE_PATH,
  host = process.env.WAYMARK_HOST ?? DEFAULT_HOST,
  port = Number(process.env.WAYMARK_PORT ?? DEFAULT_PORT),
} = {}) {
  const resolvedDatabasePath = resolveDatabasePath(databasePath);
  const store = new AuditStore({ databasePath: resolvedDatabasePath });
  const clients = new Set();

  const broadcast = (event = "changed") => {
    const payload = `event: ${event}\ndata: ${JSON.stringify({
      at: new Date().toISOString(),
    })}\n\n`;
    for (const response of clients) response.write(payload);
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-origin": "*",
      });
      response.end();
      return;
    }

    if (request.method !== "GET") {
      json(response, 405, { error: "read_only_service" });
      return;
    }

    try {
      if (url.pathname === "/health") {
        json(response, 200, {
          ok: true,
          service: "waymark",
          databasePath: resolvedDatabasePath,
        });
        return;
      }

      if (url.pathname === "/api/events") {
        response.writeHead(200, {
          "access-control-allow-origin": "*",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream",
        });
        response.write(
          `event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
        );
        clients.add(response);
        request.on("close", () => clients.delete(response));
        return;
      }

      if (url.pathname === "/api/runs") {
        json(response, 200, store.listRuns({ limit: 100 }));
        return;
      }

      if (url.pathname === "/api/runs/summaries") {
        const runs = store.listRuns({ limit: 100 });
        json(
          response,
          200,
          runs.map((run) =>
            toRunSnapshot(store.readReport(run.id), runs.length),
          ),
        );
        return;
      }

      if (url.pathname === "/api/runs/latest") {
        const runs = store.listRuns({ limit: 500 });
        if (runs.length === 0) {
          json(response, 404, { error: "no_runs" });
          return;
        }
        json(
          response,
          200,
          toRunSnapshot(store.readReport(runs[0].id), runs.length),
        );
        return;
      }

      const eventsMatch = url.pathname.match(
        /^\/api\/runs\/([^/]+)\/events$/,
      );
      if (eventsMatch) {
        json(
          response,
          200,
          store.readEvents(decodeURIComponent(eventsMatch[1]), {
            afterSequence: Number(url.searchParams.get("after") ?? 0),
            limit: 10_000,
          }),
        );
        return;
      }

      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runMatch) {
        json(
          response,
          200,
          store.readReport(decodeURIComponent(runMatch[1])),
        );
        return;
      }

      json(response, 404, { error: "not_found" });
    } catch (error) {
      const status =
        error?.code === "NOT_FOUND" || error?.code === "RUN_NOT_FOUND"
          ? 404
          : 500;
      json(response, status, {
        error: error?.code ?? "service_error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  let signature = databaseSignature(resolvedDatabasePath);
  const changeTimer = setInterval(() => {
    const next = databaseSignature(resolvedDatabasePath);
    if (next !== signature) {
      signature = next;
      broadcast();
    }
  }, 500);
  changeTimer.unref();

  const heartbeatTimer = setInterval(() => broadcast("heartbeat"), 20_000);
  heartbeatTimer.unref();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    server,
    close: async () => {
      clearInterval(changeTimer);
      clearInterval(heartbeatTimer);
      for (const response of clients) response.end();
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  try {
    const service = await startWaymarkServer();
    process.stdout.write(`Waymark service listening at ${service.url}\n`);
    const stop = async () => {
      await service.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
