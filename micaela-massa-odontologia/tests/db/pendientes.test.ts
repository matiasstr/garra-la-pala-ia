import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { fechaHoraArgentina, hoyEnArgentina, sumarDias } from '../../src/lib/fechas';
import { cambiarEstadoTurno, crearTurno, reprogramarTurno } from '../../src/server/agenda';
import { ErrorDePermiso } from '../../src/server/errores';
import { altaPaciente } from '../../src/server/pacientes';
import {
  contarPendientesParaHoy,
  descartarPendiente,
  indicacionesDeTurnos,
  listarPendientes,
  pendientesDePaciente,
  recalcularPendientes,
  regresoDePaciente,
  registrarContacto,
  registrarIndicacionRegreso,
  resolverPendiente,
  tomarPendiente,
} from '../../src/server/pendientes';
import { cargarUsuario } from '../../src/server/usuarios';
import { crearBaseDePrueba } from './base-de-prueba';

// Estos tests usan el reloj real: la semilla y las reglas se arman a partir de hoy.
const HOY = hoyEnArgentina();
let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
let secretaria: NonNullable<Awaited<ReturnType<typeof cargarUsuario>>>;
let mica: NonNullable<Awaited<ReturnType<typeof cargarUsuario>>>;
let laura: NonNullable<Awaited<ReturnType<typeof cargarUsuario>>>;
let soloAdmin: typeof mica;
let particularId: string;
let documento = 47_000_000;

beforeAll(async () => {
  base = await crearBaseDePrueba();
  expect(await sembrarDatosDePrueba(base.db, HOY)).toBe(true);
  const usuarios = await base.db.select().from(schema.usuarios);
  const cargar = async (nombre: string) => (await cargarUsuario(base.db, usuarios.find((u) => u.nombre === nombre)!.id))!;
  [secretaria, mica, laura] = await Promise.all([cargar('Sofía'), cargar('Micaela'), cargar('Laura')]);
  soloAdmin = { ...mica, roles: ['administrador'] };
  particularId = (await base.db.select().from(schema.financiadores)).find((f) => f.esParticular)!.id;
});

afterAll(async () => {
  await base.cliente.close();
});

async function pacienteNuevo(nombre: string) {
  const resultado = await altaPaciente(
    base.db,
    secretaria,
    { numeroDocumento: String(documento++), nombre, apellido: 'Prueba', fechaNacimiento: '1990-01-01', telefono: '11 2222 3333', aceptaMensajes: true, financiadorId: particularId },
    { confirmarQueEsOtraPersona: true },
  );
  if (resultado.estado !== 'creado') throw new Error(JSON.stringify(resultado));
  return resultado.pacienteId;
}

/** Turno de Laura atendido ese día (las horas de la tarde no chocan con la semilla). */
async function visitaAtendida(pacienteId: string, fecha: string, hora: string) {
  const creado = await crearTurno(base.db, secretaria, { pacienteId, profesionalId: laura.id, fecha, hora, duracionMinutos: 30, motivo: 'Consulta' });
  if (!creado.ok) throw new Error(creado.errores.join(' '));
  for (const estado of ['confirmado', 'en_sala', 'atendido'] as const) expect((await cambiarEstadoTurno(base.db, secretaria, creado.turnoId, estado)).ok).toBe(true);
  return creado.turnoId;
}

const filasDe = (pacienteId: string) => base.db.select().from(schema.pendientes).where(eq(schema.pendientes.pacienteId, pacienteId));
const accionesDe = (pendienteId: string) =>
  base.db.select().from(schema.pendienteAcciones).where(eq(schema.pendienteAcciones.pendienteId, pendienteId)).orderBy(schema.pendienteAcciones.ocurridoEn);

describe('tablero con los datos de prueba', () => {
  it('muestra los casos de la semilla, con prioridad y responsable', async () => {
    const tablero = await listarPendientes(base.db, secretaria);
    const de = (apellido: string) => tablero.paraHoy.find((p) => p.paciente.apellido === apellido);
    expect(de('Giménez')).toMatchObject({ tipo: 'tratamiento_sin_turno', prioridad: 'alta', importante: true, estado: 'abierto', responsable: null });
    expect(de('Torres')).toMatchObject({ tipo: 'presupuesto_sin_respuesta', estado: 'en_curso', intentos: 1, intentosSinRespuesta: 0 });
    expect(de('Torres')?.responsable?.nombre).toBe('Sofía Gómez');
    expect(de('Acosta')).toMatchObject({ tipo: 'ausente_sin_reprogramar', prioridad: 'alta' });
    expect(de('Ruiz')).toMatchObject({ tipo: 'control_periodico', prioridad: 'baja' });
    expect(de('Ruiz')?.fechaEsperada! > HOY).toBe(true);
    expect(de('Fernández')).toMatchObject({ estado: 'no_responde', intentosSinRespuesta: 3, importante: true });
    expect(de('Fernández')?.escaladoA?.nombre).toBe('Micaela Massa');
    expect(de('Fernández')?.diasSinContacto).toBe(3);
  });

  it('a la profesional le aparece primero lo que le llegó', async () => {
    const tablero = await listarPendientes(base.db, mica);
    expect(tablero.paraHoy[0]).toMatchObject({ paraMi: true });
    expect(tablero.paraHoy[0]?.paciente.apellido).toBe('Fernández');
    const mios = await listarPendientes(base.db, mica, { ver: 'mios' });
    expect(mios.paraHoy.map((p) => p.paciente.apellido)).toEqual(['Fernández']);
  });

  it('filtra por motivo y cuenta cuántos hay de cada uno', async () => {
    const tablero = await listarPendientes(base.db, secretaria, { tipo: 'presupuesto_sin_respuesta' });
    expect(tablero.paraHoy.map((p) => p.paciente.apellido)).toEqual(['Torres']);
    expect(tablero.porTipo.ausente_sin_reprogramar).toBeGreaterThanOrEqual(1);
    expect(await contarPendientesParaHoy(base.db, secretaria)).toBe(tablero.total);
  });

  it('recalcular es idempotente: no duplica nada', async () => {
    const antes = await base.db.select({ n: sql<number>`count(*)::int` }).from(schema.pendientes);
    await recalcularPendientes(base.db, secretaria);
    const segunda = await recalcularPendientes(base.db, mica);
    const despues = await base.db.select({ n: sql<number>`count(*)::int` }).from(schema.pendientes);
    expect(segunda).toEqual({ creados: 0, resueltos: 0, reabiertos: 0 });
    expect(despues[0]?.n).toBe(antes[0]?.n);
  });

  it('el administrador que no es profesional ni secretaria no usa el tablero', async () => {
    await expect(listarPendientes(base.db, soloAdmin)).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(recalcularPendientes(base.db, soloAdmin)).rejects.toBeInstanceOf(ErrorDePermiso);
    const [cualquiera] = await base.db.select().from(schema.pendientes).limit(1);
    await expect(tomarPendiente(base.db, soloAdmin, cualquiera!.id)).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(registrarContacto(base.db, soloAdmin, cualquiera!.id, { canal: 'llamada', respuesta: 'no_contesta' })).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(registrarIndicacionRegreso(base.db, soloAdmin, { pacienteId: cualquiera!.pacienteId, plazo: 'un_mes', profesionalId: mica.id })).rejects.toBeInstanceOf(ErrorDePermiso);
    expect(await contarPendientesParaHoy(base.db, soloAdmin)).toBe(0);
  });
});

describe('¿Cuándo debería volver?', () => {
  it('se carga desde un turno atendido y queda quién lo cargó y quién lo indicó', async () => {
    const paciente = await pacienteNuevo('Hoy');
    const turnoId = await visitaAtendida(paciente, HOY, '07:00');
    const resultado = await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, turnoId, plazo: 'dos_semanas', importante: true });
    expect(resultado.ok).toBe(true);
    const indicaciones = await indicacionesDeTurnos(base.db, secretaria, [turnoId]);
    expect(indicaciones.get(turnoId)).toMatchObject({ plazo: 'dos_semanas', importante: true, fechaVisita: HOY, fechaEsperada: sumarDias(HOY, 14), indicadaPor: 'Laura Benítez', cargadaPor: 'Sofía Gómez' });
    // El mismo día todavía no hay pendiente: aparece mañana si no saca turno.
    expect(await filasDe(paciente)).toEqual([]);
    const regreso = await regresoDePaciente(base.db, secretaria, paciente);
    expect(regreso.vigente?.plazo).toBe('dos_semanas');
    expect(regreso.proximoAviso?.contactarDesde).toBe(sumarDias(HOY, 1));
    const [auditoria] = await base.db.select().from(schema.auditoriaAccesos).where(and(eq(schema.auditoriaAccesos.pacienteId, paciente), eq(schema.auditoriaAccesos.accion, 'seguimiento.indicar_regreso')));
    expect(auditoria?.usuarioId).toBe(secretaria.id);
  });

  it('valida el turno y el plazo', async () => {
    const paciente = await pacienteNuevo('Validar');
    const otro = await pacienteNuevo('Otro');
    const turnoOtro = await visitaAtendida(otro, sumarDias(HOY, -1), '19:00');
    expect(await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, turnoId: turnoOtro, plazo: 'un_mes' })).toEqual({ ok: false, errores: ['El turno no es de este paciente.'] });
    const reservado = await crearTurno(base.db, secretaria, { pacienteId: paciente, profesionalId: laura.id, fecha: sumarDias(HOY, 20), hora: '19:00', duracionMinutos: 30 });
    if (!reservado.ok) throw new Error();
    expect(await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, turnoId: reservado.turnoId, plazo: 'un_mes' })).toEqual({ ok: false, errores: ['Primero marcá el turno como atendido.'] });
    expect((await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, plazo: 'cada_tanto' as 'un_mes' })).ok).toBe(false);
    // Sin turno y sin decir quién lo indicó: si lo carga una profesional, es ella.
    expect((await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, plazo: 'un_mes' })).ok).toBe(false);
    expect((await registrarIndicacionRegreso(base.db, mica, { pacienteId: paciente, plazo: 'un_mes' })).ok).toBe(true);
  });

  it('las indicaciones no se modifican ni se borran', async () => {
    await expect(base.db.execute(sql`update indicaciones_regreso set plazo = 'no_hace_falta'`)).rejects.toThrow();
    await expect(base.db.execute(sql`delete from indicaciones_regreso`)).rejects.toThrow();
  });
});

describe('se fue sin turno', () => {
  let paciente: string;
  let pendienteId: string;

  it('aparece al día siguiente de la visita', async () => {
    paciente = await pacienteNuevo('Ayer');
    const turnoId = await visitaAtendida(paciente, sumarDias(HOY, -1), '19:30');
    await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, turnoId, plazo: 'una_semana' });
    const [fila, ...otras] = await filasDe(paciente);
    expect(otras).toEqual([]);
    expect(fila).toMatchObject({ tipo: 'tratamiento_sin_turno', estado: 'abierto', prioridad: 'media', contactarDesde: HOY, profesionalId: laura.id });
    pendienteId = fila!.id;
  });

  it('si saca turno se resuelve solo, y si lo cancela vuelve a la bandeja', async () => {
    const turno = await crearTurno(base.db, secretaria, { pacienteId: paciente, profesionalId: laura.id, fecha: sumarDias(HOY, 6), hora: '19:30', duracionMinutos: 30 });
    if (!turno.ok) throw new Error(turno.errores.join(' '));
    const [resuelto] = await filasDe(paciente);
    expect(resuelto).toMatchObject({ estado: 'resuelto', cerradoPor: null, resueltoPorTurnoId: turno.turnoId });
    expect(resuelto?.motivoCierre).toMatch(/^Sacó turno para el /);

    expect((await cambiarEstadoTurno(base.db, secretaria, turno.turnoId, 'cancelado')).ok).toBe(true);
    const [reabierto, ...otras] = await filasDe(paciente);
    expect(otras).toEqual([]);
    expect(reabierto).toMatchObject({ id: pendienteId, estado: 'abierto', resueltoEn: null });
    expect((await accionesDe(pendienteId)).map((a) => a.tipo)).toEqual(['creado', 'resuelto', 'reabierto']);
  });

  it('tomar, contactar y pedir que lo volvamos a llamar más adelante', async () => {
    expect(await tomarPendiente(base.db, secretaria, pendienteId)).toEqual({ ok: true, estado: 'en_curso' });
    expect(await registrarContacto(base.db, secretaria, pendienteId, { canal: 'whatsapp', respuesta: 'mas_adelante', contactarDesde: sumarDias(HOY, -1) })).toEqual({
      ok: false,
      errores: ['La fecha para volver a contactar ya pasó.'],
    });
    const resultado = await registrarContacto(base.db, secretaria, pendienteId, {
      canal: 'whatsapp',
      respuesta: 'mas_adelante',
      resultado: 'Dice que cobra el 10.',
      contactarDesde: sumarDias(HOY, 10),
      contactarDesdeMotivo: 'Cobra el 10',
    });
    expect(resultado).toMatchObject({ ok: true, estado: 'en_curso' });
    const [fila] = await filasDe(paciente);
    expect(fila).toMatchObject({ responsableId: secretaria.id, contactarDesde: sumarDias(HOY, 10), contactarDesdeMotivo: 'Cobra el 10', contactarDesdeOrigen: 'usuario' });
    const tablero = await listarPendientes(base.db, secretaria, { pacienteId: paciente });
    expect(tablero.paraHoy).toEqual([]);
    expect(tablero.masAdelante.map((p) => p.id)).toEqual([pendienteId]);
    // Recalcular no pisa la fecha que fijó la secretaria.
    await recalcularPendientes(base.db, secretaria, { pacienteIds: [paciente] });
    expect((await filasDe(paciente))[0]?.contactarDesde).toBe(sumarDias(HOY, 10));
  });

  it('el historial es de solo agregar y el pendiente no se borra', async () => {
    await expect(base.db.execute(sql`update pendiente_acciones set resultado = 'otra cosa'`)).rejects.toThrow();
    await expect(base.db.execute(sql`delete from pendiente_acciones`)).rejects.toThrow();
    await expect(base.db.execute(sql`delete from pendientes`)).rejects.toThrow();
  });

  it('al marcarlo resuelto a mano, no vuelve aunque siga sin turno', async () => {
    expect(await resolverPendiente(base.db, secretaria, pendienteId, 'Avisó que viene el lunes.')).toEqual({ ok: true, estado: 'resuelto' });
    await recalcularPendientes(base.db, secretaria, { pacienteIds: [paciente] });
    expect((await filasDe(paciente))[0]).toMatchObject({ estado: 'resuelto', cerradoPor: secretaria.id, motivoCierre: 'Avisó que viene el lunes.' });
    expect((await registrarContacto(base.db, secretaria, pendienteId, { canal: 'llamada', respuesta: 'no_contesta' })).ok).toBe(false);
  });
});

describe('no responde', () => {
  it('a los 3 intentos sin respuesta pasa a "No responde" y, si era importante, le llega a la profesional', async () => {
    const paciente = await pacienteNuevo('Importante');
    const turnoId = await visitaAtendida(paciente, sumarDias(HOY, -2), '19:00');
    await registrarIndicacionRegreso(base.db, mica, { pacienteId: paciente, turnoId, plazo: 'unos_dias', importante: true });
    const [fila] = await filasDe(paciente);
    expect(fila).toMatchObject({ prioridad: 'alta', importante: true, profesionalId: laura.id });

    for (const canal of ['llamada', 'whatsapp'] as const) {
      expect(await registrarContacto(base.db, secretaria, fila!.id, { canal, respuesta: 'no_contesta' })).toMatchObject({ ok: true, estado: 'en_curso' });
    }
    expect(await registrarContacto(base.db, secretaria, fila!.id, { canal: 'llamada', respuesta: 'no_contesta' })).toEqual({ ok: true, estado: 'no_responde', avisoProfesional: 'Laura Benítez' });
    const [despues] = await filasDe(paciente);
    expect(despues).toMatchObject({ estado: 'no_responde', escaladoA: laura.id });
    expect((await accionesDe(fila!.id)).map((a) => a.tipo)).toEqual(['creado', 'contacto', 'contacto', 'contacto', 'no_responde']);

    const tableroDeLaura = await listarPendientes(base.db, laura);
    expect(tableroDeLaura.paraHoy[0]?.paciente.id).toBe(paciente);
    // Si después contesta, vuelve a estar en curso.
    expect(await registrarContacto(base.db, secretaria, fila!.id, { canal: 'llamada', respuesta: 'quiere_turno' })).toMatchObject({ ok: true, estado: 'en_curso' });
  });

  it('si no era importante, no le llega a nadie', async () => {
    const paciente = await pacienteNuevo('Comun');
    const turnoId = await visitaAtendida(paciente, sumarDias(HOY, -2), '19:30');
    await registrarIndicacionRegreso(base.db, secretaria, { pacienteId: paciente, turnoId, plazo: 'un_mes' });
    const [fila] = await filasDe(paciente);
    for (let i = 0; i < 3; i++) await registrarContacto(base.db, secretaria, fila!.id, { canal: 'llamada', respuesta: 'no_contesta' });
    expect((await filasDe(paciente))[0]).toMatchObject({ estado: 'no_responde', escaladoA: null });
  });
});

describe('otros motivos', () => {
  it('un ausente reprogramado se resuelve, y vuelve si cancela el turno nuevo', async () => {
    const [martin] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Acosta'));
    const [pendiente] = await filasDe(martin!.id);
    expect(pendiente).toMatchObject({ tipo: 'ausente_sin_reprogramar', estado: 'abierto' });
    const resultado = await reprogramarTurno(base.db, secretaria, pendiente!.turnoId!, { fecha: sumarDias(HOY, 3), hora: '20:00' });
    if (!resultado.ok) throw new Error(resultado.errores.join(' '));
    expect((await filasDe(martin!.id))[0]?.estado).toBe('resuelto');
    await cambiarEstadoTurno(base.db, secretaria, resultado.turnoId, 'cancelado');
    expect((await filasDe(martin!.id))[0]?.estado).toBe('abierto');
  });

  it('un tratamiento a medias sin indicación aparece igual, sin plazo inventado', async () => {
    const paciente = await pacienteNuevo('Plan');
    await visitaAtendida(paciente, sumarDias(HOY, -4), '20:00');
    await base.db.insert(schema.nomencladorPrestaciones).values({ codigo: 'PRUEBA-ENDO', descripcion: 'Endodoncia', requierePieza: true });
    // El plan se carga durante la visita.
    await base.db.insert(schema.planPrestaciones).values({
      pacienteId: paciente,
      prestacionCodigo: 'PRUEBA-ENDO',
      pieza: 36,
      financiadorId: particularId,
      estado: 'aceptada',
      indicadaPor: laura.id,
      creadoEn: fechaHoraArgentina(sumarDias(HOY, -4), '20:10'),
    });
    await recalcularPendientes(base.db, secretaria, { pacienteIds: [paciente] });
    const [fila] = await filasDe(paciente);
    expect(fila).toMatchObject({ tipo: 'tratamiento_sin_turno', prioridad: 'alta', venceEn: null });
    expect(fila?.detalle).toBe('Tratamiento en curso sin próximo turno: Endodoncia 36.');
  });

  it('descartar pide motivo, queda en la auditoría y no se vuelve a crear', async () => {
    const [graciela] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Ruiz'));
    const [pendiente] = await filasDe(graciela!.id);
    expect(await descartarPendiente(base.db, secretaria, pendiente!.id, ' ')).toEqual({ ok: false, errores: ['Escribí por qué se descarta.'] });
    expect(await descartarPendiente(base.db, secretaria, pendiente!.id, 'Se mudó a Córdoba.')).toEqual({ ok: true, estado: 'descartado' });
    await recalcularPendientes(base.db, secretaria);
    const filas = await filasDe(graciela!.id);
    expect(filas.map((f) => f.estado)).toEqual(['descartado']);
    const auditoria = await base.db.select().from(schema.auditoriaAccesos).where(eq(schema.auditoriaAccesos.entidadId, pendiente!.id));
    expect(auditoria.map((a) => a.accion)).toContain('pendiente.descartar');
    const ficha = await pendientesDePaciente(base.db, secretaria, graciela!.id);
    expect(ficha.abiertos).toEqual([]);
    expect(ficha.historial[0]).toMatchObject({ tipo: 'descartado', resultado: 'Se mudó a Córdoba.', usuario: 'Sofía Gómez' });
  });

  it('la ficha muestra la indicación vigente y el próximo aviso de un control', async () => {
    const paciente = await pacienteNuevo('Control');
    const turnoId = await visitaAtendida(paciente, HOY, '07:30');
    await registrarIndicacionRegreso(base.db, mica, { pacienteId: paciente, turnoId, plazo: 'seis_meses' });
    const regreso = await regresoDePaciente(base.db, secretaria, paciente);
    expect(regreso.vigente).toMatchObject({ plazo: 'seis_meses', indicadaPor: 'Laura Benítez', cargadaPor: 'Micaela Massa' });
    expect(regreso.proximoAviso?.contactarDesde).toBe(sumarDias(regreso.vigente!.fechaEsperada!, -14));
    expect(fechaHoraArgentina(regreso.proximoAviso!.contactarDesde, '00:00').getTime()).toBeGreaterThan(Date.now());
  });
});
