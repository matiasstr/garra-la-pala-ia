import type { BridgeErrorCode, BridgeResponse } from './protocol';

export class BridgeError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string) { super(message); }
}

export function failure(error: unknown): Extract<BridgeResponse, { ok: false }> {
  if (error instanceof BridgeError) return { ok: false, code: error.code, error: error.message };
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'ENOENT') return { ok: false, code: 'NOT_INSTALLED', error: 'No se encontró Codex. Instalalo y volvé a registrar el puente.' };
  if (/usage[_ -]?limit|rate[_ -]?limit|quota|too many requests|\b429\b/i.test(message)) {
    return { ok: false, code: 'USAGE_LIMIT', error: 'Codex se quedó sin cupo. Probá más tarde o usá otro proveedor.' };
  }
  if (/not[_ -]?logged[_ -]?in|not authenticated|authentication required|please (?:log|sign) in|login required|refresh[_ -]?token|\b401\b/i.test(message)) {
    return { ok: false, code: 'NOT_LOGGED_IN', error: 'Iniciá sesión con ChatGPT ejecutando codex login.' };
  }
  if (/timed? ?out|timeout/i.test(message)) return { ok: false, code: 'TIMEOUT', error: 'Codex superó el tiempo de espera.' };
  // No reenviar stderr: podría contener fragmentos del CV o credenciales.
  return { ok: false, code: 'UNKNOWN', error: 'No se pudo obtener una respuesta de Codex. Revisá la instalación y su versión.' };
}
