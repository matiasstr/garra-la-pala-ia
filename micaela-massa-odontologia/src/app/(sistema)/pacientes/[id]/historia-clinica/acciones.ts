'use server';

import { revalidatePath } from 'next/cache';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { baseDeDatos } from '@/db/client';
import { contextoDelPedido } from '@/server/contexto-pedido';
import { ErrorDePermiso, ErrorDeValidacion } from '@/server/errores';
import type { ResultadoFirma } from '@/server/hc/comun';
import { descartarBorradorEvolucion, firmarCambiosOdontograma, firmarEnmienda, firmarEvolucion, guardarBorradorEvolucion } from '@/server/hc/evoluciones';
import { usuarioActual } from '@/server/sesion';

const ruta = (pacienteId: string) => `/pacientes/${pacienteId}/historia-clinica`;

/** Convierte permisos y validaciones en mensajes para la pantalla, y refresca la historia clínica si se firmó. */
async function ejecutar(pacienteId: string, operacion: () => Promise<ResultadoFirma>, mensaje: string): Promise<EstadoFormulario> {
  try {
    const resultado = await operacion();
    if (!resultado.ok) return { ok: false, errores: resultado.errores };
  } catch (error) {
    if (error instanceof ErrorDePermiso) return { ok: false, errores: [error.message] };
    if (error instanceof ErrorDeValidacion) return { ok: false, errores: error.errores };
    throw error;
  }
  revalidatePath(ruta(pacienteId));
  return { ok: true, errores: [], mensaje };
}

export interface EstadoBorrador extends EstadoFormulario {
  /** ISO 8601: cuándo quedó guardado. */
  guardadoEn: string | null;
}

/** Guarda el borrador de la evolución. No revalida la página: el texto sigue en pantalla. */
export async function guardarBorradorAccion(pacienteId: string, texto: string): Promise<EstadoBorrador> {
  try {
    const { errores, actualizadoEn } = await guardarBorradorEvolucion(await baseDeDatos(), await usuarioActual(), pacienteId, String(texto));
    return { ok: errores.length === 0, errores, guardadoEn: actualizadoEn?.toISOString() ?? null };
  } catch (error) {
    if (error instanceof ErrorDePermiso) return { ok: false, errores: [error.message], guardadoEn: null };
    if (error instanceof ErrorDeValidacion) return { ok: false, errores: error.errores, guardadoEn: null };
    throw error;
  }
}

export async function descartarBorradorAccion(pacienteId: string): Promise<EstadoFormulario> {
  try {
    await descartarBorradorEvolucion(await baseDeDatos(), await usuarioActual(), pacienteId);
    return { ok: true, errores: [], mensaje: 'Borrador descartado.' };
  } catch (error) {
    if (error instanceof ErrorDePermiso) return { ok: false, errores: [error.message] };
    throw error;
  }
}

export async function firmarEvolucionAccion(
  pacienteId: string,
  entrada: { texto: string; pin: string; turnoId?: string | null; especialidad?: string | null },
): Promise<EstadoFormulario> {
  return ejecutar(
    pacienteId,
    async () =>
      firmarEvolucion(
        await baseDeDatos(),
        await usuarioActual(),
        { pacienteId, texto: String(entrada.texto), pin: String(entrada.pin), turnoId: entrada.turnoId || null, especialidad: entrada.especialidad || null },
        await contextoDelPedido(),
      ),
    'Evolución firmada. Ya no se puede modificar.',
  );
}

export async function firmarEnmiendaAccion(pacienteId: string, registroId: string, entrada: { texto: string; pin: string }): Promise<EstadoFormulario> {
  return ejecutar(
    pacienteId,
    async () => firmarEnmienda(await baseDeDatos(), await usuarioActual(), { pacienteId, registroId, texto: String(entrada.texto), pin: String(entrada.pin) }, await contextoDelPedido()),
    'Enmienda firmada.',
  );
}

export async function firmarOdontogramaAccion(
  pacienteId: string,
  entrada: { marcas: unknown; nota?: string | null; pin: string; especialidad?: string | null },
): Promise<EstadoFormulario> {
  return ejecutar(
    pacienteId,
    async () =>
      firmarCambiosOdontograma(
        await baseDeDatos(),
        await usuarioActual(),
        { pacienteId, marcas: entrada.marcas, nota: entrada.nota ?? null, pin: String(entrada.pin), especialidad: entrada.especialidad || null },
        await contextoDelPedido(),
      ),
    'Cambios del odontograma firmados.',
  );
}
