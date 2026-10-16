import { ProviderError } from '@garra/core';
import type { ChatPrompt, LlmProvider, ProviderErrorCode } from '@garra/core';

const HOST_NAME = 'com.garra.codex_bridge';
const PROVIDER_ID = 'codex-local';
const TIMEOUT_MS = 120_000;

function bridgeErrorCode(code: unknown): ProviderErrorCode {
  if (code === 'USAGE_LIMIT') return 'RATE_LIMIT';
  if (code === 'NOT_INSTALLED' || code === 'NOT_LOGGED_IN') return 'NOT_AVAILABLE';
  if (code === 'TIMEOUT') return 'TIMEOUT';
  return 'UNKNOWN';
}

/** Invocar desde el service worker o una página de la extensión, nunca desde un content script. */
export function createCodexBridgeProvider(): LlmProvider {
  return {
    id: PROVIDER_ID,
    label: 'Codex (local)',
    complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException('Solicitud cancelada.', 'AbortError')); return; }
        if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendNativeMessage !== 'function') {
          reject(new ProviderError('El puente de Codex no está disponible en este contexto.', PROVIDER_ID, 'NOT_AVAILABLE'));
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
        const timer = setTimeout(() => finish(new ProviderError('Codex superó el tiempo de espera.', PROVIDER_ID, 'TIMEOUT')), TIMEOUT_MS + 5_000);
        signal?.addEventListener('abort', abort, { once: true });
        try {
          chrome.runtime.sendNativeMessage(HOST_NAME,
            { type: 'complete', system: prompt.system, user: prompt.user, timeoutMs: TIMEOUT_MS },
            (value: unknown) => {
              // Leer lastError incluso si la persona canceló antes de llegar la respuesta.
              const nativeError = chrome.runtime.lastError;
              if (settled) return;
              if (nativeError) {
                finish(new ProviderError('No se pudo conectar con el puente de Codex. Revisá su instalación y el permiso nativeMessaging.', PROVIDER_ID, 'NOT_AVAILABLE'));
                return;
              }
              if (value && typeof value === 'object' && 'ok' in value) {
                if (value.ok === true && 'text' in value && typeof value.text === 'string' && value.text.trim()) {
                  finish(undefined, value.text); return;
                }
                if (value.ok === false && 'code' in value && 'error' in value && typeof value.error === 'string') {
                  finish(new ProviderError(value.error, PROVIDER_ID, bridgeErrorCode(value.code))); return;
                }
              }
              finish(new ProviderError('El puente de Codex devolvió una respuesta inválida.', PROVIDER_ID, 'UNKNOWN'));
            });
        } catch {
          finish(new ProviderError('No se pudo iniciar el puente de Codex.', PROVIDER_ID, 'NOT_AVAILABLE'));
        }
      });
    },
  };
}
