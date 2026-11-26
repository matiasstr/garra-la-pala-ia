import { count, eq } from 'drizzle-orm';
import type { EstadoTurno } from '../domain/agenda/turnos';
import type { UsuarioConRoles } from '../domain/permisos/permisos';
import { fechaHoraArgentina, sumarDias } from '../lib/fechas';
import { altaPaciente } from '../server/pacientes';
import { cambiarEstadoTurno, crearTurno } from '../server/agenda';
import { registrarContacto, registrarIndicacionRegreso, sincronizarPendientes } from '../server/pendientes';
import {
  alertasMedicas,
  financiadores,
  notasAdministrativas,
  pendientes,
  presupuestos,
  profesionalEspecialidades,
  profesionales,
  sillones,
  usuarioRoles,
  usuarios,
} from './schema';
import type { BaseDeDatos } from './tipos';

/**
 * Datos de prueba para desarrollo y demos. Todas las personas son inventadas.
 * Solo se cargan si la base está vacía.
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
    return creado.turnoId;
  };

  await turno(ana, mica.id, sillon1.id, hoy, '09:00', 45, 'Control y limpieza', ['confirmado', 'en_sala', 'atendido']);
  await turno(juanPerez, mica.id, sillon1.id, hoy, '10:00', 30, 'Obturación 36', ['confirmado', 'en_sala']);
  await turno(juanPerez2, mica.id, sillon1.id, hoy, '10:30', 30, 'Primera consulta', ['confirmado']);
  await turno(martina, mica.id, sillon1.id, hoy, '11:30', 30, 'Control odontopediatría');
  await turno(lucia, mica.id, sillon1.id, hoy, '16:00', 45, 'Presupuesto de ortodoncia');
  await turno(diego, laura.id, sillon2.id, hoy, '10:00', 60, 'Endodoncia 46 (segunda sesión)', ['confirmado']);
  await turno(lucia, laura.id, sillon2.id, hoy, '12:00', 30, 'Consulta', ['ausente']);
  await turno(juanPerez, mica.id, sillon1.id, sumarDias(hoy, 1), '17:00', 30, 'Control');
  await turno(martina, mica.id, sillon1.id, sumarDias(hoy, 7), '16:30', 30, 'Sellador de fosas');

  // Un turno pasado, para que el historial no esté vacío.
  await turno(juanPerez, mica.id, sillon1.id, sumarDias(hoy, -30), '17:30', 30, 'Primera consulta', ['confirmado', 'en_sala', 'atendido']);

  // Alguien de administración que no atiende ni hace recepción: sirve para ver qué no puede hacer.
  const [carla] = await db.insert(usuarios).values({ email: 'administracion@consultorio.local', nombre: 'Carla', apellido: 'Díaz' }).returning();
  if (!carla) throw new Error('No se pudo crear el usuario de administración.');
  await db.insert(usuarioRoles).values({ usuarioId: carla.id, rol: 'administrador' });

  await sembrarSeguimiento(db, hoy, { secretaria, mica: { id: mica.id, roles: ['profesional', 'administrador'] as const, activo: true }, laura: laura.id, alta, turno, sillon1: sillon1.id, sillon2: sillon2.id, osde: osde.id, particular: particular.id });

  return true;
}

/**
 * Tablero de pendientes con casos variados: un tratamiento sin turno marcado
 * como importante, un presupuesto sin respuesta, un ausente, un control de
 * 6 meses por vencer y uno que no responde después de 3 intentos.
 */
async function sembrarSeguimiento(
  db: BaseDeDatos,
  hoy: string,
  d: {
    secretaria: UsuarioConRoles;
    mica: UsuarioConRoles;
    laura: string;
    alta: (datos: Parameters<typeof altaPaciente>[2]) => Promise<string>;
    turno: (pacienteId: string, profesionalId: string, sillonId: string, fecha: string, hora: string, duracionMinutos: number, motivo: string, estados?: EstadoTurno[]) => Promise<string>;
    sillon1: string;
    sillon2: string;
    osde: string;
    particular: string;
  },
) {
  const atendido: EstadoTurno[] = ['confirmado', 'en_sala', 'atendido'];
  const a = (dias: number, hora: string) => fechaHoraArgentina(sumarDias(hoy, dias), hora);
  const indicar = async (usuario: UsuarioConRoles, entrada: Parameters<typeof registrarIndicacionRegreso>[2], ahora: Date) => {
    const resultado = await registrarIndicacionRegreso(db, usuario, entrada, { ahora });
    if (!resultado.ok) throw new Error(`Semilla: indicación: ${resultado.errores.join(' ')}`);
  };

  const carlos = await d.alta({ numeroDocumento: '28765432', nombre: 'Carlos', apellido: 'Giménez', fechaNacimiento: '1972-04-18', telefono: '11 4567 8901', aceptaMensajes: true, financiadorId: d.osde, numeroAfiliado: '61777888905', plan: '310' });
  const valeria = await d.alta({ numeroDocumento: '36555444', nombre: 'Valeria', apellido: 'Torres', fechaNacimiento: '1992-09-03', telefono: '11 5678 9012', aceptaMensajes: true, financiadorId: d.particular });
  const martin = await d.alta({ numeroDocumento: '41222333', nombre: 'Martín', apellido: 'Acosta', fechaNacimiento: '1999-12-11', telefono: '11 6789 0123', aceptaMensajes: true, financiadorId: d.osde, numeroAfiliado: '61333222106', plan: '210' });
  const graciela = await d.alta({ numeroDocumento: '20111999', nombre: 'Graciela', apellido: 'Ruiz', fechaNacimiento: '1961-02-25', telefono: '11 7890 1234', aceptaMensajes: false, financiadorId: d.osde, numeroAfiliado: '61444555207', plan: '410' });
  const roberto = await d.alta({ numeroDocumento: '25888777', nombre: 'Roberto', apellido: 'Fernández', fechaNacimiento: '1968-07-07', telefono: '11 8901 2345', aceptaMensajes: true, financiadorId: d.particular });

  // Tratamiento a medias: la endodoncista dijo "en una semana, es importante" y se fue sin turno.
  const turnoCarlos = await d.turno(carlos, d.laura, d.sillon2, sumarDias(hoy, -3), '11:00', 60, 'Endodoncia 26 (primera sesión)', atendido);
  await indicar(d.secretaria, { pacienteId: carlos, turnoId: turnoCarlos, plazo: 'una_semana', importante: true }, a(-3, '12:05'));

  // Presupuesto sin respuesta: la secretaria ya le escribió una vez.
  const turnoValeria = await d.turno(valeria, d.mica.id, d.sillon1, sumarDias(hoy, -10), '15:00', 30, 'Primera consulta', atendido);
  await indicar(d.mica, { pacienteId: valeria, turnoId: turnoValeria, plazo: 'cuando_avise' }, a(-10, '15:35'));
  await db.insert(presupuestos).values({ pacienteId: valeria, entregadoEn: a(-8, '10:00'), creadoPor: d.secretaria.id });

  // Ausente: faltó anteayer y no se reprogramó.
  await d.turno(martin, d.mica.id, d.sillon1, sumarDias(hoy, -2), '09:30', 30, 'Control', ['confirmado', 'ausente']);

  // Control de 6 meses que vence en unos días.
  const turnoGraciela = await d.turno(graciela, d.mica.id, d.sillon1, sumarDias(hoy, -172), '10:00', 45, 'Control y limpieza', atendido);
  await indicar(d.mica, { pacienteId: graciela, turnoId: turnoGraciela, plazo: 'seis_meses' }, a(-172, '10:50'));

  // No responde: era importante, 3 intentos sin respuesta y le llegó a la Dra.
  const turnoRoberto = await d.turno(roberto, d.mica.id, d.sillon1, sumarDias(hoy, -12), '16:00', 30, 'Obturación 46', atendido);
  await indicar(d.secretaria, { pacienteId: roberto, turnoId: turnoRoberto, plazo: 'dos_semanas', importante: true }, a(-12, '16:40'));

  // Los pendientes aparecen el día que corresponde (así el historial muestra fechas reales).
  await sincronizarPendientes(db, { pacienteIds: [roberto], ahora: a(-11, '08:00') });
  await sincronizarPendientes(db, { pacienteIds: [valeria], ahora: a(-3, '11:00') });
  await sincronizarPendientes(db, { pacienteIds: [carlos], ahora: a(-2, '08:00') });
  await sincronizarPendientes(db);

  const pendienteDe = async (pacienteId: string) => {
    const [fila] = await db.select({ id: pendientes.id }).from(pendientes).where(eq(pendientes.pacienteId, pacienteId));
    if (!fila) throw new Error('Semilla: falta un pendiente de seguimiento.');
    return fila.id;
  };
  const contactar = async (pendienteId: string, entrada: Parameters<typeof registrarContacto>[3], ahora: Date) => {
    const resultado = await registrarContacto(db, d.secretaria, pendienteId, entrada, { ahora });
    if (!resultado.ok) throw new Error(`Semilla: contacto: ${resultado.errores.join(' ')}`);
  };

  const deRoberto = await pendienteDe(roberto);
  await contactar(deRoberto, { canal: 'llamada', respuesta: 'no_contesta' }, a(-9, '10:15'));
  await contactar(deRoberto, { canal: 'whatsapp', respuesta: 'no_contesta', resultado: 'Le escribí, no lo leyó.' }, a(-6, '11:30'));
  await contactar(deRoberto, { canal: 'llamada', respuesta: 'no_contesta', resultado: 'Sonó y no atendió.' }, a(-3, '17:00'));

  await contactar(await pendienteDe(valeria), { canal: 'whatsapp', respuesta: 'lo_piensa', resultado: 'Dice que lo está viendo con el marido.' }, a(-1, '12:20'));
}
