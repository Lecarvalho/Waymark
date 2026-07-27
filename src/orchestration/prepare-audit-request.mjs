import { resolveAuditTokenBudgets } from "./templates.mjs";

const AUDIT_MODES = new Set([
  "general",
  "task_specific",
  "system_explanation",
]);
const BENCHMARK_ROLES = ["candidate", "independent", "orchestrator"];
const GENERAL_ROLE = "auditor";
export const GENERAL_SOFT_USAGE_NOTICE_POLICY = Object.freeze({
  id: "general-soft-notice/1.0.0",
  recommendedTokens: 500_000,
  basis:
    "early operational notice before the first measured live general-audit diagnostic exceeded five million processed tokens",
});
const GENERAL_AUDITOR_PERMISSION_MODES = new Set([
  "read_only",
  "unrestricted_no_approval",
]);

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
  const base = {
    targetRepositoryPath: requiredString(
      input.targetRepositoryPath,
      "targetRepositoryPath",
    ),
    journalPath: requiredString(input.journalPath, "journalPath"),
    observerUrl: requiredString(input.observerUrl, "observerUrl"),
    serviceUrl: requiredString(input.serviceUrl, "serviceUrl"),
    auditMode: input.auditMode,
    name: inferAuditName({ auditMode: input.auditMode, task }),
    task,
  };

  if (input.auditMode === "general") {
    if (input.tokenPolicy !== "unbounded_by_waymark") {
      throw new TypeError(
        "tokenPolicy must be unbounded_by_waymark for a general audit",
      );
    }
    const softUsageNoticeTokens =
      input.softUsageNoticeTokens === undefined ||
      input.softUsageNoticeTokens === null
        ? null
        : input.softUsageNoticeTokens;
    if (
      softUsageNoticeTokens !== null &&
      (!Number.isSafeInteger(softUsageNoticeTokens) ||
        softUsageNoticeTokens < 1)
    ) {
      throw new TypeError(
        "softUsageNoticeTokens must be a positive integer or null",
      );
    }
    const auditorPermissionMode =
      input.auditorPermissionMode ?? "read_only";
    if (!GENERAL_AUDITOR_PERMISSION_MODES.has(auditorPermissionMode)) {
      throw new TypeError(
        "auditorPermissionMode must be read_only or unrestricted_no_approval",
      );
    }
    return {
      ...base,
      participants: {
        auditor: validateParticipant(
          input.participants?.auditor,
          GENERAL_ROLE,
        ),
      },
      tokenPolicy: "unbounded_by_waymark",
      softUsageNoticeTokens,
      auditorPermissionMode,
    };
  }

  return {
    ...base,
    participants: Object.fromEntries(
      BENCHMARK_ROLES.map((role) => [
        role,
        validateParticipant(input.participants?.[role], role),
      ]),
    ),
    tokenPolicy: "hard_phase_budgets",
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

  const participantRoles =
    request.auditMode === "general" ? [GENERAL_ROLE] : BENCHMARK_ROLES;
  const tokenLines =
    request.auditMode === "general"
      ? [
          `- Auditor permissions: ${request.auditorPermissionMode}`,
          "- Token policy: unbounded_by_waymark",
          "- Token usage: measured",
          `- Soft usage notice: ${
            request.softUsageNoticeTokens === null
              ? "none"
              : `${request.softUsageNoticeTokens} tokens (${GENERAL_SOFT_USAGE_NOTICE_POLICY.id})`
          }`,
        ]
      : [
          `- Token budgets (target/hard): ${Object.entries(
            request.tokenBudgets,
          )
            .map(
              ([phase, budget]) =>
                `${phase}=${budget.targetTokens}/${budget.hardLimitTokens}`,
            )
            .join("; ")}`,
        ];

  return [
    "Run $waymark-audit from the current Waymark checkout with these inputs:",
    "",
    `- Target: ${JSON.stringify(request.targetRepositoryPath)}`,
    `- Observer: ${request.observerUrl}`,
    `- Service: ${request.serviceUrl}`,
    `- Expected journal: ${JSON.stringify(request.journalPath)}`,
    `- Mode: ${request.auditMode}`,
    ...(probeLine === null ? [] : [probeLine]),
    "- Participants:",
    ...participantRoles.map((role) => {
      const participant = request.participants[role];
      return `  - ${role}: provider=${participant.provider}; model=${participant.model}; reasoning=${participant.reasoningEffort}`;
    }),
    ...tokenLines,
    "",
    request.auditMode === "general"
      ? "Create one new general run with this auditor. This request authorizes the audit; preparing it did not start a run."
      : "Create one new run. This request authorizes the audit; preparing it did not start a run.",
  ].join("\n");
}
