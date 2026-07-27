import type { JsonObject } from "../domain/audit";
import type { GeneralAuditEventType } from "../domain/general-audit.mjs";
import type { AuditStore } from "../persistence/index.mjs";

export class CheckpointTransportError extends Error {
  code: string;
  statusCode: number;
}

export interface GeneralCheckpointEnvelope {
  runId: string;
  actor: string;
  providerSessionId?: string;
  idempotencyKey: string;
  type: GeneralAuditEventType;
  payload: JsonObject;
  occurredAt?: string;
}

export interface CheckpointAcknowledgement {
  status: "acknowledged";
  runId: string;
  actor: string;
  providerSessionId: string;
  idempotencyKey: string;
  eventId: string;
  sequence: number;
}

export interface GeneralCheckpointTransport {
  runId: string;
  auditorId: string;
  endpoint: string;
  authorization: string;
  bindProviderSession(providerSessionId: string): string;
  rotateProviderSession(providerSessionId: string): string;
  persist(input: GeneralCheckpointEnvelope): CheckpointAcknowledgement;
  close(): Promise<void>;
}

export function startGeneralCheckpointTransport(input: {
  store: AuditStore;
  runId: string;
  auditorId: string;
  provider: string;
  host?: string;
}): Promise<GeneralCheckpointTransport>;
