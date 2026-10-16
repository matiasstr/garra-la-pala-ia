import type { JobPosting } from '@garra/core';
import { humanizeSlug, metaContent, textOf } from './dom';

const DESCRIPTION_CANDIDATES = [
  '[class*="description" i]',
  '[id*="description" i]',
  '[data-automation-id*="description" i]',
  '[class*="job-detail" i]',
  '[class*="jobdetail" i]',
  '[class*="vacante" i]',
  '[class*="oferta" i]',
  'article',
  'main',
  '[role="main"]',
  'section',
].join(', ');

/** Mucho texto, pocos links y nada de formulario: así se ve una descripción. */
function blockScore(el: Element): number {
  const length = (el.textContent ?? '').replace(/\s+/g, ' ').length;
  if (length < 200 || length > 40_000) return -Infinity;
  if (el.closest('nav, header, footer, form, [role="navigation"]')) return -Infinity;
  const inputs = el.querySelectorAll('input:not([type="hidden"]), textarea, select').length;
  let linkText = 0;
  for (const a of el.querySelectorAll('a')) linkText += (a.textContent ?? '').length;
  return length - inputs * 1500 - linkText * 2;
}

function bestIn(elements: Iterable<Element>): Element | undefined {
  let best: Element | undefined;
  let bestScore = 0;
  for (const el of elements) {
    const score = blockScore(el);
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

/** El bloque con más texto que no sea el formulario: casi siempre es la descripción. */
function bestDescription(doc: Document): string {
  // Primero los contenedores con nombres obvios; si no hay uno sustancial, cualquier bloque.
  const named = bestIn(doc.querySelectorAll(DESCRIPTION_CANDIDATES));
  const namedText = named ? textOf(named) : '';
  if (namedText.length >= 400) return namedText;
  const any = bestIn(doc.querySelectorAll('div, td'));
  const anyText = any ? textOf(any) : '';
  return anyText.length > namedText.length ? anyText : namedText;
}

/** "Data Analyst - Acme | Careers" -> "Acme" (heurística, solo como último recurso). */
function companyFromTitle(title: string): string {
  const parts = title.split(/\s+[|·–—-]\s+|\s+at\s+|\s+en\s+/i).map((p) => p.trim());
  const candidate = parts.length > 1 ? parts[1] : '';
  return candidate && !/careers?|empleos?|trabaj|jobs?|vagas?/i.test(candidate) ? candidate : '';
}

function companyFromHost(hostname: string): string {
  const labels = hostname.replace(/^www\./, '').split('.');
  const generic = new Set(['careers', 'jobs', 'empleos', 'trabajos', 'apply', 'talento', 'carreras', 'vagas']);
  const main = labels.find((l) => !generic.has(l)) ?? labels[0] ?? '';
  return humanizeSlug(main);
}

/** Último recurso para cualquier sitio. */
export function extractGeneric(doc: Document, url: URL): Partial<JobPosting> {
  const h1 = [...doc.querySelectorAll('h1')].map((el) => textOf(el)).find((t) => t.length > 2 && t.length < 160);
  const ogTitle = metaContent(doc, 'og:title');
  const title = h1 || ogTitle || doc.title;
  return {
    title,
    company: metaContent(doc, 'og:site_name') || companyFromTitle(ogTitle || doc.title) || companyFromHost(url.hostname),
    description: bestDescription(doc),
  };
}
