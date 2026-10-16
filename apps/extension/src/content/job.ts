import { findJobPostingNodes, jobFromJsonLd, mergeJobParts, type JobPosting } from '@garra/core';
import { findExtractor } from './extractors';
import { extractGeneric } from './extractors/generic';

export interface ExtractedJob {
  job: JobPosting | null;
  /** Hay señales claras de que es una oferta (ATS conocido o JSON-LD JobPosting). */
  confident: boolean;
}

/** Lee la oferta combinando: extractor del sitio > JSON-LD > heurística genérica. */
export function extractJob(doc: Document, href: string): ExtractedJob {
  const url = new URL(href);
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? '');
  const ldNode = findJobPostingNodes(scripts)[0];
  const extractor = findExtractor(url, doc);

  let fromSite = null;
  try {
    fromSite = extractor?.extract(doc, url) ?? null;
  } catch (err) {
    console.warn(`[Garra] El extractor ${extractor?.id} falló`, err);
  }

  const job = mergeJobParts(href, [
    { source: extractor?.id ?? 'site', data: fromSite },
    { source: 'jsonld', data: ldNode ? jobFromJsonLd(ldNode) : null },
    { source: 'generic', data: extractGeneric(doc, url) },
  ]);
  return { job, confident: Boolean(extractor || ldNode) };
}
