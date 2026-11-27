import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAVE_DE_PRUEBA, SECRETO_TOTP_DE_PRUEBA } from '../../src/db/acceso-de-prueba';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { hashToken } from '../../src/domain/acceso/sesiones';
import { codigoTotp, desdeBase32 } from '../../src/domain/acceso/totp';
import {
  actualizarUsuario,
  blanquearClave,
  blanquearVerificacion,
  crearPrimerAdministrador,
  crearUsuario,
  desactivarUsuario,
  fichaDeUsuario,
  generarEnlaceNuevo,
  listarUsuariosDelConsultorio,
  reactivarUsuario,
  recuperarAccesoPorConsola,
} from '../../src/server/acceso/administracion';
import { MENSAJE_CLAVE_INCORRECTA, buscarSesion, cerrarSesion, ingresarConClave, ingresarConCodigo, validarSesion } from '../../src/server/acceso/autenticacion';
import { cambiarClave, cambiarConsultorioDeSesion, cerrarOtrasSesiones, confirmarCambioDeApp, estadoDeCuenta, iniciarCambioDeApp, nuevosCodigosDeRecuperacion } from '../../src/server/acceso/cuenta';
import { buscarEnlace, pasoClaveDelEnlace, pasoCodigoDelEnlace } from '../../src/server/acceso/enlaces';
import { descifrarSecreto } from '../../src/server/acceso/secretos';
import { ErrorDePermiso } from '../../src/server/errores';
import { cargarUsuario, listarProfesionales, type UsuarioSesion } from '../../src/server/usuarios';
import { crearBaseDePrueba, sembrarConsultorio } from './base-de-prueba';

let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
let datos: Awaited<ReturnType<typeof sembrarConsultorio>>;
let admin: UsuarioSesion;
let secretariaSembrada: UsuarioSesion;

// Un reloj que solo avanza: cada código de la app se pide en un intervalo nuevo.
let instante = new Date('2026-11-26T13:00:00Z').getTime();
const avanzar = (ms = 60_000) => new Date((instante += ms));
let ips = 0;
const pedidoNuevo = () => ({ ip: `10.0.${Math.floor(++ips / 250)}.${ips % 250}`, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile' });
const codigoDe = (secreto: string, ahora: Date) => codigoTotp(desdeBase32(secreto), ahora);
const CLAVE = 'una frase larga de prueba';

interface Persona {
  id: string;
  email: string;
  clave: string;
  secreto: string;
  codigos: string[];
}

/** Alta hecha por la administradora y acceso configurado con el enlace, como lo haría la persona. */
async function darDeAlta(nombre: string, roles: ('secretaria' | 'profesional' | 'administrador')[] = ['secretaria'], extra: { matricula?: string } = {}): Promise<Persona> {
  const email = `${nombre.toLowerCase()}@consultorio.test`;
  const alta = await crearUsuario(
    base.db,
    admin,
    { email, nombre, apellido: 'Prueba', roles, matricula: extra.matricula, especialidades: extra.matricula ? ['endodoncia'] : [] },
    pedidoNuevo(),
    avanzar(),
  );
  if (alta.estado !== 'creado') throw new Error(JSON.stringify(alta));
  const paso1 = await pasoClaveDelEnlace(base.db, alta.enlace.token, { clave: CLAVE, repetida: CLAVE }, pedidoNuevo(), avanzar());
  if (!paso1.ok || paso1.siguiente !== 'verificacion') throw new Error(JSON.stringify(paso1));
  const ahora = avanzar();
  const paso2 = await pasoCodigoDelEnlace(base.db, alta.enlace.token, codigoDe(paso1.clave.secreto, ahora), pedidoNuevo(), ahora);
  if (!paso2.ok) throw new Error(JSON.stringify(paso2));
  return { id: alta.usuarioId, email, clave: CLAVE, secreto: paso1.clave.secreto, codigos: paso2.codigos };
}

/** Ingreso completo: contraseña y código. Devuelve el token de la sesión. */
async function ingresar(persona: Persona, pedido = pedidoNuevo()): Promise<string> {
  const paso1 = await ingresarConClave(base.db, { email: persona.email, clave: persona.clave }, pedido, avanzar());
  if (paso1.estado !== 'falta_codigo') throw new Error(JSON.stringify(paso1));
  const ahora = avanzar();
  const paso2 = await ingresarConCodigo(base.db, { token: paso1.token, codigo: codigoDe(persona.secreto, ahora) }, pedido, ahora);
  if (paso2.estado !== 'ingreso') throw new Error(JSON.stringify(paso2));
  return paso2.token;
}

const acciones = async (entidadId: string) =>
  (await base.db.select({ accion: schema.auditoriaAccesos.accion }).from(schema.auditoriaAccesos).where(eq(schema.auditoriaAccesos.entidadId, entidadId))).map((a) => a.accion);

beforeAll(async () => {
  base = await crearBaseDePrueba();
  datos = await sembrarConsultorio(base.db);
  admin = (await cargarUsuario(base.db, datos.mica.id))!;
  secretariaSembrada = (await cargarUsuario(base.db, datos.secretaria.id))!;
});

afterAll(async () => {
  await base.cliente.close();
});

describe('primer ingreso con el enlace de un solo uso', () => {
  it('la persona elige su contraseña, configura la app y recibe sus códigos', async () => {
    const alta = await crearUsuario(base.db, admin, { email: ' Carla@Consultorio.TEST ', nombre: 'Carla', apellido: 'Paz', roles: ['secretaria'] }, pedidoNuevo(), avanzar());
    expect(alta.estado).toBe('creado');
    if (alta.estado !== 'creado') return;
    const enlace = await buscarEnlace(base.db, alta.enlace.token, avanzar());
    expect(enlace?.usuario).toMatchObject({ email: 'carla@consultorio.test', tieneClave: false, tieneVerificacion: false });
    expect(enlace?.motivo).toBe('primer_ingreso');

    const corta = await pasoClaveDelEnlace(base.db, alta.enlace.token, { clave: 'corta', repetida: 'corta' }, pedidoNuevo(), avanzar());
    expect(corta).toMatchObject({ ok: false });
    const distinta = await pasoClaveDelEnlace(base.db, alta.enlace.token, { clave: CLAVE, repetida: `${CLAVE}!` }, pedidoNuevo(), avanzar());
    expect(distinta).toMatchObject({ ok: false, errores: ['Las dos contraseñas no coinciden.'] });

    const paso1 = await pasoClaveDelEnlace(base.db, alta.enlace.token, { clave: CLAVE, repetida: CLAVE }, pedidoNuevo(), avanzar());
    if (!paso1.ok || paso1.siguiente !== 'verificacion') throw new Error('debería pedir la app');
    expect(paso1.clave.enlace).toMatch(/^otpauth:\/\/totp\//);

    // Todavía sin la app: con la contraseña sola no se entra.
    const sinApp = await ingresarConClave(base.db, { email: 'carla@consultorio.test', clave: CLAVE }, pedidoNuevo(), avanzar());
    expect(sinApp).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('verificación en dos pasos') });

    const mal = await pasoCodigoDelEnlace(base.db, alta.enlace.token, '000000', pedidoNuevo(), avanzar());
    expect(mal.ok).toBe(false);
    const ahora = avanzar();
    const paso2 = await pasoCodigoDelEnlace(base.db, alta.enlace.token, codigoDe(paso1.clave.secreto, ahora), pedidoNuevo(), ahora);
    expect(paso2.ok && paso2.codigos).toHaveLength(10);

    // El enlace ya no sirve.
    expect(await buscarEnlace(base.db, alta.enlace.token, avanzar())).toBeNull();
    expect((await pasoClaveDelEnlace(base.db, alta.enlace.token, { clave: CLAVE, repetida: CLAVE }, pedidoNuevo(), avanzar())).ok).toBe(false);
    expect(await acciones(alta.usuarioId)).toEqual(expect.arrayContaining(['usuario.crear', 'cuenta.definir_clave', 'cuenta.configurar_verificacion']));
  });

  it('el enlace vence a las 72 horas', async () => {
    const alta = await crearUsuario(base.db, admin, { email: 'vence@consultorio.test', nombre: 'Vence', apellido: 'Prueba', roles: ['secretaria'] }, pedidoNuevo(), avanzar());
    if (alta.estado !== 'creado') throw new Error('no se creó');
    expect(await buscarEnlace(base.db, alta.enlace.token, new Date(alta.enlace.venceEn.getTime() - 1000))).not.toBeNull();
    expect(await buscarEnlace(base.db, alta.enlace.token, new Date(alta.enlace.venceEn.getTime() + 1000))).toBeNull();
    // Un enlace nuevo anula el anterior.
    const nuevo = await generarEnlaceNuevo(base.db, admin, alta.usuarioId, pedidoNuevo(), avanzar());
    expect(nuevo.ok).toBe(true);
    expect(await buscarEnlace(base.db, alta.enlace.token, avanzar())).toBeNull();
  });

  it('la clave de la app se guarda cifrada', async () => {
    const persona = await darDeAlta('Cifrada');
    const [fila] = await base.db.select({ secreto: schema.usuarios.totpSecreto, clave: schema.usuarios.claveHash }).from(schema.usuarios).where(eq(schema.usuarios.id, persona.id));
    expect(fila?.secreto).not.toContain(persona.secreto);
    expect(fila?.secreto?.startsWith('v1.')).toBe(true);
    expect(descifrarSecreto(fila!.secreto!)).toBe(persona.secreto);
    expect(fila?.clave).toMatch(/^scrypt\$/);
  });
});

describe('ingreso con contraseña y código', () => {
  let ana: Persona;
  beforeAll(async () => {
    ana = await darDeAlta('Ana');
  });

  it('los errores no dicen si el email existe', async () => {
    const pedido = pedidoNuevo();
    const malaClave = await ingresarConClave(base.db, { email: ana.email, clave: 'otra contraseña' }, pedido, avanzar());
    const noExiste = await ingresarConClave(base.db, { email: 'nadie@consultorio.test', clave: 'otra contraseña' }, pedido, avanzar());
    expect(malaClave).toEqual({ estado: 'error', mensaje: MENSAJE_CLAVE_INCORRECTA });
    expect(noExiste).toEqual(malaClave);
  });

  it('con la contraseña sola la sesión no sirve; con el código, sí, y con un token nuevo', async () => {
    const pedido = pedidoNuevo();
    const paso1 = await ingresarConClave(base.db, { email: 'ANA@consultorio.test', clave: CLAVE }, pedido, avanzar());
    if (paso1.estado !== 'falta_codigo') throw new Error('debería pedir el código');
    expect(await validarSesion(base.db, paso1.token, avanzar(1000))).toBeNull();

    const mal = await ingresarConCodigo(base.db, { token: paso1.token, codigo: '123456' }, pedido, avanzar(1000));
    expect(mal).toMatchObject({ estado: 'error' });

    const ahora = avanzar(1000);
    const paso2 = await ingresarConCodigo(base.db, { token: paso1.token, codigo: codigoDe(ana.secreto, ahora) }, pedido, ahora);
    if (paso2.estado !== 'ingreso') throw new Error(JSON.stringify(paso2));
    expect(paso2.token).not.toBe(paso1.token);
    expect(await validarSesion(base.db, paso1.token, avanzar(1000))).toBeNull();
    const sesion = await validarSesion(base.db, paso2.token, avanzar(1000));
    expect(sesion?.usuario).toMatchObject({ email: ana.email, roles: ['secretaria'], consultorio: { id: datos.consultorio.id } });
    expect(await acciones(paso2.sesionId)).toEqual(['sesion.ingresar']);
  });

  it('un mismo código no sirve dos veces', async () => {
    const pedido = pedidoNuevo();
    const ahora = avanzar();
    const codigo = codigoDe(ana.secreto, ahora);
    const primero = await ingresarConClave(base.db, { email: ana.email, clave: CLAVE }, pedido, ahora);
    if (primero.estado !== 'falta_codigo') throw new Error('falta código');
    expect((await ingresarConCodigo(base.db, { token: primero.token, codigo }, pedido, ahora)).estado).toBe('ingreso');
    const segundo = await ingresarConClave(base.db, { email: ana.email, clave: CLAVE }, pedido, new Date(ahora.getTime() + 5000));
    if (segundo.estado !== 'falta_codigo') throw new Error('falta código');
    expect(await ingresarConCodigo(base.db, { token: segundo.token, codigo }, pedido, new Date(ahora.getTime() + 6000))).toMatchObject({
      estado: 'error',
      mensaje: expect.stringContaining('ya se usó'),
    });
  });

  it('el paso del código vence a los 10 minutos', async () => {
    const pedido = pedidoNuevo();
    const paso1 = await ingresarConClave(base.db, { email: ana.email, clave: CLAVE }, pedido, avanzar());
    if (paso1.estado !== 'falta_codigo') throw new Error('falta código');
    const tarde = avanzar(11 * 60_000);
    expect((await ingresarConCodigo(base.db, { token: paso1.token, codigo: codigoDe(ana.secreto, tarde) }, pedido, tarde)).estado).toBe('vencido');
  });

  it('cada código de recuperación sirve una sola vez', async () => {
    const pedido = pedidoNuevo();
    const [codigo] = ana.codigos;
    const paso1 = await ingresarConClave(base.db, { email: ana.email, clave: CLAVE }, pedido, avanzar());
    if (paso1.estado !== 'falta_codigo') throw new Error('falta código');
    const paso2 = await ingresarConCodigo(base.db, { token: paso1.token, codigo: codigo!.toUpperCase() }, pedido, avanzar());
    expect(paso2).toMatchObject({ estado: 'ingreso', usoCodigoDeRecuperacion: true, codigosRestantes: 9 });

    const otra = await ingresarConClave(base.db, { email: ana.email, clave: CLAVE }, pedido, avanzar());
    if (otra.estado !== 'falta_codigo') throw new Error('falta código');
    expect(await ingresarConCodigo(base.db, { token: otra.token, codigo: codigo! }, pedido, avanzar())).toMatchObject({ estado: 'error' });
    // La base tampoco deja "desusar" un código.
    await expect(base.db.update(schema.codigosRecuperacion).set({ usadoEn: null }).where(eq(schema.codigosRecuperacion.usuarioId, ana.id))).rejects.toThrow();
  });
});

describe('sesiones', () => {
  let beto: Persona;
  beforeAll(async () => {
    beto = await darDeAlta('Beto');
  });

  it('se vence tras 12 horas sin uso, y el uso la mantiene viva', async () => {
    const token = await ingresar(beto);
    const desde = instante;
    expect(await validarSesion(base.db, token, new Date(desde + 11 * 3600_000))).not.toBeNull();
    // El uso a las 11 horas corrió el vencimiento.
    expect(await validarSesion(base.db, token, new Date(desde + 22 * 3600_000))).not.toBeNull();

    const otra = await ingresar(beto);
    const vencida = new Date(instante + 12 * 3600_000 + 60_000);
    expect(await validarSesion(base.db, otra, vencida)).toBeNull();
    expect((await buscarSesion(base.db, otra, vencida))?.estado).toBe('cerrada');
    avanzar(23 * 3600_000);
  });

  it('salir la cierra y queda en la auditoría', async () => {
    const token = await ingresar(beto);
    const sesion = await validarSesion(base.db, token, avanzar());
    await cerrarSesion(base.db, token, pedidoNuevo(), avanzar());
    expect(await validarSesion(base.db, token, avanzar())).toBeNull();
    expect(await acciones(sesion!.sesionId)).toEqual(expect.arrayContaining(['sesion.ingresar', 'sesion.salir']));
  });

  it('un token copiado de la base no sirve para entrar', async () => {
    const token = await ingresar(beto);
    const [fila] = await base.db.select({ tokenHash: schema.sesiones.tokenHash }).from(schema.sesiones).where(eq(schema.sesiones.tokenHash, hashToken(token)));
    expect(fila?.tokenHash).toBe(hashToken(token));
    expect(fila?.tokenHash).not.toBe(token);
    expect(await validarSesion(base.db, fila!.tokenHash, avanzar())).toBeNull();
    expect(await validarSesion(base.db, Buffer.from(fila!.tokenHash, 'hex').toString('base64url'), avanzar())).toBeNull();
    expect(await validarSesion(base.db, token, avanzar())).not.toBeNull();
  });

  it('cerrar las otras sesiones deja solo la actual, y cambiar la contraseña también', async () => {
    const [a, b, c] = [await ingresar(beto), await ingresar(beto), await ingresar(beto)];
    const actual = (await validarSesion(base.db, a, avanzar()))!;
    expect(await cerrarOtrasSesiones(base.db, actual.usuario, actual.sesionId, pedidoNuevo(), avanzar())).toBeGreaterThanOrEqual(2);
    expect(await validarSesion(base.db, b, avanzar())).toBeNull();
    expect(await validarSesion(base.db, c, avanzar())).toBeNull();
    expect(await validarSesion(base.db, a, avanzar())).not.toBeNull();

    const d = await ingresar(beto);
    const malActual = await cambiarClave(base.db, actual.usuario, actual.sesionId, { actual: 'no es', nueva: 'otra frase bien larga', repetida: 'otra frase bien larga' }, pedidoNuevo(), avanzar());
    expect(malActual.ok).toBe(false);
    const cambio = await cambiarClave(base.db, actual.usuario, actual.sesionId, { actual: CLAVE, nueva: 'otra frase bien larga', repetida: 'otra frase bien larga' }, pedidoNuevo(), avanzar());
    expect(cambio.ok).toBe(true);
    expect(await validarSesion(base.db, d, avanzar())).toBeNull();
    expect(await validarSesion(base.db, a, avanzar())).not.toBeNull();
    beto.clave = 'otra frase bien larga';
    expect((await ingresarConClave(base.db, { email: beto.email, clave: CLAVE }, pedidoNuevo(), avanzar())).estado).toBe('error');
    await ingresar(beto);
  });

  it('cambiar de app desde la cuenta: la vieja deja de servir y hay códigos nuevos', async () => {
    const sesion = (await validarSesion(base.db, await ingresar(beto), avanzar()))!;
    const viejos = (await estadoDeCuenta(base.db, sesion.usuario, sesion.sesionId, avanzar())).codigosRestantes;
    expect(viejos).toBe(10);
    expect((await iniciarCambioDeApp(base.db, sesion.usuario, 'mal', pedidoNuevo(), avanzar())).ok).toBe(false);
    const inicio = await iniciarCambioDeApp(base.db, sesion.usuario, beto.clave, pedidoNuevo(), avanzar());
    if (!inicio.ok) throw new Error('debería dar una clave');
    const ahora = avanzar();
    const fin = await confirmarCambioDeApp(base.db, sesion.usuario, codigoDe(inicio.clave.secreto, ahora), pedidoNuevo(), ahora);
    expect(fin.ok && fin.codigos).toHaveLength(10);
    const viejoSecreto = beto.secreto;
    beto.secreto = inicio.clave.secreto;
    const paso1 = await ingresarConClave(base.db, { email: beto.email, clave: beto.clave }, pedidoNuevo(), avanzar());
    if (paso1.estado !== 'falta_codigo') throw new Error('falta código');
    const despues = avanzar();
    expect((await ingresarConCodigo(base.db, { token: paso1.token, codigo: codigoDe(viejoSecreto, despues) }, pedidoNuevo(), despues)).estado).toBe('error');
    expect((await ingresarConCodigo(base.db, { token: paso1.token, codigo: beto.codigos[0]! }, pedidoNuevo(), avanzar())).estado).toBe('error');

    const t = avanzar();
    const nuevos = await nuevosCodigosDeRecuperacion(base.db, sesion.usuario, codigoDe(beto.secreto, t), pedidoNuevo(), t);
    expect(nuevos.ok && nuevos.codigos).toHaveLength(10);
    expect((await estadoDeCuenta(base.db, sesion.usuario, sesion.sesionId, avanzar())).codigosRestantes).toBe(10);
  });
});

describe('bloqueo por intentos fallidos', () => {
  it('por usuario: 5 fallos bloquean 15 minutos, aun con la contraseña correcta', async () => {
    const carlos = await darDeAlta('Carlos');
    for (let i = 0; i < 5; i++) {
      expect((await ingresarConClave(base.db, { email: carlos.email, clave: `mal ${i}` }, pedidoNuevo(), avanzar(10_000))).estado).toBe('error');
    }
    const bloqueado = await ingresarConClave(base.db, { email: carlos.email, clave: CLAVE }, pedidoNuevo(), avanzar(10_000));
    expect(bloqueado).toMatchObject({ estado: 'bloqueado', mensaje: expect.stringMatching(/Esperá 1[45] minutos/) });
    // Un email que no existe se bloquea igual: el bloqueo no delata nada.
    for (let i = 0; i < 5; i++) await ingresarConClave(base.db, { email: 'fantasma@consultorio.test', clave: `mal ${i}` }, pedidoNuevo(), avanzar(1000));
    expect((await ingresarConClave(base.db, { email: 'fantasma@consultorio.test', clave: 'x' }, pedidoNuevo(), avanzar(1000))).estado).toBe('bloqueado');

    avanzar(16 * 60_000);
    expect((await ingresarConClave(base.db, { email: carlos.email, clave: CLAVE }, pedidoNuevo(), avanzar())).estado).toBe('falta_codigo');
  });

  it('los códigos equivocados también cuentan', async () => {
    const dora = await darDeAlta('Dora');
    const pedido = pedidoNuevo();
    const paso1 = await ingresarConClave(base.db, { email: dora.email, clave: CLAVE }, pedido, avanzar());
    if (paso1.estado !== 'falta_codigo') throw new Error('falta código');
    for (let i = 0; i < 5; i++) {
      expect((await ingresarConCodigo(base.db, { token: paso1.token, codigo: '000000' }, pedido, avanzar(5000))).estado).toBe('error');
    }
    const ahora = avanzar(5000);
    expect((await ingresarConCodigo(base.db, { token: paso1.token, codigo: codigoDe(dora.secreto, ahora) }, pedido, ahora)).estado).toBe('bloqueado');
    avanzar(16 * 60_000);
  });

  it('por IP: 20 fallos desde la misma IP bloquean esa IP para cualquier email', async () => {
    const elena = await darDeAlta('Elena');
    const atacante = pedidoNuevo();
    for (let i = 0; i < 20; i++) await ingresarConClave(base.db, { email: `prueba${i}@otro.test`, clave: 'adivinando' }, atacante, avanzar(1000));
    expect((await ingresarConClave(base.db, { email: elena.email, clave: CLAVE }, atacante, avanzar(1000))).estado).toBe('bloqueado');
    expect((await ingresarConClave(base.db, { email: elena.email, clave: CLAVE }, pedidoNuevo(), avanzar(1000))).estado).toBe('falta_codigo');
    avanzar(16 * 60_000);
  });
});

describe('administración de usuarios', () => {
  it('solo quien tiene usuarios.administrar puede', async () => {
    const entrada = { email: 'intruso@consultorio.test', nombre: 'In', apellido: 'Truso', roles: ['administrador' as const] };
    await expect(crearUsuario(base.db, secretariaSembrada, entrada, pedidoNuevo(), avanzar())).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(listarUsuariosDelConsultorio(base.db, secretariaSembrada)).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(desactivarUsuario(base.db, secretariaSembrada, admin.id, pedidoNuevo(), avanzar())).rejects.toBeInstanceOf(ErrorDePermiso);
    await expect(blanquearClave(base.db, secretariaSembrada, admin.id, pedidoNuevo(), avanzar())).rejects.toBeInstanceOf(ErrorDePermiso);
  });

  it('valida los datos: matrícula y especialidad para profesionales, email único', async () => {
    const sinMatricula = await crearUsuario(base.db, admin, { email: 'pro@consultorio.test', nombre: 'Pro', apellido: 'Fesional', roles: ['profesional'] }, pedidoNuevo(), avanzar());
    expect(sinMatricula).toMatchObject({ estado: 'invalido', errores: expect.arrayContaining(['Para un profesional hace falta la matrícula.']) });
    const repetido = await crearUsuario(base.db, admin, { email: 'carla@consultorio.test', nombre: 'Otra', apellido: 'Carla', roles: ['secretaria'] }, pedidoNuevo(), avanzar());
    expect(repetido).toMatchObject({ estado: 'invalido', errores: ['Ya hay un usuario con ese email.'] });
    const matricula = await crearUsuario(
      base.db,
      admin,
      { email: 'pro@consultorio.test', nombre: 'Pro', apellido: 'Fesional', roles: ['profesional'], matricula: 'MP 0002', especialidades: ['endodoncia'] },
      pedidoNuevo(),
      avanzar(),
    );
    expect(matricula).toMatchObject({ estado: 'invalido', errores: ['Esa matrícula ya está cargada para otra persona.'] });
  });

  it('un profesional nuevo queda con matrícula, especialidades y aparece en la agenda', async () => {
    const fede = await darDeAlta('Fede', ['profesional'], { matricula: 'MP 7777' });
    const cargado = await cargarUsuario(base.db, fede.id);
    expect(cargado).toMatchObject({ roles: ['profesional'], matricula: 'MP 7777', especialidades: ['endodoncia'] });
    expect((await listarProfesionales(base.db)).map((p) => p.id)).toContain(fede.id);
    const lista = await listarUsuariosDelConsultorio(base.db, admin);
    expect(lista.find((u) => u.id === fede.id)).toMatchObject({ estado: 'activo', tieneClave: true, tieneVerificacion: true });
  });

  it('desactivar cierra las sesiones, impide entrar y no borra nada; se puede reactivar', async () => {
    const gabi = await darDeAlta('Gabi', ['profesional'], { matricula: 'MP 8888' });
    const token = await ingresar(gabi);
    const resultado = await desactivarUsuario(base.db, admin, gabi.id, pedidoNuevo(), avanzar());
    expect(resultado.ok).toBe(true);
    expect(await validarSesion(base.db, token, avanzar())).toBeNull();
    expect(await ingresarConClave(base.db, { email: gabi.email, clave: CLAVE }, pedidoNuevo(), avanzar())).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('desactivado') });
    expect((await listarProfesionales(base.db)).map((p) => p.id)).not.toContain(gabi.id);
    expect((await listarUsuariosDelConsultorio(base.db, admin)).find((u) => u.id === gabi.id)?.estado).toBe('desactivado');
    expect((await reactivarUsuario(base.db, admin, gabi.id, pedidoNuevo(), avanzar())).ok).toBe(true);
    await ingresar(gabi);
    expect(await acciones(gabi.id)).toEqual(expect.arrayContaining(['usuario.desactivar', 'usuario.reactivar']));
  });

  it('protege a quien administra: no se desactiva a sí misma ni queda el consultorio sin administración', async () => {
    expect(await desactivarUsuario(base.db, admin, admin.id, pedidoNuevo(), avanzar())).toMatchObject({ ok: false });
    const sinAdmin = await actualizarUsuario(base.db, admin, admin.id, { email: admin.email, nombre: admin.nombre, apellido: admin.apellido, roles: ['profesional'], matricula: admin.matricula, especialidades: ['odontologia_general'] }, pedidoNuevo(), avanzar());
    expect(sinAdmin).toMatchObject({ ok: false });
    expect(await blanquearClave(base.db, admin, admin.id, pedidoNuevo(), avanzar())).toMatchObject({ ok: false });
  });

  it('cambiar los roles cambia los permisos y queda en la auditoría', async () => {
    const hugo = await darDeAlta('Hugo');
    const cambio = await actualizarUsuario(base.db, admin, hugo.id, { email: hugo.email, nombre: 'Hugo', apellido: 'Prueba', roles: ['secretaria', 'administrador'] }, pedidoNuevo(), avanzar());
    expect(cambio.ok).toBe(true);
    expect((await cargarUsuario(base.db, hugo.id))?.roles.toSorted()).toEqual(['administrador', 'secretaria']);
    expect(await acciones(hugo.id)).toContain('usuario.editar');
    // Con otra persona que administra, ahora sí se le puede sacar el rol a la primera... pero no a sí misma.
    const ficha = await fichaDeUsuario(base.db, admin, hugo.id);
    expect(ficha?.movimientos.map((m) => m.accion)).toContain('usuario.editar');
  });

  it('blanquear la contraseña: deja de servir, se cierran sesiones y con el enlace elige otra', async () => {
    const ines = await darDeAlta('Ines');
    const token = await ingresar(ines);
    const blanqueo = await blanquearClave(base.db, admin, ines.id, pedidoNuevo(), avanzar());
    if (!blanqueo.ok) throw new Error('debería blanquear');
    expect(await validarSesion(base.db, token, avanzar())).toBeNull();
    expect((await ingresarConClave(base.db, { email: ines.email, clave: CLAVE }, pedidoNuevo(), avanzar())).estado).toBe('error');
    const paso = await pasoClaveDelEnlace(base.db, blanqueo.enlace.token, { clave: 'mi frase nueva y larga', repetida: 'mi frase nueva y larga' }, pedidoNuevo(), avanzar());
    expect(paso).toEqual({ ok: true, siguiente: 'listo' });
    ines.clave = 'mi frase nueva y larga';
    await ingresar(ines);
    expect(await acciones(ines.id)).toEqual(expect.arrayContaining(['usuario.blanquear_clave', 'cuenta.definir_clave']));
  });

  it('blanquear la verificación: con el enlace y su contraseña configura otra app', async () => {
    const juan = await darDeAlta('Juan');
    const blanqueo = await blanquearVerificacion(base.db, admin, juan.id, pedidoNuevo(), avanzar());
    if (!blanqueo.ok) throw new Error('debería blanquear');
    expect(await ingresarConClave(base.db, { email: juan.email, clave: CLAVE }, pedidoNuevo(), avanzar())).toMatchObject({ estado: 'error', mensaje: expect.stringContaining('verificación') });
    // El enlace solo no alcanza: pide la contraseña.
    expect(await pasoClaveDelEnlace(base.db, blanqueo.enlace.token, { clave: 'no es la mía' }, pedidoNuevo(), avanzar())).toMatchObject({ ok: false });
    const paso1 = await pasoClaveDelEnlace(base.db, blanqueo.enlace.token, { clave: CLAVE }, pedidoNuevo(), avanzar());
    if (!paso1.ok || paso1.siguiente !== 'verificacion') throw new Error('debería pedir la app');
    const ahora = avanzar();
    expect((await pasoCodigoDelEnlace(base.db, blanqueo.enlace.token, codigoDe(paso1.clave.secreto, ahora), pedidoNuevo(), ahora)).ok).toBe(true);
    const viejos = await base.db
      .select()
      .from(schema.codigosRecuperacion)
      .where(and(eq(schema.codigosRecuperacion.usuarioId, juan.id), isNull(schema.codigosRecuperacion.anuladoEn)));
    expect(viejos).toHaveLength(10);
    juan.secreto = paso1.clave.secreto;
    await ingresar(juan);
  });

  it('desde la consola: primer administrador de un consultorio nuevo y recuperación de acceso', async () => {
    const primero = await crearPrimerAdministrador(base.db, { email: 'duena@otro.test', nombre: 'Dueña', apellido: 'Nueva', consultorio: 'Consultorio Norte', matricula: 'MP 9999' }, avanzar());
    expect(primero.estado).toBe('creado');
    if (primero.estado !== 'creado') return;
    const cargada = await cargarUsuario(base.db, primero.usuarioId);
    expect(cargada?.roles.toSorted()).toEqual(['administrador', 'profesional']);
    expect(cargada?.consultorio.nombre).toBe('Consultorio Norte');
    expect(await crearPrimerAdministrador(base.db, { email: 'otra@otro.test', nombre: 'Otra', apellido: 'Más', consultorio: 'Consultorio Norte' }, avanzar())).toMatchObject({
      estado: 'ya_hay_administradores',
    });
    const recuperado = await recuperarAccesoPorConsola(base.db, 'DUENA@otro.test', avanzar());
    expect(recuperado.ok).toBe(true);
    expect(await buscarEnlace(base.db, primero.enlace.token, avanzar())).toBeNull();
    expect(await acciones(primero.usuarioId)).toEqual(expect.arrayContaining(['usuario.crear', 'usuario.recuperar_acceso']));
  });
});

describe('varios consultorios', () => {
  it('la misma persona tiene roles distintos en cada consultorio y la sesión lleva el activo', async () => {
    const karen = await darDeAlta('Karen');
    // Primer ingreso con un solo consultorio: la próxima vez vuelve a ese.
    await ingresar(karen);
    const [sur] = await base.db.insert(schema.consultorios).values({ nombre: 'Consultorio Sur' }).returning();
    await base.db.insert(schema.consultorioMiembros).values({ consultorioId: sur!.id, usuarioId: karen.id });
    await base.db.insert(schema.usuarioRoles).values({ consultorioId: sur!.id, usuarioId: karen.id, rol: 'administrador' });

    expect((await cargarUsuario(base.db, karen.id, datos.consultorio.id))?.roles).toEqual(['secretaria']);
    expect((await cargarUsuario(base.db, karen.id, sur!.id))?.roles).toEqual(['administrador']);

    const token = await ingresar(karen);
    const sesion = (await validarSesion(base.db, token, avanzar()))!;
    expect(sesion.usuario.consultorio.id).toBe(datos.consultorio.id);
    expect(await cambiarConsultorioDeSesion(base.db, sesion.usuario, sesion.sesionId, sur!.id, pedidoNuevo(), avanzar())).toBe(true);
    const enSur = (await validarSesion(base.db, token, avanzar()))!;
    expect(enSur.usuario).toMatchObject({ roles: ['administrador'], consultorio: { nombre: 'Consultorio Sur' } });

    // Desde el Sur, Karen administra, pero no ve ni toca usuarios del otro consultorio.
    expect((await listarUsuariosDelConsultorio(base.db, enSur.usuario)).map((u) => u.id)).toEqual([karen.id]);
    expect(await fichaDeUsuario(base.db, enSur.usuario, admin.id)).toBeNull();
    await expect(blanquearClave(base.db, enSur.usuario, admin.id, pedidoNuevo(), avanzar())).rejects.toBeInstanceOf(ErrorDePermiso);
    // Y no puede pasarse a un consultorio al que no pertenece.
    const [ajeno] = await base.db.insert(schema.consultorios).values({ nombre: 'Ajeno' }).returning();
    expect(await cambiarConsultorioDeSesion(base.db, enSur.usuario, enSur.sesionId, ajeno!.id, pedidoNuevo(), avanzar())).toBe(false);
  });

  it('los consultorios y las pertenencias no se borran', async () => {
    await expect(base.db.delete(schema.consultorios)).rejects.toThrow();
    await expect(base.db.delete(schema.consultorioMiembros)).rejects.toThrow();
    await expect(base.db.delete(schema.enlacesAcceso)).rejects.toThrow();
  });
});

describe('usuarios de la semilla', () => {
  it('entran con la contraseña y la clave de prueba documentadas', async () => {
    const semilla = await crearBaseDePrueba();
    try {
      expect(await sembrarDatosDePrueba(semilla.db, '2026-11-26')).toBe(true);
      const [consultorio] = await semilla.db.select().from(schema.consultorios);
      expect(consultorio?.nombre).toBe('Micaela Massa Odontología');
      const ahora = new Date();
      const paso1 = await ingresarConClave(semilla.db, { email: 'mica@consultorio.local', clave: CLAVE_DE_PRUEBA }, pedidoNuevo(), ahora);
      if (paso1.estado !== 'falta_codigo') throw new Error(JSON.stringify(paso1));
      const paso2 = await ingresarConCodigo(semilla.db, { token: paso1.token, codigo: codigoDe(SECRETO_TOTP_DE_PRUEBA, ahora) }, pedidoNuevo(), ahora);
      expect(paso2.estado).toBe('ingreso');
      if (paso2.estado !== 'ingreso') return;
      expect((await validarSesion(semilla.db, paso2.token, ahora))?.usuario.roles.toSorted()).toEqual(['administrador', 'profesional']);
    } finally {
      await semilla.cliente.close();
    }
  });
});
