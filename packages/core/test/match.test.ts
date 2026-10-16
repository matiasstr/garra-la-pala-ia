import { describe, expect, it } from 'vitest';
import { jobKeywords, matchCvToJob, rankCvs, type CvDocument } from '../src';

const job = `Buscamos Frontend Developer con experiencia en React, TypeScript y Node.js.
Deseable: GraphQL, AWS y testing con Jest. Inglés intermedio.`;

describe('match', () => {
  it('detecta habilidades sin confundir Java con JavaScript', () => {
    const { skills } = jobKeywords('Experiencia en JavaScript y C#. Conocimientos de CI/CD.');
    expect(skills).toEqual(expect.arrayContaining(['JavaScript', 'C#', 'CI/CD']));
    expect(skills).not.toContain('Java');
  });

  it('calcula el porcentaje y lista lo que falta', () => {
    const result = matchCvToJob('Desarrolladora con 5 años en React, TypeScript, Node y Jest. English: advanced.', job);
    expect(result.matched).toEqual(expect.arrayContaining(['React', 'TypeScript', 'Node.js', 'Jest', 'Inglés']));
    expect(result.missing).toEqual(expect.arrayContaining(['GraphQL', 'AWS']));
    expect(result.score).toBe(Math.round((5 / 7) * 100));
  });

  it('en ofertas sin habilidades técnicas usa términos frecuentes', () => {
    const result = matchCvToJob(
      'Experiencia en cobranzas y facturación.',
      'Analista de cobranzas. Gestión de cobranzas y facturación. Facturación mensual a proveedores.',
    );
    expect(result.matched).toEqual(expect.arrayContaining(['cobranzas', 'facturacion']));
    expect(result.score).toBeGreaterThan(50);
  });

  it('ordena los CVs por coincidencia', () => {
    const cv = (id: string, text: string): CvDocument => ({ id, name: id, fileName: `${id}.pdf`, mimeType: 'application/pdf', text, addedAt: 0 });
    const ranked = rankCvs([cv('data', 'Python, SQL, Power BI'), cv('front', 'React, TypeScript, Node')], job);
    expect(ranked.map((r) => r.cv.id)).toEqual(['front', 'data']);
  });

  it('devuelve score null si no hay nada para comparar', () => {
    expect(matchCvToJob('lo que sea', 'Hola').score).toBeNull();
  });
});
