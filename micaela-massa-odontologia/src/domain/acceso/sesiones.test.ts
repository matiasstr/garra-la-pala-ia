import { describe, expect, it } from 'vitest';
import {
  BLOQUEO_POR_IP,
  BLOQUEO_POR_USUARIO,
  POLITICA_DE_SESION,
  bloqueadoHasta,
  estadoDeSesion,
  formatoDeTokenValido,
  generarToken,
  hashToken,
  hayQueRefrescarUso,
  huellaDeEmail,
  mensajeDeBloqueo,
  normalizarEmail,
} from './sesiones';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const inicio = new Date('2026-11-26T12:00:00Z');
const mas = (ms: number) => new Date(inicio.getTime() + ms);

describe('tokens de sesión', () => {
  it('son largos, al azar y se guardan como hash', () => {
    const token = generarToken();
    expect(formatoDeTokenValido(token)).toBe(true);
    expect(generarToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toBe(token);
    // El hash que está en la base no tiene formato de token: no sirve como cookie.
    expect(formatoDeTokenValido(hashToken(token))).toBe(false);
  });
});

describe('vencimiento de la sesión', () => {
  const activa = { creadaEn: inicio, verificadaEn: inicio, ultimoUsoEn: inicio, cerradaEn: null };

  it('se vence tras 12 horas sin uso', () => {
    expect(estadoDeSesion(activa, mas(11 * HORA))).toBe('activa');
    expect(estadoDeSesion(activa, mas(12 * HORA + 1))).toBe('vencida');
    expect(estadoDeSesion({ ...activa, ultimoUsoEn: mas(11 * HORA) }, mas(20 * HORA))).toBe('activa');
  });

  it('dura como máximo 7 días aunque se use todo el tiempo', () => {
    expect(estadoDeSesion({ ...activa, ultimoUsoEn: mas(7 * 24 * HORA) }, mas(7 * 24 * HORA + MINUTO))).toBe('vencida');
  });

  it('una sesión cerrada no vuelve', () => {
    expect(estadoDeSesion({ ...activa, cerradaEn: mas(MINUTO) }, mas(2 * MINUTO))).toBe('cerrada');
  });

  it('sin el código, solo sirve 10 minutos para escribirlo', () => {
    const aMedias = { ...activa, verificadaEn: null };
    expect(estadoDeSesion(aMedias, mas(9 * MINUTO))).toBe('falta_codigo');
    expect(estadoDeSesion(aMedias, mas(11 * MINUTO))).toBe('vencida');
  });

  it('la inactividad es configurable', () => {
    expect(estadoDeSesion(activa, mas(3 * HORA), { ...POLITICA_DE_SESION, inactividadMs: 2 * HORA })).toBe('vencida');
  });

  it('el último uso se actualiza cada 5 minutos, no en cada pedido', () => {
    expect(hayQueRefrescarUso(inicio, mas(MINUTO))).toBe(false);
    expect(hayQueRefrescarUso(inicio, mas(5 * MINUTO))).toBe(true);
  });
});

describe('bloqueo por intentos fallidos', () => {
  const fallos = (cantidad: number, cadaMs = MINUTO) => Array.from({ length: cantidad }, (_, i) => mas(i * cadaMs));

  it('por usuario: 5 fallos en 15 minutos bloquean 15 minutos desde el último', () => {
    expect(bloqueadoHasta(fallos(4), mas(5 * MINUTO), BLOQUEO_POR_USUARIO)).toBeNull();
    const hasta = bloqueadoHasta(fallos(5), mas(5 * MINUTO), BLOQUEO_POR_USUARIO);
    expect(hasta).toEqual(mas(4 * MINUTO + 15 * MINUTO));
    expect(bloqueadoHasta(fallos(5), mas(19 * MINUTO + 1), BLOQUEO_POR_USUARIO)).toBeNull();
  });

  it('fallos muy separados no bloquean', () => {
    expect(bloqueadoHasta(fallos(5, 10 * MINUTO), mas(41 * MINUTO), BLOQUEO_POR_USUARIO)).toBeNull();
  });

  it('por IP el límite es más alto (todo el consultorio comparte la IP)', () => {
    expect(bloqueadoHasta(fallos(19, 10_000), mas(4 * MINUTO), BLOQUEO_POR_IP)).toBeNull();
    expect(bloqueadoHasta(fallos(20, 10_000), mas(4 * MINUTO), BLOQUEO_POR_IP)).not.toBeNull();
  });

  it('el mensaje dice cuánto esperar y nada sobre el email', () => {
    expect(mensajeDeBloqueo(mas(12 * MINUTO), inicio)).toBe('Hubo demasiados intentos fallidos. Esperá 12 minutos y probá de nuevo.');
    expect(mensajeDeBloqueo(mas(10_000), inicio)).toContain('1 minuto ');
  });
});

describe('emails', () => {
  it('se comparan sin mayúsculas ni espacios, y para contar intentos se usa una huella', () => {
    expect(normalizarEmail('  Mica@Consultorio.COM ')).toBe('mica@consultorio.com');
    expect(huellaDeEmail('Mica@Consultorio.com')).toBe(huellaDeEmail('mica@consultorio.com '));
    expect(huellaDeEmail('mica@consultorio.com')).not.toContain('mica');
  });
});
