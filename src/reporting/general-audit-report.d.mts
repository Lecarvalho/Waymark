import type {
  AuditRun,
  TokenMeasurement,
} from "../domain/audit";
import type {
  DimensionEvidenceCoverage,
  GeneralAuditReadModel,
  GeneralAuditStatus,
  GeneralEvidenceCitation,
  GeneralEvidenceSource,
  GeneralFindingState,
  GeneralFindingLedgerEntry,
  GeneralRecommendation,
  GeneralPracticeAssessment,
  GeneralFrictionDisposition,
  GeneralSurfaceInspection,
  RepresentativeBehaviorPath,
  WaymarkDimensionId,
} from "../domain/general-audit.mjs";

export const GENERAL_REPORT_SCHEMA_VERSION: "general-report/1.1.0";
export const GENERAL_STRONG_SCORE_MINIMUM: 80;

export interface GeneralReportDimension {
  dimensionId: WaymarkDimensionId;
  weight: number;
  assessmentState: "not_assessed" | "in_progress" | "assessed";
  score: number | null;
  judgment: "strong" | "mixed" | "weak" | null;
  confidence: number | null;
  evidenceCoverage: DimensionEvidenceCoverage;
  supportingPositiveFindingIds: readonly string[];
  supportingFrictionFindingIds: readonly string[];
  limitations: readonly string[];
}

export interface GeneralEvidenceMatrixCell {
  source: GeneralEvidenceSource;
  status: "not_inspected" | "inspected_no_finding" | "cited";
  citedEvidenceCount: number;
  findingIds: readonly string[];
  citations: readonly GeneralEvidenceCitation[];
}

export type GeneralPathEvidenceState =
  | "verified_current"
  | "difficult_to_discover"
  | "pending"
  | "contradicted";

export interface GeneralBehaviorPathNodeView {
  nodeId: string;
  kind: "entry_point" | "owner" | "dependency" | "consumer" | "test";
  status: "known" | "unknown" | "uninspected";
  evidenceState: GeneralPathEvidenceState;
  label: string;
  reason: string | null;
  citations: readonly GeneralEvidenceCitation[];
}

export interface GeneralBehaviorPathView {
  pathId: string;
  name: string;
  observedAt: string;
  groups: readonly {
    kind: GeneralBehaviorPathNodeView["kind"];
    label: string;
    nodes: readonly GeneralBehaviorPathNodeView[];
  }[];
  edges: readonly {
    edgeId: string;
    fromKind: GeneralBehaviorPathNodeView["kind"];
    toKind: GeneralBehaviorPathNodeView["kind"];
    evidenceState: GeneralPathEvidenceState;
    citations: readonly GeneralEvidenceCitation[];
  }[];
}

export interface GeneralDiscoveryJourney {
  findingId: string;
  title: string;
  state: GeneralFindingState;
  locatedLate: boolean;
  measurementRevisionId: string | null;
  locatedAt: string;
  locatedByCitations: readonly GeneralEvidenceCitation[];
  amendmentReason: string | null;
  steps: readonly {
    kind: "searches" | "files_opened" | "dead_ends" | "target_located";
    label: string;
    value: number | null;
    valueLabel: string;
    availability: "measured" | "unavailable" | "recorded";
  }[];
  additionalMeasurements: {
    fileHops: number | null;
    commands: number | null;
    processedTokens: number | null;
    elapsedMs: number | null;
  };
}

export interface GeneralRecommendationPriority extends GeneralRecommendation {
  impact: {
    linkedFindingCount: number;
    affectedDimensionCount: number;
    affectedWeight: number;
    projectedScoreGain: null;
    label: "Evidence-linked scope";
  };
  effort: {
    status: "unavailable";
    label: "Not recorded";
    reason: string;
  };
}

export interface GeneralAuditReport {
  schemaVersion: typeof GENERAL_REPORT_SCHEMA_VERSION;
  mode: "general";
  authority: "auditor_assessed";
  run: {
    id: string;
    repositoryIdentity: string;
    commitSha: string;
    protocolVersion: string;
    rubricVersion: string;
    status: AuditRun["status"];
  };
  ledgerStatus: GeneralAuditStatus;
  generatedFromSequence: number;
  findings: readonly GeneralFindingLedgerEntry[];
  behaviorPaths: readonly RepresentativeBehaviorPath[];
  behaviorPathViews: readonly GeneralBehaviorPathView[];
  discoveryJourneys: readonly GeneralDiscoveryJourney[];
  surfaces: readonly GeneralSurfaceInspection[];
  evidenceCoverage: GeneralAuditReadModel["evidenceCoverage"];
  evidenceMatrix: Record<
    WaymarkDimensionId,
    Record<GeneralEvidenceSource, GeneralEvidenceMatrixCell>
  >;
  dimensions: readonly GeneralReportDimension[];
  practiceProfile: readonly GeneralPracticeAssessment[];
  recommendations: readonly GeneralRecommendation[];
  recommendationCoverage: {
    currentFrictionFindingCount: number;
    coveredFrictionFindingCount: number;
    deferredOrLimitedFindingCount: number;
    undisposedFrictionFindingIds: readonly string[];
    dispositions: readonly GeneralFrictionDisposition[];
    recommendationsWithEvidenceCount: number;
    orphanRecommendationIds: readonly string[];
  };
  recommendationPriorities: readonly GeneralRecommendationPriority[];
  tokens: {
    phase: "general_research";
    measurements: readonly TokenMeasurement[];
    measurementCount: number;
    bySource: Record<TokenMeasurement["source"], number>;
    totals: {
      inputTokens: number | null;
      outputTokens: number | null;
      cachedInputTokens: number | null;
      cacheCreationTokens: number | null;
      totalTokens: number;
    };
    hardLimitTokens: null;
    tokenEfficiencyScore: null;
  };
  costDiagnostics: {
    label: "Descriptive cost observation";
    tokenEfficiencyScore: null;
    processedTokensPerAcceptedCheckpoint: number | null;
    processedTokensPerFinding: number | null;
  } | null;
  completeness: {
    assessedDimensionCount: number;
    requiredDimensionCount: number;
    assessedWeight: number;
    requiredWeight: 100;
    coverageComplete: boolean;
    synthesisComplete: boolean;
    practiceProfileComplete: boolean;
    reportComplete: boolean;
  };
  weightedPoints: number;
  result: {
    type: "auditor_assessed";
    label: "Auditor-assessed";
    score: number;
    assessedWeight: 100;
  } | null;
  synthesis: GeneralAuditReadModel["synthesis"];
  interruption: GeneralAuditReadModel["interruption"];
  limitations: readonly string[];
}

export function assembleGeneralAuditReport(input: {
  run: AuditRun;
  ledger: GeneralAuditReadModel;
  tokens: readonly TokenMeasurement[];
}): GeneralAuditReport;
