# Puente local con Codex (A1)

Host Native Messaging `com.garra.codex_bridge` para Chrome. Recibe un prompt de la
extensión, ejecuta Codex CLI con la sesión de ChatGPT de la persona y devuelve su
respuesta final. No requiere una API key ni instala un servidor HTTP.

## Requisitos y alcance

- Node.js 22.12 o superior y Google Chrome.
- Codex CLI instalado y autenticado mediante `codex login` con ChatGPT.
- CLI con soporte para `--no-daemon`, `exec --ignore-user-config`, `--ignore-rules`
  y `--ephemeral`. Los flags se verificaron contra `codex-cli 0.163.0-alpha.10.2`
  usando `codex --help`, `codex exec --help` y `codex features list`. No se garantiza
  compatibilidad con versiones anteriores; un flag no reconocido devuelve `UNKNOWN`.
- La extensión debe integrar el proveedor y declarar `nativeMessaging` antes de
  poder usarlo desde su service worker. Esa integración corresponde a Claude.

El puente usa la cuenta y los límites de Codex. El prompt y el texto del CV se
envían a OpenAI mediante Codex; «local» describe el puente, no la inferencia.
Una sesión iniciada solamente en otra aplicación puede no estar disponible para
el CLI: comprobá `codex login status` desde la misma cuenta del sistema operativo.

## Instalación

1. Desde la raíz del repositorio, ejecutá `npm install` para instalar los workspaces.
2. Verificá `codex --version`, `codex exec --help` y `codex login status`.
   Si falta la sesión, ejecutá `codex login` y elegí ChatGPT.
3. Cuando esté disponible la extensión integrada, compilala con `npm run build`.
4. En `chrome://extensions`, activá el modo desarrollador y cargá
   `apps/extension/dist` como extensión descomprimida. Copiá su ID de 32 letras.
5. Registrá el host para ese ID (reemplazá el valor de ejemplo):

   ```sh
   npm run install-host -w @garra/codex-bridge -- --extension-id abcdefghijklmnopabcdefghijklmnop
   ```

   Si Codex no está en PATH, agregá `--codex-path` con la ruta absoluta al
   ejecutable, al `codex.cmd` de npm o a `@openai/codex/bin/codex.js`:

   ```powershell
   npm run install-host -w @garra/codex-bridge -- --extension-id abcdefghijklmnopabcdefghijklmnop --codex-path "C:\ruta\codex.exe"
   ```

6. Reiniciá Chrome. En la consola del service worker de la extensión probá:

   ```js
   chrome.runtime.sendNativeMessage('com.garra.codex_bridge', { type: 'ping' }, response => {
     console.log(chrome.runtime.lastError?.message ?? response);
   });
   ```

   Resultado esperado: `{ ok: true, version: "0.1.0", codexVersion: "..." }`.
   `ping` comprueba el ejecutable y su versión; no valida la sesión ni consume una generación.

El instalador copia el host compilado y guarda las rutas absolutas de Node y Codex.
Repetí la instalación si esas rutas cambian, después de actualizar el puente o si
cambia el ID de la extensión. No requiere permisos de administrador.

| Sistema | Manifest de Chrome | Host y configuración |
| --- | --- | --- |
| Windows | `%LOCALAPPDATA%\GarraLaPala\codex-bridge\com.garra.codex_bridge.json` y registro HKCU | `%LOCALAPPDATA%\GarraLaPala\codex-bridge` |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.garra.codex_bridge.json` | `~/Library/Application Support/GarraLaPala/codex-bridge` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/google-chrome/NativeMessagingHosts/com.garra.codex_bridge.json` | `~/.local/share/garra-la-pala/codex-bridge` |

En Windows se registra el valor predeterminado de
`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.garra.codex_bridge`.
La lista `allowed_origins` contiene exclusivamente `chrome-extension://<ID>/`.
Los lanzadores son `.cmd` en Windows y `.sh` ejecutable en macOS/Linux.

## Protocolo y comportamiento

Cada mensaje contiene cuatro bytes little-endian con la longitud en **bytes**,
seguidos de JSON UTF-8. Se aceptan lecturas fragmentadas y varios mensajes por
conexión. El puente limita mensajes entrantes y salientes a 1 MiB.

```json
{ "type": "complete", "system": "Instrucciones de redacción", "user": "Oferta y CV", "timeoutMs": 120000 }
```

`model` es opcional. `timeoutMs` debe ser un entero entre 1 y 300000; por defecto,
120000. Una respuesta exitosa es `{ "ok": true, "text": "..." }`. Un fallo es
`{ "ok": false, "code": "...", "error": "mensaje legible" }`.

| Código del host | Código de `ProviderError` |
| --- | --- |
| `USAGE_LIMIT` | `RATE_LIMIT` |
| `NOT_INSTALLED`, `NOT_LOGGED_IN` | `NOT_AVAILABLE` |
| `TIMEOUT` | `TIMEOUT` |
| `UNKNOWN` u otro código | `UNKNOWN` |

El prompt se escribe por stdin, nunca como argumento. Codex usa un directorio
temporal vacío, sandbox `read-only`, aprobaciones `never`, sesión efímera y
autenticación forzada a ChatGPT. Se ignoran la configuración y las reglas del
usuario y se deshabilitan shell, apps, plugins, hooks, agentes, ejecución de
código, navegación, uso de computadora, imágenes y búsqueda web. Las políticas
administradas del sistema siguen aplicándose; una incompatibilidad falla sin
relajar las restricciones.

Solo se lee el archivo de respuesta final. stdout del host contiene únicamente
tramas; los diagnósticos de Codex no se reenvían ni se registran. Los archivos
temporales se eliminan al terminar, incluso ante fallos controlados. Un cierre
forzado del sistema puede dejar un directorio `garra-codex-*` en el temporal.
El timeout termina el árbol de procesos en Windows y el grupo en POSIX.

El proveedor usa `chrome.runtime.sendNativeMessage` y respeta `AbortSignal`:
cancelar deja de esperar la respuesta. Esa API no permite cancelar un host ya
iniciado; la generación puede continuar hasta finalizar o alcanzar su timeout.
Invocá el proveedor desde el service worker o una página de la extensión.

## Verificación e integración pendiente

```sh
npm run check -w @garra/codex-bridge
npm run check
```

Los tests usan procesos simulados, no llaman al servicio de Codex ni consumen cupo.
Cubren framing, límites, UTF-8, validación, stdin, limpieza, errores, timeout,
resolución de shims npm, planes de instalación de los tres sistemas y proveedor.
La instalación real en Chrome y la generación autenticada requieren una prueba
manual después de integrar la extensión.

Pendiente para Claude, fuera de los archivos asignados a A1:

- Agregar `"nativeMessaging"` al manifest.
- Registrar `createCodexBridgeProvider()` en la cadena de proveedores y manejar
  `RATE_LIMIT`/`NOT_AVAILABLE` según las preferencias de fallback de la persona.
- Incorporar el typecheck/build del nuevo paquete a los scripts de la raíz.
- Regenerar `package-lock.json` mediante `npm install`; la única dependencia nueva
  es `@types/node` de desarrollo para comprobar las APIs del host. No hay nuevas
  dependencias de runtime.

La base `773158a` todavía no incluye `apps/extension/build.mjs`; por eso
`npm run check` no puede completar su etapa de build hasta que se integre esa base.
No se modificaron los contratos compartidos ni los archivos de la interfaz.

## Desinstalación

Cerrá Chrome. Borrá el manifest indicado en la tabla y la carpeta de instalación
del host. En Windows eliminá también **solo** la clave
`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.garra.codex_bridge`.
Esto no elimina Codex ni su sesión.

## Referencias

- [Modo no interactivo de Codex](https://learn.chatgpt.com/docs/non-interactive-mode).
- [Configuración de Codex](https://learn.chatgpt.com/docs/config-file/config-reference).
- [Native Messaging de Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).
