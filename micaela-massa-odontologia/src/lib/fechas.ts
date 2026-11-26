/**
 * Fechas y horas del consultorio. El servidor puede correr en UTC; la agenda
 * siempre se piensa en hora argentina. Argentina no usa horario de verano desde
 * 2009, así que el desfase es fijo (UTC-3).
 */
export const ZONA_HORARIA = 'America/Argentina/Buenos_Aires';
const DESFASE = '-03:00';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export function esFechaValida(fecha: string): boolean {
  if (!FECHA.test(fecha)) return false;
  const d = new Date(`${fecha}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === fecha;
}

export const esHoraValida = (hora: string): boolean => HORA.test(hora);

/** Fecha de hoy en Argentina, como YYYY-MM-DD. */
export function hoyEnArgentina(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

/** "2026-11-18" + "09:30" en hora argentina → instante. */
export function fechaHoraArgentina(fecha: string, hora: string): Date {
  if (!esFechaValida(fecha) || !esHoraValida(hora)) throw new RangeError(`Fecha u hora inválida: ${fecha} ${hora}`);
  return new Date(`${fecha}T${hora}:00${DESFASE}`);
}

/** Desde las 00:00 hasta las 24:00 de ese día en Argentina. */
export function rangoDelDia(fecha: string): { desde: Date; hasta: Date } {
  return { desde: fechaHoraArgentina(fecha, '00:00'), hasta: fechaHoraArgentina(sumarDias(fecha, 1), '00:00') };
}

export function sumarDias(fecha: string, dias: number): string {
  if (!esFechaValida(fecha)) throw new RangeError(`Fecha inválida: ${fecha}`);
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** 09:30 */
export function formatoHora(instante: Date): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: ZONA_HORARIA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(instante);
}

/** Fecha (YYYY-MM-DD) de un instante, en Argentina. */
export const fechaDe = (instante: Date): string => hoyEnArgentina(instante);

/** "miércoles 18 de noviembre" */
export function formatoFechaLarga(fecha: string): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${fecha}T12:00:00Z`))
    .replace(',', '');
}

/** "miércoles 18 de noviembre" → "Miércoles 18 de noviembre" */
export const capitalizar = (texto: string): string => texto.charAt(0).toUpperCase() + texto.slice(1);

/** "18/11/2026" */
export function formatoFechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}

/**
 * Suma meses a una fecha YYYY-MM-DD. Si el día no existe en el mes de llegada
 * se usa el último día del mes: 31/08 + 6 meses = 28/02.
 */
export function sumarMeses(fecha: string, meses: number): string {
  if (!esFechaValida(fecha)) throw new RangeError(`Fecha inválida: ${fecha}`);
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  const indice = anio * 12 + (mes - 1) + meses;
  const anioNuevo = Math.floor(indice / 12);
  const mesNuevo = indice - anioNuevo * 12 + 1;
  const ultimoDia = new Date(Date.UTC(anioNuevo, mesNuevo, 0)).getUTCDate();
  return `${String(anioNuevo).padStart(4, '0')}-${String(mesNuevo).padStart(2, '0')}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
}

/** Días entre dos fechas YYYY-MM-DD (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  if (!esFechaValida(desde) || !esFechaValida(hasta)) throw new RangeError(`Fecha inválida: ${desde} o ${hasta}`);
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}
