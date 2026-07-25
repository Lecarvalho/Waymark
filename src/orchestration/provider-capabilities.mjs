import { resolveCodexLauncher } from "./codex-adapter.mjs";
import { DEFAULT_AUDIT_TOKEN_BUDGETS } from "./templates.mjs";

const REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);

const DEFAULT_CODEX_MODELS = Object.freeze([
  Object.freeze({
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]),
  }),
  Object.freeze({
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]),
  }),
  Object.freeze({
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]),
  }),
  Object.freeze({
    id: "gpt-5.5",
    label: "GPT-5.5",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  }),
  Object.freeze({
    id: "gpt-5.4",
    label: "GPT-5.4",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  }),
  Object.freeze({
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  }),
  Object.freeze({
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    reasoningEfforts: Object.freeze([
      "low",
      "medium",
      "high",
      "xhigh",
    ]),
  }),
]);

const TOKEN_PHASES = Object.freeze(Object.keys(DEFAULT_AUDIT_TOKEN_BUDGETS));
const MIN_HISTORICAL_SAMPLE_SIZE = 3;

function resolveTokenBudgets(historicalTokenAverages = {}) {
  const tokenBudgetDefaults = {};
  const tokenBudgetBasis = {};

  for (const phase of TOKEN_PHASES) {
    const fallback = DEFAULT_AUDIT_TOKEN_BUDGETS[phase];
    const history = historicalTokenAverages[phase];
    const hasHistory =
      Number.isSafeInteger(history?.averageTokens) &&
      history.averageTokens > 0 &&
      Number.isSafeInteger(history?.sampleSize) &&
      history.sampleSize > 0;
    const historyEligible =
      hasHistory && history.sampleSize >= MIN_HISTORICAL_SAMPLE_SIZE;
    const targetTokens = historyEligible
      ? Math.min(history.averageTokens, fallback.targetTokens)
      : fallback.targetTokens;
    const cappedToRubricDefault =
      hasHistory &&
      (!historyEligible || history.averageTokens > fallback.targetTokens);

    tokenBudgetDefaults[phase] = Object.freeze({
      targetTokens,
      hardLimitTokens: targetTokens * 2,
    });
    tokenBudgetBasis[phase] = Object.freeze({
      source: hasHistory ? "historical_average" : "rubric_default",
      sampleSize: hasHistory ? history.sampleSize : 0,
      historicalAverageTokens: hasHistory ? history.averageTokens : null,
      cappedToRubricDefault,
      usedForTarget: historyEligible,
      minimumSampleSize: MIN_HISTORICAL_SAMPLE_SIZE,
    });
  }

  return {
    tokenBudgetDefaults: Object.freeze(tokenBudgetDefaults),
    tokenBudgetBasis: Object.freeze(tokenBudgetBasis),
  };
}

function parseModelDeclarations(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_CODEX_MODELS;
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError("WAYMARK_CODEX_MODELS_JSON must contain valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new TypeError(
      "WAYMARK_CODEX_MODELS_JSON must contain a non-empty array",
    );
  }

  const modelIds = new Set();
  return Object.freeze(
    parsed.map((model, index) => {
      if (
        model === null ||
        typeof model !== "object" ||
        Array.isArray(model) ||
        typeof model.id !== "string" ||
        model.id.trim() === ""
      ) {
        throw new TypeError(`Codex model declaration ${index} requires an id`);
      }
      if (modelIds.has(model.id)) {
        throw new TypeError(`Duplicate Codex model declaration: ${model.id}`);
      }
      modelIds.add(model.id);
      if (
        !Array.isArray(model.reasoningEfforts) ||
        model.reasoningEfforts.length === 0 ||
        model.reasoningEfforts.some(
          (effort) => !REASONING_EFFORTS.has(effort),
        )
      ) {
        throw new TypeError(
          `Codex model ${model.id} requires supported reasoning efforts`,
        );
      }
      return Object.freeze({
        id: model.id,
        label:
          typeof model.label === "string" && model.label.trim() !== ""
            ? model.label
            : model.id,
        reasoningEfforts: Object.freeze([...new Set(model.reasoningEfforts)]),
      });
    }),
  );
}

function codexAvailability({ entryPath, environment }) {
  try {
    resolveCodexLauncher({ entryPath, environment });
    return { available: true, unavailableReason: null };
  } catch (error) {
    return {
      available: false,
      unavailableReason:
        error?.code === "CODEX_LAUNCHER_NOT_FOUND"
          ? "Codex is not available on this machine."
          : "Codex availability could not be confirmed.",
    };
  }
}

export function discoverProviderCapabilities({
  environment = process.env,
  codexEntryPath,
  historicalTokenAverages,
} = {}) {
  const availability = codexAvailability({
    entryPath: codexEntryPath,
    environment,
  });
  let models = [];
  let declarationError = null;
  try {
    models = parseModelDeclarations(environment.WAYMARK_CODEX_MODELS_JSON);
  } catch (error) {
    declarationError =
      error instanceof Error ? error.message : "Invalid model declaration.";
  }

  const available =
    availability.available && declarationError === null && models.length > 0;
  const { tokenBudgetDefaults, tokenBudgetBasis } = resolveTokenBudgets(
    historicalTokenAverages,
  );
  return Object.freeze({
    schemaVersion: "1.2.0",
    auditModes: Object.freeze([
      Object.freeze({
        id: "general",
        label: "General repository audit",
        taskRequired: false,
        description:
          "Measures broad repository navigation with a versioned standard task suite.",
        probeLabel: null,
        probePlaceholder: null,
      }),
      Object.freeze({
        id: "task_specific",
        label: "Task-specific audit",
        taskRequired: true,
        description:
          "Measures navigation for a realistic engineering change without implementing it.",
        probeLabel: "Engineering task used as the probe",
        probePlaceholder:
          "Add partial refunds with manager approval and idempotency.",
      }),
      Object.freeze({
        id: "system_explanation",
        label: "System explanation",
        taskRequired: true,
        description:
          "Measures the navigation cost of finding a supported answer about existing behavior.",
        probeLabel: "What should the agent find?",
        probePlaceholder: "How are refunds approved?",
      }),
    ]),
    providers: Object.freeze([
      Object.freeze({
        id: "openai",
        adapterId: "codex",
        label: "OpenAI Codex",
        available,
        unavailableReason: declarationError ?? availability.unavailableReason,
        roles: Object.freeze(["candidate", "independent", "orchestrator"]),
        models: available ? models : Object.freeze([]),
      }),
    ]),
    tokenBudgetDefaults,
    tokenBudgetBasis,
  });
}
