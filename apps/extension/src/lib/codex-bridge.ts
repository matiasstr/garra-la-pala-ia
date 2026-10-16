import { ProviderError } from '@garra/core';
import type { ChatPrompt, LlmProvider, ProviderErrorCode } from '@garra/core';

export const CODEX_HOST_NAME = 'com.garra.codex_bridge';
export const CODEX_PROVIDER_ID = 'codex-local';
const DEFAULT_TIMEOUT_MS = 120_000;
/** El host no acepta más de 5 minutos. */
const MAX_TIMEOUT_MS = 300_000;

export interface CodexBridgeOptions {
  /** Modelo de Codex. Vacío o sin definir = el que tenga configurado Codex. */
  model?: string;
  /** Tiempo máximo para que Codex responda (lo corta el host). */
  timeoutMs?: number;
}

function bridgeErrorCode(code: unknown): ProviderErrorCode {
  if (code === 'USAGE_LIMIT') return 'RATE_LIMIT';
  if (code === 'NOT_INSTALLED' || code === 'NOT_LOGGED_IN') return 'NOT_AVAILABLE';
  if (code === 'TIMEOUT') return 'TIMEOUT';
  return 'UNKNOWN';
}

/** Invocar desde el service worker o una página de la extensión, nunca desde un content script. */
export function createCodexBridgeProvider(options: CodexBridgeOptions = {}): LlmProvider {
  const timeoutMs = Math.min(Math.max(Math.round(options.timeoutMs ?? DEFAULT_TIMEOUT_MS), 1_000), MAX_TIMEOUT_MS);
  const model = options.model?.trim() || undefined;
  return {
    id: CODEX_PROVIDER_ID,
    label: 'Codex (local)',
    complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Solicitud cancelada.', 'AbortError')); return; }
        if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendNativeMessage !== 'function') {
          reject(new ProviderError('El puente de Codex no está disponible en este contexto.', CODEX_PROVIDER_ID, 'NOT_AVAILABLE'));
          return;
        }
        let settled = false;
        const finish = (error?: unknown, text?: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(text!);
        };
        const abort = () => finish(new DOMException('Solicitud cancelada.', 'AbortError'));
        // Margen para arranque del host y limpieza de sus archivos temporales.
        const timer = setTimeout(() => finish(new ProviderError('Codex superó el tiempo de espera.', CODEX_PROVIDER_ID, 'TIMEOUT')), timeoutMs + 5_000);
        signal?.addEventListener('abort', abort, { once: true });
        try {
          chrome.runtime.sendNativeMessage(CODEX_HOST_NAME,
            { type: 'complete', system: prompt.system, user: prompt.user, timeoutMs, ...(model ? { model } : {}) },
            (value: unknown) => {
              // Leer lastError incluso si la persona canceló antes de llegar la respuesta.
              const nativeError = chrome.runtime.lastError;
              if (settled) return;
              if (nativeError) {
                finish(new ProviderError('No se pudo conectar con el puente de Codex. Revisá su instalación y el permiso nativeMessaging.', CODEX_PROVIDER_ID, 'NOT_AVAILABLE'));
                return;
              }
              if (value && typeof value === 'object' && 'ok' in value) {
                if (value.ok === true && 'text' in value && typeof value.text === 'string' && value.text.trim()) {
                  finish(undefined, value.text); return;
                }
                if (value.ok === false && 'code' in value && 'error' in value && typeof value.error === 'string') {
                  finish(new ProviderError(value.error, CODEX_PROVIDER_ID, bridgeErrorCode(value.code))); return;
                }
              }
              finish(new ProviderError('El puente de Codex devolvió una respuesta inválida.', CODEX_PROVIDER_ID, 'UNKNOWN'));
            });
        } catch {
          finish(new ProviderError('No se pudo iniciar el puente de Codex.', CODEX_PROVIDER_ID, 'NOT_AVAILABLE'));
        }
      });
    },
  };
}
