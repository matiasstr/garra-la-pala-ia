import { HALLAZGOS, type CodigoHallazgo, type EstadoMarca } from './catalogo';
import { esPiezaValida, type Cara } from './piezas';

/**
 * Una marca del odontograma. Las marcas nunca se modifican ni se borran: el
 * odontograma de hoy es el resultado de aplicar todas las marcas en orden.
 * Así se puede reconstruir cómo estaba la boca en cualquier fecha.
 *
 * Para cambiar algo (una caries que se obturó, o una marca cargada por error)
 * se agrega una marca nueva que reemplaza a la anterior.
 */
export interface MarcaOdontograma {
  id: string;
  pieza: number;
  /** `null` cuando el hallazgo es de la pieza completa (corona, ausente, etc.). */
  cara: Cara | null;
  hallazgo: CodigoHallazgo;
  estado: EstadoMarca;
  /** Momento de la firma del registro clínico que incorporó la marca. */
  registradaEn: Date;
  /** Marca anterior que esta reemplaza. */
  reemplazaA?: string | null;
  /** Si `true`, la marca solo anula a la que reemplaza (corrección de un error) y no se dibuja. */
  anulacion?: boolean;
  /** Código de nomenclador de la prestación, si corresponde. */
  prestacionCodigo?: string | null;
}

export type MarcaNueva = Omit<MarcaOdontograma, 'id' | 'registradaEn'>;

/** Errores de una marca nueva frente a las marcas ya registradas. Vacío = válida. */
export function validarMarca(marca: MarcaNueva, existentes: readonly MarcaOdontograma[] = []): string[] {
  const errores: string[] = [];
  if (!esPiezaValida(marca.pieza)) errores.push(`La pieza ${marca.pieza} no existe en notación FDI.`);

  const definicion = HALLAZGOS[marca.hallazgo];
  if (!definicion) {
    errores.push(`Hallazgo desconocido: ${marca.hallazgo}.`);
  } else {
    if (definicion.ambito === 'cara' && marca.cara === null) errores.push(`"${definicion.nombre}" se marca sobre una cara.`);
    if (definicion.ambito === 'pieza' && marca.cara !== null) errores.push(`"${definicion.nombre}" se marca sobre la pieza completa.`);
    if (marca.estado === 'pendiente' && !definicion.admitePendiente) errores.push(`"${definicion.nombre}" no puede quedar como pendiente.`);
  }

  if (marca.anulacion && !marca.reemplazaA) errores.push('Una anulación tiene que indicar qué marca anula.');
  if (marca.reemplazaA) {
    const anterior = existentes.find((m) => m.id === marca.reemplazaA);
    if (!anterior) errores.push('La marca que se quiere reemplazar no existe.');
    else if (anterior.pieza !== marca.pieza) errores.push('Solo se puede reemplazar una marca de la misma pieza.');
    else if (existentes.some((m) => m.reemplazaA === anterior.id)) errores.push('Esa marca ya fue reemplazada.');
  }
  return errores;
}

export interface EstadoPieza {
  pieza: number;
  /** Marcas vigentes por cara. */
  caras: Partial<Record<Cara, MarcaOdontograma[]>>;
  /** Marcas vigentes de la pieza completa. */
  completa: MarcaOdontograma[];
}

/**
 * Estado del odontograma a una fecha (por defecto, hoy).
 * Devuelve solo las piezas que tienen alguna marca vigente.
 */
export function calcularOdontograma(marcas: readonly MarcaOdontograma[], hasta?: Date): Map<number, EstadoPieza> {
  const enRango = marcas
    .filter((m) => !hasta || m.registradaEn.getTime() <= hasta.getTime())
    .toSorted((a, b) => a.registradaEn.getTime() - b.registradaEn.getTime());

  const reemplazadas = new Set(enRango.flatMap((m) => (m.reemplazaA ? [m.reemplazaA] : [])));
  const estado = new Map<number, EstadoPieza>();

  for (const marca of enRango) {
    if (reemplazadas.has(marca.id) || marca.anulacion) continue;
    const pieza = estado.get(marca.pieza) ?? { pieza: marca.pieza, caras: {}, completa: [] };
    if (marca.cara === null) pieza.completa.push(marca);
    else (pieza.caras[marca.cara] ??= []).push(marca);
    estado.set(marca.pieza, pieza);
  }
  return estado;
}

/** Marcas en rojo (a realizar) vigentes: alimentan el plan de tratamiento y el seguimiento. */
export function marcasPendientes(estado: ReadonlyMap<number, EstadoPieza>): MarcaOdontograma[] {
  return [...estado.values()].flatMap((p) => [...p.completa, ...Object.values(p.caras).flat()]).filter((m) => m.estado === 'pendiente');
}
