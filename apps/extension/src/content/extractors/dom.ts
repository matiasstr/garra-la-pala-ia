// Helpers de DOM para los extractores. Funcionan en el navegador y en jsdom.

/** Texto visible de un elemento, con espacios normalizados. */
export function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  const html = el as HTMLElement;
  // jsdom no implementa innerText; en el navegador preserva saltos de línea.
  const raw = typeof html.innerText === 'string' && html.innerText ? html.innerText : (el.textContent ?? '');
  return raw
    .replace(/[ \t ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Texto del primer selector que encuentre algo no vacío. */
export function firstText(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const text = textOf(root.querySelector(selector));
    if (text) return text;
  }
  return '';
}

/** "acme-corp" -> "Acme Corp" */
export function humanizeSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** Segmento n (0-based) del path, sin vacíos. */
export function pathSegment(url: URL, index: number): string | undefined {
  return url.pathname.split('/').filter(Boolean)[index];
}

export function metaContent(doc: Document, name: string): string {
  const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
  return el?.getAttribute('content')?.trim() ?? '';
}
