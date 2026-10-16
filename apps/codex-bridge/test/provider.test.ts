import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCodexBridgeProvider } from '../../extension/src/lib/codex-bridge';

const prompt = { system: 'Respondé JSON.', user: 'Pregunta' };
function mockChrome(value: unknown, lastError?: { message: string }) {
  const sendNativeMessage = vi.fn((_host: string, _message: unknown, callback: (value: unknown) => void) => callback(value));
  vi.stubGlobal('chrome', { runtime: { sendNativeMessage, lastError } });
  return sendNativeMessage;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('proveedor Codex local', () => {
  it('envía al host correcto y devuelve el texto', async () => {
    const send = mockChrome({ ok: true, text: '{"answers":[]}' });
    const provider = createCodexBridgeProvider();
    expect(provider.id).toBe('codex-local');
    expect(provider.label).toBe('Codex (local)');
    expect(await provider.complete(prompt)).toBe('{"answers":[]}');
    expect(send).toHaveBeenCalledWith('com.garra.codex_bridge', { type: 'complete', ...prompt, timeoutMs: 120000 }, expect.any(Function));
  });
  it.each([
    ['USAGE_LIMIT', 'RATE_LIMIT'], ['NOT_INSTALLED', 'NOT_AVAILABLE'], ['NOT_LOGGED_IN', 'NOT_AVAILABLE'],
    ['TIMEOUT', 'TIMEOUT'], ['UNKNOWN', 'UNKNOWN'], ['NEW_CODE', 'UNKNOWN'],
  ])('mapea %s a %s', async (code, expected) => {
    mockChrome({ ok: false, code, error: 'Mensaje del host.' });
    await expect(createCodexBridgeProvider().complete(prompt)).rejects.toMatchObject({ name: 'ProviderError', code: expected, providerId: 'codex-local' });
  });
  it.each([null, {}, { ok: true }, { ok: true, text: '' }, { ok: true, text: 12 }, { ok: false }])('rechaza %j', async value => {
    mockChrome(value);
    await expect(createCodexBridgeProvider().complete(prompt)).rejects.toMatchObject({ code: 'UNKNOWN' });
  });
  it('mapea host ausente y API de Chrome ausente', async () => {
    mockChrome(undefined, { message: 'Specified native messaging host not found.' });
    await expect(createCodexBridgeProvider().complete(prompt)).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
    vi.stubGlobal('chrome', undefined);
    await expect(createCodexBridgeProvider().complete(prompt)).rejects.toMatchObject({ code: 'NOT_AVAILABLE' });
  });
  it('respeta una señal ya cancelada sin enviar datos', async () => {
    const send = mockChrome({ ok: true, text: 'ok' });
    await expect(createCodexBridgeProvider().complete(prompt, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    expect(send).not.toHaveBeenCalled();
  });
  it('cancela mientras espera e ignora una respuesta tardía', async () => {
    let callback: ((value: unknown) => void) | undefined;
    vi.stubGlobal('chrome', { runtime: { sendNativeMessage: (_h: string, _m: unknown, cb: typeof callback) => { callback = cb; } } });
    const controller = new AbortController();
    const pending = expect(createCodexBridgeProvider().complete(prompt, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await pending;
    callback?.({ ok: true, text: 'tarde' });
  });
  it('no espera indefinidamente si Chrome nunca responde', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('chrome', { runtime: { sendNativeMessage: vi.fn() } });
    const pending = expect(createCodexBridgeProvider().complete(prompt)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(125000); await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
