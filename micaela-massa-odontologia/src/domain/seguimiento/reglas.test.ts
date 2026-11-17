import { describe, expect, it } from 'vitest';
import { detectarPendientes } from './reglas';

const ahora = new Date('2026-11-17T12:00:00Z');
const haceHoras = (h: number) => new Date(ahora.getTime() - h * 3_600_000);
const haceDias = (d: number) => haceHoras(d * 24);

describe('detectarPendientes', () => {
  it('un paciente al día no genera pendientes', () => {
    expect(detectarPendientes({ pacienteId: 'p', tieneTurnoFuturo: true }, ahora)).toEqual([]);
  });

  it('avisa de un tratamiento empezado sin próximo turno', () => {
    const [pendiente] = detectarPendientes(
      { pacienteId: 'p', tieneTurnoFuturo: false, tratamientoEnCurso: { desde: haceDias(3), descripcion: 'endodoncia 36' } },
      ahora,
    );
    expect(pendiente).toMatchObject({ tipo: 'tratamiento_sin_turno', prioridad: 'alta' });
  });

  it('no avisa del tratamiento si ya tiene turno', () => {
    const pendientes = detectarPendientes(
      { pacienteId: 'p', tieneTurnoFuturo: true, tratamientoEnCurso: { desde: haceDias(3), descripcion: 'endodoncia 36' } },
      ahora,
    );
    expect(pendientes).toEqual([]);
  });

  it('avisa de una conversación sin respuesta recién a las 48 horas', () => {
    const base = { pacienteId: 'p', tieneTurnoFuturo: true };
    expect(detectarPendientes({ ...base, ultimoMensajeEntrante: { recibidoEn: haceHoras(47), respondido: false } }, ahora)).toEqual([]);
    expect(detectarPendientes({ ...base, ultimoMensajeEntrante: { recibidoEn: haceHoras(48), respondido: false } }, ahora)[0]?.tipo).toBe(
      'conversacion_sin_respuesta',
    );
    expect(detectarPendientes({ ...base, ultimoMensajeEntrante: { recibidoEn: haceHoras(90), respondido: true } }, ahora)).toEqual([]);
  });

  it('avisa de presupuestos sin respuesta una sola vez, desde el más viejo', () => {
    const pendientes = detectarPendientes(
      { pacienteId: 'p', tieneTurnoFuturo: true, presupuestosSinRespuesta: [{ entregadoEn: haceDias(6) }, { entregadoEn: haceDias(10) }, { entregadoEn: haceDias(1) }] },
      ahora,
    );
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]?.desde).toEqual(haceDias(10));
  });

  it('avisa del control periódico y ordena por prioridad', () => {
    const pendientes = detectarPendientes(
      { pacienteId: 'p', tieneTurnoFuturo: false, ultimoControl: new Date('2026-05-01T00:00:00Z'), ultimaAusencia: haceDias(2) },
      ahora,
    );
    expect(pendientes.map((p) => p.tipo)).toEqual(['ausente_sin_reprogramar', 'control_periodico']);
  });
});
