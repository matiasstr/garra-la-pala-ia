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

- **Versión 1, firma electrónica:** el usuario es personal y tiene verificación en dos pasos. Al firmar se pide el PIN de firma del profesional, y se guardan el hash, la fecha y la hora, y el encadenamiento. `firmarRegistro` encadena y guarda; las pantallas siempre pasan antes por `comprobarPinDeFirma` (`src/server/hc/pin.ts`).
- **PIN de firma:** de 4 a 8 números, distinto de la contraseña. Se guarda solo su huella con scrypt (N=16384, r=8, p=1) y una sal al azar. Cinco intentos fallidos seguidos lo bloquean 15 minutos; cada fallo y cada bloqueo quedan en la auditoría. Cambiarlo pide el PIN actual (que cuenta como intento). Si alguien lo olvida o lo bloqueó, la administración de su consultorio lo restablece con el botón "Restablecer PIN de firma" de su ficha en `/administracion/usuarios/[id]` (`restablecerPinDeFirma`: pide confirmación, verifica que la persona sea profesional de ese consultorio y queda en la auditoría y en los movimientos de la ficha), y el profesional crea uno nuevo en `/cuenta/pin-de-firma` sin el anterior. Nadie restablece su propio PIN así: con la sesión de una administradora abierta, cualquiera podría firmar a su nombre.
- **Quién firmó:** nombre, apellido y matrícula del profesional viajan dentro del contenido firmado (`contenido.firmante`). Si la matrícula cambia después, el registro sigue diciendo con qué matrícula se firmó.
- **Firma digital (Ley 25.506):** el esquema ya prevé `metodo_firma = 'digital'` y `firma_digital`, la firma CMS sobre el hash del registro. Falta elegir un certificador licenciado con firma remota por API. La alternativa es firmar un "cierre del día" que incluya los hashes de todos los registros del día.
- **Exportación de la historia clínica:** se genera un PDF con todos los registros y sus hashes. Ese PDF se firma con la firma digital remota del profesional.

## Modo desarrollo

Sin `DATABASE_URL` y fuera de producción (o con `MODO_DESARROLLO=1`):

- la base es un PostgreSQL embebido (PGlite) en `.data/pglite`, con las mismas migraciones y triggers que producción, y datos de prueba inventados;
- los archivos (fotos) se guardan en `.data/archivos`, con nombre por huella SHA-256 y sin sobrescribir;
- un selector en el encabezado elige el usuario de prueba, sin contraseña. `/ingresar` también funciona con los usuarios de la semilla (contraseña y clave de la app en el README); si hay una sesión iniciada, manda la sesión, y elegir otro usuario en el selector la cierra.

Fuera de modo desarrollo hace falta `DATABASE_URL` y `CLAVE_SECRETOS`, y todo pide ingresar.

**Barrera entre la demo y la base real.** Los usuarios de la semilla tienen contraseñas públicas y el selector entra sin contraseña: una base sembrada nunca puede servir en modo real, y el modo desarrollo nunca puede abrir la base del consultorio. Lo controla `src/db/marca-de-prueba.ts`, al conectar (`src/db/client.ts`):

- La semilla solo corre sobre una base vacía (sin usuarios, consultorios ni pacientes), y lo primero que hace es dejar la marca: una fila en `base_de_prueba` que no se puede cambiar, borrar ni vaciar (`drizzle/0012_base_de_prueba_sql.sql`). Una base de prueba nunca deja de serlo.
- **Modo desarrollo:** si la base tiene datos y no tiene la marca, no arranca y explica por qué (podría ser la del consultorio). "Reiniciar datos de prueba" también lo comprueba antes de descartar nada.
- **Modo real:** si la base tiene la marca, o usuarios del dominio de la semilla (`@consultorio.local`, las bases de prueba de antes de la marca), no arranca: "esta base tiene datos de prueba". `npm run crear-administrador` tampoco trabaja sobre ella.
- **Demo compilada:** con `NODE_ENV=production` (`npm start` o Vercel) y `MODO_DESARROLLO=1`, `DEMO_CLAVE` es obligatoria. Sin ella, `src/proxy.ts` responde 503 a todo y la conexión a la base se niega (`problemaDeConfiguracion` en `src/lib/modo.ts`).
- El selector de usuario de prueba solo acepta cuentas `@consultorio.local`; las personas creadas durante la prueba entran con su contraseña.

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
| Bloqueos | Tres reglas; vale la que bloquee más. **Por email e IP:** 5 fallos (contraseña o código) en 15 minutos bloquean 15 minutos ese email desde esa IP, aunque después se escriba la contraseña correcta. **Por email, desde cualquier IP:** 30 fallos en 15 minutos; frena un ataque repartido en muchas IP, y es alto para que saber el email de una profesional no alcance para dejarla afuera. **Por IP, con cualquier email:** 20 fallos en 15 minutos (más que por email e IP porque todo el consultorio sale con la misma IP). Un ingreso completo pone en cero los fallos de ese email. El enlace de blanqueo de la verificación, que pide la contraseña, cuenta como un ingreso. Las acciones de "Mi cuenta" (contraseña actual o código, con la sesión abierta) cuentan aparte, por persona: 5 fallos en 15 minutos las bloquean, y los intentos de ingreso de otros no las bloquean. Todo se cuenta en `intentos_ingreso` (columna `ambito`: `ingreso` o `cuenta`) con una huella del email, nunca con lo escrito. |
| Un intento por vez | Mirar el bloqueo, comparar la contraseña o el código y registrar el intento pasa dentro de una transacción con `pg_advisory_xact_lock` por email (o por persona, en "Mi cuenta"): con N pedidos simultáneos no se comparan más que los permitidos (`conCandadoDeIntentos` en `src/server/acceso/registro.ts`). |
| Mensajes | "El email o la contraseña no son correctos" en todos los casos; si el email no existe se verifica igual contra un hash señuelo para que tarde lo mismo. Recién con la contraseña correcta se explica si falta configurar algo o si el usuario está desactivado. |
| Primer ingreso y blanqueos | Como no hay envío de emails, el administrador ve un enlace de un solo uso (72 horas, se guarda su hash) y se lo pasa a la persona. Con él elige la contraseña y configura la app. Blanquear la contraseña o la verificación cierra todas sus sesiones; para reconfigurar la app con el enlace se pide la contraseña. |
| Primer administrador | `npm run crear-administrador`: corre con `tsx`, que ya viene con drizzle-kit (no es una dependencia nueva). Crea el consultorio y su administrador e imprime el enlace. Con `--recuperar <email>` genera un enlace para quien quedó sin acceso (por ejemplo, la única administradora perdió el celular y los códigos). |
| Protección de rutas | `src/proxy.ts` (el reemplazo de `middleware` en Next.js 16): sin cookie de sesión, las pantallas mandan a `/ingresar` y las acciones responden 401. Es un filtro rápido; la verificación que vale es `usuarioActual()` contra la base, y cada función de `src/server/` vuelve a chequear permisos. |
| Demo protegida | Con `DEMO_CLAVE`, el mismo proxy pide usuario y contraseña del navegador (HTTP Basic) en todo el sitio, también los archivos estáticos. |
| Auditoría | Ingresos, salidas, cambios de contraseña y de verificación, altas, cambios de roles, desactivaciones y blanqueos quedan en `auditoria_accesos`, con IP y navegador. |

**IP del pedido.** Una sola función la obtiene para todo el sistema (`datosDeEncabezados` en `src/server/pedido.ts`, que se usa a través de `datosDelPedido()`): los bloqueos de ingreso, la auditoría de accesos y la de la historia clínica guardan la misma IP. Es el último valor de `X-Forwarded-For`, porque los anteriores los puede escribir cualquiera. **En producción hace falta un proxy de confianza delante del sistema que fije ese encabezado:** en Vercel lo hace la plataforma (reemplaza lo que manda el navegador); con nginx, Caddy o el balanceador del hosting hay que configurarlo (en nginx, `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Sin ese proxy, Next.js deja pasar el encabezado tal como lo manda el navegador: la IP de la auditoría se puede inventar, y alguien podría hacerse pasar por la IP del consultorio para bloquearla (los bloqueos por email y por email e IP siguen funcionando).

## Varios consultorios

Ya hay consultorios, pertenencia y roles por consultorio, y la sesión lleva el consultorio activo. Los datos clínicos y administrativos todavía no tienen `consultorio_id`: el plan (columna en cada tabla, seguridad por fila de PostgreSQL, archivos y auditoría) está en [`multi-consultorio.md`](multi-consultorio.md).

**Demo online** (modo desarrollo con `DATABASE_URL`, por ejemplo Vercel + Neon; ver [`demo.md`](demo.md)): al conectar se aplican las migraciones y los datos de prueba (solo si la base está vacía o tiene la marca de base de prueba), con un *advisory lock* para que varias instancias no lo hagan a la vez; las fotos van a la tabla `archivos` de la base, porque el disco no dura; la semilla carga turnos para hoy y los próximos días hábiles, y con `DEMO_PERMITE_REINICIO=1` se pueden reiniciar los datos desde la app. Fuera de modo desarrollo nunca se migra ni se siembra solo.

## Decisiones de la agenda y la ficha

- **Búsqueda sin tildes:** `pacientes.nombre_normalizado` y `texto_busqueda` son columnas que calcula la base (no las puede olvidar la aplicación). Un test verifica que la base normalice igual que el código.
- **Duplicados:** el mismo documento bloquea el alta. Un homónimo o un posible duplicado obliga a confirmar que es otra persona, y eso queda en la auditoría.
- **Superposiciones:** no se dan dos turnos activos al mismo profesional ni al mismo sillón en el mismo horario. Antes de mirar el horario, el alta bloquea la fila del profesional y la del sillón, siempre en ese orden (así dos pedidos no se esperan entre sí): dos secretarias que dan a la vez el mismo horario, del mismo profesional o del mismo sillón con profesionales distintos, se atienden de a una.
- **Trazabilidad de turnos:** cada cambio de estado queda en `turno_eventos`, que es de solo agregar. Una reprogramación crea un turno nuevo vinculado al original, en una sola transacción que empieza bloqueando el original: si dos personas lo reprograman a la vez, la segunda lo encuentra ya reprogramado y no queda un turno de más. El horario del original no cuenta como ocupado (se puede correr media hora). Los pendientes se recalculan después.
- **Mensajes:** el recordatorio por WhatsApp solo se ofrece si el paciente dio permiso. Se guarda la fecha del permiso y el mensaje no lleva información clínica.
- **Fotos:** se achican en el navegador (640 px), se valida que sean imágenes por su contenido y se sirven con control de permisos, sin quedar en cachés compartidas.

## Decisiones de la historia clínica

- **Una pantalla, una zona:** `/pacientes/[id]/historia-clinica` es violeta con candado (`.zona-clinica`) y tiene un encabezado fijo con foto, nombre, edad, documento, alertas y aviso de homónimo, para no escribir en el paciente equivocado. Solo entra quien tiene `hc.ver`; a la secretaria se le explica que no tiene acceso. La historia clínica se crea la primera vez que la abre un profesional (hay una sola por paciente).
- **Cada apertura queda auditada** (`hc.ver`, con IP y navegador, y la fecha si se pidió el odontograma a una fecha). También ver (`adjunto.ver`) o descargar (`adjunto.descargar`) un adjunto, y cada firma (`registro.firmar`).
- **Borradores:** la evolución se guarda sola mientras se escribe (`borradores_clinicos`, uno por profesional, historia clínica y tipo). Solo la ve su autor, se puede editar y descartar, y se borra al firmar. No es historia clínica hasta que se firma.
- **Enmiendas:** solo sobre registros propios y nunca sobre otra enmienda (se agrega otra al original). En la línea de tiempo cada enmienda muestra qué corrige y el original muestra sus enmiendas.
- **Integridad a la vista:** la pantalla recalcula la cadena (`verificarHistoriaClinica`) cada vez que se abre y avisa si algo no coincide. Cada adjunto se compara con la huella que cita su registro, y al verlo se vuelve a calcular el SHA-256 del archivo: si no coincide, no se entrega.
- **Odontograma que guarda:** el editor recibe todas las marcas firmadas y devuelve los cambios. Al firmar, los pasos intermedios se consolidan (`consolidarCambios`): si se marcó caries y después restauración en la misma cara, se firma solo la restauración reemplazando a lo anterior. "Quitar marca" no borra: agrega una anulación. "Ver a fecha" recalcula el odontograma con lo firmado hasta ese día, de solo lectura. La dentición se elige por edad (temporal hasta 5 años, mixta de 6 a 12) y pasa a mixta si hay marcas en la otra dentición. `/odontograma` queda como pantalla de práctica con datos de ejemplo.
- **Adjuntos:** imágenes (JPG, PNG, WebP) y PDF de hasta 10 MB. El tipo se valida por el contenido (`%PDF-` para PDF). Las imágenes de más de 2400 px o 4 MB se achican en el navegador (y pierden los datos de ubicación de la cámara). Se suben por una ruta (`.../historia-clinica/adjuntos`) y no por una acción de servidor, porque las acciones aceptan hasta 1 MB: el archivo viaja tal cual como cuerpo del pedido y el navegador manda su SHA-256 para comprobar que llegó completo. Se guarda con `almacenDelSistema()` en una carpeta por historia clínica (`hc-<id>`), así el mismo archivo en dos pacientes son dos adjuntos distintos; el mismo archivo dos veces en la misma historia se rechaza. El adjunto y su registro firmado se guardan en la misma transacción.
- **Desde la agenda:** cada turno muestra "Historia clínica" solo a profesionales. Abre la HC con el turno, y la evolución que se firme queda vinculada a ese turno (la base verifica que el turno sea del mismo paciente).

## Decisiones del seguimiento ("¿Cuándo debería volver?" y pendientes)

- **El plazo lo decide la profesional, no el sistema.** Al cerrar un turno se carga "¿Cuándo debería volver?" (en unos días = 3 días, 1 semana, 2 semanas, 1 mes, 3 meses, 6 meses, cuando el paciente avise, no hace falta) y, si hace falta, "Es importante que vuelva". Lo carga la profesional o la secretaria; queda quién lo indicó, quién lo cargó y cuándo. La indicación es de solo agregar (`indicaciones_regreso`, con trigger): para cambiarla se carga otra y vale la última de la última visita.
- **Cuándo aparece el pendiente:** si se fue sin turno, al día siguiente; para 3 o 6 meses, 2 semanas antes de la fecha esperada. Si tiene un turno futuro no hay pendiente, y si saca turno se resuelve solo (queda el turno que lo resolvió); si después cancela ese turno, el pendiente vuelve a la bandeja. "Cuando el paciente avise" y "No hace falta" no generan pendientes. Si volvió a atenderse, la indicación anterior se da por cumplida.
- **Sin indicación no se inventan plazos.** Las reglas que ya existían siguen: tratamiento a medias sin turno (desde el plan de tratamiento), presupuesto sin respuesta (5 días), ausente sin reprogramar (al día siguiente) y conversación sin respuesta (48 horas, para la Versión 2). El control periódico ahora sale de la indicación de 3 o 6 meses; la regla de "6 meses fijos" queda en el dominio pero el servidor no la usa. Lo que no tiene fecha se ordena por días sin contacto.
- **Un pendiente por caso, sin duplicados.** Cada caso tiene una `clave` única (`indicacion:<id>`, `ausente:<turno>`, `presupuesto:<id>`...). `sincronizarPendientes` corre las reglas puras y crea, actualiza, resuelve o reabre filas; es idempotente y se serializa con un candado de la base (`pg_advisory_xact_lock`). Lo que cerró una persona (resuelto a mano o descartado) no se vuelve a abrir solo.
- **Cuándo se recalcula:** no hay tareas programadas todavía. Se recalcula al abrir el tablero, al abrir cualquier pantalla del sistema (como mucho una vez por minuto, para el contador de la navegación) y después de cada turno nuevo, cambio de estado de un turno o indicación cargada. Si el recálculo falla durante una operación de agenda, el turno igual se guarda y queda en el registro de errores.
- **Bandeja común:** todas las secretarias y profesionales ven todos los pendientes; quien lo toma (o registra el primer contacto) queda como responsable, y otra persona lo puede tomar. Cada contacto guarda canal y respuesta. A los 3 intentos seguidos sin respuesta pasa a "No responde" y, si era importante, le llega a la profesional que lo indicó: lo ve primero en su tablero, con aviso.
- **"Volver a contactar el…" pensado para una IA.** Hoy lo fija la secretaria con su motivo ("cobra el 10"). Cada acción guarda `origen` (`usuario`, `sistema` o `ia`), la fecha propuesta y el motivo; el pendiente guarda la fecha vigente y de dónde salió. Más adelante, una IA podrá leer lo que respondió el paciente (`resultado`) y agregar una acción `nueva_fecha` con `origen = 'ia'`, que una persona confirma.
- **Permisos y auditoría:** todo el seguimiento pide `seguimientos.gestionar` (secretarias y profesionales; el administrador que no es ninguna de las dos no lo ve). Cargar una indicación, tomar, registrar un contacto, resolver y descartar quedan también en `auditoria_accesos`.
- **Mensajes:** el WhatsApp del tablero cambia según el motivo, solo se ofrece con permiso del paciente y nunca menciona el tratamiento.

## Pendiente de definir

- [x] **Autenticación:** propia, con verificación en dos pasos obligatoria (ver "Inicio de sesión").
- [ ] **Envío de emails:** hoy el enlace de primer ingreso o de blanqueo lo pasa el administrador a mano. Con un proveedor de email se puede mandar solo (y ofrecer "me olvidé la contraseña").
- [ ] **Hosting y región:** la Ley 25.326 restringe transferir datos de salud fuera del país. Hace falta un país adecuado o un contrato con cláusulas modelo de la AAIP.
- [ ] **Almacenamiento de adjuntos:** un bucket S3 compatible con Object Lock en modo *compliance* y retención de al menos 10 años.
- [ ] **Backups:** diarios, cifrados, guardados fuera del proveedor principal y con prueba de restauración mensual.
- [ ] **Firma digital:** elegir el certificador licenciado.
- [ ] **Nomenclador:** cargar los códigos vigentes de OSDE y los aranceles particulares del consultorio.
- [ ] **Interoperabilidad:** exportar a HL7 FHIR para la red nacional de salud digital (Ley 27.706) cuando se pida.
- [ ] **PIN de firma con "pimienta":** sumar a la huella del PIN un secreto del servidor (fuera de la base), para que una copia robada de la base no permita probar los 10.000 PIN de 4 cifras.
- [ ] **Archivos huérfanos:** si la firma del adjunto falla después de guardar el archivo, el archivo queda en el almacenamiento sin registro (no se puede borrar por diseño). Revisarlos en la conciliación periódica.
- [ ] **Línea de tiempo larga:** hoy se muestran todos los registros; con historias de cientos de registros conviene paginar.
- [ ] **Varios consultorios:** decidido que sí. Falta `consultorio_id` en los datos y seguridad por fila (plan en [`multi-consultorio.md`](multi-consultorio.md)).
