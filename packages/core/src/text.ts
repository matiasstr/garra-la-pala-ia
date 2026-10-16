const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  bull: '•',
  middot: '·',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  ccedil: 'ç',
  atilde: 'ã',
  otilde: 'õ',
  uuml: 'ü',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return NAMED_ENTITIES[code] ?? match;
  });
}

/** Colapsa espacios dentro de cada línea y deja como mucho una línea en blanco seguida. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** HTML -> texto plano conservando párrafos y viñetas. Sin DOM, sirve en Node. */
export function htmlToText(html: string): string {
  // Algunas fuentes (JSON-LD) traen el HTML escapado: &lt;p&gt;...
  let text = /&lt;\/?[a-z]/i.test(html) ? decodeEntities(html) : html;
  text = text
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  // Un salto por bloque alcanza: menos tokens y igual de legible.
  return normalizeWhitespace(decodeEntities(text)).replace(/\n{2,}/g, '\n');
}

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** "firstName" -> "first Name". Solo para atributos (name, id), no para etiquetas. */
export function splitCamelCase(text: string): string {
  return text.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Minúsculas, sin tildes ni puntuación, guiones como espacios. */
export function normalizeForMatch(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[_\-[\]().:*?¿!¡"'/\\|,;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const TRUNCATION_MARK = '[…recortado]';

/** Recorta en un límite de palabra y deja una marca visible de que se recortó. */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.8 ? lastSpace : maxChars).trimEnd()} ${TRUNCATION_MARK}`;
}

/** Estimación grosera (~4 caracteres por token). Alcanza para mostrar el tamaño del prompt. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Hash corto y estable (djb2, base36). */
export function shortHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}
