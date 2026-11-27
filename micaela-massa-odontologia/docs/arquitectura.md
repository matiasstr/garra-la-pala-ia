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
- un selector en el encabezado elige el usuario de prueba, sin contraseña. `/ingresar` también funciona con los usuarios de la semilla (contraseña y clave de la app en el README); si hay una sesión iniciada, manda la sesión, y elegir otro usuario en el selector la cierra.

Fuera de modo desarrollo hace falta `DATABASE_URL` y `CLAVE_SECRETOS`, y todo pide ingresar.

## Inicio de sesión

Implementado sin dependencias nuevas, con `node:crypto`. Código: `src/domain/acceso/` (reglas puras, con tests), `src/server/acceso/` (base de datos) y `src/server/sesion.ts` (cookies de Next.js).

| Pieza | Cómo |
| --- | --- |
| Contraseñas | scrypt con sal de 16 bytes por usuario, N = 2^15, r = 8, p = 3 (equivalente a lo que recomienda OWASP; 32 MiB y unos 300 ms). El hash guarda sus parámetros y se recalcula solo si se endurecen. Comparación en tiempo constante. Mínimo 10 caracteres, sin reglas de mayúsculas o símbolos; se rechazan las más usadas, el email y el nombre. |
| Verificación en dos pasos | Obligatoria. TOTP (RFC 6238) con HMAC-SHA1, 6 dígitos y 30 segundos, verificado contra los vectores del RFC. Tolerancia de ±1 intervalo; se guarda el último intervalo usado y un código no sirve dos veces (también ante dos pedidos simultáneos). |
| Clave de la app | Se guarda cifrada con AES-256-GCM y la clave `CLAVE_SECRETOS`, que vive fuera de la base. |
| Sin código QR | Dibujar un QR requiere una dependencia nueva. En su lugar: el botón con el enlace `otpauth://` (en el celular abre la app con todo cargado) y la clave en base32, en grupos de 4, para escribirla a mano. Por eso el enlace de primer ingreso conviene abrirlo en el celular. |
| Códigos de recuperación | 10 por persona, de 10 caracteres (50 bits) sin letras confusas; se muestran una vez y se guarda su SHA-256. Un solo uso: lo marca la base de forma atómica y un trigger impide "desusarlos". |
| Sesiones | Token de 32 bytes al azar en una cookie `httpOnly`, `sameSite=lax` y, en producción, `secure` con prefijo `__Host-`. En la base se guarda su SHA-256: copiar la tabla no sirve para entrar. Se cierra tras 12 horas sin uso (`SESION_INACTIVIDAD_HORAS`) y dura como máximo 7 días (`SESION_MAXIMA_DIAS`). Al completar el código se emite un token nuevo. |
| Bloqueos | Por email: 5 fallos (contraseña o código) en 15 minutos bloquean 15 minutos, aunque después se escriba la contraseña correcta. Por IP: 20 fallos en 15 minutos (más alto porque todo el consultorio sale con la misma IP). Se cuentan en `intentos_ingreso` con una huella del email, nunca con lo escrito. |
| Mensajes | "El email o la contraseña no son correctos" en todos los casos; si el email no existe se verifica igual contra un hash señuelo para que tarde lo mismo. Recién con la contraseña correcta se explica si falta configurar algo o si el usuario está desactivado. |
| Primer ingreso y blanqueos | Como no hay envío de emails, el administrador ve un enlace de un solo uso (72 horas, se guarda su hash) y se lo pasa a la persona. Con él elige la contraseña y configura la app. Blanquear la contraseña o la verificación cierra todas sus sesiones; para reconfigurar la app con el enlace se pide la contraseña. |
| Primer administrador | `npm run crear-administrador`: corre con `tsx`, que ya viene con drizzle-kit (no es una dependencia nueva). Crea el consultorio y su administrador e imprime el enlace. Con `--recuperar <email>` genera un enlace para quien quedó sin acceso (por ejemplo, la única administradora perdió el celular y los códigos). |
| Protección de rutas | `src/proxy.ts` (el reemplazo de `middleware` en Next.js 16): sin cookie de sesión, las pantallas mandan a `/ingresar` y las acciones responden 401. Es un filtro rápido; la verificación que vale es `usuarioActual()` contra la base, y cada función de `src/server/` vuelve a chequear permisos. |
| Demo protegida | Con `DEMO_CLAVE`, el mismo proxy pide usuario y contraseña del navegador (HTTP Basic) en todo el sitio, también los archivos estáticos. |
| Auditoría | Ingresos, salidas, cambios de contraseña y de verificación, altas, cambios de roles, desactivaciones y blanqueos quedan en `auditoria_accesos`, con IP y navegador. |

La IP sale del último valor de `X-Forwarded-For`, el que agrega el proxy propio. En producción, el sistema tiene que estar detrás de un proxy (nginx, Caddy, el balanceador del hosting) que agregue ese encabezado; si no, una IP inventada por el navegador esquiva el bloqueo por IP (el bloqueo por email sigue funcionando).

## Varios consultorios

Ya hay consultorios, pertenencia y roles por consultorio, y la sesión lleva el consultorio activo. Los datos clínicos y administrativos todavía no tienen `consultorio_id`: el plan (columna en cada tabla, seguridad por fila de PostgreSQL, archivos y auditoría) está en [`multi-consultorio.md`](multi-consultorio.md).

## Decisiones de la agenda y la ficha

- **Búsqueda sin tildes:** `pacientes.nombre_normalizado` y `texto_busqueda` son columnas que calcula la base (no las puede olvidar la aplicación). Un test verifica que la base normalice igual que el código.
- **Duplicados:** el mismo documento bloquea el alta. Un homónimo o un posible duplicado obliga a confirmar que es otra persona, y eso queda en la auditoría.
- **Superposiciones:** no se dan dos turnos activos al mismo profesional ni al mismo sillón en el mismo horario. Las altas del mismo profesional se serializan con un bloqueo de fila.
- **Trazabilidad de turnos:** cada cambio de estado queda en `turno_eventos`, que es de solo agregar. Una reprogramación crea un turno nuevo vinculado al original.
- **Mensajes:** el recordatorio por WhatsApp solo se ofrece si el paciente dio permiso. Se guarda la fecha del permiso y el mensaje no lleva información clínica.
- **Fotos:** se achican en el navegador (640 px), se valida que sean imágenes por su contenido y se sirven con control de permisos, sin quedar en cachés compartidas.

## Pendiente de definir

- [x] **Autenticación:** propia, con verificación en dos pasos obligatoria (ver "Inicio de sesión").
- [ ] **Envío de emails:** hoy el enlace de primer ingreso o de blanqueo lo pasa el administrador a mano. Con un proveedor de email se puede mandar solo (y ofrecer "me olvidé la contraseña").
- [ ] **Hosting y región:** la Ley 25.326 restringe transferir datos de salud fuera del país. Hace falta un país adecuado o un contrato con cláusulas modelo de la AAIP.
- [ ] **Almacenamiento de adjuntos:** un bucket S3 compatible con Object Lock en modo *compliance* y retención de al menos 10 años.
- [ ] **Backups:** diarios, cifrados, guardados fuera del proveedor principal y con prueba de restauración mensual.
- [ ] **Firma digital:** elegir el certificador licenciado.
- [ ] **Nomenclador:** cargar los códigos vigentes de OSDE y los aranceles particulares del consultorio.
- [ ] **Interoperabilidad:** exportar a HL7 FHIR para la red nacional de salud digital (Ley 27.706) cuando se pida.
- [ ] **Varios consultorios:** decidido que sí. Falta `consultorio_id` en los datos y seguridad por fila (plan en [`multi-consultorio.md`](multi-consultorio.md)).
