/**
 * Catálogo de hallazgos y prestaciones que se marcan en el odontograma.
 *
 * Convención argentina de colores:
 * - Rojo: lo que hay que hacer (patología o prestación indicada).
 * - Azul: lo que ya está hecho (en este consultorio o antes de llegar).
 *
 * El código de nomenclador (OSDE o particular) va aparte, en cada marca o en
 * el plan de tratamiento, para no atar el dibujo a un financiador.
 */
export type AmbitoHallazgo = 'cara' | 'pieza';

interface DefinicionHallazgo {
  nombre: string;
  /** Abreviatura que se dibuja debajo de la pieza cuando el hallazgo es de pieza completa. */
  abreviatura: string;
  ambito: AmbitoHallazgo;
  /** Algunos hallazgos son solo un estado (una pieza ausente no "se hace"). */
  admitePendiente: boolean;
}

export const HALLAZGOS = {
  caries: { nombre: 'Caries', abreviatura: 'CA', ambito: 'cara', admitePendiente: true },
  restauracion: { nombre: 'Restauración / obturación', abreviatura: 'OB', ambito: 'cara', admitePendiente: true },
  sellador: { nombre: 'Sellador de fosas y fisuras', abreviatura: 'SE', ambito: 'cara', admitePendiente: true },
  fractura: { nombre: 'Fractura', abreviatura: 'FR', ambito: 'pieza', admitePendiente: true },
  endodoncia: { nombre: 'Tratamiento de conducto', abreviatura: 'TC', ambito: 'pieza', admitePendiente: true },
  perno: { nombre: 'Perno / muñón', abreviatura: 'PE', ambito: 'pieza', admitePendiente: true },
  corona: { nombre: 'Corona', abreviatura: 'CO', ambito: 'pieza', admitePendiente: true },
  extraccion: { nombre: 'Extracción', abreviatura: 'EX', ambito: 'pieza', admitePendiente: true },
  ausente: { nombre: 'Pieza ausente', abreviatura: 'AU', ambito: 'pieza', admitePendiente: false },
  implante: { nombre: 'Implante', abreviatura: 'IM', ambito: 'pieza', admitePendiente: true },
  protesis_fija: { nombre: 'Prótesis fija', abreviatura: 'PF', ambito: 'pieza', admitePendiente: true },
  protesis_removible: { nombre: 'Prótesis removible', abreviatura: 'PR', ambito: 'pieza', admitePendiente: true },
} as const satisfies Record<string, DefinicionHallazgo>;

export type CodigoHallazgo = keyof typeof HALLAZGOS;
export const CODIGOS_HALLAZGO = Object.keys(HALLAZGOS) as [CodigoHallazgo, ...CodigoHallazgo[]];

/**
 * - `pendiente`: indicado, a realizar (rojo).
 * - `realizado`: hecho en este consultorio (azul).
 * - `preexistente`: ya estaba cuando llegó el paciente (azul).
 */
export const ESTADOS_MARCA = ['pendiente', 'realizado', 'preexistente'] as const;
export type EstadoMarca = (typeof ESTADOS_MARCA)[number];

export const COLOR_ESTADO: Record<EstadoMarca, 'rojo' | 'azul'> = {
  pendiente: 'rojo',
  realizado: 'azul',
  preexistente: 'azul',
};

export const NOMBRE_ESTADO: Record<EstadoMarca, string> = {
  pendiente: 'A realizar',
  realizado: 'Realizado',
  preexistente: 'Preexistente',
};
