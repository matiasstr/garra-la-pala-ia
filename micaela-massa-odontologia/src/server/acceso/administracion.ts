import { and, asc, desc, eq, inArray, isNotNull, isNull, max, ne } from 'drizzle-orm';
import { z } from 'zod';
import {
  auditoriaAccesos,
  codigosRecuperacion,
  consultorioMiembros,
  consultorios,
  enlacesAcceso,
  profesionalEspecialidades,
  profesionales,
  sesiones,
  usuarioRoles,
  usuarios,
} from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { normalizarEmail } from '../../domain/acceso/sesiones';
import { bloqueadoHasta as pinBloqueadoHasta } from '../../domain/firma/pin';
import { puede } from '../../domain/permisos/permisos';
import { ESPECIALIDADES, ROLES, type Especialidad, type Rol } from '../../domain/permisos/roles';
import { ErrorDePermiso } from '../errores';
import { esUuid, type UsuarioSesion } from '../usuarios';
import { cerrarSesionesDeUsuario } from './autenticacion';
import { anularEnlacesDeUsuario, crearEnlaceDeAcceso, type EnlaceCreado } from './enlaces';
import { auditarAcceso, PEDIDO_DE_CONSOLA, type DatosDelPedido } from './registro';

/**
 * Administración de usuarios de un consultorio: altas con roles, matrícula y
 * especialidades, cambios, desactivar (nunca borrar) y blanqueos. Todo queda
 * en la auditoría. Solo para quien tiene `usuarios.administrar`, y siempre
 * dentro del consultorio de su sesión.
 */

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const esquemaUsuario = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email('El email no es válido.')),
    nombre: z.string().trim().min(1, 'Falta el nombre.').max(80),
    apellido: z.string().trim().min(1, 'Falta el apellido.').max(80),
    roles: z.array(z.enum(ROLES)).min(1, 'Elegí al menos un rol.'),
    matricula: z.preprocess(vacioANull, z.string().trim().max(40).nullable().default(null)),
    especialidades: z.array(z.enum(ESPECIALIDADES)).default([]),
  })
  .superRefine((datos, ctx) => {
    if (datos.roles.includes('profesional')) {
      if (!datos.matricula) ctx.addIssue({ code: 'custom', message: 'Para un profesional hace falta la matrícula.' });
      if (!datos.especialidades.length) ctx.addIssue({ code: 'custom', message: 'Elegí al menos una especialidad.' });
    }
  });

export type EntradaUsuario = z.input<typeof esquemaUsuario>;

const mensajes = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

function exigirPermiso(admin: UsuarioSesion): void {
  if (!puede(admin, 'usuarios.administrar')) throw new ErrorDePermiso('No tenés permiso para administrar usuarios.');
}

export type EstadoDeAcceso = 'activo' | 'falta_configurar' | 'desactivado';

/** PIN de firma de un profesional (null si no está cargado como profesional). */
export type EstadoDelPin = 'sin_crear' | 'creado' | 'bloqueado';

export interface UsuarioAdministrado {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  roles: Rol[];
  matricula: string | null;
  especialidades: Especialidad[];
  estado: EstadoDeAcceso;
  tieneClave: boolean;
  tieneVerificacion: boolean;
  enlaceVenceEn: Date | null;
  ultimoIngresoEn: Date | null;
  pinDeFirma: EstadoDelPin | null;
}

/** Personas del consultorio de la sesión, con el estado de su acceso. */
export async function listarUsuariosDelConsultorio(db: BaseDeDatos, admin: UsuarioSesion, ahora: Date = new Date()): Promise<UsuarioAdministrado[]> {
  exigirPermiso(admin);
  const consultorioId = admin.consultorio.id;
  const filas = await db
    .select({
      id: usuarios.id,
      nombre: usuarios.nombre,
      apellido: usuarios.apellido,
      email: usuarios.email,
      cuentaActiva: usuarios.activo,
      miembroActivo: consultorioMiembros.activo,
      claveHash: usuarios.claveHash,
      totpConfirmadoEn: usuarios.totpConfirmadoEn,
      matricula: profesionales.matricula,
      pinFirmaHash: profesionales.pinFirmaHash,
      pinIntentosFallidos: profesionales.pinFirmaIntentosFallidos,
      pinBloqueadoHasta: profesionales.pinFirmaBloqueadoHasta,
    })
    .from(consultorioMiembros)
    .innerJoin(usuarios, eq(usuarios.id, consultorioMiembros.usuarioId))
    .leftJoin(profesionales, eq(profesionales.usuarioId, usuarios.id))
    .where(eq(consultorioMiembros.consultorioId, consultorioId))
    .orderBy(desc(consultorioMiembros.activo), asc(usuarios.apellido), asc(usuarios.nombre));
  const ids = filas.map((f) => f.id);
  if (!ids.length) return [];
  const [roles, especialidades, enlaces, ingresos] = await Promise.all([
    db.select().from(usuarioRoles).where(and(eq(usuarioRoles.consultorioId, consultorioId), inArray(usuarioRoles.usuarioId, ids))),
    db.select().from(profesionalEspecialidades).where(inArray(profesionalEspecialidades.usuarioId, ids)),
    db
      .select({ usuarioId: enlacesAcceso.usuarioId, venceEn: enlacesAcceso.venceEn })
      .from(enlacesAcceso)
      .where(and(inArray(enlacesAcceso.usuarioId, ids), isNull(enlacesAcceso.usadoEn), isNull(enlacesAcceso.anuladoEn))),
    db
      .select({ usuarioId: sesiones.usuarioId, ultimo: max(sesiones.verificadaEn) })
      .from(sesiones)
      .where(and(inArray(sesiones.usuarioId, ids), isNotNull(sesiones.verificadaEn)))
      .groupBy(sesiones.usuarioId),
  ]);
  return filas.map((f) => {
    const enlace = enlaces.find((e) => e.usuarioId === f.id && e.venceEn > ahora);
    const tieneClave = Boolean(f.claveHash);
    const tieneVerificacion = Boolean(f.totpConfirmadoEn);
    return {
      id: f.id,
      nombre: f.nombre,
      apellido: f.apellido,
      email: f.email,
      roles: ROLES.filter((r) => roles.some((x) => x.usuarioId === f.id && x.rol === r)),
      matricula: f.matricula,
      especialidades: especialidades.filter((e) => e.usuarioId === f.id).map((e) => e.especialidad),
      estado: !f.cuentaActiva || !f.miembroActivo ? 'desactivado' : tieneClave && tieneVerificacion ? 'activo' : 'falta_configurar',
      tieneClave,
      tieneVerificacion,
      enlaceVenceEn: enlace?.venceEn ?? null,
      ultimoIngresoEn: ingresos.find((i) => i.usuarioId === f.id)?.ultimo ?? null,
      pinDeFirma: !f.matricula
        ? null
        : !f.pinFirmaHash
          ? 'sin_crear'
          : pinBloqueadoHasta({ intentosFallidos: f.pinIntentosFallidos ?? 0, bloqueadoHasta: f.pinBloqueadoHasta }, ahora)
            ? 'bloqueado'
            : 'creado',
    };
  });
}

export interface MovimientoDeUsuario {
  accion: string;
  ocurridoEn: Date;
  quien: string;
}

/** Ficha de un usuario del consultorio con sus últimos movimientos de acceso. */
export async function fichaDeUsuario(db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, ahora: Date = new Date()): Promise<(UsuarioAdministrado & { movimientos: MovimientoDeUsuario[] }) | null> {
  exigirPermiso(admin);
  if (!esUuid(usuarioId)) return null;
  const usuario = (await listarUsuariosDelConsultorio(db, admin, ahora)).find((u) => u.id === usuarioId);
  if (!usuario) return null;
  const movimientos = await db
    .select({ accion: auditoriaAccesos.accion, ocurridoEn: auditoriaAccesos.ocurridoEn, nombre: usuarios.nombre, apellido: usuarios.apellido })
    .from(auditoriaAccesos)
    .innerJoin(usuarios, eq(usuarios.id, auditoriaAccesos.usuarioId))
    .where(and(inArray(auditoriaAccesos.entidad, ['usuario', 'profesional']), eq(auditoriaAccesos.entidadId, usuarioId)))
    .orderBy(desc(auditoriaAccesos.ocurridoEn), desc(auditoriaAccesos.id))
    .limit(15);
  return { ...usuario, movimientos: movimientos.map((m) => ({ accion: m.accion, ocurridoEn: m.ocurridoEn, quien: `${m.nombre} ${m.apellido}` })) };
}

type Escritor = Parameters<Parameters<BaseDeDatos['transaction']>[0]>[0];

/** Matrícula y especialidades. La fila de `profesionales` nunca se borra: la citan los registros firmados. */
async function guardarDatosProfesionales(tx: Escritor, usuarioId: string, datos: { roles: Rol[]; matricula: string | null; especialidades: Especialidad[] }) {
  if (!datos.roles.includes('profesional') || !datos.matricula) return;
  await tx.insert(profesionales).values({ usuarioId, matricula: datos.matricula }).onConflictDoUpdate({ target: profesionales.usuarioId, set: { matricula: datos.matricula } });
  await tx.delete(profesionalEspecialidades).where(eq(profesionalEspecialidades.usuarioId, usuarioId));
  await tx.insert(profesionalEspecialidades).values(datos.especialidades.map((especialidad) => ({ usuarioId, especialidad })));
}

async function matriculaEnUso(db: BaseDeDatos, matricula: string | null, salvo?: string): Promise<boolean> {
  if (!matricula) return false;
  const [otro] = await db
    .select({ id: profesionales.usuarioId })
    .from(profesionales)
    .where(and(eq(profesionales.matricula, matricula), salvo ? ne(profesionales.usuarioId, salvo) : undefined));
  return Boolean(otro);
}

export type ResultadoAlta = { estado: 'invalido'; errores: string[] } | { estado: 'creado'; usuarioId: string; enlace: EnlaceCreado };

/** Alta de un usuario en el consultorio. Devuelve el enlace de primer ingreso para pasárselo a la persona. */
export async function crearUsuario(db: BaseDeDatos, admin: UsuarioSesion, entrada: EntradaUsuario, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoAlta> {
  exigirPermiso(admin);
  const validacion = esquemaUsuario.safeParse(entrada);
  if (!validacion.success) return { estado: 'invalido', errores: mensajes(validacion.error) };
  const datos = validacion.data;
  const [existente] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, datos.email));
  if (existente) return { estado: 'invalido', errores: ['Ya hay un usuario con ese email.'] };
  if (await matriculaEnUso(db, datos.matricula)) return { estado: 'invalido', errores: ['Esa matrícula ya está cargada para otra persona.'] };

  return db.transaction(async (tx) => {
    const [usuario] = await tx.insert(usuarios).values({ email: datos.email, nombre: datos.nombre, apellido: datos.apellido, creadoEn: ahora }).returning({ id: usuarios.id });
    if (!usuario) throw new Error('No se pudo crear el usuario.');
    await tx.insert(consultorioMiembros).values({ consultorioId: admin.consultorio.id, usuarioId: usuario.id, creadoEn: ahora });
    await tx.insert(usuarioRoles).values(datos.roles.map((rol) => ({ consultorioId: admin.consultorio.id, usuarioId: usuario.id, rol })));
    await guardarDatosProfesionales(tx, usuario.id, datos);
    const enlace = await crearEnlaceDeAcceso(tx, { usuarioId: usuario.id, motivo: 'primer_ingreso', creadoPor: admin.id }, ahora);
    await auditarAcceso(tx, {
      usuarioId: admin.id,
      accion: 'usuario.crear',
      entidad: 'usuario',
      entidadId: usuario.id,
      detalle: { consultorioId: admin.consultorio.id, email: datos.email, roles: datos.roles, matricula: datos.matricula, especialidades: datos.especialidades },
      pedido,
      ahora,
    });
    return { estado: 'creado', usuarioId: usuario.id, enlace } as const;
  });
}

/** Que la persona sea de este consultorio (aunque esté desactivada); si no, ErrorDePermiso. */
export async function exigirMiembro(db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string): Promise<{ activo: boolean; cuentaActiva: boolean }> {
  const [miembro] = esUuid(usuarioId)
    ? await db
        .select({ activo: consultorioMiembros.activo, cuentaActiva: usuarios.activo })
        .from(consultorioMiembros)
        .innerJoin(usuarios, eq(usuarios.id, consultorioMiembros.usuarioId))
        .where(and(eq(consultorioMiembros.consultorioId, admin.consultorio.id), eq(consultorioMiembros.usuarioId, usuarioId)))
    : [];
  if (!miembro) throw new ErrorDePermiso('Ese usuario no es de este consultorio.');
  return miembro;
}

/** Cuántas personas activas, además de `salvo`, administran el consultorio. */
async function otrosAdministradores(db: BaseDeDatos, consultorioId: string, salvo: string): Promise<number> {
  const filas = await db
    .select({ id: usuarioRoles.usuarioId })
    .from(usuarioRoles)
    .innerJoin(consultorioMiembros, and(eq(consultorioMiembros.consultorioId, usuarioRoles.consultorioId), eq(consultorioMiembros.usuarioId, usuarioRoles.usuarioId)))
    .innerJoin(usuarios, eq(usuarios.id, usuarioRoles.usuarioId))
    .where(and(eq(usuarioRoles.consultorioId, consultorioId), eq(usuarioRoles.rol, 'administrador'), ne(usuarioRoles.usuarioId, salvo), eq(consultorioMiembros.activo, true), eq(usuarios.activo, true)));
  return filas.length;
}

const ULTIMO_ADMINISTRADOR = 'Tiene que quedar al menos otra persona que administre el consultorio.';

export type ResultadoCambio = { ok: true; mensaje: string } | { ok: false; errores: string[] };

/** Cambia datos, roles, matrícula y especialidades. */
export async function actualizarUsuario(db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, entrada: EntradaUsuario, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoCambio> {
  exigirPermiso(admin);
  await exigirMiembro(db, admin, usuarioId);
  const validacion = esquemaUsuario.safeParse(entrada);
  if (!validacion.success) return { ok: false, errores: mensajes(validacion.error) };
  const datos = validacion.data;
  const [otroConEmail] = await db.select({ id: usuarios.id }).from(usuarios).where(and(eq(usuarios.email, datos.email), ne(usuarios.id, usuarioId)));
  if (otroConEmail) return { ok: false, errores: ['Ya hay otro usuario con ese email.'] };
  if (await matriculaEnUso(db, datos.matricula, usuarioId)) return { ok: false, errores: ['Esa matrícula ya está cargada para otra persona.'] };
  const rolesAntes = (await db.select({ rol: usuarioRoles.rol }).from(usuarioRoles).where(and(eq(usuarioRoles.consultorioId, admin.consultorio.id), eq(usuarioRoles.usuarioId, usuarioId)))).map((r) => r.rol);
  const pierdeAdministracion = rolesAntes.includes('administrador') && !datos.roles.includes('administrador');
  if (pierdeAdministracion && usuarioId === admin.id) return { ok: false, errores: ['No podés sacarte a vos el rol de administración.'] };
  if (pierdeAdministracion && !(await otrosAdministradores(db, admin.consultorio.id, usuarioId))) return { ok: false, errores: [ULTIMO_ADMINISTRADOR] };

  await db.transaction(async (tx) => {
    await tx.update(usuarios).set({ email: datos.email, nombre: datos.nombre, apellido: datos.apellido }).where(eq(usuarios.id, usuarioId));
    await tx.delete(usuarioRoles).where(and(eq(usuarioRoles.consultorioId, admin.consultorio.id), eq(usuarioRoles.usuarioId, usuarioId)));
    await tx.insert(usuarioRoles).values(datos.roles.map((rol) => ({ consultorioId: admin.consultorio.id, usuarioId, rol })));
    await guardarDatosProfesionales(tx, usuarioId, datos);
    await auditarAcceso(tx, {
      usuarioId: admin.id,
      accion: 'usuario.editar',
      entidad: 'usuario',
      entidadId: usuarioId,
      detalle: { consultorioId: admin.consultorio.id, rolesAntes, roles: datos.roles, email: datos.email, matricula: datos.matricula, especialidades: datos.especialidades },
      pedido,
      ahora,
    });
  });
  return { ok: true, mensaje: 'Cambios guardados.' };
}

/**
 * Desactiva a la persona en este consultorio (nunca se borra). Si no le queda
 * ningún otro consultorio, también se desactiva su cuenta. Se cierran sus
 * sesiones y se anula el enlace pendiente.
 */
export async function desactivarUsuario(db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoCambio> {
  exigirPermiso(admin);
  const miembro = await exigirMiembro(db, admin, usuarioId);
  if (usuarioId === admin.id) return { ok: false, errores: ['No podés desactivar tu propio usuario.'] };
  if (!miembro.activo) return { ok: true, mensaje: 'El usuario ya estaba desactivado.' };
  if (!(await otrosAdministradores(db, admin.consultorio.id, usuarioId))) return { ok: false, errores: [ULTIMO_ADMINISTRADOR] };

  await db.transaction(async (tx) => {
    await tx.update(consultorioMiembros).set({ activo: false }).where(and(eq(consultorioMiembros.consultorioId, admin.consultorio.id), eq(consultorioMiembros.usuarioId, usuarioId)));
    const [otroConsultorio] = await tx
      .select({ id: consultorioMiembros.consultorioId })
      .from(consultorioMiembros)
      .where(and(eq(consultorioMiembros.usuarioId, usuarioId), eq(consultorioMiembros.activo, true)));
    if (!otroConsultorio) {
      await tx.update(usuarios).set({ activo: false }).where(eq(usuarios.id, usuarioId));
      await cerrarSesionesDeUsuario(tx, usuarioId, 'desactivado', ahora);
      await anularEnlacesDeUsuario(tx, usuarioId, ahora);
    } else {
      await cerrarSesionesDeUsuario(tx, usuarioId, 'desactivado', ahora, { consultorioId: admin.consultorio.id });
    }
    await auditarAcceso(tx, { usuarioId: admin.id, accion: 'usuario.desactivar', entidad: 'usuario', entidadId: usuarioId, detalle: { consultorioId: admin.consultorio.id, cuentaDesactivada: !otroConsultorio }, pedido, ahora });
  });
  return { ok: true, mensaje: 'Usuario desactivado. Ya no puede entrar a este consultorio.' };
}

export async function reactivarUsuario(db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoCambio> {
  exigirPermiso(admin);
  const miembro = await exigirMiembro(db, admin, usuarioId);
  if (miembro.activo && miembro.cuentaActiva) return { ok: true, mensaje: 'El usuario ya estaba activo.' };
  await db.transaction(async (tx) => {
    await tx.update(consultorioMiembros).set({ activo: true }).where(and(eq(consultorioMiembros.consultorioId, admin.consultorio.id), eq(consultorioMiembros.usuarioId, usuarioId)));
    await tx.update(usuarios).set({ activo: true }).where(eq(usuarios.id, usuarioId));
    await auditarAcceso(tx, { usuarioId: admin.id, accion: 'usuario.reactivar', entidad: 'usuario', entidadId: usuarioId, detalle: { consultorioId: admin.consultorio.id }, pedido, ahora });
  });
  return { ok: true, mensaje: 'Usuario reactivado.' };
}

export type ResultadoBlanqueo = { ok: true; enlace: EnlaceCreado } | { ok: false; errores: string[] };

type Blanqueo = 'clave' | 'verificacion' | 'enlace_nuevo';

async function blanquear(db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, que: Blanqueo, pedido: DatosDelPedido, ahora: Date): Promise<ResultadoBlanqueo> {
  exigirPermiso(admin);
  const miembro = await exigirMiembro(db, admin, usuarioId);
  if (!miembro.activo || !miembro.cuentaActiva) return { ok: false, errores: ['El usuario está desactivado: reactivalo primero.'] };
  if (usuarioId === admin.id && que !== 'enlace_nuevo') return { ok: false, errores: ['Para cambiar tu propio acceso andá a "Mi cuenta".'] };

  return db.transaction(async (tx) => {
    let motivo: 'primer_ingreso' | 'blanqueo_clave' | 'blanqueo_verificacion' = 'primer_ingreso';
    if (que === 'clave') {
      motivo = 'blanqueo_clave';
      await tx.update(usuarios).set({ claveHash: null, claveCambiadaEn: ahora }).where(eq(usuarios.id, usuarioId));
    } else if (que === 'verificacion') {
      motivo = 'blanqueo_verificacion';
      await tx.update(usuarios).set({ totpSecreto: null, totpConfirmadoEn: null, totpPendiente: null, totpPendienteEn: null }).where(eq(usuarios.id, usuarioId));
      await tx
        .update(codigosRecuperacion)
        .set({ anuladoEn: ahora })
        .where(and(eq(codigosRecuperacion.usuarioId, usuarioId), isNull(codigosRecuperacion.usadoEn), isNull(codigosRecuperacion.anuladoEn)));
    } else {
      const [fila] = await tx.select({ claveHash: usuarios.claveHash, totp: usuarios.totpConfirmadoEn }).from(usuarios).where(eq(usuarios.id, usuarioId));
      if (fila?.claveHash && fila.totp) return { ok: false, errores: ['Este usuario ya configuró su acceso: no necesita un enlace.'] } as const;
      motivo = fila?.claveHash ? 'blanqueo_verificacion' : fila?.totp ? 'blanqueo_clave' : 'primer_ingreso';
    }
    if (que !== 'enlace_nuevo') await cerrarSesionesDeUsuario(tx, usuarioId, 'blanqueo', ahora);
    const enlace = await crearEnlaceDeAcceso(tx, { usuarioId, motivo, creadoPor: admin.id }, ahora);
    const accion = { clave: 'usuario.blanquear_clave', verificacion: 'usuario.blanquear_verificacion', enlace_nuevo: 'usuario.enlace_nuevo' }[que];
    await auditarAcceso(tx, { usuarioId: admin.id, accion, entidad: 'usuario', entidadId: usuarioId, detalle: { consultorioId: admin.consultorio.id, venceEn: enlace.venceEn.toISOString() }, pedido, ahora });
    return { ok: true, enlace } as const;
  });
}

/** Borra la contraseña: la persona elige otra con el enlace. Su verificación en dos pasos sigue igual. */
export const blanquearClave = (db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, pedido: DatosDelPedido, ahora: Date = new Date()) =>
  blanquear(db, admin, usuarioId, 'clave', pedido, ahora);

/** Borra la verificación en dos pasos (perdió el celular): la configura de nuevo con el enlace y su contraseña. */
export const blanquearVerificacion = (db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, pedido: DatosDelPedido, ahora: Date = new Date()) =>
  blanquear(db, admin, usuarioId, 'verificacion', pedido, ahora);

/** Enlace nuevo para quien todavía no terminó de configurar su acceso (el anterior se perdió o venció). */
export const generarEnlaceNuevo = (db: BaseDeDatos, admin: UsuarioSesion, usuarioId: string, pedido: DatosDelPedido, ahora: Date = new Date()) =>
  blanquear(db, admin, usuarioId, 'enlace_nuevo', pedido, ahora);

// ---------------------------------------------------------------------------
// Consola: primer administrador de una base nueva (npm run crear-administrador)
// ---------------------------------------------------------------------------

export interface DatosPrimerAdministrador {
  email: string;
  nombre: string;
  apellido: string;
  consultorio: string;
  matricula?: string | null;
  especialidades?: Especialidad[];
}

export type ResultadoPrimerAdministrador =
  | { estado: 'creado'; usuarioId: string; consultorioId: string; enlace: EnlaceCreado }
  | { estado: 'invalido'; errores: string[] }
  | { estado: 'ya_hay_administradores'; consultorio: string };

/**
 * Crea el consultorio (si no hay ninguno con ese nombre) y su primer
 * administrador, que define contraseña y verificación con el enlace. No hay un
 * usuario que haga el alta: en la auditoría figura la propia persona creada,
 * con el detalle `{ desde: 'consola' }`.
 */
export async function crearPrimerAdministrador(db: BaseDeDatos, datos: DatosPrimerAdministrador, ahora: Date = new Date()): Promise<ResultadoPrimerAdministrador> {
  const roles: Rol[] = datos.matricula ? ['administrador', 'profesional'] : ['administrador'];
  const validacion = esquemaUsuario.safeParse({
    email: datos.email,
    nombre: datos.nombre,
    apellido: datos.apellido,
    roles,
    matricula: datos.matricula ?? null,
    especialidades: datos.especialidades?.length ? datos.especialidades : datos.matricula ? ['odontologia_general'] : [],
  });
  if (!validacion.success) return { estado: 'invalido', errores: mensajes(validacion.error) };
  const nombreConsultorio = datos.consultorio.trim();
  if (!nombreConsultorio) return { estado: 'invalido', errores: ['Falta el nombre del consultorio.'] };
  const valido = validacion.data;

  return db.transaction(async (tx) => {
    const [existente] = await tx.select({ id: consultorios.id }).from(consultorios).where(eq(consultorios.nombre, nombreConsultorio));
    const consultorioId = existente?.id ?? (await tx.insert(consultorios).values({ nombre: nombreConsultorio, creadoEn: ahora }).returning({ id: consultorios.id }))[0]?.id;
    if (!consultorioId) throw new Error('No se pudo crear el consultorio.');
    const [conAdmin] = await tx
      .select({ id: usuarioRoles.usuarioId })
      .from(usuarioRoles)
      .innerJoin(usuarios, eq(usuarios.id, usuarioRoles.usuarioId))
      .where(and(eq(usuarioRoles.consultorioId, consultorioId), eq(usuarioRoles.rol, 'administrador'), eq(usuarios.activo, true)));
    if (conAdmin) return { estado: 'ya_hay_administradores', consultorio: nombreConsultorio } as const;
    const [mismoEmail] = await tx.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, normalizarEmail(valido.email)));
    if (mismoEmail) return { estado: 'invalido', errores: ['Ya hay un usuario con ese email.'] } as const;

    const [usuario] = await tx.insert(usuarios).values({ email: valido.email, nombre: valido.nombre, apellido: valido.apellido, creadoEn: ahora }).returning({ id: usuarios.id });
    if (!usuario) throw new Error('No se pudo crear el usuario.');
    await tx.insert(consultorioMiembros).values({ consultorioId, usuarioId: usuario.id, creadoEn: ahora });
    await tx.insert(usuarioRoles).values(valido.roles.map((rol) => ({ consultorioId, usuarioId: usuario.id, rol })));
    await guardarDatosProfesionales(tx, usuario.id, valido);
    const enlace = await crearEnlaceDeAcceso(tx, { usuarioId: usuario.id, motivo: 'primer_ingreso', creadoPor: usuario.id }, ahora);
    await auditarAcceso(tx, {
      usuarioId: usuario.id,
      accion: 'usuario.crear',
      entidad: 'usuario',
      entidadId: usuario.id,
      detalle: { desde: 'consola', consultorioId, roles: valido.roles },
      pedido: PEDIDO_DE_CONSOLA,
      ahora,
    });
    return { estado: 'creado', usuarioId: usuario.id, consultorioId, enlace } as const;
  });
}

/**
 * Para cuando la única persona que administra perdió la contraseña o el
 * celular (y los códigos de recuperación): desde la consola del servidor se
 * borran su contraseña y su verificación, se cierran sus sesiones y se genera
 * un enlace nuevo. Queda en la auditoría como hecho desde la consola.
 */
export async function recuperarAccesoPorConsola(db: BaseDeDatos, email: string, ahora: Date = new Date()): Promise<{ ok: true; enlace: EnlaceCreado; nombre: string } | { ok: false; error: string }> {
  const [usuario] = await db.select({ id: usuarios.id, nombre: usuarios.nombre, activo: usuarios.activo }).from(usuarios).where(eq(usuarios.email, normalizarEmail(email)));
  if (!usuario) return { ok: false, error: 'No hay ningún usuario con ese email.' };
  if (!usuario.activo) return { ok: false, error: 'Ese usuario está desactivado.' };
  return db.transaction(async (tx) => {
    await tx
      .update(usuarios)
      .set({ claveHash: null, claveCambiadaEn: ahora, totpSecreto: null, totpConfirmadoEn: null, totpPendiente: null, totpPendienteEn: null })
      .where(eq(usuarios.id, usuario.id));
    await tx
      .update(codigosRecuperacion)
      .set({ anuladoEn: ahora })
      .where(and(eq(codigosRecuperacion.usuarioId, usuario.id), isNull(codigosRecuperacion.usadoEn), isNull(codigosRecuperacion.anuladoEn)));
    await cerrarSesionesDeUsuario(tx, usuario.id, 'blanqueo', ahora);
    const enlace = await crearEnlaceDeAcceso(tx, { usuarioId: usuario.id, motivo: 'blanqueo_clave', creadoPor: usuario.id }, ahora);
    await auditarAcceso(tx, { usuarioId: usuario.id, accion: 'usuario.recuperar_acceso', entidad: 'usuario', entidadId: usuario.id, detalle: { desde: 'consola' }, pedido: PEDIDO_DE_CONSOLA, ahora });
    return { ok: true, enlace, nombre: usuario.nombre } as const;
  });
}
