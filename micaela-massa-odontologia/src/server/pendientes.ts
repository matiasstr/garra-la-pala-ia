/**
 * Seguimiento de pacientes: "¿Cuándo debería volver?" y el tablero de pendientes.
 *
 * - `sincronizarPendientes` corre las reglas puras de `src/domain/seguimiento`
 *   y crea, actualiza, resuelve o reabre filas de `pendientes`. Es idempotente:
 *   cada caso tiene una `clave` única y nunca se duplica. Se llama al abrir el
 *   tablero y después de cada cambio de turnos o de indicación (no hay tareas
 *   programadas todavía).
 * - Lo que pasa con cada pendiente queda en `pendiente_acciones` (solo agregar)
 *   y las acciones de las personas, también en `auditoria_accesos`.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditoriaAccesos,
  indicacionesRegreso,
  nomencladorPrestaciones,
  pacientes,
  pendienteAcciones,
  pendientes,
  planPrestaciones,
  presupuestos,
  profesionales,
  turnoEventos,
  turnos,
  usuarios,
} from '../db/schema';
import type { BaseDeDatos } from '../db/tipos';
import { edad } from '../domain/pacientes/identificacion';
import { puede, type UsuarioConRoles } from '../domain/permisos/permisos';
import { PLAZOS_REGRESO, fechaEsperadaDeRegreso, type PlazoRegreso } from '../domain/seguimiento/regreso';
import {
  TIPOS_PENDIENTE,
  evaluarPendientes,
  motivoDeCierreAutomatico,
  proximoPendiente,
  type Pendiente,
  type Prioridad,
  type SituacionPaciente,
  type TipoPendiente,
} from '../domain/seguimiento/reglas';
import {
  CANALES_CONTACTO,
  ESTADOS_ACTIVOS,
  INTENTOS_HASTA_NO_RESPONDE,
  NOMBRE_RESPUESTA,
  RESPUESTAS_CONTACTO,
  diasSinContacto,
  esParaUsuario,
  estaActivo,
  estadoTrasContacto,
  hayQueAvisarAProfesional,
  intentosSinRespuesta,
  ordenarPendientes,
  validarFechaDeContacto,
  type CanalContacto,
  type EstadoPendiente,
  type OrigenAccion,
  type RespuestaContacto,
  type TipoAccionPendiente,
} from '../domain/seguimiento/tablero';
import { fechaDe, hoyEnArgentina, rangoDelDia } from '../lib/fechas';
import { ErrorDePermiso } from './errores';
import { contarHomonimos } from './pacientes';

type Transaccion = Parameters<Parameters<BaseDeDatos['transaction']>[0]>[0];
type Consultas = BaseDeDatos | Transaccion;

/** Serializa los recálculos: dos secretarias abriendo el tablero a la vez no duplican nada. */
const CANDADO_RECALCULO = 724_310_001;

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const mensajes = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];
const nombreCompleto = (u: { nombre: string; apellido: string }) => `${u.nombre} ${u.apellido}`;

function exigirPermiso(usuario: UsuarioConRoles) {
  if (!puede(usuario, 'seguimientos.gestionar')) throw new ErrorDePermiso('Tu usuario no hace el seguimiento de pacientes.');
}

async function auditar(db: Pick<BaseDeDatos, 'insert'>, usuarioId: string, accion: string, entidad: string, entidadId: string, pacienteId: string, detalle?: unknown) {
  await db.insert(auditoriaAccesos).values({ usuarioId, accion, entidad, entidadId, pacienteId, detalle: detalle ?? null });
}

// ---------------------------------------------------------------------------
// Situación de cada paciente (lo que necesitan las reglas)
// ---------------------------------------------------------------------------

/**
 * Arma la situación de los pacientes con algo para seguir. Son pocas consultas
 * para todos a la vez, no una por paciente.
 */
async function cargarSituaciones(db: Consultas, ahora: Date, pacienteIds?: readonly string[], extra: readonly string[] = []): Promise<Map<string, SituacionPaciente>> {
  if (pacienteIds && pacienteIds.length === 0) return new Map();
  const de = (columna: Parameters<typeof inArray>[0]) => (pacienteIds ? inArray(columna, [...pacienteIds]) : undefined);
  const inicioDeHoy = rangoDelDia(hoyEnArgentina(ahora)).desde;

  const [futuros, visitas, indicaciones, ausencias, planes, sinRespuesta] = await Promise.all([
    // Turno futuro: reservado o confirmado que todavía no terminó, o en sala hoy.
    db
      .select({ pacienteId: turnos.pacienteId, id: turnos.id, inicio: turnos.inicio })
      .from(turnos)
      .where(
        and(
          de(turnos.pacienteId),
          or(and(inArray(turnos.estado, ['reservado', 'confirmado']), gt(turnos.fin, ahora)), and(eq(turnos.estado, 'en_sala'), gte(turnos.inicio, inicioDeHoy))),
        ),
      )
      .orderBy(asc(turnos.inicio)),
    db
      .selectDistinctOn([turnos.pacienteId], { pacienteId: turnos.pacienteId, id: turnos.id, inicio: turnos.inicio, profesionalId: turnos.profesionalId })
      .from(turnos)
      .where(and(de(turnos.pacienteId), eq(turnos.estado, 'atendido')))
      .orderBy(turnos.pacienteId, desc(turnos.inicio)),
    db
      .selectDistinctOn([indicacionesRegreso.pacienteId], {
        indicacion: indicacionesRegreso,
        inicioTurno: turnos.inicio,
        profesionalNombre: usuarios.nombre,
        profesionalApellido: usuarios.apellido,
      })
      .from(indicacionesRegreso)
      .leftJoin(turnos, eq(turnos.id, indicacionesRegreso.turnoId))
      .innerJoin(usuarios, eq(usuarios.id, indicacionesRegreso.indicadaPor))
      .where(de(indicacionesRegreso.pacienteId))
      .orderBy(indicacionesRegreso.pacienteId, desc(indicacionesRegreso.fechaVisita), desc(indicacionesRegreso.creadoEn)),
    // Faltó: el turno pasó por "ausente" aunque después se haya reprogramado.
    db
      .selectDistinctOn([turnos.pacienteId], { pacienteId: turnos.pacienteId, id: turnos.id, inicio: turnos.inicio, profesionalId: turnos.profesionalId })
      .from(turnos)
      .innerJoin(turnoEventos, and(eq(turnoEventos.turnoId, turnos.id), eq(turnoEventos.estadoNuevo, 'ausente')))
      .where(de(turnos.pacienteId))
      .orderBy(turnos.pacienteId, desc(turnos.inicio)),
    db
      .select({
        pacienteId: planPrestaciones.pacienteId,
        descripcion: nomencladorPrestaciones.descripcion,
        pieza: planPrestaciones.pieza,
        creadoEn: planPrestaciones.creadoEn,
        profesionalId: planPrestaciones.indicadaPor,
      })
      .from(planPrestaciones)
      .innerJoin(nomencladorPrestaciones, eq(nomencladorPrestaciones.codigo, planPrestaciones.prestacionCodigo))
      .where(and(de(planPrestaciones.pacienteId), inArray(planPrestaciones.estado, ['aceptada', 'autorizada'])))
      .orderBy(asc(planPrestaciones.creadoEn)),
    db
      .select({ pacienteId: presupuestos.pacienteId, id: presupuestos.id, entregadoEn: presupuestos.entregadoEn })
      .from(presupuestos)
      .where(and(de(presupuestos.pacienteId), eq(presupuestos.respuesta, 'pendiente'), isNotNull(presupuestos.entregadoEn))),
  ]);

  const ids = new Set<string>([...extra, ...(pacienteIds ?? [])]);
  for (const fila of [...indicaciones.map((i) => i.indicacion), ...ausencias, ...planes, ...sinRespuesta]) ids.add(fila.pacienteId);
  if (!ids.size) return new Map();
  const activos = new Set(
    (await db.select({ id: pacientes.id }).from(pacientes).where(and(inArray(pacientes.id, [...ids]), eq(pacientes.activo, true)))).map((p) => p.id),
  );

  const situaciones = new Map<string, SituacionPaciente>();
  for (const pacienteId of ids) {
    // Un paciente dado de baja no tiene seguimiento: sus pendientes se cierran solos.
    if (!activos.has(pacienteId)) {
      situaciones.set(pacienteId, { pacienteId, tieneTurnoFuturo: false });
      continue;
    }
    const proximo = futuros.find((t) => t.pacienteId === pacienteId);
    const visita = visitas.find((v) => v.pacienteId === pacienteId);
    const ind = indicaciones.find((i) => i.indicacion.pacienteId === pacienteId);
    const ausencia = ausencias.find((a) => a.pacienteId === pacienteId);
    const plan = planes.filter((p) => p.pacienteId === pacienteId);
    const primerPlan = plan[0];
    const desdePlan = primerPlan && (visita && visita.inicio > primerPlan.creadoEn ? visita.inicio : primerPlan.creadoEn);

    situaciones.set(pacienteId, {
      pacienteId,
      tieneTurnoFuturo: Boolean(proximo),
      proximoTurno: proximo ? { turnoId: proximo.id, inicio: proximo.inicio } : null,
      ultimaVisita: visita ? { turnoId: visita.id, inicio: visita.inicio } : null,
      indicacion: ind
        ? {
            id: ind.indicacion.id,
            plazo: ind.indicacion.plazo,
            importante: ind.indicacion.importante,
            fechaVisita: ind.indicacion.fechaVisita,
            referencia: ind.inicioTurno ?? ind.indicacion.creadoEn,
            turnoId: ind.indicacion.turnoId,
            profesionalId: ind.indicacion.indicadaPor,
            profesional: `${ind.profesionalNombre} ${ind.profesionalApellido}`,
          }
        : null,
      ausencia: ausencia ? { turnoId: ausencia.id, inicio: ausencia.inicio, profesionalId: ausencia.profesionalId } : null,
      tratamientoEnCurso:
        primerPlan && desdePlan
          ? {
              desde: desdePlan,
              descripcion: plan
                .slice(0, 2)
                .map((p) => (p.pieza ? `${p.descripcion} ${p.pieza}` : p.descripcion))
                .join(', ')
                .concat(plan.length > 2 ? ` y ${plan.length - 2} más` : ''),
              profesionalId: visita?.profesionalId ?? primerPlan.profesionalId,
              turnoId: visita?.id ?? null,
            }
          : null,
      presupuestosSinRespuesta: sinRespuesta.filter((p) => p.pacienteId === pacienteId && p.entregadoEn).map((p) => ({ id: p.id, entregadoEn: p.entregadoEn! })),
    });
  }
  return situaciones;
}

// ---------------------------------------------------------------------------
// Recálculo (idempotente)
// ---------------------------------------------------------------------------

export interface ResultadoRecalculo {
  creados: number;
  resueltos: number;
  reabiertos: number;
}

async function agregarAccion(
  db: Pick<BaseDeDatos, 'insert'>,
  accion: {
    pendienteId: string;
    tipo: TipoAccionPendiente;
    usuarioId: string | null;
    origen: OrigenAccion;
    resultado?: string | null;
    canal?: CanalContacto | null;
    respuesta?: RespuestaContacto | null;
    contactarDesde?: string | null;
    contactarDesdeMotivo?: string | null;
    ocurridoEn?: Date;
  },
) {
  await db.insert(pendienteAcciones).values({ ...accion, ocurridoEn: accion.ocurridoEn ?? new Date() });
}

/**
 * Recalcula los pendientes (de todos los pacientes o de algunos). Es interna:
 * la llaman el tablero y las operaciones de agenda, que ya chequearon permisos.
 */
export async function sincronizarPendientes(
  db: BaseDeDatos,
  opciones: { pacienteIds?: readonly string[]; ahora?: Date; usuarioId?: string | null } = {},
): Promise<ResultadoRecalculo> {
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnArgentina(ahora);
  const usuarioId = opciones.usuarioId ?? null;
  const ids = opciones.pacienteIds ? [...new Set(opciones.pacienteIds)] : undefined;
  const resultado: ResultadoRecalculo = { creados: 0, resueltos: 0, reabiertos: 0 };
  if (ids && ids.length === 0) return resultado;

  // Las filas se leen sin bloquear (el candado solo ordena los recálculos entre sí), así que
  // cada UPDATE vuelve a exigir el estado que se leyó: una persona puede cerrar un pendiente
  // a mano en el medio, y PostgreSQL reevalúa el WHERE después de esperar su fila.
  const sigueActivo = inArray(pendientes.estado, [...ESTADOS_ACTIVOS]);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CANDADO_RECALCULO})`);
    const abiertos = await tx
      .select()
      .from(pendientes)
      .where(and(inArray(pendientes.estado, [...ESTADOS_ACTIVOS]), ne(pendientes.tipo, 'manual'), ids ? inArray(pendientes.pacienteId, ids) : undefined));
    const situaciones = await cargarSituaciones(
      tx,
      ahora,
      ids,
      abiertos.map((p) => p.pacienteId),
    );
    const candidatos = [...situaciones.values()].flatMap((s) => evaluarPendientes(s, ahora));
    const claves = new Set(candidatos.map((c) => c.clave));
    const existentes = claves.size ? await tx.select().from(pendientes).where(inArray(pendientes.clave, [...claves])) : [];
    const existentePorClave = new Map(existentes.map((e) => [e.clave, e]));

    for (const caso of candidatos) {
      const fila = existentePorClave.get(caso.clave);
      const vigente = ahora.getTime() >= caso.apareceDesde.getTime();
      if (!fila) {
        if (!vigente) continue;
        const [creado] = await tx
          .insert(pendientes)
          .values(valoresDeCaso(caso))
          .onConflictDoNothing({ target: pendientes.clave })
          .returning({ id: pendientes.id });
        if (!creado) continue;
        await agregarAccion(tx, { pendienteId: creado.id, tipo: 'creado', usuarioId, origen: 'sistema', resultado: caso.detalle, ocurridoEn: ahora });
        resultado.creados++;
      } else if (estaActivo(fila.estado)) {
        const cambios = {
          detalle: caso.detalle,
          prioridad: caso.prioridad,
          importante: caso.importante,
          profesionalId: caso.profesionalId,
          indicacionId: caso.indicacionId,
          venceEn: caso.fechaEsperada ? rangoDelDia(caso.fechaEsperada).desde : null,
        };
        const iguales =
          fila.detalle === cambios.detalle &&
          fila.prioridad === cambios.prioridad &&
          fila.importante === cambios.importante &&
          fila.profesionalId === cambios.profesionalId &&
          fila.indicacionId === cambios.indicacionId &&
          (fila.venceEn?.getTime() ?? null) === (cambios.venceEn?.getTime() ?? null);
        // Solo si sigue activo: alguien lo pudo haber cerrado mientras tanto.
        if (!iguales) await tx.update(pendientes).set(cambios).where(and(eq(pendientes.id, fila.id), sigueActivo));
      } else if (fila.estado === 'resuelto' && !fila.cerradoPor && vigente) {
        // Se había resuelto solo (sacó turno) y el turno ya no está: vuelve a la bandeja.
        const [reabierto] = await tx
          .update(pendientes)
          .set({
            estado: fila.responsableId ? 'en_curso' : 'abierto',
            resueltoEn: null,
            motivoCierre: null,
            resueltoPorTurnoId: null,
            contactarDesde: hoy,
            contactarDesdeMotivo: null,
            contactarDesdeOrigen: 'sistema',
            detalle: caso.detalle,
          })
          .where(and(eq(pendientes.id, fila.id), eq(pendientes.estado, 'resuelto'), isNull(pendientes.cerradoPor)))
          .returning({ id: pendientes.id });
        if (!reabierto) continue;
        await agregarAccion(tx, { pendienteId: fila.id, tipo: 'reabierto', usuarioId, origen: 'sistema', resultado: 'Ya no tiene turno: vuelve a la bandeja.', ocurridoEn: ahora });
        resultado.reabiertos++;
      }
    }

    for (const fila of abiertos) {
      if (fila.clave && claves.has(fila.clave)) continue;
      const situacion = situaciones.get(fila.pacienteId) ?? { pacienteId: fila.pacienteId, tieneTurnoFuturo: false };
      const motivo = motivoDeCierreAutomatico(fila.tipo, situacion, fila.desde);
      const porTurno = situacion.tieneTurnoFuturo && fila.tipo !== 'presupuesto_sin_respuesta' && fila.tipo !== 'conversacion_sin_respuesta';
      // Solo si sigue activo: si alguien lo resolvió o descartó a mano mientras se recalculaba
      // (con la fila bloqueada), su cierre queda como está.
      const [resuelto] = await tx
        .update(pendientes)
        .set({ estado: 'resuelto', resueltoEn: ahora, cerradoPor: null, motivoCierre: motivo, resueltoPorTurnoId: porTurno ? (situacion.proximoTurno?.turnoId ?? null) : null })
        .where(and(eq(pendientes.id, fila.id), sigueActivo))
        .returning({ id: pendientes.id });
      if (!resuelto) continue;
      await agregarAccion(tx, { pendienteId: fila.id, tipo: 'resuelto', usuarioId, origen: 'sistema', resultado: `Se resolvió solo: ${motivo}`, ocurridoEn: ahora });
      resultado.resueltos++;
    }
    return resultado;
  });
}

function valoresDeCaso(caso: Pendiente): typeof pendientes.$inferInsert {
  return {
    pacienteId: caso.pacienteId,
    tipo: caso.tipo,
    prioridad: caso.prioridad,
    importante: caso.importante,
    clave: caso.clave,
    detalle: caso.detalle,
    desde: caso.desde,
    venceEn: caso.fechaEsperada ? rangoDelDia(caso.fechaEsperada).desde : null,
    contactarDesde: caso.contactarDesde,
    contactarDesdeOrigen: 'sistema',
    profesionalId: caso.profesionalId,
    turnoId: caso.turnoId,
    indicacionId: caso.indicacionId,
  };
}

/** Recálculo pedido por una persona (al abrir el tablero). */
export async function recalcularPendientes(db: BaseDeDatos, usuario: UsuarioConRoles, opciones: { pacienteIds?: readonly string[]; ahora?: Date } = {}): Promise<ResultadoRecalculo> {
  exigirPermiso(usuario);
  return sincronizarPendientes(db, { ...opciones, usuarioId: usuario.id });
}

/**
 * Para la agenda: recalcula sin interrumpir la operación si algo falla (el
 * turno ya quedó guardado y el tablero vuelve a recalcular al abrirse).
 */
export async function sincronizarSinInterrumpir(db: BaseDeDatos, pacienteId: string, usuarioId: string): Promise<void> {
  try {
    await sincronizarPendientes(db, { pacienteIds: [pacienteId], usuarioId });
  } catch (error) {
    console.error('No se pudieron recalcular los pendientes del paciente', pacienteId, error);
  }
}

// ---------------------------------------------------------------------------
// "¿Cuándo debería volver?"
// ---------------------------------------------------------------------------

const esquemaIndicacion = z.object({
  pacienteId: z.uuid('Falta el paciente'),
  turnoId: z.preprocess(vacioANull, z.uuid().nullable().default(null)),
  plazo: z.enum(PLAZOS_REGRESO, 'Elegí cuándo debería volver'),
  importante: z.boolean().default(false),
  profesionalId: z.preprocess(vacioANull, z.uuid('Elegí qué profesional lo indicó').nullable().default(null)),
});

export type EntradaIndicacion = z.input<typeof esquemaIndicacion>;

export type ResultadoIndicacion = { ok: true; indicacionId: string } | { ok: false; errores: string[] };

/**
 * Carga "¿Cuándo debería volver?". Lo puede hacer la profesional o la
 * secretaria; queda quién lo cargó, cuándo y qué profesional lo indicó. Si va
 * con un turno, tiene que ser un turno atendido del mismo paciente.
 */
export async function registrarIndicacionRegreso(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  entrada: EntradaIndicacion,
  opciones: { ahora?: Date } = {},
): Promise<ResultadoIndicacion> {
  exigirPermiso(usuario);
  const validacion = esquemaIndicacion.safeParse(entrada);
  if (!validacion.success) return { ok: false, errores: mensajes(validacion.error) };
  const datos = validacion.data;
  const ahora = opciones.ahora ?? new Date();

  let fechaVisita = hoyEnArgentina(ahora);
  let profesionalId = datos.profesionalId;
  if (datos.turnoId) {
    const [turno] = await db.select().from(turnos).where(eq(turnos.id, datos.turnoId));
    if (!turno || turno.pacienteId !== datos.pacienteId) return { ok: false, errores: ['El turno no es de este paciente.'] };
    if (turno.estado !== 'atendido') return { ok: false, errores: ['Primero marcá el turno como atendido.'] };
    fechaVisita = fechaDe(turno.inicio);
    profesionalId ??= turno.profesionalId;
  }
  // Si lo carga una profesional sin decir quién, lo indicó ella.
  if (!profesionalId && usuario.roles.includes('profesional')) profesionalId = usuario.id;
  if (!profesionalId) return { ok: false, errores: ['Elegí qué profesional lo indicó.'] };

  const [[profesional], [paciente]] = await Promise.all([
    db.select({ id: profesionales.usuarioId }).from(profesionales).where(eq(profesionales.usuarioId, profesionalId)),
    db.select({ activo: pacientes.activo }).from(pacientes).where(eq(pacientes.id, datos.pacienteId)),
  ]);
  if (!profesional) return { ok: false, errores: ['El profesional no existe.'] };
  if (!paciente?.activo) return { ok: false, errores: ['El paciente no existe o está dado de baja.'] };

  const indicacionId = await db.transaction(async (tx) => {
    const [creada] = await tx
      .insert(indicacionesRegreso)
      .values({
        pacienteId: datos.pacienteId,
        turnoId: datos.turnoId,
        plazo: datos.plazo,
        importante: datos.importante,
        fechaVisita,
        fechaEsperada: fechaEsperadaDeRegreso(fechaVisita, datos.plazo),
        indicadaPor: profesionalId,
        cargadaPor: usuario.id,
        creadoEn: ahora,
      })
      .returning({ id: indicacionesRegreso.id });
    if (!creada) throw new Error('No se pudo guardar la indicación.');
    await auditar(tx, usuario.id, 'seguimiento.indicar_regreso', 'indicacion_regreso', creada.id, datos.pacienteId, {
      plazo: datos.plazo,
      importante: datos.importante,
      turnoId: datos.turnoId,
      indicadaPor: profesionalId,
    });
    return creada.id;
  });
  await sincronizarPendientes(db, { pacienteIds: [datos.pacienteId], ahora, usuarioId: usuario.id });
  return { ok: true, indicacionId };
}

export interface IndicacionResumen {
  id: string;
  turnoId: string | null;
  plazo: PlazoRegreso;
  importante: boolean;
  fechaVisita: string;
  fechaEsperada: string | null;
  indicadaPor: string;
  cargadaPor: string;
  creadoEn: Date;
}

async function leerIndicaciones(db: Consultas, filtro: SQL): Promise<IndicacionResumen[]> {
  const indicador = sql<string>`(select nombre || ' ' || apellido from usuarios where id = ${indicacionesRegreso.indicadaPor})`;
  const cargador = sql<string>`(select nombre || ' ' || apellido from usuarios where id = ${indicacionesRegreso.cargadaPor})`;
  return db
    .select({
      id: indicacionesRegreso.id,
      turnoId: indicacionesRegreso.turnoId,
      plazo: indicacionesRegreso.plazo,
      importante: indicacionesRegreso.importante,
      fechaVisita: indicacionesRegreso.fechaVisita,
      fechaEsperada: indicacionesRegreso.fechaEsperada,
      indicadaPor: indicador,
      cargadaPor: cargador,
      creadoEn: indicacionesRegreso.creadoEn,
    })
    .from(indicacionesRegreso)
    .where(filtro)
    .orderBy(desc(indicacionesRegreso.fechaVisita), desc(indicacionesRegreso.creadoEn));
}

/** La última indicación de cada turno, para mostrarla en la agenda. */
export async function indicacionesDeTurnos(db: BaseDeDatos, usuario: UsuarioConRoles, turnoIds: readonly string[]): Promise<Map<string, IndicacionResumen>> {
  if (!puede(usuario, 'turnos.ver')) throw new ErrorDePermiso('No tenés acceso a la agenda.');
  if (!turnoIds.length) return new Map();
  const filas = await leerIndicaciones(db, inArray(indicacionesRegreso.turnoId, [...turnoIds]));
  const porTurno = new Map<string, IndicacionResumen>();
  for (const fila of filas) if (fila.turnoId && !porTurno.has(fila.turnoId)) porTurno.set(fila.turnoId, fila);
  return porTurno;
}

/** Para la ficha: la indicación vigente, las anteriores y cuándo aparecería el próximo pendiente. */
export async function regresoDePaciente(db: BaseDeDatos, usuario: UsuarioConRoles, pacienteId: string, opciones: { ahora?: Date } = {}) {
  if (!puede(usuario, 'paciente.ver_ficha')) throw new ErrorDePermiso('No tenés acceso a los pacientes.');
  const ahora = opciones.ahora ?? new Date();
  const [indicaciones, [ultimaVisita], situaciones] = await Promise.all([
    leerIndicaciones(db, eq(indicacionesRegreso.pacienteId, pacienteId)),
    db
      .select({ id: turnos.id, inicio: turnos.inicio, profesionalId: turnos.profesionalId, nombre: usuarios.nombre, apellido: usuarios.apellido })
      .from(turnos)
      .innerJoin(usuarios, eq(usuarios.id, turnos.profesionalId))
      .where(and(eq(turnos.pacienteId, pacienteId), eq(turnos.estado, 'atendido')))
      .orderBy(desc(turnos.inicio))
      .limit(1),
    cargarSituaciones(db, ahora, [pacienteId]),
  ]);
  const situacion = situaciones.get(pacienteId);
  const ultima = indicaciones[0] && situacion?.indicacion?.id === indicaciones[0].id ? indicaciones[0] : null;
  // Si volvió a atenderse después, esa indicación ya se cumplió.
  const cumplida = Boolean(situacion?.ultimaVisita && situacion.indicacion && situacion.ultimaVisita.inicio > situacion.indicacion.referencia);
  const vigente = ultima && !cumplida ? ultima : null;
  const proximo = situacion ? proximoPendiente(situacion, ahora) : null;
  return {
    vigente,
    anteriores: indicaciones.filter((i) => i !== vigente),
    ultimaVisita: ultimaVisita ? { turnoId: ultimaVisita.id, inicio: ultimaVisita.inicio, profesionalId: ultimaVisita.profesionalId, profesional: nombreCompleto(ultimaVisita) } : null,
    proximoTurno: situacion?.proximoTurno ?? null,
    proximoAviso: proximo ? { contactarDesde: proximo.contactarDesde, detalle: proximo.detalle } : null,
    puedeIndicar: puede(usuario, 'seguimientos.gestionar'),
  };
}

export type RegresoDePaciente = Awaited<ReturnType<typeof regresoDePaciente>>;

// ---------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------

export interface AccionDePendiente {
  id: string;
  pendienteId: string;
  tipo: TipoAccionPendiente;
  origen: OrigenAccion;
  usuario: string | null;
  canal: CanalContacto | null;
  respuesta: RespuestaContacto | null;
  resultado: string | null;
  contactarDesde: string | null;
  contactarDesdeMotivo: string | null;
  ocurridoEn: Date;
}

export interface PendienteTablero {
  id: string;
  tipo: TipoPendiente;
  estado: EstadoPendiente;
  prioridad: Prioridad;
  importante: boolean;
  detalle: string;
  desde: Date;
  fechaEsperada: string | null;
  contactarDesde: string;
  contactarDesdeMotivo: string | null;
  responsable: { id: string; nombre: string } | null;
  profesional: { id: string; nombre: string } | null;
  escaladoA: { id: string; nombre: string } | null;
  escaladoAId: string | null;
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    documento: string;
    edad: number;
    fotoKey: string | null;
    telefono: string | null;
    aceptaMensajes: boolean;
    homonimos: number;
  };
  intentos: number;
  intentosSinRespuesta: number;
  ultimoContacto: AccionDePendiente | null;
  ultimoMovimiento: string;
  diasSinContacto: number;
  diasPendiente: number;
  /** Le llegó a quien mira: no responde y era importante. */
  paraMi: boolean;
}

export const FILTROS_VER = ['todos', 'mios'] as const;
export type FiltroVer = (typeof FILTROS_VER)[number];

async function leerAcciones(db: Consultas, pendienteIds: readonly string[]): Promise<AccionDePendiente[]> {
  if (!pendienteIds.length) return [];
  const filas = await db
    .select({ accion: pendienteAcciones, nombre: usuarios.nombre, apellido: usuarios.apellido })
    .from(pendienteAcciones)
    .leftJoin(usuarios, eq(usuarios.id, pendienteAcciones.usuarioId))
    .where(inArray(pendienteAcciones.pendienteId, [...pendienteIds]))
    .orderBy(asc(pendienteAcciones.ocurridoEn), asc(pendienteAcciones.id));
  return filas.map(({ accion, nombre, apellido }) => ({
    id: accion.id,
    pendienteId: accion.pendienteId,
    tipo: accion.tipo,
    origen: accion.origen,
    // Las acciones del sistema no las firma una persona, aunque se sepa quién provocó el recálculo.
    usuario: accion.origen === 'usuario' && nombre ? `${nombre} ${apellido}` : null,
    canal: accion.canal,
    respuesta: accion.respuesta,
    resultado: accion.resultado,
    contactarDesde: accion.contactarDesde,
    contactarDesdeMotivo: accion.contactarDesdeMotivo,
    ocurridoEn: accion.ocurridoEn,
  }));
}

async function armarTablero(db: Consultas, usuario: UsuarioConRoles, filas: (typeof pendientes.$inferSelect)[], hoy: string): Promise<PendienteTablero[]> {
  if (!filas.length) return [];
  const pacienteIds = [...new Set(filas.map((f) => f.pacienteId))];
  const [listaPacientes, listaUsuarios, acciones] = await Promise.all([
    db.select().from(pacientes).where(inArray(pacientes.id, pacienteIds)),
    db.select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido }).from(usuarios),
    leerAcciones(
      db,
      filas.map((f) => f.id),
    ),
  ]);
  const homonimos = await contarHomonimos(
    db,
    listaPacientes.map((p) => p.nombreNormalizado ?? ''),
  );
  const persona = (id: string | null) => {
    const encontrado = id ? listaUsuarios.find((u) => u.id === id) : undefined;
    return encontrado ? { id: encontrado.id, nombre: nombreCompleto(encontrado) } : null;
  };

  return filas.flatMap((fila) => {
    const paciente = listaPacientes.find((p) => p.id === fila.pacienteId);
    if (!paciente) return [];
    const propias = acciones.filter((a) => a.pendienteId === fila.id);
    const contactos = propias.filter((a) => a.tipo === 'contacto');
    const ultimoContacto = contactos.at(-1) ?? null;
    const ultimoMovimiento = ultimoContacto ? fechaDe(ultimoContacto.ocurridoEn) : fechaDe(fila.desde) > hoy ? hoy : fechaDe(fila.desde);
    const item: PendienteTablero = {
      id: fila.id,
      tipo: fila.tipo,
      estado: fila.estado,
      prioridad: fila.prioridad,
      importante: fila.importante,
      detalle: fila.detalle,
      desde: fila.desde,
      fechaEsperada: fila.venceEn ? fechaDe(fila.venceEn) : null,
      contactarDesde: fila.contactarDesde,
      contactarDesdeMotivo: fila.contactarDesdeMotivo,
      responsable: persona(fila.responsableId),
      profesional: persona(fila.profesionalId),
      escaladoA: persona(fila.escaladoA),
      escaladoAId: fila.escaladoA,
      paciente: {
        id: paciente.id,
        nombre: paciente.nombre,
        apellido: paciente.apellido,
        documento: `${paciente.tipoDocumento} ${paciente.numeroDocumento}`,
        edad: edad(paciente.fechaNacimiento, hoy),
        fotoKey: paciente.fotoKey,
        telefono: paciente.telefono,
        aceptaMensajes: paciente.aceptaMensajes,
        homonimos: homonimos.get(paciente.nombreNormalizado ?? '') ?? 0,
      },
      intentos: contactos.length,
      intentosSinRespuesta: intentosSinRespuesta(propias),
      ultimoContacto,
      ultimoMovimiento,
      diasSinContacto: 0,
      diasPendiente: Math.max(0, diasSinContacto({ ultimoMovimiento: fechaDe(fila.desde) }, hoy)),
      paraMi: false,
    };
    item.diasSinContacto = diasSinContacto(item, hoy);
    item.paraMi = esParaUsuario(item, usuario.id);
    return [item];
  });
}

export interface Tablero {
  paraHoy: PendienteTablero[];
  masAdelante: PendienteTablero[];
  /** Cuántos hay de cada motivo (para los filtros), sin contar el filtro de motivo. */
  porTipo: Record<TipoPendiente, number>;
  total: number;
}

/** La bandeja común: pendientes abiertos, en curso o que no responden. */
export async function listarPendientes(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  filtros: { ver?: FiltroVer; tipo?: TipoPendiente | null; pacienteId?: string | null } = {},
  opciones: { ahora?: Date } = {},
): Promise<Tablero> {
  exigirPermiso(usuario);
  const hoy = hoyEnArgentina(opciones.ahora);
  const mios = filtros.ver === 'mios' ? or(eq(pendientes.responsableId, usuario.id), and(eq(pendientes.escaladoA, usuario.id), eq(pendientes.estado, 'no_responde'))) : undefined;
  const filas = await db
    .select()
    .from(pendientes)
    .where(and(inArray(pendientes.estado, [...ESTADOS_ACTIVOS]), mios, filtros.pacienteId ? eq(pendientes.pacienteId, filtros.pacienteId) : undefined));

  const porTipo = Object.fromEntries(TIPOS_PENDIENTE.map((t) => [t, 0])) as Record<TipoPendiente, number>;
  for (const fila of filas) porTipo[fila.tipo]++;
  const elegidas = filtros.tipo ? filas.filter((f) => f.tipo === filtros.tipo) : filas;
  const items = ordenarPendientes(await armarTablero(db, usuario, elegidas, hoy), usuario.id);
  return {
    paraHoy: items.filter((p) => p.contactarDesde <= hoy),
    masAdelante: items.filter((p) => p.contactarDesde > hoy).toSorted((a, b) => a.contactarDesde.localeCompare(b.contactarDesde)),
    porTipo,
    total: filas.length,
  };
}

/** Para el contador de la navegación. */
export async function contarPendientesParaHoy(db: BaseDeDatos, usuario: UsuarioConRoles, ahora?: Date): Promise<number> {
  if (!puede(usuario, 'seguimientos.gestionar')) return 0;
  const [fila] = await db
    .select({ cantidad: sql<number>`count(*)::int` })
    .from(pendientes)
    .where(and(inArray(pendientes.estado, [...ESTADOS_ACTIVOS]), lte(pendientes.contactarDesde, hoyEnArgentina(ahora))));
  return fila?.cantidad ?? 0;
}

/** Para la ficha: sus pendientes abiertos y el historial de contactos. */
export async function pendientesDePaciente(db: BaseDeDatos, usuario: UsuarioConRoles, pacienteId: string, opciones: { ahora?: Date } = {}) {
  exigirPermiso(usuario);
  const hoy = hoyEnArgentina(opciones.ahora);
  const filas = await db.select().from(pendientes).where(eq(pendientes.pacienteId, pacienteId)).orderBy(desc(pendientes.creadoEn));
  const [abiertos, acciones] = await Promise.all([
    armarTablero(
      db,
      usuario,
      filas.filter((f) => estaActivo(f.estado)),
      hoy,
    ),
    leerAcciones(
      db,
      filas.map((f) => f.id),
    ),
  ]);
  const tipoDe = new Map(filas.map((f) => [f.id, f.tipo]));
  return {
    abiertos: ordenarPendientes(abiertos, usuario.id),
    historial: acciones.map((a) => ({ ...a, tipoPendiente: tipoDe.get(a.pendienteId) ?? ('manual' as const) })).reverse(),
    cerrados: filas
      .filter((f) => !estaActivo(f.estado))
      .map((f) => ({ id: f.id, tipo: f.tipo, estado: f.estado, detalle: f.detalle, motivoCierre: f.motivoCierre, resueltoEn: f.resueltoEn })),
  };
}

// ---------------------------------------------------------------------------
// Acciones sobre un pendiente
// ---------------------------------------------------------------------------

export type ResultadoAccion = { ok: true; estado: EstadoPendiente; avisoProfesional?: string | null } | { ok: false; errores: string[] };

async function pendienteParaModificar(tx: Transaccion, pendienteId: string) {
  if (!z.uuid().safeParse(pendienteId).success) return null;
  const [fila] = await tx.select().from(pendientes).where(eq(pendientes.id, pendienteId)).for('update');
  return fila ?? null;
}

const CERRADO = 'Este pendiente ya está cerrado.';

/** "Tomar": quien lo toma queda como responsable. Se puede tomar uno que tenía otra persona. */
export async function tomarPendiente(db: BaseDeDatos, usuario: UsuarioConRoles, pendienteId: string, opciones: { ahora?: Date } = {}): Promise<ResultadoAccion> {
  exigirPermiso(usuario);
  const ahora = opciones.ahora ?? new Date();
  return db.transaction(async (tx) => {
    const fila = await pendienteParaModificar(tx, pendienteId);
    if (!fila) return { ok: false, errores: ['El pendiente no existe.'] };
    if (!estaActivo(fila.estado)) return { ok: false, errores: [CERRADO] };
    if (fila.responsableId === usuario.id) return { ok: true, estado: fila.estado };
    const estado: EstadoPendiente = fila.estado === 'abierto' ? 'en_curso' : fila.estado;
    await tx.update(pendientes).set({ responsableId: usuario.id, tomadoEn: ahora, estado }).where(eq(pendientes.id, fila.id));
    const anterior = fila.responsableId ? (await tx.select().from(usuarios).where(eq(usuarios.id, fila.responsableId)))[0] : undefined;
    await agregarAccion(tx, { pendienteId: fila.id, tipo: 'tomado', usuarioId: usuario.id, origen: 'usuario', resultado: anterior ? `Lo tenía ${nombreCompleto(anterior)}.` : null, ocurridoEn: ahora });
    await auditar(tx, usuario.id, 'pendiente.tomar', 'pendiente', fila.id, fila.pacienteId);
    return { ok: true, estado };
  });
}

const esquemaContacto = z.object({
  canal: z.enum(CANALES_CONTACTO, 'Elegí por dónde lo contactaste'),
  respuesta: z.enum(RESPUESTAS_CONTACTO, 'Elegí qué pasó'),
  resultado: z.preprocess(vacioANull, z.string().trim().max(500, 'La nota es muy larga (máximo 500 caracteres).').nullable().default(null)),
  contactarDesde: z.preprocess(vacioANull, z.string().nullable().default(null)),
  contactarDesdeMotivo: z.preprocess(vacioANull, z.string().trim().max(200, 'El motivo es muy largo (máximo 200 caracteres).').nullable().default(null)),
});

export type EntradaContacto = z.input<typeof esquemaContacto>;

/**
 * Registra un contacto (canal y respuesta). Si no tenía responsable, lo toma
 * quien contactó. Al tercer intento sin respuesta pasa a "No responde" y, si
 * era importante, le llega a la profesional. "Volver a contactar el…" corre la
 * fecha sugerida y guarda el motivo.
 */
export async function registrarContacto(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  pendienteId: string,
  entrada: EntradaContacto,
  opciones: { ahora?: Date } = {},
): Promise<ResultadoAccion> {
  exigirPermiso(usuario);
  const validacion = esquemaContacto.safeParse(entrada);
  if (!validacion.success) return { ok: false, errores: mensajes(validacion.error) };
  const datos = validacion.data;
  const ahora = opciones.ahora ?? new Date();
  const hoy = hoyEnArgentina(ahora);
  if (datos.contactarDesde) {
    const error = validarFechaDeContacto(datos.contactarDesde, hoy);
    if (error) return { ok: false, errores: [error] };
  }

  return db.transaction(async (tx) => {
    const fila = await pendienteParaModificar(tx, pendienteId);
    if (!fila) return { ok: false, errores: ['El pendiente no existe.'] };
    if (!estaActivo(fila.estado)) return { ok: false, errores: [CERRADO] };

    const previas = await tx
      .select({ tipo: pendienteAcciones.tipo, respuesta: pendienteAcciones.respuesta })
      .from(pendienteAcciones)
      .where(eq(pendienteAcciones.pendienteId, fila.id))
      .orderBy(asc(pendienteAcciones.ocurridoEn), asc(pendienteAcciones.id));
    const tras = estadoTrasContacto({ estado: fila.estado, intentosSinRespuesta: intentosSinRespuesta(previas) }, datos.respuesta);
    const avisar = hayQueAvisarAProfesional(tras, fila);
    const motivoFecha = datos.contactarDesde ? (datos.contactarDesdeMotivo ?? datos.resultado ?? NOMBRE_RESPUESTA[datos.respuesta]) : null;

    await agregarAccion(tx, {
      pendienteId: fila.id,
      tipo: 'contacto',
      usuarioId: usuario.id,
      origen: 'usuario',
      canal: datos.canal,
      respuesta: datos.respuesta,
      resultado: datos.resultado,
      contactarDesde: datos.contactarDesde,
      contactarDesdeMotivo: motivoFecha,
      ocurridoEn: ahora,
    });

    let avisoProfesional: string | null = null;
    if (tras.pasaANoResponde) {
      const profesional = avisar && fila.profesionalId ? (await tx.select().from(usuarios).where(eq(usuarios.id, fila.profesionalId)))[0] : undefined;
      avisoProfesional = profesional ? nombreCompleto(profesional) : null;
      await agregarAccion(tx, {
        pendienteId: fila.id,
        tipo: 'no_responde',
        usuarioId: usuario.id,
        origen: 'sistema',
        resultado: `${INTENTOS_HASTA_NO_RESPONDE} intentos sin respuesta.${avisoProfesional ? ` Era importante: le llegó a ${avisoProfesional}.` : ''}`,
        ocurridoEn: ahora,
      });
    }

    await tx
      .update(pendientes)
      .set({
        estado: tras.estado,
        ...(fila.responsableId ? {} : { responsableId: usuario.id, tomadoEn: ahora }),
        ...(datos.contactarDesde ? { contactarDesde: datos.contactarDesde, contactarDesdeMotivo: motivoFecha, contactarDesdeOrigen: 'usuario' as const } : {}),
        ...(avisar && fila.profesionalId ? { escaladoA: fila.profesionalId, escaladoEn: ahora } : {}),
      })
      .where(eq(pendientes.id, fila.id));
    await auditar(tx, usuario.id, 'pendiente.contacto', 'pendiente', fila.id, fila.pacienteId, {
      canal: datos.canal,
      respuesta: datos.respuesta,
      contactarDesde: datos.contactarDesde,
      estado: tras.estado,
    });
    return { ok: true, estado: tras.estado, avisoProfesional };
  });
}

async function cerrar(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  pendienteId: string,
  como: 'resuelto' | 'descartado',
  motivo: string,
  ahora: Date,
): Promise<ResultadoAccion> {
  return db.transaction(async (tx) => {
    const fila = await pendienteParaModificar(tx, pendienteId);
    if (!fila) return { ok: false, errores: ['El pendiente no existe.'] };
    if (!estaActivo(fila.estado)) return { ok: false, errores: [CERRADO] };
    await tx.update(pendientes).set({ estado: como, resueltoEn: ahora, cerradoPor: usuario.id, motivoCierre: motivo }).where(eq(pendientes.id, fila.id));
    await agregarAccion(tx, { pendienteId: fila.id, tipo: como, usuarioId: usuario.id, origen: 'usuario', resultado: motivo, ocurridoEn: ahora });
    await auditar(tx, usuario.id, como === 'resuelto' ? 'pendiente.resolver' : 'pendiente.descartar', 'pendiente', fila.id, fila.pacienteId, { motivo });
    return { ok: true, estado: como };
  });
}

/** Marcar resuelto a mano (por ejemplo, "ya vino" o "se atiende en otro lado y avisó"). */
export async function resolverPendiente(db: BaseDeDatos, usuario: UsuarioConRoles, pendienteId: string, nota?: string | null, opciones: { ahora?: Date } = {}): Promise<ResultadoAccion> {
  exigirPermiso(usuario);
  const limpio = nota?.trim() ?? '';
  if (limpio.length > 300) return { ok: false, errores: ['La nota es muy larga (máximo 300 caracteres).'] };
  return cerrar(db, usuario, pendienteId, 'resuelto', limpio || 'Marcado como resuelto.', opciones.ahora ?? new Date());
}

/** Descartar siempre lleva motivo: queda en el historial. */
export async function descartarPendiente(db: BaseDeDatos, usuario: UsuarioConRoles, pendienteId: string, motivo: string, opciones: { ahora?: Date } = {}): Promise<ResultadoAccion> {
  exigirPermiso(usuario);
  const limpio = motivo.trim();
  if (limpio.length < 3) return { ok: false, errores: ['Escribí por qué se descarta.'] };
  if (limpio.length > 300) return { ok: false, errores: ['El motivo es muy largo (máximo 300 caracteres).'] };
  return cerrar(db, usuario, pendienteId, 'descartado', limpio, opciones.ahora ?? new Date());
}
