import { isPlaceholderOption, shortHash, type FieldControl, type FieldOption, type FormFieldDescriptor } from '@garra/core';
import { textOf } from './extractors/dom';

export type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface ScanResult {
  fields: FormFieldDescriptor[];
  /** Elementos de cada campo (varios en un grupo de radios). */
  elements: Map<string, FillableElement[]>;
}

// Fechas y horas quedan afuera: cada sitio usa un formato distinto y es fácil romperlas.
const SKIP_INPUT_TYPES = new Set([
  'hidden', 'submit', 'button', 'reset', 'image', 'password', 'search', 'range', 'color',
  'date', 'month', 'week', 'time', 'datetime-local',
]);

const LABELISH = 'label, legend, [class*="label" i], [class*="question" i], [class*="title" i], h3, h4, h5, p, span, div';

function isHidden(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"], template')) return true;
  const view = el.ownerDocument.defaultView;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
  }
  return false;
}

/** Texto de un elemento sin el de los controles que tenga adentro. */
function ownText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('input, select, textarea, option, script, style, button, svg').forEach((n) => n.remove());
  return textOf(clone);
}

function cleanLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*[*✱]+\s*$/, '')
    .replace(/\s*\((required|requerido|obligatorio|opcional|optional|obrigatorio)\)\s*$/i, '')
    .trim()
    .slice(0, 300);
}

/** El texto tipo etiqueta más cercano que esté antes del control (sube hasta 6 niveles). */
function nearestLabelish(el: Element, exclude: Element[]): string {
  let ancestor = el.parentElement;
  for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) {
    const others = [...ancestor.querySelectorAll('input:not([type="hidden"]), select, textarea')].filter(
      (c) => c !== el && !exclude.includes(c),
    );
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const candidates = [...ancestor.querySelectorAll(LABELISH)].filter((c) => {
      if (c.contains(el) || exclude.some((x) => c.contains(x))) return false;
      if (!follows(c, el)) return false;
      if (c instanceof HTMLLabelElement && c.control && c.control !== el) return false;
      // Si hay otro control entre el texto y este campo, el texto es de ese otro campo.
      if (others.some((o) => follows(c, o) && follows(o, el))) return false;
      return true;
    });
    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = candidates[i]!;
      // Un div con muchos hijos no es una etiqueta.
      if (candidate.tagName === 'DIV' && candidate.children.length > 2) continue;
      const text = ownText(candidate);
      // Saltea marcas sueltas como el "*" de obligatorio.
      if (/\p{L}/u.test(text) && text.length <= 300) return text;
    }
  }
  return '';
}

function labelFor(el: FillableElement, exclude: Element[] = [el]): string {
  const doc = el.ownerDocument;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => doc.getElementById(id))
      .filter((n): n is HTMLElement => !!n)
      .map(ownText)
      .join(' ');
    if (text.trim()) return text;
  }
  for (const label of el.labels ?? []) {
    const text = ownText(label);
    if (text) return text;
  }
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria;
  return nearestLabelish(el, exclude) || el.getAttribute('placeholder') || el.getAttribute('title') || '';
}

/** Etiqueta de la pregunta de un grupo de radios/checkboxes (no la de cada opción). */
function groupLabel(inputs: HTMLInputElement[]): string {
  const first = inputs[0]!;
  const legend = first.closest('fieldset')?.querySelector('legend');
  if (legend) return ownText(legend);
  const group = first.closest('[role="radiogroup"], [role="group"]');
  const named = group?.getAttribute('aria-label') ?? '';
  if (named.trim()) return named;
  const labelledBy = group?.getAttribute('aria-labelledby');
  const byId = labelledBy ? first.ownerDocument.getElementById(labelledBy) : null;
  if (byId) return ownText(byId);
  return nearestLabelish(first, inputs);
}

function optionLabel(input: HTMLInputElement): string {
  for (const label of input.labels ?? []) {
    const text = ownText(label);
    if (text) return text;
  }
  const next = input.nextSibling?.textContent?.trim();
  return next || input.value;
}

function controlOf(el: FillableElement): FieldControl | null {
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLSelectElement) return 'select';
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  if (SKIP_INPUT_TYPES.has(type)) return null;
  if (type === 'radio' || type === 'checkbox' || type === 'file') return type;
  return 'text';
}

function currentValue(control: FieldControl, elements: FillableElement[], options?: FieldOption[]): string {
  const el = elements[0]!;
  switch (control) {
    case 'radio':
    case 'checkbox':
      return (elements as HTMLInputElement[]).filter((r) => r.checked).map((r) => r.value).join(', ');
    case 'file':
      return (el as HTMLInputElement).files?.[0]?.name ?? '';
    case 'select': {
      const selected = options?.find((o) => o.value === el.value);
      return selected && !isPlaceholderOption(selected) ? el.value : '';
    }
    default:
      return el.value;
  }
}

/** Detecta los campos completables de un documento (o de un formulario). */
export function scanFields(root: Document | Element): ScanResult {
  const fields: FormFieldDescriptor[] = [];
  const elements = new Map<string, FillableElement[]>();
  const seenGroups = new Set<string>();
  const usedIds = new Map<string, number>();

  for (const el of root.querySelectorAll<FillableElement>('input, textarea, select')) {
    const control = controlOf(el);
    if (!control || el.disabled || (el instanceof HTMLInputElement && el.readOnly && control === 'text')) continue;

    let group: FillableElement[] = [el];
    if ((control === 'radio' || control === 'checkbox') && el.name) {
      const key = `${control}:${el.form?.id ?? ''}:${el.name}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
      const scope = el.form ?? el.ownerDocument;
      group = [...scope.querySelectorAll<HTMLInputElement>(`input[type="${control}"]`)].filter((r) => r.name === el.name);
    }

    // Archivos, radios y checkboxes suelen estar ocultos con estilos: miramos el contenedor.
    const visibilityTarget = control === 'text' || control === 'textarea' || control === 'select' ? el : (el.parentElement ?? el);
    if (isHidden(visibilityTarget)) continue;

    const rawLabel = group.length > 1 ? groupLabel(group as HTMLInputElement[]) : labelFor(el);
    const label = cleanLabel(rawLabel);
    const name = el.getAttribute('name') ?? undefined;
    const htmlId = el.id || undefined;

    let options: FieldOption[] | undefined;
    if (el instanceof HTMLSelectElement) {
      options = [...el.options].map((o) => ({ value: o.value, label: textOf(o) || o.label }));
    } else if (group.length > 1 || control === 'radio') {
      options = (group as HTMLInputElement[]).map((r) => ({ value: r.value, label: cleanLabel(optionLabel(r)) }));
    }

    const base = `f${shortHash(`${control}|${name ?? ''}|${htmlId ?? ''}|${label}`)}`;
    const count = (usedIds.get(base) ?? 0) + 1;
    usedIds.set(base, count);
    const id = count > 1 ? `${base}-${count}` : base;

    const field: FormFieldDescriptor = {
      id,
      control,
      label,
      required: el.required || el.getAttribute('aria-required') === 'true' || /[*✱]\s*$/.test(rawLabel.trim()),
      currentValue: currentValue(control, group, options),
    };
    if (el instanceof HTMLInputElement) field.inputType = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (name) field.name = name;
    if (htmlId) field.htmlId = htmlId;
    const autocomplete = el.getAttribute('autocomplete');
    if (autocomplete && autocomplete !== 'off' && autocomplete !== 'on') field.autocomplete = autocomplete;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) field.placeholder = placeholder;
    if ('maxLength' in el && el.maxLength > 0 && el.maxLength < 100_000) field.maxLength = el.maxLength;
    if (options) field.options = options;

    fields.push(field);
    elements.set(id, group);
  }
  return { fields, elements };
}
