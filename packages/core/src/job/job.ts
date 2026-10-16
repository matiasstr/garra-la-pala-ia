import type { JobPosting } from '../types';
import { normalizeForMatch } from '../text';

/** Parámetros de query que identifican la oferta (el resto es tracking). */
const ID_PARAMS = ['token', 'gh_jid', 'jobid', 'job_id', 'jid', 'id', 'job', 'vacancy'];

/**
 * URL sin tracking ni el sufijo del formulario, para relacionar la página de la oferta
 * con la de "postularme" (ej. jobs.lever.co/acme/123 y jobs.lever.co/acme/123/apply).
 */
export function canonicalJobUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const path = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/(apply|application|applications|postular|postulacion|postulate|candidatar|candidatura)$/i, '');
  const kept = [...parsed.searchParams.entries()]
    .filter(([key]) => ID_PARAMS.includes(key.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = kept.length ? `?${new URLSearchParams(kept).toString()}` : '';
  return `${parsed.origin}${path}${query}`;
}

/**
 * Une lo que devolvieron varias fuentes, en orden de prioridad:
 * para cada campo gana el primer valor no vacío.
 */
export function mergeJobParts(
  url: string,
  parts: Array<{ source: string; data: Partial<JobPosting> | null }>,
  now = Date.now(),
): JobPosting | null {
  const pick = (key: 'title' | 'company' | 'location' | 'employmentType' | 'description') =>
    parts.map((p) => p.data?.[key]?.trim()).find((v) => v);
  const title = pick('title');
  if (!title) return null;
  const description = pick('description') ?? '';
  // La fuente es la que aportó la descripción (lo más difícil de leer bien).
  const source = parts.find((p) => p.data?.description?.trim())?.source ?? parts.find((p) => p.data?.title)?.source ?? 'generic';
  const job: JobPosting = {
    url,
    title,
    company: pick('company') ?? '',
    description,
    source,
    extractedAt: now,
  };
  const location = pick('location');
  const employmentType = pick('employmentType');
  if (location) job.location = location;
  if (employmentType) job.employmentType = employmentType;
  return job;
}

/** Descripción mínima para considerar que la oferta se leyó completa. */
export const MIN_DESCRIPTION_CHARS = 300;

export function rememberJob(recent: JobPosting[], job: JobPosting, max = 30): JobPosting[] {
  const key = canonicalJobUrl(job.url);
  return [job, ...recent.filter((j) => canonicalJobUrl(j.url) !== key)].slice(0, max);
}

/**
 * Busca la oferta ya vista que corresponde a esta página (útil en el formulario,
 * donde muchas veces no está la descripción): misma URL canónica, o mismo sitio y título.
 */
export function findCachedJob(
  recent: JobPosting[],
  url: string,
  title?: string,
  opts: { now?: number; maxAgeMs?: number } = {},
): JobPosting | undefined {
  const now = opts.now ?? Date.now();
  const maxAge = opts.maxAgeMs ?? 7 * 24 * 60 * 60 * 1000;
  const fresh = recent.filter((j) => now - j.extractedAt <= maxAge && j.description.length >= MIN_DESCRIPTION_CHARS);
  const key = canonicalJobUrl(url);
  const byUrl = fresh.find((j) => canonicalJobUrl(j.url) === key);
  if (byUrl || !title) return byUrl;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  const wanted = normalizeForMatch(title);
  return fresh.find((j) => {
    try {
      return new URL(j.url).hostname === host && normalizeForMatch(j.title) === wanted;
    } catch {
      return false;
    }
  });
}
