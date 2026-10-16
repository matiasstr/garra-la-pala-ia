# Validación de A1 — 16 de octubre de 2026

Rama: `astra/a1-codex-bridge`, basada en `773158a` de
`origin/claude/awesome-tesla-eggzci` porque `main` solo contiene el README.

## Resultado

`npm run check -w @garra/codex-bridge` terminó con código 0:

```text
typecheck: tsc -p tsconfig.json — OK
Test Files  6 passed (6)
Tests       66 passed (66)
build: node build.mjs — OK
```

También pasó una prueba del host compilado ejecutado como subproceso de Node en
Windows, contra un CLI simulado. Comprobó el intercambio binario de `ping` y
`complete`, entrada fragmentada, texto UTF-8 con emoji, exclusión de stdout del
CLI de la respuesta y eliminación de los directorios temporales.

No se ejecutó una generación real de Codex, no se consumió cupo y no se registró
un host en Chrome. Los planes de instalación de Windows/macOS/Linux están
cubiertos por tests; la instalación real necesita el ID de la extensión integrada.

## Bloqueo de la verificación global

Se ejecutó `npm run check`. Pasaron el typecheck de core/extensión y los tests
existentes al momento de esa ejecución (61; luego se agregaron 5 pruebas que
pasaron en el check del paquete). La compilación global terminó con código 1:

```text
> @garra/extension@0.1.0 build
> node build.mjs
Error: Cannot find module '.../apps/extension/build.mjs'
code: 'MODULE_NOT_FOUND'
```

Ese archivo ya faltaba en la base y está fuera del alcance de A1. `AGENTS.md`
indica: «Antes del PR: `npm run check` en verde». Por eso no se abrió el PR ni se
marcó A1 como mergeada. El código local queda listo para integrar y revisar.

## Entorno de validación

- Windows, Node 22.18.0, npm 10.9.3, Vitest 4.1.12.
- CLI inspeccionado: `codex-cli 0.163.0-alpha.10.2`.
- El sandbox bloqueó los symlinks que crea `npm ci` para workspaces. Se instalaron
  las dependencias con `npm ci --workspaces=false` y se copió únicamente el paquete
  local core a `node_modules/@garra/core` para resolver sus imports en esta prueba.
- `@types/node` y `undici-types` se instalaron en una carpeta temporal y se copiaron
  a `node_modules` para comprobar tipos. No se cambió el lockfile compartido.
- TEMP/TMP se dirigieron a una carpeta de trabajo permitida porque el temporal
  predeterminado del sandbox bloqueaba los renombrados de caché de Vitest.

## Integración para Claude

1. Completar la base de la extensión y su build.
2. Regenerar el lockfile con `npm install` para registrar el workspace y su
   dependencia de desarrollo `@types/node`.
3. Incluir typecheck/build de `@garra/codex-bridge` en los scripts de la raíz.
4. Agregar `nativeMessaging` al manifest y registrar el proveedor en background.
5. Ejecutar `npm run check` y `npm run check -w @garra/codex-bridge`.
6. Probar instalación, ping y generación autenticada en Chrome con el ID real.

Título propuesto para el PR: `[Astra] A1: puente local con Codex mediante Native Messaging`.
La configuración de proveedores, manifest, panel, background y contratos
compartidos permanecen a cargo de la integración de Claude.
