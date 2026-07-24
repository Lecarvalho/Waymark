import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectExistingWaymarkService,
  resolveRequestedService,
} from "../scripts/service-preflight.mjs";

test("dev service configuration resolves the default shared journal", () => {
  const result = resolveRequestedService({
    environment: {},
    cwd: "C:\\work\\waymark",
  });

  assert.equal(result.serviceUrl, "http://127.0.0.1:4318");
  assert.equal(result.databasePathExplicit, false);
  assert.match(
    result.databasePath,
    /work[\\/]waymark[\\/]\.waymark[\\/]waymark\.sqlite$/i,
  );
});

test("dev preflight treats an existing Waymark journal as authoritative by default", async () => {
  const result = await inspectExistingWaymarkService({
    serviceUrl: "http://127.0.0.1:4318",
    expectedDatabasePath: undefined,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          service: "waymark",
          databasePath: "C:\\work\\waymark\\.waymark\\existing.sqlite",
        }),
        { status: 200 },
      ),
  });

  assert.deepEqual(result, {
    status: "reusable",
    databasePath: "C:\\work\\waymark\\.waymark\\existing.sqlite",
  });
});

test("dev preflight reuses Waymark only when the journal matches", async () => {
  const result = await inspectExistingWaymarkService({
    serviceUrl: "http://127.0.0.1:4318",
    expectedDatabasePath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          service: "waymark",
          databasePath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
        }),
        { status: 200 },
      ),
  });

  assert.deepEqual(result, {
    status: "reusable",
    databasePath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
  });
});

test("dev preflight exposes a journal mismatch instead of creating a database", async () => {
  const result = await inspectExistingWaymarkService({
    serviceUrl: "http://127.0.0.1:4318",
    expectedDatabasePath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          ok: true,
          service: "waymark",
          databasePath: "C:\\work\\waymark\\.waymark\\other.sqlite",
        }),
        { status: 200 },
      ),
  });

  assert.deepEqual(result, {
    status: "database_mismatch",
    databasePath: "C:\\work\\waymark\\.waymark\\other.sqlite",
  });
});

test("dev preflight distinguishes an absent service from an occupied port", async () => {
  const absent = await inspectExistingWaymarkService({
    serviceUrl: "http://127.0.0.1:4318",
    expectedDatabasePath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
    fetchImpl: async () => {
      throw new TypeError("connection refused");
    },
  });
  const occupied = await inspectExistingWaymarkService({
    serviceUrl: "http://127.0.0.1:4318",
    expectedDatabasePath: "C:\\work\\waymark\\.waymark\\waymark.sqlite",
    fetchImpl: async () =>
      new Response(JSON.stringify({ service: "other" }), { status: 200 }),
  });

  assert.deepEqual(absent, { status: "absent" });
  assert.deepEqual(occupied, { status: "occupied" });
});
