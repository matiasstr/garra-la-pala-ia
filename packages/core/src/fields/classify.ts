import type { DerivedProfileKey, FieldOption, FormFieldDescriptor, ProfileKey } from '../types';
import { normalizeForMatch, splitCamelCase } from '../text';

export type FieldClassification =
  | { kind: 'profile'; key: ProfileKey | DerivedProfileKey }
  /** Input de archivo donde va el CV. */
  | { kind: 'resume' }
  /** Datos personales o demográficos: los completa la persona, nunca la IA. */
  | { kind: 'sensitive' }
  /** Pregunta para la IA (abierta o con opciones). */
  | { kind: 'question' }
  | { kind: 'skip' };

type ProfileTarget = ProfileKey | DerivedProfileKey;

interface Rule {
  key: ProfileTarget;
  pattern: RegExp;
}

// Todo se compara contra texto normalizado: minúsculas, sin tildes ni puntuación.
const SENSITIVE =
  /\b(gender|genero|sexo|race|raza|etnia|ethnicity|ethnic|veteran|veterano|disability|disabilities|discapacidad|deficiencia|orientacion sexual|sexual orientation|pronouns?|pronombres?|religion|hispanic|latin[ox]|fecha de nacimiento|date of birth|birth ?date|birthday|nacimiento|edad|age|dni|cuil|cuit|rut|cpf|rg|curp|rfc|nss|ssn|social security|pasaporte|passport|documento|identificacion|national id|estado civil|marital|nacionalidad|nationality|address|direccion|domicilio|street|calle|codigo postal|zip|postal code|cep)\b/;

const RESUME = /\b(resume|cv|curriculum|curriculo|hoja de vida)\b/;
const NOT_RESUME = /\b(cover letter|carta de presentacion|carta|portfolio|portafolio|foto|photo|picture|certificado|certificate|transcript)\b/;

/** Se reconocen aunque la etiqueta sea larga o sea una pregunta. */
const STRONG_RULES: Rule[] = [
  { key: 'linkedin', pattern: /linked ?in/ },
  { key: 'github', pattern: /git ?hub/ },
  { key: 'email', pattern: /\b(e ?mail|correo( electronico)?)\b/ },
  { key: 'phone', pattern: /\b(phone|telefono|tel|celular|movil|mobile|whatsapp|telefone|contact number)\b/ },
  {
    key: 'website',
    pattern: /\b(website|web site|portfolio|portafolio|sitio web|pagina web|personal site|blog|behance|dribbble)\b/,
  },
  {
    key: 'salaryExpectation',
    pattern:
      /\b(salary|salario|sueldo|remuneracion|pretension(es)? salarial(es)?|expectativa salarial|compensation|pretensao|desired pay|expected pay)\b/,
  },
  {
    key: 'noticePeriod',
    pattern:
      /\b(notice period|preaviso|aviso previo|start date|fecha de inicio|when can you start|cuando podrias (empezar|comenzar)|earliest start|disponibilidad para (empezar|comenzar|iniciar|incorporarte))\b/,
  },
  {
    key: 'workAuthorization',
    pattern:
      /\b(authori[sz]ed to work|work authori[sz]ation|legally (authori[sz]ed|eligible)|sponsorship|visa|permiso de trabajo|autorizacion (para|de) trabajo|work permit)\b/,
  },
  {
    key: 'yearsOfExperience',
    pattern: /\b(years of (relevant |professional )?experience|anos de experiencia|tempo de experiencia)\b/,
  },
];

/** Solo valen con etiquetas cortas: "Empresa" sí, "¿Por qué esta empresa?" no. */
const WEAK_RULES: Rule[] = [
  { key: 'fullName', pattern: /\b(full name|nombre completo|nombre y apellidos?|nome completo|your name|tu nombre)\b/ },
  { key: 'fullName', pattern: /^(name|nombre|nome)$/ },
  { key: 'lastName', pattern: /\b(last name|lastname|surname|family name|apellidos?|sobrenome)\b/ },
  {
    key: 'currentCompany',
    pattern: /\b(current (company|employer)|empresa actual|empleador actual|compania actual|empresa atual|company|empresa)\b/,
  },
  {
    key: 'currentTitle',
    pattern: /\b(current (title|role|position|job title)|job title|cargo actual|puesto actual|titulo actual|cargo atual|headline)\b/,
  },
  { key: 'firstName', pattern: /\b(first name|firstname|given name|primer nombre|nombres?|nome|preferred name)\b/ },
  { key: 'city', pattern: /\b(city|ciudad|localidad|cidade|town)\b/ },
  { key: 'country', pattern: /\b(country|pais)\b/ },
  {
    key: 'location',
    pattern: /\b(location|ubicacion|current location|where are you (located|based)|donde vivis|residencia|localizacao)\b/,
  },
];

const AUTOCOMPLETE: Record<string, ProfileTarget> = {
  'given-name': 'firstName',
  'family-name': 'lastName',
  name: 'fullName',
  email: 'email',
  tel: 'phone',
  'tel-national': 'phone',
  'address-level2': 'city',
  country: 'country',
  'country-name': 'country',
  organization: 'currentCompany',
  'organization-title': 'currentTitle',
  url: 'website',
};

function isShortLabel(label: string): boolean {
  return label.length <= 45 && !/[?¿]/.test(label);
}

function matchRules(text: string, rules: Rule[]): ProfileTarget | undefined {
  return rules.find((r) => r.pattern.test(text))?.key;
}

/** Clasifica un campo suelto. Para un formulario entero usá classifyFields (corrige ambigüedades). */
export function classifyField(field: FormFieldDescriptor): FieldClassification {
  const label = normalizeForMatch(field.label);
  const attrs = normalizeForMatch(splitCamelCase([field.name, field.htmlId, field.placeholder].filter(Boolean).join(' ')));

  if (field.control === 'file') {
    const text = `${label} ${attrs}`;
    if (NOT_RESUME.test(text)) return { kind: 'skip' };
    return RESUME.test(text) ? { kind: 'resume' } : { kind: 'skip' };
  }

  if (SENSITIVE.test(label) || (!label && SENSITIVE.test(attrs))) return { kind: 'sensitive' };

  const auto = field.autocomplete?.trim().toLowerCase().split(/\s+/).pop();
  if (auto && AUTOCOMPLETE[auto]) return { kind: 'profile', key: AUTOCOMPLETE[auto] };

  const short = isShortLabel(field.label);
  const fromLabel = matchRules(label, STRONG_RULES) ?? (short ? matchRules(label, WEAK_RULES) : undefined);
  if (fromLabel) return { kind: 'profile', key: fromLabel };

  // Etiqueta vacía o poco clara: probamos con name/id/placeholder.
  if (!label || short) {
    const fromAttrs = matchRules(attrs, STRONG_RULES) ?? matchRules(attrs, WEAK_RULES);
    if (fromAttrs) return { kind: 'profile', key: fromAttrs };
  }

  if (field.inputType === 'email') return { kind: 'profile', key: 'email' };
  if (field.inputType === 'tel') return { kind: 'profile', key: 'phone' };
  if (field.inputType === 'url') return { kind: 'profile', key: 'website' };

  if (field.control === 'checkbox') return { kind: 'skip' };
  if (!field.label.trim()) return { kind: 'skip' };
  return { kind: 'question' };
}

export interface ClassifiedField {
  field: FormFieldDescriptor;
  classification: FieldClassification;
}

/** Clasifica todos los campos de un formulario y resuelve casos que dependen del conjunto. */
export function classifyFields(fields: FormFieldDescriptor[]): ClassifiedField[] {
  const result = fields.map((field) => ({ field, classification: classifyField(field) }));
  const keys = new Set(result.flatMap((r) => (r.classification.kind === 'profile' ? [r.classification.key] : [])));

  for (const r of result) {
    const c = r.classification;
    // "Nombre" + "Apellido" en campos separados: "Nombre" es el primer nombre.
    if (c.kind === 'profile' && c.key === 'fullName' && keys.has('lastName') && /^(name|nombres?|nome)$/.test(normalizeForMatch(r.field.label))) {
      r.classification = { kind: 'profile', key: 'firstName' };
    }
  }

  // Un único input de archivo sin etiqueta clara: casi seguro es el CV.
  const files = result.filter((r) => r.field.control === 'file');
  const only = files[0];
  if (files.length === 1 && only && only.classification.kind === 'skip') {
    const text = normalizeForMatch(`${only.field.label} ${splitCamelCase(only.field.name ?? '')}`);
    if (!NOT_RESUME.test(text)) only.classification = { kind: 'resume' };
  }
  return result;
}

const PLACEHOLDER_OPTION = /^(select|seleccion\w*|selecione|elegi\w*|escolha|choose|please select|--+|-|ninguno seleccionado)?$/;

export function isPlaceholderOption(option: FieldOption): boolean {
  return !option.value.trim() || PLACEHOLDER_OPTION.test(normalizeForMatch(option.label));
}

const YES = new Set(['si', 'yes', 'sim', 'true', 'y']);
const NO = new Set(['no', 'nao', 'false', 'n']);

/** Elige la opción que mejor coincide con un valor libre ("Sí, tengo permiso" -> "Sí"). */
export function chooseOption(options: FieldOption[], wanted: string): FieldOption | undefined {
  const w = normalizeForMatch(wanted);
  if (!w) return undefined;
  const candidates = options
    .filter((o) => !isPlaceholderOption(o))
    .map((o) => ({ o, label: normalizeForMatch(o.label), value: normalizeForMatch(o.value) }));

  const exact = candidates.find((c) => c.label === w || c.value === w);
  if (exact) return exact.o;

  const firstWord = w.split(' ')[0] ?? '';
  for (const set of [YES, NO]) {
    if (set.has(firstWord)) {
      const hit = candidates.find((c) => set.has(c.label.split(' ')[0] ?? ''));
      if (hit) return hit.o;
    }
  }

  const prefix = candidates.find((c) => c.label.length >= 2 && (c.label.startsWith(w) || w.startsWith(c.label)));
  if (prefix) return prefix.o;
  return candidates.find((c) => c.label.length >= 3 && (c.label.includes(w) || w.includes(c.label)))?.o;
}
