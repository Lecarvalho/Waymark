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

function stringList(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim() !== "")
    : [];
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
    const shellCommandBudget = execution.shellCommandBudget;
    const roleBudget =
      shellCommandBudget &&
      typeof shellCommandBudget === "object" &&
      !Array.isArray(shellCommandBudget)
        ? shellCommandBudget[role]
        : undefined;
    if (Number.isSafeInteger(roleBudget) && roleBudget >= 0) {
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
  const { role, participant, tokenBudget } = assignment;
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
      type: `${lifecycle}.failed`,
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
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "budget_exceeded", failure };
  }

  if (signal?.aborted || processResult.terminationReason === "aborted") {
    const failure = { reason: "interrupted", phase };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
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
      type: `${lifecycle}.failed`,
      payload: failure,
    });
    return { role, status: "failed", failure };
  }

  if (adapter.requiresFinalOutput === true && finalOutput === undefined) {
    const failure = { reason: "provider_result_missing" };
    store.appendEvent({
      runId: assignment.runId,
      actor: role,
      type: `${lifecycle}.failed`,
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
    type: `${lifecycle}.completed`,
    payload: completion,
  });
  return { role, status: "completed", completion };
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

function importCandidateClaims(store, runId, candidateResult) {
  const findings = candidateResult?.findings;
  if (!Array.isArray(findings) || findings.length === 0) {
    throw new OrchestrationError(
      "CANDIDATE_FINDINGS_REQUIRED",
      "The candidate process returned no findings to verify",
    );
  }
  return findings.map((finding) =>
    store.submitClaim({
      runId,
      subject: finding.subject,
      assertion: finding.assertion,
      claimant: "candidate",
      citations: Array.isArray(finding.citations)
        ? finding.citations.map(normalizeCitation)
        : [],
      confidence: finding.confidence,
      criticality: finding.criticality,
    }),
  );
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
    task: run.task,
    orchestrator,
    tokenBudgets: run.runConditions.tokenBudgets,
    reasoningEffort: run.runConditions.orchestratorReasoningEffort,
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
  if (orchestration.status !== "completed") {
    const status = orchestration.status === "cancelled" ? "cancelled" : "failed";
    store.finishRun(runId, {
      status,
      summary: {
        stage: "fresh_orchestration",
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
