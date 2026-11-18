# Arquitectura

## Principios

1. **Lo clínico no se modifica, se agrega.** Un registro firmado no se edita ni se borra. Las correcciones son enmiendas que citan el registro original, y solo las puede hacer quien lo firmó.
2. **La base de datos defiende la regla, no solo la aplicación.** Hay triggers que bloquean `UPDATE`, `DELETE` y `TRUNCATE` sobre las tablas clínicas (`drizzle/0001_inalterabilidad.sql`). Un error de la aplicación o un acceso directo a la base no pueden alterar la historia.
3. **Cada registro queda encadenado al anterior.** Cada registro guarda el SHA-256 de su contenido y el hash del registro previo de la misma historia clínica. Si alguien desactiva los triggers y altera un registro, la verificación lo detecta (`verificarHistoriaClinica`).
4. **La ficha y la historia clínica están separadas.** Usan tablas, permisos y colores distintos en la interfaz. La secretaria nunca recibe datos clínicos, salvo las alertas médicas críticas.
5. **Se registra quién vio qué.** Cada apertura de una historia clínica, cada firma y cada exportación queda en `auditoria_accesos`, que también es de solo agregar.
6. **El dominio no depende de la base ni de la interfaz.** `src/domain/` tiene funciones puras y testeadas. La misma lógica del odontograma corre en el servidor y en la tablet.

## Stack y motivos

| Decisión | Motivo |
| --- | --- |
| Next.js + React + TypeScript | Una sola app web para computadora y tablet, sin instalar nada. Servidor y cliente comparten tipos y reglas. |
| PostgreSQL | Transacciones, triggers, `jsonb` y restricciones `CHECK` para hacer cumplir las reglas legales en la base. |
| Drizzle ORM | Esquema tipado en TypeScript y migraciones SQL legibles, que se pueden auditar. |
| PGlite en tests | Postgres real en memoria: los tests prueban los triggers de verdad, sin levantar un servidor. |
| Odontograma en SVG | Se maneja con el dedo, escala a cualquier pantalla y queda accesible con teclado y lector de pantalla. |

## Firma

- **Versión 1, firma electrónica:** el usuario es personal y tiene verificación en dos pasos. Al firmar se pide un PIN, y se guardan el hash, la fecha y la hora, y el encadenamiento. Así está implementado en `firmarRegistro`.
- **Firma digital (Ley 25.506):** el esquema ya prevé `metodo_firma = 'digital'` y `firma_digital`, la firma CMS sobre el hash del registro. Falta elegir un certificador licenciado con firma remota por API. La alternativa es firmar un "cierre del día" que incluya los hashes de todos los registros del día.
- **Exportación de la historia clínica:** se genera un PDF con todos los registros y sus hashes. Ese PDF se firma con la firma digital remota del profesional.

## Modo desarrollo

Sin `DATABASE_URL` y fuera de producción (o con `MODO_DESARROLLO=1`):

- la base es un PostgreSQL embebido (PGlite) en `.data/pglite`, con las mismas migraciones y triggers que producción, y datos de prueba inventados;
- los archivos (fotos) se guardan en `.data/archivos`, con nombre por huella SHA-256 y sin sobrescribir;
- no hay inicio de sesión: un selector en el encabezado elige el usuario de prueba.

En producción, sin `DATABASE_URL` ni inicio de sesión configurado, la app se niega a funcionar.

## Decisiones de la agenda y la ficha

- **Búsqueda sin tildes:** `pacientes.nombre_normalizado` y `texto_busqueda` son columnas que calcula la base (no las puede olvidar la aplicación). Un test verifica que la base normalice igual que el código.
- **Duplicados:** el mismo documento bloquea el alta. Un homónimo o un posible duplicado obliga a confirmar que es otra persona, y eso queda en la auditoría.
- **Superposiciones:** no se dan dos turnos activos al mismo profesional ni al mismo sillón en el mismo horario. Las altas del mismo profesional se serializan con un bloqueo de fila.
- **Trazabilidad de turnos:** cada cambio de estado queda en `turno_eventos`, que es de solo agregar. Una reprogramación crea un turno nuevo vinculado al original.
- **Mensajes:** el recordatorio por WhatsApp solo se ofrece si el paciente dio permiso. Se guarda la fecha del permiso y el mensaje no lleva información clínica.
- **Fotos:** se achican en el navegador (640 px), se valida que sean imágenes por su contenido y se sirven con control de permisos, sin quedar en cachés compartidas.

## Pendiente de definir

- [ ] **Autenticación:** proveedor con verificación en dos pasos obligatoria y sesiones cortas en las computadoras del consultorio.
- [ ] **Hosting y región:** la Ley 25.326 restringe transferir datos de salud fuera del país. Hace falta un país adecuado o un contrato con cláusulas modelo de la AAIP.
- [ ] **Almacenamiento de adjuntos:** un bucket S3 compatible con Object Lock en modo *compliance* y retención de al menos 10 años.
- [ ] **Backups:** diarios, cifrados, guardados fuera del proveedor principal y con prueba de restauración mensual.
- [ ] **Firma digital:** elegir el certificador licenciado.
- [ ] **Nomenclador:** cargar los códigos vigentes de OSDE y los aranceles particulares del consultorio.
- [ ] **Interoperabilidad:** exportar a HL7 FHIR para la red nacional de salud digital (Ley 27.706) cuando se pida.
- [ ] **Un solo consultorio o varios:** definir si el sistema va a servir a más de un consultorio. Eso decide si se agrega `consultorio_id` y seguridad por fila.
