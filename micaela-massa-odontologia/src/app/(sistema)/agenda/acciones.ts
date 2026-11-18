'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { baseDeDatos } from '@/db/client';
import { ESTADOS_TURNO, type EstadoTurno } from '@/domain/agenda/turnos';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { cambiarEstadoTurno, crearTurno, reprogramarTurno } from '@/server/agenda';
import { ErrorDePermiso } from '@/server/errores';
import { buscarPacientes, type PacienteListado } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';
import { esFechaValida } from '@/lib/fechas';

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim();

function volverALaAgenda(fecha: string, extra: Record<string, string> = {}): never {
  const parametros = new URLSearchParams({ fecha, ...extra });
  redirect(`/agenda?${parametros.toString()}`);
}

/** Botones de estado de la agenda (Confirmar, Llegó, Atendido...). Funcionan sin JavaScript. */
export async function cambiarEstadoAccion(datos: FormData): Promise<void> {
  const turnoId = texto(datos, 'turnoId');
  const estado = texto(datos, 'estado') as EstadoTurno;
  const fecha = esFechaValida(texto(datos, 'fecha')) ? texto(datos, 'fecha') : '';
  const profesional = texto(datos, 'profesional');
  const extra: Record<string, string> = profesional ? { profesional } : {};
  if (!ESTADOS_TURNO.includes(estado)) volverALaAgenda(fecha, { ...extra, error: 'Estado desconocido.' });

  let error: string | null = null;
  try {
    const resultado = await cambiarEstadoTurno(await baseDeDatos(), await usuarioActual(), turnoId, estado);
    if (!resultado.ok) error = resultado.errores.join(' ');
  } catch (e) {
    if (!(e instanceof ErrorDePermiso)) throw e;
    error = e.message;
  }
  revalidatePath('/agenda');
  volverALaAgenda(fecha, error ? { ...extra, error } : extra);
}

/** Nuevo turno o reprogramación (si viene `reprogramaA`). */
export async function guardarTurnoAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const fecha = texto(datos, 'fecha');
  const reprogramaA = texto(datos, 'reprogramaA');
  let resultado;
  try {
    const db = await baseDeDatos();
    const usuario = await usuarioActual();
    const entrada = {
      pacienteId: texto(datos, 'pacienteId'),
      profesionalId: texto(datos, 'profesionalId'),
      sillonId: texto(datos, 'sillonId'),
      fecha,
      hora: texto(datos, 'hora'),
      duracionMinutos: texto(datos, 'duracionMinutos'),
      motivo: texto(datos, 'motivo'),
    };
    resultado = reprogramaA
      ? await reprogramarTurno(db, usuario, reprogramaA, {
          fecha: entrada.fecha,
          hora: entrada.hora,
          profesionalId: entrada.profesionalId,
          sillonId: entrada.sillonId || null,
          duracionMinutos: Number(entrada.duracionMinutos),
        })
      : await crearTurno(db, usuario, entrada);
  } catch (e) {
    if (e instanceof ErrorDePermiso) return { ok: false, errores: [e.message] };
    throw e;
  }
  if (!resultado.ok) return { ok: false, errores: resultado.errores };
  revalidatePath('/agenda');
  revalidatePath('/pacientes');
  volverALaAgenda(fecha, { aviso: reprogramaA ? 'Turno reprogramado.' : 'Turno guardado.' });
}

/** Búsqueda de pacientes para elegir a quién darle el turno. */
export async function buscarPacientesParaTurno(textoBuscado: string): Promise<PacienteListado[]> {
  if (textoBuscado.trim().length < 2) return [];
  return buscarPacientes(await baseDeDatos(), await usuarioActual(), textoBuscado, 8);
}
