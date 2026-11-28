import { describe, expect, it } from 'vitest';
import { enlaceRecordatorioWhatsApp, esEstadoFinal, normalizarTelefonoArgentino, puedeCambiarEstado } from './turnos';

describe('estados de turno', () => {
  it('permite el recorrido normal y bloquea saltos inválidos', () => {
    expect(puedeCambiarEstado('reservado', 'confirmado')).toBe(true);
    expect(puedeCambiarEstado('confirmado', 'en_sala')).toBe(true);
    expect(puedeCambiarEstado('en_sala', 'atendido')).toBe(true);
    expect(puedeCambiarEstado('atendido', 'cancelado')).toBe(false);
    expect(puedeCambiarEstado('reservado', 'atendido')).toBe(false);
  });

  it('un ausente solo se puede reprogramar', () => {
    expect(puedeCambiarEstado('ausente', 'reprogramado')).toBe(true);
    expect(puedeCambiarEstado('ausente', 'confirmado')).toBe(false);
    expect(esEstadoFinal('atendido')).toBe(true);
  });
});

describe('recordatorio por WhatsApp', () => {
  it('normaliza celulares argentinos', () => {
    expect(normalizarTelefonoArgentino('011 15 2345-6789')).toBe('5491123456789');
    expect(normalizarTelefonoArgentino('+54 9 351 234 5678')).toBe('5493512345678');
    expect(normalizarTelefonoArgentino('0351 15 234-5678')).toBe('5493512345678');
    expect(normalizarTelefonoArgentino('11 2345 6789')).toBe('5491123456789');
  });

  it('arma el enlace sin información clínica', () => {
    const enlace = enlaceRecordatorioWhatsApp({
      telefono: '11 2345 6789',
      nombrePaciente: 'Ana',
      inicio: new Date('2026-11-20T13:30:00Z'),
      profesional: 'la Dra. Massa',
    });
    expect(enlace.startsWith('https://wa.me/5491123456789?text=')).toBe(true);
    const texto = decodeURIComponent(enlace.split('text=')[1] ?? '');
    expect(texto).toContain('10:30');
    expect(texto).toContain('viernes');
  });
});
