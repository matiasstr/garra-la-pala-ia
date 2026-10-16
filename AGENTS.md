# AGENTS.md — Garra la Pala IA

Instrucciones para los agentes de IA que trabajan en este repo (Astra/Codex, Claude Code).
Codex lee este archivo automáticamente. Leelo entero antes de tocar código.

## Qué estamos construyendo

**Fase 1 (ahora):** una extensión de Chrome (Manifest V3) que completa postulaciones laborales
en sitios **fuera de LinkedIn** (Greenhouse, Lever, Workday, páginas de empleo de empresas, etc.),
al estilo de [Jobright](https://jobright.ai/):

1. Lee la oferta de la página (puesto, empresa, descripción).
2. Elige el CV más adecuado de los que la persona subió y calcula un % de coincidencia.
3. Completa los campos fijos (nombre, mail, teléfono, LinkedIn...) y adjunta el CV.
4. Redacta las preguntas abiertas ("¿Por qué querés trabajar en X?") con IA, usando la oferta + el CV.
   - **Modo Codex/ChatGPT (sin API key):** el panel copia un prompt, la persona lo pega en Codex de
     escritorio o ChatGPT, y pega la respuesta (JSON) de vuelta.
   - **APIs gratis de respaldo:** Groq, OpenRouter o Gemini, en cadena: si una se queda sin cupo,
     prueba la siguiente.
5. **Nunca envía el formulario.** La persona revisa y envía.

**Fase 2 (después):** una web tipo Jobright para LATAM en `apps/web` (recomendador de ofertas).
Todo lo que sea lógica pura va en `packages/core` para reutilizarlo ahí.

## Estructura del repo

```
packages/core/            @garra/core: lógica pura (sin DOM ni chrome.*). Tipos, JSON-LD,
                          clasificación de campos, matching CV-oferta, prompts, parser de
                          respuestas, router de proveedores de IA.
  src/types.ts            CONTRATOS COMPARTIDOS (ver "Reglas para trabajar en paralelo")
apps/extension/           @garra/extension: extensión MV3 (esbuild)
  src/background.ts       service worker: llamadas a las APIs de IA
  src/content/            content script: leer la oferta, detectar y llenar campos, panel
  src/content/extractors/ un archivo por sitio (greenhouse.ts, lever.ts, ...) + types.ts + dom.ts
  src/options/            página de opciones: perfil, CVs (PDF -> texto con pdf.js), APIs
  src/popup/              popup de la barra
apps/codex-bridge/        (tarea A1) puente local con Codex vía Native Messaging
apps/web/                 (fase 2) web Jobright LATAM. Por ahora vacío.
```

## Comandos

```bash
npm install            # una vez, en la raíz
npm run typecheck      # tsc en core y extensión
npm test               # vitest (todo el monorepo)
npm run build          # genera apps/extension/dist
npm run check          # las tres cosas juntas: correlo antes de cada PR
```

Para probar la extensión: `chrome://extensions` → Modo desarrollador → "Cargar descomprimida" →
`apps/extension/dist`.

## Convenciones

- TypeScript estricto. Node 22. Sin `any` salvo en el borde con JSON externo (y validado).
- Identificadores en inglés. Comentarios, textos de la interfaz y documentación en **español**.
- `packages/core` no usa DOM ni `chrome.*`: tiene que poder correr en Node y en la web.
- Tests con vitest. Los que usan DOM llevan `// @vitest-environment jsdom` en la primera línea.
  Fixtures HTML en `apps/extension/test/fixtures/<sitio>/` (sin datos personales reales).
- No agregues dependencias de runtime sin justificarlo en el PR. Las de desarrollo, con criterio.
- Privacidad: el CV solo se manda al proveedor de IA que eligió la persona. Nada de analytics ni
  servidores propios en la fase 1.
- La IA **nunca inventa** datos sensibles ni verificables: DNI/CUIL/RUT/CPF, fecha de nacimiento,
  género, salario, permisos de trabajo. Esos campos quedan para completar a mano.

## Reglas para trabajar en paralelo (Claude + Astra)

Dos agentes trabajan a la vez en este repo. Para no pisarnos:

1. **Ramas.** Astra trabaja en `astra/<id-tarea>-<descripcion>` (ej. `astra/a1-codex-bridge`),
   creada desde `main`. Si `main` todavía no tiene la base del proyecto, creala desde
   `origin/claude/awesome-tesla-eggzci`. Claude trabaja en ramas `claude/*`.
2. **Un PR por tarea**, contra `main`, con título `[Astra] A1: ...`. En la descripción poné qué
   probaste y la salida de `npm run check`.
3. **Solo tocás los archivos de tu tarea** (columna "Archivos" abajo). Si necesitás cambiar algo
   fuera de eso, no lo cambies: explicalo en el PR y lo integra Claude.
4. **Contratos compartidos** (`packages/core/src/types.ts`, `apps/extension/src/content/extractors/types.ts`,
   `packages/core/src/llm/errors.ts`): no los modifiques. Si hace falta, proponé el cambio en el PR
   (solo campos nuevos opcionales).
5. **Líneas de registro permitidas:** podés agregar (nunca borrar ni reordenar) líneas en
   `apps/extension/src/content/extractors/index.ts` y `packages/core/src/index.ts` para registrar o
   exportar lo tuyo. Son conflictos triviales de merge.
6. No toques `manifest.json`, el panel (`src/content/panel.ts`), `background.ts` ni `options/`:
   la integración en la interfaz la hace Claude cuando tu PR esté mergeado.
7. Antes del PR: `npm run check` en verde. No desactives tests ni bajes el modo estricto.

## Contratos que ya podés usar

```ts
// packages/core/src/types.ts (resumen)
interface JobPosting { url; title; company; location?; employmentType?; description; source; extractedAt }
interface ChatPrompt { system: string; user: string }
interface LlmProvider {
  readonly id: string;
  readonly label: string;
  complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string>;
}

// packages/core/src/llm/errors.ts
class ProviderError extends Error {
  constructor(message: string, providerId: string, code: ProviderErrorCode, status?: number)
}
// code: 'RATE_LIMIT' (sin cupo/tokens -> el router pasa al siguiente) | 'AUTH' | 'NETWORK'
//     | 'TIMEOUT' | 'BAD_REQUEST' | 'BAD_RESPONSE' | 'NOT_AVAILABLE' | 'UNKNOWN'

// apps/extension/src/content/extractors/types.ts
interface JobExtractor {
  id: string;                                   // = JobPosting.source
  matches(url: URL, doc: Document): boolean;
  extract(doc: Document, url: URL): Partial<Omit<JobPosting, 'source' | 'extractedAt'>> | null;
}
// Helpers en extractors/dom.ts: textOf, firstText, humanizeSlug, pathSegment, metaContent
```

---

## Tareas para Astra

Orden sugerido: **A1 → A4 → A2 → A3**. Marcá en el PR qué tarea cerrás. No edites este archivo
salvo para tachar tu tarea cuando se mergee.

### A1 — Puente con Codex local (sin API key) ⭐ prioridad

**Objetivo:** que la extensión le mande el prompt a Codex instalado en la compu de la persona y reciba
la respuesta sola, usando su login de ChatGPT (sin API key). Así se evita el copiar/pegar.
Si Codex se queda sin cupo, la extensión pasa a las APIs gratis.

**Archivos:** `apps/codex-bridge/**` (paquete nuevo `@garra/codex-bridge`) y
`apps/extension/src/lib/codex-bridge.ts` (archivo nuevo).

**Cómo:**
- Host de [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
  en Node, nombre `com.garra.codex_bridge`. Protocolo de Chrome: 4 bytes little-endian con el largo
  + JSON, por stdin/stdout.
- Mensajes (extensión → host):
  ```jsonc
  { "type": "ping" }
  // -> { "ok": true, "version": "0.1.0", "codexVersion": "x.y.z" }

  { "type": "complete", "system": "...", "user": "...", "model": "opcional", "timeoutMs": 120000 }
  // -> { "ok": true, "text": "<respuesta final de Codex>" }
  // -> { "ok": false, "code": "NOT_INSTALLED" | "NOT_LOGGED_IN" | "USAGE_LIMIT" | "TIMEOUT" | "UNKNOWN",
  //      "error": "mensaje legible en español" }
  ```
- El host corre `codex exec` en modo no interactivo. **Verificá los flags reales con
  `codex exec --help`** (no los adivines). Requisitos:
  - Pasar el prompt por **stdin**, no como argumento (en Windows los argumentos largos se cortan).
  - Sandbox de solo lectura, sin aprobaciones, en un directorio temporal vacío: Codex no tiene que
    editar archivos ni correr comandos, solo responder texto.
  - Capturar solo el mensaje final (ej. con la opción para escribir el último mensaje a un archivo,
    o con la salida JSON).
  - Mapear "usage limit / rate limit / quota" → `USAGE_LIMIT`; "not logged in" → `NOT_LOGGED_IN`;
    binario no encontrado → `NOT_INSTALLED`.
- Instalador: `npm run install-host -w @garra/codex-bridge -- --extension-id <ID>` que escriba el
  manifest del host para Chrome en macOS, Linux y Windows (en Windows además la clave de registro
  `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.garra.codex_bridge`).
  `allowed_origins`: `chrome-extension://<ID>/`.
- `apps/extension/src/lib/codex-bridge.ts`: exportá `createCodexBridgeProvider(): LlmProvider`
  (id `codex-local`, label `Codex (local)`) que use `chrome.runtime.sendNativeMessage`. Errores →
  `ProviderError` con: `USAGE_LIMIT`→`RATE_LIMIT`, `NOT_INSTALLED`/`NOT_LOGGED_IN`→`NOT_AVAILABLE`,
  `TIMEOUT`→`TIMEOUT`, resto→`UNKNOWN`.
- `apps/codex-bridge/README.md` en español: instalación paso a paso.
- Tests (vitest, sin llamar a Codex de verdad): framing de mensajes, mapeo de errores, armado de los
  argumentos de `codex exec` (con el proceso mockeado).
- En el PR anotá que hay que agregar el permiso `"nativeMessaging"` al manifest y sumar el
  proveedor a la cadena; eso lo integra Claude.

### A2 — Extractores de ATS globales

**Objetivo:** leer bien la oferta en los ATS más usados por empresas que contratan en LATAM.

**Archivos:** `apps/extension/src/content/extractors/{workday,ashby,smartrecruiters,workable,teamtailor}.ts`,
tests en `apps/extension/test/extractors/`, fixtures en `apps/extension/test/fixtures/<ats>/`.
Registrarlos en `extractors/index.ts` (solo agregar líneas).

**Cómo:** un `JobExtractor` por archivo, mirando `greenhouse.ts` y `lever.ts` como ejemplo.
`matches` por hostname (ej. `*.myworkdayjobs.com`, `jobs.ashbyhq.com`, `jobs.smartrecruiters.com`,
`apply.workable.com`, `*.teamtailor.com`). La empresa sale del subdominio o del path con `humanizeSlug`
si no está en la página. Cuidado con los ATS que renderizan con JavaScript (Workday, Ashby): el
extractor corre cuando el DOM ya cargó, pero preferí `data-automation-id` y atributos estables antes
que clases con hash. Un test por ATS con un fixture HTML real recortado: página de la oferta y, si
existe, la página del formulario.

### A3 — Extractores de sitios LATAM

Igual que A2, para: **Gupy** (`*.gupy.io`, Brasil), **Hiringroom** (`*.hiringroom.com`),
**GetOnBoard** (`getonbrd.com`), **Computrabajo** (`*.computrabajo.com`) y
**Bumeran / ZonaJobs** (`bumeran.com.*`, `zonajobs.com.ar`).
Archivos: `extractors/{gupy,hiringroom,getonbrd,computrabajo,bumeran}.ts` + tests + fixtures.

### A4 — Banco de respuestas (lógica pura)

**Objetivo:** guardar las respuestas que la persona aprobó y reutilizarlas cuando vuelve una pregunta
parecida ("Contanos sobre vos", "Expectativa salarial"), sin gastar tokens.

**Archivos:** `packages/core/src/answer-bank.ts`, `packages/core/test/answer-bank.test.ts`.
Exportar desde `packages/core/src/index.ts` (solo agregar la línea).

```ts
export interface SavedAnswer {
  question: string;
  answer: string;
  /** Si la respuesta menciona una empresa puntual, solo se reutiliza para esa empresa. */
  company?: string;
  updatedAt: number;
  uses: number;
}
export function normalizeQuestion(question: string): string;
export function findSimilarAnswer(
  bank: SavedAnswer[],
  question: string,
  opts?: { company?: string; minScore?: number },
): { saved: SavedAnswer; score: number } | null;
export function upsertAnswer(
  bank: SavedAnswer[],
  entry: { question: string; answer: string; company?: string },
  now?: number,
): SavedAnswer[];
```

- Similitud sin dependencias ni embeddings: palabras normalizadas (minúsculas, sin tildes, sin
  stopwords en español, inglés y portugués) + Jaccard o coseno. `minScore` por defecto ~0.6.
- Una respuesta guardada con `company` **nunca** se devuelve para otra empresa.
- `upsertAnswer` reemplaza si la pregunta normalizada ya existe (misma empresa), y no muta el array.
- Tests con preguntas en los tres idiomas, variaciones ("¿Por qué querés trabajar con nosotros?" vs
  "¿Por qué te gustaría sumarte al equipo?") y casos que **no** deben matchear.

---

## Qué está haciendo Claude (no lo dupliques)

En la rama `claude/awesome-tesla-eggzci`:

- `packages/core`: tipos, JSON-LD, clasificación de campos (es/en/pt), matching CV-oferta, armado
  del prompt, parser tolerante de respuestas, router con fallback y proveedor compatible con OpenAI
  (Groq, OpenRouter, Gemini, OpenAI).
- `apps/extension`: manifest, content script (detección y llenado de campos, adjuntar CV, panel),
  extractores Greenhouse, Lever y genérico, background, opciones (perfil, CVs con pdf.js, APIs) y popup.

Próximo para Claude, después de esto: integrar A1 y A4 en el panel, widgets de dropdown custom
(react-select, comboboxes de Workday) y formularios en varios pasos.
