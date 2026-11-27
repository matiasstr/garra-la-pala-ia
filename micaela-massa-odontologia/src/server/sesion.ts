import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { esUsuarioDePrueba } from '../db/acceso-de-prueba';
import { baseDeDatos } from '../db/client';
import { buscarSesion, politicaDeSesion, validarSesion } from './acceso/autenticacion';
import type { DatosDelPedido } from './acceso/registro';
import { modoDesarrollo } from './entorno';
import { datosDeEncabezados, rutaInterna } from './pedido';
import { cargarUsuario, listarUsuarios, type UsuarioSesion } from './usuarios';

export const COOKIE_USUARIO_DESARROLLO = 'mm_usuario_desarrollo';

/**
 * Cookie de sesión: `httpOnly` (el JavaScript de la página no la ve),
 * `sameSite=lax` y, en producción, `secure` con el prefijo `__Host-` (solo por
 * HTTPS y sin que otro subdominio pueda pisarla). Sin vencimiento propio: el
 * servidor la da por vencida tras 12 horas sin uso, y se borra al cerrar el
 * navegador.
 */
const cookieSegura = () => process.env.NODE_ENV === 'production';
export const nombreCookieSesion = () => (cookieSegura() ? '__Host-mm_sesion' : 'mm_sesion');
/** Ruta pedida, que el proxy pasa al servidor para volver ahí después de ingresar. */
export const ENCABEZADO_RUTA = 'x-mm-ruta';

export async function guardarCookieDeSesion(token: string): Promise<void> {
  (await cookies()).set(nombreCookieSesion(), token, { httpOnly: true, secure: cookieSegura(), sameSite: 'lax', path: '/' });
}

export async function borrarCookieDeSesion(): Promise<void> {
  (await cookies()).delete({ name: nombreCookieSesion(), path: '/', secure: cookieSegura(), httpOnly: true, sameSite: 'lax' });
}

export async function tokenDeSesion(): Promise<string | null> {
  return (await cookies()).get(nombreCookieSesion())?.value ?? null;
}

/**
 * IP y navegador del pedido actual. Es la única forma de obtenerlos en todo el
 * sistema: la usan los bloqueos de ingreso, la auditoría de accesos y la de la
 * historia clínica (ver `datosDeEncabezados`).
 */
export async function datosDelPedido(): Promise<DatosDelPedido> {
  return datosDeEncabezados(await headers());
}

/**
 * Dirección completa de una ruta del sistema, para los enlaces que el
 * administrador pasa a mano. `URL_PUBLICA` la fija (recomendado en producción);
 * si no está, se arma con el dominio del pedido.
 */
export async function urlPublica(ruta: string): Promise<string> {
  const base = process.env.URL_PUBLICA?.replace(/\/+$/, '');
  if (base) return `${base}${ruta}`;
  const h = await headers();
  const host = h.get('x-forwarded-host')?.split(',')[0]?.trim() || h.get('host') || 'localhost:3000';
  const protocolo = h.get('x-forwarded-proto')?.split(',')[0]?.trim() || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  return `${protocolo}://${host}${ruta}`;
}

/** Solo rutas internas: evita que `?volver=` mande a otro sitio (ver `src/server/pedido.ts`). */
export { rutaInterna };

/** La sesión activa del pedido (con contraseña y código ya verificados), o null. */
export const sesionActual = cache(async (): Promise<{ sesionId: string; usuario: UsuarioSesion } | null> => {
  const token = await tokenDeSesion();
  if (!token) return null;
  return validarSesion(await baseDeDatos(), token, new Date(), politicaDeSesion());
});

/** En qué paso del ingreso está el navegador: para la pantalla de `/ingresar`. */
export async function pasoDeIngreso(): Promise<{ paso: 'activa' | 'falta_codigo'; usuarioId: string } | null> {
  const token = await tokenDeSesion();
  if (!token) return null;
  const sesion = await buscarSesion(await baseDeDatos(), token);
  if (!sesion || (sesion.estado !== 'activa' && sesion.estado !== 'falta_codigo')) return null;
  return { paso: sesion.estado, usuarioId: sesion.usuarioId };
}

/**
 * Usuario elegido en el selector de prueba. Solo cuentas de la semilla (del
 * dominio `@consultorio.local`): las que se crean durante la prueba entran
 * con su contraseña, como en el sistema real.
 */
async function usuarioDePrueba(): Promise<UsuarioSesion> {
  const db = await baseDeDatos();
  const elegido = (await cookies()).get(COOKIE_USUARIO_DESARROLLO)?.value;
  const usuario = elegido ? await cargarUsuario(db, elegido) : null;
  if (usuario && esUsuarioDePrueba(usuario.email)) return usuario;

  // Por defecto, la primera secretaria: es quien abre el consultorio.
  const usuarios = (await listarUsuarios(db)).filter((u) => esUsuarioDePrueba(u.email));
  const porDefecto = usuarios.find((u) => u.roles.includes('secretaria')) ?? usuarios[0];
  const cargado = porDefecto ? await cargarUsuario(db, porDefecto.id) : null;
  if (!cargado) throw new Error('No hay usuarios de prueba cargados.');
  return cargado;
}

/**
 * Usuario de la sesión actual.
 *
 * - Con una sesión iniciada en `/ingresar`, ese usuario (con sus roles en el
 *   consultorio de la sesión).
 * - Sin sesión, fuera de modo desarrollo: redirige a `/ingresar` (también desde
 *   una acción del servidor). El proxy ya filtra lo obvio, pero la verificación
 *   que vale es esta, contra la base.
 * - Sin sesión, en modo desarrollo: el usuario de prueba elegido en el
 *   encabezado, como siempre.
 */
export const usuarioActual = cache(async (): Promise<UsuarioSesion> => {
  const sesion = await sesionActual();
  if (sesion) return sesion.usuario;
  if (modoDesarrollo()) return usuarioDePrueba();

  const volver = rutaInterna((await headers()).get(ENCABEZADO_RUTA), '');
  const parametros = new URLSearchParams();
  if (volver) parametros.set('volver', volver);
  if (await tokenDeSesion()) parametros.set('motivo', 'sesion');
  const consulta = parametros.toString();
  redirect(`/ingresar${consulta ? `?${consulta}` : ''}`);
});
