import type { ChatPrompt, LlmProvider, ProviderConfig, ProviderPresetId } from '../types';
import { ProviderError, errorCodeFromStatus } from './errors';

export interface ProviderPreset {
  label: string;
  baseUrl: string;
  /** Modelo sugerido. Los gratis cambian seguido: se puede editar en Opciones. */
  model: string;
  /** Dónde se saca la API key. */
  keyUrl: string;
  note: string;
}

// Groq, OpenRouter y Gemini exponen un endpoint compatible con el de OpenAI,
// así que un solo cliente sirve para todos (y para OpenAI/Astra con API key).
export const PROVIDER_PRESETS: Record<ProviderPresetId, ProviderPreset> = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    keyUrl: 'https://console.groq.com/keys',
    note: 'Gratis con cuenta. Muy rápido. Límite diario por cuenta.',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openrouter/free',
    keyUrl: 'https://openrouter.ai/keys',
    note: 'Modelos gratis rotativos ("openrouter/free" elige uno). Pocos pedidos por día sin créditos.',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest',
    keyUrl: 'https://aistudio.google.com/apikey',
    note: 'Gratis con cuenta de Google. En el plan gratis Google puede usar lo que mandás para mejorar sus productos.',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    keyUrl: 'https://platform.openai.com/api-keys',
    note: 'Pago. Poné el modelo que quieras usar (por ejemplo Astra).',
  },
  custom: {
    label: 'Otra API compatible con OpenAI',
    baseUrl: '',
    model: '',
    keyUrl: '',
    note: 'Cualquier endpoint /chat/completions compatible con OpenAI.',
  },
};

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

async function readError(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(body) as ChatCompletionResponse | ChatCompletionResponse[];
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first?.error?.message) return first.error.message;
  } catch {
    // no era JSON
  }
  return body.slice(0, 300) || res.statusText;
}

export function createOpenAiCompatibleProvider(config: ProviderConfig, fetchImpl: typeof fetch = fetch): LlmProvider {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function request(prompt: ChatPrompt, jsonMode: boolean, signal?: AbortSignal): Promise<string> {
    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    };
    if (jsonMode) body.response_format = { type: 'json_object' };

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          // Opcionales en OpenRouter: identifican la app en su panel.
          ...(config.preset === 'openrouter' ? { 'X-Title': 'Garra la Pala IA' } : {}),
        },
        body: JSON.stringify(body),
        signal: signal ?? null,
      });
    } catch (err) {
      if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) throw err;
      throw new ProviderError(`No se pudo conectar con ${config.label}.`, config.id, 'NETWORK');
    }

    if (!res.ok) {
      const message = await readError(res);
      // Algunos modelos no soportan response_format: reintentamos sin.
      if (jsonMode && res.status === 400 && /response_format|json/i.test(message)) {
        return request(prompt, false, signal);
      }
      throw new ProviderError(`${config.label}: ${message}`, config.id, errorCodeFromStatus(res.status), res.status);
    }

    const data = (await res.json().catch(() => ({}))) as ChatCompletionResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new ProviderError(`${config.label} devolvió una respuesta vacía.`, config.id, 'BAD_RESPONSE');
    return text;
  }

  return {
    id: config.id,
    label: config.label,
    complete: (prompt, signal) => request(prompt, config.jsonMode, signal),
  };
}

export function isProviderUsable(config: ProviderConfig): boolean {
  return config.enabled && Boolean(config.baseUrl.trim() && config.model.trim() && config.apiKey.trim());
}
