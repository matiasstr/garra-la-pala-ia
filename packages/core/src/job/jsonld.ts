import type { JobPosting } from '../types';
import { htmlToText, normalizeWhitespace } from '../text';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasType(node: JsonObject, type: string): boolean {
  const t = node['@type'];
  return t === type || (Array.isArray(t) && t.includes(type));
}

function parseLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Hay sitios que meten saltos de línea crudos dentro de los strings.
    try {
      return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return undefined;
    }
  }
}

function collect(node: unknown, out: JsonObject[], depth: number): void {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out, depth + 1);
    return;
  }
  if (!isObject(node)) return;
  if (hasType(node, 'JobPosting')) out.push(node);
  if (node['@graph']) collect(node['@graph'], out, depth + 1);
  if (node.mainEntity) collect(node.mainEntity, out, depth + 1);
}

/** Nodos JobPosting dentro del contenido de los <script type="application/ld+json">. */
export function findJobPostingNodes(jsonLdTexts: string[]): JsonObject[] {
  const found: JsonObject[] = [];
  for (const raw of jsonLdTexts) collect(parseLenient(raw.trim()), found, 0);
  return found;
}

function str(value: unknown): string {
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (typeof value === 'number') return String(value);
  return '';
}

function nameOf(value: unknown): string {
  if (Array.isArray(value)) return nameOf(value[0]);
  if (isObject(value)) return str(value.name);
  return str(value);
}

function addressText(address: unknown): string {
  if (!isObject(address)) return str(address);
  const parts = [address.addressLocality, address.addressRegion, nameOf(address.addressCountry)]
    .map((p) => (typeof p === 'string' ? normalizeWhitespace(p) : ''))
    .filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function locationText(node: JsonObject): string {
  const raw = node.jobLocation;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const places = list.map((loc) => (isObject(loc) ? addressText(loc.address ?? loc) : str(loc))).filter(Boolean);
  if (str(node.jobLocationType).toUpperCase() === 'TELECOMMUTE') places.push('Remoto');
  return [...new Set(places)].join(' / ');
}

/** Pasa un nodo JobPosting de schema.org a nuestro formato (solo lo que trae). */
export function jobFromJsonLd(node: JsonObject): Partial<JobPosting> {
  const employment = Array.isArray(node.employmentType)
    ? node.employmentType.map(str).filter(Boolean).join(', ')
    : str(node.employmentType);
  const description = typeof node.description === 'string' ? htmlToText(node.description) : '';
  const job: Partial<JobPosting> = {
    title: str(node.title),
    company: nameOf(node.hiringOrganization),
    location: locationText(node),
    employmentType: employment,
    description,
  };
  return Object.fromEntries(Object.entries(job).filter(([, v]) => v)) as Partial<JobPosting>;
}
