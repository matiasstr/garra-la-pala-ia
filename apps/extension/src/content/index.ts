import {
  MIN_DESCRIPTION_CHARS,
  buildAnswerPrompt,
  buildFillPlan,
  findCachedJob,
  parseAnswers,
  promptAsSingleText,
  promptTokenEstimate,
  rankCvs,
  rememberJob,
  type CandidateProfile,
  type ChatPrompt,
  type CvDocument,
  type JobPosting,
} from '@garra/core';
import { sendToBackground, type AnswerWithApiResult, type TabMessage } from '../lib/messages';
import { getState, setState } from '../lib/storage';
import { scanFields, type ScanResult } from './fields';
import { applyValue, attachFile } from './fill';
import { extractJob } from './job';
import { Panel, type PanelHandlers } from './panel';

declare global {
  interface Window {
    __garraLoaded?: boolean;
  }
}

const APPLY_HINTS = /apply|aplicar|postul|candidat|vacante|vacancy|job|empleo|career|carrera|trabajo|vaga|oportunidad/i;

interface Context {
  job: JobPosting | null;
  confident: boolean;
  descriptionEdited: boolean;
  profile: CandidateProfile;
  cvs: CvDocument[];
  selectedCvId?: string;
  codexLocal: boolean;
}

const ctx: Context = { job: null, confident: false, descriptionEdited: false, profile: {}, cvs: [], codexLocal: false };
let panel: Panel | null = null;

function getPanel(): Panel {
  panel ??= new Panel(handlers);
  return panel;
}

// ---------- Oferta ----------

async function refreshJob(): Promise<void> {
  if (ctx.descriptionEdited) return;
  const extracted = extractJob(document, location.href);
  ctx.confident = extracted.confident;
  let job = extracted.job;
  if (!job) return;

  const { recentJobs } = await getState('recentJobs');
  if (job.description.length >= MIN_DESCRIPTION_CHARS) {
    // Solo recordamos ofertas reales, no cualquier página con mucho texto.
    if (ctx.confident) await setState({ recentJobs: rememberJob(recentJobs, job) });
  } else {
    const cached = findCachedJob(recentJobs, job.url, job.title);
    if (cached) {
      job = {
        ...job,
        company: job.company || cached.company,
        description: cached.description,
        source: `${job.source} + oferta guardada`,
        ...(job.location || cached.location ? { location: job.location || cached.location } : {}),
      };
    }
  }
  ctx.job = job;
}

function currentJob(): JobPosting {
  return (
    ctx.job ?? {
      url: location.href,
      title: document.title,
      company: location.hostname,
      description: '',
      source: 'desconocida',
      extractedAt: Date.now(),
    }
  );
}

// ---------- CVs ----------

function rankedCvs() {
  const job = currentJob();
  return rankCvs(ctx.cvs, `${job.title}\n${job.description}`);
}

function selectedCv(): CvDocument | undefined {
  const ranked = rankedCvs();
  return ranked.find((r) => r.cv.id === ctx.selectedCvId)?.cv ?? ranked[0]?.cv;
}

// ---------- Render ----------

function render(): void {
  const p = getPanel();
  const job = currentJob();
  const descLength = job.description.length;
  const meta =
    descLength >= MIN_DESCRIPTION_CHARS
      ? `Fuente: ${job.source} · ${descLength.toLocaleString('es-AR')} caracteres de descripción`
      : 'No encontré la descripción del puesto: pegala abajo para mejores respuestas.';
  p.setJob(job.company ? `${job.title} · ${job.company}` : job.title, meta, job.description);

  const ranked = rankedCvs();
  const selected = selectedCv();
  p.setCvs(
    ranked.map((r) => ({ id: r.cv.id, name: r.cv.name, score: r.match.score })),
    selected?.id,
    ranked.length ? '' : 'Todavía no subiste ningún CV: cargalo en Opciones.',
  );
  const match = ranked.find((r) => r.cv.id === selected?.id)?.match;
  p.setMatch(match?.score ?? null, match?.matched ?? [], match?.missing ?? []);
  p.setAutoMode(ctx.codexLocal);
}

async function loadUserData(): Promise<void> {
  const { profile, cvs, codex } = await getState('profile', 'cvs', 'codex');
  ctx.profile = profile;
  ctx.cvs = cvs;
  ctx.codexLocal = codex.enabled;
}

// ---------- Acciones ----------

function prepareQuestions(scan: ScanResult): { prompt: ChatPrompt; ids: string[] } | null {
  const plan = buildFillPlan(scan.fields, ctx.profile);
  if (!plan.questions.length) return null;
  const prompt = buildAnswerPrompt({
    job: currentJob(),
    profile: ctx.profile,
    cvText: selectedCv()?.text ?? '',
    questions: plan.questions,
  });
  return { prompt, ids: plan.questions.map((q) => q.id) };
}

function noFieldsWarning(p: Panel): void {
  p.log('warn', 'No encontré campos para completar en esta página. Si el formulario está en un paso siguiente, abrí el panel ahí.');
}

function fill(): void {
  const p = getPanel();
  p.clearStatus();
  const scan = scanFields(document);
  if (!scan.fields.length) return noFieldsWarning(p);
  const plan = buildFillPlan(scan.fields, ctx.profile);

  const filled: string[] = [];
  const problems: string[] = [];
  for (const item of plan.direct) {
    const error = applyValue(item.field, scan.elements.get(item.field.id) ?? [], item.value);
    if (error) problems.push(`${item.field.label}: ${error}`);
    else filled.push(item.field.label);
  }

  const cv = selectedCv();
  for (const field of plan.resume) {
    const input = scan.elements.get(field.id)?.[0];
    const error = !cv ? 'no hay CV cargado' : input instanceof HTMLInputElement ? attachFile(input, cv) : 'no es un input de archivo';
    if (error) problems.push(`${field.label || 'CV'}: ${error}`);
    else filled.push(`${field.label || 'CV'} (${cv!.fileName})`);
  }

  if (filled.length) p.log('ok', `Completé ${filled.length} campo(s):`, filled);
  else p.log('info', 'No había datos fijos para completar (o ya estaban completos).');
  if (plan.questions.length) p.log('info', `${plan.questions.length} pregunta(s) para la IA: usá el paso 2.`, plan.questions.map((q) => q.question));
  if (plan.manual.length) p.log('warn', `Completá vos (${plan.manual.length}):`, plan.manual.map((m) => `${m.field.label} — ${m.reason}`));
  if (problems.length) p.log('error', 'No pude completar:', problems);
  if (!ctx.profile.email && !ctx.profile.firstName) p.log('warn', 'Tu perfil está vacío: cargalo en Opciones para completar más campos.');
}

function applyAnswers(text: string): void {
  const p = getPanel();
  const scan = scanFields(document);
  const parsed = parseAnswers(text, scan.fields.map((f) => f.id));
  if (parsed.error) {
    p.log('error', parsed.error);
    return;
  }
  const filled: string[] = [];
  const review: string[] = [];
  const problems: string[] = [];
  for (const answer of parsed.answers) {
    const field = scan.fields.find((f) => f.id === answer.id)!;
    if (!answer.answer) {
      review.push(`${field.label} — la IA no tenía datos para responder`);
      continue;
    }
    const error = applyValue(field, scan.elements.get(field.id) ?? [], answer.answer, answer.needsReview);
    if (error) problems.push(`${field.label}: ${error}`);
    else {
      filled.push(field.label);
      if (answer.needsReview) review.push(field.label);
    }
  }
  if (filled.length) p.log('ok', `Respondí ${filled.length} pregunta(s). Revisalas antes de enviar:`, filled);
  if (review.length) p.log('warn', 'Para revisar (marcadas en naranja):', review);
  if (problems.length) p.log('error', 'No pude completar:', problems);
  if (parsed.unknownIds.length) {
    p.log('warn', `La respuesta trae ${parsed.unknownIds.length} pregunta(s) que ya no están en la página. ¿Cambió el formulario? Copiá el prompt de nuevo.`);
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

async function copyPrompt(): Promise<void> {
  const p = getPanel();
  p.clearStatus();
  const scan = scanFields(document);
  if (!scan.fields.length) return noFieldsWarning(p);
  const prepared = prepareQuestions(scan);
  if (!prepared) {
    p.log('info', 'No quedan preguntas abiertas sin responder en esta página.');
    return;
  }
  const text = promptAsSingleText(prepared.prompt);
  p.setTokens(`~${promptTokenEstimate(prepared.prompt).toLocaleString('es-AR')} tokens · ${prepared.ids.length} pregunta(s)`);
  if (await copyToClipboard(text)) {
    p.log('ok', 'Prompt copiado. Pegalo en Codex de escritorio o ChatGPT y pegá acá abajo lo que te responda.');
  } else {
    p.showTextToCopy(text);
    p.log('error', 'No pude copiar al portapapeles. Te lo dejé en el cuadro de abajo: copialo a mano y borralo antes de pegar la respuesta.');
  }
  if (!ctx.cvs.length) p.log('warn', 'No hay CV cargado: las respuestas van a ser genéricas.');
}

async function answerWithApi(): Promise<void> {
  const p = getPanel();
  p.clearStatus();
  const scan = scanFields(document);
  if (!scan.fields.length) return noFieldsWarning(p);
  const prepared = prepareQuestions(scan);
  if (!prepared) {
    p.log('info', 'No quedan preguntas abiertas sin responder en esta página.');
    return;
  }
  p.setBusy(true);
  p.log(
    'info',
    ctx.codexLocal
      ? `Consultando a Codex local (${prepared.ids.length} pregunta(s)). Puede tardar un par de minutos...`
      : `Consultando las APIs (${prepared.ids.length} pregunta(s))...`,
  );
  try {
    const result = await sendToBackground<AnswerWithApiResult>({
      type: 'answer-with-api',
      prompt: prepared.prompt,
      questionIds: prepared.ids,
    });
    p.clearStatus();
    if (!result.ok) {
      p.log('error', result.error);
      p.log('info', 'Podés usar el modo Codex: "Copiar prompt" y pegar la respuesta.');
      return;
    }
    const failed = result.data.attempts.filter((a) => !a.ok);
    if (failed.length) p.log('warn', 'Sin respuesta de:', failed.map((a) => `${a.label}: ${a.error}`));
    p.log('ok', `Respondió ${result.data.label}.`);
    applyAnswers(result.data.text);
  } catch {
    p.log('error', 'Se perdió la conexión con la extensión (¿la actualizaste?). Recargá la página.');
  } finally {
    p.setBusy(false);
  }
}

const handlers: PanelHandlers = {
  onOpen() {
    void (async () => {
      await Promise.all([loadUserData(), refreshJob()]);
      render();
    })();
  },
  onFill: fill,
  onCopyPrompt: () => void copyPrompt(),
  onApplyPasted(text) {
    const p = getPanel();
    p.clearStatus();
    if (!text.trim()) {
      p.log('warn', 'Primero pegá la respuesta de Codex o ChatGPT.');
      return;
    }
    applyAnswers(text);
    p.clearPasted();
  },
  onAnswerWithApi: () => void answerWithApi(),
  onCvChange(cvId) {
    ctx.selectedCvId = cvId;
    render();
  },
  onDescriptionChange(text) {
    ctx.descriptionEdited = true;
    ctx.job = { ...currentJob(), description: text, source: 'editada a mano' };
  },
  onOpenOptions() {
    void sendToBackground({ type: 'open-options' });
  },
};

// ---------- Detección ----------

/** Muestra el botón si la página parece una oferta o un formulario de postulación. */
async function detect(): Promise<boolean> {
  if (window.innerWidth < 250 || window.innerHeight < 150) return false; // iframes chicos (captchas, anuncios)
  await refreshJob();
  const scan = scanFields(document);
  const fillable = scan.fields.filter((f) => f.control !== 'checkbox');
  const hasFile = scan.fields.some((f) => f.control === 'file');
  const hinted = APPLY_HINTS.test(location.href) || APPLY_HINTS.test(document.title);
  const offer = ctx.confident || (fillable.length >= 3 && (hasFile || hinted));
  if (offer) getPanel().mount();
  return offer;
}

function watchForLateForms(): void {
  // Workday, Ashby y otros arman el formulario con JavaScript después de cargar.
  let checks = 0;
  let timer: number | undefined;
  const observer = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (++checks > 15 || (await detect())) observer.disconnect();
    }, 800);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

async function main(): Promise<void> {
  if (window.__garraLoaded) return;
  window.__garraLoaded = true;

  chrome.runtime.onMessage.addListener((message: TabMessage) => {
    if (message.type === 'toggle-panel') getPanel().toggle();
    return false;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !panel?.isOpen || !(changes.profile || changes.cvs || changes.codex)) return;
    void loadUserData().then(render);
  });

  if (!(await detect()) && document.body) watchForLateForms();
}

void main();
