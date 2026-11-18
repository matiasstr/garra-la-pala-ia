import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { baseDeDatos } from '../db/client';
import { modoDesarrollo } from './entorno';
import { cargarUsuario, listarUsuarios, type UsuarioSesion } from './usuarios';

export const COOKIE_USUARIO_DESARROLLO = 'mm_usuario_desarrollo';

/**
 * Usuario de la sesión actual.
 *
 * Todavía no hay inicio de sesión (ver docs/arquitectura.md). En modo
 * desarrollo se elige un usuario de prueba desde el encabezado; fuera de ese
 * modo el sistema se niega a funcionar.
 */
export const usuarioActual = cache(async (): Promise<UsuarioSesion> => {
  if (!modoDesarrollo()) throw new Error('El inicio de sesión todavía no está configurado.');
  const db = await baseDeDatos();
  const elegido = (await cookies()).get(COOKIE_USUARIO_DESARROLLO)?.value;
  const usuario = elegido ? await cargarUsuario(db, elegido) : null;
  if (usuario) return usuario;

  // Por defecto, la primera secretaria: es quien abre el consultorio.
  const usuarios = await listarUsuarios(db);
  const porDefecto = usuarios.find((u) => u.roles.includes('secretaria')) ?? usuarios[0];
  const cargado = porDefecto ? await cargarUsuario(db, porDefecto.id) : null;
  if (!cargado) throw new Error('No hay usuarios cargados.');
  return cargado;
});
