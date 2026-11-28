'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { baseDeDatos } from '@/db/client';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { almacenDelSistema } from '@/server/entorno';
import { ErrorDePermiso } from '@/server/errores';
import { actualizarContacto, agregarCobertura, agregarNotaAdministrativa, altaPaciente, guardarFotoPaciente, TIPOS_DOCUMENTO, type CoincidenciaPaciente } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim();

/** Ejecuta una operación y convierte la falta de permisos en un mensaje para el formulario. */
async function conPermisos(operacion: () => Promise<{ errores: string[] }>, mensajeOk: string, ruta: string): Promise<EstadoFormulario> {
  try {
    const { errores } = await operacion();
    if (errores.length) return { ok: false, errores };
  } catch (e) {
    if (e instanceof ErrorDePermiso) return { ok: false, errores: [e.message] };
    throw e;
  }
  revalidatePath(ruta);
  return { ok: true, errores: [], mensaje: mensajeOk };
}

export interface EstadoAltaPaciente extends EstadoFormulario {
  coincidencias?: CoincidenciaPaciente[];
  duplicado?: boolean;
}

export async function altaPacienteAccion(_previo: EstadoAltaPaciente, datos: FormData): Promise<EstadoAltaPaciente> {
  const tipoDocumento = texto(datos, 'tipoDocumento') as (typeof TIPOS_DOCUMENTO)[number];
  let resultado;
  try {
    resultado = await altaPaciente(
      await baseDeDatos(),
      await usuarioActual(),
      {
        tipoDocumento: TIPOS_DOCUMENTO.includes(tipoDocumento) ? tipoDocumento : 'DNI',
        numeroDocumento: texto(datos, 'numeroDocumento'),
        nombre: texto(datos, 'nombre'),
        apellido: texto(datos, 'apellido'),
        fechaNacimiento: texto(datos, 'fechaNacimiento'),
        telefono: texto(datos, 'telefono'),
        email: texto(datos, 'email'),
        aceptaMensajes: datos.get('aceptaMensajes') === 'si',
        financiadorId: texto(datos, 'financiadorId'),
        numeroAfiliado: texto(datos, 'numeroAfiliado'),
        plan: texto(datos, 'plan'),
      },
      { confirmarQueEsOtraPersona: datos.get('confirmar') === 'si' },
    );
  } catch (e) {
    if (e instanceof ErrorDePermiso) return { ok: false, errores: [e.message] };
    throw e;
  }

  switch (resultado.estado) {
    case 'invalido':
      return { ok: false, errores: resultado.errores };
    case 'duplicado':
      return { ok: false, errores: ['Ya hay un paciente con ese documento.'], coincidencias: resultado.coincidencias, duplicado: true };
    case 'confirmar':
      return { ok: false, errores: [], coincidencias: resultado.coincidencias };
    case 'creado':
      revalidatePath('/pacientes');
      redirect(`/pacientes/${resultado.pacienteId}?nuevo=1`);
  }
}

export async function actualizarContactoAccion(pacienteId: string, _previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  return conPermisos(
    async () =>
      actualizarContacto(await baseDeDatos(), await usuarioActual(), pacienteId, {
        telefono: texto(datos, 'telefono'),
        email: texto(datos, 'email'),
        aceptaMensajes: datos.get('aceptaMensajes') === 'si',
      }),
    'Datos de contacto guardados.',
    `/pacientes/${pacienteId}`,
  );
}

export async function agregarCoberturaAccion(pacienteId: string, _previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  return conPermisos(
    async () =>
      agregarCobertura(await baseDeDatos(), await usuarioActual(), pacienteId, {
        financiadorId: texto(datos, 'financiadorId'),
        numeroAfiliado: texto(datos, 'numeroAfiliado'),
        plan: texto(datos, 'plan'),
      }),
    'Cobertura agregada.',
    `/pacientes/${pacienteId}`,
  );
}

export async function agregarNotaAccion(pacienteId: string, _previo: EstadoFormulario, datos: FormData): Promise<EstadoFormulario> {
  return conPermisos(
    async () => agregarNotaAdministrativa(await baseDeDatos(), await usuarioActual(), pacienteId, texto(datos, 'texto')),
    'Nota agregada.',
    `/pacientes/${pacienteId}`,
  );
}

export async function subirFotoAccion(pacienteId: string, datos: FormData): Promise<EstadoFormulario> {
  const archivo = datos.get('foto');
  if (!(archivo instanceof File) || archivo.size === 0) return { ok: false, errores: ['Elegí una foto.'] };
  return conPermisos(
    async () => guardarFotoPaciente(await baseDeDatos(), almacenDelSistema(), await usuarioActual(), pacienteId, new Uint8Array(await archivo.arrayBuffer())),
    'Foto actualizada.',
    `/pacientes/${pacienteId}`,
  );
}
