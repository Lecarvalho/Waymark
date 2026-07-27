import type {
  AppendEventInput,
  AuditEvent,
  AuditReport,
  AuditRun,
  AuditSnapshot,
  CompleteRunWithAuthoritativeScoreInput,
  CreateRunInput,
  EvidenceClaim,
  FinishRunInput,
  RecordVerificationInput,
  SubmitClaimInput,
  TokenMeasurement,
  TokenMeasurementInput,
  VerificationRecord,
} from "../domain/audit";
import type { TokenPhase } from "../domain/audit";
import type {
  GeneralAuditEventType,
  GeneralAuditReadModel,
} from "../domain/general-audit.mjs";

export const SCHEMA_VERSION: number;
export const DEFAULT_DATABASE_PATH: string;

export class AuditStoreError extends Error {
  code: string;
  details?: unknown;
}

export interface AuditStoreOptions {
  databasePath?: string;
  now?: () => string;
  createId?: () => string;
}

export interface GeneralCheckpointInput {
  id?: string;
  runId: string;
  actor: string;
  type?: GeneralAuditEventType;
  payload: Record<string, unknown>;
  occurredAt?: string;
  idempotencyKey: string;
}

export class AuditStore {
  constructor(options?: AuditStoreOptions);
  readonly databasePath: string;
  readonly schemaVersion: number;
  close(): void;
  createRun(input: CreateRunInput): AuditRun;
  listRuns(options?: { status?: string; limit?: number }): AuditRun[];
  readCompletedTokenAverages(options?: { auditMode?: string }): Record<
    TokenPhase,
    { averageTokens: number | null; sampleSize: number }
  >;
  readRun(runId: string): AuditRun;
  appendEvent(input: AppendEventInput): AuditEvent;
  appendGeneralCheckpoint(input: GeneralCheckpointInput): AuditEvent;
  appendGeneralCheckpointDiagnostic(input: AppendEventInput): AuditEvent;
  startGeneralAudit(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralSurface(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralBehaviorPath(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralFinding(input: GeneralCheckpointInput): AuditEvent;
  reviseGeneralFinding(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralDimensionProgress(input: GeneralCheckpointInput): AuditEvent;
  assessGeneralDimension(input: GeneralCheckpointInput): AuditEvent;
  assessGeneralPractice(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralRecommendation(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralFrictionDisposition(input: GeneralCheckpointInput): AuditEvent;
  recordGeneralContinuation(input: GeneralCheckpointInput): AuditEvent;
  completeGeneralSynthesis(input: GeneralCheckpointInput): AuditEvent;
  interruptGeneralAudit(input: GeneralCheckpointInput): AuditEvent;
  appendReportPracticeProfile(
    runId: string,
    input: {
      schemaVersion: string;
      scope: "general_repository";
      suite?: unknown;
      items: unknown[];
      createdAt?: string;
    },
  ): AuditEvent;
  readEvents(
    runId: string,
    options?: { afterSequence?: number; limit?: number },
  ): AuditEvent[];
  submitClaim(input: SubmitClaimInput): EvidenceClaim;
  recordVerification(input: RecordVerificationInput): VerificationRecord;
  recordTokenMeasurement(input: TokenMeasurementInput): TokenMeasurement;
  finishRun(
    runId: string,
    input: FinishRunInput,
  ): { run: AuditRun; event: AuditEvent };
  completeRunWithAuthoritativeScore(
    runId: string,
    input: CompleteRunWithAuthoritativeScoreInput,
  ): { run: AuditRun; event: AuditEvent; scoreEvent: AuditEvent };
  readSnapshot(runId: string): AuditSnapshot;
  readReport(runId: string): AuditReport & {
    generalAudit: GeneralAuditReadModel | null;
  };
}

export function resolveDatabasePath(databasePath?: string): string;
export function bootstrapDatabase(database: unknown): void;
