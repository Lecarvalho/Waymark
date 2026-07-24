#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { buildScoreInput } from "../../../../src/scoring/index.mjs";

function fail(message) {
  process.stderr.write(`build-score-input: ${message}\n`);
  process.exit(2);
}

function options(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith("--") || index + 1 >= argv.length) {
      fail(`invalid argument: ${name}`);
    }
    result[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function readJson(path, label) {
  if (!path) fail(`missing --${label}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${label}: ${error.message}`);
  }
}

const args = options(process.argv.slice(2));
const reportEnvelope = readJson(args.report, "report");
if (reportEnvelope.ok === false) fail("report command returned ok:false");
const report = reportEnvelope.data ?? reportEnvelope;

const observationsFile = readJson(args.observations, "observations");
let result;
try {
  result = buildScoreInput(
    report,
    observationsFile.observations ?? observationsFile,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
