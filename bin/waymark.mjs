#!/usr/bin/env node

import { readFileSync } from "node:fs";
import process from "node:process";

import { createCodexProcessAdapter } from "../src/orchestration/codex-adapter.mjs";
import { runInvestigationPhase } from "../src/orchestration/process-runner.mjs";
import { AuditStore } from "../src/persistence/index.mjs";
import {
  buildScoreInput,
  RUBRIC_VERSION,
  scoreAudit,
} from "../src/scoring/index.mjs";

const COMMANDS = {
  "run create": "Create an active audit run",
  "run list": "List recent audit runs",
  "run read": "Read run metadata",
  "run finish": "Append a terminal event and finish a run",
  "investigation run":
    "Run fresh candidate and independent provider processes",
  "event append": "Append an ordered audit event",
  "event read": "Read ordered events",
  "claim submit": "Submit an evidence claim",
  "verification record": "Append a verification verdict",
  "token record": "Append a token measurement",
  "score calculate": "Calculate and persist an authoritative score",
  "report recommend":
    "Append evidence-linked recommendations to a completed report",
  "report read": "Read a complete stored report",
};

function parseArguments(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equalsIndex = argument.indexOf("=");
    if (equalsIndex !== -1) {
      options[argument.slice(2, equalsIndex)] = argument.slice(equalsIndex + 1);
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[name] = true;
      continue;
    }
    options[name] = next;
    index += 1;
  }
  return { positionals, options };
}

function parseJson(value, optionName) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch (error) {
    const protocolError = new Error(`--${optionName} must contain valid JSON`);
    protocolError.code = "INVALID_JSON";
    protocolError.details = { option: optionName, cause: error.message };
    throw protocolError;
  }
}

function readInput(options) {
  if (options["input-json"] !== undefined && options["input-file"] !== undefined) {
    const error = new Error("Use only one of --input-json or --input-file");
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  if (options["input-file"] !== undefined) {
    return parseJson(
      readFileSync(String(options["input-file"]), "utf8"),
      "input-file",
    );
  }
  if (options["input-json"] === "-") {
    return parseJson(readFileSync(0, "utf8"), "input-json");
  }
  return parseJson(options["input-json"], "input-json");
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.trim() === "") {
    const error = new Error(`Missing required option --${name}`);
    error.code = "INVALID_ARGUMENTS";
    error.details = { option: name };
    throw error;
  }
  return value;
}

function optionalNumber(options, name) {
  if (options[name] === undefined) return undefined;
  const value = Number(options[name]);
  if (!Number.isFinite(value)) {
    const error = new Error(`--${name} must be a number`);
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  return value;
}

function createRunInput(options) {
  return (
    readInput(options) ?? {
      targetRepositoryPath: required(options, "target-repository-path"),
      repositoryIdentity: required(options, "repository-identity"),
      commitSha: required(options, "commit-sha"),
      task: required(options, "task"),
      participants: parseJson(
        required(options, "participants-json"),
        "participants-json",
      ),
      toolPolicy:
        parseJson(options["tool-policy-json"] ?? "{}", "tool-policy-json"),
      runConditions:
        parseJson(
          options["run-conditions-json"] ?? "{}",
          "run-conditions-json",
        ),
      protocolVersion: options["protocol-version"] ?? "1.0.0",
      rubricVersion: options["rubric-version"] ?? RUBRIC_VERSION,
    }
  );
}

function appendEventInput(options) {
  const input =
    readInput(options) ?? {
      runId: required(options, "run"),
      actor: required(options, "actor"),
      type: required(options, "type"),
      payload: parseJson(options["payload-json"] ?? "{}", "payload-json"),
      ...(options["occurred-at"]
        ? { occurredAt: options["occurred-at"] }
        : {}),
      ...(options["token-json"]
        ? {
            tokenMeasurement: parseJson(
              options["token-json"],
              "token-json",
            ),
          }
        : {}),
    };

  if (
    input.actor === "waymark" ||
    String(input.actor).startsWith("waymark:") ||
    String(input.type).startsWith("score.") ||
    input.type === "run.finished"
  ) {
    const error = new Error(
      "Waymark actors and authoritative event types are reserved",
    );
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }

  return input;
}

function claimInput(options) {
  return (
    readInput(options) ?? {
      runId: required(options, "run"),
      subject: required(options, "subject"),
      assertion: required(options, "assertion"),
      claimant: required(options, "claimant"),
      citations: parseJson(
        options["citations-json"] ?? "[]",
        "citations-json",
      ),
      confidence: optionalNumber(options, "confidence"),
      criticality: required(options, "criticality"),
    }
  );
}

function verificationInput(options) {
  return (
    readInput(options) ?? {
      runId: required(options, "run"),
      claimId: required(options, "claim"),
      verifier: required(options, "verifier"),
      method: required(options, "method"),
      verdict: required(options, "verdict"),
      evidence: parseJson(
        options["evidence-json"] ?? "{}",
        "evidence-json",
      ),
    }
  );
}

function tokenInput(options) {
  return (
    readInput(options) ?? {
      runId: required(options, "run"),
      ...(options.event ? { eventId: options.event } : {}),
      actor: required(options, "actor"),
      phase: required(options, "phase"),
      source: required(options, "source"),
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      inputTokens: optionalNumber(options, "input-tokens"),
      outputTokens: optionalNumber(options, "output-tokens"),
      cachedInputTokens: optionalNumber(options, "cached-input-tokens"),
      cacheCreationTokens: optionalNumber(options, "cache-creation-tokens"),
      totalTokens: optionalNumber(options, "total-tokens"),
    }
  );
}

function finishInput(options) {
  return (
    readInput(options) ?? {
      status: options.status ?? "completed",
      summary: parseJson(options["summary-json"] ?? "{}", "summary-json"),
    }
  );
}

function reportRecommendationInput(options) {
  const input = readInput(options);
  if (input === undefined) {
    const error = new Error(
      "report recommend requires --input-json or --input-file",
    );
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  return input;
}

function calculateScore(store, options) {
  const runId = required(options, "run");
  const observationsFile = readInput(options);
  if (observationsFile === undefined) {
    const error = new Error(
      "score calculate requires persisted observation counts via --input-json or --input-file",
    );
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }
  if (options.finish !== true) {
    const error = new Error(
      "score calculate requires --finish so scoring and completion remain atomic",
    );
    error.code = "INVALID_ARGUMENTS";
    throw error;
  }

  const run = store.readRun(runId);
  if (run.rubricVersion !== RUBRIC_VERSION) {
    const error = new Error(
      `Run rubric ${run.rubricVersion} does not match scorer ${RUBRIC_VERSION}`,
    );
    error.code = "RUBRIC_MISMATCH";
    throw error;
  }
  const report = store.readReport(runId);
  const builtInput = buildScoreInput(
    report,
    observationsFile.observations ?? observationsFile,
  );
  const { canonicalHash: inputHash, ...input } = builtInput;
  const result = scoreAudit(input);
  const completion = store.completeRunWithAuthoritativeScore(runId, {
    score: {
      message: "Deterministic scoring complete",
      rubricVersion: RUBRIC_VERSION,
      inputHash,
      input,
      result,
    },
    summary: {
      rubricVersion: RUBRIC_VERSION,
      scoringInputHash: inputHash,
    },
  });

  return { result, inputHash, completion };
}

async function execute(store, positionals, options) {
  const command = positionals.slice(0, 2).join(" ");
  switch (command) {
    case "run create":
      return { command, data: store.createRun(createRunInput(options)) };
    case "run list":
      return {
        command,
        data: store.listRuns({
          ...(options.status ? { status: options.status } : {}),
          ...(options.limit
            ? { limit: optionalNumber(options, "limit") }
            : {}),
        }),
      };
    case "run read":
      return { command, data: store.readRun(required(options, "run")) };
    case "run finish":
      return {
        command,
        data: store.finishRun(required(options, "run"), finishInput(options)),
      };
    case "investigation run":
      return {
        command,
        data: await runInvestigationPhase({
          store,
          runId: required(options, "run"),
          adapters: [
            createCodexProcessAdapter({
              ...(options["codex-entry"]
                ? { entryPath: String(options["codex-entry"]) }
                : {}),
              ...(options["output-schema"]
                ? { outputSchemaPath: String(options["output-schema"]) }
                : {}),
            }),
          ],
        }),
      };
    case "event append":
      return { command, data: store.appendEvent(appendEventInput(options)) };
    case "event read":
      return {
        command,
        data: store.readEvents(required(options, "run"), {
          ...(options["after-sequence"]
            ? {
                afterSequence: optionalNumber(options, "after-sequence"),
              }
            : {}),
          ...(options.limit
            ? { limit: optionalNumber(options, "limit") }
            : {}),
        }),
      };
    case "claim submit":
      return { command, data: store.submitClaim(claimInput(options)) };
    case "verification record":
      return {
        command,
        data: store.recordVerification(verificationInput(options)),
      };
    case "token record":
      return {
        command,
        data: store.recordTokenMeasurement(tokenInput(options)),
      };
    case "score calculate":
      return { command, data: calculateScore(store, options) };
    case "report recommend":
      return {
        command,
        data: store.appendReportRecommendations(
          required(options, "run"),
          reportRecommendationInput(options),
        ),
      };
    case "report read":
      return { command, data: store.readReport(required(options, "run")) };
    default: {
      const error = new Error(
        command
          ? `Unknown command: ${command}`
          : "A two-part command is required",
      );
      error.code = "UNKNOWN_COMMAND";
      error.details = { commands: COMMANDS };
      throw error;
    }
  }
}

function serializableError(error) {
  return {
    code: error?.code ?? "WAYMARK_ERROR",
    message: error instanceof Error ? error.message : String(error),
    ...(error?.details === undefined ? {} : { details: error.details }),
  };
}

const parsed = parseArguments(process.argv.slice(2));
if (
  parsed.options.help === true ||
  parsed.positionals[0] === "help" ||
  parsed.positionals.length === 0
) {
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      command: "help",
      data: {
        usage: "waymark [--db <path>] <resource> <action> [options]",
        input:
          "Mutation commands accept --input-json '<object>', --input-json - for stdin, or --input-file <path>.",
        commands: COMMANDS,
      },
    })}\n`,
  );
} else {
  let store;
  try {
    store = new AuditStore({
      databasePath: parsed.options.db ?? undefined,
    });
    const result = await execute(store, parsed.positionals, parsed.options);
    process.stdout.write(
      `${JSON.stringify({ ok: true, command: result.command, data: result.data })}\n`,
    );
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: serializableError(error) })}\n`,
    );
    process.exitCode =
      error?.code === "INVALID_INPUT" ||
      error?.code === "INVALID_JSON" ||
      error?.code === "INVALID_ARGUMENTS" ||
      error?.code === "UNKNOWN_COMMAND"
        ? 2
        : 1;
  } finally {
    store?.close();
  }
}
