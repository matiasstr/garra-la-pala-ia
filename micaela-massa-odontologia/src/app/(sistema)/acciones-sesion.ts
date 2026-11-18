'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { baseDeDatos } from '@/db/client';
import { modoDesarrollo } from '@/server/entorno';
import { COOKIE_USUARIO_DESARROLLO } from '@/server/sesion';
import { cargarUsuario } from '@/server/usuarios';

/** Solo en modo desarrollo: elegir con qué usuario de prueba se navega. */
export async function cambiarUsuarioDePrueba(datos: FormData): Promise<void> {
  if (!modoDesarrollo()) throw new Error('No disponible.');
  const id = String(datos.get('usuarioId') ?? '');
  const usuario = await cargarUsuario(await baseDeDatos(), id);
  if (!usuario) return;
  (await cookies()).set(COOKIE_USUARIO_DESARROLLO, usuario.id, { httpOnly: true, sameSite: 'lax', path: '/' });
  revalidatePath('/', 'layout');
}
