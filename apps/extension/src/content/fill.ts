import { chooseOption, type CvDocument, type FormFieldDescriptor } from '@garra/core';
import { base64ToBytes } from '../lib/base64';
import type { FillableElement } from './fields';

/** Lo que escribimos nosotros: se puede pisar al regenerar, lo que escribió la persona no. */
const filledByGarra = new WeakMap<Element, string>();

function canOverwrite(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  return !el.value.trim() || filledByGarra.get(el) === el.value;
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
}

function fire(el: Element, ...types: string[]): void {
  for (const type of types) el.dispatchEvent(new Event(type, { bubbles: true }));
}

export function highlight(el: Element, needsReview = false): void {
  const target = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'file') ? (el.parentElement ?? el) : el;
  (target as HTMLElement).style.outline = `2px solid ${needsReview ? '#f59e0b' : '#22c55e'}`;
  (target as HTMLElement).style.outlineOffset = '2px';
}

/** Escribe un valor de forma que React, Vue y Angular se enteren del cambio. */
function setText(el: HTMLInputElement | HTMLTextAreaElement, raw: string, maxLength?: number): boolean {
  let value = raw;
  if (el instanceof HTMLInputElement && el.type === 'number') {
    const number = raw.match(/-?\d+(?:[.,]\d+)?/)?.[0];
    if (!number) return false;
    value = number.replace(',', '.');
  }
  if (maxLength) value = cutAtWord(value, maxLength);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  el.focus({ preventScroll: true });
  if (setter) setter.call(el, value);
  else el.value = value;
  fire(el, 'input', 'change');
  el.blur();
  filledByGarra.set(el, el.value);
  return el.value === value;
}

/**
 * Completa un campo con un valor libre. Devuelve null si salió bien,
 * o el motivo por el que no se pudo.
 */
export function applyValue(field: FormFieldDescriptor, elements: FillableElement[], value: string, needsReview = false): string | null {
  const el = elements[0];
  if (!el) return 'el campo ya no está en la página';
  if (!el.isConnected) return 'el campo ya no está en la página';

  switch (field.control) {
    case 'text':
    case 'textarea': {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      if (!canOverwrite(input)) return 'ya tenía contenido';
      if (!setText(input, value, field.maxLength)) return 'el sitio no aceptó el valor';
      highlight(input, needsReview);
      return null;
    }
    case 'select': {
      const option = chooseOption(field.options ?? [], value);
      if (!option) return `ninguna opción coincide con "${value}"`;
      const select = el as HTMLSelectElement;
      select.value = option.value;
      fire(select, 'input', 'change');
      highlight(select, needsReview);
      return null;
    }
    case 'radio': {
      const options = field.options ?? [];
      const option = chooseOption(options, value);
      const radio = option ? (elements[options.indexOf(option)] as HTMLInputElement | undefined) : undefined;
      if (!radio) return `ninguna opción coincide con "${value}"`;
      if (!radio.checked) radio.click();
      highlight(radio, needsReview);
      return null;
    }
    default:
      return 'tipo de campo no soportado';
  }
}

/** Adjunta el CV en un input type=file. */
export function attachFile(input: HTMLInputElement, cv: CvDocument): string | null {
  if (!cv.dataBase64) return 'este CV se cargó como texto, no hay archivo para adjuntar';
  const accept = input.accept.toLowerCase();
  if (accept && !accept.split(',').some((a) => {
    const rule = a.trim();
    return rule === cv.mimeType || cv.fileName.toLowerCase().endsWith(rule) || (rule.endsWith('/*') && cv.mimeType.startsWith(rule.slice(0, -1)));
  })) {
    return `el sitio solo acepta ${input.accept}`;
  }
  const file = new File([base64ToBytes(cv.dataBase64)], cv.fileName, { type: cv.mimeType });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  fire(input, 'input', 'change');
  highlight(input);
  return input.files?.length ? null : 'el sitio no aceptó el archivo';
}
