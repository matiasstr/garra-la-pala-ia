import type { Attempt, ChatPrompt, ProviderConfig } from '@garra/core';

// Mensajes entre content script / opciones / popup y el service worker.

export type BackgroundRequest =
  | { type: 'answer-with-api'; prompt: ChatPrompt; questionIds: string[] }
  | { type: 'test-provider'; config: ProviderConfig }
  | { type: 'open-options' };

export interface AnswerWithApiResult {
  text: string;
  label: string;
  attempts: Attempt[];
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; attempts?: Attempt[] };

export type TabMessage = { type: 'toggle-panel' };

export function sendToBackground<T>(message: BackgroundRequest): Promise<Result<T>> {
  return chrome.runtime.sendMessage(message) as Promise<Result<T>>;
}
