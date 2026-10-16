export type ProviderErrorCode =
  /** Sin cupo / tokens agotados / 429. El router pasa al siguiente proveedor. */
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'NETWORK'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  /** Respondió, pero no sirve (vacío, JSON inválido, sin respuestas). */
  | 'BAD_RESPONSE'
  /** El proveedor no está instalado o configurado (ej. puente de Codex). */
  | 'NOT_AVAILABLE'
  | 'UNKNOWN';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly code: ProviderErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function errorCodeFromStatus(status: number): ProviderErrorCode {
  if (status === 429 || status === 402) return 'RATE_LIMIT';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 408) return 'TIMEOUT';
  if (status >= 400 && status < 500) return 'BAD_REQUEST';
  return 'UNKNOWN';
}
