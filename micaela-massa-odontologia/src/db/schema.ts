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
  bigserial,
  boolean,
  char,
  check,
  date,
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
  uuid,
} from 'drizzle-orm/pg-core';
import { ESTADOS_TURNO } from '../domain/agenda/turnos';
import { CODIGOS_HALLAZGO, ESTADOS_MARCA } from '../domain/odontograma/catalogo';
import { CARAS } from '../domain/odontograma/piezas';
import { ESPECIALIDADES, ROLES } from '../domain/permisos/roles';
import { TIPOS_PENDIENTE } from '../domain/seguimiento/reglas';

// ---------------------------------------------------------------------------
// Enumerados
// ---------------------------------------------------------------------------
export const rolEnum = pgEnum('rol', ROLES);
export const especialidadEnum = pgEnum('especialidad', ESPECIALIDADES);
export const estadoTurnoEnum = pgEnum('estado_turno', ESTADOS_TURNO);
export const caraEnum = pgEnum('cara_dental', CARAS);
export const hallazgoEnum = pgEnum('hallazgo_dental', CODIGOS_HALLAZGO);
export const estadoMarcaEnum = pgEnum('estado_marca', ESTADOS_MARCA);
export const tipoRegistroEnum = pgEnum('tipo_registro_clinico', [
  'anamnesis',
  'evolucion',
  'diagnostico',
  'odontograma',
  'plan_tratamiento',
  'consentimiento',
  'adjunto',
  'enmienda',
]);
export const metodoFirmaEnum = pgEnum('metodo_firma', ['electronica', 'digital']);
export const tipoAlertaEnum = pgEnum('tipo_alerta_medica', ['alergia', 'medicacion', 'condicion']);
export const ambitoAdjuntoEnum = pgEnum('ambito_adjunto', ['administrativo', 'clinico']);
export const estadoPrestacionEnum = pgEnum('estado_prestacion', ['propuesta', 'aceptada', 'autorizada', 'realizada', 'cancelada']);
export const respuestaPresupuestoEnum = pgEnum('respuesta_presupuesto', ['pendiente', 'aceptado', 'aceptado_parcial', 'rechazado']);
export const tipoPendienteEnum = pgEnum('tipo_pendiente', TIPOS_PENDIENTE);
export const estadoPendienteEnum = pgEnum('estado_pendiente', ['abierto', 'en_curso', 'resuelto', 'descartado']);
export const canalContactoEnum = pgEnum('canal_contacto', ['llamada', 'whatsapp', 'instagram', 'email', 'presencial']);

const id = () => uuid('id').primaryKey().defaultRandom();
const creadoEn = () => timestamp('creado_en', { withTimezone: true }).notNull().defaultNow();
const fechaHora = (nombre: string) => timestamp(nombre, { withTimezone: true });

/** Piezas válidas en notación FDI (permanentes 11-48, temporales 51-85). */
const CHECK_PIEZA_FDI = (columna: string) =>
  sql.raw(`(${columna} / 10 between 1 and 4 and ${columna} % 10 between 1 and 8) or (${columna} / 10 between 5 and 8 and ${columna} % 10 between 1 and 5)`);

// ---------------------------------------------------------------------------
// Usuarios, roles y profesionales
// ---------------------------------------------------------------------------
export const usuarios = pgTable('usuarios', {
  id: id(),
  email: text('email').notNull().unique(),
  nombre: text('nombre').notNull(),
  apellido: text('apellido').notNull(),
  activo: boolean('activo').notNull().default(true),
  creadoEn: creadoEn(),
});

export const usuarioRoles = pgTable(
  'usuario_roles',
  {
    usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
    rol: rolEnum('rol').notNull(),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.rol] })],
);

export const profesionales = pgTable('profesionales', {
  usuarioId: uuid('usuario_id').primaryKey().references(() => usuarios.id),
  matricula: text('matricula').notNull().unique(),
});

export const profesionalEspecialidades = pgTable(
  'profesional_especialidades',
  {
    usuarioId: uuid('usuario_id').notNull().references(() => profesionales.usuarioId),
    especialidad: especialidadEnum('especialidad').notNull(),
  },
  (t) => [primaryKey({ columns: [t.usuarioId, t.especialidad] })],
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
  },
  (t) => [unique('pacientes_documento_unico').on(t.tipoDocumento, t.numeroDocumento), index('pacientes_apellido_nombre_idx').on(t.apellido, t.nombre)],
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
export const borradoresClinicos = pgTable('borradores_clinicos', {
  id: id(),
  historiaClinicaId: uuid('historia_clinica_id').notNull().references(() => historiasClinicas.id),
  autorId: uuid('autor_id').notNull().references(() => profesionales.usuarioId),
  tipo: tipoRegistroEnum('tipo').notNull(),
  contenido: jsonb('contenido').notNull(),
  actualizadoEn: creadoEn(),
});

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
export const pendientes = pgTable(
  'pendientes',
  {
    id: id(),
    pacienteId: uuid('paciente_id').notNull().references(() => pacientes.id),
    tipo: tipoPendienteEnum('tipo').notNull(),
    estado: estadoPendienteEnum('estado').notNull().default('abierto'),
    responsableId: uuid('responsable_id').references(() => usuarios.id),
    detalle: text('detalle').notNull(),
    desde: fechaHora('desde').notNull(),
    venceEn: fechaHora('vence_en'),
    creadoEn: creadoEn(),
    resueltoEn: fechaHora('resuelto_en'),
  },
  (t) => [index('pendientes_abiertos_idx').on(t.estado, t.responsableId)],
);

/** Qué se hizo con cada pendiente: quién contactó, por qué canal y qué pasó (solo agregar). */
export const pendienteAcciones = pgTable('pendiente_acciones', {
  id: id(),
  pendienteId: uuid('pendiente_id').notNull().references(() => pendientes.id),
  usuarioId: uuid('usuario_id').notNull().references(() => usuarios.id),
  canal: canalContactoEnum('canal').notNull(),
  resultado: text('resultado').notNull(),
  ocurridoEn: creadoEn(),
});

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
