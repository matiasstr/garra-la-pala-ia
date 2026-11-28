import { and, eq, isNull } from 'drizzle-orm';
import { enlacesAcceso, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { hashearContrasena, validarContrasenaNueva, verificarContrasena } from '../../domain/acceso/contrasenas';
import { VIGENCIA_ENLACE_MS, formatoDeTokenValido, generarToken, hashToken, huellaDeEmail, mensajeDeBloqueo } from '../../domain/acceso/sesiones';
import { cerrarSesionesDeUsuario } from './autenticacion';
import { auditarAcceso, bloqueoVigente, candadoDeIngreso, conCandadoDeIntentos, registrarIntento, type DatosDelPedido } from './registro';
import { confirmarClaveDeApp, prepararClaveDeApp, type ClaveParaLaApp } from './verificacion';

/**
 * Enlaces de un solo uso para el primer ingreso y los blanqueos. El enlace
 * lleva un token al azar; en la base queda su hash. Vence a las 72 horas y se
 * marca como usado cuando la persona termina de configurar su acceso.
 */
export type MotivoEnlace = (typeof enlacesAcceso.$inferInsert)['motivo'];

export interface EnlaceCreado {
  token: string;
  venceEn: Date;
}

export const rutaDeEnlace = (token: string): string => `/configurar-acceso/${token}`;

/** Crea un enlace nuevo y anula el que hubiera vigente. */
export async function crearEnlaceDeAcceso(
  db: Pick<BaseDeDatos, 'insert' | 'update'>,
  entrada: { usuarioId: string; motivo: MotivoEnlace; creadoPor: string },
  ahora: Date,
): Promise<EnlaceCreado> {
  await db
    .update(enlacesAcceso)
    .set({ anuladoEn: ahora })
    .where(and(eq(enlacesAcceso.usuarioId, entrada.usuarioId), isNull(enlacesAcceso.usadoEn), isNull(enlacesAcceso.anuladoEn)));
  const token = generarToken();
  const venceEn = new Date(ahora.getTime() + VIGENCIA_ENLACE_MS);
  await db.insert(enlacesAcceso).values({ ...entrada, tokenHash: hashToken(token), creadoEn: ahora, venceEn });
  return { token, venceEn };
}

export async function anularEnlacesDeUsuario(db: Pick<BaseDeDatos, 'update'>, usuarioId: string, ahora: Date): Promise<void> {
  await db
    .update(enlacesAcceso)
    .set({ anuladoEn: ahora })
    .where(and(eq(enlacesAcceso.usuarioId, usuarioId), isNull(enlacesAcceso.usadoEn), isNull(enlacesAcceso.anuladoEn)));
}

export interface EnlaceVigente {
  id: string;
  motivo: MotivoEnlace;
  venceEn: Date;
  usuario: { id: string; nombre: string; apellido: string; email: string; tieneClave: boolean; tieneVerificacion: boolean };
}

/** El enlace del token si sigue vigente (sin usar, sin anular, sin vencer y con la cuenta activa). */
export async function buscarEnlace(db: BaseDeDatos, token: string, ahora: Date = new Date()): Promise<EnlaceVigente | null> {
  if (!formatoDeTokenValido(token)) return null;
  const [fila] = await db
    .select({
      id: enlacesAcceso.id,
      motivo: enlacesAcceso.motivo,
      venceEn: enlacesAcceso.venceEn,
      usadoEn: enlacesAcceso.usadoEn,
      anuladoEn: enlacesAcceso.anuladoEn,
      usuarioId: usuarios.id,
      nombre: usuarios.nombre,
      apellido: usuarios.apellido,
      email: usuarios.email,
      activo: usuarios.activo,
      claveHash: usuarios.claveHash,
      totpConfirmadoEn: usuarios.totpConfirmadoEn,
    })
    .from(enlacesAcceso)
    .innerJoin(usuarios, eq(usuarios.id, enlacesAcceso.usuarioId))
    .where(eq(enlacesAcceso.tokenHash, hashToken(token)));
  if (!fila || fila.usadoEn || fila.anuladoEn || fila.venceEn <= ahora || !fila.activo) return null;
  return {
    id: fila.id,
    motivo: fila.motivo,
    venceEn: fila.venceEn,
    usuario: { id: fila.usuarioId, nombre: fila.nombre, apellido: fila.apellido, email: fila.email, tieneClave: Boolean(fila.claveHash), tieneVerificacion: Boolean(fila.totpConfirmadoEn) },
  };
}

const ENLACE_INVALIDO = 'Este enlace ya no sirve: se usó, venció o se generó uno más nuevo. Pedile otro a quien administra el consultorio.';

export type ResultadoPasoClave = { ok: false; errores: string[] } | { ok: true; siguiente: 'listo' } | { ok: true; siguiente: 'verificacion'; clave: ClaveParaLaApp };

async function marcarUsado(db: Pick<BaseDeDatos, 'update'>, enlaceId: string, ahora: Date): Promise<boolean> {
  const [usado] = await db
    .update(enlacesAcceso)
    .set({ usadoEn: ahora })
    .where(and(eq(enlacesAcceso.id, enlaceId), isNull(enlacesAcceso.usadoEn), isNull(enlacesAcceso.anuladoEn)))
    .returning({ id: enlacesAcceso.id });
  return Boolean(usado);
}

/**
 * Primer paso del enlace:
 * - si la persona no tiene contraseña (primer ingreso o blanqueo), la define;
 * - si ya tiene (blanqueo de la verificación), la escribe para demostrar que es ella.
 * Después, si le falta la verificación en dos pasos, se le da una clave para la app.
 */
export async function pasoClaveDelEnlace(
  db: BaseDeDatos,
  token: string,
  entrada: { clave: string; repetida?: string },
  pedido: DatosDelPedido,
  ahora: Date = new Date(),
): Promise<ResultadoPasoClave> {
  const enlace = await buscarEnlace(db, token, ahora);
  if (!enlace) return { ok: false, errores: [ENLACE_INVALIDO] };
  const { usuario } = enlace;

  if (usuario.tieneClave) {
    // Cuenta como un intento de ingreso con ese email (mismas reglas y mismo candado).
    const huella = huellaDeEmail(usuario.email);
    const error = await conCandadoDeIntentos(db, candadoDeIngreso(huella), async (tx) => {
      const bloqueo = await bloqueoVigente(tx, huella, pedido.ip, ahora);
      if (bloqueo) return mensajeDeBloqueo(bloqueo, ahora);
      const [fila] = await tx.select({ claveHash: usuarios.claveHash }).from(usuarios).where(eq(usuarios.id, usuario.id));
      if (fila?.claveHash && (await verificarContrasena(entrada.clave, fila.claveHash))) return null;
      await registrarIntento(tx, { emailHuella: huella, usuarioId: usuario.id, pedido, resultado: 'clave_incorrecta', ahora });
      return 'La contraseña no es correcta.';
    });
    if (error) return { ok: false, errores: [error] };
  } else {
    const errores = validarContrasenaNueva(entrada.clave, usuario);
    if (entrada.clave !== entrada.repetida) errores.push('Las dos contraseñas no coinciden.');
    if (errores.length) return { ok: false, errores };
    await db.transaction(async (tx) => {
      await tx.update(usuarios).set({ claveHash: await hashearContrasena(entrada.clave), claveCambiadaEn: ahora }).where(eq(usuarios.id, usuario.id));
      await cerrarSesionesDeUsuario(tx, usuario.id, 'cambio_de_clave', ahora);
      await auditarAcceso(tx, { usuarioId: usuario.id, accion: 'cuenta.definir_clave', entidad: 'usuario', entidadId: usuario.id, detalle: { motivo: enlace.motivo }, pedido, ahora });
    });
  }

  if (usuario.tieneVerificacion) {
    if (!(await marcarUsado(db, enlace.id, ahora))) return { ok: false, errores: [ENLACE_INVALIDO] };
    return { ok: true, siguiente: 'listo' };
  }
  return { ok: true, siguiente: 'verificacion', clave: await prepararClaveDeApp(db, usuario.id, ahora) };
}

export type ResultadoPasoCodigo = { ok: false; errores: string[] } | { ok: true; codigos: string[] };

/** Segundo paso: confirma la app con un código, entrega los códigos de recuperación y cierra el enlace. */
export async function pasoCodigoDelEnlace(db: BaseDeDatos, token: string, codigo: string, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoPasoCodigo> {
  const enlace = await buscarEnlace(db, token, ahora);
  if (!enlace) return { ok: false, errores: [ENLACE_INVALIDO] };
  if (!enlace.usuario.tieneClave) return { ok: false, errores: ['Primero elegí tu contraseña.'] };
  const resultado = await confirmarClaveDeApp(db, enlace.usuario.id, codigo, ahora);
  if (!resultado.ok) return { ok: false, errores: [resultado.error] };
  await marcarUsado(db, enlace.id, ahora);
  await auditarAcceso(db, { usuarioId: enlace.usuario.id, accion: 'cuenta.configurar_verificacion', entidad: 'usuario', entidadId: enlace.usuario.id, detalle: { motivo: enlace.motivo }, pedido, ahora });
  return { ok: true, codigos: resultado.codigos };
}
