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

/** El bloque con más texto que no sea el formulario: casi siempre es la descripción. */
function bestDescription(doc: Document): string {
  let best = '';
  let bestScore = 0;
  for (const el of doc.querySelectorAll(DESCRIPTION_CANDIDATES)) {
    const text = textOf(el);
    if (text.length < 200 || text.length > 40_000) continue;
    const inputs = el.querySelectorAll('input:not([type="hidden"]), textarea, select').length;
    const score = text.length - inputs * 1500;
    if (score > bestScore) {
      best = text;
      bestScore = score;
    }
  }
  return best;
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
