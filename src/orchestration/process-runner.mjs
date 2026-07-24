import { spawn } from "node:child_process";
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
    status === "completed_partial_budget"
  );
}

function wrapUpTriggerTokens(tokenBudget) {
  return Math.max(
    1,
    Math.floor(
      tokenBudget.hardLimitTokens * (1 - BUDGET_WRAP_UP_RESERVE_RATIO),
    ),
  );
}

function renderBudgetWrapUpPrompt(assignment) {
  return [
    "Budget wrap-up directive.",
    "Stop investigating immediately. Do not call tools, run commands, or read more files.",
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
  { onEvent, onControlReady, signal, killGraceMs = 1_000 },
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let invalidLineCount = 0;
    let stderr = "";
    let terminationReason = null;
    let forcedKillTimer;

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
      child.kill();
      forcedKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, killGraceMs);
      forcedKillTimer.unref?.();
    };
    onControlReady?.({ terminate });

    const abort = () => terminate("aborted");
    if (signal?.aborted) abort();
    signal?.addEventListener("abort", abort, { once: true });

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      clearTimeout(forcedKillTimer);
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
  let allowBudgetWrapUp = false;
  let wrapUpRequested = false;
  let wrapUpCompleted = false;
  let invalidLineCount = 0;
  let processResult;
  const wrapUpAtTokens = wrapUpTriggerTokens(tokenBudget);

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
  const enforceTokenBudget = (totalTokens) => {
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
    if (
      allowBudgetWrapUp &&
      totalTokens >= wrapUpAtTokens &&
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
          observedTokens: totalTokens,
          wrapUpTriggerTokens: wrapUpAtTokens,
          hardLimitTokens: tokenBudget.hardLimitTokens,
          reservedTokens: tokenBudget.hardLimitTokens - wrapUpAtTokens,
          providerSessionId,
          message: `${role}: exploration stopped; reserved budget is being used for a partial report`,
        },
      });
      processControl?.terminate("budget_wrap_up");
    }
  };
  const recordLiveUsage = (usage) => {
    latestRolloutUsage = usage;
    retainLatestUsage(usage.cumulative);
    enforceTokenBudget(usage.cumulative.totalTokens);
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
    }

    return budgetExceeded
      ? { terminate: true, reason: "hard_token_limit" }
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
        allowBudgetWrapUp = true;
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
        if (
          budgetExceeded &&
          (finalOutput === undefined || adapter.usageEnforcement === "live")
        ) {
          return { terminate: true, reason: "hard_token_limit" };
        }
        if (wrapUpRequested && allowBudgetWrapUp) {
          return { terminate: true, reason: "budget_wrap_up" };
        }
        return undefined;
      },
    });
    invalidLineCount += processResult.invalidLineCount;
    processControl = null;
    stopLiveUsageMonitor();

    if (
      processResult.terminationReason === "budget_wrap_up" &&
      providerSessionId !== null &&
      typeof adapter.createResumeLaunchSpec === "function"
    ) {
      finalOutput = undefined;
      allowBudgetWrapUp = false;
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
          renderBudgetWrapUpPrompt(assignment),
          providerSessionId,
        ),
        {
          signal,
          killGraceMs,
          onControlReady(control) {
            processControl = control;
          },
          onEvent: handleWrapUpEvent,
        },
      );
      invalidLineCount += processResult.invalidLineCount;
      processControl = null;
      wrapUpCompleted =
        processResult.exitCode === 0 && finalOutput !== undefined;
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

  if (shellCommandBudgetExceeded) {
    const failure = {
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
      payload: failure,
    });
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "policy_exceeded", failure };
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
      processResult.terminationReason === "hard_token_limit" &&
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
      completionOnlyOverrun === null ||
      completionOnlyOverrun.calibrationEligible === true,
    evidenceCompleteness: wrapUpCompleted
      ? "partial_budget_exhausted"
      : "complete",
    ...(wrapUpCompleted
      ? {
          budgetWrapUp: {
            wrapUpTriggerTokens: wrapUpAtTokens,
            hardLimitTokens: tokenBudget.hardLimitTokens,
            resultRetained: true,
          },
        }
      : {}),
    ...(completionOnlyOverrun === null
      ? {}
      : { budgetOverrun: completionOnlyOverrun }),
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
      wrapUpCompleted
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

function persistProbeResult(store, runId, role, investigationResult) {
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

function importCandidateClaims(store, runId, candidateResult) {
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
  return findings.map((finding, index) => {
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
    return store.submitClaim({
      runId,
      subject: `${finding.dimension}: ${finding.subject}`,
      assertion: `${finding.assertion} Navigation friction: ${finding.friction}`,
      claimant: "candidate",
      citations: finding.citations.map(normalizeCitation),
      confidence: finding.confidence,
      criticality: finding.criticality,
    });
  });
}

function assertKnownClaim(claimIds, claimId, path) {
  if (!claimIds.has(claimId)) {
    throw new OrchestrationError(
      "ORCHESTRATOR_CLAIM_NOT_FOUND",
      `${path} references unknown claim ${claimId}`,
    );
  }
}

function persistOrchestrationOutput(store, runId, output, claims) {
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
  const draft = store.appendEvent({
    runId,
    actor: "orchestrator",
    type: "recommendations.drafted",
    payload: {
      scope: "repository_navigation",
      method: "fresh_orchestrator_evidence_review",
      recommendations,
    },
  });
  return {
    challengeCount: challenges.length,
    verificationRequestCount: verificationRequests.length,
    recommendationCount: recommendations.length,
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
  const existing = report.events.find(
    (event) =>
      event.sequence > draft.sequence &&
      event.actor === "waymark:reporter" &&
      event.type === "report.recommendations",
  );
  if (existing) return existing;
  const recommendationEvent = store.appendReportRecommendations(runId, {
    scope: "repository_navigation",
    recommendations: draft.payload.recommendations,
  });
  if (report.run.status === "active") {
    store.appendEvent({
      runId,
      actor: "workflow",
      type: "phase.changed",
      payload: {
        phase: "report_generation",
        progress: 90,
        message: "Verified evidence-linked recommendations finalized",
      },
    });
  }
  return recommendationEvent;
}

export async function runInvestigationPhase({
  store,
  runId,
  adapters,
  signal,
  killGraceMs,
}) {
  if (!Array.isArray(adapters) || adapters.length === 0) {
    throw new OrchestrationError(
      "PROVIDER_ADAPTER_REQUIRED",
      "At least one provider adapter is required",
    );
  }
  const run = store.readRun(runId);
  if (run.status !== "active") {
    throw new OrchestrationError(
      "RUN_NOT_ACTIVE",
      `Run ${runId} is ${run.status}; investigation requires an active run`,
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
    auditMode: run.runConditions.auditMode ?? "task_specific",
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
      }),
    ),
  );
  const cancelled = results.some(({ status }) => status === "cancelled");
  const failed = results.some(({ status }) => !roleCompleted(status));

  if (failed) {
    const status = cancelled ? "cancelled" : "failed";
    const failedResult = results.find(
      ({ status: roleStatus }) => !roleCompleted(roleStatus),
    );
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

  store.appendEvent({
    runId,
    actor: "workflow",
    type: "phase.changed",
    payload: {
      phase: "orchestration",
      progress: 40,
      message: "Fresh candidate and independent investigations completed",
    },
  });

  let claims;
  try {
    for (const result of results) {
      persistProbeResult(
        store,
        runId,
        result.role,
        result.completion?.result,
      );
    }
    const candidateResult = results.find(({ role }) => role === "candidate")
      ?.completion?.result;
    claims = importCandidateClaims(store, runId, candidateResult);
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

  const investigationContext = Object.fromEntries(
    results.map(({ role, completion }) => [role, completion?.result ?? null]),
  );
  const orchestratorAssignment = createOrchestratorAssignment({
    runId,
    target,
    auditMode: run.runConditions.auditMode ?? "task_specific",
    task: run.task,
    orchestrator,
    tokenBudgets: run.runConditions.tokenBudgets,
    reasoningEffort: run.runConditions.orchestratorReasoningEffort,
    shellCommandBudget: shellCommandBudgetForRole(run, "orchestrator"),
    additionalConstraints: assignmentConstraints(run, "orchestrator"),
    context: {
      claims,
      investigations: investigationContext,
    },
  });
  const orchestration = await executeAssignment({
    store,
    assignment: orchestratorAssignment,
    adapters,
    signal,
    killGraceMs,
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
