'use server';

import { redirect } from 'next/navigation';
import { baseDeDatos } from '@/db/client';
import { cerrarSesion, ingresarConClave, ingresarConCodigo } from '@/server/acceso/autenticacion';
import { borrarCookieDeSesion, datosDelPedido, guardarCookieDeSesion, rutaInterna, tokenDeSesion } from '@/server/sesion';

export interface EstadoIngreso {
  errores: string[];
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '');
const conVolver = (ruta: string, volver: string) => (volver === '/agenda' ? ruta : `${ruta}${ruta.includes('?') ? '&' : '?'}volver=${encodeURIComponent(volver)}`);

/** Paso 1: email y contraseña. Si están bien, la pantalla pasa a pedir el código. */
export async function ingresarConClaveAccion(_previo: EstadoIngreso, datos: FormData): Promise<EstadoIngreso> {
  const volver = rutaInterna(texto(datos, 'volver'));
  const resultado = await ingresarConClave(await baseDeDatos(), { email: texto(datos, 'email'), clave: texto(datos, 'clave') }, await datosDelPedido());
  if (resultado.estado !== 'falta_codigo') return { errores: [resultado.mensaje] };
  await guardarCookieDeSesion(resultado.token);
  redirect(conVolver('/ingresar', volver));
}

/** Paso 2: código de la app o de recuperación. */
export async function ingresarConCodigoAccion(_previo: EstadoIngreso, datos: FormData): Promise<EstadoIngreso> {
  const volver = rutaInterna(texto(datos, 'volver'));
  const token = await tokenDeSesion();
  if (!token) redirect(conVolver('/ingresar?motivo=paso_vencido', volver));
  const resultado = await ingresarConCodigo(await baseDeDatos(), { token, codigo: texto(datos, 'codigo') }, await datosDelPedido());
  if (resultado.estado !== 'ingreso') {
    if (resultado.estado === 'error') return { errores: [resultado.mensaje] };
    await borrarCookieDeSesion();
    redirect(conVolver(`/ingresar?motivo=${resultado.estado === 'vencido' ? 'paso_vencido' : 'bloqueado'}`, volver));
  }
  await guardarCookieDeSesion(resultado.token);
  redirect(resultado.usoCodigoDeRecuperacion ? '/cuenta?recuperacion=1' : volver);
}

/** "No soy yo" / volver a empezar: cierra el ingreso a medio hacer. */
export async function cancelarIngresoAccion(): Promise<void> {
  const token = await tokenDeSesion();
  if (token) await cerrarSesion(await baseDeDatos(), token, await datosDelPedido());
  await borrarCookieDeSesion();
  redirect('/ingresar');
}
