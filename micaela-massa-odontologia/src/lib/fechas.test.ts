import { describe, expect, it } from 'vitest';
import { diasEntre, esFechaValida, fechaHoraArgentina, formatoFechaLarga, formatoHora, hoyEnArgentina, rangoDelDia, sumarDias, sumarMeses } from './fechas';

describe('fechas del consultorio', () => {
  it('interpreta la hora en Argentina aunque el servidor esté en UTC', () => {
    expect(fechaHoraArgentina('2026-11-18', '09:30').toISOString()).toBe('2026-11-18T12:30:00.000Z');
    expect(formatoHora(new Date('2026-11-18T12:30:00Z'))).toBe('09:30');
  });

  it('el día argentino cambia a las 3 de la mañana UTC', () => {
    expect(hoyEnArgentina(new Date('2026-11-18T02:59:00Z'))).toBe('2026-11-17');
    expect(hoyEnArgentina(new Date('2026-11-18T03:00:00Z'))).toBe('2026-11-18');
    const { desde, hasta } = rangoDelDia('2026-11-18');
    expect(desde.toISOString()).toBe('2026-11-18T03:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-11-19T03:00:00.000Z');
  });

  it('valida y suma días cruzando meses', () => {
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('2026-11-18')).toBe(true);
    expect(sumarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('formatea la fecha larga en castellano', () => {
    expect(formatoFechaLarga('2026-11-18')).toBe('miércoles 18 de noviembre');
  });

  it('suma meses y usa el último día si el mes es más corto', () => {
    expect(sumarMeses('2026-11-26', 6)).toBe('2027-05-26');
    expect(sumarMeses('2026-08-31', 6)).toBe('2027-02-28');
    expect(sumarMeses('2027-11-30', 3)).toBe('2028-02-29');
    expect(sumarMeses('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('cuenta los días entre dos fechas', () => {
    expect(diasEntre('2026-11-26', '2026-12-10')).toBe(14);
    expect(diasEntre('2026-12-10', '2026-11-26')).toBe(-14);
    expect(diasEntre('2026-02-27', '2026-03-01')).toBe(2);
  });
});
