/**
 * "¿Cuándo debería volver?": lo que indica la profesional al terminar un turno.
 *
 * No hay plazos clínicos fijos: el plazo lo decide la profesional en cada caso
 * y lo carga ella o la secretaria ("la Dra. dijo 15 días"). Con ese plazo se
 * calcula cuándo aparece el pendiente si el paciente se fue sin turno.
 */
import { sumarDias, sumarMeses } from '../../lib/fechas';

export const PLAZOS_REGRESO = ['unos_dias', 'una_semana', 'dos_semanas', 'un_mes', 'tres_meses', 'seis_meses', 'cuando_avise', 'no_hace_falta'] as const;
export type PlazoRegreso = (typeof PLAZOS_REGRESO)[number];

/** Texto de cada opción, tal como se muestra en los botones. */
export const NOMBRE_PLAZO: Record<PlazoRegreso, string> = {
  unos_dias: 'En unos días',
  una_semana: '1 semana',
  dos_semanas: '2 semanas',
  un_mes: '1 mes',
  tres_meses: '3 meses',
  seis_meses: '6 meses',
  cuando_avise: 'Cuando el paciente avise',
  no_hace_falta: 'No hace falta',
};

/** "Tenía que volver en …" */
export const PLAZO_EN_TEXTO: Record<PlazoRegreso, string> = {
  unos_dias: 'unos días',
  una_semana: '1 semana',
  dos_semanas: '2 semanas',
  un_mes: '1 mes',
  tres_meses: '3 meses',
  seis_meses: '6 meses',
  cuando_avise: 'cuando el paciente avise',
  no_hace_falta: 'no hace falta que vuelva',
};

/** "Vuelve en 2 semanas", "Vuelve cuando el paciente avise", "No hace falta que vuelva". */
export function frasePlazo(plazo: PlazoRegreso): string {
  if (plazo === 'no_hace_falta') return 'No hace falta que vuelva';
  if (plazo === 'cuando_avise') return 'Vuelve cuando el paciente avise';
  return `Vuelve en ${PLAZO_EN_TEXTO[plazo]}`;
}

const DURACION: Record<PlazoRegreso, { dias: number } | { meses: number } | null> = {
  unos_dias: { dias: 3 },
  una_semana: { dias: 7 },
  dos_semanas: { dias: 14 },
  un_mes: { meses: 1 },
  tres_meses: { meses: 3 },
  seis_meses: { meses: 6 },
  cuando_avise: null,
  no_hace_falta: null,
};

/** Para plazos largos, el pendiente aparece este tiempo antes de la fecha esperada. */
export const DIAS_DE_ANTICIPACION_PLAZO_LARGO = 14;

/** ¿El plazo tiene fecha? "Cuando el paciente avise" y "No hace falta" no generan pendientes. */
export const tienePlazo = (plazo: PlazoRegreso): boolean => DURACION[plazo] !== null;

/** 3 y 6 meses: son controles, el pendiente aparece 2 semanas antes. */
export const esPlazoLargo = (plazo: PlazoRegreso): boolean => plazo === 'tres_meses' || plazo === 'seis_meses';

/** Fecha en que debería volver, a partir del día de la visita (YYYY-MM-DD). */
export function fechaEsperadaDeRegreso(fechaVisita: string, plazo: PlazoRegreso): string | null {
  const duracion = DURACION[plazo];
  if (!duracion) return null;
  return 'dias' in duracion ? sumarDias(fechaVisita, duracion.dias) : sumarMeses(fechaVisita, duracion.meses);
}

/**
 * Desde qué día hay que contactarlo si se fue sin turno:
 * - plazos cortos: al día siguiente de la visita;
 * - 3 o 6 meses: 2 semanas antes de la fecha esperada.
 */
export function contactarDesdeSegunPlazo(fechaVisita: string, plazo: PlazoRegreso): string | null {
  const esperada = fechaEsperadaDeRegreso(fechaVisita, plazo);
  if (!esperada) return null;
  return esPlazoLargo(plazo) ? sumarDias(esperada, -DIAS_DE_ANTICIPACION_PLAZO_LARGO) : sumarDias(fechaVisita, 1);
}
