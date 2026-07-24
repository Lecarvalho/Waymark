import type {
  AppendEventInput,
  CompleteRunWithAuthoritativeScoreInput,
  CreateRunInput,
  FinishRunInput,
  RecordVerificationInput,
  SubmitClaimInput,
  TokenMeasurementInput,
} from "../domain/audit";

export class ProtocolValidationError extends Error {
  code: "INVALID_INPUT";
  details?: unknown;
}

export interface ValidationDependencies {
  now(): string;
  createId(): string;
}

export function validateCreateRun(
  value: unknown,
  dependencies: ValidationDependencies,
): CreateRunInput;
export function validateAppendEvent(
  value: unknown,
  dependencies: ValidationDependencies,
): AppendEventInput;
export function validateSubmitClaim(
  value: unknown,
  dependencies: ValidationDependencies,
): SubmitClaimInput;
export function validateRecordVerification(
  value: unknown,
  dependencies: ValidationDependencies,
): RecordVerificationInput;
export function validateTokenMeasurement(
  value: unknown,
  dependencies: ValidationDependencies,
): TokenMeasurementInput;
export function validateFinishRun(
  value: unknown,
  dependencies: Pick<ValidationDependencies, "now">,
): FinishRunInput;
export function validateAuthoritativeCompletion(
  value: unknown,
  dependencies: Pick<ValidationDependencies, "now">,
): CompleteRunWithAuthoritativeScoreInput;
