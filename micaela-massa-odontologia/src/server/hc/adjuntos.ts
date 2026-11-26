import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { adjuntos, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { esPiezaValida } from '../../domain/odontograma/piezas';
import { puede, puedeFirmarRegistroClinico, type UsuarioConRoles } from '../../domain/permisos/permisos';
import { fechaDe, formatoFechaCorta } from '../../lib/fechas';
import { detectarTipoArchivo, type AlmacenArchivos, type TipoArchivo } from '../archivos';
import { ErrorDePermiso } from '../errores';
import { UUID, firmanteDe, historiaDelPaciente, type ResultadoFirma } from './comun';
import { auditar, firmarRegistro, type ContextoAuditoria, type RegistroClinico } from './historia-clinica';
import { comprobarPinDeFirma } from './pin';

/**
 * Adjuntos clínicos: radiografías, fotos intraorales, estudios e informes en
 * PDF. El archivo se guarda por su huella SHA-256 en un almacenamiento que no
 * pisa ni borra, y se incorpora a la historia clínica con un registro firmado
 * de tipo `adjunto` que cita esa huella. Verlo o descargarlo queda auditado.
 */

export const TAMANIO_MAXIMO_ADJUNTO = 10 * 1024 * 1024;
export const LARGO_MAXIMO_DESCRIPCION = 300;

const sha256De = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Nombre original sin carpetas ni caracteres raros, para mostrar y para la descarga. */
export function limpiarNombreArchivo(nombre: string, tipo: TipoArchivo): string {
  const base = (nombre.split(/[\\/]/).at(-1) ?? '')
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}"<>|*?:]/gu, '')
    .trim()
    .slice(0, 120);
  if (base) return base;
  return tipo === 'application/pdf' ? 'documento.pdf' : `imagen.${tipo.split('/')[1] === 'jpeg' ? 'jpg' : tipo.split('/')[1]}`;
}

export interface EntradaAdjunto {
  pacienteId: string;
  bytes: Uint8Array;
  nombreOriginal: string;
  descripcion: string;
  pieza?: number | null;
  pin: string;
  /** Huella que calculó el navegador: si no coincide, el archivo no llegó completo. */
  sha256Declarado?: string | null;
}

export async function subirAdjuntoClinico(
  db: BaseDeDatos,
  almacen: AlmacenArchivos,
  usuario: UsuarioConRoles,
  entrada: EntradaAdjunto,
  contexto: ContextoAuditoria = {},
  ahora: Date = new Date(),
): Promise<ResultadoFirma<{ registro: RegistroClinico; adjuntoId: string }>> {
  if (!puede(usuario, 'adjuntos_clinicos.subir') || !puedeFirmarRegistroClinico(usuario)) {
    throw new ErrorDePermiso('Solo un profesional con matrícula puede adjuntar archivos a la historia clínica.');
  }
  const { bytes } = entrada;
  const descripcion = entrada.descripcion.trim();
  const pieza = entrada.pieza ?? null;
  const errores: string[] = [];
  if (!bytes.byteLength) errores.push('Elegí un archivo.');
  else if (bytes.byteLength > TAMANIO_MAXIMO_ADJUNTO) errores.push('El archivo pesa más de 10 MB.');
  const tipo = bytes.byteLength ? detectarTipoArchivo(bytes) : null;
  if (bytes.byteLength && !tipo) errores.push('El archivo no es una imagen (JPG, PNG o WebP) ni un PDF.');
  if (!descripcion) errores.push('Escribí qué es el archivo (por ejemplo, "Radiografía periapical").');
  if (descripcion.length > LARGO_MAXIMO_DESCRIPCION) errores.push(`La descripción es demasiado larga (máximo ${LARGO_MAXIMO_DESCRIPCION} caracteres).`);
  if (pieza !== null && !esPiezaValida(pieza)) errores.push(`La pieza ${pieza} no existe.`);
  if (errores.length || !tipo) return { ok: false, errores };

  const sha256 = sha256De(bytes);
  if (entrada.sha256Declarado && entrada.sha256Declarado.toLowerCase() !== sha256) {
    return { ok: false, errores: ['El archivo no llegó completo. Probá de nuevo.'] };
  }

  const hc = await historiaDelPaciente(db, entrada.pacienteId);
  const [repetido] = await db
    .select({ subidoEn: adjuntos.subidoEn, nombre: usuarios.nombre, apellido: usuarios.apellido })
    .from(adjuntos)
    .innerJoin(usuarios, eq(usuarios.id, adjuntos.subidoPor))
    .where(and(eq(adjuntos.historiaClinicaId, hc.id), eq(adjuntos.sha256, sha256)));
  if (repetido) {
    return { ok: false, errores: [`Este mismo archivo ya está en la historia clínica: lo subió ${repetido.nombre} ${repetido.apellido} el ${formatoFechaCorta(fechaDe(repetido.subidoEn))}.`] };
  }

  const pin = await comprobarPinDeFirma(db, usuario, entrada.pin, contexto, ahora);
  if (!pin.ok) return pin;
  const firmante = await firmanteDe(db, usuario.id);

  // Una carpeta por historia clínica: el mismo archivo en dos pacientes son dos adjuntos distintos.
  const guardado = await almacen.guardar(`hc-${hc.id}`, bytes, tipo);
  if (guardado.sha256 !== sha256) throw new Error('El almacenamiento devolvió otra huella para el archivo.');

  const nombreOriginal = limpiarNombreArchivo(entrada.nombreOriginal, tipo);
  const adjuntoId = randomUUID();
  const registro = await db.transaction(async (tx) => {
    await tx.insert(adjuntos).values({
      id: adjuntoId,
      pacienteId: entrada.pacienteId,
      ambito: 'clinico',
      historiaClinicaId: hc.id,
      pieza,
      storageKey: guardado.clave,
      sha256,
      tipoMime: tipo,
      bytes: bytes.byteLength,
      nombreOriginal,
      descripcion,
      subidoPor: usuario.id,
      subidoEn: ahora,
    });
    return firmarRegistro(
      tx,
      usuario,
      {
        historiaClinicaId: hc.id,
        tipo: 'adjunto',
        contenido: { texto: descripcion, firmante, adjunto: { id: adjuntoId, sha256, nombreOriginal, tipoMime: tipo, bytes: bytes.byteLength, pieza, descripcion } },
      },
      ahora,
      contexto,
    );
  });
  return { ok: true, registro, adjuntoId };
}

export interface AdjuntoClinico {
  id: string;
  descripcion: string | null;
  nombreOriginal: string;
  tipoMime: string;
  bytes: number;
  pieza: number | null;
  sha256: string;
  subidoEn: Date;
  subidoPor: string;
}

/** Adjuntos de una historia clínica (sin leer los archivos). */
export async function listarAdjuntosClinicos(db: BaseDeDatos, usuario: UsuarioConRoles, historiaClinicaId: string): Promise<AdjuntoClinico[]> {
  if (!puede(usuario, 'hc.ver')) throw new ErrorDePermiso('No tenés acceso a la historia clínica.');
  const filas = await db
    .select({ adjunto: adjuntos, nombre: usuarios.nombre, apellido: usuarios.apellido })
    .from(adjuntos)
    .innerJoin(usuarios, eq(usuarios.id, adjuntos.subidoPor))
    .where(and(eq(adjuntos.historiaClinicaId, historiaClinicaId), eq(adjuntos.ambito, 'clinico')))
    .orderBy(desc(adjuntos.subidoEn));
  return filas.map(({ adjunto: a, nombre, apellido }) => ({
    id: a.id,
    descripcion: a.descripcion,
    nombreOriginal: a.nombreOriginal,
    tipoMime: a.tipoMime,
    bytes: a.bytes,
    pieza: a.pieza,
    sha256: a.sha256,
    subidoEn: a.subidoEn,
    subidoPor: `${nombre} ${apellido}`,
  }));
}

export type LecturaAdjunto =
  | { estado: 'ok'; bytes: Uint8Array; tipo: string; nombre: string }
  | { estado: 'no_existe' }
  /** El archivo guardado no coincide con la huella firmada: alguien lo alteró. */
  | { estado: 'alterado' };

/** Lee un adjunto clínico para verlo o descargarlo. Solo profesionales, y queda en la auditoría. */
export async function leerAdjuntoClinico(
  db: BaseDeDatos,
  almacen: AlmacenArchivos,
  usuario: UsuarioConRoles,
  entrada: { pacienteId: string; adjuntoId: string; modo: 'ver' | 'descargar' },
  contexto: ContextoAuditoria = {},
): Promise<LecturaAdjunto> {
  if (!puede(usuario, 'hc.ver')) throw new ErrorDePermiso('No tenés acceso a la historia clínica.');
  if (!UUID.test(entrada.adjuntoId) || !UUID.test(entrada.pacienteId)) return { estado: 'no_existe' };
  const [adjunto] = await db
    .select()
    .from(adjuntos)
    .where(and(eq(adjuntos.id, entrada.adjuntoId), eq(adjuntos.pacienteId, entrada.pacienteId), eq(adjuntos.ambito, 'clinico')));
  if (!adjunto) return { estado: 'no_existe' };

  const bytes = await almacen.leer(adjunto.storageKey);
  const integro = bytes !== null && sha256De(bytes) === adjunto.sha256;
  await auditar(db, {
    ...contexto,
    usuarioId: usuario.id,
    accion: entrada.modo === 'descargar' ? 'adjunto.descargar' : 'adjunto.ver',
    entidad: 'adjunto',
    entidadId: adjunto.id,
    pacienteId: adjunto.pacienteId,
    detalle: integro ? null : { problema: bytes ? 'no coincide con su huella' : 'no se encontró el archivo' },
  });
  if (!bytes) return { estado: 'no_existe' };
  if (!integro) return { estado: 'alterado' };
  return { estado: 'ok', bytes, tipo: adjunto.tipoMime, nombre: adjunto.nombreOriginal };
}
