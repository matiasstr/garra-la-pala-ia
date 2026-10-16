// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildFillPlan } from '@garra/core';
import { extractJob } from '../src/content/job';
import { scanFields } from '../src/content/fields';
import { applyValue } from '../src/content/fill';

function load(fixture: string): void {
  const html = readFileSync(join(import.meta.dirname, 'fixtures', fixture), 'utf8');
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
}

function byLabel(label: string) {
  const scan = scanFields(document);
  const field = scan.fields.find((f) => f.label === label);
  if (!field) throw new Error(`No encontré "${label}". Hay: ${scan.fields.map((f) => f.label).join(' | ')}`);
  return { field, elements: scan.elements.get(field.id)! };
}

describe('Greenhouse', () => {
  beforeEach(() => load('greenhouse/job-app.html'));
  const url = 'https://boards.greenhouse.io/acmelatam/jobs/4012345';

  it('lee la oferta: el extractor del sitio le gana al JSON-LD en la descripción', () => {
    const { job, confident } = extractJob(document, url);
    expect(confident).toBe(true);
    expect(job).toMatchObject({
      title: 'Senior Frontend Engineer',
      company: 'Acme LATAM',
      location: 'Buenos Aires, Argentina (Remote)',
      employmentType: 'FULL_TIME',
      source: 'greenhouse',
    });
    expect(job!.description).toContain('merchant dashboard');
    expect(job!.description).not.toContain('Short JSON-LD');
  });

  it('en un dominio propio (sin extractor) encuentra la descripción con la heurística genérica', () => {
    const { job, confident } = extractJob(document, 'https://careers.acme.com/jobs/senior-frontend');
    expect(confident).toBe(true); // por el JSON-LD
    expect(job!.description).toContain('merchant dashboard');
    expect(job!.description).not.toContain('First Name');
    expect(job!.source).toBe('generic');
  });

  it('detecta los campos con su etiqueta, obligatoriedad y opciones', () => {
    const { fields } = scanFields(document);
    expect(fields.map((f) => [f.label, f.control, f.required])).toEqual([
      ['First Name', 'text', true],
      ['Last Name', 'text', true],
      ['Email', 'text', true],
      ['Phone', 'text', false],
      ['Resume/CV', 'file', true],
      ['LinkedIn Profile', 'text', false],
      ['Why do you want to work at Acme LATAM?', 'textarea', true],
      ['How did you hear about this job?', 'select', false],
      ['Will you now or in the future require visa sponsorship?', 'radio', false],
      ['Years of experience with React', 'text', false],
      ['Gender', 'select', false],
      ['I agree to the privacy policy', 'checkbox', false],
    ]);
    const why = fields.find((f) => f.control === 'textarea')!;
    expect(why.maxLength).toBe(1500);
    const radio = fields.find((f) => f.control === 'radio')!;
    expect(radio.options).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ]);
  });

  it('los ids son estables entre escaneos', () => {
    expect(scanFields(document).fields.map((f) => f.id)).toEqual(scanFields(document).fields.map((f) => f.id));
  });

  it('arma el plan: perfil, CV, preguntas para la IA y datos sensibles a mano', () => {
    const plan = buildFillPlan(scanFields(document).fields, {
      firstName: 'Ana',
      lastName: 'Gómez',
      email: 'ana@example.com',
      phone: '+54 9 11 5555 5555',
      linkedin: 'https://linkedin.com/in/ana',
      workAuthorization: 'No',
    });
    expect(plan.direct.map((d) => d.key)).toEqual(['firstName', 'lastName', 'email', 'phone', 'linkedin', 'workAuthorization']);
    expect(plan.resume.map((f) => f.label)).toEqual(['Resume/CV']);
    expect(plan.questions.map((q) => q.question)).toEqual([
      'Why do you want to work at Acme LATAM?',
      'How did you hear about this job?',
      'Years of experience with React',
    ]);
    expect(plan.questions[1]!.options).toEqual(['LinkedIn', 'Friend or colleague', 'Company website']);
    expect(plan.manual.map((m) => m.field.label)).toEqual(['Gender']);
  });

  it('completa texto avisando con eventos, y no pisa lo que escribió la persona', () => {
    const { field, elements } = byLabel('First Name');
    const input = elements[0] as HTMLInputElement;
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));

    expect(applyValue(field, elements, 'Ana')).toBeNull();
    expect(input.value).toBe('Ana');
    expect(events).toEqual(['input', 'change']);
    // Lo que escribimos nosotros se puede regenerar...
    expect(applyValue(field, elements, 'Ana María')).toBeNull();
    // ...pero si la persona lo cambió, no se toca.
    input.value = 'Anita';
    expect(applyValue(field, elements, 'Ana')).toBe('ya tenía contenido');
  });

  it('elige opciones en selects y radios', () => {
    const how = byLabel('How did you hear about this job?');
    expect(applyValue(how.field, how.elements, 'company website')).toBeNull();
    expect((how.elements[0] as HTMLSelectElement).value).toBe('13');
    expect(applyValue(how.field, how.elements, 'Diario')).toMatch(/ninguna opción/);

    const visa = byLabel('Will you now or in the future require visa sponsorship?');
    expect(applyValue(visa.field, visa.elements, 'No, I do not')).toBeNull();
    expect((visa.elements[1] as HTMLInputElement).checked).toBe(true);
  });

  it('respeta maxlength cortando en una oración y saca el número en inputs numéricos', () => {
    const why = byLabel('Why do you want to work at Acme LATAM?');
    const long = 'Me encanta el producto. '.repeat(100);
    expect(applyValue(why.field, why.elements, long)).toBeNull();
    const value = (why.elements[0] as HTMLTextAreaElement).value;
    expect(value.length).toBeLessThanOrEqual(1500);
    expect(value.endsWith('.')).toBe(true);

    const years = byLabel('Years of experience with React');
    expect(applyValue(years.field, years.elements, '6 años')).toBeNull();
    expect((years.elements[0] as HTMLInputElement).value).toBe('6');
  });
});

describe('Lever (formulario sin descripción)', () => {
  beforeEach(() => load('lever/apply.html'));

  it('lee puesto y empresa pero no confunde el formulario con la descripción', () => {
    const { job } = extractJob(document, 'https://jobs.lever.co/mercadopago/5f2c/apply');
    expect(job).toMatchObject({ title: 'Analista de Datos Sr', company: 'Mercadopago', location: 'Ciudad de México' });
    expect(job!.description).not.toContain('Enviá tu postulación');
  });

  it('toma las etiquetas de los divs .application-label', () => {
    const { fields } = scanFields(document);
    expect(fields.map((f) => [f.label, f.control, f.required])).toEqual([
      ['Currículum', 'file', true],
      ['Nombre completo', 'text', true],
      ['Correo electrónico', 'text', true],
      ['Teléfono', 'text', false],
      ['Empresa actual', 'text', false],
      ['¿Por qué te interesa trabajar en Mercado Pago?', 'textarea', false],
      ['¿Tenés inglés avanzado?', 'radio', false],
    ]);
  });
});
