import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";

import { startGeneralCheckpointTransport } from "./checkpoint-transport.mjs";
import {
  createGeneralAuditorAssignment,
  projectGeneralContinuation,
  renderGeneralAuditorPrompt,
} from "./general-auditor-template.mjs";

const MAX_STDERR_CHARACTERS = 8_000;
const DEFAULT_CONTEXT_CONTINUATION_PERCENT = 85;
const DEFAULT_NO_PROGRESS_POLICY = Object.freeze({
  identicalSearchLimit: 3,
  repeatedFailureLimit: 3,
  toolEventsWithoutEvidenceLimit: 20,
});
const SEARCH_COMMAND_PATTERN =
  /(?:^|[\s;&|])(rg|grep|find|fd|select-string|get-childitem)(?:\s|$)/i;

export class GeneralAuditRunnerError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "GeneralAuditRunnerError";
    this.code = code;
    this.details = details;
  }
}

function processFailure(error) {
  return {
    code: error?.code ?? "PROVIDER_PROCESS_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function findAdapter(adapters, participant) {
  return adapters.find((adapter) => adapter.supports(participant));
}

function normalizeThresholds(value) {
  if (value === undefined || value === null) {
    return { ...DEFAULT_NO_PROGRESS_POLICY };
  }
  return Object.fromEntries(
    Object.entries(DEFAULT_NO_PROGRESS_POLICY).map(([name, fallback]) => {
      const candidate = value[name];
      return [
        name,
        Number.isSafeInteger(candidate) && candidate > 0
          ? candidate
          : fallback,
      ];
    }),
  );
}

function runJsonlProcess(
  launch,
  { onEvent, onControlReady, signal, killGraceMs },
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = "";
    let invalidLineCount = 0;
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
    onControlReady({ terminate });
    const abort = () => terminate("cancelled");
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
      try {
        onEvent(JSON.parse(line));
      } catch (error) {
        if (error instanceof SyntaxError) invalidLineCount += 1;
        else terminate("runner_event_failure");
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

function auditProjection(store, runId) {
  return store.readReport(runId).generalAudit;
}

function semanticSequence(projection) {
  return projection?.lastSequence ?? 0;
}

function finishFromLedger(store, runId, reason) {
  const projection = auditProjection(store, runId);
  if (!["completed", "partial", "failed", "cancelled"].includes(projection.status)) {
    throw new GeneralAuditRunnerError(
      "GENERAL_AUDIT_NOT_TERMINAL",
      `General audit ${runId} did not reach a terminal ledger outcome`,
    );
  }
  const summary =
    projection.synthesis === null
      ? { reason }
      : {
          reason,
          synthesis: projection.synthesis.summary,
          limitations: projection.synthesis.limitations,
        };
  store.finishRun(runId, { status: projection.status, summary });
  return projection;
}

function interruptFromLedger(store, run, auditor, requestedOutcome, reason) {
  const projection = auditProjection(store, run.id);
  if (["completed", "partial", "failed", "cancelled"].includes(projection.status)) {
    return finishFromLedger(store, run.id, reason);
  }
  const outcome =
    requestedOutcome === "cancelled"
      ? "cancelled"
      : projection.partialReport.available
        ? "partial"
        : "failed";
  store.interruptGeneralAudit({
    runId: run.id,
    actor: auditor.id,
    idempotencyKey: `runner-interruption-${outcome}`,
    payload: { outcome, reason },
  });
  return finishFromLedger(store, run.id, reason);
}

function recordUsage(store, run, auditor, usage, attempt) {
  if (usage === null) return;
  store.recordTokenMeasurement({
    id: `${run.id}-general-research-${attempt}`,
    runId: run.id,
    actor: auditor.id,
    phase: "general_research",
    source: "measured",
    provider: auditor.provider,
    model: auditor.model,
    ...(usage.inputTokens === undefined
      ? {}
      : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined
      ? {}
      : { outputTokens: usage.outputTokens }),
    ...(usage.cachedInputTokens === undefined
      ? {}
      : { cachedInputTokens: usage.cachedInputTokens }),
    ...(usage.cacheCreationTokens === undefined
      ? {}
      : { cacheCreationTokens: usage.cacheCreationTokens }),
    totalTokens: usage.totalTokens,
  });
}

function continuationCheckpoint(store, run, auditor, providerSessionId, attempt) {
  const projection = auditProjection(store, run.id);
  const continuation = projectGeneralContinuation(projection);
  store.appendGeneralCheckpoint({
    runId: run.id,
    actor: auditor.id,
    idempotencyKey: `runner-continuation-${attempt}`,
    type: "general.continuation.recorded",
    payload: {
      continuationId: `${run.id}-continuation-${attempt}`,
      providerSessionId,
      reason: "provider_context_nearly_exhausted",
      inspectedSurfaces: continuation.inspectedSurfaces,
      openQuestions: continuation.openQuestions,
      remainingDimensionIds: continuation.remainingDimensionIds,
    },
  });
  return projectGeneralContinuation(auditProjection(store, run.id));
}

export async function runGeneralAudit({
  store,
  runId,
  adapters,
  signal,
  killGraceMs = 1_000,
  softUsageNoticeTokens,
  contextContinuationPercent = DEFAULT_CONTEXT_CONTINUATION_PERCENT,
  maxContinuations = 2,
  noProgressPolicy,
}) {
  const run = store.readRun(runId);
  if (run.status !== "active") {
    throw new GeneralAuditRunnerError(
      "GENERAL_RUN_NOT_ACTIVE",
      `Run ${runId} is ${run.status}, not active`,
    );
  }
  if (run.runConditions.auditMode !== "general") {
    throw new GeneralAuditRunnerError(
      "GENERAL_MODE_REQUIRED",
      `Run ${runId} is not a general audit`,
    );
  }
  if (
    run.participants.length !== 1 ||
    run.participants[0].role !== "auditor"
  ) {
    throw new GeneralAuditRunnerError(
      "SINGLE_AUDITOR_REQUIRED",
      `General run ${runId} must declare exactly one auditor participant`,
    );
  }
  const auditor = run.participants[0];
  const adapter = findAdapter(adapters, auditor);
  if (!adapter) {
    throw new GeneralAuditRunnerError(
      "PROVIDER_ADAPTER_UNAVAILABLE",
      `No provider adapter supports ${auditor.provider}`,
    );
  }
  if (typeof adapter.attachCheckpointTransport !== "function") {
    throw new GeneralAuditRunnerError(
      "CHECKPOINT_TRANSPORT_UNSUPPORTED",
      `Provider adapter ${adapter.id} does not support semantic checkpoints`,
    );
  }

  const existing = auditProjection(store, runId);
  if (existing === null || existing.status === "not_started") {
    store.startGeneralAudit({
      runId,
      actor: auditor.id,
      idempotencyKey: "runner-general-start",
      payload: {
        repositoryIdentity: run.repositoryIdentity,
        commitSha: run.commitSha,
        protocolVersion: run.protocolVersion,
      },
    });
  }

  const transport = await startGeneralCheckpointTransport({
    store,
    runId,
    auditorId: auditor.id,
    provider: auditor.provider,
  });
  const thresholds = normalizeThresholds(noProgressPolicy);
  const resolvedSoftNotice =
    softUsageNoticeTokens ??
    run.runConditions.softUsageNoticeTokens ??
    null;
  const softNotices = Array.isArray(resolvedSoftNotice)
    ? resolvedSoftNotice
    : Number.isSafeInteger(resolvedSoftNotice) && resolvedSoftNotice > 0
      ? [resolvedSoftNotice]
      : [];
  const emittedSoftNotices = new Set();
  const attempts = [];
  let continuation = null;
  let aggregateTokens = 0;

  try {
    for (let attempt = 1; ; attempt += 1) {
      if (signal?.aborted) {
        const projection = interruptFromLedger(
          store,
          run,
          auditor,
          "cancelled",
          "User cancelled the general audit.",
        );
        return { runId, status: projection.status, attempts };
      }
      const assignment = createGeneralAuditorAssignment({
        run,
        auditor,
        continuation,
      });
      let launch = adapter.createLaunchSpec(
        assignment,
        renderGeneralAuditorPrompt(assignment),
      );
      launch = adapter.attachCheckpointTransport(launch, transport);
      let providerSessionId = null;
      let latestUsage = null;
      let stopUsageMonitor = null;
      let processControl = null;
      let continuationRequested = false;
      let noProgressReason = null;
      let lastSemanticSequence = semanticSequence(auditProjection(store, runId));
      let identicalSearches = 0;
      let lastSearchCommand = null;
      let repeatedFailures = 0;
      let toolEventsWithoutEvidence = 0;

      const observeUsage = (usage, rollout = null) => {
        if (
          usage &&
          (latestUsage === null || usage.totalTokens >= latestUsage.totalTokens)
        ) {
          latestUsage = usage;
        }
        const attemptTokens = usage?.totalTokens ?? 0;
        const observedTotal = aggregateTokens + attemptTokens;
        for (const threshold of softNotices) {
          if (
            observedTotal >= threshold &&
            !emittedSoftNotices.has(threshold)
          ) {
            emittedSoftNotices.add(threshold);
            store.appendEvent({
              runId,
              actor: auditor.id,
              type: "usage.soft_notice",
              payload: {
                phase: "general_research",
                thresholdTokens: threshold,
                observedTokens: observedTotal,
                informationalOnly: true,
              },
            });
          }
        }
        if (
          rollout?.contextPercent !== null &&
          rollout?.contextPercent !== undefined &&
          rollout.contextPercent >= contextContinuationPercent &&
          attempt <= maxContinuations &&
          !continuationRequested
        ) {
          continuationRequested = true;
          processControl?.terminate("context_continuation");
        }
      };

      let processResult;
      try {
        processResult = await runJsonlProcess(launch, {
          signal,
          killGraceMs,
          onControlReady(control) {
            processControl = control;
          },
          onEvent(event) {
            const normalized = adapter.normalizeEvent?.(event);
            if (normalized) {
              store.appendEvent({
                runId,
                actor: auditor.id,
                type: normalized.type,
                payload: normalized.payload,
              });
              if (
                normalized.type === "provider.session.started" &&
                typeof normalized.payload.providerSessionId === "string"
              ) {
                providerSessionId = normalized.payload.providerSessionId;
                transport.rotateProviderSession(providerSessionId);
                stopUsageMonitor?.();
                stopUsageMonitor =
                  typeof adapter.startUsageMonitor === "function"
                    ? adapter.startUsageMonitor({
                        providerSessionId,
                        onUsage(rollout) {
                          observeUsage(rollout.cumulative, rollout);
                        },
                      })
                    : null;
              }

              const currentSequence = semanticSequence(
                auditProjection(store, runId),
              );
              if (currentSequence > lastSemanticSequence) {
                lastSemanticSequence = currentSequence;
                identicalSearches = 0;
                lastSearchCommand = null;
                repeatedFailures = 0;
                toolEventsWithoutEvidence = 0;
              }
              if (normalized.type.startsWith("provider.tool.")) {
                toolEventsWithoutEvidence += 1;
                const command = normalized.payload.command;
                if (
                  normalized.type === "provider.tool.started" &&
                  typeof command === "string" &&
                  SEARCH_COMMAND_PATTERN.test(command)
                ) {
                  identicalSearches =
                    command === lastSearchCommand ? identicalSearches + 1 : 1;
                  lastSearchCommand = command;
                }
                if (
                  normalized.type === "provider.tool.completed" &&
                  (normalized.payload.exitCode > 0 ||
                    ["failed", "declined"].includes(
                      normalized.payload.status,
                    ))
                ) {
                  repeatedFailures += 1;
                }
                if (
                  identicalSearches >= thresholds.identicalSearchLimit
                ) {
                  noProgressReason = "repeated_identical_searches";
                } else if (
                  repeatedFailures >= thresholds.repeatedFailureLimit
                ) {
                  noProgressReason = "repeated_command_failures";
                } else if (
                  toolEventsWithoutEvidence >=
                  thresholds.toolEventsWithoutEvidenceLimit
                ) {
                  noProgressReason = "no_new_semantic_evidence";
                }
                if (noProgressReason !== null) {
                  processControl?.terminate("no_progress");
                }
              }
            }
            const usage = adapter.extractUsage?.(event);
            if (usage) observeUsage(usage);
          },
        });
      } catch (error) {
        processResult = {
          exitCode: null,
          exitSignal: null,
          invalidLineCount: 0,
          stderrCharacters: 0,
          terminationReason: "provider_process_error",
          failure: processFailure(error),
        };
      } finally {
        stopUsageMonitor?.();
      }

      recordUsage(store, run, auditor, latestUsage, attempt);
      aggregateTokens += latestUsage?.totalTokens ?? 0;
      attempts.push({
        attempt,
        providerSessionId,
        ...processResult,
        tokens: latestUsage?.totalTokens ?? null,
      });

      const projection = auditProjection(store, runId);
      if (
        ["completed", "partial", "failed", "cancelled"].includes(
          projection.status,
        )
      ) {
        const terminal = finishFromLedger(
          store,
          runId,
          "Auditor recorded a terminal semantic checkpoint.",
        );
        return { runId, status: terminal.status, attempts };
      }
      if (signal?.aborted || processResult.terminationReason === "cancelled") {
        const terminal = interruptFromLedger(
          store,
          run,
          auditor,
          "cancelled",
          "User cancelled the general audit.",
        );
        return { runId, status: terminal.status, attempts };
      }
      if (
        continuationRequested &&
        providerSessionId !== null &&
        attempt <= maxContinuations
      ) {
        continuation = continuationCheckpoint(
          store,
          run,
          auditor,
          providerSessionId,
          attempt,
        );
        continue;
      }
      const reason =
        noProgressReason === null
          ? processResult.failure?.message ??
            `Provider process ended without synthesis (exit ${String(processResult.exitCode)}).`
          : `No-progress circuit breaker: ${noProgressReason}.`;
      const terminal = interruptFromLedger(
        store,
        run,
        auditor,
        null,
        reason,
      );
      return { runId, status: terminal.status, attempts };
    }
  } finally {
    await transport.close();
  }
}
