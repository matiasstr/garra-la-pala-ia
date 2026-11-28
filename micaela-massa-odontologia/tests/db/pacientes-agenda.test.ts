import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { normalizarTexto } from '../../src/domain/pacientes/identificacion';
import { agendaDelDia, cambiarEstadoTurno, crearTurno, historialDeTurno, reprogramarTurno } from '../../src/server/agenda';
import { ErrorDePermiso } from '../../src/server/errores';
import { actualizarContacto, altaPaciente, buscarPacientes, fichaPaciente } from '../../src/server/pacientes';
import { cargarUsuario } from '../../src/server/usuarios';
import { crearBaseDePrueba } from './base-de-prueba';

const HOY = '2026-11-18';
let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
let secretaria: NonNullable<Awaited<ReturnType<typeof cargarUsuario>>>;
let mica: NonNullable<Awaited<ReturnType<typeof cargarUsuario>>>;
let osdeId: string;
let particularId: string;

beforeAll(async () => {
  base = await crearBaseDePrueba();
  expect(await sembrarDatosDePrueba(base.db, HOY)).toBe(true);
  expect(await sembrarDatosDePrueba(base.db, HOY)).toBe(false);
  const usuarios = await base.db.select().from(schema.usuarios);
  secretaria = (await cargarUsuario(base.db, usuarios.find((u) => u.nombre === 'Sofía')!.id))!;
  mica = (await cargarUsuario(base.db, usuarios.find((u) => u.nombre === 'Micaela')!.id))!;
  const financiadores = await base.db.select().from(schema.financiadores);
  osdeId = financiadores.find((f) => f.nombre === 'OSDE')!.id;
  particularId = financiadores.find((f) => f.esParticular)!.id;
});

afterAll(async () => {
  await base.cliente.close();
});

describe('usuarios de prueba', () => {
  it('carga roles, matrícula y especialidades', () => {
    expect(secretaria.roles).toEqual(['secretaria']);
    expect(mica.roles.toSorted()).toEqual(['administrador', 'profesional']);
    expect(mica.matricula).toBeTruthy();
    expect(mica.especialidades).toContain('odontopediatria');
  });
});

describe('búsqueda de pacientes', () => {
  it('la base normaliza igual que la aplicación', async () => {
    const filas = await base.db.select({ nombre: schema.pacientes.nombre, apellido: schema.pacientes.apellido, normalizado: schema.pacientes.nombreNormalizado }).from(schema.pacientes);
    for (const fila of filas) expect(fila.normalizado).toBe(normalizarTexto(`${fila.apellido} ${fila.nombre}`));
  });

  it('encuentra sin tildes, en cualquier orden y por documento', async () => {
    expect((await buscarPacientes(base.db, secretaria, 'rodriguez ana')).map((p) => p.apellido)).toEqual(['Rodríguez']);
    expect((await buscarPacientes(base.db, secretaria, 'LUCIA mendez')).map((p) => p.nombre)).toEqual(['Lucía']);
    expect((await buscarPacientes(base.db, secretaria, '40111222')).map((p) => p.apellido)).toEqual(['Sosa']);
  });

  it('marca a los homónimos', async () => {
    const resultados = await buscarPacientes(base.db, secretaria, 'juan perez');
    expect(resultados).toHaveLength(2);
    expect(resultados.every((p) => p.homonimos === 1)).toBe(true);
  });
});

describe('alta de pacientes', () => {
  const datos = { numeroDocumento: '45.678.901', nombre: 'Tomás', apellido: 'Ibáñez', fechaNacimiento: '2001-02-03', telefono: '11 1234 5678', aceptaMensajes: true, financiadorId: '' };

  it('valida los datos', async () => {
    const resultado = await altaPaciente(base.db, secretaria, { ...datos, financiadorId: osdeId, nombre: '', fechaNacimiento: '2001-02-30' });
    expect(resultado.estado).toBe('invalido');
  });

  it('el administrador que no es profesional ni secretaria no carga pacientes', async () => {
    const soloAdmin = { ...mica, roles: ['administrador' as const] };
    await expect(altaPaciente(base.db, soloAdmin, { ...datos, financiadorId: osdeId })).rejects.toBeInstanceOf(ErrorDePermiso);
  });

  it('crea el paciente con su cobertura y lo audita', async () => {
    const resultado = await altaPaciente(base.db, secretaria, { ...datos, financiadorId: osdeId, numeroAfiliado: '6100', plan: '210' }, { hoy: HOY });
    expect(resultado.estado).toBe('creado');
    if (resultado.estado !== 'creado') return;
    const ficha = await fichaPaciente(base.db, secretaria, resultado.pacienteId);
    expect(ficha?.paciente.numeroDocumento).toBe('45678901');
    expect(ficha?.coberturas.map((c) => c.financiador)).toEqual(['OSDE']);
    const auditoria = await base.db.select().from(schema.auditoriaAccesos).where(eq(schema.auditoriaAccesos.entidadId, resultado.pacienteId));
    expect(auditoria.map((a) => a.accion)).toEqual(['paciente.crear']);
  });

  it('no deja cargar dos veces el mismo documento', async () => {
    const resultado = await altaPaciente(base.db, secretaria, { ...datos, nombre: 'Otro', financiadorId: particularId });
    expect(resultado.estado).toBe('duplicado');
  });

  it('pide confirmar si hay un homónimo, y crea si se confirma', async () => {
    const homonimo = { ...datos, numeroDocumento: '46000111', nombre: 'tomas', apellido: 'IBANEZ', fechaNacimiento: '1970-01-01', financiadorId: particularId };
    const primero = await altaPaciente(base.db, secretaria, homonimo);
    expect(primero).toMatchObject({ estado: 'confirmar', coincidencias: [expect.objectContaining({ motivo: 'homonimo' })] });
    const confirmado = await altaPaciente(base.db, secretaria, homonimo, { confirmarQueEsOtraPersona: true });
    expect(confirmado.estado).toBe('creado');
  });

  it('registra cuándo el paciente da o retira el permiso para mensajes', async () => {
    const [diego] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Sosa'));
    expect(diego?.aceptaMensajesEn).toBeNull();
    expect((await actualizarContacto(base.db, secretaria, diego!.id, { telefono: '', aceptaMensajes: true })).errores).toHaveLength(1);
    expect((await actualizarContacto(base.db, secretaria, diego!.id, { telefono: '11 6666 7777', aceptaMensajes: true })).errores).toEqual([]);
    const [actualizado] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.id, diego!.id));
    expect(actualizado?.aceptaMensajesEn).toBeInstanceOf(Date);
  });
});

describe('agenda', () => {
  it('muestra el día por profesional con alertas y homónimos', async () => {
    const agenda = await agendaDelDia(base.db, secretaria, HOY);
    const deMica = agenda.find((p) => p.nombre === 'Micaela');
    expect(deMica?.turnos.map((t) => t.paciente.apellido)).toEqual(['Rodríguez', 'Pérez', 'Perez', 'López', 'Méndez']);
    expect(deMica?.turnos[0]?.paciente.alertas).toContain('Alergia a la penicilina');
    expect(deMica?.turnos[1]?.paciente.homonimos).toBe(1);
    expect(deMica?.turnos[0]?.estado).toBe('atendido');
  });

  it('no da dos turnos superpuestos al mismo profesional ni al mismo sillón', async () => {
    const [ana] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Rodríguez'));
    const [sillon2] = await base.db.select().from(schema.sillones).where(eq(schema.sillones.nombre, 'Sillón 2'));
    const superpuesto = await crearTurno(base.db, secretaria, { pacienteId: ana!.id, profesionalId: mica.id, fecha: HOY, hora: '10:15', duracionMinutos: 30 });
    expect(superpuesto).toMatchObject({ ok: false, errores: ['El profesional ya tiene un turno en ese horario.'] });
    const sillonOcupado = await crearTurno(base.db, secretaria, { pacienteId: ana!.id, profesionalId: mica.id, sillonId: sillon2!.id, fecha: HOY, hora: '13:00', duracionMinutos: 30 });
    expect(sillonOcupado.ok).toBe(true);
    const libre = await crearTurno(base.db, secretaria, { pacienteId: ana!.id, profesionalId: mica.id, fecha: HOY, hora: '14:00', duracionMinutos: 30 });
    expect(libre.ok).toBe(true);
  });

  it('un turno cancelado libera el horario', async () => {
    const [lucia] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Méndez'));
    const creado = await crearTurno(base.db, secretaria, { pacienteId: lucia!.id, profesionalId: mica.id, fecha: HOY, hora: '18:00', duracionMinutos: 30 });
    if (!creado.ok) throw new Error(creado.errores.join());
    expect((await cambiarEstadoTurno(base.db, secretaria, creado.turnoId, 'cancelado')).ok).toBe(true);
    expect((await crearTurno(base.db, secretaria, { pacienteId: lucia!.id, profesionalId: mica.id, fecha: HOY, hora: '18:00', duracionMinutos: 30 })).ok).toBe(true);
  });

  it('respeta las transiciones de estado y deja el historial', async () => {
    const agenda = await agendaDelDia(base.db, secretaria, HOY);
    const atendido = agenda.flatMap((p) => p.turnos).find((t) => t.estado === 'atendido')!;
    expect((await cambiarEstadoTurno(base.db, secretaria, atendido.id, 'cancelado')).ok).toBe(false);
    const historial = await historialDeTurno(base.db, secretaria, atendido.id);
    expect(historial.map((h) => h.estadoNuevo)).toEqual(['reservado', 'confirmado', 'en_sala', 'atendido']);
    await expect(base.db.execute(sql`delete from turno_eventos`)).rejects.toThrow();
  });

  it('reprograma un ausente con un turno nuevo vinculado al anterior', async () => {
    const agenda = await agendaDelDia(base.db, secretaria, HOY);
    const ausente = agenda.flatMap((p) => p.turnos).find((t) => t.estado === 'ausente')!;
    const resultado = await reprogramarTurno(base.db, secretaria, ausente.id, { fecha: '2026-11-20', hora: '09:00' });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    const [nuevo] = await base.db.select().from(schema.turnos).where(eq(schema.turnos.id, resultado.turnoId));
    expect(nuevo?.reprogramaA).toBe(ausente.id);
    const [anterior] = await base.db.select().from(schema.turnos).where(eq(schema.turnos.id, ausente.id));
    expect(anterior?.estado).toBe('reprogramado');
  });

  it('dos personas que reprograman el mismo turno a la vez dejan un solo turno nuevo', async () => {
    const [martina] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'López'));
    const original = await crearTurno(base.db, secretaria, { pacienteId: martina!.id, profesionalId: mica.id, fecha: '2026-12-21', hora: '08:00', duracionMinutos: 30 });
    if (!original.ok) throw new Error(original.errores.join());
    const resultados = await Promise.all([
      reprogramarTurno(base.db, secretaria, original.turnoId, { fecha: '2026-12-22', hora: '08:00' }),
      reprogramarTurno(base.db, secretaria, original.turnoId, { fecha: '2026-12-23', hora: '08:00' }),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.find((r) => !r.ok)).toEqual({ ok: false, errores: ['Este turno ya no se puede reprogramar.'] });
    const nuevos = await base.db.select().from(schema.turnos).where(eq(schema.turnos.reprogramaA, original.turnoId));
    expect(nuevos).toHaveLength(1);
    expect((await base.db.select().from(schema.turnos).where(eq(schema.turnos.id, original.turnoId)))[0]?.estado).toBe('reprogramado');
  });

  it('reprogramar media hora más tarde no choca con el propio turno original', async () => {
    const [martina] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'López'));
    const original = await crearTurno(base.db, secretaria, { pacienteId: martina!.id, profesionalId: mica.id, fecha: '2026-12-28', hora: '08:00', duracionMinutos: 60 });
    if (!original.ok) throw new Error(original.errores.join());
    expect((await reprogramarTurno(base.db, secretaria, original.turnoId, { fecha: '2026-12-28', hora: '08:30' })).ok).toBe(true);
    expect(await reprogramarTurno(base.db, secretaria, 'no-es-un-turno', { fecha: '2026-12-28', hora: '10:00' })).toEqual({ ok: false, errores: ['El turno no existe.'] });
  });

  it('el administrador ve la agenda pero no da turnos', async () => {
    const soloAdmin = { ...mica, roles: ['administrador' as const] };
    expect((await agendaDelDia(base.db, soloAdmin, HOY)).length).toBeGreaterThan(0);
    await expect(crearTurno(base.db, soloAdmin, { pacienteId: mica.id, profesionalId: mica.id, fecha: HOY, hora: '20:00', duracionMinutos: 30 })).rejects.toBeInstanceOf(ErrorDePermiso);
  });
});
