import { and, asc, eq } from 'drizzle-orm';
import { profesionalEspecialidades, profesionales, usuarioRoles, usuarios } from '../db/schema';
import type { BaseDeDatos } from '../db/tipos';
import type { UsuarioConRoles } from '../domain/permisos/permisos';
import type { Especialidad, Rol } from '../domain/permisos/roles';

export interface UsuarioSesion extends UsuarioConRoles {
  nombre: string;
  apellido: string;
  especialidades: Especialidad[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Usuario activo con sus roles, matrícula y especialidades. */
export async function cargarUsuario(db: BaseDeDatos, id: string): Promise<UsuarioSesion | null> {
  if (!UUID.test(id)) return null;
  const [usuario] = await db.select().from(usuarios).where(and(eq(usuarios.id, id), eq(usuarios.activo, true)));
  if (!usuario) return null;
  const [roles, [profesional], especialidades] = await Promise.all([
    db.select({ rol: usuarioRoles.rol }).from(usuarioRoles).where(eq(usuarioRoles.usuarioId, id)),
    db.select({ matricula: profesionales.matricula }).from(profesionales).where(eq(profesionales.usuarioId, id)),
    db.select({ especialidad: profesionalEspecialidades.especialidad }).from(profesionalEspecialidades).where(eq(profesionalEspecialidades.usuarioId, id)),
  ]);
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    apellido: usuario.apellido,
    activo: usuario.activo,
    roles: roles.map((r) => r.rol),
    matricula: profesional?.matricula ?? null,
    especialidades: especialidades.map((e) => e.especialidad),
  };
}

export interface UsuarioListado {
  id: string;
  nombre: string;
  apellido: string;
  roles: Rol[];
}

export async function listarUsuarios(db: BaseDeDatos): Promise<UsuarioListado[]> {
  const filas = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido, rol: usuarioRoles.rol })
    .from(usuarios)
    .innerJoin(usuarioRoles, eq(usuarioRoles.usuarioId, usuarios.id))
    .where(eq(usuarios.activo, true))
    .orderBy(asc(usuarios.apellido), asc(usuarios.nombre));
  const porId = new Map<string, UsuarioListado>();
  for (const fila of filas) {
    const usuario = porId.get(fila.id) ?? { id: fila.id, nombre: fila.nombre, apellido: fila.apellido, roles: [] };
    usuario.roles.push(fila.rol);
    porId.set(fila.id, usuario);
  }
  return [...porId.values()];
}

/** Profesionales activos, para la agenda. */
export async function listarProfesionales(db: BaseDeDatos): Promise<{ id: string; nombre: string; apellido: string; matricula: string }[]> {
  return db
    .select({ id: usuarios.id, nombre: usuarios.nombre, apellido: usuarios.apellido, matricula: profesionales.matricula })
    .from(profesionales)
    .innerJoin(usuarios, eq(usuarios.id, profesionales.usuarioId))
    .where(eq(usuarios.activo, true))
    .orderBy(asc(usuarios.apellido), asc(usuarios.nombre));
}
