import {
  AllProvidersFailedError,
  completeWithFallback,
  createOpenAiCompatibleProvider,
  isProviderUsable,
  parseAnswers,
  type LlmProvider,
} from '@garra/core';
import { CODEX_HOST_NAME, CODEX_PROVIDER_ID, createCodexBridgeProvider } from './lib/codex-bridge';
import { getState } from './lib/storage';
import type { AnswerWithApiResult, BackgroundRequest, CodexPingResult, Result } from './lib/messages';

// Las llamadas a la IA se hacen desde acá: el service worker tiene host_permissions y
// nativeMessaging, así que no hay problemas de CORS y las keys no pasan por las páginas.

/** Codex local primero (si está activado) y después las APIs gratis, en el orden de Opciones. */
async function providerChain(): Promise<{ chain: LlmProvider[]; codexTimeoutMs: number }> {
  const { providers, codex } = await getState('providers', 'codex');
  const chain: LlmProvider[] = [];
  if (codex.enabled) chain.push(createCodexBridgeProvider({ model: codex.model, timeoutMs: codex.timeoutMs }));
  chain.push(...providers.filter(isProviderUsable).map((cfg) => createOpenAiCompatibleProvider(cfg)));
  return { chain, codexTimeoutMs: codex.timeoutMs };
}

async function answerWithAi(message: Extract<BackgroundRequest, { type: 'answer-with-api' }>): Promise<Result<AnswerWithApiResult>> {
  const { chain, codexTimeoutMs } = await providerChain();
  if (!chain.length) {
    return {
      ok: false,
      error: 'No hay IA configurada. En Opciones activá Codex local o agregá una API gratis (Groq, OpenRouter o Gemini). También podés usar "Copiar prompt".',
    };
  }
  try {
    const result = await completeWithFallback(chain, message.prompt, {
      validate: (text) => parseAnswers(text, message.questionIds).error,
      // Codex razona antes de responder; el host lo corta a codexTimeoutMs y le damos margen para arrancar.
      timeoutFor: (provider) => (provider.id === CODEX_PROVIDER_ID ? codexTimeoutMs + 15_000 : undefined),
    });
    return { ok: true, data: { text: result.text, label: result.label, attempts: result.attempts } };
  } catch (err) {
    if (err instanceof AllProvidersFailedError) return { ok: false, error: err.message, attempts: err.attempts };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testProvider(message: Extract<BackgroundRequest, { type: 'test-provider' }>): Promise<Result<string>> {
  const provider = createOpenAiCompatibleProvider(message.config);
  try {
    const text = await provider.complete(
      { system: 'Respondé solo con JSON.', user: 'Devolvé exactamente {"ok":true}' },
      AbortSignal.timeout(30_000),
    );
    return { ok: true, data: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Le pregunta al puente su versión y la de Codex. No gasta cupo. */
async function codexPing(): Promise<Result<CodexPingResult>> {
  try {
    const response = (await chrome.runtime.sendNativeMessage(CODEX_HOST_NAME, { type: 'ping' })) as
      | { ok: true; version?: string; codexVersion?: string }
      | { ok: false; error?: string }
      | undefined;
    if (response?.ok) {
      const data: CodexPingResult = { version: response.version ?? '?' };
      if (response.codexVersion) data.codexVersion = response.codexVersion;
      return { ok: true, data };
    }
    return { ok: false, error: response?.error ?? 'El puente respondió sin datos.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(message)) {
      return { ok: false, error: 'No encontré el puente instalado. Corré el comando de instalación de arriba y volvé a probar.' };
    }
    if (/forbidden/i.test(message)) {
      return { ok: false, error: 'El puente está instalado para otra extensión: volvé a correr el comando de instalación con este ID.' };
    }
    return { ok: false, error: `No pude hablar con el puente: ${message}` };
  }
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  switch (message.type) {
    case 'answer-with-api':
      void answerWithAi(message).then(sendResponse);
      return true;
    case 'test-provider':
      void testProvider(message).then(sendResponse);
      return true;
    case 'codex-ping':
      void codexPing().then(sendResponse);
      return true;
    case 'open-options':
      void chrome.runtime.openOptionsPage();
      return false;
  }
  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
