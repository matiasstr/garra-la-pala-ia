import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { alertasMedicas, pacientes, profesionales, sillones, turnoEventos, turnos, usuarios } from '../db/schema';
import type { BaseDeDatos } from '../db/tipos';
import { puedeCambiarEstado, type EstadoTurno } from '../domain/agenda/turnos';
import { edad } from '../domain/pacientes/identificacion';
import { puede, type UsuarioConRoles } from '../domain/permisos/permisos';
import { esFechaValida, esHoraValida, fechaHoraArgentina, hoyEnArgentina, rangoDelDia } from '../lib/fechas';
import { ErrorDePermiso } from './errores';
import { contarHomonimos } from './pacientes';
import { sincronizarSinInterrumpir } from './pendientes';

/** Estados que ocupan el horario del profesional y del sillón. */
const ESTADOS_ACTIVOS: EstadoTurno[] = ['reservado', 'confirmado', 'en_sala', 'atendido'];

export const DURACIONES_MINUTOS = [15, 30, 45, 60, 90, 120] as const;

const esquemaTurno = z.object({
  pacienteId: z.uuid('Elegí un paciente'),
  profesionalId: z.uuid('Elegí un profesional'),
  sillonId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable().default(null)),
  fecha: z.string().refine(esFechaValida, 'La fecha no es válida'),
  hora: z.string().refine(esHoraValida, 'La hora no es válida'),
  duracionMinutos: z.coerce.number().int().min(10, 'Duración mínima: 10 minutos').max(240, 'Duración máxima: 4 horas'),
  motivo: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(200).nullable().default(null)),
});

export type EntradaTurno = z.input<typeof esquemaTurno>;

type Transaccion = Parameters<Parameters<BaseDeDatos['transaction']>[0]>[0];

async function registrarEvento(tx: Pick<BaseDeDatos, 'insert'>, turnoId: string, usuarioId: string, anterior: EstadoTurno | null, nuevo: EstadoTurno, nota?: string | null) {
  await tx.insert(turnoEventos).values({ turnoId, usuarioId, estadoAnterior: anterior, estadoNuevo: nuevo, nota: nota ?? null });
}

/** Turnos que se superponen con el horario pedido, para el profesional o para el sillón. */
async function superposiciones(tx: Transaccion, datos: { profesionalId: string; sillonId: string | null; inicio: Date; fin: Date; excluir?: string }) {
  const encontrados = await tx
    .select({ id: turnos.id, profesionalId: turnos.profesionalId, sillonId: turnos.sillonId })
    .from(turnos)
    .where(and(inArray(turnos.estado, ESTADOS_ACTIVOS), lt(turnos.inicio, datos.fin), gt(turnos.fin, datos.inicio)));
  const otros = encontrados.filter((t) => t.id !== datos.excluir);
  const errores: string[] = [];
  if (otros.some((t) => t.profesionalId === datos.profesionalId)) errores.push('El profesional ya tiene un turno en ese horario.');
  if (datos.sillonId && otros.some((t) => t.sillonId === datos.sillonId)) errores.push('El sillón ya está ocupado en ese horario.');
  return errores;
}

export type ResultadoTurno = { ok: true; turnoId: string } | { ok: false; errores: string[] };

type DatosTurno = z.output<typeof esquemaTurno>;

const erroresDe = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

/**
 * Guarda un turno nuevo dentro de una transacción ya abierta (sin recalcular
 * pendientes: eso lo hace quien llama, después de confirmar).
 *
 * Antes de mirar superposiciones bloquea la fila del profesional y, si hay,
 * la del sillón, siempre en ese orden: dos secretarias que dan a la vez el
 * mismo horario (del mismo profesional, o del mismo sillón con profesionales
 * distintos) se atienden de a una, y la segunda ve el turno de la primera.
 * `excluir` deja afuera de la comparación un turno que se está por liberar
 * (el original de una reprogramación).
 */
async function insertarTurno(tx: Transaccion, usuario: UsuarioConRoles, datos: DatosTurno, opciones: { reprogramaA?: string; excluir?: string } = {}): Promise<ResultadoTurno> {
  const inicio = fechaHoraArgentina(datos.fecha, datos.hora);
  const fin = new Date(inicio.getTime() + datos.duracionMinutos * 60_000);

  const [profesional] = await tx.select({ id: profesionales.usuarioId }).from(profesionales).where(eq(profesionales.usuarioId, datos.profesionalId)).for('update');
  if (!profesional) return { ok: false, errores: ['El profesional no existe.'] };
  if (datos.sillonId) {
    const [sillon] = await tx.select({ id: sillones.id }).from(sillones).where(eq(sillones.id, datos.sillonId)).for('update');
    if (!sillon) return { ok: false, errores: ['El sillón no existe.'] };
  }
  const [paciente] = await tx.select({ activo: pacientes.activo }).from(pacientes).where(eq(pacientes.id, datos.pacienteId));
  if (!paciente?.activo) return { ok: false, errores: ['El paciente no existe o está dado de baja.'] };

  const errores = await superposiciones(tx, { ...datos, inicio, fin, excluir: opciones.excluir });
  if (errores.length) return { ok: false, errores };

  const [turno] = await tx
    .insert(turnos)
    .values({
      pacienteId: datos.pacienteId,
      profesionalId: datos.profesionalId,
      sillonId: datos.sillonId,
      inicio,
      fin,
      motivo: datos.motivo,
      reprogramaA: opciones.reprogramaA ?? null,
      creadoPor: usuario.id,
    })
    .returning({ id: turnos.id });
  if (!turno) throw new Error('No se pudo guardar el turno.');
  await registrarEvento(tx, turno.id, usuario.id, null, 'reservado', opciones.reprogramaA ? 'Reprogramación' : null);
  return { ok: true, turnoId: turno.id };
}

export async function crearTurno(db: BaseDeDatos, usuario: UsuarioConRoles, entrada: EntradaTurno): Promise<ResultadoTurno> {
  if (!puede(usuario, 'turnos.gestionar')) throw new ErrorDePermiso('No tenés permiso para dar turnos.');
  const validacion = esquemaTurno.safeParse(entrada);
  if (!validacion.success) return { ok: false, errores: erroresDe(validacion.error) };
  const datos = validacion.data;
  const resultado = await db.transaction((tx) => insertarTurno(tx, usuario, datos));
  // Si sacó turno, sus pendientes se resuelven solos.
  if (resultado.ok) await sincronizarSinInterrumpir(db, datos.pacienteId, usuario.id);
  return resultado;
}

export async function cambiarEstadoTurno(db: BaseDeDatos, usuario: UsuarioConRoles, turnoId: string, nuevo: EstadoTurno, nota?: string | null): Promise<ResultadoTurno> {
  if (!puede(usuario, 'turnos.gestionar')) throw new ErrorDePermiso('No tenés permiso para modificar turnos.');
  const resultado = await db.transaction(async (tx) => {
    const [turno] = await tx.select().from(turnos).where(eq(turnos.id, turnoId)).for('update');
    if (!turno) return { ok: false as const, errores: ['El turno no existe.'] };
    if (!puedeCambiarEstado(turno.estado, nuevo)) return { ok: false as const, errores: [`Un turno ${turno.estado.replace('_', ' ')} no puede pasar a ${nuevo.replace('_', ' ')}.`] };
    await tx.update(turnos).set({ estado: nuevo }).where(eq(turnos.id, turnoId));
    await registrarEvento(tx, turnoId, usuario.id, turno.estado, nuevo, nota);
    return { ok: true as const, turnoId, pacienteId: turno.pacienteId };
  });
  if (!resultado.ok) return resultado;
  // Atendido, ausente o cancelado cambian lo que hay que seguir de este paciente.
  await sincronizarSinInterrumpir(db, resultado.pacienteId, usuario.id);
  return { ok: true, turnoId };
}

/**
 * Da un turno nuevo y marca el anterior como reprogramado, dejando el vínculo
 * entre los dos. Todo en una transacción que empieza bloqueando el turno
 * original: si dos personas lo reprograman a la vez, la segunda lo encuentra
 * ya reprogramado y no deja un turno de más. El horario del turno original
 * no cuenta como ocupado (se libera en la misma operación).
 */
export async function reprogramarTurno(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  turnoId: string,
  nuevo: Pick<EntradaTurno, 'fecha' | 'hora'> & Partial<Pick<EntradaTurno, 'profesionalId' | 'sillonId' | 'duracionMinutos'>>,
): Promise<ResultadoTurno> {
  if (!puede(usuario, 'turnos.gestionar')) throw new ErrorDePermiso('No tenés permiso para modificar turnos.');
  if (!z.uuid().safeParse(turnoId).success) return { ok: false, errores: ['El turno no existe.'] };

  const resultado = await db.transaction(async (tx): Promise<(ResultadoTurno & { ok: true; pacienteId: string }) | (ResultadoTurno & { ok: false })> => {
    const [anterior] = await tx.select().from(turnos).where(eq(turnos.id, turnoId)).for('update');
    if (!anterior) return { ok: false, errores: ['El turno no existe.'] };
    if (!puedeCambiarEstado(anterior.estado, 'reprogramado')) return { ok: false, errores: ['Este turno ya no se puede reprogramar.'] };

    const validacion = esquemaTurno.safeParse({
      pacienteId: anterior.pacienteId,
      profesionalId: nuevo.profesionalId ?? anterior.profesionalId,
      sillonId: nuevo.sillonId === undefined ? anterior.sillonId : nuevo.sillonId,
      fecha: nuevo.fecha,
      hora: nuevo.hora,
      duracionMinutos: nuevo.duracionMinutos ?? Math.round((anterior.fin.getTime() - anterior.inicio.getTime()) / 60_000),
      motivo: anterior.motivo,
    });
    if (!validacion.success) return { ok: false, errores: erroresDe(validacion.error) };
    const creado = await insertarTurno(tx, usuario, validacion.data, { reprogramaA: anterior.id, excluir: anterior.id });
    if (!creado.ok) return creado;

    await tx.update(turnos).set({ estado: 'reprogramado' }).where(eq(turnos.id, anterior.id));
    await registrarEvento(tx, anterior.id, usuario.id, anterior.estado, 'reprogramado', 'Se dio un turno nuevo');
    return { ok: true, turnoId: creado.turnoId, pacienteId: anterior.pacienteId };
  });
  if (!resultado.ok) return resultado;
  // El turno nuevo resuelve sus pendientes (y el reprogramado deja de contar como ausente).
  await sincronizarSinInterrumpir(db, resultado.pacienteId, usuario.id);
  return { ok: true, turnoId: resultado.turnoId };
}

export interface TurnoAgenda {
  id: string;
  inicio: Date;
  fin: Date;
  estado: EstadoTurno;
  motivo: string | null;
  sillon: string | null;
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    documento: string;
    edad: number;
    telefono: string | null;
    aceptaMensajes: boolean;
    fotoKey: string | null;
    alertas: string[];
    homonimos: number;
  };
}

export interface AgendaProfesional {
  id: string;
  nombre: string;
  apellido: string;
  turnos: TurnoAgenda[];
}

/** Agenda de un día, por profesional. Los profesionales sin turnos también aparecen. */
export async function agendaDelDia(db: BaseDeDatos, usuario: UsuarioConRoles, fecha: string, profesionalId?: string | null): Promise<AgendaProfesional[]> {
  if (!puede(usuario, 'turnos.ver')) throw new ErrorDePermiso('No tenés acceso a la agenda.');
  const { desde, hasta } = rangoDelDia(fecha);

  const listaProfesionales = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido })
    .from(profesionales)
    .innerJoin(usuarios, eq(usuarios.id, profesionales.usuarioId))
    .where(profesionalId ? and(eq(usuarios.activo, true), eq(usuarios.id, profesionalId)) : eq(usuarios.activo, true))
    .orderBy(asc(usuarios.apellido), asc(usuarios.nombre));

  const filas = await db
    .select({ turno: turnos, paciente: pacientes, sillon: sillones.nombre })
    .from(turnos)
    .innerJoin(pacientes, eq(pacientes.id, turnos.pacienteId))
    .leftJoin(sillones, eq(sillones.id, turnos.sillonId))
    .where(and(lt(turnos.inicio, hasta), gt(turnos.fin, desde), profesionalId ? eq(turnos.profesionalId, profesionalId) : undefined))
    .orderBy(asc(turnos.inicio));

  const pacienteIds = [...new Set(filas.map((f) => f.paciente.id))];
  const [alertas, homonimos] = await Promise.all([
    pacienteIds.length && puede(usuario, 'paciente.ver_alertas_medicas')
      ? db
          .select({ pacienteId: alertasMedicas.pacienteId, descripcion: alertasMedicas.descripcion })
          .from(alertasMedicas)
          .where(and(inArray(alertasMedicas.pacienteId, pacienteIds), eq(alertasMedicas.activa, true)))
      : Promise.resolve([]),
    contarHomonimos(db, filas.map((f) => f.paciente.nombreNormalizado ?? '')),
  ]);

  const hoy = hoyEnArgentina();
  return listaProfesionales.map((p) => ({
    ...p,
    turnos: filas
      .filter((f) => f.turno.profesionalId === p.id)
      .map(({ turno, paciente, sillon }) => ({
        id: turno.id,
        inicio: turno.inicio,
        fin: turno.fin,
        estado: turno.estado,
        motivo: turno.motivo,
        sillon,
        paciente: {
          id: paciente.id,
          nombre: paciente.nombre,
          apellido: paciente.apellido,
          documento: `${paciente.tipoDocumento} ${paciente.numeroDocumento}`,
          edad: edad(paciente.fechaNacimiento, hoy),
          telefono: paciente.telefono,
          aceptaMensajes: paciente.aceptaMensajes,
          fotoKey: paciente.fotoKey,
          alertas: alertas.filter((a) => a.pacienteId === paciente.id).map((a) => a.descripcion),
          homonimos: homonimos.get(paciente.nombreNormalizado ?? '') ?? 0,
        },
      })),
  }));
}

/** Historial de estados de un turno: quién lo cambió y cuándo. */
export async function historialDeTurno(db: BaseDeDatos, usuario: UsuarioConRoles, turnoId: string) {
  if (!puede(usuario, 'turnos.ver')) throw new ErrorDePermiso('No tenés acceso a la agenda.');
  return db
    .select({ estadoAnterior: turnoEventos.estadoAnterior, estadoNuevo: turnoEventos.estadoNuevo, nota: turnoEventos.nota, ocurridoEn: turnoEventos.ocurridoEn, usuario: usuarios.nombre })
    .from(turnoEventos)
    .innerJoin(usuarios, eq(usuarios.id, turnoEventos.usuarioId))
    .where(eq(turnoEventos.turnoId, turnoId))
    .orderBy(asc(turnoEventos.ocurridoEn));
}

export async function listarSillones(db: BaseDeDatos) {
  return db.select({ id: sillones.id, nombre: sillones.nombre }).from(sillones).where(eq(sillones.activo, true)).orderBy(asc(sillones.nombre));
}

