'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { baseDeDatos } from '@/db/client';
import { PLAZOS_REGRESO, frasePlazo, type PlazoRegreso } from '@/domain/seguimiento/regreso';
import { NOMBRE_ESTADO_PENDIENTE, type CanalContacto, type RespuestaContacto } from '@/domain/seguimiento/tablero';
import { esFechaValida } from '@/lib/fechas';
import { ErrorDePermiso } from '@/server/errores';
import { descartarPendiente, registrarContacto, registrarIndicacionRegreso, resolverPendiente, tomarPendiente, type ResultadoAccion } from '@/server/pendientes';
import { usuarioActual } from '@/server/sesion';

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Después de cambiar un pendiente: el tablero, la ficha y el contador del encabezado. */
function refrescar() {
  revalidatePath('/', 'layout');
}

/**
 * "¿Cuándo debería volver?" desde la agenda o la ficha. Cada botón de plazo
 * envía el formulario: un toque y listo. Funciona sin JavaScript.
 */
export async function registrarRegresoAccion(datos: FormData): Promise<void> {
  const pacienteId = texto(datos, 'pacienteId');
  const turnoId = texto(datos, 'turnoId');
  const plazo = texto(datos, 'plazo') as PlazoRegreso;
  const desdeAgenda = texto(datos, 'volverA') === 'agenda';

  let error: string | null = null;
  try {
    const resultado = await registrarIndicacionRegreso(await baseDeDatos(), await usuarioActual(), {
      pacienteId,
      turnoId,
      plazo,
      importante: datos.get('importante') === 'si',
      profesionalId: texto(datos, 'profesionalId'),
    });
    if (!resultado.ok) error = resultado.errores.join(' ');
  } catch (e) {
    if (!(e instanceof ErrorDePermiso)) throw e;
    error = e.message;
  }
  refrescar();

  const aviso = PLAZOS_REGRESO.includes(plazo) ? `Listo: ${frasePlazo(plazo).toLowerCase()}.` : 'Listo.';
  const mensaje: Record<string, string> = error ? { error } : { aviso };
  if (desdeAgenda) {
    const fecha = texto(datos, 'fecha');
    const profesional = texto(datos, 'profesional');
    const parametros = new URLSearchParams({ ...(esFechaValida(fecha) ? { fecha } : {}), ...(UUID.test(profesional) ? { profesional } : {}), ...mensaje });
    redirect(`/agenda?${parametros.toString()}${UUID.test(turnoId) ? `#turno-${turnoId}` : ''}`);
  }
  if (!UUID.test(pacienteId)) redirect('/pacientes');
  redirect(`/pacientes/${pacienteId}?${new URLSearchParams(mensaje).toString()}#regreso`);
}

/** "Tomar": queda a nombre de quien lo toma. */
export async function tomarPendienteAccion(datos: FormData): Promise<void> {
  try {
    await tomarPendiente(await baseDeDatos(), await usuarioActual(), texto(datos, 'pendienteId'));
  } catch (e) {
    if (!(e instanceof ErrorDePermiso)) throw e;
  }
  refrescar();
}

async function comoFormulario(operacion: () => Promise<ResultadoAccion>, mensajeOk: (r: Extract<ResultadoAccion, { ok: true }>) => string): Promise<EstadoFormulario> {
  let resultado: ResultadoAccion;
  try {
    resultado = await operacion();
  } catch (e) {
    if (e instanceof ErrorDePermiso) return { ok: false, errores: [e.message] };
    throw e;
  }
  if (!resultado.ok) return { ok: false, errores: resultado.errores };
  refrescar();
  return { ok: true, errores: [], mensaje: mensajeOk(resultado) };
}

export async function registrarContactoAccion(pendienteId: string, _previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  return comoFormulario(
    async () =>
      registrarContacto(await baseDeDatos(), await usuarioActual(), pendienteId, {
        canal: texto(datos, 'canal') as CanalContacto,
        respuesta: texto(datos, 'respuesta') as RespuestaContacto,
        resultado: texto(datos, 'resultado'),
        contactarDesde: texto(datos, 'contactarDesde'),
        contactarDesdeMotivo: texto(datos, 'contactarDesdeMotivo'),
      }),
    (r) =>
      r.estado === 'no_responde'
        ? `Contacto registrado. Pasó a "${NOMBRE_ESTADO_PENDIENTE.no_responde}"${r.avisoProfesional ? ` y le llegó a ${r.avisoProfesional}` : ''}.`
        : 'Contacto registrado.',
  );
}

export async function resolverPendienteAccion(pendienteId: string, _previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  return comoFormulario(async () => resolverPendiente(await baseDeDatos(), await usuarioActual(), pendienteId, texto(datos, 'nota')), () => 'Marcado como resuelto.');
}

export async function descartarPendienteAccion(pendienteId: string, _previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  return comoFormulario(async () => descartarPendiente(await baseDeDatos(), await usuarioActual(), pendienteId, texto(datos, 'motivo')), () => 'Pendiente descartado.');
}
