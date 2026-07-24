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
    auditMode: input.auditMode,
    name: inferAuditName({ auditMode: input.auditMode, task }),
    task,
    participants,
    tokenBudgets: resolveAuditTokenBudgets(input.tokenBudgets),
  };
}

export function buildPreparedAuditRequest(input) {
  const request = validatePreparedAuditRequest(input);
  let taskLine;
  if (request.auditMode === "general") {
    taskLine = [
          `Use this versioned standardized task suite: ${GENERAL_AUDIT_TASK_SUITE.id}@${GENERAL_AUDIT_TASK_SUITE.version}.`,
          ...GENERAL_AUDIT_TASK_SUITE.tasks.map(
            (task, index) => `  ${index + 1}. ${task}`,
          ),
          "Treat the suite only as a repository-navigation probe. Do not invent a feature request or broaden the report into general code quality.",
        ].join("\n");
  } else if (request.auditMode === "system_explanation") {
    taskLine = [
      `Use this short system question verbatim as the navigation probe: ${JSON.stringify(
        request.task,
      )}`,
      "Find enough cited repository evidence to answer correctly, then give a concise answer. Explanatory depth or prose length is not the objective.",
      "Treat candidate navigation tokens, searches, file hops, dead ends, and the effort required to reach the supported answer as the primary measurement.",
      "Do not propose or implement a feature change. Do not treat missing hypothetical change-surface recall as a failure in this mode.",
    ].join("\n");
  } else {
    taskLine = `Use this engineering task verbatim as a navigation probe: ${JSON.stringify(
      request.task,
    )}`;
  }

  return [
    "Use $waymark-audit to run an evidence-backed Waymark audit.",
    "",
    "Authoritative workflow:",
    "- Run the Waymark CLI and repository-local audit skill from the current Waymark checkout.",
    "- Use the skill's single authoritative launcher and protocol. Do not replace it with ad hoc subagents or inherited conversation context.",
    "- Keep the target repository read-only during discovery. Use an explicitly disposable worktree outside the target only if a future implementation probe is authorized.",
    "- Run candidate and independent research in parallel in fresh assignment-only role processes, then cross-examine claims and perform safe deterministic verification.",
    "- Reserve the final 20% of every hard token limit for a structured partial report. When live usage reaches the wrap-up threshold, stop exploration and resume the same provider session with a no-tools reporting directive; preserve partial findings and traceability barriers instead of discarding the work.",
    "- Persist interruptions, failures, unverifiable claims, tool traces, token measurements, and budget overruns. Never let a candidate assign an authoritative score.",
    "- This copied request authorizes the paired agent to run the audit; preparing or copying it in Waymark did not create or start a run.",
    "",
    "Audit request:",
    `- Target repository: ${JSON.stringify(request.targetRepositoryPath)}`,
    `- Audit mode: ${request.auditMode}`,
    `- Record runConditions.auditMode as ${JSON.stringify(request.auditMode)} so budgets and comparisons stay within this probe type.`,
    `- Concise name: ${JSON.stringify(request.name)}`,
    `- ${taskLine}`,
    "- Participants:",
    ...ROLES.map((role) => {
      const participant = request.participants[role];
      return `  - ${role}: provider=${participant.provider}; model=${participant.model}; reasoning=${participant.reasoningEffort}`;
    }),
    "- Phase token targets and hard limits (the final 20% is reserved for reporting):",
    ...Object.entries(request.tokenBudgets).map(
      ([phase, budget]) =>
        `  - ${phase}: target=${budget.targetTokens}; hard_limit=${budget.hardLimitTokens}`,
    ),
    "",
    "Before launching paid role work, resolve and record the target's immutable repository identity and commit, confirm the exact local journal observed by the UI, and perform the skill's no-model provider preflight. Finish through deterministic scoring and the stored report only if the evidence and calibration gates pass.",
  ].join("\n");
}
