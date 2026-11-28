import { describe, expect, it } from 'vitest';
import { PLAZOS_REGRESO, contactarDesdeSegunPlazo, esPlazoLargo, fechaEsperadaDeRegreso, frasePlazo, tienePlazo } from './regreso';

describe('¿Cuándo debería volver?', () => {
  it('calcula la fecha esperada de cada plazo', () => {
    const visita = '2026-11-26';
    expect(fechaEsperadaDeRegreso(visita, 'unos_dias')).toBe('2026-11-29');
    expect(fechaEsperadaDeRegreso(visita, 'una_semana')).toBe('2026-12-03');
    expect(fechaEsperadaDeRegreso(visita, 'dos_semanas')).toBe('2026-12-10');
    expect(fechaEsperadaDeRegreso(visita, 'un_mes')).toBe('2026-12-26');
    expect(fechaEsperadaDeRegreso(visita, 'tres_meses')).toBe('2027-02-26');
    expect(fechaEsperadaDeRegreso(visita, 'seis_meses')).toBe('2027-05-26');
    expect(fechaEsperadaDeRegreso(visita, 'cuando_avise')).toBeNull();
    expect(fechaEsperadaDeRegreso(visita, 'no_hace_falta')).toBeNull();
  });

  it('si se fue sin turno, el pendiente aparece al día siguiente', () => {
    for (const plazo of ['unos_dias', 'una_semana', 'dos_semanas', 'un_mes'] as const) {
      expect(contactarDesdeSegunPlazo('2026-11-30', plazo)).toBe('2026-12-01');
    }
  });

  it('para 3 o 6 meses aparece 2 semanas antes de la fecha esperada', () => {
    expect(contactarDesdeSegunPlazo('2026-11-26', 'seis_meses')).toBe('2027-05-12');
    expect(contactarDesdeSegunPlazo('2026-11-26', 'tres_meses')).toBe('2027-02-12');
    expect(esPlazoLargo('tres_meses')).toBe(true);
    expect(esPlazoLargo('un_mes')).toBe(false);
  });

  it('"Cuando el paciente avise" y "No hace falta" no generan pendientes', () => {
    expect(PLAZOS_REGRESO.filter((p) => !tienePlazo(p))).toEqual(['cuando_avise', 'no_hace_falta']);
    expect(contactarDesdeSegunPlazo('2026-11-26', 'cuando_avise')).toBeNull();
  });

  it('lo dice en palabras simples', () => {
    expect(frasePlazo('unos_dias')).toBe('Vuelve en unos días');
    expect(frasePlazo('seis_meses')).toBe('Vuelve en 6 meses');
    expect(frasePlazo('cuando_avise')).toBe('Vuelve cuando el paciente avise');
    expect(frasePlazo('no_hace_falta')).toBe('No hace falta que vuelva');
  });
});
