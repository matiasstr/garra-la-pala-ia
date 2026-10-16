import {
  PROVIDER_PRESETS,
  normalizeWhitespace,
  type CandidateProfile,
  type CvDocument,
  type ProfileKey,
  type ProviderConfig,
  type ProviderPresetId,
} from '@garra/core';
import { bytesToBase64 } from '../lib/base64';
import { sendToBackground } from '../lib/messages';
import { getState, setState } from '../lib/storage';
import { pdfToText } from './pdf';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

let toastTimer: number | undefined;
function toast(text: string): void {
  const box = $('#toast');
  box.textContent = text;
  box.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (box.hidden = true), 2200);
}

// ---------- Perfil ----------

const PROFILE_FIELDS: Array<{ key: ProfileKey; label: string; type?: string; placeholder?: string; wide?: boolean }> = [
  { key: 'firstName', label: 'Nombre' },
  { key: 'lastName', label: 'Apellido' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Teléfono', type: 'tel', placeholder: '+54 9 11 1234 5678' },
  { key: 'city', label: 'Ciudad' },
  { key: 'country', label: 'País' },
  { key: 'linkedin', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/...' },
  { key: 'github', label: 'GitHub', type: 'url' },
  { key: 'website', label: 'Portfolio / sitio web', type: 'url' },
  { key: 'currentTitle', label: 'Cargo actual' },
  { key: 'currentCompany', label: 'Empresa actual' },
  { key: 'yearsOfExperience', label: 'Años de experiencia', placeholder: '5' },
  { key: 'salaryExpectation', label: 'Pretensión salarial', placeholder: 'USD 3.000 brutos mensuales' },
  { key: 'noticePeriod', label: 'Disponibilidad / preaviso', placeholder: '2 semanas' },
  { key: 'workAuthorization', label: 'Permiso de trabajo', placeholder: 'Ciudadana argentina, no necesito visa' },
  { key: 'notes', label: 'Notas para la IA (qué buscás, tono, cosas a destacar)', wide: true },
];

async function renderProfile(): Promise<void> {
  const { profile } = await getState('profile');
  const form = $<HTMLFormElement>('#profile');
  form.replaceChildren(
    ...PROFILE_FIELDS.map(({ key, label, type, placeholder, wide }) => {
      let input: HTMLInputElement | HTMLTextAreaElement;
      if (key === 'notes') input = el('textarea', { name: key, rows: 3 });
      else input = el('input', { name: key, type: type ?? 'text' });
      input.value = profile[key] ?? '';
      input.placeholder = placeholder ?? '';
      const wrapper = el('label', { className: wide ? 'wide' : '' });
      wrapper.append(label, input);
      return wrapper;
    }),
  );
  let timer: number | undefined;
  form.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const data = new FormData(form);
      const next: CandidateProfile = {};
      for (const { key } of PROFILE_FIELDS) {
        const value = String(data.get(key) ?? '').trim();
        if (value) next[key] = value;
      }
      await setState({ profile: next });
      toast('Perfil guardado');
    }, 500);
  });
}

// ---------- CVs ----------

async function saveCvs(update: (cvs: CvDocument[]) => CvDocument[]): Promise<void> {
  const { cvs } = await getState('cvs');
  await setState({ cvs: update(cvs) });
  await renderCvs();
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Mi CV';
}

async function readCvFile(file: File): Promise<CvDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const text = isPdf ? await pdfToText(bytes) : normalizeWhitespace(new TextDecoder().decode(bytes));
  return {
    id: crypto.randomUUID(),
    name: baseName(file.name),
    fileName: file.name,
    mimeType: isPdf ? 'application/pdf' : file.type || 'text/plain',
    text,
    dataBase64: bytesToBase64(bytes),
    addedAt: Date.now(),
  };
}

async function onCvFiles(files: FileList | null): Promise<void> {
  for (const file of files ?? []) {
    if (file.size > 8 * 1024 * 1024) {
      toast(`${file.name}: pesa más de 8 MB`);
      continue;
    }
    if (/\.(docx?|odt|pages)$/i.test(file.name)) {
      toast(`${file.name}: guardalo como PDF y subilo de nuevo`);
      continue;
    }
    try {
      const cv = await readCvFile(file);
      await saveCvs((cvs) => [...cvs, cv]);
      toast(cv.text.length < 200 ? `${file.name}: casi no tiene texto (¿es un escaneo?). Pegá el texto a mano.` : `CV "${cv.name}" agregado`);
    } catch (err) {
      console.error(err);
      toast(`No pude leer ${file.name}`);
    }
  }
}

async function renderCvs(): Promise<void> {
  const { cvs } = await getState('cvs');
  const list = $('#cv-list');
  if (!cvs.length) {
    list.replaceChildren(el('li', { className: 'muted' }, 'Todavía no subiste ningún CV.'));
    return;
  }
  list.replaceChildren(
    ...cvs.map((cv) => {
      const name = el('input', { type: 'text', value: cv.name, title: 'Nombre visible' });
      name.addEventListener('change', () => void saveCvs((all) => all.map((c) => (c.id === cv.id ? { ...c, name: name.value.trim() || c.name } : c))));
      const remove = el('button', { type: 'button', className: 'danger', textContent: 'Borrar' });
      remove.addEventListener('click', () => {
        if (confirm(`¿Borrar "${cv.name}"?`)) void saveCvs((all) => all.filter((c) => c.id !== cv.id));
      });
      const words = cv.text.split(/\s+/).filter(Boolean).length;
      return el(
        'li',
        { className: 'card' },
        el('div', { className: 'head' }, name, remove),
        el(
          'div',
          { className: 'meta' },
          `${cv.fileName} · ${words.toLocaleString('es-AR')} palabras${cv.dataBase64 ? ' · se adjunta en los formularios' : ' · solo texto (no se adjunta)'}`,
        ),
        el('details', {}, el('summary', {}, 'Ver el texto que se le manda a la IA'), el('pre', {}, cv.text || '(vacío)')),
      );
    }),
  );
}

// ---------- APIs ----------

function newProvider(preset: ProviderPresetId): ProviderConfig {
  const p = PROVIDER_PRESETS[preset];
  return {
    id: crypto.randomUUID(),
    preset,
    label: p.label,
    baseUrl: p.baseUrl,
    model: p.model,
    apiKey: '',
    enabled: true,
    jsonMode: true,
  };
}

async function saveProviders(update: (list: ProviderConfig[]) => ProviderConfig[], rerender = true): Promise<void> {
  const { providers } = await getState('providers');
  await setState({ providers: update(providers) });
  if (rerender) await renderProviders();
}

function providerCard(config: ProviderConfig, index: number, total: number): HTMLLIElement {
  const preset = PROVIDER_PRESETS[config.preset];
  const patch = (changes: Partial<ProviderConfig>) =>
    void saveProviders((all) => all.map((c) => (c.id === config.id ? { ...c, ...changes } : c)), false).then(() => toast('API guardada'));

  const input = (label: string, key: 'baseUrl' | 'model' | 'apiKey', type = 'text', placeholder = '') => {
    const field = el('input', { type, value: config[key], placeholder });
    field.addEventListener('change', () => patch({ [key]: field.value.trim() }));
    return el('label', {}, label, field);
  };
  const check = (label: string, key: 'enabled' | 'jsonMode') => {
    const box = el('input', { type: 'checkbox', checked: config[key] });
    box.addEventListener('change', () => patch({ [key]: box.checked }));
    return el('label', { className: 'check' }, box, label);
  };
  const action = (text: string, onClick: () => void, className = '') => {
    const button = el('button', { type: 'button', textContent: text, className });
    button.addEventListener('click', onClick);
    return button;
  };
  const move = (delta: number) =>
    saveProviders((all) => {
      const copy = [...all];
      const [item] = copy.splice(index, 1);
      copy.splice(index + delta, 0, item!);
      return copy;
    });

  const result = el('div', { className: 'result' });
  const test = async () => {
    result.className = 'result';
    result.textContent = 'Probando...';
    const { providers } = await getState('providers');
    const current = providers.find((c) => c.id === config.id) ?? config;
    const response = await sendToBackground<string>({ type: 'test-provider', config: current });
    result.className = `result ${response.ok ? 'ok' : 'error'}`;
    result.textContent = response.ok ? `Funciona. Respondió: ${response.data}` : response.error;
  };

  const head = el(
    'div',
    { className: 'head' },
    el('strong', { className: 'grow' }, `${index + 1}. ${config.label}`),
    action('↑', () => void move(-1)),
    action('↓', () => void move(1)),
    action('Probar', () => void test()),
    action('Borrar', () => void saveProviders((all) => all.filter((c) => c.id !== config.id)), 'danger'),
  );
  (head.children[1] as HTMLButtonElement).disabled = index === 0;
  (head.children[2] as HTMLButtonElement).disabled = index === total - 1;

  return el(
    'li',
    { className: 'card' },
    head,
    el(
      'div',
      { className: 'meta' },
      preset.note,
      ...(preset.keyUrl ? [' ', el('a', { href: preset.keyUrl, target: '_blank', rel: 'noreferrer', textContent: 'Sacar API key' })] : []),
    ),
    el(
      'div',
      { className: 'fields' },
      input('API key', 'apiKey', 'password', 'pegá tu key'),
      input('Modelo', 'model', 'text', preset.model || 'nombre del modelo'),
      input('URL base', 'baseUrl', 'text', 'https://.../v1'),
    ),
    el('div', { className: 'row' }, check('Activa', 'enabled'), check('Pedir respuesta en JSON', 'jsonMode')),
    result,
  );
}

async function renderProviders(): Promise<void> {
  const { providers } = await getState('providers');
  const list = $('#provider-list');
  if (!providers.length) {
    list.replaceChildren(el('li', { className: 'muted' }, 'Sin APIs. Recomendado: Groq como primera y Gemini u OpenRouter de respaldo.'));
  } else {
    list.replaceChildren(...providers.map((c, i) => providerCard(c, i, providers.length)));
  }
}

// ---------- Inicio ----------

function init(): void {
  const presetSelect = $<HTMLSelectElement>('#provider-preset');
  presetSelect.append(
    ...(Object.keys(PROVIDER_PRESETS) as ProviderPresetId[]).map((id) => el('option', { value: id, textContent: PROVIDER_PRESETS[id].label })),
  );
  $('#provider-add').addEventListener('click', () => void saveProviders((all) => [...all, newProvider(presetSelect.value as ProviderPresetId)]));

  const fileInput = $<HTMLInputElement>('#cv-file');
  fileInput.addEventListener('change', () => void onCvFiles(fileInput.files).then(() => (fileInput.value = '')));

  $('#cv-paste-add').addEventListener('click', () => {
    const name = $<HTMLInputElement>('#cv-paste-name');
    const text = $<HTMLTextAreaElement>('#cv-paste-text');
    const content = normalizeWhitespace(text.value);
    if (content.length < 50) return toast('Pegá el texto completo del CV');
    const cv: CvDocument = {
      id: crypto.randomUUID(),
      name: name.value.trim() || 'CV (texto)',
      fileName: 'cv.txt',
      mimeType: 'text/plain',
      text: content,
      addedAt: Date.now(),
    };
    void saveCvs((cvs) => [...cvs, cv]).then(() => {
      name.value = '';
      text.value = '';
      toast(`CV "${cv.name}" agregado`);
    });
  });

  void renderProfile();
  void renderCvs();
  void renderProviders();
}

init();
