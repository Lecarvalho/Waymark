import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

import {
  createInvestigationAssignments,
  createOrchestratorAssignment,
  renderAssignmentPrompt,
} from "./templates.mjs";

const MAX_STDERR_CHARACTERS = 8_000;
const MAX_RESULT_CHARACTERS = 64_000;
const BUDGET_WRAP_UP_RESERVE_RATIO = 0.2;
const DEFAULT_BUDGET_WRAP_UP_TIMEOUT_MS = 300_000;
const GENERAL_PRACTICE_IDS = Object.freeze([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
]);
const GENERAL_PRACTICE_ID_SET = new Set(GENERAL_PRACTICE_IDS);
const PRACTICE_STATUSES = new Set([
  "strong",
  "mixed",
  "weak",
  "not_assessed",
]);

function assertUniqueItems(items, path) {
  if (new Set(items).size !== items.length) {
    throw new OrchestrationError(
      "DUPLICATE_REFERENCES_NOT_ALLOWED",
      `${path} must not contain duplicate values`,
    );
  }
}
const DETERMINISTIC_VERIFICATION_METHODS = new Set([
  "static_inspection",
  "executable_probe",
]);

export class OrchestrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OrchestrationError";
    this.code = code;
    this.details = details;
  }
}

function phaseForRole(role) {
  if (role === "candidate") return "candidate_navigation";
  if (role === "independent") return "independent_validation";
  return "orchestration";
}

function lifecycleForRole(role) {
  return role === "orchestrator" ? "orchestration" : "investigation";
}

function roleCompleted(status) {
  return (
    status === "completed" ||
    status === "completed_over_budget" ||
    status === "completed_partial_budget" ||
    status === "completed_partial_policy"
  );
}

function roleHasCompleteEvidence(status) {
  return status === "completed" || status === "completed_over_budget";
}

function wrapUpTriggerTokens(tokenBudget) {
  return Math.max(
    1,
    Math.floor(
      tokenBudget.hardLimitTokens * (1 - BUDGET_WRAP_UP_RESERVE_RATIO),
    ),
  );
}

function renderBudgetWrapUpPrompt(assignment, reportTimeoutMs) {
  return [
    "Budget wrap-up directive.",
    "Stop investigating immediately. Do not call tools, run commands, or read more files.",
    `Return one concise structured report within ${reportTimeoutMs / 1_000} seconds.`,
    "Return the required structured result now using only evidence already gathered in this session.",
    "Treat the result as partial: state what was found, every unresolved question, and the concrete searches, file hops, ambiguity, or traceability barriers that prevented completion.",
    "Keep repository claims tied to citations already observed. Do not invent citations or attribute budget exhaustion solely to the repository.",
    assignment.role === "orchestrator"
      ? "Preserve only evidence-linked challenges, verification requests, and recommendations that the gathered claims support."
      : "Set probeResult.status to partial unless the evidence already gathered genuinely supports adequate.",
  ].join("\n");
}

function boundedResult(value) {
  if (value === undefined) return null;
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_RESULT_CHARACTERS) return value;
  return {
    truncated: true,
    originalCharacters: serialized.length,
    preview: serialized.slice(0, MAX_RESULT_CHARACTERS),
  };
}

function processFailure(error) {
  return {
    code: error?.code ?? "PROVIDER_PROCESS_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function runJsonlProcess(
  launch,
  {
    onEvent,
    onControlReady,
    signal,
    killGraceMs = 1_000,
    timeoutMs,
  },
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let invalidLineCount = 0;
    let stderr = "";
    let terminationReason = null;
    let forcedKillTimer;
    let timeoutTimer;

    const child = spawn(launch.command, launch.arguments, {
      cwd: launch.cwd,
      env: { ...process.env, ...launch.environment },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const terminate = (reason) => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      terminationReason = reason;
      if (process.platform === "win32" && Number.isSafeInteger(child.pid)) {
        const result = spawnSync(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true },
        );
        if (result.status !== 0) child.kill();
        return;
      }
      child.kill("SIGTERM");
      forcedKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, killGraceMs);
      forcedKillTimer.unref?.();
    };
    onControlReady?.({ terminate });
    if (Number.isSafeInteger(timeoutMs) && timeoutMs > 0) {
      timeoutTimer = setTimeout(
        () => terminate("report_timeout"),
        timeoutMs,
      );
      timeoutTimer.unref?.();
    }

    const abort = () => terminate("aborted");
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      clearTimeout(forcedKillTimer);
      clearTimeout(timeoutTimer);
      reject(error);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length >= MAX_STDERR_CHARACTERS) return;
      stderr += String(chunk).slice(
        0,
        MAX_STDERR_CHARACTERS - stderr.length,
      );
    });

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => {
      if (line.trim() === "") return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        invalidLineCount += 1;
        return;
      }
      const action = onEvent(event);
      if (action?.terminate === true) {
        terminate(action.reason ?? "requested");
      }
    });

    child.once("close", (exitCode, exitSignal) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      clearTimeout(forcedKillTimer);
      clearTimeout(timeoutTimer);
      resolve({
        exitCode,
        exitSignal,
        invalidLineCount,
        stderrCharacters: stderr.length,
        terminationReason,
      });
    });

    child.stdin.end(launch.stdin ?? "");
  });
}

function findAdapter(adapters, participant) {
  return adapters.find((adapter) => adapter.supports(participant));
}

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim() !== "")
    : [];
}

function shellCommandBudgetForRole(run, role) {
  const execution = run.runConditions.execution;
  if (
    execution === null ||
    typeof execution !== "object" ||
    Array.isArray(execution)
  ) {
    return undefined;
  }
  const shellCommandBudget = execution.shellCommandBudget;
  if (
    shellCommandBudget === null ||
    typeof shellCommandBudget !== "object" ||
    Array.isArray(shellCommandBudget)
  ) {
    return undefined;
  }
  const roleBudget = shellCommandBudget[role];
  return Number.isSafeInteger(roleBudget) && roleBudget >= 0
    ? roleBudget
    : undefined;
}

function assignmentConstraints(run, role) {
  const constraints = [
    ...stringList(run.toolPolicy.allowed).map(
      (item) => `Allowed tool action: ${item}`,
    ),
    ...stringList(run.toolPolicy.forbidden).map(
      (item) => `Forbidden tool action: ${item}`,
    ),
  ];
  const execution = run.runConditions.execution;
  if (execution && typeof execution === "object" && !Array.isArray(execution)) {
    const roleBudget = shellCommandBudgetForRole(run, role);
    if (roleBudget !== undefined) {
      constraints.push(`Use at most ${roleBudget} shell commands.`);
    }
    if (
      Number.isSafeInteger(execution.searchResultLimit) &&
      execution.searchResultLimit > 0
    ) {
      constraints.push(
        `Limit each discovery search to ${execution.searchResultLimit} results.`,
      );
    }
    if (
      Number.isSafeInteger(execution.fileReadLineLimit) &&
      execution.fileReadLineLimit > 0
    ) {
      constraints.push(
        `Read at most ${execution.fileReadLineLimit} lines from a file at once.`,
      );
    }
  }
  return constraints;
}

async function executeAssignment({
  store,
  assignment,
  adapters,
  signal,
  killGraceMs,
  budgetWrapUpTimeoutMs,
}) {
  const { role, participant, tokenBudget, shellCommandBudget } = assignment;
  const phase = phaseForRole(role);
  const lifecycle = lifecycleForRole(role);
  const adapter = findAdapter(adapters, participant);
  store.appendEvent({
    runId: assignment.runId,
    actor: role,
    type: `${lifecycle}.started`,
    payload: {
      role,
      provider: participant.provider,
      model: participant.model,
      reasoningEffort: assignment.reasoningEffort ?? null,
      executionPolicy: assignment.executionPolicy,
      tokenBudget,
      shellCommandBudget: shellCommandBudget ?? null,
    },
  });

  if (!adapter) {
    const failure = {
      reason: "provider_adapter_unavailable",
      provider: participant.provider,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  let latestUsage = null;
  let finalOutput;
  let budgetExceeded = false;
  let shellCommandCount = 0;
  let completedShellCommandCount = 0;
  let shellCommandBudgetExceeded = false;
  let normalizedEventCount = 0;
  let latestRolloutUsage = null;
  let stopUsageMonitor = null;
  let providerSessionId = null;
  let processControl = null;
  let wrapUpRequested = false;
  let wrapUpCompleted = false;
  let reportingOnly = false;
  let reportToolViolation = false;
  let invalidLineCount = 0;
  let processResult;
  const fixedWrapUpAtTokens = wrapUpTriggerTokens(tokenBudget);
  const reportOutputReserveTokens = Math.max(
    1,
    Math.min(8_000, Math.floor(tokenBudget.hardLimitTokens * 0.1)),
  );

  const appendRoleProgress = (message) => {
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "role.progress",
      payload: {
        phase,
        role,
        startedCommands: shellCommandCount,
        completedCommands: completedShellCommandCount,
        declaredCommands: shellCommandBudget ?? null,
        cumulativeTokens: latestUsage?.totalTokens ?? null,
        contextTokens: latestRolloutUsage?.context?.totalTokens ?? null,
        contextWindowTokens:
          latestRolloutUsage?.contextWindowTokens ?? null,
        contextPercent: latestRolloutUsage?.contextPercent ?? null,
        message,
      },
    });
  };
  const retainLatestUsage = (usage) => {
    if (
      latestUsage === null ||
      usage.totalTokens >= latestUsage.totalTokens
    ) {
      latestUsage = usage;
    }
  };
  const enforceTokenBudget = (
    totalTokens,
    { discardExistingOutput = false, contextTokens = null } = {},
  ) => {
    if (reportingOnly) {
      if (totalTokens > tokenBudget.hardLimitTokens) {
        budgetExceeded = true;
        processControl?.terminate("hard_token_limit");
      }
      return;
    }
    const projectedReportTokens =
      Number.isSafeInteger(contextTokens) && contextTokens >= 0
        ? totalTokens + contextTokens + reportOutputReserveTokens
        : null;
    const fixedReserveReached = totalTokens >= fixedWrapUpAtTokens;
    const projectedReserveReached =
      projectedReportTokens !== null &&
      projectedReportTokens >= tokenBudget.hardLimitTokens;
    const canRequestWrapUp =
      (fixedReserveReached || projectedReserveReached) &&
      (finalOutput === undefined || discardExistingOutput) &&
      providerSessionId !== null &&
      typeof adapter.createResumeLaunchSpec === "function" &&
      !wrapUpRequested;
    if (canRequestWrapUp) {
      if (totalTokens > tokenBudget.hardLimitTokens) {
        budgetExceeded = true;
      }
      if (discardExistingOutput) {
        finalOutput = undefined;
      }
      wrapUpRequested = true;
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: "budget.wrap_up_requested",
        payload: {
          phase,
          observedTokens: totalTokens,
          wrapUpTriggerTokens: fixedWrapUpAtTokens,
          hardLimitTokens: tokenBudget.hardLimitTokens,
          reservedTokens: tokenBudget.hardLimitTokens - totalTokens,
          plannedReserveTokens:
            tokenBudget.hardLimitTokens - fixedWrapUpAtTokens,
          contextTokens,
          reportOutputReserveTokens,
          projectedReportTokens,
          reportTimeoutMs: budgetWrapUpTimeoutMs,
          providerSessionId,
          trigger:
            totalTokens > tokenBudget.hardLimitTokens
              ? "telemetry_overshot_hard_limit"
              : projectedReserveReached && !fixedReserveReached
                ? "projected_report_reserve_reached"
                : "reporting_reserve_reached",
          message: `${role}: exploration stopped; reserved budget is being used for a partial report`,
        },
      });
      processControl?.terminate("budget_wrap_up");
      return;
    }
    if (totalTokens > tokenBudget.hardLimitTokens) {
      budgetExceeded = true;
      if (
        finalOutput === undefined ||
        adapter.usageEnforcement === "live"
      ) {
        processControl?.terminate("hard_token_limit");
      }
      return;
    }
  };
  const recordLiveUsage = (usage) => {
    latestRolloutUsage = usage;
    retainLatestUsage(usage.cumulative);
    enforceTokenBudget(usage.cumulative.totalTokens, {
      discardExistingOutput: true,
      contextTokens: usage.context.totalTokens,
    });
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "provider.usage.updated",
      payload: {
        phase,
        cumulative: usage.cumulative,
        context: usage.context,
        contextWindowTokens: usage.contextWindowTokens ?? null,
        contextPercent: usage.contextPercent ?? null,
        message: `${role}: ${usage.cumulative.totalTokens.toLocaleString("en-US")} cumulative tokens · ${usage.context.totalTokens.toLocaleString("en-US")} in current context`,
      },
    });
    appendRoleProgress(
      `${role}: ${completedShellCommandCount}/${shellCommandBudget ?? "?"} commands completed · ${usage.cumulative.totalTokens.toLocaleString("en-US")} tokens`,
    );
  };
  const stopLiveUsageMonitor = () => {
    try {
      stopUsageMonitor?.();
    } catch (error) {
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: "provider.telemetry.unavailable",
        payload: {
          reason: "usage_monitor_stop_failed",
          error: processFailure(error),
        },
      });
    } finally {
      stopUsageMonitor = null;
    }
  };
  const handleWrapUpEvent = (event) => {
    const output = adapter.extractFinalOutput(event);
    if (output !== undefined) finalOutput = output;

    const usage = adapter.extractUsage(event);
    if (usage !== null && usage !== undefined) {
      retainLatestUsage(usage);
      enforceTokenBudget(usage.totalTokens);
    }

    const normalized = adapter.normalizeEvent(event);
    if (normalized !== null && normalized !== undefined) {
      normalizedEventCount += 1;
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: normalized.type,
        payload: normalized.payload,
      });
      if (
        normalized.type === "provider.session.started" &&
        typeof normalized.payload?.providerSessionId === "string" &&
        typeof adapter.startUsageMonitor === "function" &&
        stopUsageMonitor === null
      ) {
        providerSessionId = normalized.payload.providerSessionId;
        try {
          stopUsageMonitor = adapter.startUsageMonitor({
            providerSessionId,
            onUsage: recordLiveUsage,
          });
        } catch (error) {
          store.appendEvent({
            runId: assignment.runId,
            actor: role,
            type: "provider.telemetry.unavailable",
            payload: {
              reason: "usage_monitor_start_failed",
              error: processFailure(error),
            },
          });
        }
      }
      if (
        normalized.type === "provider.tool.started" &&
        normalized.payload?.toolType === "command_execution"
      ) {
        reportToolViolation = true;
      }
    }

    return reportToolViolation
      ? { terminate: true, reason: "report_tool_violation" }
      : undefined;
  };

  try {
    const launch = adapter.createLaunchSpec(
      assignment,
      renderAssignmentPrompt(assignment),
    );
    processResult = await runJsonlProcess(launch, {
      signal,
      killGraceMs,
      onControlReady(control) {
        processControl = control;
      },
      onEvent(event) {
        const output = adapter.extractFinalOutput(event);
        if (output !== undefined) finalOutput = output;

        const usage = adapter.extractUsage(event);
        if (usage !== null && usage !== undefined) {
          retainLatestUsage(usage);
          enforceTokenBudget(usage.totalTokens);
        }

        const normalized = adapter.normalizeEvent(event);
        if (normalized !== null && normalized !== undefined) {
          normalizedEventCount += 1;
          store.appendEvent({
            runId: assignment.runId,
            actor: role,
            type: normalized.type,
            payload: normalized.payload,
          });
          if (
            normalized.type === "provider.session.started" &&
            typeof normalized.payload?.providerSessionId === "string"
          ) {
            providerSessionId = normalized.payload.providerSessionId;
            if (
              typeof adapter.startUsageMonitor === "function" &&
              stopUsageMonitor === null
            ) {
              try {
                stopUsageMonitor = adapter.startUsageMonitor({
                  providerSessionId,
                  onUsage: recordLiveUsage,
                });
              } catch (error) {
                store.appendEvent({
                  runId: assignment.runId,
                  actor: role,
                  type: "provider.telemetry.unavailable",
                  payload: {
                    reason: "usage_monitor_start_failed",
                    error: processFailure(error),
                  },
                });
              }
            }
          }
          if (
            normalized.type === "provider.tool.started" &&
            normalized.payload?.toolType === "command_execution"
          ) {
            shellCommandCount += 1;
            appendRoleProgress(
              `${role}: command ${shellCommandCount}/${shellCommandBudget ?? "?"} started`,
            );
            if (
              shellCommandBudget !== undefined &&
              shellCommandCount > shellCommandBudget
            ) {
              finalOutput = undefined;
              shellCommandBudgetExceeded = true;
            }
          }
          if (
            normalized.type === "provider.tool.completed" &&
            normalized.payload?.toolType === "command_execution"
          ) {
            completedShellCommandCount += 1;
            appendRoleProgress(
              `${role}: ${completedShellCommandCount}/${shellCommandBudget ?? "?"} commands completed`,
            );
          }
        }

        if (shellCommandBudgetExceeded) {
          return { terminate: true, reason: "shell_command_budget" };
        }
        if (wrapUpRequested) {
          return { terminate: true, reason: "budget_wrap_up" };
        }
        if (
          budgetExceeded &&
          (finalOutput === undefined || adapter.usageEnforcement === "live")
        ) {
          return { terminate: true, reason: "hard_token_limit" };
        }
        return undefined;
      },
    });
    invalidLineCount += processResult.invalidLineCount;
    processControl = null;
    stopLiveUsageMonitor();

    if (wrapUpRequested && finalOutput !== undefined) {
      wrapUpCompleted = true;
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: "budget.wrap_up_completed",
        payload: {
          phase,
          hardLimitTokens: tokenBudget.hardLimitTokens,
          observedTokens: latestUsage?.totalTokens ?? null,
          providerSessionId,
          resultRetained: true,
          reportingOnly: false,
          reportTimeoutMs: budgetWrapUpTimeoutMs,
          reportToolViolation: false,
          terminationReason: processResult.terminationReason,
          summary:
            typeof finalOutput?.summary === "string"
              ? finalOutput.summary
              : null,
          deadEnds: Array.isArray(finalOutput?.deadEnds)
            ? finalOutput.deadEnds.filter(
                (item) => typeof item === "string",
              )
            : [],
          message: `${role}: structured result arrived while exploration was stopping`,
        },
      });
    }

    if (
      !wrapUpRequested &&
      budgetExceeded &&
      finalOutput === undefined &&
      providerSessionId !== null &&
      typeof adapter.createResumeLaunchSpec === "function"
    ) {
      wrapUpRequested = true;
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: "budget.wrap_up_requested",
        payload: {
          phase,
          observedTokens: latestUsage?.totalTokens ?? null,
          wrapUpTriggerTokens: fixedWrapUpAtTokens,
          hardLimitTokens: tokenBudget.hardLimitTokens,
          reservedTokens:
            latestUsage === null
              ? null
              : tokenBudget.hardLimitTokens - latestUsage.totalTokens,
          plannedReserveTokens:
            tokenBudget.hardLimitTokens - fixedWrapUpAtTokens,
          reportOutputReserveTokens,
          reportTimeoutMs: budgetWrapUpTimeoutMs,
          providerSessionId,
          trigger: "provider_exit_after_budget_overrun",
          message: `${role}: provider exited without a result; attempting a no-tools partial report`,
        },
      });
    }

    if (
      shellCommandBudgetExceeded &&
      finalOutput === undefined &&
      providerSessionId !== null &&
      typeof adapter.createResumeLaunchSpec === "function" &&
      !wrapUpRequested
    ) {
      wrapUpRequested = true;
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: "budget.wrap_up_requested",
        payload: {
          phase,
          observedTokens: latestUsage?.totalTokens ?? null,
          wrapUpTriggerTokens: fixedWrapUpAtTokens,
          hardLimitTokens: tokenBudget.hardLimitTokens,
          reservedTokens:
            latestUsage === null
              ? null
              : tokenBudget.hardLimitTokens - latestUsage.totalTokens,
          plannedReserveTokens:
            tokenBudget.hardLimitTokens - fixedWrapUpAtTokens,
          reportOutputReserveTokens,
          reportTimeoutMs: budgetWrapUpTimeoutMs,
          providerSessionId,
          trigger: "shell_command_budget_exceeded",
          declaredCommands: shellCommandBudget,
          observedCommands: shellCommandCount,
          message: `${role}: command budget reached; attempting a no-tools partial report`,
        },
      });
    }

    if (
      wrapUpRequested &&
      finalOutput === undefined &&
      providerSessionId !== null &&
      typeof adapter.createResumeLaunchSpec === "function"
    ) {
      finalOutput = undefined;
      reportingOnly = true;
      if (typeof adapter.startUsageMonitor === "function") {
        try {
          stopUsageMonitor = adapter.startUsageMonitor({
            providerSessionId,
            onUsage: recordLiveUsage,
          });
        } catch (error) {
          store.appendEvent({
            runId: assignment.runId,
            actor: role,
            type: "provider.telemetry.unavailable",
            payload: {
              reason: "usage_monitor_start_failed",
              error: processFailure(error),
            },
          });
        }
      }
      processResult = await runJsonlProcess(
        adapter.createResumeLaunchSpec(
          assignment,
          renderBudgetWrapUpPrompt(assignment, budgetWrapUpTimeoutMs),
          providerSessionId,
        ),
        {
          signal,
          killGraceMs,
          onControlReady(control) {
            processControl = control;
          },
          onEvent: handleWrapUpEvent,
          timeoutMs: budgetWrapUpTimeoutMs,
        },
      );
      invalidLineCount += processResult.invalidLineCount;
      processControl = null;
      wrapUpCompleted =
        (processResult.exitCode === 0 ||
          processResult.terminationReason === "hard_token_limit") &&
        finalOutput !== undefined &&
        !reportToolViolation;
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: wrapUpCompleted
          ? "budget.wrap_up_completed"
          : "budget.wrap_up_failed",
        payload: {
          phase,
          hardLimitTokens: tokenBudget.hardLimitTokens,
          observedTokens: latestUsage?.totalTokens ?? null,
          providerSessionId,
          resultRetained: wrapUpCompleted,
          reportingOnly: true,
          reportTimeoutMs: budgetWrapUpTimeoutMs,
          reportToolViolation,
          terminationReason: processResult.terminationReason,
          summary:
            wrapUpCompleted && typeof finalOutput?.summary === "string"
              ? finalOutput.summary
              : null,
          deadEnds:
            wrapUpCompleted && Array.isArray(finalOutput?.deadEnds)
              ? finalOutput.deadEnds.filter(
                  (item) => typeof item === "string",
                )
              : [],
          message: wrapUpCompleted
            ? `${role}: partial budget report retained`
            : `${role}: partial budget report could not be completed`,
        },
      });
    }
  } catch (error) {
    const failure = {
      reason: wrapUpRequested
        ? "budget_wrap_up_process_error"
        : "provider_process_error",
      error: processFailure(error),
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "failed", failure };
  } finally {
    stopLiveUsageMonitor();
  }

  if (latestUsage !== null) {
    store.recordTokenMeasurement({
      runId: assignment.runId,
      actor: role,
      phase,
      source: "measured",
      provider: participant.provider,
      model: participant.model,
      ...latestUsage,
    });
  }
  if (invalidLineCount > 0) {
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "provider.output.invalid",
      payload: { lineCount: invalidLineCount },
    });
  }

  let commandPolicyViolation = null;
  if (shellCommandBudgetExceeded) {
    commandPolicyViolation = {
      reason: "shell_command_budget_exceeded",
      phase,
      declaredLimit: shellCommandBudget,
      observedCommands: shellCommandCount,
      blockedCommandsConsumeBudget: true,
      enforcement:
        processResult.terminationReason === "shell_command_budget"
          ? "live_stream_interrupt"
          : "post_completion_rejection",
      calibrationEligible: false,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "policy.violation",
      payload: commandPolicyViolation,
    });
    if (finalOutput === undefined) {
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: `${lifecycle}.failed`,
        payload: commandPolicyViolation,
      });
      return {
        role,
        status: "policy_exceeded",
        failure: commandPolicyViolation,
      };
    }
  }

  let completionOnlyOverrun = null;
  let completionOnlyOverrunRecorded = false;
  const recordCompletionOnlyOverrun = (resultRetained, workflowContinued) => {
    if (
      completionOnlyOverrun === null ||
      completionOnlyOverrunRecorded
    ) {
      return;
    }
    completionOnlyOverrun = {
      ...completionOnlyOverrun,
      resultRetained,
      workflowContinued,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "budget.exceeded",
      payload: completionOnlyOverrun,
    });
    completionOnlyOverrunRecorded = true;
  };
  if (budgetExceeded) {
    const interruptedAtHardLimit =
      processResult.terminationReason === "hard_token_limit";
    const resultRetainedAfterInterrupt =
      interruptedAtHardLimit && finalOutput !== undefined;
    const overrun = {
      reason: "hard_token_limit_exceeded",
      phase,
      targetTokens: tokenBudget.targetTokens,
      hardLimitTokens: tokenBudget.hardLimitTokens,
      observedTokens: latestUsage.totalTokens,
      enforcement: interruptedAtHardLimit
        ? "live_stream_interrupt"
        : "post_completion",
      calibrationEligible:
        !interruptedAtHardLimit || resultRetainedAfterInterrupt,
      withinDeclaredResourceEnvelope: false,
    };
    if (!interruptedAtHardLimit || resultRetainedAfterInterrupt) {
      completionOnlyOverrun = overrun;
    } else {
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: "budget.exceeded",
        payload: {
          ...overrun,
          resultRetained: false,
          workflowContinued: false,
        },
      });
      store.appendEvent({
        runId: assignment.runId,
        actor: role,
        type: `${lifecycle}.failed`,
        payload: overrun,
      });
      return { role, status: "budget_exceeded", failure: overrun };
    }
  }

  if (wrapUpRequested && !wrapUpCompleted) {
    recordCompletionOnlyOverrun(false, false);
    const failure = {
      reason: reportToolViolation
        ? "budget_wrap_up_tool_violation"
        : "budget_wrap_up_failed",
      phase,
      reportToolViolation,
      terminationReason: processResult.terminationReason,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  if (signal?.aborted || processResult.terminationReason === "aborted") {
    recordCompletionOnlyOverrun(false, false);
    const failure = { reason: "interrupted", phase };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "cancelled", failure };
  }

  if (
    processResult.exitCode !== 0 &&
    !(
      ["hard_token_limit", "shell_command_budget"].includes(
        processResult.terminationReason,
      ) &&
      finalOutput !== undefined
    )
  ) {
    recordCompletionOnlyOverrun(false, false);
    const failure = {
      reason:
        wrapUpRequested && !wrapUpCompleted
          ? "budget_wrap_up_failed"
          : "provider_process_failed",
      exitCode: processResult.exitCode,
      exitSignal: processResult.exitSignal,
      stderrCharacters: processResult.stderrCharacters,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  if (adapter.requiresFinalOutput === true && finalOutput === undefined) {
    recordCompletionOnlyOverrun(false, false);
    const failure = { reason: "provider_result_missing" };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  recordCompletionOnlyOverrun(true, true);
  const completion = {
    role,
    provider: participant.provider,
    model: participant.model,
    normalizedEventCount,
    tokenMeasurement: latestUsage === null ? "unavailable" : "measured",
    calibrationEligible:
      commandPolicyViolation === null &&
      (completionOnlyOverrun === null ||
        completionOnlyOverrun.calibrationEligible === true),
    evidenceCompleteness:
      commandPolicyViolation !== null
        ? "partial_policy_exceeded"
        : wrapUpCompleted
          ? "partial_budget_exhausted"
          : "complete",
    ...(wrapUpCompleted
      ? {
          budgetWrapUp: {
            wrapUpTriggerTokens: fixedWrapUpAtTokens,
            hardLimitTokens: tokenBudget.hardLimitTokens,
            resultRetained: true,
          },
        }
      : {}),
    ...(completionOnlyOverrun === null
      ? {}
      : { budgetOverrun: completionOnlyOverrun }),
    ...(commandPolicyViolation === null
      ? {}
      : { policyViolation: commandPolicyViolation }),
    result: boundedResult(finalOutput),
  };
  store.appendEvent({
    runId: assignment.runId,
    actor: role,
    type: `${lifecycle}.completed`,
    payload: completion,
  });
  return {
    role,
    status:
      commandPolicyViolation !== null
        ? "completed_partial_policy"
        : wrapUpCompleted
        ? "completed_partial_budget"
        : completionOnlyOverrun === null
        ? "completed"
        : "completed_over_budget",
    completion,
  };
}

function normalizeCitation(citation) {
  return {
    path: citation.path,
    ...(Number.isSafeInteger(citation.startLine)
      ? { startLine: citation.startLine }
      : {}),
    ...(Number.isSafeInteger(citation.endLine)
      ? { endLine: citation.endLine }
      : {}),
    ...(typeof citation.symbol === "string" && citation.symbol.trim() !== ""
      ? { symbol: citation.symbol }
      : {}),
  };
}

function validateCitations(citations, path) {
  if (!Array.isArray(citations) || citations.length === 0) {
    throw new OrchestrationError(
      "CITATIONS_REQUIRED",
      `${path} must include at least one line-range citation`,
    );
  }
  for (const [citationIndex, citation] of citations.entries()) {
    if (
      typeof citation?.path !== "string" ||
      citation.path.trim() === "" ||
      !Number.isSafeInteger(citation.startLine) ||
      citation.startLine < 1 ||
      !Number.isSafeInteger(citation.endLine) ||
      citation.endLine < citation.startLine
    ) {
      throw new OrchestrationError(
        "CITATION_INVALID",
        `${path}[${citationIndex}] must name a valid one-based line range`,
      );
    }
  }
}

function validateInvestigationPracticeAssessments(
  investigationResult,
  role,
  auditMode,
) {
  const assessments = investigationResult?.practiceAssessments;
  if (auditMode !== "general") {
    if (!Array.isArray(assessments) || assessments.length !== 0) {
      throw new OrchestrationError(
        "FOCUSED_PRACTICE_ASSESSMENT_NOT_ALLOWED",
        `${role} must return an empty practiceAssessments array outside general mode`,
      );
    }
    return [];
  }
  if (!Array.isArray(assessments) || assessments.length !== 7) {
    throw new OrchestrationError(
      "GENERAL_PRACTICE_ASSESSMENTS_REQUIRED",
      `${role} must return exactly seven general-audit practice assessments`,
    );
  }
  const findings = Array.isArray(investigationResult?.findings)
    ? investigationResult.findings
    : [];
  const seen = new Set();
  for (const [index, assessment] of assessments.entries()) {
    const path = `${role}.practiceAssessments[${index}]`;
    if (
      !GENERAL_PRACTICE_ID_SET.has(assessment?.practiceId) ||
      seen.has(assessment.practiceId)
    ) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_COVERAGE_INVALID",
        `${path}.practiceId must contain each Practice Guide ID exactly once`,
      );
    }
    seen.add(assessment.practiceId);
    if (
      !PRACTICE_STATUSES.has(assessment.status) ||
      typeof assessment.summary !== "string" ||
      assessment.summary.trim() === "" ||
      !Array.isArray(assessment.findingIndexes) ||
      !Array.isArray(assessment.limitations)
    ) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_ASSESSMENT_INVALID",
        `${path} must include a valid status, summary, findingIndexes, and limitations`,
      );
    }
    if (assessment.status === "not_assessed") {
      if (
        assessment.findingIndexes.length !== 0 ||
        assessment.limitations.length === 0
      ) {
        throw new OrchestrationError(
          "GENERAL_PRACTICE_UNKNOWN_INVALID",
          `${path} must use no findings and state a limitation when not assessed`,
        );
      }
      continue;
    }
    assertUniqueItems(assessment.findingIndexes, `${path}.findingIndexes`);
    if (assessment.findingIndexes.length === 0) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_EVIDENCE_REQUIRED",
        `${path} must reference at least one cited finding`,
      );
    }
    for (const findingIndex of assessment.findingIndexes) {
      const finding = findings[findingIndex];
      if (
        !Number.isSafeInteger(findingIndex) ||
        findingIndex < 0 ||
        !finding ||
        !Array.isArray(finding.practiceIds) ||
        !finding.practiceIds.includes(assessment.practiceId)
      ) {
        throw new OrchestrationError(
          "GENERAL_PRACTICE_FINDING_INVALID",
          `${path}.findingIndexes must reference findings tagged with practice ${assessment.practiceId}`,
        );
      }
      validateCitations(
        finding.citations,
        `${role}.findings[${findingIndex}].citations`,
      );
    }
  }
  return assessments;
}

function evidenceIssue({
  role,
  scope,
  index = null,
  practiceId = null,
  findingIndex = null,
  error,
}) {
  return {
    role,
    scope,
    index,
    practiceId,
    findingIndex,
    code: error?.code ?? "EVIDENCE_INVALID",
    message: error instanceof Error ? error.message : String(error),
  };
}

function notAssessedPractice(practiceId, role, limitations) {
  return {
    practiceId,
    status: "not_assessed",
    summary: `${role} did not provide usable cited evidence for Practice Guide ${practiceId}.`,
    findingIndexes: [],
    limitations:
      limitations.length > 0
        ? limitations
        : ["No usable cited finding was linked to this practice."],
  };
}

function normalizeInvestigationPracticeAssessments(
  investigationResult,
  role,
  auditMode,
  { eligibleFindingIndexes = null } = {},
) {
  if (auditMode !== "general") {
    return {
      assessments: validateInvestigationPracticeAssessments(
        investigationResult,
        role,
        auditMode,
      ),
      issues: [],
    };
  }

  const findings = Array.isArray(investigationResult?.findings)
    ? investigationResult.findings
    : [];
  const sourceAssessments = Array.isArray(
    investigationResult?.practiceAssessments,
  )
    ? investigationResult.practiceAssessments
    : [];
  const assessmentsByPractice = new Map();
  const issues = [];

  for (const [index, assessment] of sourceAssessments.entries()) {
    if (!GENERAL_PRACTICE_ID_SET.has(assessment?.practiceId)) {
      issues.push(
        evidenceIssue({
          role,
          scope: "practice_assessment",
          index,
          practiceId: assessment?.practiceId ?? null,
          error: new OrchestrationError(
            "GENERAL_PRACTICE_ID_INVALID",
            `${role}.practiceAssessments[${index}] has an unknown Practice Guide ID`,
          ),
        }),
      );
      continue;
    }
    if (assessmentsByPractice.has(assessment.practiceId)) {
      issues.push(
        evidenceIssue({
          role,
          scope: "practice_assessment",
          index,
          practiceId: assessment.practiceId,
          error: new OrchestrationError(
            "GENERAL_PRACTICE_DUPLICATE",
            `${role}.practiceAssessments[${index}] duplicates Practice Guide ${assessment.practiceId}`,
          ),
        }),
      );
      continue;
    }
    assessmentsByPractice.set(assessment.practiceId, { assessment, index });
  }

  const assessments = GENERAL_PRACTICE_IDS.map((practiceId) => {
    const source = assessmentsByPractice.get(practiceId);
    if (!source) {
      const error = new OrchestrationError(
        "GENERAL_PRACTICE_ASSESSMENT_MISSING",
        `${role} omitted Practice Guide ${practiceId}`,
      );
      issues.push(
        evidenceIssue({
          role,
          scope: "practice_assessment",
          practiceId,
          error,
        }),
      );
      return notAssessedPractice(practiceId, role, [error.message]);
    }

    const { assessment, index } = source;
    const path = `${role}.practiceAssessments[${index}]`;
    const limitations = Array.isArray(assessment.limitations)
      ? assessment.limitations.filter(
          (limitation) =>
            typeof limitation === "string" && limitation.trim() !== "",
        )
      : [];
    if (
      !PRACTICE_STATUSES.has(assessment.status) ||
      typeof assessment.summary !== "string" ||
      assessment.summary.trim() === "" ||
      !Array.isArray(assessment.findingIndexes)
    ) {
      const error = new OrchestrationError(
        "GENERAL_PRACTICE_ASSESSMENT_INVALID",
        `${path} is missing a valid status, summary, findingIndexes, or limitations`,
      );
      issues.push(
        evidenceIssue({
          role,
          scope: "practice_assessment",
          index,
          practiceId,
          error,
        }),
      );
      return notAssessedPractice(practiceId, role, [
        ...limitations,
        error.message,
      ]);
    }

    if (assessment.status === "not_assessed") {
      if (
        assessment.findingIndexes.length > 0 ||
        limitations.length === 0
      ) {
        const error = new OrchestrationError(
          "GENERAL_PRACTICE_UNKNOWN_NORMALIZED",
          `${path} was normalized to an evidence-free not-assessed result`,
        );
        issues.push(
          evidenceIssue({
            role,
            scope: "practice_assessment",
            index,
            practiceId,
            error,
          }),
        );
        return notAssessedPractice(practiceId, role, [
          ...limitations,
          error.message,
        ]);
      }
      return {
        ...assessment,
        findingIndexes: [],
        limitations,
      };
    }

    const validFindingIndexes = [];
    const seenFindingIndexes = new Set();
    for (const findingIndex of assessment.findingIndexes) {
      let error = null;
      const finding = findings[findingIndex];
      if (
        !Number.isSafeInteger(findingIndex) ||
        findingIndex < 0 ||
        !finding
      ) {
        error = new OrchestrationError(
          "GENERAL_PRACTICE_FINDING_OUT_OF_RANGE",
          `${path} references missing finding ${String(findingIndex)}`,
        );
      } else if (seenFindingIndexes.has(findingIndex)) {
        error = new OrchestrationError(
          "GENERAL_PRACTICE_FINDING_DUPLICATE",
          `${path} repeats finding ${findingIndex}`,
        );
      } else if (
        eligibleFindingIndexes !== null &&
        !eligibleFindingIndexes.has(findingIndex)
      ) {
        error = new OrchestrationError(
          "GENERAL_PRACTICE_FINDING_REJECTED",
          `${path} references candidate finding ${findingIndex}, which was rejected during claim import`,
        );
      } else if (
        !Array.isArray(finding.practiceIds) ||
        !finding.practiceIds.includes(practiceId)
      ) {
        error = new OrchestrationError(
          "GENERAL_PRACTICE_FINDING_MISMATCH",
          `${path} references finding ${findingIndex}, which is not tagged with practice ${practiceId}`,
        );
      } else {
        try {
          validateCitations(
            finding.citations,
            `${role}.findings[${findingIndex}].citations`,
          );
        } catch (citationError) {
          error = citationError;
        }
      }

      seenFindingIndexes.add(findingIndex);
      if (error) {
        issues.push(
          evidenceIssue({
            role,
            scope: "practice_finding_reference",
            index,
            practiceId,
            findingIndex:
              Number.isSafeInteger(findingIndex) ? findingIndex : null,
            error,
          }),
        );
      } else {
        validFindingIndexes.push(findingIndex);
      }
    }

    if (validFindingIndexes.length === 0) {
      return notAssessedPractice(practiceId, role, [
        ...limitations,
        `${path} had no usable cited finding after invalid references were removed.`,
      ]);
    }
    return {
      ...assessment,
      findingIndexes: validFindingIndexes,
      limitations:
        validFindingIndexes.length === assessment.findingIndexes.length
          ? limitations
          : [
              ...limitations,
              "Invalid finding references were removed during deterministic evidence import.",
            ],
    };
  });

  validateInvestigationPracticeAssessments(
    { ...investigationResult, practiceAssessments: assessments },
    role,
    auditMode,
  );
  return { assessments, issues };
}

function persistProbeResult(
  store,
  runId,
  role,
  investigationResult,
  auditMode,
) {
  const probeResult = investigationResult?.probeResult;
  if (
    probeResult === null ||
    typeof probeResult !== "object" ||
    !["adequate", "partial", "inadequate"].includes(probeResult.status) ||
    typeof probeResult.summary !== "string" ||
    probeResult.summary.trim() === ""
  ) {
    throw new OrchestrationError(
      "PROBE_RESULT_REQUIRED",
      `${role} must return a validator-only probeResult`,
    );
  }
  validateCitations(probeResult.citations, `${role}.probeResult.citations`);
  validateInvestigationPracticeAssessments(
    investigationResult,
    role,
    auditMode,
  );
  return store.appendEvent({
    runId,
    actor: role,
    type: "probe.result",
    payload: {
      status: probeResult.status,
      summary: probeResult.summary,
      citations: probeResult.citations.map(normalizeCitation),
      recommendationEvidence: false,
      visibility: "validator_only",
    },
  });
}

function importCandidateClaims(store, runId, candidateResult, auditMode) {
  const findings = candidateResult?.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new OrchestrationError(
      "CANDIDATE_FINDINGS_REQUIRED",
      "The candidate process returned no findings to verify",
    );
  }
  const navigationDimensions = new Set([
    "discoveryEfficiency",
    "ownershipClarity",
    "dependencyClarity",
    "changeSurfaceRecall",
    "verificationDiscoverability",
    "instructionQuality",
  ]);
  const claims = [];
  const claimByFindingIndex = new Map();
  const issues = [];
  for (const [index, finding] of findings.entries()) {
    try {
      if (finding?.kind !== "navigation_fact") {
        throw new OrchestrationError(
          "CANDIDATE_FINDING_KIND_REQUIRED",
          `findings[${index}] must be an atomic navigation_fact`,
        );
      }
      if (!navigationDimensions.has(finding.dimension)) {
        throw new OrchestrationError(
          "CANDIDATE_FINDING_DIMENSION_REQUIRED",
          `findings[${index}] must name one Waymark navigability dimension`,
        );
      }
      if (
        typeof finding.friction !== "string" ||
        finding.friction.trim() === ""
      ) {
        throw new OrchestrationError(
          "CANDIDATE_FINDING_FRICTION_REQUIRED",
          `findings[${index}] must state concrete navigation friction`,
        );
      }
      validateCitations(finding.citations, `findings[${index}].citations`);
      const claim = store.submitClaim({
        runId,
        subject: `${
          Array.isArray(finding.practiceIds) && finding.practiceIds.length > 0
            ? `Practice ${finding.practiceIds.join("/")}: `
            : ""
        }${finding.dimension}: ${finding.subject}`,
        assertion: `${finding.assertion} Navigation friction: ${finding.friction}`,
        claimant: "candidate",
        citations: finding.citations.map(normalizeCitation),
        confidence: finding.confidence,
        criticality: finding.criticality,
      });
      claims.push(claim);
      claimByFindingIndex.set(index, claim);
    } catch (error) {
      if (!(error instanceof OrchestrationError)) throw error;
      issues.push(
        evidenceIssue({
          role: "candidate",
          scope: "finding",
          index,
          findingIndex: index,
          error,
        }),
      );
    }
  }
  if (claims.length === 0) {
    throw new OrchestrationError(
      "CANDIDATE_USABLE_FINDINGS_REQUIRED",
      "The candidate process returned no valid cited navigation findings to verify",
      { issues },
    );
  }
  const normalized = normalizeInvestigationPracticeAssessments(
    candidateResult,
    "candidate",
    auditMode,
    { eligibleFindingIndexes: new Set(claimByFindingIndex.keys()) },
  );
  const practiceAssessments = normalized.assessments.map((assessment) => ({
    ...assessment,
    claimIds: assessment.findingIndexes.map(
      (findingIndex) => claimByFindingIndex.get(findingIndex).id,
    ),
  }));
  return {
    claims,
    practiceAssessments,
    normalizedResult: {
      ...candidateResult,
      practiceAssessments: normalized.assessments,
    },
    issues: [...issues, ...normalized.issues],
  };
}

function assertKnownClaim(claimIds, claimId, path) {
  if (!claimIds.has(claimId)) {
    throw new OrchestrationError(
      "ORCHESTRATOR_CLAIM_NOT_FOUND",
      `${path} references unknown claim ${claimId}`,
    );
  }
}

function validateDraftPracticeProfile({
  output,
  auditMode,
  claimIds,
  recommendations,
}) {
  const profile = output.practiceProfile;
  if (auditMode !== "general") {
    if (!Array.isArray(profile) || profile.length !== 0) {
      throw new OrchestrationError(
        "FOCUSED_PRACTICE_PROFILE_NOT_ALLOWED",
        "The orchestrator must return an empty practiceProfile outside general mode",
      );
    }
    return [];
  }
  if (!Array.isArray(profile) || profile.length !== 7) {
    throw new OrchestrationError(
      "GENERAL_PRACTICE_PROFILE_REQUIRED",
      "The orchestrator must return exactly seven general-audit practiceProfile items",
    );
  }
  const recommendationById = new Map(
    recommendations.map((recommendation) => [recommendation.id, recommendation]),
  );
  const seen = new Set();
  for (const [index, item] of profile.entries()) {
    const path = `practiceProfile[${index}]`;
    if (
      !GENERAL_PRACTICE_ID_SET.has(item?.practiceId) ||
      seen.has(item.practiceId) ||
      item.practiceId !== GENERAL_PRACTICE_IDS[index]
    ) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_PROFILE_COVERAGE_INVALID",
        `${path} must contain the ordered Practice Guide IDs 01 through 07 exactly once`,
      );
    }
    seen.add(item.practiceId);
    if (
      !PRACTICE_STATUSES.has(item.status) ||
      typeof item.assessment !== "string" ||
      item.assessment.trim() === "" ||
      typeof item.tokenImpact !== "string" ||
      item.tokenImpact.trim() === "" ||
      !Array.isArray(item.claimIds) ||
      !Array.isArray(item.recommendationIds) ||
      !Array.isArray(item.limitations)
    ) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_PROFILE_INVALID",
        `${path} is missing its assessment, token impact, evidence, recommendation links, or limitations`,
      );
    }
    if (item.status === "not_assessed") {
      if (item.claimIds.length !== 0 || item.limitations.length === 0) {
        throw new OrchestrationError(
          "GENERAL_PRACTICE_PROFILE_UNKNOWN_INVALID",
          `${path} must have no claim IDs and at least one limitation when not assessed`,
        );
      }
    } else if (item.claimIds.length === 0) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_PROFILE_EVIDENCE_REQUIRED",
        `${path} must reference at least one candidate navigation claim`,
      );
    }
    assertUniqueItems(item.claimIds, `${path}.claimIds`);
    assertUniqueItems(item.recommendationIds, `${path}.recommendationIds`);
    for (const claimId of item.claimIds) {
      assertKnownClaim(claimIds, claimId, `${path}.claimIds`);
    }
    if (
      ["mixed", "weak"].includes(item.status) &&
      item.recommendationIds.length === 0
    ) {
      throw new OrchestrationError(
        "GENERAL_PRACTICE_IMPROVEMENT_REQUIRED",
        `${path} must link an improvement for a mixed or weak practice`,
      );
    }
    for (const recommendationId of item.recommendationIds) {
      const recommendation = recommendationById.get(recommendationId);
      if (
        !recommendation ||
        !Array.isArray(recommendation.practiceIds) ||
        !recommendation.practiceIds.includes(item.practiceId)
      ) {
        throw new OrchestrationError(
          "GENERAL_PRACTICE_RECOMMENDATION_INVALID",
          `${path}.recommendationIds must reference recommendations tagged with practice ${item.practiceId}`,
        );
      }
    }
  }
  return profile;
}

function persistOrchestrationOutput(
  store,
  runId,
  output,
  claims,
  auditMode,
) {
  if (
    output === null ||
    typeof output !== "object" ||
    Array.isArray(output)
  ) {
    throw new OrchestrationError(
      "ORCHESTRATOR_RESULT_INVALID",
      "The orchestrator result must be an object",
    );
  }
  const claimIds = new Set(claims.map(({ id }) => id));
  const challenges = Array.isArray(output.challenges) ? output.challenges : [];
  const verificationRequests = Array.isArray(output.verificationRequests)
    ? output.verificationRequests
    : [];
  const recommendations = Array.isArray(output.recommendations)
    ? output.recommendations
    : [];
  if (recommendations.length === 0) {
    throw new OrchestrationError(
      "ORCHESTRATOR_RECOMMENDATIONS_REQUIRED",
      "The orchestrator returned no evidence-linked recommendations",
    );
  }

  for (const [index, challenge] of challenges.entries()) {
    assertKnownClaim(
      claimIds,
      challenge.claimId,
      `challenges[${index}].claimId`,
    );
    store.appendEvent({
      runId,
      actor: "orchestrator",
      type: "challenge.raised",
      payload: {
        challengeId: challenge.challengeId,
        claimId: challenge.claimId,
        assessment: challenge.assessment,
        issue: challenge.issue,
      },
    });
    if (challenge.disposition !== "unresolved") {
      store.appendEvent({
        runId,
        actor: "orchestrator",
        type: "challenge.resolved",
        payload: {
          challengeId: challenge.challengeId,
          claimId: challenge.claimId,
          resolution: challenge.resolution,
          disposition: challenge.disposition,
        },
      });
    }
  }

  for (const [index, request] of verificationRequests.entries()) {
    assertKnownClaim(
      claimIds,
      request.claimId,
      `verificationRequests[${index}].claimId`,
    );
    store.appendEvent({
      runId,
      actor: "orchestrator",
      type: "verification.requested",
      payload: request,
    });
  }

  for (const [index, recommendation] of recommendations.entries()) {
    for (const claimId of recommendation.claimIds ?? []) {
      assertKnownClaim(
        claimIds,
        claimId,
        `recommendations[${index}].claimIds`,
      );
    }
  }
  const practiceProfile = validateDraftPracticeProfile({
    output,
    auditMode,
    claimIds,
    recommendations,
  });
  const draft = store.appendEvent({
    runId,
    actor: "orchestrator",
    type: "recommendations.drafted",
    payload: {
      scope: "repository_navigation",
      method: "fresh_orchestrator_evidence_review",
      recommendations,
      practiceProfile,
    },
  });
  return {
    challengeCount: challenges.length,
    verificationRequestCount: verificationRequests.length,
    recommendationCount: recommendations.length,
    practiceProfileCount: practiceProfile.length,
    draftEventId: draft.id,
  };
}

export function finalizeDraftRecommendations({ store, runId }) {
  const report = store.readReport(runId);
  const draft = report.events
    .filter(
      (event) =>
        event.actor === "orchestrator" &&
        event.type === "recommendations.drafted" &&
        event.payload?.scope === "repository_navigation" &&
        Array.isArray(event.payload?.recommendations),
    )
    .at(-1);
  if (!draft) {
    throw new OrchestrationError(
      "RECOMMENDATION_DRAFT_REQUIRED",
      `Run ${runId} has no fresh-orchestrator recommendation draft`,
    );
  }
  let existing = report.events.find(
    (event) =>
      event.sequence > draft.sequence &&
      event.actor === "waymark:reporter" &&
      event.type === "report.recommendations",
  );
  const auditMode = report.run.runConditions?.auditMode ?? "task_specific";
  const profile = validateDraftPracticeProfile({
    output: { practiceProfile: draft.payload.practiceProfile ?? [] },
    auditMode,
    claimIds: new Set(report.claims.map(({ id }) => id)),
    recommendations: draft.payload.recommendations,
  });
  if (auditMode === "general") {
    const latestVerificationByClaim = new Map();
    for (const verification of report.verifications) {
      latestVerificationByClaim.set(verification.claimId, verification);
    }
    for (const item of profile) {
      for (const claimId of item.claimIds) {
        const verification = latestVerificationByClaim.get(claimId);
        if (
          verification?.verdict !== "verified" ||
          !DETERMINISTIC_VERIFICATION_METHODS.has(verification.method)
        ) {
          throw new OrchestrationError(
            "GENERAL_PRACTICE_CLAIM_NOT_VERIFIED",
            `Practice ${item.practiceId} references claim ${claimId} without deterministic verification`,
          );
        }
      }
    }
  }
  if (!existing) {
    existing = store.appendReportRecommendations(runId, {
      scope: "repository_navigation",
      recommendations: draft.payload.recommendations,
    });
  }
  const existingProfile = report.events.find(
    (event) =>
      event.sequence > draft.sequence &&
      event.actor === "waymark:reporter" &&
      event.type === "report.practice_profile",
  );
  if (auditMode === "general" && !existingProfile) {
    store.appendReportPracticeProfile(runId, {
      schemaVersion: "waymark-practice-profile/1.0.0",
      scope: "general_repository",
      suite: report.run.runConditions?.taskSuite ?? null,
      items: profile,
    });
  }
  if (report.run.status === "active") {
    store.appendEvent({
      runId,
      actor: "workflow",
      type: "phase.changed",
      payload: {
        phase: "report_generation",
        progress: 90,
        message:
          auditMode === "general"
            ? "Verified seven-principle profile and improvement backlog finalized"
            : "Verified evidence-linked recommendations finalized",
      },
    });
  }
  return existing;
}

export async function runInvestigationPhase({
  store,
  runId,
  adapters,
  signal,
  killGraceMs,
  budgetWrapUpTimeoutMs = DEFAULT_BUDGET_WRAP_UP_TIMEOUT_MS,
}) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new OrchestrationError(
      "PROVIDER_ADAPTER_REQUIRED",
      "At least one provider adapter is required",
    );
  }
  if (
    !Number.isSafeInteger(budgetWrapUpTimeoutMs) ||
    budgetWrapUpTimeoutMs < 1
  ) {
    throw new OrchestrationError(
      "BUDGET_WRAP_UP_TIMEOUT_INVALID",
      "budgetWrapUpTimeoutMs must be a positive integer",
    );
  }
  const run = store.readRun(runId);
  if (run.status !== "active") {
    throw new OrchestrationError(
      "RUN_NOT_ACTIVE",
      `Run ${runId} is ${run.status}; investigation requires an active run`,
    );
  }
  if (run.runConditions.auditMode === "general") {
    throw new OrchestrationError(
      "GENERAL_AUDIT_REQUIRES_SINGLE_AUDITOR",
      `Run ${runId} is a general audit; launch it with the general audit command`,
    );
  }
  const priorLaunch = store
    .readEvents(runId, { limit: 10_000 })
    .find(({ type }) =>
      ["investigation.started", "orchestration.started"].includes(type),
    );
  if (priorLaunch) {
    throw new OrchestrationError(
      "ORCHESTRATION_ALREADY_STARTED",
      `Run ${runId} already launched audited roles at event ${priorLaunch.sequence}`,
    );
  }
  const candidate = run.participants.find(({ role }) => role === "candidate");
  const independent =
    run.participants.find(({ role }) => role === "independent") ?? null;
  if (!candidate) {
    throw new OrchestrationError(
      "CANDIDATE_REQUIRED",
      `Run ${runId} has no candidate participant`,
    );
  }
  const orchestrator = run.participants.find(
    ({ role }) => role === "orchestrator",
  );
  if (!orchestrator) {
    throw new OrchestrationError(
      "ORCHESTRATOR_REQUIRED",
      `Run ${runId} has no orchestrator participant`,
    );
  }
  const target = {
    path: run.targetRepositoryPath,
    identity: run.repositoryIdentity,
    commitSha: run.commitSha,
    readOnly: true,
  };
  const auditMode = run.runConditions.auditMode ?? "task_specific";

  store.appendEvent({
    runId,
    actor: "workflow",
    type: "phase.changed",
    payload: {
      phase: "candidate_navigation",
      progress: 5,
      message: "Fresh candidate and independent investigations starting",
    },
  });

  const assignments = createInvestigationAssignments({
    runId,
    target,
    auditMode,
    task: run.task,
    candidate,
    capabilities: {
      parallelAgents: independent !== null,
      independentResearcher: independent,
    },
    tokenBudgets: run.runConditions.tokenBudgets,
    reasoningEfforts: {
      candidate: run.runConditions.candidateReasoningEffort,
      independent: run.runConditions.independentReasoningEffort,
    },
    additionalConstraints: {
      candidate: assignmentConstraints(run, "candidate"),
      independent: assignmentConstraints(run, "independent"),
    },
    shellCommandBudgets: {
      candidate: shellCommandBudgetForRole(run, "candidate"),
      independent: shellCommandBudgetForRole(run, "independent"),
    },
  });

  const results = await Promise.all(
    assignments.map((assignment) =>
      executeAssignment({
        store,
        assignment,
        adapters,
        signal,
        killGraceMs,
        budgetWrapUpTimeoutMs,
      }),
    ),
  );
  const cancelled = results.some(({ status }) => status === "cancelled");
  const candidateExecution = results.find(
    ({ role }) => role === "candidate",
  );
  const candidateFailed = !roleCompleted(candidateExecution?.status);

  if (cancelled || candidateFailed) {
    const status = cancelled ? "cancelled" : "failed";
    const failedResult =
      candidateExecution ??
      results.find(({ status: roleStatus }) => !roleCompleted(roleStatus));
    store.finishRun(runId, {
      status,
      summary: {
        stage: "parallel_investigation",
        reason:
          failedResult?.failure?.reason ?? "parallel_investigation_failed",
        calibrationEligible: false,
        roles: results.map(({ role, status: roleStatus }) => ({
          role,
          status: roleStatus,
        })),
      },
    });
    return { runId, status, results };
  }

  const supportingFailures = results.filter(
    ({ role, status }) =>
      role !== "candidate" && !roleHasCompleteEvidence(status),
  );
  const supportingLimitations = supportingFailures.map(
    ({ role, status, failure, completion }) => ({
      role,
      status,
      reason:
        failure?.reason ??
        completion?.policyViolation?.reason ??
        completion?.budgetOverrun?.reason ??
        "incomplete_investigation_evidence",
    }),
  );
  if (supportingFailures.length > 0) {
    store.appendEvent({
      runId,
      actor: "workflow",
      type: "investigation.degraded",
      payload: {
        calibrationEligible: false,
        message:
          "Candidate evidence was retained; orchestration is continuing without complete independent research",
        unavailableRoles: supportingLimitations,
      },
    });
  }

  store.appendEvent({
    runId,
    actor: "workflow",
    type: "phase.changed",
    payload: {
      phase: "orchestration",
      progress: 40,
      message:
        supportingFailures.length === 0
          ? "Fresh candidate and independent investigations completed"
          : "Candidate investigation completed; diagnostic orchestration continuing with independent research unavailable",
    },
  });

  let claims;
  let candidatePracticeAssessments = [];
  const normalizedInvestigationResults = new Map();
  const evidenceIssues = [];
  try {
    const candidateResult = results.find(({ role }) => role === "candidate")
      ?.completion?.result;
    const imported = importCandidateClaims(
      store,
      runId,
      candidateResult,
      auditMode,
    );
    claims = imported.claims;
    candidatePracticeAssessments = imported.practiceAssessments;
    normalizedInvestigationResults.set(
      "candidate",
      imported.normalizedResult,
    );
    evidenceIssues.push(...imported.issues);

    for (const result of results.filter(({ status }) => roleCompleted(status))) {
      let normalizedResult = normalizedInvestigationResults.get(result.role);
      if (!normalizedResult) {
        const sourceResult = result.completion?.result;
        const normalized = normalizeInvestigationPracticeAssessments(
          sourceResult,
          result.role,
          auditMode,
        );
        normalizedResult = {
          ...sourceResult,
          practiceAssessments: normalized.assessments,
        };
        normalizedInvestigationResults.set(result.role, normalizedResult);
        evidenceIssues.push(...normalized.issues);
      }
      persistProbeResult(
        store,
        runId,
        result.role,
        normalizedResult,
        auditMode,
      );
    }
  } catch (error) {
    const failure = {
      reason: "candidate_evidence_import_failed",
      error: processFailure(error),
      calibrationEligible: false,
    };
    store.appendEvent({
      runId,
      actor: "orchestrator",
      type: "orchestration.failed",
      payload: failure,
    });
    store.finishRun(runId, {
      status: "failed",
      summary: { stage: "candidate_evidence_import", ...failure },
    });
    return { runId, status: "failed", results, failure };
  }

  if (evidenceIssues.length > 0) {
    store.appendEvent({
      runId,
      actor: "workflow",
      type: "investigation.degraded",
      payload: {
        calibrationEligible: false,
        reason: "evidence_normalization_required",
        message:
          "Usable investigation evidence was retained; malformed findings or cross-references were rejected without discarding the complete role result",
        retainedCandidateClaims: claims.length,
        issueCount: evidenceIssues.length,
        issues: evidenceIssues,
      },
    });
  }

  const investigationContext = Object.fromEntries(
    results.map(({ role, status, completion }) => [
      role,
      roleCompleted(status)
        ? (normalizedInvestigationResults.get(role) ??
          completion?.result ??
          null)
        : null,
    ]),
  );
  const evidenceLimitations = evidenceIssues.map((issue) => ({
    role: issue.role,
    status: "degraded",
    reason: issue.code,
  }));
  const orchestratorAssignment = createOrchestratorAssignment({
    runId,
    target,
    auditMode,
    task: run.task,
    orchestrator,
    tokenBudgets: run.runConditions.tokenBudgets,
    reasoningEffort: run.runConditions.orchestratorReasoningEffort,
    shellCommandBudget: shellCommandBudgetForRole(run, "orchestrator"),
    additionalConstraints: assignmentConstraints(run, "orchestrator"),
    context: {
      claims,
      candidatePracticeAssessments,
      investigations: investigationContext,
      researchCoverage: {
        candidate: "complete",
        independent:
          independent === null
            ? "not_configured"
            : supportingFailures.length === 0
              ? "complete"
              : "unavailable",
        limitations: [...supportingLimitations, ...evidenceLimitations],
      },
    },
  });
  const orchestration = await executeAssignment({
    store,
    assignment: orchestratorAssignment,
    adapters,
    signal,
    killGraceMs,
    budgetWrapUpTimeoutMs,
  });
  if (!roleCompleted(orchestration.status)) {
    const status = orchestration.status === "cancelled" ? "cancelled" : "failed";
    store.finishRun(runId, {
      status,
      summary: {
        stage: "fresh_orchestration",
        reason:
          orchestration.failure?.reason ?? "fresh_orchestration_failed",
        calibrationEligible: false,
        roleStatus: orchestration.status,
      },
    });
    return { runId, status, results, orchestration };
  }

  let orchestrationProjection;
  try {
    orchestrationProjection = persistOrchestrationOutput(
      store,
      runId,
      orchestration.completion.result,
      claims,
      auditMode,
    );
  } catch (error) {
    const failure = {
      reason: "orchestration_output_import_failed",
      error: processFailure(error),
      calibrationEligible: false,
    };
    store.appendEvent({
      runId,
      actor: "orchestrator",
      type: "orchestration.failed",
      payload: failure,
    });
    store.finishRun(runId, {
      status: "failed",
      summary: { stage: "orchestration_output_import", ...failure },
    });
    return { runId, status: "failed", results, orchestration, failure };
  }

  store.appendEvent({
    runId,
    actor: "workflow",
    type: "phase.changed",
    payload: {
      phase: "deterministic_verification",
      progress: 65,
      message: "Fresh orchestration completed; deterministic verification required",
    },
  });
  return {
    runId,
    status: "active",
    results,
    claims,
    orchestration,
    orchestrationProjection,
  };
}
