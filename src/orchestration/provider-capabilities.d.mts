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
  schemaVersion: "1.0.0";
  auditModes: readonly {
    id: "general" | "task_specific";
    label: string;
    taskRequired: boolean;
  }[];
  providers: readonly ProviderCapability[];
  tokenBudgetDefaults: AuditTokenBudgets;
}

export function discoverProviderCapabilities(input?: {
  environment?: NodeJS.ProcessEnv;
  codexEntryPath?: string;
}): ProviderCapabilities;
