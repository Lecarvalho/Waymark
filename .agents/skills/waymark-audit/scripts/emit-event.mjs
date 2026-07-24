#!/usr/bin/env node

const RESERVED_TYPE = /^(score\.|run\.finished$)/;

function fail(message) {
  process.stderr.write(`emit-event: ${message}\n`);
  process.exit(2);
}

function parseOptions(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--") || index + 1 >= argv.length) {
      fail(`invalid argument: ${argument}`);
    }
    result[argument.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.trim() === "") {
    fail(`missing --${name}`);
  }
  return value.trim();
}

function json(value, name) {
  try {
    const parsed = JSON.parse(value ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`--${name} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    fail(`--${name} is invalid JSON: ${error.message}`);
  }
}

const options = parseOptions(process.argv.slice(2));
const actor = required(options, "actor");
const type = required(options, "type");
if (actor === "waymark" || actor.startsWith("waymark:")) {
  fail("Waymark actors are reserved");
}
if (RESERVED_TYPE.test(type)) {
  fail("authoritative event types are reserved");
}

const event = {
  runId: required(options, "run"),
  actor,
  type,
  payload: json(options["payload-json"], "payload-json"),
};

if (options["occurred-at"]) event.occurredAt = options["occurred-at"];
if (options["token-json"]) {
  event.tokenMeasurement = json(options["token-json"], "token-json");
}

process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
