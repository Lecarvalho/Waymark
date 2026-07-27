import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_REPLAY_DELAY_MS,
  DEFAULT_REPLAY_SERVICE_URL,
  runGeneralLiveReplay,
} from "../src/replay/general-live-replay.mjs";

function usage() {
  return `Usage:
  npm run replay:general-live
  npm run replay:general-live -- --delay-ms 300
  npm run replay:general-live -- --service http://127.0.0.1:4318
  npm run replay:general-live -- --journal C:\\path\\to\\waymark.sqlite

Creates one clearly marked synthetic general run in the journal used by the
running Waymark service. It invokes no model and never reads a target repository.

Options:
  --service <url>     Waymark service URL (default: ${DEFAULT_REPLAY_SERVICE_URL})
  --journal <path>    Optional expected journal; must match /health
  --delay-ms <number> Delay between visible updates (default: ${DEFAULT_REPLAY_DELAY_MS})
  --run-id <id>       Optional deterministic run identifier
  --help              Show this help
`;
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    const [name, inlineValue] = argument.split("=", 2);
    if (!["--service", "--journal", "--delay-ms", "--run-id"].includes(name)) {
      throw new Error(`Unknown option: ${argument}`);
    }
    const value = inlineValue ?? arguments_[++index];
    if (value === undefined || value === "") {
      throw new Error(`${name} requires a value`);
    }
    if (name === "--service") options.serviceUrl = value;
    if (name === "--journal") options.databasePath = value;
    if (name === "--run-id") options.runId = value;
    if (name === "--delay-ms") {
      options.delayMs = Number(value);
      if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
        throw new Error("--delay-ms must be a finite non-negative number");
      }
    }
  }
  return options;
}

export async function main(arguments_ = process.argv.slice(2)) {
  const options = parseArguments(arguments_);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  const result = await runGeneralLiveReplay({
    ...options,
    onStep({ stepNumber, label }) {
      process.stdout.write(`[${stepNumber}] ${label}\n`);
    },
  });
  process.stdout.write(
    `Replay complete: ${result.runId}\nJournal: ${result.databasePath}\nService: ${result.serviceUrl}\n`,
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
