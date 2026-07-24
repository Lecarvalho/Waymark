import { resolveAuditTokenBudgets } from "./templates.mjs";

const AUDIT_MODES = new Set([
  "general",
  "task_specific",
  "system_explanation",
]);
const ROLES = ["candidate", "independent", "orchestrator"];

export const GENERAL_AUDIT_TASK_SUITE = Object.freeze({
  id: "waymark-general-navigation",
  version: "1.0.0",
  tasks: Object.freeze([
    "Orientation: locate the repository map, scoped agent instructions, primary runtime entry points, and canonical setup workflow.",
    "Ownership and dependencies: trace the owning module and visible dependency direction for one representative runtime path without proposing a feature change.",
    "Verification discovery: locate the documented validation command and the nearest focused feedback loop for that representative path.",
  ]),
});

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
  let probeLines;
  if (request.auditMode === "general") {
    probeLines = [
      `- Probe suite: ${GENERAL_AUDIT_TASK_SUITE.id}@${GENERAL_AUDIT_TASK_SUITE.version}`,
      ...GENERAL_AUDIT_TASK_SUITE.tasks.map(
        (task, index) => `  ${index + 1}. ${task}`,
      ),
      "  Treat this only as a navigation probe; do not invent a feature request or assess general code quality.",
    ];
  } else if (request.auditMode === "system_explanation") {
    probeLines = [
      `- Probe question: ${JSON.stringify(request.task)}`,
      "  Find enough cited evidence for a concise answer. Measure navigation cost, not prose depth or hypothetical change-surface recall.",
    ];
  } else {
    probeLines = [`- Probe task: ${JSON.stringify(request.task)}`];
  }

  return [
    "Use $waymark-audit to run this evidence-backed audit from the current Waymark checkout.",
    "",
    `- Target repository: ${JSON.stringify(request.targetRepositoryPath)}`,
    `- Waymark service: ${request.serviceUrl}`,
    `- Journal: ${JSON.stringify(request.journalPath)}`,
    `- Mode: ${request.auditMode}`,
    `- Name: ${JSON.stringify(request.name)}`,
    ...probeLines,
    "- Participants:",
    ...ROLES.map((role) => {
      const participant = request.participants[role];
      return `  - ${role}: provider=${participant.provider}; model=${participant.model}; reasoning=${participant.reasoningEffort}`;
    }),
    "- Token budgets (target/hard limit; reserve the final 20% for reporting):",
    ...Object.entries(request.tokenBudgets).map(
      ([phase, budget]) =>
        `  - ${phase}: ${budget.targetTokens}/${budget.hardLimitTokens}`,
    ),
    "",
    "Required safeguards:",
    `- Reuse the existing service. Before creating a run, require ${request.serviceUrl}/health to report databasePath=${JSON.stringify(request.journalPath)}. Pass that path with --db to every CLI command. Do not start or restart services, switch ports, or create another database.`,
    `- Record runConditions.auditMode=${JSON.stringify(request.auditMode)} and verificationPolicy="repository_appropriate". Resolve the immutable repository identity and commit before paid work; keep the target read-only.`,
    "- Follow the skill's preflight, fresh-process launcher, parallel research, budget/rescue, telemetry, and scoring protocol exactly. Do not substitute inherited subagents or let the candidate score.",
    "- Discover verification from repository instructions and choose the safest deterministic method that proves each claim. Static inspection is sufficient for fully supported navigation-only claims.",
    "- Run an executable command only when it is material and safe. Isolate commands that may write outside the target. Do not automatically install dependencies, restore packages, start services, or enable network access. If one is required, request narrow authorization and keep setup separate from later sandboxed/offline execution; if unavailable or declined, record the probe limitation.",
    "- Finalize the evidence-linked report and call the deterministic scorer even when an adequacy check fails; preserve its caps and token-efficiency eligibility result. Mark the run failed only for a protocol/policy failure or missing required structured evidence.",
    "- This copied request authorizes the audit. Preparing or copying it did not create or start a run.",
  ].join("\n");
}
