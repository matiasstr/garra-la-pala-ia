import { randomUUID } from 'node:crypto';
import { asc, desc, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { HASH_GENESIS, calcularHashRegistro, verificarCadena, type ResultadoVerificacion } from '../../domain/firma/encadenamiento';
import { calcularOdontograma, validarMarca, type MarcaNueva, type MarcaOdontograma } from '../../domain/odontograma/estado';
import { puede, puedeEnmendar, puedeFirmarRegistroClinico, type UsuarioConRoles } from '../../domain/permisos/permisos';
import type { Especialidad } from '../../domain/permisos/roles';
import { ErrorDePermiso, ErrorDeValidacion } from '../errores';

export { ErrorDePermiso, ErrorDeValidacion };
export type { BaseDeDatos };

const { auditoriaAccesos, historiasClinicas, marcasOdontograma, registrosClinicos } = schema;

export type TipoRegistro = (typeof schema.tipoRegistroEnum.enumValues)[number];
export type RegistroClinico = typeof registrosClinicos.$inferSelect;

async function auditar(
  db: Pick<BaseDeDatos, 'insert'>,
  entrada: { usuarioId: string; accion: string; entidad: string; entidadId?: string; pacienteId?: string; detalle?: unknown },
): Promise<void> {
  await db.insert(auditoriaAccesos).values({ ...entrada, detalle: entrada.detalle ?? null });
}

/** Crea la historia clínica del paciente si no existe (una sola por paciente). */
export async function obtenerOCrearHistoriaClinica(db: BaseDeDatos, pacienteId: string): Promise<{ id: string; numero: number }> {
  const [existente] = await db.select({ id: historiasClinicas.id, numero: historiasClinicas.numero }).from(historiasClinicas).where(eq(historiasClinicas.pacienteId, pacienteId));
  if (existente) return existente;
  const [creada] = await db
    .insert(historiasClinicas)
    .values({ pacienteId })
    .onConflictDoNothing({ target: historiasClinicas.pacienteId })
    .returning({ id: historiasClinicas.id, numero: historiasClinicas.numero });
  if (creada) return creada;
  return obtenerOCrearHistoriaClinica(db, pacienteId);
}

/**
 * Abre la historia clínica para leerla. Solo profesionales, y cada apertura
 * queda en la auditoría (quién vio qué historia y cuándo).
 */
export async function abrirHistoriaClinica(db: BaseDeDatos, usuario: UsuarioConRoles, historiaClinicaId: string): Promise<RegistroClinico[]> {
  if (!puede(usuario, 'hc.ver')) throw new ErrorDePermiso('No tenés acceso a la historia clínica.');
  const [hc] = await db.select().from(historiasClinicas).where(eq(historiasClinicas.id, historiaClinicaId));
  if (!hc) throw new ErrorDeValidacion(['La historia clínica no existe.']);
  await auditar(db, { usuarioId: usuario.id, accion: 'hc.ver', entidad: 'historia_clinica', entidadId: hc.id, pacienteId: hc.pacienteId });
  return db.select().from(registrosClinicos).where(eq(registrosClinicos.historiaClinicaId, historiaClinicaId)).orderBy(asc(registrosClinicos.secuencia));
}

export interface NuevoRegistro {
  historiaClinicaId: string;
  tipo: TipoRegistro;
  contenido: Record<string, unknown>;
  especialidad?: Especialidad | null;
  turnoId?: string | null;
  /** Registro propio que se corrige (solo para `tipo: 'enmienda'`). */
  enmiendaDe?: string | null;
  /** Cambios al odontograma incluidos en este registro. */
  marcas?: MarcaNueva[];
}

/**
 * Firma un registro clínico: lo encadena al anterior, lo guarda inalterable,
 * proyecta sus marcas al odontograma y deja constancia en la auditoría.
 * Todo en una transacción.
 */
export async function firmarRegistro(db: BaseDeDatos, autor: UsuarioConRoles, nuevo: NuevoRegistro, ahora: Date = new Date()): Promise<RegistroClinico> {
  if (!puedeFirmarRegistroClinico(autor)) throw new ErrorDePermiso('Solo un profesional con matrícula puede firmar registros clínicos.');
  if ((nuevo.tipo === 'enmienda') !== Boolean(nuevo.enmiendaDe)) {
    throw new ErrorDeValidacion(['Una enmienda tiene que indicar qué registro corrige, y solo una enmienda puede hacerlo.']);
  }

  return db.transaction(async (tx) => {
    const [hc] = await tx.select().from(historiasClinicas).where(eq(historiasClinicas.id, nuevo.historiaClinicaId)).for('update');
    if (!hc) throw new ErrorDeValidacion(['La historia clínica no existe.']);

    if (nuevo.enmiendaDe) {
      const [original] = await tx.select().from(registrosClinicos).where(eq(registrosClinicos.id, nuevo.enmiendaDe));
      if (!original || original.historiaClinicaId !== hc.id) throw new ErrorDeValidacion(['El registro a enmendar no existe en esta historia clínica.']);
      if (!puedeEnmendar(autor, original)) throw new ErrorDePermiso('Solo quien firmó un registro puede enmendarlo.');
    }

    // Marcas del odontograma: se validan contra las ya registradas y entre sí.
    const marcas: MarcaOdontograma[] = [];
    if (nuevo.marcas?.length) {
      const existentes: MarcaOdontograma[] = (await tx.select().from(marcasOdontograma).where(eq(marcasOdontograma.historiaClinicaId, hc.id))).map(
        (m) => ({ ...m, cara: m.cara ?? null }),
      );
      for (const marca of nuevo.marcas) {
        const errores = validarMarca(marca, [...existentes, ...marcas]);
        if (errores.length) throw new ErrorDeValidacion(errores);
        marcas.push({ ...marca, id: randomUUID(), registradaEn: ahora });
      }
    }

    const [ultimo] = await tx
      .select({ secuencia: registrosClinicos.secuencia, hash: registrosClinicos.hash })
      .from(registrosClinicos)
      .where(eq(registrosClinicos.historiaClinicaId, hc.id))
      .orderBy(desc(registrosClinicos.secuencia))
      .limit(1);

    // Las marcas viajan dentro del contenido firmado: el registro por sí solo
    // alcanza para reconstruir el odontograma y verificar su integridad.
    const contenido = marcas.length
      ? { ...nuevo.contenido, marcas: marcas.map(({ registradaEn: _registradaEn, ...m }) => ({ ...m, reemplazaA: m.reemplazaA ?? null })) }
      : nuevo.contenido;
    const datos = {
      historiaClinicaId: hc.id,
      secuencia: (ultimo?.secuencia ?? 0) + 1,
      tipo: nuevo.tipo,
      contenido,
      autorId: autor.id,
      firmadoEn: ahora,
      hashAnterior: ultimo?.hash ?? HASH_GENESIS,
      enmiendaDe: nuevo.enmiendaDe ?? null,
    };

    const [registro] = await tx
      .insert(registrosClinicos)
      .values({ ...datos, hash: calcularHashRegistro(datos), especialidad: nuevo.especialidad ?? null, turnoId: nuevo.turnoId ?? null })
      .returning();
    if (!registro) throw new Error('No se pudo guardar el registro clínico.');

    if (marcas.length) {
      await tx.insert(marcasOdontograma).values(
        marcas.map((m) => ({
          id: m.id,
          registroId: registro.id,
          historiaClinicaId: hc.id,
          pieza: m.pieza,
          cara: m.cara,
          hallazgo: m.hallazgo,
          estado: m.estado,
          reemplazaA: m.reemplazaA ?? null,
          anulacion: m.anulacion ?? false,
          prestacionCodigo: m.prestacionCodigo ?? null,
          registradaEn: m.registradaEn,
        })),
      );
    }

    await auditar(tx, {
      usuarioId: autor.id,
      accion: 'registro.firmar',
      entidad: 'registro_clinico',
      entidadId: registro.id,
      pacienteId: hc.pacienteId,
      detalle: { secuencia: registro.secuencia, tipo: registro.tipo },
    });
    return registro;
  });
}

/** Recalcula la cadena de hashes de una historia clínica completa. */
export async function verificarHistoriaClinica(db: BaseDeDatos, historiaClinicaId: string): Promise<ResultadoVerificacion> {
  const registros = await db.select().from(registrosClinicos).where(eq(registrosClinicos.historiaClinicaId, historiaClinicaId));
  return verificarCadena(registros);
}

/** Odontograma de la historia clínica, hoy o a una fecha pasada. */
export async function odontogramaDe(db: BaseDeDatos, historiaClinicaId: string, hasta?: Date) {
  const marcas = await db.select().from(marcasOdontograma).where(eq(marcasOdontograma.historiaClinicaId, historiaClinicaId));
  return calcularOdontograma(
    marcas.map((m) => ({ ...m, cara: m.cara ?? null })),
    hasta,
  );
}
