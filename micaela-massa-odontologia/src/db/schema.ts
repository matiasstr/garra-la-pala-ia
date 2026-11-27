/**
 * Modelo de datos (PostgreSQL + Drizzle).
 *
 * Principios:
 * - La ficha del paciente (administrativa) y la historia clínica están en
 *   tablas separadas, con permisos distintos.
 * - Lo clínico es de solo agregar: `registros_clinicos`, `marcas_odontograma`,
 *   `adjuntos` y los historiales no admiten UPDATE ni DELETE (lo impiden
 *   triggers en la migración `0001_inalterabilidad`).
 * - Nada se borra de verdad: pacientes y usuarios se desactivan.
 *
 * Importante: este archivo usa rutas relativas (no `@/`) porque drizzle-kit lo
 * carga por fuera de Next.js.
 */
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  char,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ESTADOS_TURNO } from '../domain/agenda/turnos';
import { TIPOS_REGISTRO } from '../domain/historia-clinica/registros';
import { CODIGOS_HALLAZGO, ESTADOS_MARCA } from '../domain/odontograma/catalogo';
import { CARAS } from '../domain/odontograma/piezas';
import { ESPECIALIDADES, ROLES } from '../domain/permisos/roles';
import { PLAZOS_REGRESO } from '../domain/seguimiento/regreso';
import { PRIORIDADES, TIPOS_PENDIENTE } from '../domain/seguimiento/reglas';
import { CANALES_CONTACTO, ESTADOS_PENDIENTE, ORIGENES_ACCION, RESPUESTAS_CONTACTO, TIPOS_ACCION_PENDIENTE } from '../domain/seguimiento/tablero';

// ---------------------------------------------------------------------------
// Enumerados
// ---------------------------------------------------------------------------
export const rolEnum = pgEnum('rol', ROLES);
export const especialidadEnum = pgEnum('especialidad', ESPECIALIDADES);
export const estadoTurnoEnum = pgEnum('estado_turno', ESTADOS_TURNO);
export const caraEnum = pgEnum('cara_dental', CARAS);
export const hallazgoEnum = pgEnum('hallazgo_dental', CODIGOS_HALLAZGO);
export const estadoMarcaEnum = pgEnum('estado_marca', ESTADOS_MARCA);
export const tipoRegistroEnum = pgEnum('tipo_registro_clinico', TIPOS_REGISTRO);
export const metodoFirmaEnum = pgEnum('metodo_firma', ['electronica', 'digital']);
export const tipoAlertaEnum = pgEnum('tipo_alerta_medica', ['alergia', 'medicacion', 'condicion']);
export const ambitoAdjuntoEnum = pgEnum('ambito_adjunto', ['administrativo', 'clinico']);
export const estadoPrestacionEnum = pgEnum('estado_prestacion', ['propuesta', 'aceptada', 'autorizada', 'realizada', 'cancelada']);
export const respuestaPresupuestoEnum = pgEnum('respuesta_presupuesto', ['pendiente', 'aceptado', 'aceptado_parcial', 'rechazado']);
export const tipoPendienteEnum = pgEnum('tipo_pendiente', TIPOS_PENDIENTE);
export const estadoPendienteEnum = pgEnum('estado_pendiente', ESTADOS_PENDIENTE);
export const canalContactoEnum = pgEnum('canal_contacto', CANALES_CONTACTO);
export const plazoRegresoEnum = pgEnum('plazo_regreso', PLAZOS_REGRESO);
export const prioridadPendienteEnum = pgEnum('prioridad_pendiente', PRIORIDADES);
export const tipoAccionPendienteEnum = pgEnum('tipo_accion_pendiente', TIPOS_ACCION_PENDIENTE);
export const respuestaContactoEnum = pgEnum('respuesta_contacto', RESPUESTAS_CONTACTO);
export const origenAccionEnum = pgEnum('origen_accion', ORIGENES_ACCION);
export const motivoEnlaceEnum = pgEnum('motivo_enlace_acceso', ['primer_ingreso', 'blanqueo_clave', 'blanqueo_verificacion']);
export const resultadoIntentoEnum = pgEnum('resultado_intento_ingreso', ['clave_incorrecta', 'codigo_incorrecto', 'clave_correcta', 'ingreso', 'bloqueado']);
export const ambitoIntentoEnum = pgEnum('ambito_intento', ['ingreso', 'cuenta']);

const id = () => uuid('id').primaryKey().defaultRandom();
const creadoEn = () => timestamp('creado_en', { withTimezone: true }).notNull().defaultNow();
const fechaHora = (nombre: string) => timestamp(nombre, { withTimezone: true });

/**
 * Normalización en SQL equivalente a `normalizarTexto` (src/domain/pacientes):
 * sin tildes, en minúsculas y solo letras y números. Son funciones inmutables,
 * así que sirve para columnas generadas que la aplicación nunca escribe.
 */
const CON_TILDE = 'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ';
const SIN_TILDE = 'AAAAAEEEEIIIIOOOOOUUUUNC';
const normalizarSql = (expresion: string) =>
  `btrim(regexp_replace(lower(translate(${expresion}, '${CON_TILDE}${CON_TILDE.toLowerCase()}', '${SIN_TILDE}${SIN_TILDE.toLowerCase()}')), '[^a-z0-9]+', ' ', 'g'))`;

/** Piezas válidas en notación FDI (permanentes 11-48, temporales 51-85). */
const CHECK_PIEZA_FDI = (columna: string) =>
  sql.raw(`(${columna} / 10 between 1 and 4 and ${columna} % 10 between 1 and 8) or (${columna} / 10 between 5 and 8 and ${columna} % 10 between 1 and 5)`);

// ---------------------------------------------------------------------------
// Consultorios, usuarios, roles y profesionales
// ---------------------------------------------------------------------------

/**
 * Consultorios que usan el sistema. Hoy hay uno solo; la pertenencia y los
 * roles ya son por consultorio (ver docs/multi-consultorio.md).
 */
export const consultorios = pgTable('consultorios', {
  id: id(),
  nombre: text('nombre').notNull(),
  activo: boolean('activo').notNull().default(true),
  creadoEn: creadoEn(),
});

/**
 * Personas con acceso al sistema. La cuenta (email, contraseña y verificación
 * en dos pasos) es una sola aunque trabaje en varios consultorios.
 */
export const usuarios = pgTable(
  'usuarios',
  {
    id: id(),
    /** Siempre en minúsculas y sin espacios (ver `normalizarEmail`). */
    email: text('email').notNull().unique(),
    nombre: text('nombre').notNull(),
    apellido: text('apellido').notNull(),
    /** Si es false, la cuenta no entra a ningún consultorio. */
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    /** Hash scrypt con sal propia (ver src/domain/acceso/contrasenas.ts). Vacío hasta que la persona la define. */
    claveHash: text('clave_hash'),
    claveCambiadaEn: fechaHora('clave_cambiada_en'),
    /** Clave de la app de autenticación, cifrada con CLAVE_SECRETOS (ver src/server/acceso/secretos.ts). */
    totpSecreto: text('totp_secreto'),
    totpConfirmadoEn: fechaHora('totp_confirmado_en'),
    /** Último intervalo de 30 segundos aceptado: un mismo código no sirve dos veces. */
    totpUltimoPaso: bigint('totp_ultimo_paso', { mode: 'number' }),
    /** Clave nueva mientras se configura otra app; pasa a `totp_secreto` al confirmarla con un código. */
    totpPendiente: text('totp_pendiente'),
    totpPendienteEn: fechaHora('totp_pendiente_en'),
  },
  (t) => [
    check('usuarios_email_normalizado', sql`${t.email} = lower(btrim(${t.email}))`),
    check('usuarios_totp_confirmado', sql`(${t.totpSecreto} is null) = (${t.totpConfirmadoEn} is null)`),
  ],
);

/** Pertenencia de una persona a un consultorio. Se desactiva, no se borra. */
export const consultorioMiembros = pgTable(
  'consultorio_miembros',
  {
    consultorioId: uuid('consultorio_id').notNull().references(() => consultorios.id),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [primaryKey({ columns: [t.consultorioId, t.usuarioId] }), index('consultorio_miembros_usuario_idx').on(t.usuarioId)],
);

/** Roles de cada persona en cada consultorio: en uno puede ser profesional y en otro, además, administradora. */
export const usuarioRoles = pgTable(
  'usuario_roles',
  {
    consultorioId: uuid('consultorio_id').notNull().references(() => consultorios.id),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    rol: rolEnum('rol').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.consultorioId, t.usuarioId, t.rol] }),
    foreignKey({ name: 'usuario_roles_miembro_fk', columns: [t.consultorioId, t.usuarioId], foreignColumns: [consultorioMiembros.consultorioId, consultorioMiembros.usuarioId] }),
  ],
);

export const profesionales = pgTable(
  'profesionales',
  {
    usuarioId: uuid('usuario_id').primaryKey().references(() => usuarios.id),
    matricula: text('matricula').notNull().unique(),
    /**
     * PIN de firma: se pide cada vez que se firma un registro clínico. Se guarda
     * solo su huella (scrypt con sal, ver `src/server/hc/pin.ts`), nunca el PIN.
     */
    pinFirmaHash: text('pin_firma_hash'),
    pinFirmaActualizadoEn: fechaHora('pin_firma_actualizado_en'),
    /** Intentos fallidos seguidos. Al quinto, el PIN se bloquea 15 minutos. */
    pinFirmaIntentosFallidos: smallint('pin_firma_intentos_fallidos').notNull().default(0),
    pinFirmaBloqueadoHasta: fechaHora('pin_firma_bloqueado_hasta'),
  },
  (t) => [check('profesionales_pin_intentos', sql`${t.pinFirmaIntentosFallidos} >= 0`)],
);

export const profesionalEspecialidades = pgTable(
  'profesional_especialidades',
  {
    usuarioId: uuid('usuario_id').notNull().references(() => profesionales.usuarioId),
    especialidad: especialidadEnum('especialidad').notNull(),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.especialidad] })],
);

// ---------------------------------------------------------------------------
// Inicio de sesión (ver docs/arquitectura.md, "Inicio de sesión")
// ---------------------------------------------------------------------------

/**
 * Sesiones abiertas. El token viaja solo en la cookie; acá se guarda su
 * SHA-256, así que copiar esta tabla no sirve para entrar. La sesión lleva el
 * consultorio en el que se está trabajando.
 */
export const sesiones = pgTable(
  'sesiones',
  {
    id: id(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    consultorioId: uuid('consultorio_id').notNull().references(() => consultorios.id),
    creadaEn: creadoEn(),
    /** Cuándo se escribió bien el código de la app. Sin esto la sesión solo sirve para escribirlo. */
    verificadaEn: fechaHora('verificada_en'),
    ultimoUsoEn: fechaHora('ultimo_uso_en').notNull().defaultNow(),
    cerradaEn: fechaHora('cerrada_en'),
    /** salir, otras_sesiones, cambio_de_clave, blanqueo, desactivado... */
    motivoCierre: text('motivo_cierre'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('sesiones_usuario_idx').on(t.usuarioId, t.cerradaEn),
    foreignKey({ name: 'sesiones_miembro_fk', columns: [t.consultorioId, t.usuarioId], foreignColumns: [consultorioMiembros.consultorioId, consultorioMiembros.usuarioId] }),
    check('sesiones_token_hash_hex', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/** Códigos de recuperación de un solo uso, guardados como hash. */
export const codigosRecuperacion = pgTable(
  'codigos_recuperacion',
  {
    id: id(),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    codigoHash: char('codigo_hash', { length: 64 }).notNull(),
    creadoEn: creadoEn(),
    usadoEn: fechaHora('usado_en'),
    /** Al generar códigos nuevos o blanquear la verificación, los anteriores se anulan. */
    anuladoEn: fechaHora('anulado_en'),
  },
  (t) => [unique('codigos_recuperacion_unico').on(t.usuarioId, t.codigoHash)],
);

/**
 * Enlaces de un solo uso para definir la contraseña y la verificación en dos
 * pasos: el primer ingreso y los blanqueos. Como no hay envío de emails, el
 * administrador ve el enlace y se lo pasa a la persona.
 */
export const enlacesAcceso = pgTable(
  'enlaces_acceso',
  {
    id: id(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    motivo: motivoEnlaceEnum('motivo').notNull(),
    creadoPor: uuid('creado_por').notNull().references(() => usuarios.id),
    creadoEn: creadoEn(),
    venceEn: fechaHora('vence_en').notNull(),
    usadoEn: fechaHora('usado_en'),
    anuladoEn: fechaHora('anulado_en'),
  },
  (t) => [
    // Un solo enlace vigente por persona: generar otro anula el anterior.
    uniqueIndex('enlaces_acceso_uno_vigente').on(t.usuarioId).where(sql`${t.usadoEn} is null and ${t.anuladoEn} is null`),
    check('enlaces_acceso_token_hash_hex', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * Intentos de ingreso, para los bloqueos (ver `src/server/acceso/registro.ts`).
 * Del email se guarda una huella (SHA-256), no lo que se escribió: a veces es
 * la contraseña.
 */
export const intentosIngreso = pgTable(
  'intentos_ingreso',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    emailHuella: char('email_huella', { length: 64 }),
    usuarioId: uuid('usuario_id').references(() => usuarios.id),
    ip: text('ip'),
    resultado: resultadoIntentoEnum('resultado').notNull(),
    /**
     * `ingreso`: inicio de sesión y enlaces de un solo uso (cuentan por email e
     * IP, por email y por IP). `cuenta`: lo que se confirma en "Mi cuenta" con
     * la sesión ya abierta (cuenta por usuario, aparte de los ingresos).
     */
    ambito: ambitoIntentoEnum('ambito').notNull().default('ingreso'),
    ocurridoEn: creadoEn(),
  },
  (t) => [
    index('intentos_ingreso_email_idx').on(t.emailHuella, t.ocurridoEn),
    index('intentos_ingreso_ip_idx').on(t.ip, t.ocurridoEn),
    index('intentos_ingreso_usuario_idx').on(t.usuarioId, t.ocurridoEn),
  ],
);

// ---------------------------------------------------------------------------
// Ficha del paciente (zona administrativa)
// ---------------------------------------------------------------------------
export const pacientes = pgTable(
  'pacientes',
  {
    id: id(),
    tipoDocumento: text('tipo_documento').notNull().default('DNI'),
    /** Solo dígitos (ver `normalizarDocumento`). */
    numeroDocumento: text('numero_documento').notNull(),
    nombre: text('nombre').notNull(),
    apellido: text('apellido').notNull(),
    fechaNacimiento: date('fecha_nacimiento', { mode: 'string' }).notNull(),
    telefono: text('telefono'),
    email: text('email'),
    /** Clave del archivo de foto en el almacenamiento: se muestra en turnos y en la HC. */
    fotoKey: text('foto_key'),
    /** Permiso para recibir recordatorios y mensajes (Ley 25.326), separado de la atención. */
    aceptaMensajes: boolean('acepta_mensajes').notNull().default(false),
    aceptaMensajesEn: fechaHora('acepta_mensajes_en'),
    activo: boolean('activo').notNull().default(true),
    creadoEn: creadoEn(),
    creadoPor: uuid('creado_por').notNull().references(() => usuarios.id),
    /** "perez juan": detecta homónimos aunque se cargue con o sin tildes. La calcula la base. */
    nombreNormalizado: text('nombre_normalizado').generatedAlwaysAs(sql.raw(normalizarSql(`apellido || ' ' || nombre`))),
    /** Nombre normalizado + documento: lo que se busca desde la recepción. La calcula la base. */
    textoBusqueda: text('texto_busqueda').generatedAlwaysAs(sql.raw(`${normalizarSql(`apellido || ' ' || nombre`)} || ' ' || numero_documento`)),
  },
  (t) => [
    unique('pacientes_documento_unico').on(t.tipoDocumento, t.numeroDocumento),
    index('pacientes_apellido_nombre_idx').on(t.apellido, t.nombre),
    index('pacientes_nombre_normalizado_idx').on(t.nombreNormalizado),
  ],
);

export const financiadores = pgTable('financiadores', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  esParticular: boolean('es_particular').notNull().default(false),
  activo: boolean('activo').notNull().default(true),
});

export const pacienteCoberturas = pgTable(
  'paciente_coberturas',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    financiadorId: uuid('financiador_id').notNull().references(() => financiadores.id),
    numeroAfiliado: text('numero_afiliado'),
    plan: text('plan'),
    vigenteDesde: date('vigente_desde', { mode: 'string' }).notNull(),
    vigenteHasta: date('vigente_hasta', { mode: 'string' }),
    creadoEn: creadoEn(),
  },
  (t) => [index('paciente_coberturas_paciente_idx').on(t.pacienteId)],
);

/**
 * Alertas médicas críticas (alergias, anticoagulantes, embarazo...). Son
 * clínicas, pero las ven también las secretarias para evitar errores.
 * Solo las carga un profesional.
 */
export const alertasMedicas = pgTable('alertas_medicas', {
  id: id(),
  pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
  tipo: tipoAlertaEnum('tipo').notNull(),
  descripcion: text('descripcion').notNull(),
  activa: boolean('activa').notNull().default(true),
  registradaPor: uuid('registrada_por').notNull().references(() => profesionales.usuarioId),
  creadoEn: creadoEn(),
  desactivadaEn: fechaHora('desactivada_en'),
  desactivadaPor: uuid('desactivada_por').references(() => profesionales.usuarioId),
});

/** Notas administrativas ("prefiere turnos a la tarde"). NO son historia clínica. */
export const notasAdministrativas = pgTable('notas_administrativas', {
  id: id(),
  pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
  texto: text('texto').notNull(),
  autorId: uuid('autor_id').notNull().references(() => usuarios.id),
  creadoEn: creadoEn(),
  actualizadoEn: fechaHora('actualizado_en'),
});

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------
export const sillones = pgTable('sillones', {
  id: id(),
  nombre: text('nombre').notNull().unique(),
  activo: boolean('activo').notNull().default(true),
});

export const turnos = pgTable(
  'turnos',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    profesionalId: uuid('profesional_id').notNull().references(() => profesionales.usuarioId),
    sillonId: uuid('sillon_id').references(() => sillones.id),
    inicio: fechaHora('inicio').notNull(),
    fin: fechaHora('fin').notNull(),
    estado: estadoTurnoEnum('estado').notNull().default('reservado'),
    motivo: text('motivo'),
    /** Turno original cuando este es una reprogramación. */
    reprogramaA: uuid('reprograma_a').references((): AnyPgColumn => turnos.id),
    creadoPor: uuid('creado_por').notNull().references(() => usuarios.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('turnos_profesional_inicio_idx').on(t.profesionalId, t.inicio),
    index('turnos_paciente_idx').on(t.pacienteId),
    check('turnos_fin_despues_de_inicio', sql`${t.fin} > ${t.inicio}`),
  ],
);

/** Historial de cambios de estado de cada turno (solo agregar). */
export const turnoEventos = pgTable('turno_eventos', {
  id: id(),
  turnoId: uuid('turno_id').notNull().references(() => turnos.id),
  estadoAnterior: estadoTurnoEnum('estado_anterior'),
  estadoNuevo: estadoTurnoEnum('estado_nuevo').notNull(),
  usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
  nota: text('nota'),
  ocurridoEn: creadoEn(),
});

// ---------------------------------------------------------------------------
// Historia clínica (zona clínica)
// ---------------------------------------------------------------------------

/** Una sola historia clínica por paciente en el consultorio (Ley 26.529, art. 17). */
export const historiasClinicas = pgTable('historias_clinicas', {
  id: id(),
  numero: integer('numero').generatedAlwaysAsIdentity().unique(),
  pacienteId: uuid('paciente_id').notNull().unique().references(() => pacientes.id),
  creadaEn: creadoEn(),
});

/**
 * Borradores: lo que el profesional está escribiendo y todavía no firmó. Se
 * pueden editar y descartar. Al firmar se copian a `registros_clinicos`.
 */
export const borradoresClinicos = pgTable(
  'borradores_clinicos',
  {
    id: id(),
    historiaClinicaId: uuid('historia_clinica_id').notNull().references(() => historiasClinicas.id),
    autorId: uuid('autor_id').notNull().references(() => profesionales.usuarioId),
    tipo: tipoRegistroEnum('tipo').notNull(),
    contenido: jsonb('contenido').notNull(),
    actualizadoEn: creadoEn(),
  },
  // Un borrador por profesional, historia clínica y tipo: lo que estaba escribiendo.
  (t) => [unique('borradores_clinicos_unico').on(t.historiaClinicaId, t.autorId, t.tipo)],
);

/**
 * Registros clínicos firmados: inalterables y encadenados por hash.
 * Ver `src/domain/firma/encadenamiento.ts`.
 */
export const registrosClinicos = pgTable(
  'registros_clinicos',
  {
    id: id(),
    historiaClinicaId: uuid('historia_clinica_id').notNull().references(() => historiasClinicas.id),
    secuencia: integer('secuencia').notNull(),
    tipo: tipoRegistroEnum('tipo').notNull(),
    contenido: jsonb('contenido').notNull(),
    autorId: uuid('autor_id').notNull().references(() => profesionales.usuarioId),
    especialidad: especialidadEnum('especialidad'),
    turnoId: uuid('turno_id').references(() => turnos.id),
    enmiendaDe: uuid('enmienda_de').references((): AnyPgColumn => registrosClinicos.id),
    firmadoEn: fechaHora('firmado_en').notNull(),
    hashAnterior: char('hash_anterior', { length: 64 }).notNull(),
    hash: char('hash', { length: 64 }).notNull().unique(),
    metodoFirma: metodoFirmaEnum('metodo_firma').notNull().default('electronica'),
    /** Firma digital (CMS/PKCS#7 en base64) sobre `hash`, cuando se firma con certificado. */
    firmaDigital: text('firma_digital'),
  },
  (t) => [
    unique('registros_clinicos_secuencia_unica').on(t.historiaClinicaId, t.secuencia),
    check('registros_clinicos_enmienda', sql`(${t.tipo} = 'enmienda') = (${t.enmiendaDe} is not null)`),
    check('registros_clinicos_hash_hex', sql`${t.hash} ~ '^[0-9a-f]{64}$' and ${t.hashAnterior} ~ '^[0-9a-f]{64}$'`),
    check('registros_clinicos_firma_digital', sql`(${t.metodoFirma} = 'digital') = (${t.firmaDigital} is not null)`),
  ],
);

/** Marcas del odontograma (solo agregar). Ver `src/domain/odontograma/estado.ts`. */
export const marcasOdontograma = pgTable(
  'marcas_odontograma',
  {
    id: id(),
    registroId: uuid('registro_id').notNull().references(() => registrosClinicos.id),
    historiaClinicaId: uuid('historia_clinica_id').notNull().references(() => historiasClinicas.id),
    pieza: smallint('pieza').notNull(),
    cara: caraEnum('cara'),
    hallazgo: hallazgoEnum('hallazgo').notNull(),
    estado: estadoMarcaEnum('estado').notNull(),
    reemplazaA: uuid('reemplaza_a').references((): AnyPgColumn => marcasOdontograma.id),
    anulacion: boolean('anulacion').notNull().default(false),
    prestacionCodigo: text('prestacion_codigo').references(() => nomencladorPrestaciones.codigo),
    registradaEn: fechaHora('registrada_en').notNull(),
  },
  (t) => [
    index('marcas_odontograma_hc_idx').on(t.historiaClinicaId, t.registradaEn),
    unique('marcas_odontograma_reemplazo_unico').on(t.reemplazaA),
    check('marcas_odontograma_pieza_fdi', CHECK_PIEZA_FDI('pieza')),
    check('marcas_odontograma_anulacion', sql`not ${t.anulacion} or ${t.reemplazaA} is not null`),
  ],
);

/**
 * Archivos: radiografías, fotos, estudios (clínicos) o DNI y credencial
 * (administrativos). El archivo vive en un bucket con Object Lock (no se puede
 * borrar ni pisar); acá queda su huella SHA-256. Un adjunto clínico se
 * incorpora a la HC con un registro clínico de tipo `adjunto` que lo cita.
 */
export const adjuntos = pgTable(
  'adjuntos',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    ambito: ambitoAdjuntoEnum('ambito').notNull(),
    historiaClinicaId: uuid('historia_clinica_id').references(() => historiasClinicas.id),
    pieza: smallint('pieza'),
    storageKey: text('storage_key').notNull().unique(),
    sha256: char('sha256', { length: 64 }).notNull(),
    tipoMime: text('tipo_mime').notNull(),
    bytes: integer('bytes').notNull(),
    nombreOriginal: text('nombre_original').notNull(),
    descripcion: text('descripcion'),
    subidoPor: uuid('subido_por').notNull().references(() => usuarios.id),
    subidoEn: creadoEn(),
  },
  (t) => [
    index('adjuntos_paciente_idx').on(t.pacienteId),
    index('adjuntos_hc_idx').on(t.historiaClinicaId),
    check('adjuntos_clinicos_en_hc', sql`${t.ambito} <> 'clinico' or ${t.historiaClinicaId} is not null`),
    check('adjuntos_pieza_fdi', sql`${t.pieza} is null or (${CHECK_PIEZA_FDI('pieza')})`),
  ],
);

/**
 * Modelos de consentimiento informado, versionados. El consentimiento firmado
 * es un registro clínico de tipo `consentimiento` que cita plantilla, versión,
 * hash del texto y firmante (paciente o representante).
 */
export const plantillasConsentimiento = pgTable(
  'plantillas_consentimiento',
  {
    id: id(),
    procedimiento: text('procedimiento').notNull(),
    version: integer('version').notNull(),
    texto: text('texto').notNull(),
    vigente: boolean('vigente').notNull().default(true),
    creadoEn: creadoEn(),
  },
  (t) => [unique('plantillas_consentimiento_version').on(t.procedimiento, t.version)],
);

// ---------------------------------------------------------------------------
// Plan de tratamiento, cobertura y presupuestos (OSDE y particular)
// ---------------------------------------------------------------------------

/** Nomenclador vigente de prestaciones. Se carga con los códigos reales que use el consultorio. */
export const nomencladorPrestaciones = pgTable('nomenclador_prestaciones', {
  codigo: text('codigo').primaryKey(),
  descripcion: text('descripcion').notNull(),
  requierePieza: boolean('requiere_pieza').notNull().default(false),
  requiereCara: boolean('requiere_cara').notNull().default(false),
  activo: boolean('activo').notNull().default(true),
});

export const aranceles = pgTable(
  'aranceles',
  {
    id: id(),
    financiadorId: uuid('financiador_id').notNull().references(() => financiadores.id),
    prestacionCodigo: text('prestacion_codigo').notNull().references(() => nomencladorPrestaciones.codigo),
    importe: numeric('importe', { precision: 12, scale: 2 }).notNull(),
    vigenteDesde: date('vigente_desde', { mode: 'string' }).notNull(),
  },
  (t) => [unique('aranceles_vigencia').on(t.financiadorId, t.prestacionCodigo, t.vigenteDesde)],
);

/** Cada prestación del plan define quién la paga: OSDE o particular. */
export const planPrestaciones = pgTable(
  'plan_prestaciones',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    prestacionCodigo: text('prestacion_codigo').notNull().references(() => nomencladorPrestaciones.codigo),
    pieza: smallint('pieza'),
    caras: caraEnum('caras').array(),
    financiadorId: uuid('financiador_id').notNull().references(() => financiadores.id),
    estado: estadoPrestacionEnum('estado').notNull().default('propuesta'),
    numeroAutorizacion: text('numero_autorizacion'),
    importe: numeric('importe', { precision: 12, scale: 2 }),
    /** Marca roja del odontograma que originó la prestación. */
    marcaId: uuid('marca_id').references(() => marcasOdontograma.id),
    indicadaPor: uuid('indicada_por').notNull().references(() => profesionales.usuarioId),
    /** Registro clínico firmado que documenta la realización. */
    registroRealizacionId: uuid('registro_realizacion_id').references(() => registrosClinicos.id),
    creadoEn: creadoEn(),
    realizadaEn: fechaHora('realizada_en'),
  },
  (t) => [
    index('plan_prestaciones_paciente_idx').on(t.pacienteId, t.estado),
    check('plan_prestaciones_pieza_fdi', sql`${t.pieza} is null or (${CHECK_PIEZA_FDI('pieza')})`),
    check('plan_prestaciones_realizada', sql`${t.estado} <> 'realizada' or ${t.registroRealizacionId} is not null`),
  ],
);

export const presupuestos = pgTable('presupuestos', {
  id: id(),
  pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
  entregadoEn: fechaHora('entregado_en'),
  respuesta: respuestaPresupuestoEnum('respuesta').notNull().default('pendiente'),
  respondidoEn: fechaHora('respondido_en'),
  creadoPor: uuid('creado_por').notNull().references(() => usuarios.id),
  creadoEn: creadoEn(),
});

export const presupuestoItems = pgTable(
  'presupuesto_items',
  {
    presupuestoId: uuid('presupuesto_id').notNull().references(() => presupuestos.id),
    planPrestacionId: uuid('plan_prestacion_id').notNull().references(() => planPrestaciones.id),
    importe: numeric('importe', { precision: 12, scale: 2 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.presupuestoId, t.planPrestacionId] })],
);

// ---------------------------------------------------------------------------
// Seguimiento (tablero de pendientes)
// ---------------------------------------------------------------------------

/**
 * "¿Cuándo debería volver?": lo indica la profesional al terminar el turno y
 * lo carga ella o la secretaria. Es de solo agregar (trigger): para cambiarlo
 * se carga otra indicación, y vale la última de la última visita.
 */
export const indicacionesRegreso = pgTable(
  'indicaciones_regreso',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    /** Turno atendido en que se indicó. Sin turno si se cargó desde la ficha sin visita previa. */
    turnoId: uuid('turno_id').references(() => turnos.id),
    plazo: plazoRegresoEnum('plazo').notNull(),
    importante: boolean('importante').notNull().default(false),
    /** Día de la visita: desde ahí corre el plazo. */
    fechaVisita: date('fecha_visita', { mode: 'string' }).notNull(),
    /** Día en que debería volver. Sin fecha para "Cuando el paciente avise" y "No hace falta". */
    fechaEsperada: date('fecha_esperada', { mode: 'string' }),
    /** Profesional que lo indicó. */
    indicadaPor: uuid('indicada_por').notNull().references(() => profesionales.usuarioId),
    /** Quién lo cargó en el sistema (la profesional o la secretaria). */
    cargadaPor: uuid('cargada_por').notNull().references(() => usuarios.id),
    creadoEn: creadoEn(),
  },
  (t) => [
    index('indicaciones_regreso_paciente_idx').on(t.pacienteId, t.fechaVisita),
    index('indicaciones_regreso_turno_idx').on(t.turnoId),
    check('indicaciones_regreso_fecha_esperada', sql`(${t.plazo} in ('cuando_avise', 'no_hace_falta')) = (${t.fechaEsperada} is null)`),
  ],
);

/**
 * Un pendiente por caso (paciente + motivo + origen). Lo crean las reglas de
 * `src/domain/seguimiento/reglas.ts`; `clave` evita duplicarlo al recalcular.
 * El estado cambia; lo que pasó queda en `pendiente_acciones` (solo agregar).
 */
export const pendientes = pgTable(
  'pendientes',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    tipo: tipoPendienteEnum('tipo').notNull(),
    estado: estadoPendienteEnum('estado').notNull().default('abierto'),
    prioridad: prioridadPendienteEnum('prioridad').notNull().default('media'),
    /** "Es importante que vuelva": si no responde, le llega a la profesional. */
    importante: boolean('importante').notNull().default(false),
    /** Caso que lo originó, por ejemplo `indicacion:<id>` o `ausente:<turno>`. Nulo en los manuales. */
    clave: text('clave'),
    responsableId: uuid('responsable_id').references(() => usuarios.id),
    tomadoEn: fechaHora('tomado_en'),
    /** Motivo legible. */
    detalle: text('detalle').notNull(),
    /** Desde cuándo corre. */
    desde: fechaHora('desde').notNull(),
    /** Fecha esperada de regreso (indicación de la profesional), si hay. */
    venceEn: fechaHora('vence_en'),
    /**
     * Volver a contactar desde este día. Lo propone la regla al crearlo; después
     * lo fija una persona ("cobra el 10") y, más adelante, lo podrá proponer una IA.
     */
    contactarDesde: date('contactar_desde', { mode: 'string' }).notNull().default(sql`current_date`),
    contactarDesdeMotivo: text('contactar_desde_motivo'),
    contactarDesdeOrigen: origenAccionEnum('contactar_desde_origen').notNull().default('sistema'),
    /** Profesional que indicó el plazo o atendió el turno. */
    profesionalId: uuid('profesional_id').references(() => profesionales.usuarioId),
    turnoId: uuid('turno_id').references(() => turnos.id),
    indicacionId: uuid('indicacion_id').references(() => indicacionesRegreso.id),
    /** A quién le llegó porque no responde y era importante. */
    escaladoA: uuid('escalado_a').references(() => usuarios.id),
    escaladoEn: fechaHora('escalado_en'),
    creadoEn: creadoEn(),
    resueltoEn: fechaHora('resuelto_en'),
    /** Quién lo cerró. Nulo si se resolvió solo (por ejemplo, porque sacó turno). */
    cerradoPor: uuid('cerrado_por').references(() => usuarios.id),
    motivoCierre: text('motivo_cierre'),
    resueltoPorTurnoId: uuid('resuelto_por_turno_id').references(() => turnos.id),
  },
  (t) => [
    index('pendientes_abiertos_idx').on(t.estado, t.responsableId),
    index('pendientes_paciente_idx').on(t.pacienteId),
    unique('pendientes_clave_unica').on(t.clave),
  ],
);

/**
 * Qué se hizo con cada pendiente (solo agregar): quién lo tomó, cada contacto
 * con su canal y respuesta, cada cambio de fecha con su motivo y cómo se cerró.
 */
export const pendienteAcciones = pgTable(
  'pendiente_acciones',
  {
    id: id(),
    pendienteId: uuid('pendiente_id').notNull().references(() => pendientes.id),
    tipo: tipoAccionPendienteEnum('tipo').notNull().default('contacto'),
    /** Quién lo hizo. En las acciones del sistema, quién provocó el recálculo (si se sabe). */
    usuarioId: uuid('usuario_id').references(() => usuarios.id),
    origen: origenAccionEnum('origen').notNull().default('usuario'),
    canal: canalContactoEnum('canal'),
    respuesta: respuestaContactoEnum('respuesta'),
    /** Lo que respondió el paciente o el motivo, en palabras de quien lo carga. */
    resultado: text('resultado'),
    /** Volver a contactar desde este día, y por qué. */
    contactarDesde: date('contactar_desde', { mode: 'string' }),
    contactarDesdeMotivo: text('contactar_desde_motivo'),
    ocurridoEn: creadoEn(),
  },
  (t) => [
    index('pendiente_acciones_pendiente_idx').on(t.pendienteId, t.ocurridoEn),
    check('pendiente_acciones_contacto', sql`${t.tipo} <> 'contacto' or (${t.canal} is not null and ${t.respuesta} is not null)`),
    check('pendiente_acciones_autor', sql`${t.origen} <> 'usuario' or ${t.usuarioId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Auditoría de accesos (solo agregar)
// ---------------------------------------------------------------------------
export const auditoriaAccesos = pgTable(
  'auditoria_accesos',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    /** Por ejemplo: `hc.ver`, `hc.exportar`, `registro.firmar`, `paciente.editar`. */
    accion: text('accion').notNull(),
    entidad: text('entidad').notNull(),
    entidadId: text('entidad_id'),
    pacienteId: uuid('paciente_id').references(() => pacientes.id),
    ip: text('ip'),
    userAgent: text('user_agent'),
    detalle: jsonb('detalle'),
    ocurridoEn: creadoEn(),
  },
  (t) => [index('auditoria_paciente_idx').on(t.pacienteId, t.ocurridoEn), index('auditoria_usuario_idx').on(t.usuarioId, t.ocurridoEn)],
);

// ---------------------------------------------------------------------------
// Archivos guardados en la base (demo online, donde el disco no persiste)
// ---------------------------------------------------------------------------
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => 'bytea' });

/**
 * Contenido de fotos y adjuntos cuando no hay un disco que dure (la demo en
 * Vercel). Como el futuro bucket con Object Lock: el nombre es la huella
 * SHA-256, la base comprueba la huella y la tabla es de solo agregar (trigger
 * en la migración `demo_sql`).
 */
export const archivos = pgTable(
  'archivos',
  {
    /** `fotos/<sha256>.jpg`: la misma clave que guarda `pacientes.foto_key`. */
    clave: text('clave').primaryKey(),
    sha256: char('sha256', { length: 64 }).notNull(),
    tipoMime: text('tipo_mime').notNull(),
    bytes: integer('bytes').notNull(),
    contenido: bytea('contenido').notNull(),
    creadoEn: creadoEn(),
  },
  (t) => [
    check('archivos_huella', sql`${t.sha256} = encode(sha256(${t.contenido}), 'hex')`),
    check('archivos_clave_con_huella', sql`${t.clave} like '%/' || ${t.sha256} || '.%'`),
    check('archivos_tamanio', sql`${t.bytes} = octet_length(${t.contenido})`),
  ],
);

// ---------------------------------------------------------------------------
// Marca de base de prueba (ver src/db/marca-de-prueba.ts)
// ---------------------------------------------------------------------------

/**
 * Una sola fila que deja la semilla del modo desarrollo: "esta base tiene
 * datos y usuarios inventados, con credenciales públicas". El modo desarrollo
 * solo funciona sobre una base con la marca (o vacía), y el modo real se niega
 * a usar una base que la tenga. No se puede cambiar ni borrar (trigger en la
 * migración `base_de_prueba_sql`): una base de prueba nunca deja de serlo.
 */
export const baseDePrueba = pgTable(
  'base_de_prueba',
  {
    /** Siempre `true`: la clave primaria hace que haya una sola fila. */
    unica: boolean('unica').primaryKey().default(true),
    creadaEn: creadoEn(),
  },
  (t) => [check('base_de_prueba_una_fila', sql`${t.unica}`)],
);
