import { describe, expect, it } from 'vitest';
import { MAXIMO_INTENTOS_PIN, MINUTOS_BLOQUEO_PIN, bloqueadoHasta, esPinDebil, registrarIntentoPin, validarFormatoPin, validarPinNuevo, type EstadoIntentosPin } from './pin';

describe('formato del PIN de firma', () => {
  it('acepta de 4 a 8 números', () => {
    expect(validarFormatoPin('1234')).toEqual([]);
    expect(validarFormatoPin('84736251')).toEqual([]);
    expect(validarFormatoPin('123')).toHaveLength(1);
    expect(validarFormatoPin('123456789')).toHaveLength(1);
    expect(validarFormatoPin('12a4')).toHaveLength(1);
    expect(validarFormatoPin(' 1234')).toHaveLength(1);
    expect(validarFormatoPin('')).toHaveLength(1);
  });

  it('rechaza PIN nuevos fáciles de adivinar o que no coinciden', () => {
    expect(esPinDebil('1111')).toBe(true);
    expect(esPinDebil('1234')).toBe(true);
    expect(esPinDebil('98765')).toBe(true);
    expect(esPinDebil('2580')).toBe(false);
    expect(validarPinNuevo('1234', '1234')).toHaveLength(1);
    expect(validarPinNuevo('2580', '2581')).toEqual(['Los dos PIN nuevos no coinciden.']);
    expect(validarPinNuevo('2580', '2580')).toEqual([]);
  });
});

describe('bloqueo por intentos fallidos', () => {
  const ahora = new Date('2026-11-20T13:00:00Z');
  const limpio: EstadoIntentosPin = { intentosFallidos: 0, bloqueadoHasta: null };

  it('cuenta los intentos fallidos y avisa cuántos quedan', () => {
    const primero = registrarIntentoPin(limpio, false, ahora);
    expect(primero).toMatchObject({ resultado: 'incorrecto', intentosRestantes: MAXIMO_INTENTOS_PIN - 1 });
    expect(primero.estado.intentosFallidos).toBe(1);
  });

  it('un acierto vuelve a cero', () => {
    expect(registrarIntentoPin({ intentosFallidos: 3, bloqueadoHasta: null }, true, ahora)).toEqual({ resultado: 'correcto', estado: limpio });
  });

  it(`al ${MAXIMO_INTENTOS_PIN}.º fallo bloquea ${MINUTOS_BLOQUEO_PIN} minutos`, () => {
    let estado = limpio;
    for (let i = 1; i < MAXIMO_INTENTOS_PIN; i++) estado = registrarIntentoPin(estado, false, ahora).estado;
    const ultimo = registrarIntentoPin(estado, false, ahora);
    expect(ultimo.resultado).toBe('bloqueado');
    if (ultimo.resultado !== 'bloqueado') return;
    expect(ultimo.hasta.getTime() - ahora.getTime()).toBe(MINUTOS_BLOQUEO_PIN * 60_000);
    expect(bloqueadoHasta(ultimo.estado, ahora)).toEqual(ultimo.hasta);
  });

  it('mientras está bloqueado ni el PIN correcto sirve, y después se desbloquea', () => {
    const hasta = new Date(ahora.getTime() + 10 * 60_000);
    const bloqueado: EstadoIntentosPin = { intentosFallidos: 0, bloqueadoHasta: hasta };
    expect(registrarIntentoPin(bloqueado, true, ahora)).toMatchObject({ resultado: 'bloqueado', hasta });
    const despues = new Date(hasta.getTime() + 1);
    expect(bloqueadoHasta(bloqueado, despues)).toBeNull();
    expect(registrarIntentoPin(bloqueado, true, despues).resultado).toBe('correcto');
  });
});
