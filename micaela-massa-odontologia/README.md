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
| Odontograma: interfaz táctil | Demo en `/odontograma` (no guarda) |
| Identificación de pacientes (duplicados, homónimos, menores) | Lista, con tests |
| Reglas de seguimiento (pendientes y alertas de 48 horas) | Listas, con tests |
| **Pacientes:** búsqueda sin tildes, alta con aviso de duplicados y homónimos, ficha, foto, coberturas, notas | Lista, con tests y prueba en navegador |
| **Agenda:** día por profesional, estados con historial, superposiciones, reprogramar, recordatorio por WhatsApp | Lista, con tests y prueba en navegador |
| Tablero de pendientes (pantalla) | Por hacer |
| Historia clínica conectada (evoluciones firmadas, odontograma que guarda) | Por hacer |
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

```bash
npm run dev
```

Abre en http://localhost:3000. Sin `DATABASE_URL`, la app usa una base PostgreSQL embebida en `.data/` y la carga con pacientes, turnos y usuarios inventados. Arriba a la derecha se elige con qué usuario de prueba navegar (secretaria, odontóloga o endodoncista) para ver qué permite cada rol.

Para volver a los datos de prueba del día (también hace falta después de actualizar, si la app no arranca por un cambio en la base):

```bash
npm run db:reset
```

### Usuarios de prueba (solo desarrollo)

En modo desarrollo también se puede probar el inicio de sesión real en http://localhost:3000/ingresar:

| Usuario | Roles |
| --- | --- |
| `mica@consultorio.local` | Profesional y administración |
| `laura@consultorio.local` | Profesional (endodoncia) |
| `sofia@consultorio.local` | Secretaria |

- Contraseña de todos: `prueba-consultorio`.
- Clave de la app de autenticación (la misma para los tres): `MICAMASSAPRUEBA2MICAMASSAPRUEBA2`. Se carga en Google Authenticator o similar con "Ingresar una clave de configuración", tipo "basada en el tiempo".

Son datos inventados y públicos: la semilla nunca se carga en una base real.

Para mostrar una demo con la versión compilada (más rápida), en Linux o macOS:

```bash
npm run build && MODO_DESARROLLO=1 npm start
```

`MODO_DESARROLLO=1` activa los datos y usuarios de prueba: nunca usarlo con pacientes reales.

Para mostrar la demo online con contraseña, agregar `DEMO_CLAVE=<contraseña>`: el navegador la pide en todo el sitio (cualquier usuario).

### Con una base real

Copiar `.env.example` a `.env.local` y completar `DATABASE_URL`, `CLAVE_SECRETOS` (al menos 32 caracteres al azar, por ejemplo `openssl rand -base64 48`; si se pierde, todos tienen que volver a configurar la app de autenticación) y `URL_PUBLICA`. Después, aplicar las migraciones:

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

`npm run db:migrate` y `npm run crear-administrador` leen `DATABASE_URL` del entorno (el segundo también de `.env.local`). El comando corre TypeScript con `tsx`, que ya viene instalado con drizzle-kit.

## Estructura

```
src/
  domain/            Reglas del negocio, sin dependencias de base ni interfaz
    acceso/          Contraseñas (scrypt), TOTP, códigos de recuperación, sesiones y bloqueos
    permisos/        Roles, permisos y quién puede firmar o enmendar
    odontograma/     Piezas FDI, caras, catálogo de hallazgos, estado a una fecha
    firma/           Encadenamiento por hash de los registros clínicos
    pacientes/       Duplicados, homónimos, edad y consentimiento de menores
    agenda/          Estados de turno y recordatorio por WhatsApp con un clic
    seguimiento/     Reglas del tablero de pendientes
  lib/               Fechas y horas en hora argentina
  db/                Esquema Drizzle, conexión y datos de prueba
  server/            Pacientes, agenda, archivos, usuarios y sesión (con permisos)
    acceso/          Ingreso, sesiones, "Mi cuenta", administración de usuarios y enlaces de un solo uso
    hc/              Firmar registros, abrir la HC (auditado), verificar la cadena
  proxy.ts           Antes de cada pedido: demo con contraseña y filtro de sesión
  components/        Interfaz (odontograma, acceso y componentes comunes)
  app/ingresar/      Inicio de sesión (contraseña y código)
  app/configurar-acceso/  Primer ingreso y blanqueos con el enlace de un solo uso
  app/(sistema)/     Pantallas: agenda, pacientes, ficha, odontograma, mi cuenta y usuarios
scripts/             Comandos de consola (crear-administrador)
drizzle/             Migraciones SQL (0001 = triggers de inalterabilidad)
tests/db/            Tests contra Postgres en memoria
docs/                Arquitectura, modelo de datos y requisitos legales
```

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md): decisiones técnicas y pendientes.
- [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md): tablas y relaciones.
- [`docs/legal.md`](docs/legal.md): cada requisito legal y cómo lo cumple el sistema (para la revisión del abogado).
- [`docs/multi-consultorio.md`](docs/multi-consultorio.md): qué falta para que el sistema sirva a varios consultorios.
