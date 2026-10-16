import { describe, expect, it } from 'vitest';
import { buildFillPlan, chooseOption, classifyField, classifyFields, type FormFieldDescriptor } from '../src';

let n = 0;
function field(label: string, extra: Partial<FormFieldDescriptor> = {}): FormFieldDescriptor {
  return { id: `f${++n}`, control: 'text', label, required: false, ...extra };
}

describe('classifyField', () => {
  it.each([
    ['First Name', 'firstName'],
    ['Apellido *', 'lastName'],
    ['Nombre completo', 'fullName'],
    ['E-mail', 'email'],
    ['Correo electrónico', 'email'],
    ['Teléfono celular', 'phone'],
    ['Telefone', 'phone'],
    ['LinkedIn Profile', 'linkedin'],
    ['What is your LinkedIn URL?', 'linkedin'],
    ['GitHub', 'github'],
    ['Portfolio', 'website'],
    ['Ciudad', 'city'],
    ['País', 'country'],
    ['Empresa actual', 'currentCompany'],
    ['Current job title', 'currentTitle'],
    ['¿Cuál es tu expectativa salarial?', 'salaryExpectation'],
    ['Pretensión salarial bruta', 'salaryExpectation'],
    ['Are you legally authorized to work in Brazil?', 'workAuthorization'],
    ['Years of experience with React', 'yearsOfExperience'],
    ['Location', 'location'],
  ])('"%s" -> %s', (label, key) => {
    expect(classifyField(field(label))).toEqual({ kind: 'profile', key });
  });

  it('una pregunta larga que menciona "empresa" va a la IA', () => {
    expect(classifyField(field('¿Por qué querés trabajar en esta empresa?', { control: 'textarea' }))).toEqual({
      kind: 'question',
    });
  });

  it.each(['Gender', 'Género', 'DNI', 'Fecha de nacimiento', 'Are you a veteran?', 'CPF', 'Dirección'])(
    '"%s" es sensible',
    (label) => {
      expect(classifyField(field(label)).kind).toBe('sensitive');
    },
  );

  it('usa autocomplete, name/id y el type del input cuando la etiqueta no alcanza', () => {
    expect(classifyField(field('', { autocomplete: 'given-name' }))).toEqual({ kind: 'profile', key: 'firstName' });
    expect(classifyField(field('', { name: 'job_application[last_name]' }))).toEqual({ kind: 'profile', key: 'lastName' });
    expect(classifyField(field('', { htmlId: 'linkedInUrl' }))).toEqual({ kind: 'profile', key: 'linkedin' });
    expect(classifyField(field('Contacto', { inputType: 'email' }))).toEqual({ kind: 'profile', key: 'email' });
  });

  it('archivos: CV sí, carta de presentación no', () => {
    expect(classifyField(field('Resume/CV', { control: 'file' }))).toEqual({ kind: 'resume' });
    expect(classifyField(field('Cover Letter', { control: 'file' }))).toEqual({ kind: 'skip' });
  });
});

describe('classifyFields', () => {
  it('"Nombre" junto a "Apellido" es el primer nombre', () => {
    const result = classifyFields([field('Nombre'), field('Apellido')]);
    expect(result.map((r) => r.classification)).toEqual([
      { kind: 'profile', key: 'firstName' },
      { kind: 'profile', key: 'lastName' },
    ]);
  });

  it('un único archivo sin etiqueta clara es el CV', () => {
    const [r] = classifyFields([field('Adjuntar archivo', { control: 'file' })]);
    expect(r!.classification).toEqual({ kind: 'resume' });
  });
});

describe('chooseOption', () => {
  const yesNo = [
    { value: '', label: 'Seleccioná...' },
    { value: '1', label: 'Sí' },
    { value: '0', label: 'No' },
  ];
  it('entiende sí/no en varios idiomas', () => {
    expect(chooseOption(yesNo, 'Yes')?.value).toBe('1');
    expect(chooseOption(yesNo, 'Sí, tengo permiso')?.value).toBe('1');
    expect(chooseOption(yesNo, 'não')?.value).toBe('0');
  });
  it('coincide por texto aunque cambien tildes y mayúsculas', () => {
    const countries = [
      { value: 'ar', label: 'Argentina' },
      { value: 'mx', label: 'México' },
    ];
    expect(chooseOption(countries, 'mexico')?.value).toBe('mx');
    expect(chooseOption(countries, 'Chile')).toBeUndefined();
  });
});

describe('buildFillPlan', () => {
  it('reparte los campos entre perfil, CV, IA y a mano', () => {
    const fields = [
      field('First Name'),
      field('Last Name'),
      field('Email', { inputType: 'email' }),
      field('Phone', { currentValue: '+54 11 5555' }),
      field('Resume', { control: 'file' }),
      field('Current company'),
      field('Expected salary'),
      field('Gender', { control: 'select', options: [{ value: 'm', label: 'Male' }] }),
      field('Why do you want to join Acme?', { control: 'textarea', maxLength: 1000 }),
      field('Do you require sponsorship?', {
        control: 'radio',
        options: [
          { value: 'y', label: 'Yes' },
          { value: 'n', label: 'No' },
        ],
      }),
    ];
    const plan = buildFillPlan(fields, {
      firstName: 'Ana',
      lastName: 'Gómez',
      email: 'ana@example.com',
      workAuthorization: 'No, tengo ciudadanía',
    });

    expect(plan.direct.map((d) => [d.field.label, d.value])).toEqual([
      ['First Name', 'Ana'],
      ['Last Name', 'Gómez'],
      ['Email', 'ana@example.com'],
      ['Do you require sponsorship?', 'No, tengo ciudadanía'],
    ]);
    expect(plan.resume.map((f) => f.label)).toEqual(['Resume']);
    expect(plan.questions.map((q) => q.question)).toEqual(['Current company', 'Why do you want to join Acme?']);
    expect(plan.questions[1]).toMatchObject({ control: 'textarea', maxLength: 1000 });
    expect(plan.manual.map((m) => m.field.label)).toEqual(['Expected salary', 'Gender']);
  });
});
