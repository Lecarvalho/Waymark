import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  AuditStore,
  DEFAULT_DATABASE_PATH,
  resolveDatabasePath,
} from "../src/persistence/index.mjs";
import { createJournalEventStream } from "./journal-event-stream.mjs";
import { createReadOnlyHttpService } from "./read-only-http-service.mjs";

export { buildGeneralAuditHistory } from "./general-audit-snapshot.mjs";
export { toRunSnapshot } from "./run-snapshot.mjs";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4318;

export async function startWaymarkServer({
  databasePath = process.env.WAYMARK_DB_PATH ?? DEFAULT_DATABASE_PATH,
  host = process.env.WAYMARK_HOST ?? DEFAULT_HOST,
  port = Number(process.env.WAYMARK_PORT ?? DEFAULT_PORT),
  providerCapabilityOptions,
} = {}) {
  const resolvedDatabasePath = resolveDatabasePath(databasePath);
  const store = new AuditStore({ databasePath: resolvedDatabasePath });
  const eventStream = createJournalEventStream({
    databasePath: resolvedDatabasePath,
  });
  const server = createReadOnlyHttpService({
    store,
    databasePath: resolvedDatabasePath,
    eventStream,
    providerCapabilityOptions,
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolve);
    });
  } catch (error) {
    eventStream.close();
    store.close();
    throw error;
  }

  const address = server.address();
  const actualPort =
    address && typeof address === "object" ? address.port : port;
  let closed = false;

  return {
    url: `http://${host}:${actualPort}`,
    server,
    close: async () => {
      if (closed) return;
      closed = true;
      eventStream.close();
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
