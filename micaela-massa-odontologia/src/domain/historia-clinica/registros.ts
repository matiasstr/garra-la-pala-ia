import { CODIGOS_HALLAZGO, ESTADOS_MARCA, type CodigoHallazgo, type EstadoMarca } from '../odontograma/catalogo';
import { CARAS, type Cara } from '../odontograma/piezas';

/**
 * Cómo se lee y se ordena lo que ya está firmado en la historia clínica.
 * El contenido de cada registro es el JSON que se firmó: acá se interpreta
 * para mostrarlo, sin confiar en que tenga una forma fija (los registros viejos
 * se tienen que poder leer siempre).
 */

export const TIPOS_REGISTRO = ['anamnesis', 'evolucion', 'diagnostico', 'odontograma', 'plan_tratamiento', 'consentimiento', 'adjunto', 'enmienda'] as const;
export type TipoRegistroClinico = (typeof TIPOS_REGISTRO)[number];

export const NOMBRE_TIPO_REGISTRO: Record<TipoRegistroClinico, string> = {
  anamnesis: 'Anamnesis',
  evolucion: 'Evolución',
  diagnostico: 'Diagnóstico',
  odontograma: 'Odontograma',
  plan_tratamiento: 'Plan de tratamiento',
  consentimiento: 'Consentimiento',
  adjunto: 'Archivo adjunto',
  enmienda: 'Enmienda',
};

export const LARGO_MAXIMO_TEXTO_CLINICO = 10_000;

/** Errores del texto de una evolución o enmienda. */
export function validarTextoClinico(texto: string): string[] {
  const limpio = texto.trim();
  if (!limpio) return ['Escribí el texto antes de firmar.'];
  if (limpio.length > LARGO_MAXIMO_TEXTO_CLINICO) return [`El texto es demasiado largo (máximo ${LARGO_MAXIMO_TEXTO_CLINICO.toLocaleString('es-AR')} caracteres).`];
  return [];
}

export interface Firmante {
  nombre: string;
  apellido: string;
  matricula: string;
}

export interface MarcaFirmada {
  id: string;
  pieza: number;
  cara: Cara | null;
  hallazgo: CodigoHallazgo;
  estado: EstadoMarca;
  reemplazaA: string | null;
  anulacion: boolean;
}

export interface AdjuntoCitado {
  id: string;
  sha256: string;
  nombreOriginal: string;
  tipoMime: string;
  bytes: number;
  pieza: number | null;
  descripcion: string;
}

export interface ContenidoLegible {
  texto: string | null;
  firmante: Firmante | null;
  marcas: MarcaFirmada[];
  adjunto: AdjuntoCitado | null;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const textoDe = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const numeroDe = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function leerFirmante(v: unknown): Firmante | null {
  if (!esObjeto(v)) return null;
  const nombre = textoDe(v.nombre);
  const apellido = textoDe(v.apellido);
  const matricula = textoDe(v.matricula);
  return nombre && apellido && matricula ? { nombre, apellido, matricula } : null;
}

function leerMarca(v: unknown): MarcaFirmada | null {
  if (!esObjeto(v)) return null;
  const pieza = numeroDe(v.pieza);
  const id = textoDe(v.id);
  const cara = v.cara === null || v.cara === undefined ? null : CARAS.find((c) => c === v.cara);
  const hallazgo = CODIGOS_HALLAZGO.find((h) => h === v.hallazgo);
  const estado = ESTADOS_MARCA.find((e) => e === v.estado);
  if (pieza === null || !id || cara === undefined || !hallazgo || !estado) return null;
  return { id, pieza, cara, hallazgo, estado, reemplazaA: textoDe(v.reemplazaA), anulacion: v.anulacion === true };
}

function leerAdjunto(v: unknown): AdjuntoCitado | null {
  if (!esObjeto(v)) return null;
  const id = textoDe(v.id);
  const sha256 = textoDe(v.sha256);
  const nombreOriginal = textoDe(v.nombreOriginal) ?? 'archivo';
  const tipoMime = textoDe(v.tipoMime) ?? 'application/octet-stream';
  if (!id || !sha256) return null;
  return { id, sha256, nombreOriginal, tipoMime, bytes: numeroDe(v.bytes) ?? 0, pieza: numeroDe(v.pieza), descripcion: textoDe(v.descripcion) ?? '' };
}

export function leerContenido(contenido: unknown): ContenidoLegible {
  if (!esObjeto(contenido)) return { texto: null, firmante: null, marcas: [], adjunto: null };
  const marcas = Array.isArray(contenido.marcas) ? contenido.marcas.map(leerMarca).filter((m): m is MarcaFirmada => m !== null) : [];
  return {
    texto: textoDe(contenido.texto) ?? textoDe(contenido.nota),
    firmante: leerFirmante(contenido.firmante),
    marcas,
    adjunto: leerAdjunto(contenido.adjunto),
  };
}

interface RegistroOrdenable {
  id: string;
  secuencia: number;
  enmiendaDe: string | null;
}

export interface EntradaLineaDeTiempo<R extends RegistroOrdenable> {
  registro: R;
  /** Enmiendas que corrigen este registro, de la más vieja a la más nueva. */
  enmiendas: R[];
  /** Si este registro es una enmienda: el registro que corrige. */
  corrige: R | null;
}

/** Registros de la más nueva a la más vieja, con cada enmienda vinculada a su original. */
export function armarLineaDeTiempo<R extends RegistroOrdenable>(registros: readonly R[]): EntradaLineaDeTiempo<R>[] {
  const porId = new Map(registros.map((r) => [r.id, r]));
  const ordenados = registros.toSorted((a, b) => b.secuencia - a.secuencia);
  return ordenados.map((registro) => ({
    registro,
    enmiendas: registros.filter((r) => r.enmiendaDe === registro.id).toSorted((a, b) => a.secuencia - b.secuencia),
    corrige: registro.enmiendaDe ? (porId.get(registro.enmiendaDe) ?? null) : null,
  }));
}

/** "2,4 MB", "830 KB": tamaño de un archivo para mostrar. */
export function tamanioLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
}
