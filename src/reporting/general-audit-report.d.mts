import type {
  AuditRun,
  TokenMeasurement,
} from "../domain/audit";
import type {
  DimensionEvidenceCoverage,
  GeneralAuditReadModel,
  GeneralAuditStatus,
  GeneralFindingLedgerEntry,
  GeneralRecommendation,
  GeneralSurfaceInspection,
  RepresentativeBehaviorPath,
  WaymarkDimensionId,
} from "../domain/general-audit.mjs";

export const GENERAL_REPORT_SCHEMA_VERSION: "general-report/1.0.0";
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
  surfaces: readonly GeneralSurfaceInspection[];
  evidenceCoverage: GeneralAuditReadModel["evidenceCoverage"];
  dimensions: readonly GeneralReportDimension[];
  recommendations: readonly GeneralRecommendation[];
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
  completeness: {
    assessedDimensionCount: number;
    requiredDimensionCount: number;
    assessedWeight: number;
    requiredWeight: 100;
    coverageComplete: boolean;
    synthesisComplete: boolean;
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
