import assert from "node:assert/strict";
import test from "node:test";

import { createReadOnlyHttpService } from "../server/read-only-http-service.mjs";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

test("read-only router preserves health, method, and not-found policies", async (t) => {
  const missing = new Error("Run not found");
  missing.code = "RUN_NOT_FOUND";
  const store = {
    listRuns: () => [],
    readReport: () => {
      throw missing;
    },
    readEvents: () => {
      throw missing;
    },
    readCompletedTokenAverages: () => ({}),
  };
  const eventStream = {
    register(_request, response) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("event: ready\ndata: {}\n\n");
    },
  };
  const server = createReadOnlyHttpService({
    store,
    databasePath: "C:/tmp/waymark-fixture.sqlite",
    eventStream,
  });
  const url = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    service: "waymark",
    databasePath: "C:/tmp/waymark-fixture.sqlite",
  });

  const options = await fetch(`${url}/api/runs`, { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-methods"), "GET, OPTIONS");

  const mutation = await fetch(`${url}/api/runs`, { method: "POST" });
  assert.equal(mutation.status, 405);
  assert.deepEqual(await mutation.json(), { error: "read_only_service" });

  const latest = await fetch(`${url}/api/runs/latest`);
  assert.equal(latest.status, 404);
  assert.deepEqual(await latest.json(), { error: "no_runs" });

  const invalidMode = await fetch(
    `${url}/api/provider-capabilities?auditMode=unknown`,
  );
  assert.equal(invalidMode.status, 400);
  assert.deepEqual(await invalidMode.json(), { error: "invalid_audit_mode" });

  const missingRun = await fetch(`${url}/api/runs/missing`);
  assert.equal(missingRun.status, 404);
  assert.deepEqual(await missingRun.json(), {
    error: "RUN_NOT_FOUND",
    message: "Run not found",
  });

  const unknown = await fetch(`${url}/unknown`);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "not_found" });
});
