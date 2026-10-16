import {
  AllProvidersFailedError,
  completeWithFallback,
  createOpenAiCompatibleProvider,
  isProviderUsable,
  parseAnswers,
} from '@garra/core';
import { getState } from './lib/storage';
import type { AnswerWithApiResult, BackgroundRequest, Result } from './lib/messages';

// Las llamadas a las APIs se hacen desde acá: el service worker tiene host_permissions,
// así que no hay problemas de CORS y las keys no pasan por las páginas que visitás.

async function answerWithApi(prompt: Extract<BackgroundRequest, { type: 'answer-with-api' }>): Promise<Result<AnswerWithApiResult>> {
  const { providers } = await getState('providers');
  const usable = providers.filter(isProviderUsable).map((cfg) => createOpenAiCompatibleProvider(cfg));
  if (!usable.length) {
    return {
      ok: false,
      error: 'No hay APIs configuradas. Agregá una key gratis en Opciones (Groq, OpenRouter o Gemini) o usá el modo Codex.',
    };
  }
  try {
    const result = await completeWithFallback(usable, prompt.prompt, {
      validate: (text) => parseAnswers(text, prompt.questionIds).error,
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

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  switch (message.type) {
    case 'answer-with-api':
      void answerWithApi(message).then(sendResponse);
      return true;
    case 'test-provider':
      void testProvider(message).then(sendResponse);
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
