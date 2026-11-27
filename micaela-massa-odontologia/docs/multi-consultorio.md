# Varios consultorios

El sistema hoy lo usa un solo consultorio, pero está pensado para venderse a otros. Este documento dice qué quedó listo y cuál es el plan para el paso siguiente.

## Qué ya está

| Pieza | Dónde |
| --- | --- |
| Tabla `consultorios` | `src/db/schema.ts` |
| Pertenencia de cada persona a cada consultorio, que se desactiva y nunca se borra | `consultorio_miembros` (trigger `impedir_borrado`) |
| Roles por consultorio: la misma persona puede ser secretaria en uno y administradora en otro | `usuario_roles.consultorio_id`, con clave foránea a la pertenencia |
| La cuenta (email, contraseña, verificación en dos pasos, matrícula) es una sola por persona | `usuarios`, `profesionales` |
| La sesión lleva el consultorio activo; quien está en varios lo cambia desde "Mi cuenta" | `sesiones.consultorio_id`, `cambiarConsultorioDeSesion` |
| `usuarioActual()` devuelve los roles del consultorio de la sesión y el consultorio (`usuario.consultorio`) | `src/server/sesion.ts`, `cargarUsuario` |
| La administración de usuarios solo ve y toca personas de su consultorio | `src/server/acceso/administracion.ts` (`exigirMiembro`) |
| El primer administrador de cada consultorio se crea desde la consola | `npm run crear-administrador -- --consultorio "<nombre>" ...` |

Lo que **no** está: los pacientes, turnos, historias clínicas, archivos y la auditoría todavía no dicen de qué consultorio son. Con un solo consultorio no hace falta; con dos, hoy se mezclarían. **No dar de alta un segundo consultorio hasta hacer el paso siguiente.**

## Paso siguiente

### 1. `consultorio_id` en cada tabla del consultorio

Columna `consultorio_id uuid not null references consultorios(id)` en todas las tablas con datos de un consultorio:

- Ficha y agenda: `pacientes`, `paciente_coberturas`, `notas_administrativas`, `alertas_medicas`, `sillones`, `turnos`, `turno_eventos`.
- Historia clínica: `historias_clinicas`, `borradores_clinicos`, `registros_clinicos`, `marcas_odontograma`, `adjuntos`.
- Plan, presupuestos y seguimiento: `plan_prestaciones`, `presupuestos`, `presupuesto_items`, `pendientes`, `pendiente_acciones`.
- Configuración propia de cada consultorio: `financiadores`, `aranceles`, `plantillas_consentimiento`.
- Auditoría: `auditoria_accesos` (ver abajo).

Quedan globales: `usuarios`, `profesionales`, `profesional_especialidades` (la matrícula es de la persona, no del consultorio), `nomenclador_prestaciones` (es nacional; si un consultorio necesita códigos propios, se agrega una tabla aparte), `sesiones`, `intentos_ingreso`, `codigos_recuperacion` y `enlaces_acceso`.

Reglas que tienen que cambiar junto con la columna:

- Las restricciones únicas pasan a ser por consultorio: `pacientes (consultorio_id, tipo_documento, numero_documento)`, `sillones (consultorio_id, nombre)`, `financiadores (consultorio_id, nombre)`, el número de historia clínica, etc. El mismo paciente atendido en dos consultorios son **dos fichas y dos historias clínicas** (Ley 26.529, art. 17: una historia por paciente *en cada establecimiento*).
- Las claves foráneas entre tablas del consultorio pasan a ser compuestas (`(consultorio_id, paciente_id) → pacientes (consultorio_id, id)`), para que la base impida que un turno de un consultorio apunte a un paciente de otro.
- Los triggers de encadenamiento y de marcas del odontograma no cambian: ya trabajan dentro de una historia clínica.
- Las funciones de `src/server/` toman el consultorio de `usuario.consultorio.id` (nunca de un parámetro que mande el navegador) y lo usan en cada consulta y en cada alta.

### 2. Seguridad por fila de PostgreSQL (Row Level Security)

La aplicación filtra por consultorio, pero la base también tiene que impedirlo, como ya hace con la inalterabilidad:

```sql
alter table pacientes enable row level security;
alter table pacientes force row level security;
create policy por_consultorio on pacientes
  using (consultorio_id = current_setting('app.consultorio_id')::uuid)
  with check (consultorio_id = current_setting('app.consultorio_id')::uuid);
```

- La aplicación se conecta con un rol **sin** `BYPASSRLS` y que no es dueño de las tablas; las migraciones corren con otro rol (dueño).
- Cada pedido abre una transacción y fija el consultorio con `select set_config('app.consultorio_id', $1, true)` (el `true` lo limita a la transacción, así no se filtra a otro pedido que reuse la conexión del pool). En `src/db/client.ts` se agrega un `conConsultorio(consultorioId, fn)` que envuelve `db.transaction`.
- Sin `app.consultorio_id` fijado, `current_setting` falla y la consulta no devuelve nada: un olvido no expone datos de otro consultorio.
- Las tablas globales del acceso (`usuarios`, `sesiones`...) quedan sin RLS: se leen antes de saber el consultorio. Las protege la lógica de `src/server/acceso/`.
- Un test por tabla verifica que con el consultorio A fijado no se lee ni se escribe nada del consultorio B (en PGlite, con un rol sin privilegios).

### 3. Archivos

- Las claves del almacenamiento empiezan con el consultorio: `consultorios/<consultorio_id>/pacientes/<sha256>`. Así se puede aplicar retención y permisos por prefijo en el bucket con Object Lock.
- El servidor solo sirve un archivo si su fila (`adjuntos` o `pacientes.foto_key`) es del consultorio de la sesión; la clave nunca viene armada desde el navegador.
- Si un consultorio se va, se exporta su prefijo completo; con Object Lock no se puede borrar antes de los 10 años de la Ley 26.529, y eso tiene que figurar en el contrato.

### 4. Auditoría

- `auditoria_accesos.consultorio_id`: null para las acciones de cuenta (ingresar, cambiar la contraseña), que son de la persona; obligatorio para todo lo que toca datos de un consultorio. Una restricción `check` lo exige según la `entidad`.
- Cada consultorio ve solo su auditoría (permiso `auditoria.ver` + RLS con `consultorio_id = actual or (consultorio_id is null and usuario_id in miembros)`).
- Sigue siendo de solo agregar: el trigger actual no cambia.

### 5. Cómo migrar

Con un solo consultorio en producción, la migración es directa y se hace en una ventana corta:

1. Migración generada: agregar `consultorio_id` **nullable** a cada tabla.
2. Migración a mano: `update <tabla> set consultorio_id = (select id from consultorios limit 1)` en cada tabla. Las tablas inalterables (`registros_clinicos`, `marcas_odontograma`, `turno_eventos`, `auditoria_accesos`, etc.) rechazan `UPDATE`: hay que desactivar su trigger **solo dentro de esa migración** (`alter table ... disable trigger ...; update ...; alter table ... enable trigger ...;`) y verificar después la cadena de hashes con `verificarHistoriaClinica`. El `consultorio_id` no forma parte del contenido firmado, así que los hashes no cambian.
3. Migración generada: `set not null`, restricciones únicas por consultorio y claves foráneas compuestas.
4. Migración a mano: políticas de RLS, rol de la aplicación sin privilegios y `force row level security`.
5. Cambiar `src/server/` para fijar el consultorio en cada pedido, con los tests de aislamiento.
6. Recién entonces, crear el segundo consultorio con `npm run crear-administrador -- --consultorio "<nombre>" ...`.

### Pendientes de producto

- **Elegir el consultorio al ingresar.** Hoy se entra al de la última sesión (o al primero) y se cambia desde "Mi cuenta". Con varios, conviene un selector en el encabezado.
- **Invitar a alguien que ya tiene cuenta.** Hoy el alta con un email existente se rechaza. Hay que poder sumarlo a otro consultorio sin crearle otra cuenta (y sin que el nuevo consultorio vea nada del anterior).
- **Desactivar en un consultorio y no en otro.** Ya funciona en la base (`consultorio_miembros.activo`); `listarProfesionales` todavía no filtra por consultorio.
- **Dominio por consultorio** (`<consultorio>.sistema.com.ar`): la cookie de sesión ya usa el prefijo `__Host-`, que impide que un subdominio pise la sesión de otro.
- **Administración general** (alta de consultorios, facturación del servicio): hoy solo desde la consola.
