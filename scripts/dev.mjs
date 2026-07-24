import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmExecPath = process.env.npm_execpath;

const service = spawn(process.execPath, ["server/waymark-server.mjs"], {
  stdio: "inherit",
});

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
  service.kill();
  web.kill();
  process.exitCode = exitCode;
}

service.on("exit", (code) => {
  if (!stopping && code !== 0) stop(code ?? 1);
});

web.on("exit", (code) => {
  if (!stopping) stop(code ?? 0);
});

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
