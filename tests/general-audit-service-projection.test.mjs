import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneralAuditHistory,
  generalAuditObservationChannel,
  generalAuditPhase,
  generalAuditProgress,
  generalRunStatus,
} from "../server/general-audit-snapshot.mjs";
import { buildGeneralAuditHistory as compatibilityHistory } from "../server/waymark-server.mjs";
import { generalHistoryReport } from "./fixtures/service-report-fixtures.mjs";

test("general history separates compatible and incompatible reports", () => {
  const current = generalHistoryReport({
    id: "general-current",
    commitSha: "current",
    score: 82,
    createdAt: "2026-01-03T00:00:00.000Z",
  });
  const partial = generalHistoryReport({
    id: "general-partial",
    commitSha: "partial",
    reportComplete: false,
    score: 54,
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const incompatible = generalHistoryReport({
    id: "general-old-rubric",
    commitSha: "old",
    rubricVersion: "waymark-navigability/0.9.0",
    score: 91,
    createdAt: "2026-01-02T00:00:00.000Z",
  });

  const history = buildGeneralAuditHistory(current, [
    current,
    incompatible,
    partial,
  ]);

  assert.deepEqual(
    history.compatible.map(({ runId, status, partial: isPartial }) => ({
      runId,
      status,
      partial: isPartial,
    })),
    [
      { runId: "general-partial", status: "partial", partial: true },
      { runId: "general-current", status: "completed", partial: false },
    ],
  );
  assert.deepEqual(history.excluded, [
    {
      runId: "general-old-rubric",
      commitSha: "old",
      auditedAt: "2026-01-02T00:00:00.000Z",
      reasons: ["rubric version differs"],
    },
  ]);
  assert.deepEqual(
    compatibilityHistory(current, [current, incompatible, partial]),
    history,
  );
});

test("general observation channel separates semantic delivery from provider tool outcomes", () => {
  const events = [
    {
      sequence: 1,
      type: "provider.tool.completed",
      payload: { toolType: "command_execution", status: "completed", exitCode: 0 },
    },
    {
      sequence: 2,
      type: "provider.checkpoint.acknowledged",
      payload: { semanticType: "general.surface.inspected" },
    },
    {
      sequence: 3,
      type: "provider.tool.completed",
      payload: {
        toolType: "command_execution",
        status: "declined",
        exitCode: -1,
        failureReason: "blocked by policy",
      },
    },
    {
      sequence: 4,
      type: "provider.tool.completed",
      payload: {
        toolType: "command_execution",
        command: "rg missing-term .",
        status: "failed",
        exitCode: 1,
      },
    },
  ];

  assert.deepEqual(generalAuditObservationChannel(events, "running"), {
    health: "healthy",
    semanticDelivery: {
      status: "healthy",
      latestAcknowledgementSequence: 2,
      latestRejectionSequence: null,
      latestError: null,
    },
    providerDiagnostics: {
      status: "warnings",
      latestReason: "blocked by policy",
      latestCommand: null,
      latestSequence: 3,
    },
    acceptedSemanticCheckpoints: 1,
    rejectedSemanticCheckpoints: 0,
    providerTools: { completed: 2, declined: 1, failed: 0 },
    latestFailureReason: "blocked by policy",
    latestFailureCommand: null,
    latestFailureSequence: 3,
  });
});

test("a rejected checkpoint followed by acknowledgement is recovered", () => {
  const channel = generalAuditObservationChannel(
    [
      {
        sequence: 3,
        type: "provider.checkpoint.rejected",
        payload: {
          semanticType: "general.behavior_path.recorded",
          error: {
            message: "payload.entryPoint.status: must be known or unknown",
            path: "payload.entryPoint.status",
            expectedShape: "must be known or unknown",
          },
        },
      },
      {
        sequence: 5,
        type: "provider.checkpoint.acknowledged",
        payload: { semanticType: "general.behavior_path.recorded" },
      },
    ],
    "completed",
  );
  assert.equal(channel.semanticDelivery.status, "recovered");
  assert.equal(channel.providerDiagnostics.status, "clean");
  assert.equal(channel.semanticDelivery.latestError.path, "payload.entryPoint.status");
});

test("failed general run with no accepted checkpoint exposes a failed channel", () => {
  const reason = "x".repeat(300);
  const channel = generalAuditObservationChannel(
    [
      {
        sequence: 7,
        type: "provider.checkpoint.rejected",
        payload: { error: { message: reason } },
      },
    ],
    "failed",
  );

  assert.equal(channel.health, "failed");
  assert.equal(channel.acceptedSemanticCheckpoints, 0);
  assert.equal(channel.rejectedSemanticCheckpoints, 1);
  assert.equal(channel.latestFailureReason.length, 240);
  assert.match(channel.latestFailureReason, /…$/);
});

test("general status, phase, and progress remain separate projections", () => {
  const partial = generalHistoryReport({
    id: "general-partial",
    commitSha: "partial",
    reportComplete: false,
  });
  const report = {
    ...partial.generalReport,
    ledgerStatus: "partial",
    surfaces: [],
    behaviorPaths: [],
    synthesis: null,
    recommendations: [],
    generatedFromSequence: 4,
  };

  const status = generalRunStatus(report, partial.run.status);
  assert.equal(status, "partial");
  assert.equal(generalAuditPhase(report, status), "Partial report");
  assert.equal(generalAuditProgress(report, status), 18);
});
