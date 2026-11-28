import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { borradoresClinicos, profesionalEspecialidades, registrosClinicos, turnos } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { LARGO_MAXIMO_TEXTO_CLINICO, validarTextoClinico } from '../../domain/historia-clinica/registros';
import { CODIGOS_HALLAZGO, ESTADOS_MARCA } from '../../domain/odontograma/catalogo';
import type { MarcaNueva } from '../../domain/odontograma/estado';
import { CARAS } from '../../domain/odontograma/piezas';
import { puede, puedeFirmarRegistroClinico, type UsuarioConRoles } from '../../domain/permisos/permisos';
import { ESPECIALIDADES, type Especialidad } from '../../domain/permisos/roles';
import { ErrorDePermiso, ErrorDeValidacion } from '../errores';
import { UUID, firmanteDe, historiaDelPaciente, historiaExistente, type ResultadoFirma } from './comun';
import { firmarRegistro, type ContextoAuditoria, type RegistroClinico } from './historia-clinica';
import { comprobarPinDeFirma } from './pin';

/**
 * Lo que el profesional escribe y firma desde la pantalla de la historia
 * clínica: borradores, evoluciones, enmiendas y cambios del odontograma.
 * Todo lo que se firma pide el PIN de firma.
 */

function exigirFirmante(usuario: UsuarioConRoles): void {
  if (!puede(usuario, 'hc.registrar') || !puedeFirmarRegistroClinico(usuario)) {
    throw new ErrorDePermiso('Solo un profesional con matrícula puede escribir en la historia clínica.');
  }
}

/** Las validaciones de la firma (marcas inválidas, enmiendas ajenas) vuelven como errores para mostrar. */
async function capturarValidacion<T>(operacion: () => Promise<T>): Promise<{ ok: true; valor: T } | { ok: false; errores: string[] }> {
  try {
    return { ok: true, valor: await operacion() };
  } catch (error) {
    if (error instanceof ErrorDeValidacion) return { ok: false, errores: error.errores };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Borradores
// ---------------------------------------------------------------------------

export interface Borrador {
  texto: string;
  actualizadoEn: Date;
}

const textoDeBorrador = (contenido: unknown): string =>
  typeof contenido === 'object' && contenido !== null && typeof (contenido as { texto?: unknown }).texto === 'string' ? (contenido as { texto: string }).texto : '';

/** El borrador de evolución que el profesional dejó en esta historia clínica (solo lo ve él). */
export async function borradorDeEvolucion(db: BaseDeDatos, usuario: UsuarioConRoles, historiaClinicaId: string): Promise<Borrador | null> {
  if (!puede(usuario, 'hc.registrar')) return null;
  const [fila] = await db
    .select()
    .from(borradoresClinicos)
    .where(and(eq(borradoresClinicos.historiaClinicaId, historiaClinicaId), eq(borradoresClinicos.autorId, usuario.id), eq(borradoresClinicos.tipo, 'evolucion')));
  return fila ? { texto: textoDeBorrador(fila.contenido), actualizadoEn: fila.actualizadoEn } : null;
}

/** Guarda (o reemplaza) el borrador. Un borrador vacío se descarta. Todavía no es historia clínica. */
export async function guardarBorradorEvolucion(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  pacienteId: string,
  texto: string,
  ahora: Date = new Date(),
): Promise<{ errores: string[]; actualizadoEn: Date | null }> {
  exigirFirmante(usuario);
  if (texto.length > LARGO_MAXIMO_TEXTO_CLINICO) return { errores: ['El texto es demasiado largo.'], actualizadoEn: null };
  if (!texto.trim()) {
    await descartarBorradorEvolucion(db, usuario, pacienteId);
    return { errores: [], actualizadoEn: null };
  }
  const hc = await historiaDelPaciente(db, pacienteId);
  await db
    .insert(borradoresClinicos)
    .values({ historiaClinicaId: hc.id, autorId: usuario.id, tipo: 'evolucion', contenido: { texto }, actualizadoEn: ahora })
    .onConflictDoUpdate({
      target: [borradoresClinicos.historiaClinicaId, borradoresClinicos.autorId, borradoresClinicos.tipo],
      set: { contenido: { texto }, actualizadoEn: ahora },
    });
  return { errores: [], actualizadoEn: ahora };
}

export async function descartarBorradorEvolucion(db: BaseDeDatos, usuario: UsuarioConRoles, pacienteId: string): Promise<void> {
  exigirFirmante(usuario);
  const hc = await historiaExistente(db, pacienteId);
  if (!hc) return;
  await db
    .delete(borradoresClinicos)
    .where(and(eq(borradoresClinicos.historiaClinicaId, hc.id), eq(borradoresClinicos.autorId, usuario.id), eq(borradoresClinicos.tipo, 'evolucion')));
}

// ---------------------------------------------------------------------------
// Evolución y enmienda
// ---------------------------------------------------------------------------

export interface EntradaEvolucion {
  pacienteId: string;
  texto: string;
  pin: string;
  /** Turno en el que se atendió, si se abrió la historia clínica desde la agenda. */
  turnoId?: string | null;
  especialidad?: string | null;
}

async function especialidadValida(db: BaseDeDatos, usuarioId: string, pedida: string | null | undefined): Promise<{ especialidad: Especialidad | null } | { error: string }> {
  const propias = (await db.select({ e: profesionalEspecialidades.especialidad }).from(profesionalEspecialidades).where(eq(profesionalEspecialidades.usuarioId, usuarioId))).map(
    (f) => f.e,
  );
  if (!pedida) return { especialidad: propias.length === 1 ? (propias[0] ?? null) : null };
  const especialidad = ESPECIALIDADES.find((e) => e === pedida);
  if (!especialidad || !propias.includes(especialidad)) return { error: 'Elegí una de tus especialidades.' };
  return { especialidad };
}

/** Firma una evolución con el PIN. Queda inalterable y se borra el borrador. */
export async function firmarEvolucion(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  entrada: EntradaEvolucion,
  contexto: ContextoAuditoria = {},
  ahora: Date = new Date(),
): Promise<ResultadoFirma<{ registro: RegistroClinico }>> {
  exigirFirmante(usuario);
  const errores = validarTextoClinico(entrada.texto);
  if (errores.length) return { ok: false, errores };
  const especialidad = await especialidadValida(db, usuario.id, entrada.especialidad);
  if ('error' in especialidad) return { ok: false, errores: [especialidad.error] };

  const hc = await historiaDelPaciente(db, entrada.pacienteId);
  let turnoId: string | null = null;
  if (entrada.turnoId) {
    const [turno] = UUID.test(entrada.turnoId) ? await db.select({ id: turnos.id, pacienteId: turnos.pacienteId }).from(turnos).where(eq(turnos.id, entrada.turnoId)) : [];
    if (!turno || turno.pacienteId !== entrada.pacienteId) return { ok: false, errores: ['El turno no es de este paciente.'] };
    turnoId = turno.id;
  }

  const pin = await comprobarPinDeFirma(db, usuario, entrada.pin, contexto, ahora);
  if (!pin.ok) return pin;
  const firmante = await firmanteDe(db, usuario.id);

  const registro = await db.transaction(async (tx) => {
    const firmado = await firmarRegistro(
      tx,
      usuario,
      { historiaClinicaId: hc.id, tipo: 'evolucion', contenido: { texto: entrada.texto.trim(), firmante }, especialidad: especialidad.especialidad, turnoId },
      ahora,
      contexto,
    );
    await tx
      .delete(borradoresClinicos)
      .where(and(eq(borradoresClinicos.historiaClinicaId, hc.id), eq(borradoresClinicos.autorId, usuario.id), eq(borradoresClinicos.tipo, 'evolucion')));
    return firmado;
  });
  return { ok: true, registro };
}

/**
 * Enmienda: corrige un registro propio con un registro nuevo vinculado. El
 * original no cambia. Para corregir una enmienda se agrega otra al original.
 */
export async function firmarEnmienda(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  entrada: { pacienteId: string; registroId: string; texto: string; pin: string },
  contexto: ContextoAuditoria = {},
  ahora: Date = new Date(),
): Promise<ResultadoFirma<{ registro: RegistroClinico }>> {
  exigirFirmante(usuario);
  const errores = validarTextoClinico(entrada.texto);
  if (errores.length) return { ok: false, errores };
  const hc = await historiaExistente(db, entrada.pacienteId);
  const [original] = hc && UUID.test(entrada.registroId) ? await db.select().from(registrosClinicos).where(eq(registrosClinicos.id, entrada.registroId)) : [];
  if (!hc || !original || original.historiaClinicaId !== hc.id) return { ok: false, errores: ['El registro a enmendar no existe en esta historia clínica.'] };
  if (original.autorId !== usuario.id) throw new ErrorDePermiso('Solo quien firmó un registro puede enmendarlo.');
  if (original.tipo === 'enmienda') return { ok: false, errores: ['Para corregir una enmienda, agregá otra enmienda al registro original.'] };

  const pin = await comprobarPinDeFirma(db, usuario, entrada.pin, contexto, ahora);
  if (!pin.ok) return pin;
  const firmante = await firmanteDe(db, usuario.id);
  const resultado = await capturarValidacion(() =>
    firmarRegistro(
      db,
      usuario,
      { historiaClinicaId: hc.id, tipo: 'enmienda', enmiendaDe: original.id, contenido: { texto: entrada.texto.trim(), firmante }, especialidad: original.especialidad },
      ahora,
      contexto,
    ),
  );
  return resultado.ok ? { ok: true, registro: resultado.valor } : resultado;
}

// ---------------------------------------------------------------------------
// Odontograma
// ---------------------------------------------------------------------------

const esquemaMarcas = z
  .array(
    z.object({
      pieza: z.number().int(),
      cara: z.enum(CARAS).nullable(),
      hallazgo: z.enum(CODIGOS_HALLAZGO),
      estado: z.enum(ESTADOS_MARCA),
      reemplazaA: z.uuid().nullable().default(null),
      anulacion: z.boolean().default(false),
    }),
  )
  .min(1, 'No hay cambios para firmar.')
  .max(200, 'Son demasiados cambios juntos: firmalos en partes.');

/** Firma los cambios marcados en el odontograma como un registro de tipo `odontograma`. */
export async function firmarCambiosOdontograma(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  entrada: { pacienteId: string; marcas: unknown; nota?: string | null; pin: string; especialidad?: string | null },
  contexto: ContextoAuditoria = {},
  ahora: Date = new Date(),
): Promise<ResultadoFirma<{ registro: RegistroClinico }>> {
  exigirFirmante(usuario);
  const marcas = esquemaMarcas.safeParse(entrada.marcas);
  if (!marcas.success) return { ok: false, errores: [...new Set(marcas.error.issues.map((i) => (i.code === 'too_small' || i.code === 'too_big' ? i.message : 'Hay un cambio del odontograma que no es válido.')))] };
  const nota = entrada.nota?.trim() ?? '';
  if (nota.length > 2000) return { ok: false, errores: ['La nota es demasiado larga (máximo 2.000 caracteres).'] };
  const especialidad = await especialidadValida(db, usuario.id, entrada.especialidad);
  if ('error' in especialidad) return { ok: false, errores: [especialidad.error] };

  const hc = await historiaDelPaciente(db, entrada.pacienteId);
  const pin = await comprobarPinDeFirma(db, usuario, entrada.pin, contexto, ahora);
  if (!pin.ok) return pin;
  const firmante = await firmanteDe(db, usuario.id);
  const nuevas: MarcaNueva[] = marcas.data.map((m) => ({ ...m, prestacionCodigo: null }));
  const resultado = await capturarValidacion(() =>
    firmarRegistro(
      db,
      usuario,
      { historiaClinicaId: hc.id, tipo: 'odontograma', contenido: { ...(nota ? { texto: nota } : {}), firmante }, especialidad: especialidad.especialidad, marcas: nuevas },
      ahora,
      contexto,
    ),
  );
  return resultado.ok ? { ok: true, registro: resultado.valor } : resultado;
}
