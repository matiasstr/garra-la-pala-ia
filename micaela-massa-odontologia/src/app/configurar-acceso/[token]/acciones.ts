'use server';

import { baseDeDatos } from '@/db/client';
import type { ClaveDeAppVisible } from '@/components/acceso/ClaveDeApp';
import { pasoClaveDelEnlace, pasoCodigoDelEnlace } from '@/server/acceso/enlaces';
import { datosDelPedido } from '@/server/sesion';

export interface EstadoPasoClave {
  errores: string[];
  siguiente?: 'listo' | 'verificacion';
  clave?: ClaveDeAppVisible;
}

export interface EstadoPasoCodigo {
  errores: string[];
  codigos?: string[];
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '');

/** Elegir la contraseña (o escribirla, si ya tenía) con el enlace de un solo uso. */
export async function pasoClaveAccion(token: string, _previo: EstadoPasoClave, datos: FormData): Promise<EstadoPasoClave> {
  const resultado = await pasoClaveDelEnlace(await baseDeDatos(), token, { clave: texto(datos, 'clave'), repetida: texto(datos, 'repetida') }, await datosDelPedido());
  if (!resultado.ok) return { errores: resultado.errores };
  return resultado.siguiente === 'listo' ? { errores: [], siguiente: 'listo' } : { errores: [], siguiente: 'verificacion', clave: resultado.clave };
}

/** Confirmar la app de autenticación con un código: devuelve los códigos de recuperación. */
export async function pasoCodigoAccion(token: string, _previo: EstadoPasoCodigo, datos: FormData): Promise<EstadoPasoCodigo> {
  const resultado = await pasoCodigoDelEnlace(await baseDeDatos(), token, texto(datos, 'codigo'), await datosDelPedido());
  return resultado.ok ? { errores: [], codigos: resultado.codigos } : { errores: resultado.errores };
}
