import type { JobPosting } from '@garra/core';

/**
 * Lee la oferta de un sitio puntual (un ATS o una bolsa de trabajo).
 * Lo que no devuelva se completa con JSON-LD y con el extractor genérico,
 * así que conviene devolver solo lo que se lee de forma confiable.
 */
export interface JobExtractor {
  /** Mismo valor que termina en JobPosting.source (ej. "workday"). */
  id: string;
  matches(url: URL, doc: Document): boolean;
  extract(doc: Document, url: URL): Partial<Omit<JobPosting, 'source' | 'extractedAt'>> | null;
}
