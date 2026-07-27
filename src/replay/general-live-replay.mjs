import { randomUUID } from "node:crypto";

import { AuditStore, resolveDatabasePath } from "../persistence/index.mjs";
import {
  PRACTICE_GUIDE_IDS,
  WAYMARK_DIMENSION_IDS,
} from "../domain/general-audit.mjs";

export const DEFAULT_REPLAY_SERVICE_URL = "http://127.0.0.1:4318";
export const DEFAULT_REPLAY_DELAY_MS = 650;

const SYNTHETIC_REPOSITORY = "waymark/synthetic-live-replay";
const SYNTHETIC_TARGET = "synthetic://waymark/live-replay";
const SYNTHETIC_COMMIT = "0000000000000000000000000000000000000000";
const PROTOCOL_VERSION = "general-audit-contract/1.0.0";
const RUBRIC_VERSION = "waymark-navigability/1.0.0";

function normalizedServiceUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("serviceUrl must be a non-empty string");
  }
  return value.trim().replace(/\/+$/, "");
}

function comparableDatabasePath(value) {
  const resolved = resolveDatabasePath(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function responseJson(response, description) {
  if (!response.ok) {
    throw new Error(`${description} failed with HTTP ${response.status}`);
  }
  return response.json();
}

export async function resolveReplayJournal({
  serviceUrl = DEFAULT_REPLAY_SERVICE_URL,
  databasePath,
  fetchImpl = fetch,
} = {}) {
  const normalizedUrl = normalizedServiceUrl(serviceUrl);
  let health;
  try {
    health = await responseJson(
      await fetchImpl(`${normalizedUrl}/health`),
      "Waymark health check",
    );
  } catch (error) {
    throw new Error(
      `Cannot reach the Waymark service at ${normalizedUrl}. Start npm run dev first. ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (
    health?.ok !== true ||
    health?.service !== "waymark" ||
    typeof health?.databasePath !== "string"
  ) {
    throw new Error(
      `The service at ${normalizedUrl} did not return a valid Waymark health response.`,
    );
  }
  if (health.capabilities?.generalLiveTokenBreakdown !== true) {
    throw new Error(
      "The running Waymark service predates live token breakdown support. Stop that service, restart `npm run dev`, refresh the UI, and run the replay again.",
    );
  }

  const serviceDatabasePath = resolveDatabasePath(health.databasePath);
  if (
    databasePath !== undefined &&
    comparableDatabasePath(databasePath) !==
      comparableDatabasePath(serviceDatabasePath)
  ) {
    throw new Error(
      `Journal mismatch: the running service uses ${serviceDatabasePath}, but --journal resolved to ${resolveDatabasePath(databasePath)}.`,
    );
  }
  return {
    serviceUrl: normalizedUrl,
    databasePath: serviceDatabasePath,
  };
}

function replayTimestamp(startedAt, offset) {
  return new Date(Date.parse(startedAt) + offset * 1000).toISOString();
}

function citation(path, source, symbol = null) {
  return {
    path,
    startLine: 1,
    endLine: 20,
    symbol,
    source,
  };
}

function checkpointAcknowledgement({
  store,
  run,
  actor,
  providerSessionId,
  checkpoint,
}) {
  const event = store.appendGeneralCheckpoint(checkpoint);
  store.appendGeneralCheckpointDiagnostic({
    runId: run.id,
    actor,
    type: "provider.checkpoint.acknowledged",
    payload: {
      provider: "synthetic_fixture",
      providerSessionId,
      idempotencyKey: checkpoint.idempotencyKey,
      semanticType: checkpoint.type,
      eventId: event.id,
      eventSequence: event.sequence,
      recoverySource: "zero_cost_live_replay",
    },
  });
  return event;
}

function liveUsagePayload({
  inputTokens,
  cachedInputTokens,
  outputTokens,
}) {
  return {
    phase: "general_research",
    cumulative: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    context: {
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    contextWindowTokens: 128_000,
    contextPercent: Math.round(
      ((inputTokens + outputTokens) / 128_000) * 10_000,
    ) / 100,
    message: `synthetic auditor: ${(inputTokens + outputTokens).toLocaleString("en-US")} cumulative tokens`,
  };
}

function replayRunInput({ runId, startedAt }) {
  return {
    id: runId,
    targetRepositoryPath: SYNTHETIC_TARGET,
    repositoryIdentity: SYNTHETIC_REPOSITORY,
    commitSha: SYNTHETIC_COMMIT,
    name: "[Synthetic replay] Live general audit",
    task:
      "Exercise the observer's live audit states with deterministic fixture evidence. No repository is inspected and no model is invoked.",
    participants: [
      {
        id: `${runId}-auditor`,
        role: "auditor",
        provider: "synthetic_fixture",
        model: "zero-cost-live-replay",
      },
    ],
    toolPolicy: {
      target: "read-only",
      allowed: ["deterministic fixture events"],
      forbidden: ["repository access", "model invocation"],
    },
    runConditions: {
      auditMode: "general",
      auditorPermissionMode: "read_only",
      tokenPolicy: "unbounded_by_waymark",
      fixture: "zero_cost_live_replay",
      agentHost: "Waymark replay harness",
    },
    protocolVersion: PROTOCOL_VERSION,
    rubricVersion: RUBRIC_VERSION,
    createdAt: startedAt,
  };
}

function findingRevision({
  actor,
  occurredAt,
  findingId,
  revisionId,
  revisionNumber,
  state,
  signal,
  title,
  conclusion,
  citations,
  previousRevisionId = null,
  amendmentReason = null,
  navigationCost = null,
}) {
  return {
    revisionId,
    findingId,
    revisionNumber,
    state,
    signal,
    title,
    conclusion,
    dimensionIds: [...WAYMARK_DIMENSION_IDS],
    practiceGuideIds: [...PRACTICE_GUIDE_IDS],
    citations,
    navigationCost,
    provenance: {
      previousRevisionId,
      amendmentReason,
      actor,
      occurredAt,
      causedByCitations: citations,
    },
  };
}

export async function runGeneralLiveReplay({
  serviceUrl = DEFAULT_REPLAY_SERVICE_URL,
  databasePath,
  delayMs = DEFAULT_REPLAY_DELAY_MS,
  runId = `synthetic-general-replay-${randomUUID()}`,
  now = () => new Date().toISOString(),
  fetchImpl = fetch,
  sleep = (milliseconds) =>
    new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  onStep = () => {},
} = {}) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new TypeError("delayMs must be a finite non-negative number");
  }
  const authoritative = await resolveReplayJournal({
    serviceUrl,
    databasePath,
    fetchImpl,
  });
  const store = new AuditStore({ databasePath: authoritative.databasePath });
  const startedAt = now();
  const run = store.createRun(replayRunInput({ runId, startedAt }));
  const actor = run.participants[0].id;
  const providerSessionId = `${run.id}-session`;
  let timestampOffset = 0;
  let stepNumber = 0;

  const emit = async (label, operation) => {
    const value = operation();
    stepNumber += 1;
    await onStep({
      label,
      stepNumber,
      runId: run.id,
      serviceUrl: authoritative.serviceUrl,
      databasePath: authoritative.databasePath,
      value,
    });
    if (delayMs > 0) await sleep(delayMs);
  };
  const timestamp = () => replayTimestamp(startedAt, timestampOffset++);
  const checkpoint = (type, idempotencyKey, payload, occurredAt = timestamp()) =>
    checkpointAcknowledgement({
      store,
      run,
      actor,
      providerSessionId,
      checkpoint: {
        runId: run.id,
        actor,
        idempotencyKey,
        type,
        payload,
        occurredAt,
      },
    });
  const providerEvent = (type, payload) =>
    store.appendEvent({ runId: run.id, actor, type, payload });
  const codeCitation = citation(
    "fixtures/live-replay/application-owner.ts",
    "production_code",
    "SyntheticApplicationOwner",
  );
  const testCitation = citation(
    "fixtures/live-replay/application-owner.test.ts",
    "test",
    "synthetic live replay",
  );
  const citations = [codeCitation, testCitation];

  try {
    await emit("Created synthetic run", () => run);
    await emit("Started synthetic provider session", () => {
      providerEvent("provider.session.started", {
        provider: "synthetic_fixture",
        providerSessionId,
      });
      providerEvent("provider.turn.started", {
        provider: "synthetic_fixture",
      });
      return checkpoint("general.audit.started", "replay-start", {
        repositoryIdentity: run.repositoryIdentity,
        commitSha: run.commitSha,
        protocolVersion: run.protocolVersion,
      });
    });
    await emit("Updated live token usage", () =>
      providerEvent(
        "provider.usage.updated",
        liveUsagePayload({
          inputTokens: 8_000,
          cachedInputTokens: 6_000,
          outputTokens: 400,
        }),
      ),
    );
    await emit("Recorded completed tool activity", () => {
      providerEvent("provider.tool.started", {
        provider: "synthetic_fixture",
        toolType: "repository_search",
        state: "started",
        providerEventId: "replay-tool-1",
        command: "synthetic search: application owner",
        status: "in_progress",
      });
      return providerEvent("provider.tool.completed", {
        provider: "synthetic_fixture",
        toolType: "repository_search",
        state: "completed",
        providerEventId: "replay-tool-1",
        command: "synthetic search: application owner",
        status: "completed",
        exitCode: 0,
      });
    });
    await emit("Inspected repository surface", () =>
      checkpoint("general.surface.inspected", "replay-surface-code", {
        surface: "production_code",
        summary: "Synthetic production ownership surface inspected.",
        citations: [codeCitation],
      }),
    );
    await emit("Recorded provisional finding", () => {
      const occurredAt = timestamp();
      return checkpoint(
        "general.finding.recorded",
        "replay-finding-owner",
        {
          revision: findingRevision({
            actor,
            occurredAt,
            findingId: "replay-owner-discovery",
            revisionId: "replay-owner-revision-1",
            revisionNumber: 1,
            state: "provisional",
            signal: "friction",
            title: "Ownership initially appeared indirect",
            conclusion:
              "The synthetic exploration initially needed an extra navigation hop.",
            citations,
            navigationCost: {
              searches: 3,
              filesOpened: 5,
              fileHops: 2,
              deadEnds: 1,
              commands: 2,
              processedTokens: 8_400,
              elapsedMs: 4_000,
            },
          }),
        },
        occurredAt,
      );
    });
    await emit("Updated live token usage", () =>
      providerEvent(
        "provider.usage.updated",
        liveUsagePayload({
          inputTokens: 24_000,
          cachedInputTokens: 18_000,
          outputTokens: 1_200,
        }),
      ),
    );
    await emit("Revised finding after later evidence", () => {
      const occurredAt = timestamp();
      return checkpoint(
        "general.finding.revised",
        "replay-finding-owner-revised",
        {
          revision: findingRevision({
            actor,
            occurredAt,
            findingId: "replay-owner-discovery",
            revisionId: "replay-owner-revision-2",
            revisionNumber: 2,
            state: "located_late",
            signal: "friction",
            title: "Ownership exists but was located late",
            conclusion:
              "The synthetic owner became clear after following the test-to-owner edge.",
            citations,
            previousRevisionId: "replay-owner-revision-1",
            amendmentReason:
              "The synthetic test citation exposed the owning symbol.",
          }),
        },
        occurredAt,
      );
    });
    await emit("Recorded positive finding", () => {
      const occurredAt = timestamp();
      return checkpoint(
        "general.finding.recorded",
        "replay-finding-workflow",
        {
          revision: findingRevision({
            actor,
            occurredAt,
            findingId: "replay-canonical-workflow",
            revisionId: "replay-workflow-revision-1",
            revisionNumber: 1,
            state: "confirmed",
            signal: "positive",
            title: "Canonical verification path is explicit",
            conclusion:
              "The synthetic evidence exposes a direct owner-to-test verification path.",
            citations,
            navigationCost: {
              searches: 1,
              filesOpened: 2,
              fileHops: 1,
              deadEnds: 0,
              commands: 1,
              processedTokens: 2_000,
              elapsedMs: 1_500,
            },
          }),
        },
        occurredAt,
      );
    });
    await emit("Recorded behavior path", () => {
      const knownNode = (label, nodeCitations = [codeCitation]) => ({
        status: "known",
        label,
        citations: nodeCitations,
      });
      return checkpoint("general.behavior_path.recorded", "replay-path-1", {
        pathId: "replay-request-path",
        name: "Synthetic request to verification",
        entryPoint: knownNode("Synthetic entry point"),
        owner: knownNode("Synthetic application owner"),
        dependencies: [knownNode("Synthetic dependency")],
        consumers: [knownNode("Synthetic consumer")],
        tests: [knownNode("Synthetic focused test", [testCitation])],
      });
    });
    await emit("Updated live token usage", () =>
      providerEvent(
        "provider.usage.updated",
        liveUsagePayload({
          inputTokens: 48_000,
          cachedInputTokens: 38_000,
          outputTokens: 2_400,
        }),
      ),
    );
    await emit("Recorded dimension progress", () =>
      checkpoint("general.dimension.progress", "replay-dimension-progress", {
        dimensionId: "discoveryEfficiency",
        confidence: 0.8,
        supportingPositiveFindingIds: ["replay-canonical-workflow"],
        supportingFrictionFindingIds: ["replay-owner-discovery"],
        limitations: ["All evidence in this run is explicitly synthetic."],
      }),
    );

    for (const [index, dimensionId] of WAYMARK_DIMENSION_IDS.entries()) {
      await emit(`Assessed ${dimensionId}`, () =>
        checkpoint(
          "general.dimension.assessed",
          `replay-assessment-${dimensionId}`,
          {
            dimensionId,
            score: 82 + index,
            confidence: 0.9,
            supportingPositiveFindingIds: ["replay-canonical-workflow"],
            supportingFrictionFindingIds: ["replay-owner-discovery"],
            limitations: ["All evidence in this run is explicitly synthetic."],
          },
        ),
      );
    }

    await emit("Recorded second behavior path", () => {
      const knownNode = (label, nodeCitations = [codeCitation]) => ({
        status: "known",
        label,
        citations: nodeCitations,
      });
      return checkpoint("general.behavior_path.recorded", "replay-path-2", {
        pathId: "replay-configuration-path",
        name: "Synthetic configuration to consumer",
        entryPoint: knownNode("Synthetic configuration"),
        owner: knownNode("Synthetic configuration owner"),
        dependencies: [knownNode("Synthetic adapter")],
        consumers: [knownNode("Synthetic application consumer")],
        tests: [knownNode("Synthetic integration test", [testCitation])],
      });
    });
    await emit("Recorded recommendation", () =>
      checkpoint(
        "general.recommendation.recorded",
        "replay-recommendation",
        {
          recommendationId: "replay-document-owner-edge",
          title: "Document the owner edge beside the entry point",
          rationale:
            "The synthetic located-late finding demonstrates how an evidence-linked recommendation appears live.",
          findingIds: ["replay-owner-discovery"],
          dimensionIds: ["discoveryEfficiency", "ownershipClarity"],
        },
      ),
    );
    await emit("Updated final live token usage", () =>
      providerEvent(
        "provider.usage.updated",
        liveUsagePayload({
          inputTokens: 64_000,
          cachedInputTokens: 52_000,
          outputTokens: 3_600,
        }),
      ),
    );
    await emit("Completed synthesis", () =>
      checkpoint("general.synthesis.completed", "replay-synthesis", {
        outcome: "completed",
        summary:
          "The zero-cost replay exercised live tokens, tools, findings, revision history, assessments, recommendations, and completion.",
        limitations: [
          "This is deterministic fixture evidence and not a repository audit.",
        ],
      }),
    );
    await emit("Finalized synthetic run", () => {
      const finishedAt = timestamp();
      store.recordTokenMeasurement({
        id: `${run.id}-general-research-final`,
        runId: run.id,
        actor,
        phase: "general_research",
        source: "estimated",
        provider: "synthetic_fixture",
        model: "zero-cost-live-replay",
        inputTokens: 64_000,
        cachedInputTokens: 52_000,
        outputTokens: 3_600,
        totalTokens: 67_600,
        measuredAt: finishedAt,
      });
      providerEvent("provider.turn.completed", {
        provider: "synthetic_fixture",
      });
      return store.finishRun(run.id, {
        status: "completed",
        summary: {
          reason:
            "Deterministic zero-cost live observer replay completed successfully.",
          syntheticFixture: true,
        },
        finishedAt,
      });
    });

    const visibleReport = await responseJson(
      await fetchImpl(
        `${authoritative.serviceUrl}/api/runs/${encodeURIComponent(run.id)}`,
      ),
      "Waymark run read-back",
    );
    if (visibleReport?.run?.id !== run.id) {
      throw new Error(
        "The running Waymark service did not read back the synthetic run from the selected journal.",
      );
    }
    return {
      runId: run.id,
      serviceUrl: authoritative.serviceUrl,
      databasePath: authoritative.databasePath,
      status: visibleReport.run.status,
      stepCount: stepNumber,
    };
  } finally {
    store.close();
  }
}
