/**
 * Piezas dentarias en notación FDI (ISO 3950), la usada en Argentina y por OSDE.
 *
 * - Permanentes: cuadrantes 1 a 4, piezas 1 a 8 (11-18, 21-28, 31-38, 41-48).
 * - Temporales (de leche): cuadrantes 5 a 8, piezas 1 a 5 (51-55, 61-65, 71-75, 81-85).
 */

/**
 * Las cinco caras, con un código canónico que se guarda en la base.
 * El nombre que ve el profesional depende de la pieza: `L` es "palatina" en el
 * maxilar superior y "lingual" en el inferior; `O` es "incisal" en anteriores.
 */
export const CARAS = ['M', 'D', 'V', 'L', 'O'] as const;
export type Cara = (typeof CARAS)[number];

export type Denticion = 'permanente' | 'temporal';
export type VistaDenticion = Denticion | 'mixta';

export const cuadrante = (pieza: number): number => Math.floor(pieza / 10);
export const posicion = (pieza: number): number => pieza % 10;

export function esPiezaValida(pieza: number): boolean {
  if (!Number.isInteger(pieza)) return false;
  const c = cuadrante(pieza);
  const p = posicion(pieza);
  if (c >= 1 && c <= 4) return p >= 1 && p <= 8;
  if (c >= 5 && c <= 8) return p >= 1 && p <= 5;
  return false;
}

function asegurarPieza(pieza: number): void {
  if (!esPiezaValida(pieza)) throw new RangeError(`Pieza FDI inválida: ${pieza}`);
}

export function denticionDe(pieza: number): Denticion {
  asegurarPieza(pieza);
  return cuadrante(pieza) <= 4 ? 'permanente' : 'temporal';
}

export function esSuperior(pieza: number): boolean {
  asegurarPieza(pieza);
  return [1, 2, 5, 6].includes(cuadrante(pieza));
}

/** Incisivos y caninos (posiciones 1 a 3): tienen borde incisal en lugar de cara oclusal. */
export function esAnterior(pieza: number): boolean {
  asegurarPieza(pieza);
  return posicion(pieza) <= 3;
}

export function nombreCara(pieza: number, cara: Cara): string {
  switch (cara) {
    case 'M':
      return 'Mesial';
    case 'D':
      return 'Distal';
    case 'V':
      return 'Vestibular';
    case 'L':
      return esSuperior(pieza) ? 'Palatina' : 'Lingual';
    case 'O':
      return esAnterior(pieza) ? 'Incisal' : 'Oclusal';
  }
}

/**
 * El odontograma se dibuja como lo ve el profesional de frente al paciente:
 * el lado derecho del paciente (cuadrantes 1, 4, 5 y 8) queda a la izquierda
 * del dibujo, y su cara mesial (hacia la línea media) queda a la derecha.
 */
export function mesialALaDerecha(pieza: number): boolean {
  asegurarPieza(pieza);
  return [1, 4, 5, 8].includes(cuadrante(pieza));
}

/** Qué cara corresponde a cada zona del dibujo de cinco sectores de una pieza. */
export function ubicacionCaras(pieza: number): Record<'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'centro', Cara> {
  const superior = esSuperior(pieza);
  const mesialDerecha = mesialALaDerecha(pieza);
  return {
    arriba: superior ? 'V' : 'L',
    abajo: superior ? 'L' : 'V',
    izquierda: mesialDerecha ? 'D' : 'M',
    derecha: mesialDerecha ? 'M' : 'D',
    centro: 'O',
  };
}

const rango = (desde: number, hasta: number): number[] => {
  const paso = desde <= hasta ? 1 : -1;
  return Array.from({ length: Math.abs(hasta - desde) + 1 }, (_, i) => desde + i * paso);
};

export interface FilaOdontograma {
  clave: string;
  /** Piezas en el orden en que se dibujan, de izquierda a derecha. */
  izquierda: number[];
  derecha: number[];
}

/** Filas a dibujar según la dentición: permanente, temporal o mixta (las dos). */
export function filasOdontograma(vista: VistaDenticion): FilaOdontograma[] {
  const permanenteSuperior: FilaOdontograma = { clave: 'permanente-superior', izquierda: rango(18, 11), derecha: rango(21, 28) };
  const permanenteInferior: FilaOdontograma = { clave: 'permanente-inferior', izquierda: rango(48, 41), derecha: rango(31, 38) };
  const temporalSuperior: FilaOdontograma = { clave: 'temporal-superior', izquierda: rango(55, 51), derecha: rango(61, 65) };
  const temporalInferior: FilaOdontograma = { clave: 'temporal-inferior', izquierda: rango(85, 81), derecha: rango(71, 75) };
  switch (vista) {
    case 'permanente':
      return [permanenteSuperior, permanenteInferior];
    case 'temporal':
      return [temporalSuperior, temporalInferior];
    case 'mixta':
      return [permanenteSuperior, temporalSuperior, temporalInferior, permanenteInferior];
  }
}

export const TODAS_LAS_PIEZAS: readonly number[] = filasOdontograma('mixta').flatMap((f) => [...f.izquierda, ...f.derecha]);
