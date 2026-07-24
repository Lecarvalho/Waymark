import { createHash } from "node:crypto";

import {
  DETERMINISTIC_METHODS,
  TOKEN_TARGETS,
} from "./rubric.mjs";
import { validateScoringObservations } from "./score-audit.mjs";

const SUPPORTED_METHODS = new Set([
  ...DETERMINISTIC_METHODS,
  "independent_model",
]);
const VERDICTS = new Set(["verified", "contradicted", "unverified"]);
const CRITICALITIES = new Set(["critical", "high", "medium", "low"]);
const TOKEN_SOURCES = new Set(["provider_reported", "estimated"]);

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertArray(value, path) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array`);
  }
}

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function compareRecords(left, right) {
  if (
    Number.isSafeInteger(left.sequence) &&
    Number.isSafeInteger(right.sequence)
  ) {
    return left.sequence - right.sequence;
  }
  return (
    String(left.createdAt).localeCompare(String(right.createdAt)) ||
    String(left.id).localeCompare(String(right.id))
  );
}

function selectVerification(verifications) {
  const ordered = [...verifications].sort(compareRecords);
  const deterministic = ordered.filter((record) =>
    DETERMINISTIC_METHODS.includes(record.method),
  );
  const supported = ordered.filter((record) =>
    SUPPORTED_METHODS.has(record.method),
  );
  return deterministic.at(-1) ?? supported.at(-1) ?? null;
}

function selectIndependentAssessment(verifications, selected) {
  const independent = [...verifications]
    .filter((record) => record.method === "independent_model")
    .sort(compareRecords)
    .at(-1);

  if (!independent || !selected) return "not_checked";
  return independent.verdict === selected.verdict ? "agree" : "disagree";
}

function citationStatus(claim, selected) {
  if (claim.citations.length === 0) return "missing";
  if (!selected || selected.verdict === "unverified") return "missing";
  return selected.verdict === "verified" ? "valid" : "invalid";
}

function normalizeVerification(record, path) {
  assertObject(record, path);
  requiredString(record.id, `${path}.id`);
  requiredString(record.claimId, `${path}.claimId`);
  requiredString(record.method, `${path}.method`);
  requiredString(record.createdAt, `${path}.createdAt`);
  if (!VERDICTS.has(record.verdict)) {
    throw new RangeError(`${path}.verdict is not supported`);
  }
  return record;
}

function mapClaims(report) {
  const byClaim = new Map();
  for (const [index, verification] of report.verifications.entries()) {
    const normalized = normalizeVerification(
      verification,
      `report.verifications[${index}]`,
    );
    const records = byClaim.get(normalized.claimId) ?? [];
    records.push(normalized);
    byClaim.set(normalized.claimId, records);
  }

  const annotations = [];
  const claims = report.claims.map((claim, index) => {
    const path = `report.claims[${index}]`;
    assertObject(claim, path);
    requiredString(claim.id, `${path}.id`);
    if (!CRITICALITIES.has(claim.criticality)) {
      throw new RangeError(`${path}.criticality is not supported`);
    }
    if (
      typeof claim.confidence !== "number" ||
      claim.confidence < 0 ||
      claim.confidence > 1
    ) {
      throw new RangeError(`${path}.confidence must be between 0 and 1`);
    }
    assertArray(claim.citations, `${path}.citations`);

    const verifications = byClaim.get(claim.id) ?? [];
    const selected = selectVerification(verifications);
    const normalizedMethod =
      selected && SUPPORTED_METHODS.has(selected.method)
        ? selected.method
        : "none";
    const verdict = selected?.verdict ?? "unverified";

    annotations.push({
      claimId: claim.id,
      selectedVerificationId: selected?.id ?? null,
      selection:
        selected && DETERMINISTIC_METHODS.includes(selected.method)
          ? "deterministic_precedence"
          : selected
            ? "latest_supported"
            : "no_verification",
      recordedVerificationCount: verifications.length,
    });

    return {
      id: claim.id,
      criticality: claim.criticality,
      candidateConfidence: claim.confidence,
      verdict,
      verificationMethod: normalizedMethod,
      citationStatus: citationStatus(claim, selected),
      independentAssessment: selectIndependentAssessment(
        verifications,
        selected,
      ),
    };
  });

  claims.sort((left, right) => left.id.localeCompare(right.id));
  annotations.sort((left, right) => left.claimId.localeCompare(right.claimId));
  return { claims, annotations };
}

function aggregateTokens(report, phases) {
  const measurements = report.tokens.filter((token) =>
    phases.includes(token.phase),
  );
  const count = measurements.reduce((total, token, index) => {
    if (!Number.isSafeInteger(token.totalTokens) || token.totalTokens < 0) {
      throw new TypeError(
        `report.tokens[${index}].totalTokens must be a non-negative integer`,
      );
    }
    if (!TOKEN_SOURCES.has(token.source)) {
      throw new RangeError(`report.tokens[${index}].source is not supported`);
    }
    return total + token.totalTokens;
  }, 0);
  return {
    count,
    source:
      measurements.length > 0 &&
      measurements.every(
        (measurement) => measurement.source === "provider_reported",
      )
        ? "provider_reported"
        : "estimated",
  };
}

function mapTokens(report) {
  const candidateNavigation = aggregateTokens(report, [
    "candidate_navigation",
  ]);
  const validation = aggregateTokens(report, [
    "independent_validation",
    "orchestration",
    "deterministic_verification",
  ]);
  const reportGeneration = aggregateTokens(report, ["report_generation"]);

  return {
    candidateNavigation: {
      ...candidateNavigation,
      target: TOKEN_TARGETS.defaultCandidateNavigationTokens,
    },
    validation,
    reportGeneration,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalScoreInputJson(input) {
  return JSON.stringify(canonicalize(input));
}

export function hashScoreInput(input) {
  return createHash("sha256")
    .update(canonicalScoreInputJson(input))
    .digest("hex");
}

/**
 * Converts one durable report into the sole canonical input accepted by the
 * scorer integration. Deterministic verification records take precedence over
 * model-only agreement, and no score-like values are copied from report data.
 */
export function buildScoreInput(report, observations) {
  assertObject(report, "report");
  assertObject(report.run, "report.run");
  requiredString(report.run.id, "report.run.id");
  assertArray(report.claims, "report.claims");
  assertArray(report.verifications, "report.verifications");
  assertArray(report.tokens, "report.tokens");

  const mapped = mapClaims(report);
  const input = {
    observations: validateScoringObservations(observations),
    claims: mapped.claims,
    tokens: mapTokens(report),
    annotations: {
      runId: report.run.id,
      rubricVersion: report.run.rubricVersion ?? null,
      claimMapping: mapped.annotations,
    },
  };

  return Object.freeze({
    ...input,
    canonicalHash: hashScoreInput(input),
  });
}
