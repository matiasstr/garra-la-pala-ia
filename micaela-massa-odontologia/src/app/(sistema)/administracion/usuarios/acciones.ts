'use server';

import { revalidatePath } from 'next/cache';
import { baseDeDatos } from '@/db/client';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { fechaDe, formatoFechaLarga, formatoHora } from '@/lib/fechas';
import {
  actualizarUsuario,
  blanquearClave,
  blanquearVerificacion,
  crearUsuario,
  desactivarUsuario,
  generarEnlaceNuevo,
  reactivarUsuario,
  type EntradaUsuario,
  type ResultadoBlanqueo,
  type ResultadoCambio,
} from '@/server/acceso/administracion';
import { rutaDeEnlace, type EnlaceCreado } from '@/server/acceso/enlaces';
import { ErrorDePermiso } from '@/server/errores';
import { datosDelPedido, urlPublica, usuarioActual } from '@/server/sesion';

export interface EnlaceVisible {
  url: string;
  vence: string;
}

export interface EstadoAdministracion extends EstadoFormulario {
  usuarioId?: string;
  enlace?: EnlaceVisible;
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim();
const lista = (datos: FormData, campo: string) => datos.getAll(campo).map(String);

function entrada(datos: FormData): EntradaUsuario {
  return {
    email: texto(datos, 'email'),
    nombre: texto(datos, 'nombre'),
    apellido: texto(datos, 'apellido'),
    roles: lista(datos, 'roles') as EntradaUsuario['roles'],
    matricula: texto(datos, 'matricula'),
    especialidades: lista(datos, 'especialidades') as EntradaUsuario['especialidades'],
  };
}

async function visible(enlace: EnlaceCreado): Promise<EnlaceVisible> {
  return { url: await urlPublica(rutaDeEnlace(enlace.token)), vence: `${formatoFechaLarga(fechaDe(enlace.venceEn))} a las ${formatoHora(enlace.venceEn)}` };
}

/** Convierte la falta de permiso en un mensaje del formulario. */
async function conPermiso(operacion: () => Promise<EstadoAdministracion>): Promise<EstadoAdministracion> {
  try {
    return await operacion();
  } catch (e) {
    if (e instanceof ErrorDePermiso) return { ok: false, errores: [e.message] };
    throw e;
  }
}

export async function crearUsuarioAccion(_previo: EstadoAdministracion, datos: FormData): Promise<EstadoAdministracion> {
  return conPermiso(async () => {
    const resultado = await crearUsuario(await baseDeDatos(), await usuarioActual(), entrada(datos), await datosDelPedido());
    if (resultado.estado === 'invalido') return { ok: false, errores: resultado.errores };
    revalidatePath('/administracion/usuarios');
    return { ok: true, errores: [], mensaje: 'Usuario creado.', usuarioId: resultado.usuarioId, enlace: await visible(resultado.enlace) };
  });
}

export async function actualizarUsuarioAccion(usuarioId: string, _previo: EstadoAdministracion, datos: FormData): Promise<EstadoAdministracion> {
  return conPermiso(async () => {
    const resultado = await actualizarUsuario(await baseDeDatos(), await usuarioActual(), usuarioId, entrada(datos), await datosDelPedido());
    return deCambio(resultado, usuarioId);
  });
}

function deCambio(resultado: ResultadoCambio, usuarioId: string): EstadoAdministracion {
  if (!resultado.ok) return { ok: false, errores: resultado.errores };
  revalidatePath('/administracion/usuarios');
  revalidatePath(`/administracion/usuarios/${usuarioId}`);
  return { ok: true, errores: [], mensaje: resultado.mensaje };
}

async function deBlanqueo(resultado: ResultadoBlanqueo, usuarioId: string, mensaje: string): Promise<EstadoAdministracion> {
  if (!resultado.ok) return { ok: false, errores: resultado.errores };
  revalidatePath('/administracion/usuarios');
  revalidatePath(`/administracion/usuarios/${usuarioId}`);
  return { ok: true, errores: [], mensaje, enlace: await visible(resultado.enlace) };
}

const ACCIONES = {
  desactivar: async (usuarioId: string) => deCambio(await desactivarUsuario(await baseDeDatos(), await usuarioActual(), usuarioId, await datosDelPedido()), usuarioId),
  reactivar: async (usuarioId: string) => deCambio(await reactivarUsuario(await baseDeDatos(), await usuarioActual(), usuarioId, await datosDelPedido()), usuarioId),
  blanquear_clave: async (usuarioId: string) =>
    deBlanqueo(await blanquearClave(await baseDeDatos(), await usuarioActual(), usuarioId, await datosDelPedido()), usuarioId, 'Contraseña blanqueada. Se cerraron sus sesiones.'),
  blanquear_verificacion: async (usuarioId: string) =>
    deBlanqueo(
      await blanquearVerificacion(await baseDeDatos(), await usuarioActual(), usuarioId, await datosDelPedido()),
      usuarioId,
      'Verificación en dos pasos blanqueada. Se cerraron sus sesiones y sus códigos de recuperación dejaron de servir.',
    ),
  enlace_nuevo: async (usuarioId: string) =>
    deBlanqueo(await generarEnlaceNuevo(await baseDeDatos(), await usuarioActual(), usuarioId, await datosDelPedido()), usuarioId, 'Enlace nuevo generado. El anterior ya no sirve.'),
} as const;

export type AccionSobreUsuario = keyof typeof ACCIONES;

export async function accionSobreUsuario(usuarioId: string, accion: AccionSobreUsuario, _previo: EstadoAdministracion, _datos: FormData): Promise<EstadoAdministracion> {
  if (!Object.hasOwn(ACCIONES, accion)) return { ok: false, errores: ['Acción desconocida.'] };
  return conPermiso(() => ACCIONES[accion](usuarioId));
}
