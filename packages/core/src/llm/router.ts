import type { ChatPrompt, LlmProvider } from '../types';
import { ProviderError } from './errors';

export interface Attempt {
  providerId: string;
  label: string;
  ok: boolean;
  error?: string;
  code?: string;
  ms: number;
}

export interface FallbackResult {
  text: string;
  providerId: string;
  label: string;
  attempts: Attempt[];
}

export class AllProvidersFailedError extends Error {
  constructor(readonly attempts: Attempt[]) {
    super(
      attempts.length
        ? `Ningún proveedor pudo responder: ${attempts.map((a) => `${a.label} (${a.error})`).join('; ')}`
        : 'No hay proveedores configurados.',
    );
    this.name = 'AllProvidersFailedError';
  }
}

export interface FallbackOptions {
  /** Si devuelve un texto, la respuesta no sirve y se prueba el siguiente proveedor. */
  validate?: (text: string) => string | undefined;
  timeoutMs?: number;
  /** Timeout propio de un proveedor (ej. Codex local, que razona antes de responder). */
  timeoutFor?: (provider: LlmProvider) => number | undefined;
  signal?: AbortSignal;
}

/** Corta la espera cuando se aborta, aunque el proveedor ignore la señal. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Prueba los proveedores en orden hasta que uno responda algo válido.
 * Así, si una API gratis se queda sin cupo (429), sigue con la próxima.
 */
export async function completeWithFallback(
  providers: LlmProvider[],
  prompt: ChatPrompt,
  opts: FallbackOptions = {},
): Promise<FallbackResult> {
  const attempts: Attempt[] = [];
  for (const provider of providers) {
    if (opts.signal?.aborted) break;
    const started = Date.now();
    const timeout = opts.timeoutFor?.(provider) ?? opts.timeoutMs ?? 90_000;
    const signals = [AbortSignal.timeout(timeout), opts.signal].filter((s): s is AbortSignal => !!s);
    const signal = AbortSignal.any(signals);
    try {
      const text = await abortable(provider.complete(prompt, signal), signal);
      const invalid = opts.validate?.(text);
      if (invalid) throw new ProviderError(invalid, provider.id, 'BAD_RESPONSE');
      attempts.push({ providerId: provider.id, label: provider.label, ok: true, ms: Date.now() - started });
      return { text, providerId: provider.id, label: provider.label, attempts };
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
      attempts.push({
        providerId: provider.id,
        label: provider.label,
        ok: false,
        error: isTimeout ? 'tardó demasiado' : err instanceof Error ? err.message : String(err),
        code: err instanceof ProviderError ? err.code : isTimeout ? 'TIMEOUT' : 'UNKNOWN',
        ms: Date.now() - started,
      });
    }
  }
  throw new AllProvidersFailedError(attempts);
}
