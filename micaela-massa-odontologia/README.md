# Micaela Massa Odontología — Sistema de gestión

Sistema para el consultorio: historia clínica digital con validez legal, odontograma, roles, agenda y seguimiento de pacientes.

- **Versión 1 (en construcción):** historia clínica y odontograma, firma de cada evolución, roles, ficha del paciente, agenda y tablero de pendientes.
- **Versión 2:** WhatsApp e Instagram, recordatorios automáticos, facturación ARCA y liquidación a OSDE, métricas.

## Estado actual

| Pieza | Estado |
| --- | --- |
| Modelo de datos (PostgreSQL) con inalterabilidad en la base | Listo, con tests |
| Firma encadenada por hash de cada registro clínico | Lista, con tests |
| Permisos por rol (secretaria, profesional, administrador) | Listos, con tests |
| Odontograma: dominio (FDI, caras, historial a fecha) | Listo, con tests |
| Odontograma: interfaz táctil | Guarda en la historia clínica (firmado con PIN). `/odontograma` queda como pantalla de práctica |
| Identificación de pacientes (duplicados, homónimos, menores) | Lista, con tests |
| Reglas de seguimiento (pendientes y alertas de 48 horas), adaptadas a "¿Cuándo debería volver?" | Listas, con tests |
| **Pacientes:** búsqueda sin tildes, alta con aviso de duplicados y homónimos, ficha, foto, coberturas, notas | Lista, con tests y prueba en navegador |
| **Agenda:** día por profesional, estados con historial, superposiciones, reprogramar, recordatorio por WhatsApp | Lista, con tests y prueba en navegador |
| **"¿Cuándo debería volver?"**: se carga al marcar Atendido en la agenda o desde la ficha; queda quién lo indicó y quién lo cargó | Listo, con tests y prueba en navegador |
| **Tablero de pendientes** (`/pendientes`): bandeja común, tomar, registrar contacto, "volver a contactar el…", dar turno, WhatsApp, descartar, "No responde" a los 3 intentos y aviso a la profesional | Listo, con tests y prueba en navegador. Se recalcula al abrir el sistema y con cada cambio de turnos (todavía sin tareas programadas) |
| **Historia clínica:** evoluciones con borrador y firma con PIN, enmiendas, línea de tiempo con verificación de integridad, odontograma que guarda y "ver a fecha", adjuntos (imágenes y PDF) con huella, auditoría de cada apertura | Lista, con tests y prueba en navegador |
| PIN de firma (scrypt, bloqueo por intentos fallidos) en `/cuenta/pin-de-firma` | Listo, con tests |
| **Inicio de sesión:** contraseña con scrypt, verificación en dos pasos obligatoria (app de autenticación), códigos de recuperación, sesiones que vencen, bloqueo por intentos | Listo, con tests y prueba en navegador contra PostgreSQL |
| **Cuentas:** "Mi cuenta" (contraseña, app, códigos, sesiones abiertas) y administración de usuarios (altas con roles y matrícula, desactivar, blanqueos con enlace de un solo uso) | Listo, con tests y prueba en navegador |
| Varios consultorios | Preparado: consultorios, roles por consultorio y sesión con consultorio activo. Falta `consultorio_id` en los datos ([plan](docs/multi-consultorio.md)) |
| Almacenamiento de archivos en la nube con Object Lock | Por hacer: hoy se guardan en disco local |

## Stack

- **Next.js 16 + React 19 + TypeScript**: app web que funciona en computadora y en tablet.
- **PostgreSQL + Drizzle ORM**: migraciones SQL versionadas en `drizzle/`.
- **Vitest + PGlite**: los tests corren contra un Postgres real en memoria, con los triggers incluidos.

Las decisiones y sus motivos están en [`docs/arquitectura.md`](docs/arquitectura.md).

## Cómo correrlo

Requiere Node 22 o superior.

```bash
npm install
```

```bash
npm test
```

El sistema se usa de dos formas que **nunca se mezclan**:

| | Desarrollo y demo | Instalación real del consultorio |
| --- | --- | --- |
| Para qué | Probar y mostrar, con datos inventados | Pacientes reales |
| Base de datos | Una base que siembra el propio sistema y marca como "base de prueba" | Una base nueva, solo para el consultorio |
| Ingreso | Selector de usuario sin contraseña, y usuarios de prueba con contraseña pública | Contraseña y verificación en dos pasos de cada persona |
| Cómo se activa | `npm run dev`, o `MODO_DESARROLLO=1` con `DEMO_CLAVE` | Sin `MODO_DESARROLLO`, con `DATABASE_URL`, `CLAVE_SECRETOS` y `URL_PUBLICA` |

El sistema se niega a mezclarlas: el modo desarrollo no arranca sobre una base con datos que no esté marcada como de prueba (podría ser la del consultorio), y el modo real no arranca sobre una base de prueba ("esta base tiene datos de prueba"), porque sus usuarios tienen contraseñas públicas. Una versión compilada con `MODO_DESARROLLO=1` tampoco arranca sin `DEMO_CLAVE`.

### Desarrollo y demo (datos inventados)

```bash
npm run dev
```

Abre en http://localhost:3000. Sin `DATABASE_URL`, la app usa una base PostgreSQL embebida en `.data/` y la carga con pacientes, turnos, usuarios e historias clínicas inventados. Arriba a la derecha se elige con qué usuario de prueba navegar (secretaria, odontóloga, endodoncista o alguien de administración que no atiende) para ver qué permite cada rol. Las profesionales de prueba firman con el PIN **1234**. El tablero de pendientes arranca con casos variados: un tratamiento sin turno marcado como importante, un presupuesto sin respuesta, un ausente, un control de 6 meses por vencer y un paciente que no responde después de 3 intentos.

Para volver a los datos de prueba del día:

```bash
npm run db:reset
```

También hace falta después de actualizar, si la app no arranca por un cambio en la base. En particular, las bases de desarrollo creadas antes de la marca de base de prueba (el sistema avisa que "se niega a usar esta base") se arreglan así.

#### Usuarios de prueba

En modo desarrollo también se puede probar el inicio de sesión real en http://localhost:3000/ingresar:

| Usuario | Roles |
| --- | --- |
| `mica@consultorio.local` | Profesional y administración |
| `laura@consultorio.local` | Profesional (endodoncia) |
| `sofia@consultorio.local` | Secretaria |

- Contraseña de todos: `prueba-consultorio`.
- Clave de la app de autenticación (la misma para los tres): `MICAMASSAPRUEBA2MICAMASSAPRUEBA2`. Se carga en Google Authenticator o similar con "Ingresar una clave de configuración", tipo "basada en el tiempo".

Son datos inventados y públicos. Por eso la semilla solo se carga en una base vacía, la marca como base de prueba, y el modo real se niega a usar esa base. El selector de usuario solo ofrece estas cuentas (las de `@consultorio.local`): un usuario creado durante la prueba entra con su contraseña, como en el sistema real.

#### Demo compilada y demo online

Para mostrar una demo con la versión compilada (más rápida), en Linux o macOS:

```bash
npm run build && MODO_DESARROLLO=1 DEMO_CLAVE=<contraseña> npm start
```

`MODO_DESARROLLO=1` activa los datos y usuarios de prueba, y `DEMO_CLAVE` hace que el navegador pida esa contraseña en todo el sitio (cualquier usuario). Sin `DEMO_CLAVE` la versión compilada no arranca: cualquiera que llegara a la dirección entraría sin contraseña.

Para publicar una demo online con datos inventados (Vercel + Neon, gratis), seguir [`docs/demo.md`](docs/demo.md).

### Instalación real

Para el consultorio, con pacientes reales. Usa una base PostgreSQL nueva, que nunca pasó por el modo desarrollo, y nunca `MODO_DESARROLLO` ni `DEMO_PERMITE_REINICIO`.

Copiar `.env.example` a `.env.local` y completar `DATABASE_URL`, `CLAVE_SECRETOS` (al menos 32 caracteres al azar, por ejemplo `openssl rand -base64 48`; si se pierde, todos tienen que volver a configurar la app de autenticación) y `URL_PUBLICA`.

> **Nunca compartas `.env.local`**: ni por WhatsApp o email, ni en el repositorio, ni copiado a otra computadora "para probar". Tiene la contraseña de la base y `CLAVE_SECRETOS`: con eso se leen los datos de los pacientes y se descifran las claves de las apps de autenticación. Cada instalación tiene el suyo, y la demo nunca usa el de la instalación real.

Después, aplicar las migraciones:

```bash
npm run db:migrate
```

En una base nueva, crear el consultorio y su primera administradora:

```bash
npm run crear-administrador -- --email mica@ejemplo.com --nombre Micaela --apellido Massa \
  --matricula "MP 12345" --especialidad odontologia_general --url https://sistema.ejemplo.com.ar
```

Imprime un enlace de un solo uso (vence a las 72 horas): con él se elige la contraseña y se configura la app de autenticación. Conviene abrirlo en el celular. Los demás usuarios se crean desde el sistema, en "Usuarios del consultorio". Si la única administradora pierde el acceso (celular y códigos de recuperación), un enlace nuevo:

```bash
npm run crear-administrador -- --recuperar mica@ejemplo.com --url https://sistema.ejemplo.com.ar
```

`npm run db:migrate` y `npm run crear-administrador` leen `DATABASE_URL` del entorno (el segundo también de `.env.local`). El comando corre TypeScript con `tsx`, que ya viene instalado con drizzle-kit, y se niega a trabajar sobre una base de prueba.

En producción, el sistema tiene que estar detrás de un proxy de confianza que fije el encabezado `X-Forwarded-For` (en Vercel lo hace la plataforma; con nginx o Caddy hay que configurarlo): de ahí sale la IP de los bloqueos y de la auditoría (ver [`docs/arquitectura.md`](docs/arquitectura.md), "Inicio de sesión").

## Estructura

```
src/
  domain/            Reglas del negocio, sin dependencias de base ni interfaz
    acceso/          Contraseñas (scrypt), TOTP, códigos de recuperación, sesiones y bloqueos
    permisos/        Roles, permisos y quién puede firmar o enmendar
    odontograma/     Piezas FDI, caras, catálogo de hallazgos, estado a una fecha
    firma/           Encadenamiento por hash y reglas del PIN de firma
    historia-clinica/ Lectura de lo firmado y línea de tiempo con enmiendas
    pacientes/       Duplicados, homónimos, edad y consentimiento de menores
    agenda/          Estados de turno y recordatorio por WhatsApp con un clic
    seguimiento/     "¿Cuándo debería volver?", reglas, intentos y orden del tablero de pendientes
  lib/               Fechas y horas en hora argentina; reglas del modo desarrollo
  db/                Esquema Drizzle, conexión, datos de prueba y marca de base de prueba
  server/            Pacientes, agenda, pendientes, archivos, usuarios y sesión (con permisos)
    acceso/          Ingreso, sesiones, "Mi cuenta", administración de usuarios y enlaces de un solo uso
    hc/              Firmar registros, PIN, evoluciones, adjuntos y la pantalla de la HC (auditado)
  proxy.ts           Antes de cada pedido: demo con contraseña y filtro de sesión
  components/        Interfaz (odontograma, acceso y componentes comunes)
  app/ingresar/      Inicio de sesión (contraseña y código)
  app/configurar-acceso/  Primer ingreso y blanqueos con el enlace de un solo uso
  app/(sistema)/     Pantallas: agenda, pacientes, ficha, pendientes, historia clínica, PIN de firma, mi cuenta y usuarios
scripts/             Comandos de consola (crear-administrador)
drizzle/             Migraciones SQL (0001 = inalterabilidad; 0006 = vínculos de la HC; 0008 = pendientes; 0010 = acceso; 0012 = marca de base de prueba)
tests/db/            Tests contra Postgres en memoria
docs/                Arquitectura, modelo de datos y requisitos legales
```

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md): decisiones técnicas y pendientes.
- [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md): tablas y relaciones.
- [`docs/legal.md`](docs/legal.md): cada requisito legal y cómo lo cumple el sistema (para la revisión del abogado).
- [`docs/demo.md`](docs/demo.md): cómo publicar la demo online con datos inventados, paso a paso.
- [`docs/multi-consultorio.md`](docs/multi-consultorio.md): qué falta para que el sistema sirva a varios consultorios.
