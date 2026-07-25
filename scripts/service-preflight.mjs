import { resolve } from "node:path";

const DEFAULT_DATABASE_PATH = ".waymark/waymark.sqlite";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4318;

function normalizedDatabasePath(value, cwd = process.cwd()) {
  if (value === ":memory:") return value;
  const absolute = resolve(cwd, value);
  return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

export function resolveRequestedService({
  environment = process.env,
  cwd = process.cwd(),
} = {}) {
  const host = environment.WAYMARK_HOST ?? DEFAULT_HOST;
  const port = Number(environment.WAYMARK_PORT ?? DEFAULT_PORT);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("WAYMARK_PORT must be an integer from 1 through 65535");
  }
  const databasePath =
    environment.WAYMARK_DB_PATH === ":memory:"
      ? ":memory:"
      : resolve(cwd, environment.WAYMARK_DB_PATH ?? DEFAULT_DATABASE_PATH);

  return {
    databasePath,
    databasePathExplicit: environment.WAYMARK_DB_PATH !== undefined,
    serviceUrl: `http://${host}:${port}`,
  };
}

export async function inspectExistingWaymarkService({
  serviceUrl,
  expectedDatabasePath,
  fetchImpl = fetch,
}) {
  let response;
  try {
    response = await fetchImpl(`${serviceUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
  } catch {
    return { status: "absent" };
  }

  let health;
  try {
    health = await response.json();
  } catch {
    return { status: "occupied" };
  }
  if (
    !response.ok ||
    health?.ok !== true ||
    health?.service !== "waymark" ||
    typeof health?.databasePath !== "string"
  ) {
    return { status: "occupied" };
  }

  if (
    expectedDatabasePath !== undefined &&
    normalizedDatabasePath(health.databasePath) !==
      normalizedDatabasePath(expectedDatabasePath)
  ) {
    return {
      status: "database_mismatch",
      databasePath: health.databasePath,
    };
  }

  return {
    status: "reusable",
    databasePath: health.databasePath,
  };
}
