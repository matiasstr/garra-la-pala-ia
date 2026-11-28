import { and, eq } from 'drizzle-orm';
import { historiasClinicas, pacientes, profesionales, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import type { Firmante } from '../../domain/historia-clinica/registros';
import { ErrorDeValidacion } from '../errores';
import { obtenerOCrearHistoriaClinica } from './historia-clinica';

export type ResultadoFirma<T = object> = ({ ok: true } & T) | { ok: false; errores: string[] };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Historia clínica de un paciente activo (la crea la primera vez: hay una sola por paciente). */
export async function historiaDelPaciente(db: BaseDeDatos, pacienteId: string): Promise<{ id: string; numero: number }> {
  if (!UUID.test(pacienteId)) throw new ErrorDeValidacion(['El paciente no existe.']);
  const [paciente] = await db.select({ id: pacientes.id }).from(pacientes).where(and(eq(pacientes.id, pacienteId), eq(pacientes.activo, true)));
  if (!paciente) throw new ErrorDeValidacion(['El paciente no existe o está dado de baja.']);
  return obtenerOCrearHistoriaClinica(db, pacienteId);
}

/** Historia clínica existente de un paciente, sin crearla. */
export async function historiaExistente(db: BaseDeDatos, pacienteId: string): Promise<{ id: string; numero: number } | null> {
  if (!UUID.test(pacienteId)) return null;
  const [hc] = await db.select({ id: historiasClinicas.id, numero: historiasClinicas.numero }).from(historiasClinicas).where(eq(historiasClinicas.pacienteId, pacienteId));
  return hc ?? null;
}

/**
 * Nombre y matrícula del profesional en el momento de firmar. Van dentro del
 * contenido firmado: si mañana cambia la matrícula, el registro sigue diciendo
 * quién firmó y con qué matrícula (Ley 26.529, art. 15).
 */
export async function firmanteDe(db: BaseDeDatos, usuarioId: string): Promise<Firmante> {
  const [fila] = await db
    .select({ nombre: usuarios.nombre, apellido: usuarios.apellido, matricula: profesionales.matricula })
    .from(profesionales)
    .innerJoin(usuarios, eq(usuarios.id, profesionales.usuarioId))
    .where(eq(profesionales.usuarioId, usuarioId));
  if (!fila) throw new ErrorDeValidacion(['Tu usuario no está cargado como profesional.']);
  return fila;
}
