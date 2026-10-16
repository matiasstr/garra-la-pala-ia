import type { JobExtractor } from './types';
import { firstText, humanizeSlug, pathSegment } from './dom';

// boards.greenhouse.io/<empresa>/jobs/<id>, job-boards.greenhouse.io/<empresa>/jobs/<id>
// y el iframe embebido boards.greenhouse.io/embed/job_app?for=<empresa>&token=<id>.
export const greenhouse: JobExtractor = {
  id: 'greenhouse',
  matches: (url) => /(^|\.)greenhouse\.io$/.test(url.hostname),
  extract(doc, url) {
    const slug = url.searchParams.get('for') ?? (pathSegment(url, 0) !== 'embed' ? pathSegment(url, 0) : undefined);
    const company = firstText(doc, ['.company-name']).replace(/^(at|en)\s+/i, '') || (slug ? humanizeSlug(slug) : '');
    return {
      title: firstText(doc, ['.job__title h1', 'h1.app-title', '.app-title', 'h1.section-header', 'h1']),
      company,
      location: firstText(doc, ['.job__location', '#header .location', '.location']),
      description: firstText(doc, ['.job__description', '#content', '.job-post-content']),
    };
  },
};
