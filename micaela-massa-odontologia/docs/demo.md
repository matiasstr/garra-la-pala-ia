# Demo online para probar el sistema

Esta guía explica cómo publicar una **versión de prueba** del sistema en internet, para que la odontóloga la use desde su casa o desde el consultorio, en la computadora, la tablet o el celular.

> **Importante: es una versión de prueba con datos inventados. Nunca cargues pacientes reales.**
> No tiene inicio de sesión real, los datos se pueden borrar en cualquier momento y el servicio gratuito está en Brasil. La instalación real del consultorio va a ser otra, con su propia base y sus controles legales (ver [`legal.md`](legal.md)).

## Qué vas a tener

- Una dirección web (por ejemplo, `https://micaela-massa-demo.vercel.app`) que se abre desde cualquier navegador.
- El navegador pide una contraseña antes de entrar: la que elijas en el paso 2.
- Datos inventados: tres usuarios de prueba (la secretaria Sofía, la odontóloga Micaela y la endodoncista Laura), seis pacientes y turnos para hoy y los próximos 10 días hábiles.
- Arriba a la derecha, un selector para elegir con qué usuario navegar y ver qué permite cada rol.
- Arriba de todo, una franja amarilla que avisa que es una versión de prueba, con el botón **Reiniciar datos de prueba**.

## Qué se usa

| Servicio | Para qué | Costo |
| --- | --- | --- |
| [Vercel](https://vercel.com), plan Hobby | Publica la aplicación en internet | Gratis, solo para uso personal y no comercial |
| [Neon](https://neon.com), plan Free | La base de datos (PostgreSQL) | Gratis |

La cuenta de Vercel se crea con la de GitHub, y Neon se agrega desde adentro de Vercel: no hay que crear nada por separado.

## Paso 1: crear la cuenta de Vercel

1. Entrá a [vercel.com/signup](https://vercel.com/signup).
2. Elegí el plan **Hobby** (el gratis, para proyectos personales) y escribí tu nombre.
3. Tocá **Continue with GitHub** y aceptá los permisos que pide.

## Paso 2: importar el repositorio

1. En Vercel, tocá **Add New…** → **Project**.
2. En la lista de repositorios buscá **garra-la-pala-ia** (de `matiasstr`) y tocá **Import**.
   Si no aparece, tocá **Adjust GitHub App Permissions** y dale acceso a ese repositorio.
3. En **Root Directory** tocá **Edit**, elegí la carpeta **`micaela-massa-odontologia`** y confirmá. Esto es importante: el sistema está en esa carpeta, no en la raíz del repositorio.
4. **Framework Preset** tiene que decir **Next.js** (lo detecta solo).
5. Abrí **Environment Variables** y agregá estas tres, una por una (nombre a la izquierda, valor a la derecha):

   | Nombre | Valor | Para qué |
   | --- | --- | --- |
   | `MODO_DESARROLLO` | `1` | Activa los datos y los usuarios de prueba |
   | `DEMO_PERMITE_REINICIO` | `1` | Muestra el botón **Reiniciar datos de prueba** |
   | `DEMO_CLAVE` | una contraseña que elijas | La contraseña que pide el navegador para entrar. Es obligatoria: sin ella la demo no arranca |

   Para `DEMO_CLAVE` usá una contraseña larga (por ejemplo, tres palabras y un número) y compartila solo con quien vaya a probar.

6. Tocá **Deploy**. Va a tardar un par de minutos.
   **Es normal que esta primera publicación muestre un error al abrirla:** todavía falta la base de datos. Seguí con el paso 3.

## Paso 3: agregar la base de datos (Neon)

1. Dentro del proyecto, en Vercel, andá a la pestaña **Storage**.
2. Tocá **Create Database**, elegí **Neon** (Serverless Postgres) y tocá **Continue**.
3. Aceptá las condiciones y completá:
   - **Region:** **São Paulo, Brazil (sa-east-1)**. Tiene que ser esta: es la más cercana y la misma donde corre la aplicación (si quedan en lugares distintos, todo anda muy lento). La región no se puede cambiar después.
   - **Plan:** **Free**.
   - **Database name:** por ejemplo `micaela-massa-demo`.
4. Tocá **Create**.
5. Cuando pregunte a qué proyecto conectarla (**Connect Project**), elegí este proyecto y marcá el entorno **Production**. Con eso Vercel carga solas las variables `DATABASE_URL` y `DATABASE_URL_UNPOOLED`: no hace falta copiarlas ni tocarlas.

## Paso 4: publicar de nuevo

1. Andá a la pestaña **Deployments**.
2. En la publicación de arriba de todo, tocá los tres puntos (**⋯**) → **Redeploy** → **Redeploy**.
3. Cuando termine, tocá **Visit** (o la dirección que aparece en **Domains**).
4. El navegador te pide la contraseña: escribí la de `DEMO_CLAVE`. Si también pide usuario, probá con cualquiera (*a verificar cuando se una la parte de la contraseña compartida*).

La primera vez tarda unos segundos más: el sistema arma la base y carga los datos de prueba solo.

## Paso 5: probar

- La agenda abre en el día de hoy, con turnos.
- Con el selector de arriba a la derecha cambiás de usuario: la secretaria no ve la historia clínica; la odontóloga sí.
- Podés dar turnos, cargar pacientes inventados, sacar fotos con la tablet o el celular y agregar notas.

## Qué rama se publica y cómo actualizar

- Vercel publica la **rama principal** del repositorio (`main`). Cada vez que se suben cambios a esa rama, Vercel publica la versión nueva solo, en un par de minutos, en la misma dirección.
- Si la versión que querés mostrar está en otra rama, hay dos caminos:
  - unir esa rama a `main` (lo recomendado), o
  - en Vercel: **Settings** → **Environments** → **Production** → **Branch Tracking**, escribir el nombre de la rama y guardar. Se aplica con el próximo cambio que se suba a esa rama (o con **Redeploy**).
- Los cambios en otras ramas generan "vistas previas" con otra dirección, que Vercel protege con su propio inicio de sesión. Para la demo no se usan.
- Cuando una versión nueva trae cambios en la base, se aplican solos al abrirla. Los datos que ya estaban se conservan.
- **Excepción, una sola vez:** una demo armada antes de la "marca de base de prueba" (noviembre de 2026) no arranca con la versión nueva: el sistema se niega a usar una base con datos que no esté marcada como de prueba, por si fuera la del consultorio. Se arregla vaciando la base con el SQL de [Si algo no anda](#si-algo-no-anda); la próxima visita la vuelve a armar, ya marcada.

## Reiniciar los datos de prueba

Con el tiempo, la agenda de "hoy" se queda sin turnos (la semilla los carga para las próximas dos semanas hábiles), o capaz querés empezar una prueba desde cero.

1. En la franja amarilla de arriba, tocá **Reiniciar datos de prueba**.
2. Tocá el botón **Reiniciar datos de prueba** y después **Sí, borrar y volver a empezar**.
3. En unos segundos vuelve a la agenda con todo como al principio y turnos desde hoy.

Se borra todo lo que se cargó en la prueba (pacientes, turnos, fotos y notas), y se vuelve a empezar con la secretaria como usuario. Los feriados no se tienen en cuenta: también hay turnos en días feriados.

El botón solo existe si están `MODO_DESARROLLO=1` **y** `DEMO_PERMITE_REINICIO=1`. Sin las dos, no aparece y el servidor se niega a reiniciar aunque alguien lo intente por otro lado.

## Cuando la demo "se duerme"

En el plan gratis, la base de datos se apaga sola después de **5 minutos sin uso**, y Vercel también apaga la aplicación cuando nadie la usa. No se pierde nada: la primera visita después de un rato tarda un poco más (normalmente menos de un segundo de más, a veces unos segundos) y después anda normal.

## Límites del plan gratis

| Servicio | Límite | Qué significa para la demo |
| --- | --- | --- |
| Vercel Hobby | Uso personal y **no comercial** | Sirve para que la odontóloga pruebe. Para usarlo de verdad o venderlo hay que pasar a un plan pago u otro proveedor |
| Vercel Hobby | 1 millón de pedidos por mes, 4 horas de CPU activa, 360 GB-hora de memoria y 100 GB de transferencia | Sobra para una persona probando |
| Vercel Hobby | Si se pasa un límite, se pausa hasta que pasen 30 días; no se puede pagar el excedente | Muy improbable con este uso |
| Vercel Hobby | Las funciones corren en una sola región (acá, São Paulo: `gru1`) | Es lo que queremos |
| Neon Free | 100 horas de cómputo por mes por proyecto | Como se duerme a los 5 minutos sin uso, alcanza de sobra |
| Neon Free | Entre 0,5 GB y 1 GB de datos por proyecto (*a verificar*: las páginas de Neon dan las dos cifras) | Una foto ocupa unos 100 KB: entran miles |
| Neon Free | Se duerme a los 5 minutos sin uso; no se puede desactivar | Ver la sección anterior |

Los límites cambian: antes de depender de ellos, revisalos en las páginas oficiales (ver [Fuentes](#fuentes)).

## Cuando se use de verdad

Esta demo **no** es la instalación del consultorio. Para usar el sistema con pacientes reales hace falta, como mínimo:

- un plan pago o un proveedor que permita uso comercial (el plan Hobby de Vercel no lo permite);
- inicio de sesión real con verificación en dos pasos, y nunca `MODO_DESARROLLO` ni `DEMO_PERMITE_REINICIO`;
- decidir dónde se alojan los datos: son datos de salud y la Ley 25.326 restringe mandarlos fuera del país. Brasil se eligió para la demo por cercanía, no por razones legales (ver [`arquitectura.md`](arquitectura.md) y [`legal.md`](legal.md));
- guardar los archivos en un almacenamiento con retención (Object Lock), copias de seguridad y la revisión legal.

## Si algo no anda

- **La página muestra "Algo salió mal" después de publicar:** revisá que la base esté conectada (paso 3) y que se haya hecho **Redeploy** después (paso 4). En Vercel, **Settings** → **Environment Variables** tiene que mostrar `DATABASE_URL`.
- **La página dice "El sistema no arranca: MODO_DESARROLLO=1 en una versión compilada… necesita DEMO_CLAVE":** falta la variable `DEMO_CLAVE` (paso 2). Agregala en **Settings** → **Environment Variables** y hacé **Redeploy**.
- **"Algo salió mal", y en los registros de Vercel (**Logs**) dice "El modo desarrollo se niega a usar esta base":** la base tiene datos pero no está marcada como base de prueba. Si es la base de la demo (armada con una versión vieja), vaciala con el SQL de más abajo. Si es la base real del consultorio, la demo está conectada a la base equivocada: desconectala.
- **Todo anda muy lento:** revisá que la base esté en São Paulo. En Vercel, **Storage** → la base → región. Si no, hay que crear otra base en São Paulo y conectarla en lugar de la anterior.
- **Después de una actualización no abre y el reinicio tampoco:** abrí la base desde Vercel (**Storage** → la base → **Open in Neon**), entrá a **SQL Editor**, pegá esto y tocá **Run**. Borra todo; la próxima visita vuelve a armar la base con los datos de prueba:

  ```sql
  drop schema if exists drizzle cascade;
  drop schema public cascade;
  create schema public;
  ```

## Para quien mantiene el sistema

- **Variables:** `MODO_DESARROLLO=1` activa datos y usuarios de prueba (selector en lugar de inicio de sesión, solo con las cuentas `@consultorio.local` de la semilla). `DEMO_PERMITE_REINICIO=1` habilita el reinicio (además de `MODO_DESARROLLO=1`; se verifica en el servidor, en `permiteReiniciarDemo`). `DEMO_CLAVE` activa la contraseña compartida (autenticación HTTP Basic en `proxy.ts`) y es obligatoria con `MODO_DESARROLLO=1` en una versión compilada: sin ella el proxy responde 503 y la base no se conecta. `DATABASE_URL` (con pooler) y `DATABASE_URL_UNPOOLED` (directa) las carga la integración de Neon.
- **Arranque:** en modo desarrollo con `DATABASE_URL`, la primera conexión de cada instancia aplica las migraciones y siembra si la base está vacía (`src/db/client.ts` y `src/db/preparar.ts`). La semilla deja la marca de base de prueba (`base_de_prueba`); si la base tiene datos y no tiene la marca, la demo no arranca, y el modo real nunca arranca sobre una base con la marca (ver `docs/arquitectura.md`, "Barrera entre la demo y la base real"). Lo hace por la conexión directa (`DATABASE_URL_UNPOOLED`; si falta, se saca `-pooler` del servidor de Neon) con un *advisory lock* de PostgreSQL, para que varias instancias que arrancan a la vez no migren dos veces. El pooler de Neon (PgBouncer en modo transacción) no respeta esos bloqueos de sesión. Fuera de modo desarrollo no se migra ni se siembra solo: se usa `npm run db:migrate`.
- **Conexiones:** la aplicación usa `DATABASE_URL` (con pooler) con pocas conexiones (5) que se cierran a los 10 segundos sin uso. `sslmode=require` se pide como `verify-full`, que es lo que node-postgres ya hace hoy, sin el aviso de cambio futuro.
- **Archivos:** en Vercel el disco no dura, así que las fotos se guardan en la tabla `archivos` (`bytea`), con el SHA-256 como nombre; la base comprueba la huella y rechaza `UPDATE`, `DELETE` y `TRUNCATE`. Con PGlite (sin `DATABASE_URL`) siguen yendo a `.data/archivos`.
- **Reinicio:** como los triggers impiden borrar lo clínico fila por fila, el reinicio descarta los esquemas `public` y `drizzle` (`drop schema … cascade`), migra de nuevo y siembra con la fecha de hoy, todo con el mismo bloqueo. Queda registrado en `auditoria_accesos` (`demo.reiniciar`).
- **Empaquetado:** `next.config.ts` incluye `drizzle/*.sql` y `drizzle/meta/_journal.json` en las funciones (`outputFileTracingIncludes`) y deja afuera las fotos del esquema. `vercel.json` fija la región `gru1` (São Paulo), la misma que Neon `aws-sa-east-1`.
- **Probar la demo en la computadora con PostgreSQL:**

  ```bash
  npm run build
  DATABASE_URL=postgres://usuario:clave@localhost:5432/mm_demo MODO_DESARROLLO=1 DEMO_CLAVE=una-clave DEMO_PERMITE_REINICIO=1 npm start
  ```

- **Tests con PostgreSQL real** (varias instancias a la vez y pedidos simultáneos: bloqueo de intentos, sillón, reprogramar y pendientes). Vacían la base indicada y crean otra con el mismo nombre terminado en `_concurrencia`:

  ```bash
  PRUEBA_POSTGRES_URL=postgres://usuario:clave@localhost:5432/base_descartable npx vitest run tests/db/postgres-demo.test.ts tests/db/concurrencia-postgres.test.ts
  ```

## Fuentes

Consultadas en noviembre de 2026. Lo marcado *a verificar* no se pudo confirmar en la página oficial.

- Vercel, plan Hobby (uso personal y no comercial, límites incluidos, pausa de 30 días): [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby)
- Vercel, uso justo ("Hobby teams are restricted to non-commercial personal use only"): [vercel.com/docs/limits/fair-use-guidelines](https://vercel.com/docs/limits/fair-use-guidelines)
- Vercel, términos del servicio: [vercel.com/terms](https://vercel.com/terms)
- Vercel, regiones (`gru1` = São Paulo, Brasil): [vercel.com/docs/regions](https://vercel.com/docs/regions)
- Vercel, región de las funciones (Hobby: una sola región; `regions` en `vercel.json`): [vercel.com/docs/functions/configuring-functions/region](https://vercel.com/docs/functions/configuring-functions/region)
- Vercel, duración por defecto de 300 segundos con Fluid compute: [vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute)
- Vercel, archivos en funciones (`process.cwd()` y `outputFileTracingIncludes`): [vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions](https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions)
- Vercel, monorepos y Root Directory: [vercel.com/docs/monorepos](https://vercel.com/docs/monorepos)
- Vercel, rama de producción (Branch Tracking): [vercel.com/kb/guide/can-i-use-a-non-default-branch-for-production](https://vercel.com/kb/guide/can-i-use-a-non-default-branch-for-production)
- Neon, regiones (`aws-sa-east-1`, São Paulo): [neon.com/docs/introduction/regions](https://neon.com/docs/introduction/regions) y anuncio: [neon.com/docs/changelog/2025-02-28](https://neon.com/docs/changelog/2025-02-28)
- Neon, planes y límites del plan Free (100 horas de cómputo por proyecto; almacenamiento 0,5 GB o 1 GB según la página, *a verificar*): [neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans), [neon.com/pricing](https://neon.com/pricing), [neon.com/faqs/free-plan-limits-and-quotas](https://neon.com/faqs/free-plan-limits-and-quotas)
- Neon, apagado a los 5 minutos y arranque en unos cientos de milisegundos: [neon.com/docs/guides/scale-to-zero-guide](https://neon.com/docs/guides/scale-to-zero-guide), [neon.com/docs/connect/connection-latency](https://neon.com/docs/connect/connection-latency)
- Neon, integración con Vercel (`DATABASE_URL` con pooler y `DATABASE_URL_UNPOOLED` directa): [neon.com/docs/guides/vercel-native-integration](https://neon.com/docs/guides/vercel-native-integration), [neon.com/docs/guides/vercel-overview](https://neon.com/docs/guides/vercel-overview)
- Neon, pooler en modo transacción (sin bloqueos de sesión; usar la conexión directa para migrar): [neon.com/docs/connect/connection-pooling](https://neon.com/docs/connect/connection-pooling)
- PgBouncer, funciones por modo de pool: [pgbouncer.org/features](https://www.pgbouncer.org/features)

*A verificar:* los nombres exactos de botones y menús de Vercel y Neon (cambian seguido), si el navegador pide también un usuario además de la contraseña de `DEMO_CLAVE`, y la cifra de almacenamiento del plan Free de Neon. Las páginas de Vercel y Neon no se pudieron abrir directamente desde el entorno donde se escribió esta guía: los datos salen de los resúmenes de búsqueda de esas páginas.
