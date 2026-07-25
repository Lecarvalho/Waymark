import type {
  ClaimCriticality,
  JsonObject,
  RunParticipantInput,
  TokenPhase,
  VerificationVerdict,
} from "../domain/audit";

export const AUDIT_STAGES = [
  "setup",
  "parallel_investigation",
  "cross_examination",
  "deterministic_verification",
  "scoring",
  "reporting",
] as const;

export type AuditStage = (typeof AUDIT_STAGES)[number];

export interface RepositoryTarget {
  path: string;
  identity: string;
  commitSha: string;
  readOnly: true;
}

export interface AuditExecutionPolicy {
  isolation: "fresh_process";
  sessionPersistence: "local_telemetry_log";
  contextPolicy: "assignment_only";
  measurementScope: "role_process_only";
}

export interface TokenBudget {
  targetTokens: number;
  hardLimitTokens: number;
}

export interface AuditTokenBudgets {
  candidate_navigation: TokenBudget;
  independent_validation: TokenBudget;
  orchestration: TokenBudget;
  deterministic_verification: TokenBudget;
  report_generation: TokenBudget;
}

export type AuditMode =
  | "general"
  | "task_specific"
  | "system_explanation";

export interface AuditAssignment {
  runId: string;
  role: "candidate" | "independent" | "orchestrator";
  participant: RunParticipantInput;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
  target: RepositoryTarget;
  auditMode: AuditMode;
  task: string;
  executionPolicy: AuditExecutionPolicy;
  tokenBudget: TokenBudget;
  shellCommandBudget?: number;
  constraints: readonly string[];
  expectedEvidence: readonly string[];
  context?: JsonObject;
}

export interface InvestigationFinding {
  kind: "navigation_fact";
  dimension:
    | "discoveryEfficiency"
    | "ownershipClarity"
    | "dependencyClarity"
    | "changeSurfaceRecall"
    | "verificationDiscoverability"
    | "instructionQuality";
  subject: string;
  assertion: string;
  friction: string;
  confidence: number;
  criticality: ClaimCriticality;
  practiceIds?: readonly ("01" | "02" | "03" | "04" | "05" | "06" | "07")[];
  citations: readonly {
    path: string;
    startLine?: number;
    endLine?: number;
    symbol?: string;
  }[];
}

export interface Challenge {
  claimId: string;
  challenger: string;
  reason: string;
  citations: InvestigationFinding["citations"];
}

export interface DeterministicVerdict {
  claimId: string;
  method: "static_inspection" | "executable_probe" | "none";
  verdict: VerificationVerdict;
  citationStatus: "valid" | "invalid" | "missing";
  independentAssessment: "agree" | "disagree" | "not_checked";
  evidence: JsonObject;
}

export interface ActorTokenRecord {
  actor: string;
  phase: TokenPhase;
  source: "provider_reported" | "measured" | "estimated";
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
}

export interface OrchestrationCapabilities {
  parallelAgents: boolean;
  independentResearcher: RunParticipantInput | null;
}
