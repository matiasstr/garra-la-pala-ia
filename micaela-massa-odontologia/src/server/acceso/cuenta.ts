import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { sesiones, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { hashearContrasena, validarContrasenaNueva, verificarContrasena } from '../../domain/acceso/contrasenas';
import { estadoDeSesion, huellaDeEmail, mensajeDeBloqueo } from '../../domain/acceso/sesiones';
import { consultoriosDeUsuario, type ConsultorioDeUsuario, type UsuarioSesion } from '../usuarios';
import { cerrarSesionesDeUsuario, politicaDeSesion } from './autenticacion';
import { auditarAcceso, bloqueoDeCuenta, candadoDeCuenta, conCandadoDeIntentos, registrarIntento, type DatosDelPedido } from './registro';
import { codigosDeRecuperacionRestantes, confirmarClaveDeApp, prepararClaveDeApp, renovarCodigosDeRecuperacion, usarCodigoDeApp, type ClaveParaLaApp } from './verificacion';

/**
 * "Mi cuenta": lo que cada persona puede hacer con su propio acceso. Las
 * acciones que cambian el acceso piden la contraseña o un código de la app,
 * aunque ya haya una sesión abierta (por si alguien dejó la computadora sola).
 */

export interface SesionAbierta {
  id: string;
  actual: boolean;
  dispositivo: string;
  ip: string | null;
  ingresoEn: Date;
  ultimoUsoEn: Date;
}

export interface EstadoDeCuenta {
  email: string;
  claveCambiadaEn: Date | null;
  verificacionDesde: Date | null;
  codigosRestantes: number;
  sesiones: SesionAbierta[];
  consultorios: ConsultorioDeUsuario[];
}

/** "Chrome en Android": suficiente para reconocer un dispositivo propio. */
export function describirDispositivo(userAgent: string | null): string {
  if (!userAgent) return 'Dispositivo desconocido';
  const navegador = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Navegador';
  const sistema = /iPhone|iPad/.test(userAgent)
    ? /iPad/.test(userAgent)
      ? 'iPad'
      : 'iPhone'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return sistema ? `${navegador} en ${sistema}` : navegador;
}

export async function estadoDeCuenta(db: BaseDeDatos, usuario: UsuarioSesion, sesionActualId: string | null, ahora: Date = new Date()): Promise<EstadoDeCuenta> {
  const [fila] = await db
    .select({ email: usuarios.email, claveCambiadaEn: usuarios.claveCambiadaEn, totpConfirmadoEn: usuarios.totpConfirmadoEn })
    .from(usuarios)
    .where(eq(usuarios.id, usuario.id));
  if (!fila) throw new Error('El usuario no existe.');
  const politica = politicaDeSesion();
  const [abiertas, codigosRestantes, consultorios] = await Promise.all([
    db
      .select()
      .from(sesiones)
      .where(and(eq(sesiones.usuarioId, usuario.id), isNull(sesiones.cerradaEn), isNotNull(sesiones.verificadaEn)))
      .orderBy(desc(sesiones.ultimoUsoEn))
      .limit(50),
    codigosDeRecuperacionRestantes(db, usuario.id),
    consultoriosDeUsuario(db, usuario.id),
  ]);
  return {
    email: fila.email,
    claveCambiadaEn: fila.claveCambiadaEn,
    verificacionDesde: fila.totpConfirmadoEn,
    codigosRestantes,
    consultorios,
    sesiones: abiertas
      .filter((s) => estadoDeSesion(s, ahora, politica) === 'activa')
      .map((s) => ({ id: s.id, actual: s.id === sesionActualId, dispositivo: describirDispositivo(s.userAgent), ip: s.ip, ingresoEn: s.verificadaEn!, ultimoUsoEn: s.ultimoUsoEn })),
  };
}

type Resultado = { ok: true; mensaje: string } | { ok: false; errores: string[] };

/**
 * Verifica la contraseña actual contando el fallo para el bloqueo de "Mi
 * cuenta" (por persona, aparte del ingreso: lo que intenten otros para entrar
 * con su email no la bloquea acá). De a un pedido por persona.
 */
async function comprobarClaveActual(db: BaseDeDatos, usuario: UsuarioSesion, clave: string, pedido: DatosDelPedido, ahora: Date): Promise<string | null> {
  return conCandadoDeIntentos(db, candadoDeCuenta(usuario.id), async (tx) => {
    const bloqueo = await bloqueoDeCuenta(tx, usuario.id, ahora);
    if (bloqueo) return mensajeDeBloqueo(bloqueo, ahora);
    const [fila] = await tx.select({ claveHash: usuarios.claveHash }).from(usuarios).where(eq(usuarios.id, usuario.id));
    if (fila?.claveHash && (await verificarContrasena(clave, fila.claveHash))) return null;
    await registrarIntento(tx, { emailHuella: huellaDeEmail(usuario.email), usuarioId: usuario.id, pedido, resultado: 'clave_incorrecta', ambito: 'cuenta', ahora });
    return 'La contraseña actual no es correcta.';
  });
}

/** Cambia la contraseña y cierra las demás sesiones abiertas. */
export async function cambiarClave(
  db: BaseDeDatos,
  usuario: UsuarioSesion,
  sesionActualId: string | null,
  entrada: { actual: string; nueva: string; repetida: string },
  pedido: DatosDelPedido,
  ahora: Date = new Date(),
): Promise<Resultado> {
  const errorActual = await comprobarClaveActual(db, usuario, entrada.actual, pedido, ahora);
  if (errorActual) return { ok: false, errores: [errorActual] };
  const errores = validarContrasenaNueva(entrada.nueva, usuario);
  if (entrada.nueva !== entrada.repetida) errores.push('Las dos contraseñas nuevas no coinciden.');
  if (entrada.nueva === entrada.actual) errores.push('La contraseña nueva tiene que ser distinta de la actual.');
  if (errores.length) return { ok: false, errores };
  const cerradas = await db.transaction(async (tx) => {
    await tx.update(usuarios).set({ claveHash: await hashearContrasena(entrada.nueva), claveCambiadaEn: ahora }).where(eq(usuarios.id, usuario.id));
    const cerradas = await cerrarSesionesDeUsuario(tx, usuario.id, 'cambio_de_clave', ahora, { excepto: sesionActualId });
    await auditarAcceso(tx, { usuarioId: usuario.id, accion: 'cuenta.cambiar_clave', entidad: 'usuario', entidadId: usuario.id, detalle: { sesionesCerradas: cerradas }, pedido, ahora });
    return cerradas;
  });
  return { ok: true, mensaje: cerradas ? `Contraseña cambiada. Se cerraron las otras ${cerradas === 1 ? 'sesión abierta' : `${cerradas} sesiones abiertas`}.` : 'Contraseña cambiada.' };
}

/** Primer paso para pasar la verificación a otro celular o app: pide la contraseña y da una clave nueva. */
export async function iniciarCambioDeApp(
  db: BaseDeDatos,
  usuario: UsuarioSesion,
  claveActual: string,
  pedido: DatosDelPedido,
  ahora: Date = new Date(),
): Promise<{ ok: true; clave: ClaveParaLaApp } | { ok: false; errores: string[] }> {
  const error = await comprobarClaveActual(db, usuario, claveActual, pedido, ahora);
  if (error) return { ok: false, errores: [error] };
  return { ok: true, clave: await prepararClaveDeApp(db, usuario.id, ahora) };
}

/** Confirma la app nueva con un código: la anterior deja de servir y hay códigos de recuperación nuevos. */
export async function confirmarCambioDeApp(
  db: BaseDeDatos,
  usuario: UsuarioSesion,
  codigo: string,
  pedido: DatosDelPedido,
  ahora: Date = new Date(),
): Promise<{ ok: true; codigos: string[] } | { ok: false; errores: string[] }> {
  const resultado = await confirmarClaveDeApp(db, usuario.id, codigo, ahora);
  if (!resultado.ok) return { ok: false, errores: [resultado.error] };
  await auditarAcceso(db, { usuarioId: usuario.id, accion: 'cuenta.configurar_verificacion', entidad: 'usuario', entidadId: usuario.id, pedido, ahora });
  return { ok: true, codigos: resultado.codigos };
}

/** Códigos de recuperación nuevos (los anteriores dejan de servir). Pide un código de la app. */
export async function nuevosCodigosDeRecuperacion(
  db: BaseDeDatos,
  usuario: UsuarioSesion,
  codigo: string,
  pedido: DatosDelPedido,
  ahora: Date = new Date(),
): Promise<{ ok: true; codigos: string[] } | { ok: false; errores: string[] }> {
  // Como la contraseña actual: bloqueo propio de "Mi cuenta", de a un pedido por persona.
  return conCandadoDeIntentos(db, candadoDeCuenta(usuario.id), async (tx) => {
    const bloqueo = await bloqueoDeCuenta(tx, usuario.id, ahora);
    if (bloqueo) return { ok: false, errores: [mensajeDeBloqueo(bloqueo, ahora)] } as const;
    const verificado = await usarCodigoDeApp(tx, usuario.id, codigo, ahora);
    if (!verificado.ok) {
      if (verificado.motivo !== 'formato') {
        await registrarIntento(tx, { emailHuella: huellaDeEmail(usuario.email), usuarioId: usuario.id, pedido, resultado: 'codigo_incorrecto', ambito: 'cuenta', ahora });
      }
      return { ok: false, errores: [verificado.error] } as const;
    }
    const codigos = await renovarCodigosDeRecuperacion(tx, usuario.id, ahora);
    await auditarAcceso(tx, { usuarioId: usuario.id, accion: 'cuenta.nuevos_codigos_de_recuperacion', entidad: 'usuario', entidadId: usuario.id, pedido, ahora });
    return { ok: true, codigos } as const;
  });
}

/** Cierra todas las sesiones de la persona menos la actual. */
export async function cerrarOtrasSesiones(db: BaseDeDatos, usuario: UsuarioSesion, sesionActualId: string | null, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<number> {
  const cerradas = await cerrarSesionesDeUsuario(db, usuario.id, 'otras_sesiones', ahora, { excepto: sesionActualId });
  await auditarAcceso(db, { usuarioId: usuario.id, accion: 'sesion.cerrar_otras', entidad: 'usuario', entidadId: usuario.id, detalle: { sesionesCerradas: cerradas }, pedido, ahora });
  return cerradas;
}

/** Cambia el consultorio en el que se trabaja en esta sesión (para quien pertenece a más de uno). */
export async function cambiarConsultorioDeSesion(db: BaseDeDatos, usuario: UsuarioSesion, sesionId: string, consultorioId: string, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<boolean> {
  const membresias = await consultoriosDeUsuario(db, usuario.id);
  if (!membresias.some((c) => c.id === consultorioId)) return false;
  const [cambiada] = await db
    .update(sesiones)
    .set({ consultorioId, ultimoUsoEn: ahora })
    .where(and(eq(sesiones.id, sesionId), eq(sesiones.usuarioId, usuario.id), isNull(sesiones.cerradaEn)))
    .returning({ id: sesiones.id });
  if (!cambiada) return false;
  await auditarAcceso(db, { usuarioId: usuario.id, accion: 'sesion.cambiar_consultorio', entidad: 'sesion', entidadId: sesionId, detalle: { de: usuario.consultorio.id, a: consultorioId }, pedido, ahora });
  return true;
}
