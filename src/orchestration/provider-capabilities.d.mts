import type { AuditTokenBudgets } from "./types";

export type ReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export interface ProviderModelCapability {
  id: string;
  label: string;
  reasoningEfforts: readonly ReasoningEffort[];
}

export interface ProviderCapability {
  id: string;
  adapterId: string;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  roles: readonly ("candidate" | "independent" | "orchestrator")[];
  models: readonly ProviderModelCapability[];
}

export interface ProviderCapabilities {
  schemaVersion: "1.2.0";
  auditModes: readonly {
    id: "general" | "task_specific" | "system_explanation";
    label: string;
    taskRequired: boolean;
    description: string;
    probeLabel: string | null;
    probePlaceholder: string | null;
  }[];
  providers: readonly ProviderCapability[];
  tokenBudgetDefaults: AuditTokenBudgets;
  tokenBudgetBasis: {
    readonly [Phase in keyof AuditTokenBudgets]: {
      readonly source: "historical_average" | "rubric_default";
      readonly sampleSize: number;
      readonly historicalAverageTokens: number | null;
      readonly cappedToRubricDefault: boolean;
      readonly usedForTarget: boolean;
      readonly minimumSampleSize: number;
    };
  };
}

export function discoverProviderCapabilities(input?: {
  environment?: NodeJS.ProcessEnv;
  codexEntryPath?: string;
  historicalTokenAverages?: Partial<
    Record<
      keyof AuditTokenBudgets,
      { averageTokens: number | null; sampleSize: number }
    >
  >;
}): ProviderCapabilities;
