// Panel flotante dentro de un shadow root, para que los estilos de la página no lo rompan.

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
  width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;
  background: #ea580c; color: #fff; font-size: 24px; box-shadow: 0 6px 20px rgba(0,0,0,.25);
}
.launcher:hover { background: #c2410c; }
.panel {
  position: fixed; right: 20px; bottom: 84px; z-index: 2147483647;
  width: 370px; max-height: calc(100vh - 110px); overflow: auto;
  background: #fff; color: #1f2937; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.28);
  font-size: 13px; line-height: 1.4;
}
.panel[hidden] { display: none; }
header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: #ea580c; color: #fff; border-radius: 14px 14px 0 0; }
header strong { font-size: 14px; }
header button { background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
section { padding: 10px 14px; border-bottom: 1px solid #f1f5f9; }
.step { font-weight: 600; margin-bottom: 6px; }
.muted { color: #6b7280; font-size: 12px; }
.job-title { font-weight: 600; font-size: 14px; }
button.btn { width: 100%; padding: 8px 10px; margin-top: 6px; border-radius: 8px; border: 1px solid #d1d5db; background: #f9fafb; color: #111827; cursor: pointer; font-size: 13px; }
button.btn:hover { background: #f3f4f6; }
button.btn.primary { background: #ea580c; border-color: #ea580c; color: #fff; font-weight: 600; }
button.btn.primary:hover { background: #c2410c; }
button.btn:disabled { opacity: .6; cursor: wait; }
select, textarea { width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 13px; color: #111827; background: #fff; }
textarea { min-height: 70px; resize: vertical; margin-top: 6px; }
textarea.desc { min-height: 120px; }
details summary { cursor: pointer; color: #4b5563; font-size: 12px; margin-top: 4px; }
.score { font-weight: 700; }
.score.good { color: #15803d; } .score.mid { color: #b45309; } .score.low { color: #b91c1c; }
.chips { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
.chip { padding: 1px 7px; border-radius: 999px; font-size: 11px; background: #dcfce7; color: #166534; }
.chip.missing { background: #fee2e2; color: #991b1b; }
.or { text-align: center; color: #9ca3af; font-size: 11px; margin-top: 8px; }
.status { padding: 10px 14px; }
.status:empty { display: none; }
.msg { margin: 2px 0; }
.msg.ok { color: #15803d; } .msg.warn { color: #b45309; } .msg.error { color: #b91c1c; }
.msg ul { margin: 2px 0 0 16px; padding: 0; }
footer { padding: 10px 14px; color: #6b7280; font-size: 11px; }
footer a { color: #ea580c; cursor: pointer; text-decoration: underline; }
`;

type Attrs = Record<string, string | boolean | ((ev: Event) => void)>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') el.addEventListener(key.replace(/^on/, ''), value);
    else if (typeof value === 'boolean') el.toggleAttribute(key, value);
    else el.setAttribute(key, value);
  }
  el.append(...children);
  return el;
}

export type MessageKind = 'ok' | 'warn' | 'error' | 'info';

export interface PanelHandlers {
  onOpen(): void;
  onFill(): void;
  onCopyPrompt(): void;
  onApplyPasted(text: string): void;
  onAnswerWithApi(): void;
  onCvChange(cvId: string): void;
  onDescriptionChange(text: string): void;
  onOpenOptions(): void;
}

export interface CvChoice {
  id: string;
  name: string;
  score: number | null;
}

export class Panel {
  readonly host: HTMLElement;
  private readonly panel: HTMLDivElement;
  private readonly jobTitle = h('div', { class: 'job-title' });
  private readonly jobMeta = h('div', { class: 'muted' });
  private readonly description = h('textarea', { class: 'desc' });
  private readonly cvSelect = h('select');
  private readonly cvHint = h('div', { class: 'muted' });
  private readonly matchBox = h('div');
  private readonly tokens = h('div', { class: 'muted' });
  private readonly pasteBox = h('textarea', { placeholder: 'Pegá acá la respuesta de Codex o ChatGPT (el JSON)' });
  private readonly status = h('div', { class: 'status' });
  private readonly buttons: HTMLButtonElement[] = [];

  constructor(private readonly handlers: PanelHandlers) {
    this.host = h('div', { id: 'garra-la-pala-root' });
    const shadow = this.host.attachShadow({ mode: 'open' });
    const button = (label: string, onclick: () => void, primary = false) => {
      const b = h('button', { class: primary ? 'btn primary' : 'btn', onclick }, label);
      this.buttons.push(b);
      return b;
    };

    this.description.addEventListener('input', () => handlers.onDescriptionChange(this.description.value));
    this.cvSelect.addEventListener('change', () => handlers.onCvChange(this.cvSelect.value));

    this.panel = h(
      'div',
      { class: 'panel', hidden: true },
      h('header', {}, h('strong', {}, '🐾 Garra la Pala IA'), h('button', { title: 'Cerrar', onclick: () => this.hide() }, '×')),
      h(
        'section',
        {},
        this.jobTitle,
        this.jobMeta,
        h('details', {}, h('summary', {}, 'Ver o editar la descripción del puesto'), this.description),
      ),
      h('section', {}, h('div', { class: 'step' }, 'CV para esta oferta'), this.cvSelect, this.cvHint, this.matchBox),
      h('section', {}, h('div', { class: 'step' }, '1. Datos y CV'), button('Completar datos y adjuntar CV', () => handlers.onFill(), true)),
      h(
        'section',
        {},
        h('div', { class: 'step' }, '2. Preguntas abiertas'),
        button('📋 Copiar prompt para Codex / ChatGPT', () => handlers.onCopyPrompt()),
        this.tokens,
        this.pasteBox,
        button('Aplicar respuesta pegada', () => handlers.onApplyPasted(this.pasteBox.value)),
        h('div', { class: 'or' }, '— si Codex se quedó sin tokens —'),
        button('⚡ Responder con API gratis', () => handlers.onAnswerWithApi()),
      ),
      this.status,
      h(
        'footer',
        {},
        h('a', { onclick: () => handlers.onOpenOptions() }, 'Opciones'),
        ' · Nunca enviamos el formulario: revisalo y envialo vos.',
      ),
    );

    const launcher = h('button', { class: 'launcher', title: 'Garra la Pala IA', onclick: () => this.toggle() }, '🐾');
    shadow.append(h('style', {}, STYLES), launcher, this.panel);
  }

  mount(): void {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  show(): void {
    this.mount();
    this.panel.hidden = false;
    this.handlers.onOpen();
  }

  hide(): void {
    this.panel.hidden = true;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  setJob(title: string, meta: string, description: string): void {
    this.jobTitle.textContent = title;
    this.jobMeta.textContent = meta;
    if (this.shadowActive() !== this.description) this.description.value = description;
  }

  setCvs(choices: CvChoice[], selectedId: string | undefined, hint: string): void {
    this.cvSelect.replaceChildren(
      ...choices.map((c) =>
        h('option', { value: c.id, ...(c.id === selectedId ? { selected: true } : {}) }, c.score === null ? c.name : `${c.name} — ${c.score}%`),
      ),
    );
    this.cvSelect.hidden = choices.length === 0;
    this.cvHint.textContent = hint;
  }

  setMatch(score: number | null, matched: string[], missing: string[]): void {
    if (score === null) {
      this.matchBox.replaceChildren();
      return;
    }
    const level = score >= 70 ? 'good' : score >= 40 ? 'mid' : 'low';
    this.matchBox.replaceChildren(
      h('div', {}, h('span', { class: `score ${level}` }, `${score}%`), ' de coincidencia con la oferta'),
      h('div', { class: 'chips' }, ...matched.slice(0, 12).map((m) => h('span', { class: 'chip' }, m))),
      h('div', { class: 'chips' }, ...missing.slice(0, 12).map((m) => h('span', { class: 'chip missing' }, m))),
    );
  }

  setTokens(text: string): void {
    this.tokens.textContent = text;
  }

  clearPasted(): void {
    this.pasteBox.value = '';
  }

  /** Último recurso si no se pudo copiar al portapapeles. */
  showTextToCopy(text: string): void {
    this.pasteBox.value = text;
    this.pasteBox.select();
  }

  setBusy(busy: boolean): void {
    for (const b of this.buttons) b.disabled = busy;
  }

  clearStatus(): void {
    this.status.replaceChildren();
  }

  log(kind: MessageKind, text: string, items: string[] = []): void {
    const icon = { ok: '✔', warn: '⚠', error: '✖', info: '•' }[kind];
    this.status.append(
      h('div', { class: `msg ${kind}` }, `${icon} ${text}`, ...(items.length ? [h('ul', {}, ...items.map((i) => h('li', {}, i)))] : [])),
    );
  }

  private shadowActive(): Element | null {
    return this.host.shadowRoot?.activeElement ?? null;
  }
}
