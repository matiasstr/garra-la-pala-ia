export const HOST_NAME = 'com.garra.codex_bridge';
export const VERSION = '0.1.0';
// Límite deliberadamente menor que el máximo entrante de Chrome.
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 120_000;
export const MAX_TIMEOUT_MS = 300_000;

export type BridgeErrorCode = 'NOT_INSTALLED' | 'NOT_LOGGED_IN' | 'USAGE_LIMIT' | 'TIMEOUT' | 'UNKNOWN';
export type BridgeResponse =
  | { ok: true; version: string; codexVersion: string }
  | { ok: true; text: string }
  | { ok: false; code: BridgeErrorCode; error: string };
export interface CompleteRequest {
  type: 'complete';
  system: string;
  user: string;
  model?: string;
  timeoutMs?: number;
}
export type BridgeRequest = { type: 'ping' } | CompleteRequest;

export function parseRequest(value: unknown): BridgeRequest {
  if (!value || typeof value !== 'object') throw new Error('Solicitud inválida.');
  const request = value as Record<string, unknown>;
  if (request.type === 'ping') return { type: 'ping' };
  if (request.type !== 'complete' || typeof request.system !== 'string' ||
      typeof request.user !== 'string' || !request.user.trim()) {
    throw new Error('La solicitud debe incluir system y user.');
  }
  if (request.model !== undefined && (typeof request.model !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(request.model))) {
    throw new Error('Modelo inválido.');
  }
  if (request.timeoutMs !== undefined && (typeof request.timeoutMs !== 'number' ||
      !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > MAX_TIMEOUT_MS)) {
    throw new Error('El tiempo de espera debe estar entre 1 y 300000 ms.');
  }
  return {
    type: 'complete', system: request.system, user: request.user,
    model: request.model as string | undefined,
    timeoutMs: request.timeoutMs as number | undefined,
  };
}

export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (!body.length || body.length > MAX_MESSAGE_BYTES) throw new Error('Mensaje demasiado grande.');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

/** Tolera headers, cuerpos y caracteres UTF-8 partidos entre lecturas. */
export class MessageDecoder {
  private pending = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.pending = Buffer.concat([this.pending, chunk]);
    const messages: unknown[] = [];
    while (this.pending.length >= 4) {
      const length = this.pending.readUInt32LE(0);
      if (!length || length > MAX_MESSAGE_BYTES) throw new Error('Longitud de mensaje inválida.');
      if (this.pending.length < 4 + length) break;
      const body = this.pending.subarray(4, 4 + length);
      messages.push(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as unknown);
      this.pending = this.pending.subarray(4 + length);
    }
    return messages;
  }
  finish(): void {
    if (this.pending.length) throw new Error('Mensaje incompleto.');
  }
}
