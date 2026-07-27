function lastDefinedEvent(events, predicate) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (predicate(events[index])) return events[index];
  }
  return undefined;
}

function humanizeReason(value) {
  return typeof value === "string" && value.length > 0
    ? value.replaceAll("_", " ")
    : "unknown failure";
}

const MAX_FAILURE_REASON_LENGTH = 240;
const MAX_FAILURE_COMMAND_LENGTH = 512;

function boundedFailureReason(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return null;
  if (normalized.length <= MAX_FAILURE_REASON_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_FAILURE_REASON_LENGTH - 1).trimEnd()}…`;
}

function boundedFailureCommand(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return null;
  if (normalized.length <= MAX_FAILURE_COMMAND_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_FAILURE_COMMAND_LENGTH - 1).trimEnd()}…`;
}

function eventFailureReason(event) {
  const payload = event.payload ?? {};
  const directReason =
    boundedFailureReason(payload.failureReason) ??
    boundedFailureReason(payload.message) ??
    boundedFailureReason(payload.reason);
  if (directReason) return directReason;

  if (payload.error && typeof payload.error === "object") {
    const errorReason =
      boundedFailureReason(payload.error.message) ??
      boundedFailureReason(payload.error.code);
    if (errorReason) return errorReason;
  }
  if (typeof payload.error === "string") {
    const errorReason = boundedFailureReason(payload.error);
    if (errorReason) return errorReason;
  }

  if (event.type === "provider.tool.completed") {
    const tool = humanizeReason(payload.toolType);
    if (payload.status === "declined") return `${tool} was declined.`;
    if (
      payload.status === "failed" ||
      (Number.isSafeInteger(payload.exitCode) && payload.exitCode > 0)
    ) {
      return `${tool} failed${
        Number.isSafeInteger(payload.exitCode)
          ? ` with exit code ${payload.exitCode}`
          : ""
      }.`;
    }
  }
  if (event.type === "provider.checkpoint.rejected") {
    return "A semantic checkpoint was rejected.";
  }
  if (event.type === "provider.error") return "The provider reported an error.";
  return null;
}

function toolOutcome(event) {
  if (event.payload?.status === "declined") return "declined";
  if (
    event.payload?.status === "failed" ||
    (Number.isSafeInteger(event.payload?.exitCode) &&
      event.payload.exitCode !== 0)
  ) {
    const command = String(event.payload?.command ?? "").trim();
    if (
      event.payload?.exitCode === 1 &&
      /^(?:rg|ripgrep)(?:\.exe)?(?:\s|$)/i.test(command)
    ) {
      return "completed";
    }
    return "failed";
  }
  return "completed";
}

export function generalAuditObservationChannel(events, status) {
  const acknowledged = events.filter(
    ({ type }) => type === "provider.checkpoint.acknowledged",
  );
  const rejected = events.filter(
    ({ type }) => type === "provider.checkpoint.rejected",
  );
  const toolCompletions = events.filter(
    ({ type }) => type === "provider.tool.completed",
  );
  const providerErrors = events.filter(
    ({ type }) => type === "provider.error",
  );
  const interruptions = events.filter(
    ({ type }) => type === "general.audit.interrupted",
  );
  const providerTools = {
    completed: 0,
    declined: 0,
    failed: 0,
  };
  for (const event of toolCompletions) {
    providerTools[toolOutcome(event)] += 1;
  }

  const diagnosticFailureEvents = [
    ...providerErrors,
    ...interruptions,
    ...toolCompletions.filter((event) => toolOutcome(event) !== "completed"),
  ].sort((left, right) => left.sequence - right.sequence);
  const latestDiagnosticFailure = diagnosticFailureEvents.at(-1);
  const latestRejection = rejected.at(-1);
  const latestAcknowledgementSequence = acknowledged.at(-1)?.sequence ?? null;
  const latestRejectionSequence = rejected.at(-1)?.sequence ?? null;
  const terminal = status !== "running";
  const deliveryFailed =
    terminal &&
    latestRejectionSequence !== null &&
    (latestAcknowledgementSequence === null ||
      latestRejectionSequence > latestAcknowledgementSequence);
  const noEvidenceRecovered = status === "failed" && acknowledged.length === 0;
  const semanticStatus =
    deliveryFailed || noEvidenceRecovered
      ? "failed"
      : acknowledged.length === 0
        ? "waiting"
        : rejected.length > 0
          ? "recovered"
          : "healthy";
  const diagnosticsStatus =
    interruptions.length > 0
      ? "failed/interrupted"
      : providerErrors.length > 0 ||
          providerTools.declined > 0 ||
          providerTools.failed > 0
        ? "warnings"
        : "clean";
  const rejectionError = latestRejection?.payload?.error ?? null;

  return {
    health: semanticStatus,
    semanticDelivery: {
      status: semanticStatus,
      latestAcknowledgementSequence,
      latestRejectionSequence,
      latestError: latestRejection
        ? {
            semanticType: latestRejection.payload?.semanticType ?? null,
            path: rejectionError?.path ?? null,
            message:
              boundedFailureReason(rejectionError?.message) ??
              "A semantic checkpoint was rejected.",
            expectedShape: boundedFailureReason(rejectionError?.expectedShape),
            sequence: latestRejection.sequence,
          }
        : null,
    },
    providerDiagnostics: {
      status: diagnosticsStatus,
      latestReason: latestDiagnosticFailure
        ? eventFailureReason(latestDiagnosticFailure)
        : null,
      latestCommand: latestDiagnosticFailure
        ? boundedFailureCommand(latestDiagnosticFailure.payload?.command)
        : null,
      latestSequence: latestDiagnosticFailure?.sequence ?? null,
    },
    acceptedSemanticCheckpoints: acknowledged.length,
    rejectedSemanticCheckpoints: rejected.length,
    providerTools,
    latestFailureReason:
      semanticStatus === "failed"
        ? boundedFailureReason(rejectionError?.message)
        : latestDiagnosticFailure
          ? eventFailureReason(latestDiagnosticFailure)
          : null,
    latestFailureCommand: latestDiagnosticFailure
      ? boundedFailureCommand(latestDiagnosticFailure.payload?.command)
      : null,
    latestFailureSequence:
      semanticStatus === "failed"
        ? latestRejection?.sequence ?? null
        : latestDiagnosticFailure?.sequence ?? null,
  };
}

export function generalRunStatus(generalReport, runStatus) {
  const ledgerStatus = generalReport?.ledgerStatus;
  if (["completed", "partial", "failed", "cancelled"].includes(ledgerStatus)) {
    return ledgerStatus;
  }
  if (runStatus === "active") return "running";
  if (["completed", "partial", "failed", "cancelled"].includes(runStatus)) {
    return runStatus;
  }
  return "failed";
}

export function generalAuditProgress(generalReport, status) {
  if (status === "completed") return 100;
  if (!generalReport) return 0;

  const inspectedSurfaceCount = new Set(
    generalReport.surfaces.map(({ surface }) => surface),
  ).size;
  const surfaceProgress = Math.min(1, inspectedSurfaceCount / 9);
  const pathProgress = Math.min(1, generalReport.behaviorPaths.length / 2);
  const dimensionProgress =
    generalReport.dimensions.reduce(
      (total, dimension) =>
        total +
        (dimension.assessmentState === "assessed"
          ? 1
          : dimension.assessmentState === "in_progress"
            ? 0.5
            : 0),
      0,
    ) / 6;
  const practiceProgress =
    (generalReport.practiceProfile?.filter(
      ({ dispositionRecorded }) => dispositionRecorded,
    ).length ?? 0) / 7;
  const synthesisProgress = generalReport.synthesis === null ? 0 : 1;

  return Math.round(
    Math.max(
      generalReport.generatedFromSequence > 0 ? 3 : 0,
      surfaceProgress * 25 +
        pathProgress * 15 +
        dimensionProgress * 35 +
        practiceProgress * 15 +
        synthesisProgress * 10,
    ),
  );
}

export function generalAuditPhase(generalReport, status) {
  if (status === "completed") return "Complete";
  if (status === "partial") return "Partial report";
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (!generalReport) return "Repository survey";
  if (
    generalReport.synthesis !== null ||
    generalReport.recommendations.length > 0
  ) {
    return "Synthesis";
  }
  if (
    generalReport.dimensions.some(
      ({ assessmentState }) => assessmentState !== "not_assessed",
    )
  ) {
    return "Dimension assessment";
  }
  if (generalReport.behaviorPaths.length > 0) {
    return "Behavior-path tracing";
  }
  return "Repository survey";
}

export function generalLatestEventText(events) {
  const event = lastDefinedEvent(
    events,
    ({ type }) => typeof type === "string" && type.startsWith("general."),
  );
  if (!event) return "General audit is waiting for its first checkpoint.";

  switch (event.type) {
    case "general.audit.started":
      return "General auditor started the repository survey.";
    case "general.surface.inspected":
      return `Inspected ${humanizeReason(event.payload?.surface)}.`;
    case "general.behavior_path.recorded":
      return `Recorded behavior path: ${event.payload?.name ?? "Untitled path"}.`;
    case "general.finding.recorded":
      return `Recorded ${event.payload?.revision?.state ?? "provisional"} finding: ${event.payload?.revision?.title ?? "Untitled finding"}.`;
    case "general.finding.revised":
      return `Revised finding to ${event.payload?.revision?.state ?? "a new state"}: ${event.payload?.revision?.title ?? "Untitled finding"}.`;
    case "general.dimension.progress":
      return `Updated ${event.payload?.dimensionId ?? "dimension"} evidence coverage.`;
    case "general.dimension.assessed":
      return `Assessed ${event.payload?.dimensionId ?? "dimension"}.`;
    case "general.practice.assessed":
      return `Assessed Practice Guide principle ${event.payload?.principleId ?? "unknown"}.`;
    case "general.recommendation.recorded":
      return `Recorded recommendation: ${event.payload?.title ?? "Untitled recommendation"}.`;
    case "general.friction.disposition.recorded":
      return `Recorded disposition for ${event.payload?.findingId ?? "a friction finding"}.`;
    case "general.continuation.recorded":
      return "Saved general-audit continuation state.";
    case "general.synthesis.completed":
      return event.payload?.outcome === "completed"
        ? "General audit synthesis completed."
        : "Partial general-audit synthesis saved.";
    case "general.audit.interrupted":
      return `General audit ${event.payload?.outcome ?? "interrupted"}: ${event.payload?.reason ?? "No reason recorded"}.`;
    default:
      return event.type;
  }
}

function generalProviderSession(events, status) {
  const sessionEvent = lastDefinedEvent(
    events,
    (event) => event.type === "provider.session.started",
  );
  const providerEvents = events.filter(
    ({ type }) => typeof type === "string" && type.startsWith("provider."),
  );
  const latestActivity = providerEvents.at(-1);
  const latestTurnStarted = lastDefinedEvent(
    providerEvents,
    (event) => event.type === "provider.turn.started",
  );
  const latestTurnCompleted = lastDefinedEvent(
    providerEvents,
    (event) => event.type === "provider.turn.completed",
  );
  const latestError = lastDefinedEvent(
    providerEvents,
    (event) => event.type === "provider.error",
  );
  let sessionStatus;
  if (status === "completed") sessionStatus = "complete";
  else if (status === "partial") sessionStatus = "interrupted";
  else if (status === "failed") sessionStatus = "failed";
  else if (status === "cancelled") sessionStatus = "cancelled";
  else if (!sessionEvent) sessionStatus = "starting";
  else if (
    latestError &&
    latestError.sequence > sessionEvent.sequence &&
    (!latestTurnCompleted || latestError.sequence > latestTurnCompleted.sequence)
  ) {
    sessionStatus = "error";
  } else if (
    latestTurnStarted &&
    latestTurnStarted.sequence > sessionEvent.sequence &&
    (!latestTurnCompleted ||
      latestTurnStarted.sequence > latestTurnCompleted.sequence)
  ) {
    sessionStatus = "active";
  } else {
    sessionStatus = "idle";
  }

  return {
    id:
      typeof sessionEvent?.payload?.providerSessionId === "string"
        ? sessionEvent.payload.providerSessionId
        : null,
    provider:
      typeof sessionEvent?.payload?.provider === "string"
        ? sessionEvent.payload.provider
        : null,
    status: sessionStatus,
    latestActivitySequence: latestActivity?.sequence ?? null,
    latestActivityType: latestActivity?.type ?? null,
  };
}

function generalDimensionSignature(report) {
  return JSON.stringify(
    report.generalReport?.dimensions.map(({ dimensionId, weight }) => [
      dimensionId,
      weight,
    ]) ?? [],
  );
}

export function buildGeneralAuditHistory(currentReport, reports) {
  if (!currentReport.generalReport) {
    return { compatible: [], excluded: [] };
  }

  const currentRepository = currentReport.run.repositoryIdentity;
  const currentRubric = currentReport.run.rubricVersion;
  const currentSchema = currentReport.generalReport.schemaVersion;
  const currentDimensions = generalDimensionSignature(currentReport);
  const compatible = [];
  const excluded = [];

  for (const report of reports) {
    if (
      report.run.repositoryIdentity !== currentRepository ||
      report.run.runConditions?.auditMode !== "general" ||
      !report.generalReport
    ) {
      continue;
    }

    const reasons = [];
    if (report.run.rubricVersion !== currentRubric) {
      reasons.push("rubric version differs");
    }
    if (report.generalReport.schemaVersion !== currentSchema) {
      reasons.push("report schema differs");
    }
    if (generalDimensionSignature(report) !== currentDimensions) {
      reasons.push("dimension definitions differ");
    }

    const point = {
      runId: report.run.id,
      commitSha: report.run.commitSha,
      auditedAt:
        report.run.finishedAt ??
        report.run.createdAt ??
        report.generalReport.findings.at(-1)?.currentRevision.provenance
          .occurredAt ??
        null,
      rubricVersion: report.run.rubricVersion,
      reportSchemaVersion: report.generalReport.schemaVersion,
      status: generalRunStatus(report.generalReport, report.run.status),
      partial: !report.generalReport.completeness.reportComplete,
      dimensions: report.generalReport.dimensions.map((dimension) => ({
        dimensionId: dimension.dimensionId,
        score:
          dimension.assessmentState === "assessed" ? dimension.score : null,
        assessmentState: dimension.assessmentState,
        evidenceCoverage: {
          state: dimension.evidenceCoverage.state,
          distinctCitationCount:
            dimension.evidenceCoverage.distinctCitationCount,
          requirementSatisfied:
            dimension.evidenceCoverage.requirementSatisfied,
        },
      })),
    };

    if (reasons.length === 0) {
      compatible.push(point);
    } else {
      excluded.push({
        runId: point.runId,
        commitSha: point.commitSha,
        auditedAt: point.auditedAt,
        reasons,
      });
    }
  }

  const byDate = (left, right) =>
    String(left.auditedAt ?? "").localeCompare(String(right.auditedAt ?? ""));
  compatible.sort(byDate);
  excluded.sort(byDate);
  return { compatible, excluded };
}

export function projectGeneralAuditSnapshot({
  report,
  participantSnapshots,
  status,
  historyReports,
}) {
  if (!report.generalReport) return null;
  const auditor = report.run.participants.find(
    (participant) => participant.role === "auditor",
  );
  const auditorSnapshot = participantSnapshots.find(
    (participant) => participant.role === "auditor",
  );

  return {
    ...report.generalReport,
    status,
    auditor: auditor
      ? {
          id: auditor.id ?? auditor.role,
          role: "auditor",
          provider: auditor.provider,
          model: auditor.model,
          status: auditorSnapshot?.status ?? "Not run",
          tokens: auditorSnapshot?.tokens ?? null,
          tokenUsage: auditorSnapshot?.tokenUsage ?? null,
          tokenSource: auditorSnapshot?.tokenSource ?? null,
        }
      : null,
    providerSession: generalProviderSession(report.events, status),
    observationChannel: generalAuditObservationChannel(report.events, status),
    latestCheckpointSequence: report.generalReport.generatedFromSequence,
    reportComplete: report.generalReport.completeness.reportComplete,
    history: buildGeneralAuditHistory(report, historyReports),
  };
}
