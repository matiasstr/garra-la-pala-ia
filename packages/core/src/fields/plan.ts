import type { CandidateProfile, DerivedProfileKey, FormFieldDescriptor, ProfileKey, QuestionForAi } from '../types';
import { chooseOption, classifyFields, isPlaceholderOption } from './classify';

export interface PlannedValue {
  field: FormFieldDescriptor;
  value: string;
  key: ProfileKey | DerivedProfileKey;
}

export interface ManualField {
  field: FormFieldDescriptor;
  reason: string;
}

export interface FillPlan {
  /** Se completan directo desde el perfil, sin IA. */
  direct: PlannedValue[];
  /** Inputs de archivo donde va el CV. */
  resume: FormFieldDescriptor[];
  /** Van a la IA (Codex/ChatGPT o API). */
  questions: QuestionForAi[];
  /** Quedan para la persona. */
  manual: ManualField[];
}

/** Datos que la IA no puede sacar del CV: si faltan en el perfil, se completan a mano. */
const NEVER_INVENT: ReadonlySet<string> = new Set(['salaryExpectation', 'noticePeriod', 'workAuthorization']);

export function profileValue(profile: CandidateProfile, key: ProfileKey | DerivedProfileKey): string | undefined {
  let value: string | undefined;
  if (key === 'fullName') value = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  else if (key === 'location') value = [profile.city, profile.country].filter(Boolean).join(', ');
  else value = profile[key];
  return value?.trim() || undefined;
}

export function toQuestion(field: FormFieldDescriptor): QuestionForAi {
  const question: QuestionForAi = {
    id: field.id,
    question: field.label,
    control: field.control,
    required: field.required,
  };
  if (field.maxLength) question.maxLength = field.maxLength;
  const options = field.options?.filter((o) => !isPlaceholderOption(o)).map((o) => o.label);
  if (options?.length) question.options = options;
  return question;
}

function hasValue(field: FormFieldDescriptor): boolean {
  return Boolean(field.currentValue?.trim());
}

/**
 * Decide qué hacer con cada campo del formulario. No toca el DOM:
 * la extensión aplica el plan y la web lo puede reutilizar.
 */
export function buildFillPlan(
  fields: FormFieldDescriptor[],
  profile: CandidateProfile,
  opts: { includeFilled?: boolean } = {},
): FillPlan {
  const plan: FillPlan = { direct: [], resume: [], questions: [], manual: [] };

  for (const { field, classification: c } of classifyFields(fields)) {
    // Lo que ya tiene contenido no se pisa (lo escribió la persona o el sitio lo precargó).
    if (!opts.includeFilled && hasValue(field)) continue;

    switch (c.kind) {
      case 'resume':
        plan.resume.push(field);
        break;
      case 'sensitive':
        plan.manual.push({ field, reason: 'Dato personal: completalo vos.' });
        break;
      case 'profile': {
        const value = profileValue(profile, c.key);
        const options = field.options ?? [];
        if (value && (options.length === 0 || chooseOption(options, value))) {
          plan.direct.push({ field, value, key: c.key });
        } else if (value) {
          // Hay dato pero no coincide con ninguna opción: que la IA elija la opción con el perfil a la vista.
          plan.questions.push(toQuestion(field));
        } else if (NEVER_INVENT.has(c.key)) {
          plan.manual.push({ field, reason: 'Falta en tu perfil (Opciones).' });
        } else {
          // Nombre, mail, cargo actual... la IA lo puede sacar del CV.
          plan.questions.push(toQuestion(field));
        }
        break;
      }
      case 'question':
        plan.questions.push(toQuestion(field));
        break;
      case 'skip':
        if (field.control === 'file' && field.required) plan.manual.push({ field, reason: 'Archivo: subilo a mano.' });
        break;
    }
  }
  return plan;
}
