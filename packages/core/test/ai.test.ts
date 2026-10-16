import { describe, expect, it, vi } from 'vitest';
import {
  AllProvidersFailedError,
  ProviderError,
  buildAnswerPrompt,
  completeWithFallback,
  createOpenAiCompatibleProvider,
  parseAnswers,
  promptAsSingleText,
  type LlmProvider,
  type ProviderConfig,
} from '../src';

describe('buildAnswerPrompt', () => {
  it('incluye oferta, perfil, CV y preguntas con sus restricciones', () => {
    const prompt = buildAnswerPrompt({
      job: { url: 'u', title: 'Data Analyst', company: 'Acme', description: 'SQL y Power BI', source: 'jsonld', extractedAt: 0 },
      profile: { firstName: 'Ana', city: '  ' },
      cvText: 'Ana Gómez - Analista de datos',
      questions: [
        { id: 'q1', question: '¿Por qué Acme?', control: 'textarea', required: true, maxLength: 500 },
        { id: 'q2', question: 'Nivel de inglés', control: 'select', required: false, options: ['Básico', 'Avanzado'] },
      ],
    });
    expect(prompt.system).toContain('"answers"');
    expect(prompt.user).toContain('Empresa: Acme');
    expect(prompt.user).toContain('- firstName: Ana');
    expect(prompt.user).not.toContain('city');
    expect(prompt.user).toContain('id: q1 | pregunta: "¿Por qué Acme?" | tipo: texto largo | obligatoria | máx. 500 caracteres');
    expect(prompt.user).toContain('opciones: ["Básico","Avanzado"]');
    expect(promptAsSingleText(prompt)).toContain('---');
  });

  it('recorta descripciones enormes y lo marca', () => {
    const prompt = buildAnswerPrompt(
      {
        job: { url: 'u', title: 'X', company: 'Y', description: 'palabra '.repeat(5000), source: 'g', extractedAt: 0 },
        profile: {},
        cvText: '',
        questions: [],
      },
      { maxJobChars: 100, maxCvChars: 100 },
    );
    expect(prompt.user).toContain('[…recortado]');
    expect(prompt.user).toContain('(no hay CV cargado)');
  });
});

describe('parseAnswers', () => {
  const ids = ['q1', 'q2'];
  it('lee JSON dentro de un bloque de código con texto alrededor', () => {
    const raw = 'Acá van:\n```json\n{"answers":[{"id":"q1","answer":"Porque {me gusta}"},{"id":"zz","answer":"x"}]}\n```\nSuerte!';
    const parsed = parseAnswers(raw, ids);
    expect(parsed.answers).toEqual([{ id: 'q1', answer: 'Porque {me gusta}' }]);
    expect(parsed.unknownIds).toEqual(['zz']);
  });

  it('acepta un array o un objeto id -> respuesta, y marca vacías para revisar', () => {
    expect(parseAnswers('[{"id":"q2","answer":""}]', ids).answers).toEqual([{ id: 'q2', answer: '', needsReview: true }]);
    expect(parseAnswers('{"q1":"Hola","q2":"Chau"}', ids).answers).toHaveLength(2);
  });

  it('explica cuando no hay JSON', () => {
    expect(parseAnswers('no sé', ids).error).toMatch(/JSON/);
  });
});

function fakeProvider(id: string, impl: () => Promise<string>): LlmProvider {
  return { id, label: id, complete: vi.fn(impl) };
}

describe('completeWithFallback', () => {
  const prompt = { system: 's', user: 'u' };

  it('si uno se queda sin cupo pasa al siguiente', async () => {
    const first = fakeProvider('groq', () => Promise.reject(new ProviderError('sin cupo', 'groq', 'RATE_LIMIT', 429)));
    const second = fakeProvider('gemini', () => Promise.resolve('{"answers":[]}'));
    const result = await completeWithFallback([first, second], prompt);
    expect(result.providerId).toBe('gemini');
    expect(result.attempts.map((a) => [a.providerId, a.ok, a.code])).toEqual([
      ['groq', false, 'RATE_LIMIT'],
      ['gemini', true, undefined],
    ]);
  });

  it('una respuesta inválida también cuenta como falla', async () => {
    const bad = fakeProvider('a', () => Promise.resolve('nada'));
    const good = fakeProvider('b', () => Promise.resolve('ok'));
    const result = await completeWithFallback([bad, good], prompt, { validate: (t) => (t === 'ok' ? undefined : 'inválida') });
    expect(result.providerId).toBe('b');
  });

  it('corta por timeout aunque el proveedor ignore la señal, y sigue con el próximo', async () => {
    const stuck = fakeProvider('codex-local', () => new Promise<string>(() => {}));
    const next = fakeProvider('groq', () => Promise.resolve('ok'));
    const result = await completeWithFallback([stuck, next], prompt, {
      timeoutFor: (p) => (p.id === 'codex-local' ? 30 : undefined),
    });
    expect(result.providerId).toBe('groq');
    expect(result.attempts[0]).toMatchObject({ providerId: 'codex-local', ok: false, code: 'TIMEOUT', error: 'tardó demasiado' });
  });

  it('si todos fallan tira un error con el detalle', async () => {
    const bad = fakeProvider('a', () => Promise.reject(new Error('boom')));
    await expect(completeWithFallback([bad], prompt)).rejects.toBeInstanceOf(AllProvidersFailedError);
    await expect(completeWithFallback([], prompt)).rejects.toThrow('No hay proveedores');
  });
});

describe('createOpenAiCompatibleProvider', () => {
  const config: ProviderConfig = {
    id: 'p1',
    preset: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1/',
    model: 'm',
    apiKey: 'k',
    enabled: true,
    jsonMode: true,
  };
  const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it('manda el pedido en formato OpenAI y devuelve el contenido', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(' {"answers":[]} '));
    const provider = createOpenAiCompatibleProvider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.complete({ system: 's', user: 'u' })).resolves.toBe('{"answers":[]}');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'm', response_format: { type: 'json_object' } });
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });

  it('reintenta sin response_format si el modelo no lo soporta', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'response_format not supported' } }), { status: 400 }))
      .mockResolvedValueOnce(ok('hola'));
    const provider = createOpenAiCompatibleProvider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.complete({ system: 's', user: 'u' })).resolves.toBe('hola');
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).response_format).toBeUndefined();
  });

  it('traduce 429 a RATE_LIMIT', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), { status: 429 }));
    const provider = createOpenAiCompatibleProvider(config, fetchMock as unknown as typeof fetch);
    await expect(provider.complete({ system: 's', user: 'u' })).rejects.toMatchObject({ code: 'RATE_LIMIT', status: 429 });
  });
});
