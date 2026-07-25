import { spawn } from "node:child_process";

import {
  inspectExistingWaymarkService,
  resolveRequestedService,
} from "./service-preflight.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath;
const requestedService = resolveRequestedService();
const existingService = await inspectExistingWaymarkService({
  serviceUrl: requestedService.serviceUrl,
  expectedDatabasePath: requestedService.databasePathExplicit
    ? requestedService.databasePath
    : undefined,
});

if (existingService.status === "occupied") {
  throw new Error(
    `${requestedService.serviceUrl} is already occupied by a service that is not Waymark.`,
  );
}
if (existingService.status === "database_mismatch") {
  throw new Error(
    `The existing Waymark service at ${requestedService.serviceUrl} uses ${existingService.databasePath}, but this launch requested ${requestedService.databasePath}. Reuse the existing journal or stop and restart that service explicitly; Waymark will not create a second database.`,
  );
}

const service =
  existingService.status === "reusable"
    ? null
    : spawn(process.execPath, ["server/waymark-server.mjs"], {
        stdio: "inherit",
      });
if (existingService.status === "reusable") {
  process.stdout.write(
    `Reusing Waymark service at ${requestedService.serviceUrl} with journal ${existingService.databasePath}\n`,
  );
}

const web = npmExecPath
  ? spawn(process.execPath, [npmExecPath, "run", "dev:web"], {
      stdio: "inherit",
    })
  : spawn(npmCommand, ["run", "dev:web"], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  service?.kill();
  web.kill();
  process.exitCode = exitCode;
}

service?.on("exit", (code) => {
  if (!stopping && code !== 0) stop(code ?? 1);
});

web.on("exit", (code) => {
  if (!stopping) stop(code ?? 0);
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
