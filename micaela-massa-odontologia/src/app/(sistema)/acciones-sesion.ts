'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { baseDeDatos } from '@/db/client';
import { cerrarSesion } from '@/server/acceso/autenticacion';
import { modoDesarrollo } from '@/server/entorno';
import { borrarCookieDeSesion, COOKIE_USUARIO_DESARROLLO, datosDelPedido, tokenDeSesion } from '@/server/sesion';
import { cargarUsuario } from '@/server/usuarios';

/** Solo en modo desarrollo: elegir con qué usuario de prueba se navega. */
export async function cambiarUsuarioDePrueba(datos: FormData): Promise<void> {
  if (!modoDesarrollo()) throw new Error('No disponible.');
  const id = String(datos.get('usuarioId') ?? '');
  const db = await baseDeDatos();
  const usuario = await cargarUsuario(db, id);
  if (!usuario) return;
  // Si había una sesión iniciada en /ingresar, el selector la reemplaza.
  const token = await tokenDeSesion();
  if (token) {
    await cerrarSesion(db, token, await datosDelPedido());
    await borrarCookieDeSesion();
  }
  (await cookies()).set(COOKIE_USUARIO_DESARROLLO, usuario.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}

/** Salir: cierra la sesión en la base y borra la cookie. */
export async function salirAccion(): Promise<void> {
  const token = await tokenDeSesion();
  if (token) await cerrarSesion(await baseDeDatos(), token, await datosDelPedido());
  await borrarCookieDeSesion();
  redirect('/ingresar?salio=1');
}
