import type { JobExtractor } from './types';
import { greenhouse } from './greenhouse';
import { lever } from './lever';

// Registro de extractores por sitio. Para sumar uno: importarlo y agregarlo al array.
export const EXTRACTORS: JobExtractor[] = [greenhouse, lever];

export function findExtractor(url: URL, doc: Document): JobExtractor | undefined {
  return EXTRACTORS.find((extractor) => extractor.matches(url, doc));
}
