'use server';

import { revalidatePath } from 'next/cache';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { baseDeDatos } from '@/db/client';
import { ErrorDePermiso } from '@/server/errores';
import { guardarPinDeFirma, reponerPinOlvidado } from '@/server/hc/pin';
import { datosDelPedido, usuarioActual } from '@/server/sesion';

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '');

export async function guardarPinAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  try {
    const { errores } = await guardarPinDeFirma(
      await baseDeDatos(),
      await usuarioActual(),
      { actual: texto(datos, 'actual') || undefined, nuevo: texto(datos, 'nuevo'), repeticion: texto(datos, 'repeticion') },
      await datosDelPedido(),
    );
    if (errores.length) return { ok: false, errores };
  } catch (error) {
    if (error instanceof ErrorDePermiso) return { ok: false, errores: [error.message] };
    throw error;
  }
  revalidatePath('/cuenta/pin-de-firma');
  return { ok: true, errores: [], mensaje: 'Listo: tu PIN de firma quedó guardado. Lo vas a escribir cada vez que firmes.' };
}

/** "¿Te olvidaste el PIN?": PIN nuevo confirmando con la contraseña y un código de la app. */
export async function reponerPinAccion(_previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  try {
    const { errores } = await reponerPinOlvidado(
      await baseDeDatos(),
      await usuarioActual(),
      { clave: texto(datos, 'clave'), codigo: texto(datos, 'codigo'), nuevo: texto(datos, 'nuevo'), repeticion: texto(datos, 'repeticion') },
      await datosDelPedido(),
    );
    if (errores.length) return { ok: false, errores };
  } catch (error) {
    if (error instanceof ErrorDePermiso) return { ok: false, errores: [error.message] };
    throw error;
  }
  revalidatePath('/cuenta/pin-de-firma');
  return { ok: true, errores: [], mensaje: 'Listo: tu PIN de firma nuevo quedó guardado. El anterior ya no sirve.' };
}
