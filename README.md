# 🐾 Garra la Pala IA

Extensión de Chrome que completa postulaciones laborales **fuera de LinkedIn** (Greenhouse, Lever,
páginas de empleo de empresas...), al estilo de [Jobright](https://jobright.ai/), pensada para LATAM.

- Lee la oferta de la página (puesto, empresa, descripción).
- Elige tu CV más adecuado y muestra el % de coincidencia, con las habilidades que tenés y las que faltan.
- Completa nombre, mail, teléfono, LinkedIn y demás, y **adjunta el CV**.
- Redacta las preguntas abiertas ("¿Por qué querés trabajar en X?") con la oferta + tu CV:
  - **Codex local, sin API key ni copiar/pegar:** si tenés Codex instalado, la extensión le manda
    el prompt sola usando tu cuenta de ChatGPT.
  - **Modo copiar/pegar:** copia un prompt, lo pegás en Codex de escritorio o ChatGPT y pegás la respuesta.
  - **APIs gratis de respaldo** (Groq, OpenRouter, Gemini): si Codex o una API se quedan sin cupo,
    prueba la siguiente.
- **Nunca envía el formulario.** Vos revisás y enviás.

Fase 2: una web tipo Jobright para LATAM en `apps/web`, reutilizando `packages/core`.

## Instalar (modo desarrollo)

Necesitás Node 22.

```bash
npm install
npm run build
```

En Chrome: `chrome://extensions` → activá **Modo desarrollador** → **Cargar descomprimida** →
elegí la carpeta `apps/extension/dist`.

Se abre la página de Opciones:

1. **Perfil:** tus datos (nombre, mail, LinkedIn, pretensión salarial...). Se guardan solos.
2. **CVs:** subí uno o varios PDF. Podés ver el texto que se extrajo de cada uno.
3. **IA:** el modo copiar/pegar no necesita nada. Para que responda solo:
   - **Codex local:** necesitás [Codex CLI](https://github.com/openai/codex) instalado y con sesión
     iniciada (`codex login`). En Opciones copiá el comando de instalación del puente (ya trae el ID
     de tu extensión), correlo en la carpeta del proyecto, tocá **Probar conexión** y activalo.
     Detalles en [`apps/codex-bridge/README.md`](apps/codex-bridge/README.md).
   - **APIs gratis de respaldo:** agregá una (con el botón "Sacar API key" de cada una) y tocá **Probar**.

## Usar

1. Entrá a la página de la oferta o del formulario. Aparece el botón 🐾 abajo a la derecha
   (si no aparece: ícono de la extensión → **Abrir panel en esta página**).
2. **Completar datos y adjuntar CV.** Los campos completados quedan marcados en verde; los que
   tenés que completar vos (género, DNI, etc.) aparecen en la lista.
3. **Preguntas abiertas:**
   - **Copiar prompt para Codex / ChatGPT** → pegalo en Codex de escritorio o ChatGPT → copiá la
     respuesta (un JSON) → pegala en el panel → **Aplicar respuesta pegada**.
   - O **Responder automático**: prueba Codex local (si lo activaste) y después las APIs gratis.
4. Revisá todo (lo marcado en naranja necesita tu revisión) y enviá vos.

Tip: si el formulario está en otra página que la oferta (como en Lever), abrí primero la oferta:
la extensión la recuerda y la usa en el formulario.

## Desarrollo

```bash
npm run check        # typecheck + tests + build (correlo antes de cada PR)
npm test             # solo tests
npm run dev          # build en modo watch
```

| Carpeta | Qué hay |
| --- | --- |
| `packages/core` | Lógica pura compartida: tipos, JSON-LD, clasificación de campos, matching, prompts, router de IA |
| `apps/extension` | Extensión MV3: content script + panel, opciones, popup, service worker |
| `apps/codex-bridge` | Puente local (Native Messaging) que le pasa los prompts a Codex CLI |
| `apps/web` | Fase 2 (vacío por ahora) |

Trabajamos dos agentes en paralelo (Claude Code y Astra/Codex). Las reglas, los contratos
compartidos y las tareas de cada uno están en [`AGENTS.md`](AGENTS.md).

## Privacidad

Perfil, CVs y API keys se guardan solo en tu navegador (`chrome.storage.local`). El CV y la oferta se
mandan únicamente al proveedor de IA que elijas. En los planes gratis, algunos proveedores (por
ejemplo Gemini) pueden usar lo que mandás para entrenar sus modelos.
