'use server';

import { revalidatePath } from 'next/cache';
import { baseDeDatos } from '@/db/client';
import type { ClaveDeAppVisible } from '@/components/acceso/ClaveDeApp';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { cambiarClave, cambiarConsultorioDeSesion, cerrarOtrasSesiones, confirmarCambioDeApp, iniciarCambioDeApp, nuevosCodigosDeRecuperacion } from '@/server/acceso/cuenta';
import { datosDelPedido, sesionActual, usuarioActual } from '@/server/sesion';

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '');

export interface EstadoCambioDeApp {
  errores: string[];
  clave?: ClaveDeAppVisible;
}

export interface EstadoCodigos {
  errores: string[];
  codigos?: string[];
}

export async function cambiarClaveAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  const usuario = await usuarioActual();
  const sesion = await sesionActual();
  const resultado = await cambiarClave(
    await baseDeDatos(),
    usuario,
    sesion?.sesionId ?? null,
    { actual: texto(datos, 'actual'), nueva: texto(datos, 'nueva'), repetida: texto(datos, 'repetida') },
    await datosDelPedido(),
  );
  if (!resultado.ok) return { ok: false, errores: resultado.errores };
  revalidatePath('/cuenta');
  return { ok: true, errores: [], mensaje: resultado.mensaje };
}

export async function iniciarCambioDeAppAccion(_previo: EstadoCambioDeApp, datos: FormData): Promise<EstadoCambioDeApp> {
  const resultado = await iniciarCambioDeApp(await baseDeDatos(), await usuarioActual(), texto(datos, 'clave'), await datosDelPedido());
  return resultado.ok ? { errores: [], clave: resultado.clave } : { errores: resultado.errores };
}

export async function confirmarCambioDeAppAccion(_previo: EstadoCodigos, datos: FormData): Promise<EstadoCodigos> {
  const resultado = await confirmarCambioDeApp(await baseDeDatos(), await usuarioActual(), texto(datos, 'codigo'), await datosDelPedido());
  if (!resultado.ok) return { errores: resultado.errores };
  revalidatePath('/cuenta');
  return { errores: [], codigos: resultado.codigos };
}

export async function nuevosCodigosAccion(_previo: EstadoCodigos, datos: FormData): Promise<EstadoCodigos> {
  const resultado = await nuevosCodigosDeRecuperacion(await baseDeDatos(), await usuarioActual(), texto(datos, 'codigo'), await datosDelPedido());
  if (!resultado.ok) return { errores: resultado.errores };
  revalidatePath('/cuenta');
  return { errores: [], codigos: resultado.codigos };
}

export async function cerrarOtrasSesionesAccion(_previo: EstadoFormulario, _datos: FormData): Promise<EstadoFormulario> {
  const usuario = await usuarioActual();
  const sesion = await sesionActual();
  const cerradas = await cerrarOtrasSesiones(await baseDeDatos(), usuario, sesion?.sesionId ?? null, await datosDelPedido());
  revalidatePath('/cuenta');
  return { ok: true, errores: [], mensaje: cerradas ? `Listo: se ${cerradas === 1 ? 'cerró 1 sesión' : `cerraron ${cerradas} sesiones`}.` : 'No había otras sesiones abiertas.' };
}

export async function cambiarConsultorioAccion(datos: FormData): Promise<void> {
  const usuario = await usuarioActual();
  const sesion = await sesionActual();
  if (!sesion) return;
  await cambiarConsultorioDeSesion(await baseDeDatos(), usuario, sesion.sesionId, texto(datos, 'consultorioId'), await datosDelPedido());
  revalidatePath('/', 'layout');
}
