import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

import {
  createInvestigationAssignments,
  renderAssignmentPrompt,
} from "./templates.mjs";

const MAX_STDERR_CHARACTERS = 8_000;
const MAX_RESULT_CHARACTERS = 64_000;

export class OrchestrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OrchestrationError";
    this.code = code;
    this.details = details;
  }
}

function phaseForRole(role) {
  return role === "candidate"
    ? "candidate_navigation"
    : "independent_validation";
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

function runJsonlProcess(launch, { onEvent, signal, killGraceMs = 1_000 }) {
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

async function executeAssignment({
  store,
  assignment,
  adapters,
  signal,
  killGraceMs,
}) {
  const { role, participant, tokenBudget } = assignment;
  const phase = phaseForRole(role);
  const adapter = findAdapter(adapters, participant);
  store.appendEvent({
    runId: assignment.runId,
    actor: role,
    type: "investigation.started",
    payload: {
      role,
      provider: participant.provider,
      model: participant.model,
      executionPolicy: assignment.executionPolicy,
      tokenBudget,
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
      type: "investigation.failed",
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  let latestUsage = null;
  let finalOutput;
  let budgetExceeded = false;
  let normalizedEventCount = 0;
  let processResult;

  try {
    const launch = adapter.createLaunchSpec(
      assignment,
      renderAssignmentPrompt(assignment),
    );
    processResult = await runJsonlProcess(launch, {
      signal,
      killGraceMs,
      onEvent(event) {
        const usage = adapter.extractUsage(event);
        if (usage !== null && usage !== undefined) {
          latestUsage = usage;
          if (usage.totalTokens > tokenBudget.hardLimitTokens) {
            budgetExceeded = true;
          }
        }

        const output = adapter.extractFinalOutput(event);
        if (output !== undefined) finalOutput = output;

        const normalized = adapter.normalizeEvent(event);
        if (normalized !== null && normalized !== undefined) {
          normalizedEventCount += 1;
          store.appendEvent({
            runId: assignment.runId,
            actor: role,
            type: normalized.type,
            payload: normalized.payload,
          });
        }

        return budgetExceeded && adapter.usageEnforcement === "live"
          ? { terminate: true, reason: "hard_token_limit" }
          : undefined;
      },
    });
  } catch (error) {
    const failure = {
      reason: "provider_process_error",
      error: processFailure(error),
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "investigation.failed",
      payload: failure,
    });
    return { role, status: "failed", failure };
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
  if (processResult.invalidLineCount > 0) {
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "provider.output.invalid",
      payload: { lineCount: processResult.invalidLineCount },
    });
  }

  if (budgetExceeded) {
    const failure = {
      reason: "hard_token_limit_exceeded",
      phase,
      targetTokens: tokenBudget.targetTokens,
      hardLimitTokens: tokenBudget.hardLimitTokens,
      observedTokens: latestUsage.totalTokens,
      enforcement:
        adapter.usageEnforcement === "live" &&
        processResult.terminationReason === "hard_token_limit"
          ? "live_stream_interrupt"
          : "post_completion",
      calibrationEligible: false,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "budget.exceeded",
      payload: failure,
    });
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "investigation.failed",
      payload: failure,
    });
    return { role, status: "budget_exceeded", failure };
  }

  if (signal?.aborted || processResult.terminationReason === "aborted") {
    const failure = { reason: "interrupted", phase };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "investigation.failed",
      payload: failure,
    });
    return { role, status: "cancelled", failure };
  }

  if (processResult.exitCode !== 0) {
    const failure = {
      reason: "provider_process_failed",
      exitCode: processResult.exitCode,
      exitSignal: processResult.exitSignal,
      stderrCharacters: processResult.stderrCharacters,
    };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "investigation.failed",
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  if (adapter.requiresFinalOutput === true && finalOutput === undefined) {
    const failure = { reason: "provider_result_missing" };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: "investigation.failed",
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  const completion = {
    role,
    provider: participant.provider,
    model: participant.model,
    normalizedEventCount,
    tokenMeasurement: latestUsage === null ? "unavailable" : "measured",
    result: boundedResult(finalOutput),
  };
  store.appendEvent({
    runId: assignment.runId,
    actor: role,
    type: "investigation.completed",
    payload: completion,
  });
  return { role, status: "completed", completion };
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
  const candidate = run.participants.find(({ role }) => role === "candidate");
  const independent =
    run.participants.find(({ role }) => role === "independent") ?? null;
  if (!candidate) {
    throw new OrchestrationError(
      "CANDIDATE_REQUIRED",
      `Run ${runId} has no candidate participant`,
    );
  }

  const assignments = createInvestigationAssignments({
    runId,
    target: {
      path: run.targetRepositoryPath,
      identity: run.repositoryIdentity,
      commitSha: run.commitSha,
      readOnly: true,
    },
    task: run.task,
    candidate,
    capabilities: {
      parallelAgents: independent !== null,
      independentResearcher: independent,
    },
    tokenBudgets: run.runConditions.tokenBudgets,
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
  const failed = results.some(({ status }) => status !== "completed");

  if (failed) {
    const status = cancelled ? "cancelled" : "failed";
    store.finishRun(runId, {
      status,
      summary: {
        stage: "parallel_investigation",
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
    actor: "orchestrator",
    type: "phase.changed",
    payload: {
      phase: "cross_examination",
      message: "Fresh candidate and independent investigations completed",
    },
  });
  return { runId, status: "active", results };
}
