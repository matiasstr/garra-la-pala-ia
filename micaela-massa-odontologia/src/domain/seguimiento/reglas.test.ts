import { describe, expect, it } from 'vitest';
import { detectarPendientes, evaluarPendientes, motivoDeCierreAutomatico, proximoPendiente, type IndicacionDeRegreso, type SituacionPaciente } from './reglas';

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

describe('con la indicación de cuándo debería volver', () => {
  // ahora: martes 17/11 a las 09:00 en Argentina. La visita fue ayer a las 10:00.
  const visita = new Date('2026-11-16T13:00:00Z');
  const indicacion = (cambios: Partial<IndicacionDeRegreso> = {}): IndicacionDeRegreso => ({
    id: 'i1',
    plazo: 'dos_semanas',
    importante: false,
    fechaVisita: '2026-11-16',
    referencia: visita,
    turnoId: 't1',
    profesionalId: 'mica',
    profesional: 'Micaela Massa',
    ...cambios,
  });
  const situacion = (cambios: Partial<SituacionPaciente> = {}): SituacionPaciente => ({
    pacienteId: 'p',
    tieneTurnoFuturo: false,
    ultimaVisita: { turnoId: 't1', inicio: visita },
    indicacion: indicacion(),
    ...cambios,
  });

  it('si se fue sin turno, aparece al día siguiente con la fecha esperada', () => {
    const [pendiente, ...otros] = detectarPendientes(situacion(), ahora);
    expect(otros).toEqual([]);
    expect(pendiente).toMatchObject({
      tipo: 'tratamiento_sin_turno',
      prioridad: 'media',
      clave: 'indicacion:i1',
      contactarDesde: '2026-11-17',
      fechaEsperada: '2026-11-30',
      profesionalId: 'mica',
      indicacionId: 'i1',
    });
    expect(pendiente?.detalle).toBe('Tenía que volver en 2 semanas (hacia el 30/11/2026) y se fue sin turno. Lo indicó Micaela Massa.');
  });

  it('el mismo día de la visita todavía no aparece, pero se sabe cuándo va a aparecer', () => {
    const hoy = situacion({ indicacion: indicacion({ fechaVisita: '2026-11-17', referencia: haceHoras(1) }), ultimaVisita: { turnoId: 't1', inicio: haceHoras(1) } });
    expect(detectarPendientes(hoy, ahora)).toEqual([]);
    expect(proximoPendiente(hoy, ahora)?.contactarDesde).toBe('2026-11-18');
  });

  it('"Es importante que vuelva" sube la prioridad', () => {
    expect(detectarPendientes(situacion({ indicacion: indicacion({ importante: true }) }), ahora)[0]).toMatchObject({ prioridad: 'alta', importante: true });
  });

  it('si ya tiene un turno futuro no hay pendiente, y se explica por qué se resolvió', () => {
    const conTurno = situacion({ tieneTurnoFuturo: true, proximoTurno: { turnoId: 't2', inicio: new Date('2026-12-03T13:00:00Z') } });
    expect(evaluarPendientes(conTurno, ahora)).toEqual([]);
    expect(motivoDeCierreAutomatico('tratamiento_sin_turno', conTurno, visita)).toBe('Sacó turno para el 03/12/2026.');
  });

  it('para 6 meses es un control que aparece 2 semanas antes', () => {
    const control = situacion({ indicacion: indicacion({ plazo: 'seis_meses', fechaVisita: '2026-06-01', referencia: new Date('2026-06-01T13:00:00Z') }), ultimaVisita: null });
    expect(detectarPendientes(control, ahora)[0]).toMatchObject({ tipo: 'control_periodico', prioridad: 'baja', contactarDesde: '2026-11-17', fechaEsperada: '2026-12-01' });
    const unDiaDespues = situacion({ indicacion: indicacion({ plazo: 'seis_meses', fechaVisita: '2026-06-02', referencia: new Date('2026-06-02T13:00:00Z') }), ultimaVisita: null });
    expect(detectarPendientes(unDiaDespues, ahora)).toEqual([]);
  });

  it('"Cuando el paciente avise" y "No hace falta" no generan pendiente, aunque haya un tratamiento', () => {
    const tratamientoEnCurso = { desde: visita, descripcion: 'endodoncia 36' };
    for (const plazo of ['cuando_avise', 'no_hace_falta'] as const) {
      expect(detectarPendientes(situacion({ indicacion: indicacion({ plazo }), tratamientoEnCurso }), ahora)).toEqual([]);
    }
  });

  it('si volvió a atenderse, la indicación anterior ya se cumplió', () => {
    expect(evaluarPendientes(situacion({ ultimaVisita: { turnoId: 't9', inicio: haceHoras(2) } }), ahora)).toEqual([]);
  });

  it('sin indicación, un tratamiento a medias se avisa desde el día siguiente, sin plazo inventado', () => {
    const [pendiente] = detectarPendientes(situacion({ indicacion: null, tratamientoEnCurso: { desde: visita, descripcion: 'endodoncia 36' } }), ahora);
    expect(pendiente).toMatchObject({ tipo: 'tratamiento_sin_turno', prioridad: 'alta', fechaEsperada: null, contactarDesde: '2026-11-17' });
  });

  it('si faltó al turno siguiente, queda solo el ausente, que hereda si era importante', () => {
    const anterior = new Date('2026-11-10T13:00:00Z');
    const ausencia = { turnoId: 't2', inicio: new Date('2026-11-15T19:00:00Z'), profesionalId: 'laura' };
    const pendientes = detectarPendientes(
      situacion({ indicacion: indicacion({ importante: true, referencia: anterior, fechaVisita: '2026-11-10' }), ultimaVisita: { turnoId: 't1', inicio: anterior }, ausencia }),
      ahora,
    );
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0]).toMatchObject({ tipo: 'ausente_sin_reprogramar', clave: 'ausente:t2', importante: true, profesionalId: 'laura', indicacionId: 'i1' });
    expect(pendientes[0]?.detalle).toBe('Faltó al turno del 15/11/2026 y no se reprogramó.');
  });

  it('una ausencia vieja no cuenta si después volvió', () => {
    const ausencia = { turnoId: 't0', inicio: new Date('2026-11-01T13:00:00Z'), profesionalId: null };
    expect(detectarPendientes(situacion({ ausencia }), ahora).map((p) => p.tipo)).toEqual(['tratamiento_sin_turno']);
  });

  it('cada caso tiene una clave estable para no duplicarlo al recalcular', () => {
    const conTodo = situacion({ presupuestosSinRespuesta: [{ id: 'pr1', entregadoEn: haceDias(8) }] });
    const primera = evaluarPendientes(conTodo, ahora).map((p) => p.clave);
    const segunda = evaluarPendientes(conTodo, new Date(ahora.getTime() + 3_600_000)).map((p) => p.clave);
    expect(primera).toEqual(['indicacion:i1', 'presupuesto:pr1']);
    expect(segunda).toEqual(primera);
  });
});
