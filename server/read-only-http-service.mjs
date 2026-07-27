import { createServer } from "node:http";

import { discoverProviderCapabilities } from "../src/orchestration/provider-capabilities.mjs";
import { toRunSnapshot } from "./run-snapshot.mjs";

const AUDIT_MODES = new Set([
  "general",
  "task_specific",
  "system_explanation",
]);

function json(response, status, value) {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function createReadOnlyHttpService({
  store,
  databasePath,
  eventStream,
  providerCapabilityOptions,
}) {
  return createServer((request, response) => {
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
          databasePath,
          capabilities: {
            generalLiveTokenBreakdown: true,
          },
        });
        return;
      }

      if (url.pathname === "/api/provider-capabilities") {
        const auditMode =
          url.searchParams.get("auditMode") ?? "task_specific";
        if (!AUDIT_MODES.has(auditMode)) {
          json(response, 400, { error: "invalid_audit_mode" });
          return;
        }
        json(
          response,
          200,
          discoverProviderCapabilities({
            ...providerCapabilityOptions,
            historicalTokenAverages: store.readCompletedTokenAverages({
              auditMode,
            }),
          }),
        );
        return;
      }

      if (url.pathname === "/api/events") {
        eventStream.register(request, response);
        return;
      }

      if (url.pathname === "/api/runs") {
        json(response, 200, store.listRuns({ limit: 100 }));
        return;
      }

      if (url.pathname === "/api/runs/summaries") {
        const runs = store.listRuns({ limit: 100 });
        const reports = runs.map((run) => store.readReport(run.id));
        json(
          response,
          200,
          reports.map((report) =>
            toRunSnapshot(report, runs.length, reports),
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
        const reports = runs.map((run) => store.readReport(run.id));
        json(response, 200, toRunSnapshot(reports[0], runs.length, reports));
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
}
