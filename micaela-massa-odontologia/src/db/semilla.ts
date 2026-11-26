import { count } from 'drizzle-orm';
import type { EstadoTurno } from '../domain/agenda/turnos';
import { proximosDiasHabiles, sumarDias } from '../lib/fechas';
import { altaPaciente } from '../server/pacientes';
import { cambiarEstadoTurno, crearTurno } from '../server/agenda';
import { alertasMedicas, financiadores, notasAdministrativas, profesionalEspecialidades, profesionales, sillones, usuarioRoles, usuarios } from './schema';
import type { BaseDeDatos } from './tipos';

/** Días hábiles, después de hoy, que la semilla llena de turnos. */
export const DIAS_HABILES_CON_TURNOS = 10;

/**
 * Datos de prueba para desarrollo y demos. Todas las personas son inventadas.
 * Solo se cargan si la base está vacía. Las fechas son relativas a `hoy`:
 * turnos para hoy y para los próximos días hábiles.
 */
export async function sembrarDatosDePrueba(db: BaseDeDatos, hoy: string): Promise<boolean> {
  const [{ cantidad } = { cantidad: 0 }] = await db.select({ cantidad: count() }).from(usuarios);
  if (cantidad > 0) return false;

  const [mica, laura, sofia] = await db
    .insert(usuarios)
    .values([
      { email: 'mica@consultorio.local', nombre: 'Micaela', apellido: 'Massa' },
      { email: 'laura@consultorio.local', nombre: 'Laura', apellido: 'Benítez' },
      { email: 'sofia@consultorio.local', nombre: 'Sofía', apellido: 'Gómez' },
    ])
    .returning();
  if (!mica || !laura || !sofia) throw new Error('No se pudieron crear los usuarios de prueba.');

  await db.insert(usuarioRoles).values([
    { usuarioId: mica.id, rol: 'profesional' },
    { usuarioId: mica.id, rol: 'administrador' },
    { usuarioId: laura.id, rol: 'profesional' },
    { usuarioId: sofia.id, rol: 'secretaria' },
  ]);
  await db.insert(profesionales).values([
    { usuarioId: mica.id, matricula: 'MP 00001 (prueba)' },
    { usuarioId: laura.id, matricula: 'MP 00002 (prueba)' },
  ]);
  await db.insert(profesionalEspecialidades).values([
    { usuarioId: mica.id, especialidad: 'odontologia_general' },
    { usuarioId: mica.id, especialidad: 'odontopediatria' },
    { usuarioId: laura.id, especialidad: 'endodoncia' },
  ]);
  const [sillon1, sillon2] = await db.insert(sillones).values([{ nombre: 'Sillón 1' }, { nombre: 'Sillón 2' }]).returning();
  const [particular, osde] = await db
    .insert(financiadores)
    .values([{ nombre: 'Particular', esParticular: true }, { nombre: 'OSDE' }])
    .returning();
  if (!sillon1 || !sillon2 || !particular || !osde) throw new Error('No se pudieron crear sillones o coberturas.');

  const secretaria = { id: sofia.id, roles: ['secretaria'] as const, activo: true };

  const alta = async (datos: Parameters<typeof altaPaciente>[2]) => {
    const resultado = await altaPaciente(db, secretaria, datos, { confirmarQueEsOtraPersona: true, hoy });
    if (resultado.estado !== 'creado') throw new Error(`Semilla: no se pudo crear ${datos.apellido}: ${JSON.stringify(resultado)}`);
    return resultado.pacienteId;
  };

  const juanPerez = await alta({ numeroDocumento: '30123456', nombre: 'Juan', apellido: 'Pérez', fechaNacimiento: '1985-03-10', telefono: '11 2345 6789', aceptaMensajes: true, financiadorId: osde.id, numeroAfiliado: '61234567801', plan: '310' });
  const juanPerez2 = await alta({ numeroDocumento: '35987654', nombre: 'Juan', apellido: 'Perez', fechaNacimiento: '1991-08-22', telefono: '11 5555 1234', aceptaMensajes: true, financiadorId: particular.id });
  const martina = await alta({ numeroDocumento: '52345678', nombre: 'Martina', apellido: 'López', fechaNacimiento: '2016-05-14', telefono: '11 4444 8888', aceptaMensajes: true, financiadorId: osde.id, numeroAfiliado: '61999888702', plan: '210' });
  const ana = await alta({ numeroDocumento: '27456789', nombre: 'Ana', apellido: 'Rodríguez', fechaNacimiento: '1979-11-02', telefono: '11 3333 2222', aceptaMensajes: true, financiadorId: osde.id, numeroAfiliado: '61555444303', plan: '410' });
  const diego = await alta({ numeroDocumento: '40111222', nombre: 'Diego', apellido: 'Sosa', fechaNacimiento: '1997-01-30', telefono: '11 6666 7777', aceptaMensajes: false, financiadorId: particular.id });
  const lucia = await alta({ numeroDocumento: '33444555', nombre: 'Lucía', apellido: 'Méndez', fechaNacimiento: '1988-06-09', telefono: '11 7777 1111', aceptaMensajes: true, financiadorId: osde.id, numeroAfiliado: '61222333404', plan: '310' });

  await db.insert(alertasMedicas).values([
    { pacienteId: ana, tipo: 'alergia', descripcion: 'Alergia a la penicilina', registradaPor: mica.id },
    { pacienteId: ana, tipo: 'medicacion', descripcion: 'Toma anticoagulantes', registradaPor: mica.id },
  ]);
  await db.insert(notasAdministrativas).values([
    { pacienteId: juanPerez, texto: 'Prefiere turnos a la tarde.', autorId: sofia.id },
    { pacienteId: martina, texto: 'Viene con la mamá, Carolina.', autorId: sofia.id },
    { pacienteId: diego, texto: 'No quiere recibir mensajes: llamarlo por teléfono.', autorId: sofia.id },
  ]);

  const turno = async (pacienteId: string, profesionalId: string, sillonId: string, fecha: string, hora: string, duracionMinutos: number, motivo: string, estados: EstadoTurno[] = []) => {
    const creado = await crearTurno(db, secretaria, { pacienteId, profesionalId, sillonId, fecha, hora, duracionMinutos, motivo });
    if (!creado.ok) throw new Error(`Semilla: turno ${fecha} ${hora}: ${creado.errores.join(' ')}`);
    for (const estado of estados) await cambiarEstadoTurno(db, secretaria, creado.turnoId, estado);
  };

  await turno(ana, mica.id, sillon1.id, hoy, '09:00', 45, 'Control y limpieza', ['confirmado', 'en_sala', 'atendido']);
  await turno(juanPerez, mica.id, sillon1.id, hoy, '10:00', 30, 'Obturación 36', ['confirmado', 'en_sala']);
  await turno(juanPerez2, mica.id, sillon1.id, hoy, '10:30', 30, 'Primera consulta', ['confirmado']);
  await turno(martina, mica.id, sillon1.id, hoy, '11:30', 30, 'Control odontopediatría');
  await turno(lucia, mica.id, sillon1.id, hoy, '16:00', 45, 'Presupuesto de ortodoncia');
  await turno(diego, laura.id, sillon2.id, hoy, '10:00', 60, 'Endodoncia 46 (segunda sesión)', ['confirmado']);
  await turno(lucia, laura.id, sillon2.id, hoy, '12:00', 30, 'Consulta', ['ausente']);
  // Turnos para los próximos días hábiles: la agenda de la demo no queda vacía
  // aunque pasen los días, y "Reiniciar datos de prueba" los vuelve a generar.
  const visitas = [
    { paciente: juanPerez, conMica: 'Control', conLaura: 'Endodoncia 36 (primera sesión)' },
    { paciente: ana, conMica: 'Control de prótesis', conLaura: 'Consulta' },
    { paciente: martina, conMica: 'Sellador de fosas', conLaura: 'Control' },
    { paciente: lucia, conMica: 'Inicio de ortodoncia', conLaura: 'Endodoncia 21' },
    { paciente: juanPerez2, conMica: 'Limpieza', conLaura: 'Consulta' },
    { paciente: diego, conMica: 'Obturación 16', conLaura: 'Endodoncia 46 (control)' },
  ];
  for (const [dia, fecha] of proximosDiasHabiles(hoy, DIAS_HABILES_CON_TURNOS).entries()) {
    // Cada día, los pacientes en otro orden y nadie dos veces el mismo día.
    const visita = (n: number) => visitas[(n + dia) % visitas.length]!;
    const confirmado: EstadoTurno[] = dia === 0 ? ['confirmado'] : [];
    await turno(visita(0).paciente, mica.id, sillon1.id, fecha, '09:30', 45, visita(0).conMica, confirmado);
    await turno(visita(1).paciente, mica.id, sillon1.id, fecha, '11:00', 30, visita(1).conMica, confirmado);
    await turno(visita(2).paciente, mica.id, sillon1.id, fecha, '16:00', 30, visita(2).conMica);
    if (dia % 2 === 0) await turno(visita(3).paciente, mica.id, sillon1.id, fecha, '17:00', 30, visita(3).conMica);
    await turno(visita(4).paciente, laura.id, sillon2.id, fecha, '10:00', 60, visita(4).conLaura);
    if (dia % 2 === 1) await turno(visita(5).paciente, laura.id, sillon2.id, fecha, '12:00', 30, visita(5).conLaura);
  }

  // Un turno pasado, para que el historial no esté vacío.
  await turno(juanPerez, mica.id, sillon1.id, sumarDias(hoy, -30), '17:30', 30, 'Primera consulta', ['confirmado', 'en_sala', 'atendido']);

  return true;
}
