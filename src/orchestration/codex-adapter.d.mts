import type {
  NormalizedProviderEvent,
  ProcessProviderAdapter,
  ProviderUsage,
} from "./process-runner.mjs";

export function resolveCodexLauncher(input?: {
  entryPath?: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
}): { command: string; prefixArguments: string[] };

export function extractCodexUsage(event: unknown): ProviderUsage | null;
export function extractCodexFinalOutput(event: unknown): unknown;
export function normalizeCodexEvent(
  event: unknown,
): NormalizedProviderEvent | null;

export function createCodexProcessAdapter(input?: {
  entryPath?: string;
  outputSchemaPath?: string;
  environment?: NodeJS.ProcessEnv;
}): ProcessProviderAdapter;
