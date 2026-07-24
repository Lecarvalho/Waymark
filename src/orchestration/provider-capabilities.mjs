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
]);

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
  return Object.freeze({
    schemaVersion: "1.0.0",
    auditModes: Object.freeze([
      Object.freeze({
        id: "general",
        label: "General repository audit",
        taskRequired: false,
      }),
      Object.freeze({
        id: "task_specific",
        label: "Task-specific audit",
        taskRequired: true,
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
    tokenBudgetDefaults: DEFAULT_AUDIT_TOKEN_BUDGETS,
  });
}
