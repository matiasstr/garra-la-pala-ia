import { and, asc, eq } from 'drizzle-orm';
import { consultorioMiembros, consultorios, profesionalEspecialidades, profesionales, usuarioRoles, usuarios } from '../db/schema';
import type { BaseDeDatos } from '../db/tipos';
import type { UsuarioConRoles } from '../domain/permisos/permisos';
import type { Especialidad, Rol } from '../domain/permisos/roles';

export interface ConsultorioDeUsuario {
  id: string;
  nombre: string;
}

export interface UsuarioSesion extends UsuarioConRoles {
  nombre: string;
  apellido: string;
  email: string;
  especialidades: Especialidad[];
  /** Consultorio en el que trabaja ahora (el de la sesión). Los roles son los de ese consultorio. */
  consultorio: ConsultorioDeUsuario;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const esUuid = (texto: string): boolean => UUID.test(texto);

/** Consultorios activos en los que la persona está activa, por nombre. */
export async function consultoriosDeUsuario(db: BaseDeDatos, usuarioId: string): Promise<ConsultorioDeUsuario[]> {
  if (!UUID.test(usuarioId)) return [];
  return db
    .select({ id: consultorios.id, nombre: consultorios.nombre })
    .from(consultorioMiembros)
    .innerJoin(consultorios, eq(consultorios.id, consultorioMiembros.consultorioId))
    .where(and(eq(consultorioMiembros.usuarioId, usuarioId), eq(consultorioMiembros.activo, true), eq(consultorios.activo, true)))
    .orderBy(asc(consultorios.nombre), asc(consultorios.creadoEn));
}

/**
 * Usuario activo con sus roles en un consultorio, matrícula y especialidades.
 * Sin `consultorioId`, el primero al que pertenece (hoy hay uno solo).
 * Devuelve null si la cuenta está desactivada o no pertenece a ese consultorio.
 */
export async function cargarUsuario(db: BaseDeDatos, id: string, consultorioId?: string): Promise<UsuarioSesion | null> {
  if (!UUID.test(id)) return null;
  const [usuario] = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido, email: usuarios.email, activo: usuarios.activo })
    .from(usuarios)
    .where(and(eq(usuarios.id, id), eq(usuarios.activo, true)));
  if (!usuario) return null;
  const membresias = await consultoriosDeUsuario(db, id);
  const consultorio = consultorioId ? membresias.find((c) => c.id === consultorioId) : membresias[0];
  if (!consultorio) return null;
  const [roles, [profesional], especialidades] = await Promise.all([
    db.select({ rol: usuarioRoles.rol }).from(usuarioRoles).where(and(eq(usuarioRoles.usuarioId, id), eq(usuarioRoles.consultorioId, consultorio.id))),
    db.select({ matricula: profesionales.matricula }).from(profesionales).where(eq(profesionales.usuarioId, id)),
    db.select({ especialidad: profesionalEspecialidades.especialidad }).from(profesionalEspecialidades).where(eq(profesionalEspecialidades.usuarioId, id)),
  ]);
  return {
    ...usuario,
    roles: roles.map((r) => r.rol),
    matricula: profesional?.matricula ?? null,
    especialidades: especialidades.map((e) => e.especialidad),
    consultorio,
  };
}

export interface UsuarioListado {
  id: string;
  nombre: string;
  apellido: string;
  roles: Rol[];
}

/** Usuarios activos con sus roles (de un consultorio, si se indica). */
export async function listarUsuarios(db: BaseDeDatos, consultorioId?: string): Promise<UsuarioListado[]> {
  const filas = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido, rol: usuarioRoles.rol })
    .from(usuarios)
    .innerJoin(usuarioRoles, eq(usuarioRoles.usuarioId, usuarios.id))
    .innerJoin(consultorioMiembros, and(eq(consultorioMiembros.usuarioId, usuarioRoles.usuarioId), eq(consultorioMiembros.consultorioId, usuarioRoles.consultorioId)))
    .where(and(eq(usuarios.activo, true), eq(consultorioMiembros.activo, true), consultorioId ? eq(usuarioRoles.consultorioId, consultorioId) : undefined))
    .orderBy(asc(usuarios.apellido), asc(usuarios.nombre));
  const porId = new Map<string, UsuarioListado>();
  for (const fila of filas) {
    const usuario = porId.get(fila.id) ?? { id: fila.id, nombre: fila.nombre, apellido: fila.apellido, roles: [] };
    if (!usuario.roles.includes(fila.rol)) usuario.roles.push(fila.rol);
    porId.set(fila.id, usuario);
  }
  return [...porId.values()];
}

/**
 * Profesionales activos, para la agenda: con matrícula y con el rol de
 * profesional vigente (si se le quitó el rol, deja de aparecer).
 */
export async function listarProfesionales(db: BaseDeDatos): Promise<{ id: string; nombre: string; apellido: string; matricula: string }[]> {
  return db
    .selectDistinct({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido, matricula: profesionales.matricula })
    .from(profesionales)
    .innerJoin(usuarios, eq(usuarios.id, profesionales.usuarioId))
    .innerJoin(usuarioRoles, and(eq(usuarioRoles.usuarioId, usuarios.id), eq(usuarioRoles.rol, 'profesional')))
    .innerJoin(consultorioMiembros, and(eq(consultorioMiembros.usuarioId, usuarioRoles.usuarioId), eq(consultorioMiembros.consultorioId, usuarioRoles.consultorioId)))
    .where(and(eq(usuarios.activo, true), eq(consultorioMiembros.activo, true)))
    .orderBy(asc(usuarios.apellido), asc(usuarios.nombre));
}
