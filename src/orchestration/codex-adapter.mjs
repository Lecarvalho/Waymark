import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { homedir } from "node:os";
import process from "node:process";

const DEFAULT_OUTPUT_SCHEMA = fileURLToPath(
  new URL("./investigation-output.schema.json", import.meta.url),
);
const DEFAULT_ORCHESTRATION_OUTPUT_SCHEMA = fileURLToPath(
  new URL("./orchestration-output.schema.json", import.meta.url),
);
const DEFAULT_GENERAL_AUDIT_OUTPUT_SCHEMA = fileURLToPath(
  new URL("./general-audit-output.schema.json", import.meta.url),
);
const DEFAULT_CHECKPOINT_MCP_SERVER = fileURLToPath(
  new URL("./waymark-checkpoint-mcp.mjs", import.meta.url),
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

function tomlString(value) {
  return JSON.stringify(String(value).replaceAll("\\", "/"));
}

function checkpointMcpArguments(assignment) {
  if (assignment.role !== "auditor") return [];
  return [
    "-c",
    `mcp_servers.waymark_checkpoint.command=${tomlString(process.execPath)}`,
    "-c",
    `mcp_servers.waymark_checkpoint.args=[${tomlString(DEFAULT_CHECKPOINT_MCP_SERVER)}]`,
    "-c",
    'mcp_servers.waymark_checkpoint.env_vars=["WAYMARK_CHECKPOINT_RUN_ID","WAYMARK_CHECKPOINT_ACTOR","WAYMARK_CHECKPOINT_ENDPOINT","WAYMARK_CHECKPOINT_AUTHORIZATION"]',
    "-c",
    'mcp_servers.waymark_checkpoint.enabled_tools=["record_surface","record_behavior_path","record_finding","revise_finding","record_dimension_progress","assess_dimension","assess_practice","record_recommendation","record_friction_disposition","complete_synthesis"]',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.record_surface.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.record_behavior_path.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.record_finding.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.revise_finding.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.record_dimension_progress.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.assess_dimension.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.assess_practice.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.record_recommendation.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.record_friction_disposition.approval_mode="approve"',
    "-c",
    'mcp_servers.waymark_checkpoint.tools.complete_synthesis.approval_mode="approve"',
    "-c",
    "mcp_servers.waymark_checkpoint.required=true",
    "-c",
    "mcp_servers.waymark_checkpoint.startup_timeout_sec=10",
    "-c",
    "mcp_servers.waymark_checkpoint.tool_timeout_sec=15",
  ];
}

function providerFailureReason(eventType, item) {
  if (
    eventType !== "item.completed" ||
    !["declined", "failed"].includes(item.status)
  ) {
    return undefined;
  }
  const candidates = [
    item.failure_reason,
    item.failureReason,
    item.message,
    item.aggregated_output,
    typeof item.error === "string" ? item.error : item.error?.message,
  ];
  return candidates.some(
    (value) =>
      typeof value === "string" &&
      /(?:rejected:\s*)?blocked by policy\s*$/i.test(value.trim()),
  )
    ? "blocked by policy"
    : undefined;
}

function tokenUsage(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const inputTokens = firstInteger(value, "input_tokens", "inputTokens");
  const outputTokens = firstInteger(value, "output_tokens", "outputTokens");
  const cachedInputTokens = firstInteger(
    value,
    "cached_input_tokens",
    "cachedInputTokens",
  );
  const reasoningOutputTokens = firstInteger(
    value,
    "reasoning_output_tokens",
    "reasoningOutputTokens",
  );
  const reportedTotal = firstInteger(value, "total_tokens", "totalTokens");
  const totalTokens =
    reportedTotal ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);
  if (totalTokens === undefined) return null;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(reasoningOutputTokens === undefined
      ? {}
      : { reasoningOutputTokens }),
    totalTokens,
  };
}

export function extractCodexRolloutUsage(record) {
  if (
    record?.type !== "event_msg" ||
    record.payload?.type !== "token_count"
  ) {
    return null;
  }
  const info = record.payload.info;
  const cumulative = tokenUsage(info?.total_token_usage);
  const context = tokenUsage(info?.last_token_usage);
  const contextWindowTokens = firstInteger(info, "model_context_window");
  if (cumulative === null || context === null) return null;
  return {
    cumulative,
    context,
    ...(contextWindowTokens === undefined
      ? {}
      : {
          contextWindowTokens,
          contextPercent:
            contextWindowTokens === 0
              ? null
              : Math.round(
                  (context.totalTokens / contextWindowTokens) * 10_000,
                ) / 100,
        }),
  };
}

function candidateSessionDirectories(sessionRoot, now = new Date()) {
  const dates = [now, new Date(now.getTime() - 86_400_000)];
  return dates.flatMap((date) => {
    const local = [
      String(date.getFullYear()),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ];
    const utc = [
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, "0"),
      String(date.getUTCDate()).padStart(2, "0"),
    ];
    return [join(sessionRoot, ...local), join(sessionRoot, ...utc)];
  });
}

function findRolloutFile(sessionRoot, providerSessionId) {
  for (const directory of new Set(candidateSessionDirectories(sessionRoot))) {
    if (!existsSync(directory)) continue;
    let match;
    try {
      match = readdirSync(directory).find(
        (name) =>
          name.endsWith(".jsonl") && name.includes(providerSessionId),
      );
    } catch {
      continue;
    }
    if (match) return join(directory, match);
  }
  return null;
}

export function createCodexRolloutUsageMonitor({
  providerSessionId,
  onUsage,
  codexHome = join(homedir(), ".codex"),
  intervalMs = 250,
}) {
  const sessionRoot = join(codexHome, "sessions");
  let rolloutPath = null;
  let processedLineCount = 0;
  let stopped = false;

  const poll = ({ includeTrailingLine = false } = {}) => {
    if (stopped) return;
    try {
      rolloutPath ??= findRolloutFile(sessionRoot, providerSessionId);
    } catch {
      return;
    }
    if (rolloutPath === null || !existsSync(rolloutPath)) return;
    let text;
    try {
      text = readFileSync(rolloutPath, "utf8");
    } catch {
      return;
    }
    const lines = text.split(/\r?\n/);
    const completeLineCount = text.endsWith("\n")
      ? lines.length - 1
      : includeTrailingLine
        ? lines.length
        : lines.length - 1;
    if (completeLineCount < processedLineCount) processedLineCount = 0;
    for (
      let index = processedLineCount;
      index < completeLineCount;
      index += 1
    ) {
      try {
        const usage = extractCodexRolloutUsage(JSON.parse(lines[index]));
        if (usage !== null) onUsage(usage);
      } catch {
        // Ignore unrelated or partially written provider log records.
      }
    }
    processedLineCount = completeLineCount;
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  timer.unref?.();
  return () => {
    poll({ includeTrailingLine: true });
    stopped = true;
    clearInterval(timer);
  };
}

function itemPayload(event) {
  const item = event?.item;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return null;
  }
  return item;
}

function gitSafeDirectoryEnvironment(targetPath, environment) {
  const inherited = { ...process.env, ...environment };
  const parsedCount = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? "0", 10);
  const count = Number.isSafeInteger(parsedCount) && parsedCount >= 0
    ? parsedCount
    : 0;
  return {
    ...environment,
    GIT_CONFIG_COUNT: String(count + 1),
    [`GIT_CONFIG_KEY_${count}`]: "safe.directory",
    [`GIT_CONFIG_VALUE_${count}`]: targetPath.replaceAll("\\", "/"),
  };
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

  return tokenUsage(usage);
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
  const failureReason = providerFailureReason(event.type, item);
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
    ...(failureReason === undefined ? {} : { failureReason }),
  };
  return { type: `provider.tool.${state}`, payload };
}

export function createCodexProcessAdapter({
  entryPath,
  outputSchemaPath = DEFAULT_OUTPUT_SCHEMA,
  orchestrationOutputSchemaPath = DEFAULT_ORCHESTRATION_OUTPUT_SCHEMA,
  environment,
  usagePollIntervalMs,
} = {}) {
  const codexHome =
    environment?.CODEX_HOME ??
    process.env.CODEX_HOME ??
    join(homedir(), ".codex");
  const sandboxMode = (assignment) =>
    assignment.role === "auditor" &&
    assignment.permissionMode === "unrestricted_no_approval"
      ? "danger-full-access"
      : "read-only";
  return {
    id: "codex",
    requiresFinalOutput: true,
    usageEnforcement: "post_completion",
    supports(participant) {
      return SUPPORTED_PROVIDERS.has(participant.provider.toLowerCase());
    },
    describeGeneralPreflight(assignment, transport) {
      const launcher = resolveCodexLauncher({ entryPath, environment });
      return {
        provider: "codex",
        command: launcher.command,
        entryPoint: launcher.prefixArguments[0] ?? launcher.command,
        sandboxMode: sandboxMode(assignment),
        approvalPolicy: "never",
        outputSchema: DEFAULT_GENERAL_AUDIT_OUTPUT_SCHEMA,
        checkpointServer: transport.endpoint,
        checkpointTools: Object.keys({
          record_surface: true,
          record_behavior_path: true,
          record_finding: true,
          revise_finding: true,
          record_dimension_progress: true,
          assess_dimension: true,
          assess_practice: true,
          record_recommendation: true,
          record_friction_disposition: true,
          complete_synthesis: true,
        }),
        injectedGitSafeDirectory: assignment.target.path.replaceAll("\\", "/"),
      };
    },
    createLaunchSpec(assignment, prompt) {
      const launcher = resolveCodexLauncher({ entryPath, environment });
      const outputSchema =
        assignment.role === "orchestrator"
          ? orchestrationOutputSchemaPath
          : assignment.role === "auditor"
            ? DEFAULT_GENERAL_AUDIT_OUTPUT_SCHEMA
            : outputSchemaPath;
      return {
        command: launcher.command,
        arguments: [
          ...launcher.prefixArguments,
          "exec",
          ...(assignment.reasoningEffort
            ? [
                "-c",
                `model_reasoning_effort="${assignment.reasoningEffort}"`,
              ]
            : []),
          "-c",
          'approval_policy="never"',
          ...checkpointMcpArguments(assignment),
          "--ignore-user-config",
          "--ignore-rules",
          "--json",
          "--color",
          "never",
          "--sandbox",
          sandboxMode(assignment),
          "--cd",
          assignment.target.path,
          "--model",
          assignment.participant.model,
          ...(outputSchema === null
            ? []
            : ["--output-schema", outputSchema]),
          "-",
        ],
        cwd: assignment.target.path,
        stdin: prompt,
        environment: gitSafeDirectoryEnvironment(
          assignment.target.path,
          environment,
        ),
      };
    },
    createResumeLaunchSpec(assignment, prompt, providerSessionId) {
      const launcher = resolveCodexLauncher({ entryPath, environment });
      const outputSchema =
        assignment.role === "orchestrator"
          ? orchestrationOutputSchemaPath
          : assignment.role === "auditor"
            ? DEFAULT_GENERAL_AUDIT_OUTPUT_SCHEMA
            : outputSchemaPath;
      return {
        command: launcher.command,
        arguments: [
          ...launcher.prefixArguments,
          "exec",
          "resume",
          ...(assignment.reasoningEffort
            ? [
                "-c",
                `model_reasoning_effort="${assignment.reasoningEffort}"`,
              ]
            : []),
          "-c",
          'approval_policy="never"',
          "-c",
          `sandbox_mode="${sandboxMode(assignment)}"`,
          ...checkpointMcpArguments(assignment),
          "--ignore-user-config",
          "--ignore-rules",
          "--json",
          "--model",
          assignment.participant.model,
          ...(outputSchema === null
            ? []
            : ["--output-schema", outputSchema]),
          providerSessionId,
          "-",
        ],
        cwd: assignment.target.path,
        stdin: prompt,
        environment: gitSafeDirectoryEnvironment(
          assignment.target.path,
          environment,
        ),
      };
    },
    attachCheckpointTransport(launch, transport) {
      return {
        ...launch,
        environment: {
          ...launch.environment,
          WAYMARK_CHECKPOINT_RUN_ID: transport.runId,
          WAYMARK_CHECKPOINT_ACTOR: transport.auditorId,
          WAYMARK_CHECKPOINT_ENDPOINT: transport.endpoint,
          WAYMARK_CHECKPOINT_AUTHORIZATION: transport.authorization,
        },
      };
    },
    extractUsage: extractCodexUsage,
    extractFinalOutput: extractCodexFinalOutput,
    normalizeEvent: normalizeCodexEvent,
    startUsageMonitor({ providerSessionId, onUsage }) {
      return createCodexRolloutUsageMonitor({
        providerSessionId,
        onUsage,
        codexHome,
        intervalMs: usagePollIntervalMs,
      });
    },
  };
}
