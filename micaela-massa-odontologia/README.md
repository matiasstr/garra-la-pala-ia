# Micaela Massa Odontología — Sistema de gestión

Sistema para el consultorio: historia clínica digital con validez legal, odontograma, roles, agenda y seguimiento de pacientes.

- **Versión 1 (en construcción):** historia clínica y odontograma, firma de cada evolución, roles, agenda básica y tablero de pendientes.
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
| Login con verificación en dos pasos | Por hacer |
| Pantallas de agenda, ficha e historia clínica | Por hacer |
| Almacenamiento de adjuntos con Object Lock | Por hacer |

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

La demo del odontograma queda en http://localhost:3000/odontograma.

Para usar una base real, copiar `.env.example` a `.env.local`, completar `DATABASE_URL` y aplicar las migraciones:

```bash
npm run db:migrate
```

## Estructura

```
src/
  domain/            Reglas del negocio, sin dependencias de base ni interfaz
    permisos/        Roles, permisos y quién puede firmar o enmendar
    odontograma/     Piezas FDI, caras, catálogo de hallazgos, estado a una fecha
    firma/           Encadenamiento por hash de los registros clínicos
    pacientes/       Duplicados, homónimos, edad y consentimiento de menores
    agenda/          Estados de turno y recordatorio por WhatsApp con un clic
    seguimiento/     Reglas del tablero de pendientes
  db/                Esquema Drizzle y conexión
  server/hc/         Firmar registros, abrir la HC (auditado), verificar la cadena
  components/        Interfaz (odontograma)
  app/               Páginas de Next.js
drizzle/             Migraciones SQL (0001 = triggers de inalterabilidad)
tests/db/            Tests contra Postgres en memoria
docs/                Arquitectura, modelo de datos y requisitos legales
```

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md): decisiones técnicas y pendientes.
- [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md): tablas y relaciones.
- [`docs/legal.md`](docs/legal.md): cada requisito legal y cómo lo cumple el sistema (para la revisión del abogado).
