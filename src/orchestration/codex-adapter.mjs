import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_OUTPUT_SCHEMA = fileURLToPath(
  new URL("./investigation-output.schema.json", import.meta.url),
);
const SUPPORTED_PROVIDERS = new Set(["codex", "openai", "openai-codex"]);

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function firstInteger(object, ...names) {
  for (const name of names) {
    const value = nonNegativeInteger(object?.[name]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function conciseText(value, maximum = 4_000) {
  if (typeof value !== "string") return undefined;
  return value.length <= maximum
    ? value
    : `${value.slice(0, maximum)}\n[truncated]`;
}

function itemPayload(event) {
  const item = event?.item;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  return item;
}

export function resolveCodexLauncher({
  entryPath,
  platform = process.platform,
  environment = process.env,
} = {}) {
  if (entryPath !== undefined) {
    if (!existsSync(entryPath)) {
      const error = new Error(`Codex entry point not found: ${entryPath}`);
      error.code = "CODEX_LAUNCHER_NOT_FOUND";
      throw error;
    }
    return { command: process.execPath, prefixArguments: [entryPath] };
  }

  if (platform === "win32") {
    const candidates = [
      environment.WAYMARK_CODEX_ENTRY,
      environment.APPDATA
        ? join(
            environment.APPDATA,
            "npm",
            "node_modules",
            "@openai",
            "codex",
            "bin",
            "codex.js",
          )
        : undefined,
    ].filter(Boolean);
    const discovered = candidates.find((candidate) => existsSync(candidate));
    if (!discovered) {
      const error = new Error(
        "Could not find the Codex JavaScript entry point; set WAYMARK_CODEX_ENTRY",
      );
      error.code = "CODEX_LAUNCHER_NOT_FOUND";
      throw error;
    }
    return { command: process.execPath, prefixArguments: [discovered] };
  }

  return { command: environment.WAYMARK_CODEX_COMMAND ?? "codex", prefixArguments: [] };
}

export function extractCodexUsage(event) {
  if (event?.type !== "turn.completed") return null;
  const usage = event.usage ?? event.turn?.usage;
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return null;
  }

  const inputTokens = firstInteger(usage, "input_tokens", "inputTokens");
  const outputTokens = firstInteger(usage, "output_tokens", "outputTokens");
  const cachedInputTokens = firstInteger(
    usage,
    "cached_input_tokens",
    "cachedInputTokens",
  );
  const reportedTotal = firstInteger(usage, "total_tokens", "totalTokens");
  const totalTokens =
    inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : reportedTotal;
  if (totalTokens === undefined) return null;

  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    totalTokens,
  };
}

export function extractCodexFinalOutput(event) {
  if (event?.type !== "item.completed") return undefined;
  const item = itemPayload(event);
  if (item?.type !== "agent_message" || typeof item.text !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(item.text);
  } catch {
    return item.text;
  }
}

export function normalizeCodexEvent(event) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  if (event.type === "thread.started") {
    return {
      type: "provider.session.started",
      payload: {
        provider: "codex",
        ...(typeof event.thread_id === "string"
          ? { providerSessionId: event.thread_id }
          : {}),
      },
    };
  }
  if (event.type === "turn.started") {
    return { type: "provider.turn.started", payload: { provider: "codex" } };
  }
  if (event.type === "turn.completed") {
    return { type: "provider.turn.completed", payload: { provider: "codex" } };
  }
  if (event.type === "error") {
    return {
      type: "provider.error",
      payload: {
        provider: "codex",
        ...(conciseText(event.message) === undefined
          ? {}
          : { message: conciseText(event.message) }),
      },
    };
  }

  const item = itemPayload(event);
  if (
    !["item.started", "item.updated", "item.completed"].includes(event.type) ||
    item === null
  ) {
    return null;
  }
  if (item.type === "agent_message" || item.type === "reasoning") {
    return null;
  }

  const state = event.type.slice("item.".length);
  const payload = {
    provider: "codex",
    toolType: typeof item.type === "string" ? item.type : "unknown",
    state,
    ...(typeof item.id === "string" ? { providerEventId: item.id } : {}),
    ...(conciseText(item.command) === undefined
      ? {}
      : { command: conciseText(item.command) }),
    ...(typeof item.status === "string" ? { status: item.status } : {}),
    ...(Number.isSafeInteger(item.exit_code) ? { exitCode: item.exit_code } : {}),
    ...(typeof item.server === "string" ? { server: item.server } : {}),
    ...(typeof item.tool === "string" ? { tool: item.tool } : {}),
  };
  return { type: `provider.tool.${state}`, payload };
}

export function createCodexProcessAdapter({
  entryPath,
  outputSchemaPath = DEFAULT_OUTPUT_SCHEMA,
  environment,
} = {}) {
  return {
    id: "codex",
    requiresFinalOutput: true,
    usageEnforcement: "post_completion",
    supports(participant) {
      return SUPPORTED_PROVIDERS.has(participant.provider.toLowerCase());
    },
    createLaunchSpec(assignment, prompt) {
      const launcher = resolveCodexLauncher({ entryPath, environment });
      return {
        command: launcher.command,
        arguments: [
          ...launcher.prefixArguments,
          "exec",
          "--ephemeral",
          "--ignore-user-config",
          "--json",
          "--color",
          "never",
          "--sandbox",
          "read-only",
          "--cd",
          assignment.target.path,
          "--model",
          assignment.participant.model,
          "--output-schema",
          outputSchemaPath,
          "-",
        ],
        cwd: assignment.target.path,
        stdin: prompt,
        environment,
      };
    },
    extractUsage: extractCodexUsage,
    extractFinalOutput: extractCodexFinalOutput,
    normalizeEvent: normalizeCodexEvent,
  };
}
