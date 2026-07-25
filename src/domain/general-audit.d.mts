export const GENERAL_AUDIT_EVENT_TYPES: readonly [
  "general.audit.started",
  "general.surface.inspected",
  "general.behavior_path.recorded",
  "general.finding.recorded",
  "general.finding.revised",
  "general.dimension.progress",
  "general.dimension.assessed",
  "general.recommendation.recorded",
  "general.synthesis.completed",
  "general.audit.interrupted",
];

export const GENERAL_FINDING_STATES: readonly [
  "provisional",
  "confirmed",
  "located_late",
  "reframed",
  "contradicted",
  "retracted",
  "unresolved",
];

export const GENERAL_FINDING_SIGNALS: readonly [
  "positive",
  "friction",
  "unknown",
];

export const GENERAL_EVIDENCE_SOURCES: readonly [
  "production_code",
  "test",
  "configuration",
  "workflow",
  "documentation",
  "instruction",
  "generated",
  "external",
];

export const WAYMARK_DIMENSION_IDS: readonly [
  "discoveryEfficiency",
  "ownershipClarity",
  "dependencyClarity",
  "changeSurfaceRecall",
  "verificationDiscoverability",
  "instructionQuality",
];

export const PRACTICE_GUIDE_IDS: readonly [
  "organizeAroundBehavior",
  "explicitDependencyDirection",
  "conceptOwningNames",
  "canonicalWorkflow",
  "proximateInstructions",
  "testsMirrorBehavior",
  "separateGeneratedExternal",
];

export const GENERAL_AUDIT_SURFACES: readonly [
  "production_code",
  "tests",
  "dependency_paths",
  "consumers",
  "configuration",
  "workflows",
  "generated_external",
  "documentation",
  "instructions",
];

export const GENERAL_DIMENSION_WEIGHTS: Readonly<
  Record<WaymarkDimensionId, number>
>;

export const GENERAL_DIMENSION_EVIDENCE_REQUIREMENTS: Readonly<
  Record<
    WaymarkDimensionId,
    {
      requiresCodeOrTestEvidence: boolean;
    }
  >
>;

export type GeneralAuditEventType = (typeof GENERAL_AUDIT_EVENT_TYPES)[number];
export type GeneralFindingState = (typeof GENERAL_FINDING_STATES)[number];
export type GeneralFindingSignal = (typeof GENERAL_FINDING_SIGNALS)[number];
export type GeneralEvidenceSource = (typeof GENERAL_EVIDENCE_SOURCES)[number];
export type WaymarkDimensionId = (typeof WAYMARK_DIMENSION_IDS)[number];
export type PracticeGuideId = (typeof PRACTICE_GUIDE_IDS)[number];
export type GeneralAuditSurface = (typeof GENERAL_AUDIT_SURFACES)[number];
export type GeneralAuditStatus =
  | "not_started"
  | "active"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type DimensionAssessmentState =
  | "not_assessed"
  | "in_progress"
  | "assessed";

export interface GeneralEvidenceCitation {
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  source: GeneralEvidenceSource;
}

export interface NavigationCostObservation {
  searches: number | null;
  filesOpened: number | null;
  fileHops: number | null;
  deadEnds: number | null;
  commands: number | null;
  processedTokens: number | null;
  elapsedMs: number | null;
}

export interface GeneralRevisionProvenance {
  previousRevisionId: string | null;
  amendmentReason: string | null;
  actor: string;
  occurredAt: string;
  causedByCitations: readonly GeneralEvidenceCitation[];
}

export interface GeneralFindingRevision {
  revisionId: string;
  findingId: string;
  revisionNumber: number;
  state: GeneralFindingState;
  signal: GeneralFindingSignal;
  title: string;
  conclusion: string;
  dimensionIds: readonly WaymarkDimensionId[];
  practiceGuideIds: readonly PracticeGuideId[];
  citations: readonly GeneralEvidenceCitation[];
  navigationCost: NavigationCostObservation | null;
  provenance: GeneralRevisionProvenance;
}

export interface GeneralFindingLedgerEntry {
  findingId: string;
  currentRevision: GeneralFindingRevision;
  revisions: readonly GeneralFindingRevision[];
  navigationCostHistory: readonly {
    revisionId: string;
    observation: NavigationCostObservation;
  }[];
}

export type BehaviorPathNode =
  | {
      status: "known";
      label: string;
      citations: readonly GeneralEvidenceCitation[];
    }
  | {
      status: "unknown";
      label: string;
      reason: string;
      citations: readonly [];
    };

export interface RepresentativeBehaviorPath {
  pathId: string;
  name: string;
  entryPoint: BehaviorPathNode;
  owner: BehaviorPathNode;
  dependencies: readonly BehaviorPathNode[];
  consumers: readonly BehaviorPathNode[];
  tests: readonly BehaviorPathNode[];
  observedAt: string;
  actor: string;
}

export interface DimensionEvidenceCoverage {
  bySource: Record<GeneralEvidenceSource, number>;
  distinctCitationCount: number;
  codeOrTestCitationCount: number;
  requiresCodeOrTestEvidence: boolean;
  requirementSatisfied: boolean;
  state: "adequate" | "insufficient";
}

export interface GeneralDimensionAssessment {
  dimensionId: WaymarkDimensionId;
  weight: number;
  assessmentState: DimensionAssessmentState;
  score: number | null;
  confidence: number | null;
  evidenceCoverage: DimensionEvidenceCoverage;
  supportingPositiveFindingIds: readonly string[];
  supportingFrictionFindingIds: readonly string[];
  limitations: readonly string[];
}

export interface GeneralRecommendation {
  recommendationId: string;
  title: string;
  rationale: string;
  findingIds: readonly string[];
  dimensionIds: readonly WaymarkDimensionId[];
  recordedAt: string;
  actor: string;
}

export interface GeneralSurfaceInspection {
  surface: GeneralAuditSurface;
  summary: string;
  citations: readonly GeneralEvidenceCitation[];
  inspectedAt: string;
  actor: string;
}

export interface GeneralAuditEventBase<
  TType extends GeneralAuditEventType,
  TPayload,
> {
  id: string;
  runId: string;
  sequence: number;
  actor: string;
  type: TType;
  occurredAt: string;
  payload: TPayload;
}

export type GeneralAuditStartedEvent = GeneralAuditEventBase<
  "general.audit.started",
  {
    repositoryIdentity: string;
    commitSha: string;
    protocolVersion: string;
  }
>;

export type GeneralSurfaceInspectedEvent = GeneralAuditEventBase<
  "general.surface.inspected",
  {
    surface: GeneralAuditSurface;
    summary: string;
    citations: readonly GeneralEvidenceCitation[];
  }
>;

export type GeneralBehaviorPathRecordedEvent = GeneralAuditEventBase<
  "general.behavior_path.recorded",
  Omit<RepresentativeBehaviorPath, "observedAt" | "actor">
>;

export type GeneralFindingRecordedEvent = GeneralAuditEventBase<
  "general.finding.recorded",
  { revision: GeneralFindingRevision }
>;

export type GeneralFindingRevisedEvent = GeneralAuditEventBase<
  "general.finding.revised",
  { revision: GeneralFindingRevision }
>;

export interface GeneralDimensionEventPayload {
  dimensionId: WaymarkDimensionId;
  confidence: number;
  supportingPositiveFindingIds: readonly string[];
  supportingFrictionFindingIds: readonly string[];
  limitations: readonly string[];
}

export type GeneralDimensionProgressEvent = GeneralAuditEventBase<
  "general.dimension.progress",
  GeneralDimensionEventPayload
>;

export type GeneralDimensionAssessedEvent = GeneralAuditEventBase<
  "general.dimension.assessed",
  GeneralDimensionEventPayload & { score: number }
>;

export type GeneralRecommendationRecordedEvent = GeneralAuditEventBase<
  "general.recommendation.recorded",
  Omit<GeneralRecommendation, "recordedAt" | "actor">
>;

export type GeneralSynthesisCompletedEvent = GeneralAuditEventBase<
  "general.synthesis.completed",
  {
    outcome: "completed" | "partial";
    summary: string;
    limitations: readonly string[];
  }
>;

export type GeneralAuditInterruptedEvent = GeneralAuditEventBase<
  "general.audit.interrupted",
  {
    outcome: "partial" | "failed" | "cancelled";
    reason: string;
  }
>;

export type GeneralAuditEvent =
  | GeneralAuditStartedEvent
  | GeneralSurfaceInspectedEvent
  | GeneralBehaviorPathRecordedEvent
  | GeneralFindingRecordedEvent
  | GeneralFindingRevisedEvent
  | GeneralDimensionProgressEvent
  | GeneralDimensionAssessedEvent
  | GeneralRecommendationRecordedEvent
  | GeneralSynthesisCompletedEvent
  | GeneralAuditInterruptedEvent;

export interface GeneralAuditReadModel {
  runId: string | null;
  status: GeneralAuditStatus;
  repositoryIdentity: string | null;
  commitSha: string | null;
  protocolVersion: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastSequence: number;
  findings: Record<string, GeneralFindingLedgerEntry>;
  findingOrder: readonly string[];
  behaviorPaths: Record<string, RepresentativeBehaviorPath>;
  behaviorPathOrder: readonly string[];
  surfaces: readonly GeneralSurfaceInspection[];
  dimensions: Record<WaymarkDimensionId, GeneralDimensionAssessment>;
  evidenceCoverage: Record<WaymarkDimensionId, DimensionEvidenceCoverage>;
  recommendations: readonly GeneralRecommendation[];
  assessedWeight: number;
  weightedPoints: number;
  auditorAssessedResult: number | null;
  synthesis: {
    summary: string;
    limitations: readonly string[];
  } | null;
  interruption: {
    reason: string;
    outcome: "partial" | "failed" | "cancelled";
  } | null;
  partialReport: {
    available: boolean;
    usableCitationCount: number;
    findingCount: number;
    revisionCount: number;
  };
}

export class GeneralAuditProjectionError extends Error {
  code: string;
  eventId: string | null;
}

/**
 * Folds an ordered stream of normalized semantic checkpoints. Raw provider
 * telemetry is intentionally outside this contract.
 */
export function projectGeneralAudit(
  events: readonly GeneralAuditEvent[],
): GeneralAuditReadModel;
