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
| Reglas de seguimiento (pendientes y alertas de 48 horas) | Listas, con tests |
| **Pacientes:** búsqueda sin tildes, alta con aviso de duplicados y homónimos, ficha, foto, coberturas, notas | Lista, con tests y prueba en navegador |
| **Agenda:** día por profesional, estados con historial, superposiciones, reprogramar, recordatorio por WhatsApp | Lista, con tests y prueba en navegador |
| Tablero de pendientes (pantalla) | Por hacer |
| **Historia clínica:** evoluciones con borrador y firma con PIN, enmiendas, línea de tiempo con verificación de integridad, odontograma que guarda y "ver a fecha", adjuntos (imágenes y PDF) con huella, auditoría de cada apertura | Lista, con tests y prueba en navegador |
| PIN de firma (scrypt, bloqueo por intentos fallidos) en `/cuenta/pin-de-firma` | Listo, con tests |
| Login con verificación en dos pasos | Por hacer: hoy hay un selector de usuario de prueba |
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

Abre en http://localhost:3000. Sin `DATABASE_URL`, la app usa una base PostgreSQL embebida en `.data/` y la carga con pacientes, turnos, usuarios e historias clínicas inventados. Arriba a la derecha se elige con qué usuario de prueba navegar (secretaria, odontóloga o endodoncista) para ver qué permite cada rol. Las profesionales de prueba firman con el PIN **1234**.

Para volver a los datos de prueba del día:

```bash
npm run db:reset
```

Para mostrar una demo con la versión compilada (más rápida), en Linux o macOS:

```bash
npm run build && MODO_DESARROLLO=1 npm start
```

`MODO_DESARROLLO=1` activa los datos y usuarios de prueba: nunca usarlo con pacientes reales.

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
    firma/           Encadenamiento por hash y reglas del PIN de firma
    historia-clinica/ Lectura de lo firmado y línea de tiempo con enmiendas
    pacientes/       Duplicados, homónimos, edad y consentimiento de menores
    agenda/          Estados de turno y recordatorio por WhatsApp con un clic
    seguimiento/     Reglas del tablero de pendientes
  lib/               Fechas y horas en hora argentina
  db/                Esquema Drizzle, conexión y datos de prueba
  server/            Pacientes, agenda, archivos, usuarios y sesión (con permisos)
    hc/              Firmar registros, PIN, evoluciones, adjuntos y la pantalla de la HC (auditado)
  components/        Interfaz (odontograma y componentes comunes)
  app/(sistema)/     Pantallas: agenda, pacientes, ficha, historia clínica, PIN de firma
drizzle/             Migraciones SQL (0001 = triggers de inalterabilidad; 0004 = vínculos de la HC)
tests/db/            Tests contra Postgres en memoria
docs/                Arquitectura, modelo de datos y requisitos legales
```

## Documentación

- [`docs/arquitectura.md`](docs/arquitectura.md): decisiones técnicas y pendientes.
- [`docs/modelo-de-datos.md`](docs/modelo-de-datos.md): tablas y relaciones.
- [`docs/legal.md`](docs/legal.md): cada requisito legal y cómo lo cumple el sistema (para la revisión del abogado).
