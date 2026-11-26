import { describe, expect, it } from 'vitest';
import { enlaceWhatsAppSeguimiento, textoWhatsAppSeguimiento } from './mensajes';
import {
  TIPOS_ACCION_PENDIENTE,
  diasSinContacto,
  estadoTrasContacto,
  hayQueAvisarAProfesional,
  intentosSinRespuesta,
  ordenarPendientes,
  validarFechaDeContacto,
  type PendienteParaOrdenar,
} from './tablero';

describe('intentos de contacto', () => {
  it('cuenta los intentos seguidos sin respuesta', () => {
    expect(intentosSinRespuesta([])).toBe(0);
    expect(
      intentosSinRespuesta([
        { tipo: 'creado' },
        { tipo: 'contacto', respuesta: 'no_contesta' },
        { tipo: 'tomado' },
        { tipo: 'contacto', respuesta: 'no_contesta' },
      ]),
    ).toBe(2);
  });

  it('si contesta, vuelve a cero', () => {
    expect(
      intentosSinRespuesta([
        { tipo: 'contacto', respuesta: 'no_contesta' },
        { tipo: 'contacto', respuesta: 'lo_piensa' },
        { tipo: 'contacto', respuesta: 'no_contesta' },
      ]),
    ).toBe(1);
    expect(intentosSinRespuesta([{ tipo: 'contacto', respuesta: 'no_contesta' }, { tipo: 'reabierto' }])).toBe(0);
  });

  it('al tercer intento sin respuesta pasa a "No responde"', () => {
    expect(estadoTrasContacto({ estado: 'abierto', intentosSinRespuesta: 0 }, 'no_contesta')).toEqual({ estado: 'en_curso', intentosSinRespuesta: 1, pasaANoResponde: false });
    const tercero = estadoTrasContacto({ estado: 'en_curso', intentosSinRespuesta: 2 }, 'no_contesta');
    expect(tercero).toEqual({ estado: 'no_responde', intentosSinRespuesta: 3, pasaANoResponde: true });
    // Un cuarto intento no vuelve a avisar.
    expect(estadoTrasContacto({ estado: 'no_responde', intentosSinRespuesta: 3 }, 'no_contesta').pasaANoResponde).toBe(false);
    // Si después contesta, vuelve a estar en curso.
    expect(estadoTrasContacto({ estado: 'no_responde', intentosSinRespuesta: 4 }, 'quiere_turno')).toMatchObject({ estado: 'en_curso', intentosSinRespuesta: 0 });
  });

  it('solo le avisa a la profesional si era importante', () => {
    const tercero = estadoTrasContacto({ estado: 'en_curso', intentosSinRespuesta: 2 }, 'no_contesta');
    expect(hayQueAvisarAProfesional(tercero, { importante: true, profesionalId: 'mica' })).toBe(true);
    expect(hayQueAvisarAProfesional(tercero, { importante: false, profesionalId: 'mica' })).toBe(false);
    expect(hayQueAvisarAProfesional(tercero, { importante: true, profesionalId: null })).toBe(false);
  });

  it('no deja registrar contactos en un pendiente cerrado', () => {
    expect(() => estadoTrasContacto({ estado: 'resuelto', intentosSinRespuesta: 0 }, 'no_contesta')).toThrow();
  });

  it('el historial distingue el tipo de acción', () => {
    expect(TIPOS_ACCION_PENDIENTE).toContain('nueva_fecha');
  });
});

describe('volver a contactar el…', () => {
  it('acepta desde hoy y hasta un año', () => {
    expect(validarFechaDeContacto('2026-12-10', '2026-11-26')).toBeNull();
    expect(validarFechaDeContacto('2026-11-26', '2026-11-26')).toBeNull();
    expect(validarFechaDeContacto('2026-11-25', '2026-11-26')).toMatch(/ya pasó/);
    expect(validarFechaDeContacto('2028-01-01', '2026-11-26')).toMatch(/más de un año/);
    expect(validarFechaDeContacto('2026-02-30', '2026-11-26')).toMatch(/no es válida/);
  });
});

describe('orden de la bandeja', () => {
  const pendiente = (id: string, cambios: Partial<PendienteParaOrdenar>): PendienteParaOrdenar & { id: string } => ({
    id,
    prioridad: 'media',
    estado: 'abierto',
    escaladoAId: null,
    ultimoMovimiento: '2026-11-20',
    desde: new Date('2026-11-20T12:00:00Z'),
    ...cambios,
  });

  it('primero lo que le llegó a quien mira, después prioridad y días sin contacto', () => {
    const lista = [
      pendiente('media-reciente', { ultimoMovimiento: '2026-11-25' }),
      pendiente('baja', { prioridad: 'baja', ultimoMovimiento: '2026-10-01' }),
      pendiente('alta', { prioridad: 'alta' }),
      pendiente('media-vieja', { ultimoMovimiento: '2026-11-02' }),
      pendiente('para-mica', { prioridad: 'baja', estado: 'no_responde', escaladoAId: 'mica' }),
    ];
    expect(ordenarPendientes(lista, 'mica').map((p) => p.id)).toEqual(['para-mica', 'alta', 'media-vieja', 'media-reciente', 'baja']);
    // Para una secretaria, el escalado no se adelanta.
    expect(ordenarPendientes(lista, 'sofia').map((p) => p.id)).toEqual(['alta', 'media-vieja', 'media-reciente', 'baja', 'para-mica']);
  });

  it('calcula los días sin contacto', () => {
    expect(diasSinContacto({ ultimoMovimiento: '2026-11-20' }, '2026-11-26')).toBe(6);
    expect(diasSinContacto({ ultimoMovimiento: '2026-11-27' }, '2026-11-26')).toBe(0);
  });
});

describe('WhatsApp de seguimiento', () => {
  it('cambia según el motivo y nunca lleva datos clínicos', () => {
    expect(textoWhatsAppSeguimiento('ausente_sin_reprogramar', 'Martín')).toMatch(/no pudiste venir/);
    expect(textoWhatsAppSeguimiento('presupuesto_sin_respuesta', 'Valeria')).toMatch(/presupuesto/);
    expect(textoWhatsAppSeguimiento('tratamiento_sin_turno', 'Carlos')).toMatch(/próximo turno/);
    const enlace = enlaceWhatsAppSeguimiento({ telefono: '011 15 2345-6789', nombrePaciente: 'Carlos', tipo: 'tratamiento_sin_turno' });
    expect(enlace.startsWith('https://wa.me/5491123456789?text=')).toBe(true);
    expect(decodeURIComponent(enlace)).not.toMatch(/endodoncia|tratamiento|conducto/i);
  });
});
