import { resolveAuditTokenBudgets } from "./templates.mjs";

const AUDIT_MODES = new Set([
  "general",
  "task_specific",
  "system_explanation",
]);
const ROLES = ["candidate", "independent", "orchestrator"];

function requiredString(value, path) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} is required`);
  }
  return value.trim();
}

function validateParticipant(value, role) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`participants.${role} is required`);
  }
  return {
    provider: requiredString(
      value.provider,
      `participants.${role}.provider`,
    ),
    model: requiredString(value.model, `participants.${role}.model`),
    reasoningEffort: requiredString(
      value.reasoningEffort,
      `participants.${role}.reasoningEffort`,
    ),
  };
}

export function inferAuditName({ auditMode, task }) {
  if (auditMode === "general") {
    return "General repository navigation";
  }

  const normalized = requiredString(task, "task")
    .replace(/\s+/g, " ")
    .trim();
  const sentenceEnd = normalized.search(/[.!?](?:\s|$)/);
  const firstThought =
    sentenceEnd >= 0 ? normalized.slice(0, sentenceEnd) : normalized;
  const withoutTrailingPunctuation = firstThought.replace(/[.:;,\s]+$/, "");
  if (withoutTrailingPunctuation.length <= 72) {
    return withoutTrailingPunctuation;
  }

  const clipped = withoutTrailingPunctuation.slice(0, 71);
  const lastSpace = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, lastSpace > 40 ? lastSpace : 70).trimEnd()}…`;
}

export function validatePreparedAuditRequest(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Prepared audit request input must be an object");
  }
  if (!AUDIT_MODES.has(input.auditMode)) {
    throw new TypeError(
      "auditMode must be general, task_specific, or system_explanation",
    );
  }
  const task =
    input.auditMode !== "general"
      ? requiredString(input.task, "task")
      : typeof input.task === "string"
        ? input.task.trim()
        : "";
  const participants = Object.fromEntries(
    ROLES.map((role) => [
      role,
      validateParticipant(input.participants?.[role], role),
    ]),
  );

  return {
    targetRepositoryPath: requiredString(
      input.targetRepositoryPath,
      "targetRepositoryPath",
    ),
    journalPath: requiredString(input.journalPath, "journalPath"),
    serviceUrl: requiredString(input.serviceUrl, "serviceUrl"),
    auditMode: input.auditMode,
    name: inferAuditName({ auditMode: input.auditMode, task }),
    task,
    participants,
    tokenBudgets: resolveAuditTokenBudgets(input.tokenBudgets),
  };
}

export function buildPreparedAuditRequest(input) {
  const request = validatePreparedAuditRequest(input);
  let probeLine;
  if (request.auditMode === "general") {
    probeLine = null;
  } else if (request.auditMode === "system_explanation") {
    probeLine = `- Question: ${JSON.stringify(request.task)}`;
  } else {
    probeLine = `- Task: ${JSON.stringify(request.task)}`;
  }

  return [
    "Run $waymark-audit from the current Waymark checkout with these inputs:",
    "",
    `- Target: ${JSON.stringify(request.targetRepositoryPath)}`,
    `- Service: ${request.serviceUrl}`,
    `- Expected journal: ${JSON.stringify(request.journalPath)}`,
    `- Mode: ${request.auditMode}`,
    ...(probeLine === null ? [] : [probeLine]),
    "- Participants:",
    ...ROLES.map((role) => {
      const participant = request.participants[role];
      return `  - ${role}: provider=${participant.provider}; model=${participant.model}; reasoning=${participant.reasoningEffort}`;
    }),
    `- Token budgets (target/hard): ${Object.entries(request.tokenBudgets)
      .map(
        ([phase, budget]) =>
          `${phase}=${budget.targetTokens}/${budget.hardLimitTokens}`,
      )
      .join("; ")}`,
    "",
    "Create one new run. This request authorizes the audit; preparing it did not start a run.",
  ].join("\n");
}
