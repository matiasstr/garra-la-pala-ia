import type { JobExtractor } from './types';
import { firstText, humanizeSlug, pathSegment, textOf } from './dom';

// jobs.lever.co/<empresa>/<id> y jobs.lever.co/<empresa>/<id>/apply (el formulario no trae la descripción:
// se completa con la oferta guardada cuando la persona pasó por la página anterior).
export const lever: JobExtractor = {
  id: 'lever',
  matches: (url) => url.hostname === 'jobs.lever.co' || url.hostname === 'jobs.eu.lever.co',
  extract(doc, url) {
    const slug = pathSegment(url, 0);
    const sections = [...doc.querySelectorAll('.posting-page .section.page-centered, [data-qa="job-description"]')]
      .filter((el) => !el.querySelector('form, input, textarea') && !el.closest('.posting-headline'))
      .map((el) => textOf(el))
      .filter(Boolean);
    return {
      title: firstText(doc, ['.posting-headline h2', '.posting-header h2', 'h2']),
      company: slug ? humanizeSlug(slug) : '',
      location: firstText(doc, ['.posting-categories .location', '.posting-category.location', '.sort-by-time']),
      employmentType: firstText(doc, ['.posting-categories .commitment']),
      description: [...new Set(sections)].join('\n\n'),
    };
  },
};
