export const RUN_STATUSES = [
  "active",
  "completed",
  "failed",
  "cancelled",
] as const;

export const PARTICIPANT_ROLES = [
  "orchestrator",
  "candidate",
  "independent",
  "verifier",
  "reporter",
] as const;

export const CLAIM_CRITICALITIES = [
  "critical",
  "high",
  "medium",
  "low",
] as const;

export const VERIFICATION_VERDICTS = [
  "verified",
  "contradicted",
  "unverified",
] as const;

export const VERIFICATION_METHODS = [
  "static_inspection",
  "executable_probe",
  "independent_model",
  "none",
] as const;

export const TOKEN_PHASES = [
  "candidate_navigation",
  "independent_validation",
  "orchestration",
  "deterministic_verification",
  "report_generation",
] as const;

export const TOKEN_SOURCES = [
  "provider_reported",
  "measured",
  "estimated",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
export type ClaimCriticality = (typeof CLAIM_CRITICALITIES)[number];
export type VerificationVerdict = (typeof VERIFICATION_VERDICTS)[number];
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export type TokenPhase = (typeof TOKEN_PHASES)[number];
export type TokenSource = (typeof TOKEN_SOURCES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface RunParticipantInput {
  id?: string;
  role: ParticipantRole;
  provider: string;
  model: string;
  modelVersion?: string | null;
}

export interface CreateRunInput {
  id?: string;
  targetRepositoryPath: string;
  repositoryIdentity: string;
  commitSha: string;
  name?: string | null;
  task: string;
  participants: RunParticipantInput[];
  toolPolicy: JsonObject;
  runConditions: JsonObject;
  protocolVersion: string;
  rubricVersion: string;
  createdAt?: string;
}

export interface AuditRun {
  id: string;
  targetRepositoryPath: string;
  repositoryIdentity: string;
  commitSha: string;
  name: string | null;
  task: string;
  toolPolicy: JsonObject;
  runConditions: JsonObject;
  protocolVersion: string;
  rubricVersion: string;
  status: RunStatus;
  createdAt: string;
  finishedAt: string | null;
  participants: RunParticipant[];
}

export interface RunParticipant extends RunParticipantInput {
  id: string;
  runId: string;
}

export interface TokenMeasurementInput {
  id?: string;
  runId: string;
  eventId?: string;
  actor: string;
  phase: TokenPhase;
  source: TokenSource;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheCreationTokens?: number;
  totalTokens?: number;
  measuredAt?: string;
}

export interface TokenMeasurement {
  id: string;
  runId: string;
  eventId: string | null;
  actor: string;
  phase: TokenPhase;
  source: TokenSource;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  cacheCreationTokens: number | null;
  totalTokens: number;
  measuredAt: string;
}

export interface AppendEventInput {
  id?: string;
  runId: string;
  actor: string;
  type: string;
  payload: JsonObject;
  occurredAt?: string;
  tokenMeasurement?: Omit<TokenMeasurementInput, "runId" | "eventId">;
}

export interface AuditEvent {
  id: string;
  runId: string;
  sequence: number;
  actor: string;
  type: string;
  payload: JsonObject;
  occurredAt: string;
}

export interface Citation {
  path: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  evidenceHash?: string;
}

export interface SubmitClaimInput {
  id?: string;
  runId: string;
  subject: string;
  assertion: string;
  claimant: string;
  citations: Citation[];
  confidence: number;
  criticality: ClaimCriticality;
  createdAt?: string;
}

export interface EvidenceClaim {
  id: string;
  runId: string;
  subject: string;
  assertion: string;
  claimant: string;
  citations: Citation[];
  confidence: number;
  criticality: ClaimCriticality;
  createdAt: string;
}

export interface RecordVerificationInput {
  id?: string;
  runId: string;
  claimId: string;
  verifier: string;
  method: VerificationMethod;
  verdict: VerificationVerdict;
  evidence: JsonObject;
  createdAt?: string;
}

export interface VerificationRecord {
  id: string;
  runId: string;
  sequence: number;
  claimId: string;
  verifier: string;
  method: VerificationMethod;
  verdict: VerificationVerdict;
  evidence: JsonObject;
  createdAt: string;
}

export interface FinishRunInput {
  status: Exclude<RunStatus, "active">;
  summary?: JsonObject;
  finishedAt?: string;
}

export interface CompleteRunWithAuthoritativeScoreInput {
  score: JsonObject;
  summary?: JsonObject;
  finishedAt?: string;
}

export interface AuditSnapshot {
  run: AuditRun;
  events: AuditEvent[];
  claims: EvidenceClaim[];
  verifications: VerificationRecord[];
  tokens: TokenMeasurement[];
}

export interface AuditReport extends AuditSnapshot {
  aggregates: {
    eventCount: number;
    claimCount: number;
    verificationCount: number;
    verifiedClaimCount: number;
    contradictedClaimCount: number;
    unverifiedClaimCount: number;
    claimsWithoutVerdictCount: number;
    verificationCoverage: number;
    totalTokens: number;
    tokensByPhase: Record<TokenPhase, number>;
    tokensBySource: Record<TokenSource, number>;
  };
}
