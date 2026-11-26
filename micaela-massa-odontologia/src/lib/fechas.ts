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

/** De lunes a viernes (los feriados no se tienen en cuenta). */
export function esDiaHabil(fecha: string): boolean {
  if (!esFechaValida(fecha)) throw new RangeError(`Fecha inválida: ${fecha}`);
  const diaDeLaSemana = new Date(`${fecha}T12:00:00Z`).getUTCDay();
  return diaDeLaSemana !== 0 && diaDeLaSemana !== 6;
}

/** Los próximos `cantidad` días hábiles después de `fecha` (sin incluirla). */
export function proximosDiasHabiles(fecha: string, cantidad: number): string[] {
  const dias: string[] = [];
  for (let dia = sumarDias(fecha, 1); dias.length < cantidad; dia = sumarDias(dia, 1)) {
    if (esDiaHabil(dia)) dias.push(dia);
  }
  return dias;
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
