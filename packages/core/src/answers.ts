import type { AiAnswer } from './types';

export interface ParsedAnswers {
  answers: AiAnswer[];
  /** Motivo legible si no se pudo leer nada. */
  error?: string;
  /** Ids que estaban en la respuesta pero no corresponden a ninguna pregunta. */
  unknownIds: string[];
}

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, '').trim();
}

/** El primer objeto o array JSON balanceado que aparezca en el texto. */
function extractJson(text: string): unknown {
  const pairs = (
    [
      ['{', '}'],
      ['[', ']'],
    ] as const
  )
    .map(([open, close]) => ({ open, close, start: text.indexOf(open) }))
    .filter((p) => p.start !== -1)
    .sort((a, b) => a.start - b.start);
  for (const { open, close, start } of pairs) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

function toAnswer(id: unknown, value: unknown, needsReview?: unknown): AiAnswer | null {
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const answer = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  const result: AiAnswer = { id: String(id).trim(), answer };
  if (needsReview === true || !answer) result.needsReview = true;
  return result;
}

/**
 * Lee la respuesta de la IA en forma tolerante: con o sin bloque de código, con texto
 * alrededor, como {"answers":[...]}, como [...] o como {"f1": "..."}.
 */
export function parseAnswers(raw: string, validIds: Iterable<string>): ParsedAnswers {
  const valid = new Set(validIds);
  const data = extractJson(stripFences(raw));
  if (data === undefined) return { answers: [], unknownIds: [], error: 'No encontré un JSON válido en la respuesta.' };

  let list: Array<AiAnswer | null> = [];
  const root = data as Record<string, unknown>;
  const items = Array.isArray(data) ? data : Array.isArray(root.answers) ? root.answers : null;
  if (items) {
    list = items.map((item) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      return toAnswer(obj.id, obj.answer ?? obj.respuesta ?? obj.value, obj.needsReview);
    });
  } else if (typeof data === 'object' && data !== null) {
    list = Object.entries(root).map(([id, value]) => toAnswer(id, value));
  }

  const answers: AiAnswer[] = [];
  const unknownIds: string[] = [];
  const seen = new Set<string>();
  for (const answer of list) {
    if (!answer || seen.has(answer.id)) continue;
    seen.add(answer.id);
    if (valid.has(answer.id)) answers.push(answer);
    else unknownIds.push(answer.id);
  }
  const error = answers.length ? undefined : 'La respuesta no trae respuestas para las preguntas de este formulario.';
  return error ? { answers, unknownIds, error } : { answers, unknownIds };
}
