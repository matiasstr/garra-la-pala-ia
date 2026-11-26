# Modelo de datos

El esquema está en `src/db/schema.ts` y las migraciones en `drizzle/`. Las tablas marcadas con 🔒 son de solo agregar: la base rechaza `UPDATE` y `DELETE`.

```mermaid
erDiagram
  usuarios ||--o{ usuario_roles : tiene
  usuarios ||--o| profesionales : "es (si tiene matrícula)"
  profesionales ||--o{ profesional_especialidades : tiene

  pacientes ||--o{ paciente_coberturas : "OSDE / particular"
  pacientes ||--o{ alertas_medicas : tiene
  pacientes ||--o{ notas_administrativas : tiene
  pacientes ||--o{ turnos : reserva
  turnos ||--o{ turno_eventos : "historial 🔒"

  pacientes ||--|| historias_clinicas : "una sola 🔒"
  historias_clinicas ||--o{ registros_clinicos : "encadenados 🔒"
  registros_clinicos ||--o{ marcas_odontograma : "proyecta 🔒"
  registros_clinicos |o--o| registros_clinicos : enmienda
  pacientes ||--o{ adjuntos : "🔒"

  pacientes ||--o{ plan_prestaciones : "plan de tratamiento"
  marcas_odontograma |o--o{ plan_prestaciones : origina
  plan_prestaciones }o--|| nomenclador_prestaciones : codigo
  presupuestos ||--o{ presupuesto_items : incluye

  pacientes ||--o{ indicaciones_regreso : "¿cuándo debería volver? 🔒"
  turnos |o--o{ indicaciones_regreso : "se indicó en"
  pacientes ||--o{ pendientes : seguimiento
  indicaciones_regreso |o--o{ pendientes : origina
  pendientes ||--o{ pendiente_acciones : "qué se hizo 🔒"
```

## Zonas

| Zona | Tablas | Quién accede |
| --- | --- | --- |
| Ficha del paciente | `pacientes`, `paciente_coberturas`, `notas_administrativas`, adjuntos administrativos | Secretarias y profesionales |
| Alertas médicas | `alertas_medicas` | Las cargan profesionales; las ven todos |
| Historia clínica | `historias_clinicas`, `registros_clinicos`, `marcas_odontograma`, `borradores_clinicos`, adjuntos clínicos | Solo profesionales |
| Agenda y seguimiento | `turnos`, `turno_eventos`, `indicaciones_regreso`, `pendientes`, `pendiente_acciones` | Secretarias y profesionales |
| Plan y presupuestos | `plan_prestaciones`, `presupuestos`, `nomenclador_prestaciones`, `aranceles`, `financiadores` | Profesionales indican; secretarias presupuestan |
| Auditoría | `auditoria_accesos` 🔒 | Administrador |

## Cómo se firma un registro

1. El profesional escribe un borrador en `borradores_clinicos`, que todavía se puede editar.
2. Al firmar, `firmarRegistro` hace todo en una transacción:
   - bloquea la historia clínica;
   - calcula la siguiente secuencia y el hash, encadenado al registro anterior;
   - inserta el registro y proyecta las marcas del odontograma;
   - registra la firma en la auditoría.
3. Un trigger verifica la secuencia y el encadenamiento. Si dos firmas compiten, una falla y se reintenta.
4. Las marcas del odontograma viajan dentro del `contenido` firmado. `marcas_odontograma` es una proyección para consultar rápido, y con el registro solo alcanza para reconstruir el odontograma.

## Odontograma a una fecha

Las marcas nunca se modifican. Cuando algo cambia, una marca nueva **reemplaza** a la anterior: por ejemplo, una caries a realizar pasa a restauración realizada. Para corregir un error se usa una **anulación**. El estado a cualquier fecha se calcula aplicando las marcas hasta esa fecha (`calcularOdontograma`).

## Seguimiento de pacientes

- **`indicaciones_regreso`** 🔒: "¿Cuándo debería volver?". Paciente, turno atendido (opcional), `plazo`, `importante`, `fecha_visita` (desde ahí corre), `fecha_esperada` (sin fecha para "cuando avise" y "no hace falta"), `indicada_por` (profesional) y `cargada_por` (quien lo cargó). Vale la última de la última visita.
- **`pendientes`**: un caso por fila. `tipo` (motivo), `detalle` (motivo legible), `desde` (desde cuándo corre), `vence_en` (fecha esperada de regreso), `prioridad`, `importante`, `estado` (abierto, en curso, no responde, resuelto, descartado), `responsable_id` y `tomado_en`. `contactar_desde` es la fecha sugerida de contacto, con `contactar_desde_motivo` y `contactar_desde_origen` (regla, persona o, más adelante, IA). `clave` (única) identifica el caso para no duplicarlo. Si no responde y era importante: `escalado_a` y `escalado_en`. Al cerrarse: `resuelto_en`, `cerrado_por` (vacío si se resolvió solo), `motivo_cierre` y `resuelto_por_turno_id`. No se borra (trigger).
- **`pendiente_acciones`** 🔒: historial de cada pendiente. `tipo` (creado, tomado, contacto, nueva fecha, no responde, resuelto, descartado, reabierto), `origen` (usuario, sistema, ia), `canal` y `respuesta` (obligatorios en un contacto), `resultado` (lo que dijo el paciente o el motivo) y `contactar_desde` con su motivo.

## OSDE y particular

La cobertura se define **por prestación** (`plan_prestaciones.financiador_id`), no solo por paciente. Así un paciente de OSDE puede tener parte del tratamiento como particular, y el presupuesto puede ser mixto.
