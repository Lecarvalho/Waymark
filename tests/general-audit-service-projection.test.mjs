import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGeneralAuditHistory,
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
  assert.equal(generalAuditProgress(report, status), 20);
});
