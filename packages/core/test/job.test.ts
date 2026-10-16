import { describe, expect, it } from 'vitest';
import {
  canonicalJobUrl,
  findCachedJob,
  findJobPostingNodes,
  htmlToText,
  jobFromJsonLd,
  mergeJobParts,
  rememberJob,
  type JobPosting,
} from '../src';

describe('htmlToText', () => {
  it('conserva párrafos y viñetas y decodifica entidades', () => {
    const text = htmlToText('<p>Buscamos <b>dev</b> &amp; QA</p><ul><li>React</li><li>Node</li></ul>');
    expect(text).toBe('Buscamos dev & QA\n- React\n- Node');
  });

  it('acepta HTML escapado como viene en algunos JSON-LD', () => {
    expect(htmlToText('&lt;p&gt;Hola&lt;/p&gt;&lt;p&gt;Chau&lt;/p&gt;')).toBe('Hola\nChau');
  });
});

describe('JSON-LD', () => {
  const ld = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Otra' },
      {
        '@type': 'JobPosting',
        title: 'Desarrollador/a Frontend Sr',
        hiringOrganization: { '@type': 'Organization', name: 'Acme LATAM' },
        description: '<p>Vas a trabajar con <strong>React</strong>.</p>',
        employmentType: ['FULL_TIME'],
        jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Buenos Aires', addressCountry: { name: 'AR' } } }],
        jobLocationType: 'TELECOMMUTE',
      },
    ],
  });

  it('encuentra el JobPosting dentro de @graph y lo normaliza', () => {
    const [node] = findJobPostingNodes([ld, 'esto no es json']);
    expect(node).toBeDefined();
    expect(jobFromJsonLd(node!)).toEqual({
      title: 'Desarrollador/a Frontend Sr',
      company: 'Acme LATAM',
      location: 'Buenos Aires, AR / Remoto',
      employmentType: 'FULL_TIME',
      description: 'Vas a trabajar con React.',
    });
  });

  it('tolera saltos de línea crudos dentro de strings', () => {
    const broken = '{"@type":"JobPosting","title":"QA\nAnalyst","description":"x"}';
    expect(findJobPostingNodes([broken])).toHaveLength(1);
  });
});

describe('ofertas', () => {
  it('canonicalJobUrl saca /apply y el tracking pero deja el id', () => {
    expect(canonicalJobUrl('https://jobs.lever.co/acme/123/apply?utm_source=x')).toBe('https://jobs.lever.co/acme/123');
    expect(canonicalJobUrl('https://boards.greenhouse.io/embed/job_app?for=acme&token=55&utm=1')).toBe(
      'https://boards.greenhouse.io/embed/job_app?token=55',
    );
  });

  it('mergeJobParts toma el primer valor no vacío de cada campo', () => {
    const job = mergeJobParts(
      'https://x.com/1',
      [
        { source: 'lever', data: { title: 'Dev', company: '' } },
        { source: 'jsonld', data: { company: 'Acme', description: 'Larga' } },
        { source: 'generic', data: { title: 'Otro', location: 'CABA' } },
      ],
      1,
    );
    expect(job).toEqual({
      url: 'https://x.com/1',
      title: 'Dev',
      company: 'Acme',
      description: 'Larga',
      location: 'CABA',
      source: 'jsonld',
      extractedAt: 1,
    });
    expect(mergeJobParts('u', [{ source: 'generic', data: { company: 'X' } }])).toBeNull();
  });

  it('recuerda la oferta y la encuentra desde la página del formulario', () => {
    const now = 1_000_000;
    const job: JobPosting = {
      url: 'https://jobs.lever.co/acme/123',
      title: 'Data Analyst',
      company: 'Acme',
      description: 'x'.repeat(400),
      source: 'lever',
      extractedAt: now,
    };
    const recent = rememberJob(rememberJob([], job), { ...job, extractedAt: now + 1 });
    expect(recent).toHaveLength(1);
    expect(findCachedJob(recent, 'https://jobs.lever.co/acme/123/apply', undefined, { now })).toBeDefined();
    expect(findCachedJob(recent, 'https://jobs.lever.co/acme/999/apply', 'data analyst', { now })).toBeDefined();
    expect(findCachedJob(recent, 'https://jobs.lever.co/acme/999/apply', 'Otro puesto', { now })).toBeUndefined();
    expect(findCachedJob(recent, job.url, undefined, { now: now + 8 * 24 * 3600 * 1000 })).toBeUndefined();
  });
});
