import { and, asc, count, desc, eq, ilike, inArray, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  alertasMedicas,
  auditoriaAccesos,
  financiadores,
  notasAdministrativas,
  pacienteCoberturas,
  pacientes,
  sillones,
  turnos,
  usuarios,
} from '../db/schema';
import type { BaseDeDatos } from '../db/tipos';
import type { EstadoTurno } from '../domain/agenda/turnos';
import { buscarCoincidencias, edad, normalizarDocumento, normalizarTexto, type MotivoCoincidencia } from '../domain/pacientes/identificacion';
import { puede, type UsuarioConRoles } from '../domain/permisos/permisos';
import { hoyEnArgentina } from '../lib/fechas';
import { detectarTipoImagen, tipoDeClave, type AlmacenArchivos } from './archivos';
import { ErrorDePermiso } from './errores';

const vacioANull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const textoOpcional = (max: number) => z.preprocess(vacioANull, z.string().trim().max(max).nullable().default(null));

export const TIPOS_DOCUMENTO = ['DNI', 'PAS', 'LC', 'LE', 'CI'] as const;

const esquemaContacto = z.object({
  telefono: textoOpcional(30),
  email: z.preprocess(vacioANull, z.email('El email no es válido').nullable().default(null)),
  aceptaMensajes: z.boolean().default(false),
});

const esquemaCobertura = z.object({
  financiadorId: z.uuid('Elegí la cobertura'),
  numeroAfiliado: textoOpcional(40),
  plan: textoOpcional(40),
});

const esquemaAlta = z
  .object({
    tipoDocumento: z.enum(TIPOS_DOCUMENTO).default('DNI'),
    numeroDocumento: z.string().trim().min(1, 'Falta el documento'),
    nombre: z.string().trim().min(1, 'Falta el nombre').max(80),
    apellido: z.string().trim().min(1, 'Falta el apellido').max(80),
    fechaNacimiento: z.iso.date('La fecha de nacimiento no es válida'),
  })
  .extend(esquemaContacto.shape)
  .extend(esquemaCobertura.shape);

export type EntradaAlta = z.input<typeof esquemaAlta>;

function documentoNormalizado(tipo: (typeof TIPOS_DOCUMENTO)[number], numero: string): string | null {
  if (tipo === 'DNI' || tipo === 'LC' || tipo === 'LE') return normalizarDocumento(numero);
  const limpio = numero.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpio.length >= 5 && limpio.length <= 15 ? limpio : null;
}

const mensajes = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

async function auditar(db: Pick<BaseDeDatos, 'insert'>, usuarioId: string, accion: string, pacienteId: string, detalle?: unknown) {
  await db.insert(auditoriaAccesos).values({ usuarioId, accion, entidad: 'paciente', entidadId: pacienteId, pacienteId, detalle: detalle ?? null });
}

export interface CoincidenciaPaciente {
  id: string;
  nombre: string;
  apellido: string;
  documento: string;
  fechaNacimiento: string;
  motivo: MotivoCoincidencia;
}

export type ResultadoAlta =
  | { estado: 'creado'; pacienteId: string }
  | { estado: 'invalido'; errores: string[] }
  /** Mismo documento: no se puede crear otro paciente. */
  | { estado: 'duplicado'; coincidencias: CoincidenciaPaciente[] }
  /** Homónimo o probable duplicado: hay que confirmar que es otra persona. */
  | { estado: 'confirmar'; coincidencias: CoincidenciaPaciente[] };

export async function altaPaciente(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  entrada: EntradaAlta,
  opciones: { confirmarQueEsOtraPersona?: boolean; hoy?: string } = {},
): Promise<ResultadoAlta> {
  if (!puede(usuario, 'paciente.editar_ficha')) throw new ErrorDePermiso('No tenés permiso para cargar pacientes.');
  const validacion = esquemaAlta.safeParse(entrada);
  if (!validacion.success) return { estado: 'invalido', errores: mensajes(validacion.error) };
  const datos = validacion.data;

  const hoy = opciones.hoy ?? hoyEnArgentina();
  const documento = documentoNormalizado(datos.tipoDocumento, datos.numeroDocumento);
  const errores: string[] = [];
  if (!documento) errores.push('El número de documento no es válido.');
  if (datos.fechaNacimiento > hoy || datos.fechaNacimiento < '1900-01-01') errores.push('La fecha de nacimiento no es válida.');
  if (datos.aceptaMensajes && !datos.telefono) errores.push('Para enviar recordatorios hace falta un teléfono.');
  if (errores.length || !documento) return { estado: 'invalido', errores };

  const nombreNormalizado = normalizarTexto(`${datos.apellido} ${datos.nombre}`);
  const candidatos = await db
    .select()
    .from(pacientes)
    .where(
      or(
        and(eq(pacientes.tipoDocumento, datos.tipoDocumento), eq(pacientes.numeroDocumento, documento)),
        eq(pacientes.nombreNormalizado, nombreNormalizado),
      ),
    );
  const coincidencias = buscarCoincidencias(
    { documento, nombre: datos.nombre, apellido: datos.apellido, fechaNacimiento: datos.fechaNacimiento },
    candidatos.map((p) => ({ ...p, documento: p.numeroDocumento })),
  );
  // Un pasaporte no pasa por `normalizarDocumento`: el mismo número también es el mismo paciente.
  const mismoDocumento = candidatos.filter((p) => p.tipoDocumento === datos.tipoDocumento && p.numeroDocumento === documento);
  const resumen = (motivo: MotivoCoincidencia) => (p: (typeof candidatos)[number]) => ({
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    documento: `${p.tipoDocumento} ${p.numeroDocumento}`,
    fechaNacimiento: p.fechaNacimiento,
    motivo,
  });
  if (mismoDocumento.length) return { estado: 'duplicado', coincidencias: mismoDocumento.map(resumen('mismo_documento')) };
  if (coincidencias.length && !opciones.confirmarQueEsOtraPersona) {
    return { estado: 'confirmar', coincidencias: coincidencias.map((c) => resumen(c.motivo)(candidatos.find((p) => p.id === c.paciente.id)!)) };
  }

  const pacienteId = await db.transaction(async (tx) => {
    const [paciente] = await tx
      .insert(pacientes)
      .values({
        tipoDocumento: datos.tipoDocumento,
        numeroDocumento: documento,
        nombre: datos.nombre,
        apellido: datos.apellido,
        fechaNacimiento: datos.fechaNacimiento,
        telefono: datos.telefono,
        email: datos.email,
        aceptaMensajes: datos.aceptaMensajes,
        aceptaMensajesEn: datos.aceptaMensajes ? new Date() : null,
        creadoPor: usuario.id,
      })
      .returning({ id: pacientes.id });
    if (!paciente) throw new Error('No se pudo crear el paciente.');
    await tx.insert(pacienteCoberturas).values({
      pacienteId: paciente.id,
      financiadorId: datos.financiadorId,
      numeroAfiliado: datos.numeroAfiliado,
      plan: datos.plan,
      vigenteDesde: hoy,
    });
    await auditar(tx, usuario.id, 'paciente.crear', paciente.id, coincidencias.length ? { confirmoQueEsOtraPersona: true } : undefined);
    return paciente.id;
  });
  return { estado: 'creado', pacienteId };
}

export interface PacienteListado {
  id: string;
  nombre: string;
  apellido: string;
  documento: string;
  edad: number;
  fotoKey: string | null;
  /** Cuántos otros pacientes se llaman igual. */
  homonimos: number;
}

/** Cuántos otros pacientes comparten cada nombre normalizado. */
export async function contarHomonimos(db: BaseDeDatos, nombres: readonly string[]): Promise<Map<string, number>> {
  if (!nombres.length) return new Map();
  const filas = await db
    .select({ nombre: pacientes.nombreNormalizado, cantidad: count() })
    .from(pacientes)
    .where(inArray(pacientes.nombreNormalizado, [...new Set(nombres)]))
    .groupBy(pacientes.nombreNormalizado);
  return new Map(filas.map((f) => [f.nombre ?? '', f.cantidad - 1]));
}

/** Búsqueda por nombre, apellido o documento, sin importar tildes ni mayúsculas. */
export async function buscarPacientes(db: BaseDeDatos, usuario: UsuarioConRoles, texto: string, limite = 25): Promise<PacienteListado[]> {
  if (!puede(usuario, 'paciente.ver_ficha')) throw new ErrorDePermiso('No tenés acceso a los pacientes.');
  const palabras = normalizarTexto(texto).split(' ').filter(Boolean).slice(0, 6);
  const filtro = palabras.length ? and(eq(pacientes.activo, true), ...palabras.map((p) => ilike(pacientes.textoBusqueda, `%${p}%`))) : eq(pacientes.activo, true);
  const filas = await db
    .select()
    .from(pacientes)
    .where(filtro)
    .orderBy(palabras.length ? asc(pacientes.apellido) : desc(pacientes.creadoEn), asc(pacientes.nombre))
    .limit(limite);
  const homonimos = await contarHomonimos(db, filas.map((p) => p.nombreNormalizado ?? ''));
  const hoy = hoyEnArgentina();
  return filas.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    documento: `${p.tipoDocumento} ${p.numeroDocumento}`,
    edad: edad(p.fechaNacimiento, hoy),
    fotoKey: p.fotoKey,
    homonimos: homonimos.get(p.nombreNormalizado ?? '') ?? 0,
  }));
}

export interface TurnoDePaciente {
  id: string;
  inicio: Date;
  fin: Date;
  estado: EstadoTurno;
  motivo: string | null;
  profesional: string;
  sillon: string | null;
}

export async function fichaPaciente(db: BaseDeDatos, usuario: UsuarioConRoles, id: string) {
  if (!puede(usuario, 'paciente.ver_ficha')) throw new ErrorDePermiso('No tenés acceso a los pacientes.');
  const [paciente] = await db.select().from(pacientes).where(eq(pacientes.id, id));
  if (!paciente) return null;

  const [coberturas, alertas, notas, homonimos, historialTurnos] = await Promise.all([
    db
      .select({ id: pacienteCoberturas.id, financiador: financiadores.nombre, esParticular: financiadores.esParticular, numeroAfiliado: pacienteCoberturas.numeroAfiliado, plan: pacienteCoberturas.plan, vigenteDesde: pacienteCoberturas.vigenteDesde, vigenteHasta: pacienteCoberturas.vigenteHasta })
      .from(pacienteCoberturas)
      .innerJoin(financiadores, eq(financiadores.id, pacienteCoberturas.financiadorId))
      .where(eq(pacienteCoberturas.pacienteId, id))
      .orderBy(desc(pacienteCoberturas.vigenteDesde)),
    puede(usuario, 'paciente.ver_alertas_medicas')
      ? db.select().from(alertasMedicas).where(and(eq(alertasMedicas.pacienteId, id), eq(alertasMedicas.activa, true))).orderBy(asc(alertasMedicas.creadoEn))
      : Promise.resolve([]),
    db
      .select({ id: notasAdministrativas.id, texto: notasAdministrativas.texto, creadoEn: notasAdministrativas.creadoEn, autor: usuarios.nombre })
      .from(notasAdministrativas)
      .innerJoin(usuarios, eq(usuarios.id, notasAdministrativas.autorId))
      .where(eq(notasAdministrativas.pacienteId, id))
      .orderBy(desc(notasAdministrativas.creadoEn)),
    db
      .select({ id: pacientes.id, nombre: pacientes.nombre, apellido: pacientes.apellido, documento: pacientes.numeroDocumento, fechaNacimiento: pacientes.fechaNacimiento })
      .from(pacientes)
      .where(and(eq(pacientes.nombreNormalizado, paciente.nombreNormalizado ?? ''), ne(pacientes.id, id))),
    db
      .select({ id: turnos.id, inicio: turnos.inicio, fin: turnos.fin, estado: turnos.estado, motivo: turnos.motivo, profesionalNombre: usuarios.nombre, profesionalApellido: usuarios.apellido, sillon: sillones.nombre })
      .from(turnos)
      .innerJoin(usuarios, eq(usuarios.id, turnos.profesionalId))
      .leftJoin(sillones, eq(sillones.id, turnos.sillonId))
      .where(eq(turnos.pacienteId, id))
      .orderBy(desc(turnos.inicio))
      .limit(50),
  ]);

  const ahora = Date.now();
  const turnosPaciente: TurnoDePaciente[] = historialTurnos.map((t) => ({
    id: t.id,
    inicio: t.inicio,
    fin: t.fin,
    estado: t.estado,
    motivo: t.motivo,
    profesional: `${t.profesionalNombre} ${t.profesionalApellido}`,
    sillon: t.sillon,
  }));

  return {
    paciente: { ...paciente, edad: edad(paciente.fechaNacimiento, hoyEnArgentina()) },
    coberturas,
    alertas: alertas.map((a) => ({ id: a.id, tipo: a.tipo, descripcion: a.descripcion })),
    notas,
    homonimos,
    proximosTurnos: turnosPaciente.filter((t) => t.inicio.getTime() >= ahora && ['reservado', 'confirmado'].includes(t.estado)).reverse(),
    historialTurnos: turnosPaciente.filter((t) => t.inicio.getTime() < ahora || !['reservado', 'confirmado'].includes(t.estado)),
    ausencias: turnosPaciente.filter((t) => t.estado === 'ausente').length,
    puedeEditar: puede(usuario, 'paciente.editar_ficha'),
    puedeVerHistoriaClinica: puede(usuario, 'hc.ver'),
    puedeDarTurnos: puede(usuario, 'turnos.gestionar'),
    puedeAgregarNotas: puede(usuario, 'notas_administrativas.gestionar'),
  };
}

export type FichaPaciente = NonNullable<Awaited<ReturnType<typeof fichaPaciente>>>;

export async function actualizarContacto(db: BaseDeDatos, usuario: UsuarioConRoles, id: string, entrada: z.input<typeof esquemaContacto>): Promise<{ errores: string[] }> {
  if (!puede(usuario, 'paciente.editar_ficha')) throw new ErrorDePermiso('No tenés permiso para editar la ficha.');
  const validacion = esquemaContacto.safeParse(entrada);
  if (!validacion.success) return { errores: mensajes(validacion.error) };
  const datos = validacion.data;
  if (datos.aceptaMensajes && !datos.telefono) return { errores: ['Para enviar recordatorios hace falta un teléfono.'] };

  const [anterior] = await db.select().from(pacientes).where(eq(pacientes.id, id));
  if (!anterior) return { errores: ['El paciente no existe.'] };
  const cambios = (['telefono', 'email', 'aceptaMensajes'] as const).filter((campo) => anterior[campo] !== datos[campo]);
  if (!cambios.length) return { errores: [] };

  await db.transaction(async (tx) => {
    await tx
      .update(pacientes)
      .set({
        ...datos,
        // Se guarda cuándo dio (o retiró) el permiso para mensajes.
        aceptaMensajesEn: datos.aceptaMensajes ? (anterior.aceptaMensajes ? anterior.aceptaMensajesEn : new Date()) : null,
      })
      .where(eq(pacientes.id, id));
    await auditar(tx, usuario.id, 'paciente.editar', id, { campos: cambios });
  });
  return { errores: [] };
}

export async function agregarCobertura(db: BaseDeDatos, usuario: UsuarioConRoles, id: string, entrada: z.input<typeof esquemaCobertura>): Promise<{ errores: string[] }> {
  if (!puede(usuario, 'paciente.editar_ficha')) throw new ErrorDePermiso('No tenés permiso para editar la ficha.');
  const validacion = esquemaCobertura.safeParse(entrada);
  if (!validacion.success) return { errores: mensajes(validacion.error) };
  await db.transaction(async (tx) => {
    await tx.insert(pacienteCoberturas).values({ pacienteId: id, ...validacion.data, vigenteDesde: hoyEnArgentina() });
    await auditar(tx, usuario.id, 'paciente.cobertura', id);
  });
  return { errores: [] };
}

export async function agregarNotaAdministrativa(db: BaseDeDatos, usuario: UsuarioConRoles, id: string, texto: string): Promise<{ errores: string[] }> {
  if (!puede(usuario, 'notas_administrativas.gestionar')) throw new ErrorDePermiso('No tenés permiso para agregar notas.');
  const limpio = texto.trim();
  if (!limpio) return { errores: ['La nota está vacía.'] };
  if (limpio.length > 1000) return { errores: ['La nota es demasiado larga (máximo 1000 caracteres).'] };
  await db.insert(notasAdministrativas).values({ pacienteId: id, texto: limpio, autorId: usuario.id });
  return { errores: [] };
}

const TAMANIO_MAXIMO_FOTO = 2 * 1024 * 1024;

export async function guardarFotoPaciente(
  db: BaseDeDatos,
  almacen: AlmacenArchivos,
  usuario: UsuarioConRoles,
  id: string,
  bytes: Uint8Array,
): Promise<{ errores: string[] }> {
  if (!puede(usuario, 'paciente.editar_ficha')) throw new ErrorDePermiso('No tenés permiso para editar la ficha.');
  if (bytes.byteLength > TAMANIO_MAXIMO_FOTO) return { errores: ['La foto pesa más de 2 MB.'] };
  const tipo = detectarTipoImagen(bytes);
  if (!tipo) return { errores: ['El archivo no es una imagen JPG, PNG o WebP.'] };
  const { clave } = await almacen.guardar('fotos', bytes, tipo);
  await db.transaction(async (tx) => {
    const [actualizado] = await tx.update(pacientes).set({ fotoKey: clave }).where(eq(pacientes.id, id)).returning({ id: pacientes.id });
    if (!actualizado) throw new Error('El paciente no existe.');
    await auditar(tx, usuario.id, 'paciente.foto', id);
  });
  return { errores: [] };
}

export async function leerFotoPaciente(db: BaseDeDatos, almacen: AlmacenArchivos, usuario: UsuarioConRoles, id: string) {
  if (!puede(usuario, 'paciente.ver_ficha')) throw new ErrorDePermiso('No tenés acceso a los pacientes.');
  const [paciente] = await db.select({ fotoKey: pacientes.fotoKey }).from(pacientes).where(eq(pacientes.id, id));
  if (!paciente?.fotoKey) return null;
  const tipo = tipoDeClave(paciente.fotoKey);
  const bytes = await almacen.leer(paciente.fotoKey);
  return bytes && tipo ? { bytes, tipo } : null;
}

export async function listarFinanciadores(db: BaseDeDatos) {
  return db.select().from(financiadores).where(eq(financiadores.activo, true)).orderBy(desc(financiadores.esParticular), asc(financiadores.nombre));
}
