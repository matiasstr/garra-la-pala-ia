import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { sesiones, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { pareceCodigoRecuperacion } from '../../domain/acceso/codigos-recuperacion';
import { hashDeSenuelo, hashearContrasena, necesitaRehash, verificarContrasena } from '../../domain/acceso/contrasenas';
import {
  POLITICA_DE_SESION,
  estadoDeSesion,
  formatoDeTokenValido,
  generarToken,
  hashToken,
  hayQueRefrescarUso,
  huellaDeEmail,
  mensajeDeBloqueo,
  normalizarEmail,
  type EstadoDeSesion,
  type PoliticaDeSesion,
} from '../../domain/acceso/sesiones';
import { cargarUsuario, consultoriosDeUsuario, type UsuarioSesion } from '../usuarios';
import { auditarAcceso, bloqueoVigente, candadoDeIngreso, conCandadoDeIntentos, registrarIntento, type DatosDelPedido } from './registro';
import { codigosDeRecuperacionRestantes, usarCodigoDeApp, usarCodigoDeRecuperacion } from './verificacion';

/**
 * Inicio de sesión en dos pasos:
 * 1. email y contraseña → se abre una sesión que todavía no sirve para nada
 *    más que escribir el código (vence a los 10 minutos);
 * 2. código de la app (o uno de recuperación) → la sesión queda activa con un
 *    token nuevo (el del paso 1 deja de servir).
 *
 * Los mensajes de error nunca dicen si el email existe.
 */
export const MENSAJE_CLAVE_INCORRECTA = 'El email o la contraseña no son correctos.';
const MENSAJE_PASO_VENCIDO = 'Pasó mucho tiempo. Escribí de nuevo tu email y tu contraseña.';

/** Política de sesión, con los tiempos configurables por variables de entorno. */
export function politicaDeSesion(entorno: Record<string, string | undefined> = process.env): PoliticaDeSesion {
  const numero = (valor: string | undefined, porDefecto: number) => {
    const n = Number(valor);
    return valor && Number.isFinite(n) && n > 0 ? n : porDefecto;
  };
  const HORA = 60 * 60 * 1000;
  return {
    ...POLITICA_DE_SESION,
    inactividadMs: numero(entorno.SESION_INACTIVIDAD_HORAS, POLITICA_DE_SESION.inactividadMs / HORA) * HORA,
    duracionMaximaMs: numero(entorno.SESION_MAXIMA_DIAS, POLITICA_DE_SESION.duracionMaximaMs / (24 * HORA)) * 24 * HORA,
  };
}

export type ResultadoClave = { estado: 'falta_codigo'; token: string } | { estado: 'error' | 'bloqueado'; mensaje: string };

export async function ingresarConClave(db: BaseDeDatos, entrada: { email: string; clave: string }, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoClave> {
  const email = normalizarEmail(entrada.email);
  const huella = huellaDeEmail(email);

  // Bloqueo, comparación y registro del intento, de a un pedido por email:
  // pedidos simultáneos no pueden probar más contraseñas que las permitidas.
  const verificado = await conCandadoDeIntentos(db, candadoDeIngreso(huella), async (tx) => {
    const bloqueo = await bloqueoVigente(tx, huella, pedido.ip, ahora);
    if (bloqueo) {
      await registrarIntento(tx, { emailHuella: huella, pedido, resultado: 'bloqueado', ahora });
      return { estado: 'bloqueado', hasta: bloqueo } as const;
    }
    const [usuario] = email
      ? await tx
          .select({ id: usuarios.id, activo: usuarios.activo, claveHash: usuarios.claveHash, totpConfirmadoEn: usuarios.totpConfirmadoEn })
          .from(usuarios)
          .where(eq(usuarios.email, email))
      : [];
    // Sin usuario o sin contraseña se verifica igual contra un hash señuelo: tarda lo mismo.
    const claveCorrecta = (await verificarContrasena(entrada.clave, usuario?.claveHash ?? (await hashDeSenuelo()))) && Boolean(usuario?.claveHash);
    if (!usuario || !claveCorrecta) {
      await registrarIntento(tx, { emailHuella: huella, usuarioId: usuario?.id, pedido, resultado: 'clave_incorrecta', ahora });
      return { estado: 'error' } as const;
    }
    await registrarIntento(tx, { emailHuella: huella, usuarioId: usuario.id, pedido, resultado: 'clave_correcta', ahora });
    return { estado: 'correcta', usuario } as const;
  });
  if (verificado.estado === 'bloqueado') return { estado: 'bloqueado', mensaje: mensajeDeBloqueo(verificado.hasta, ahora) };
  if (verificado.estado === 'error') return { estado: 'error', mensaje: MENSAJE_CLAVE_INCORRECTA };
  const { usuario } = verificado;

  // De acá en adelante la contraseña es correcta: se puede explicar qué pasa.
  if (!usuario.activo) return { estado: 'error', mensaje: 'Tu usuario está desactivado. Hablá con quien administra el consultorio.' };
  if (!usuario.totpConfirmadoEn) {
    return { estado: 'error', mensaje: 'Te falta configurar la verificación en dos pasos. Pedile a quien administra el consultorio un enlace nuevo.' };
  }
  const consultorio = await consultorioParaIngresar(db, usuario.id);
  if (!consultorio) return { estado: 'error', mensaje: 'Tu usuario no tiene acceso a ningún consultorio. Hablá con quien lo administra.' };

  if (necesitaRehash(usuario.claveHash!)) {
    await db.update(usuarios).set({ claveHash: await hashearContrasena(entrada.clave) }).where(eq(usuarios.id, usuario.id));
  }

  const token = generarToken();
  await db.insert(sesiones).values({
    tokenHash: hashToken(token),
    usuarioId: usuario.id,
    consultorioId: consultorio,
    creadaEn: ahora,
    ultimoUsoEn: ahora,
    ip: pedido.ip,
    userAgent: pedido.userAgent,
  });
  return { estado: 'falta_codigo', token };
}

/** El consultorio de la última sesión, si todavía pertenece; si no, el primero. */
async function consultorioParaIngresar(db: BaseDeDatos, usuarioId: string): Promise<string | null> {
  const membresias = await consultoriosDeUsuario(db, usuarioId);
  if (!membresias.length) return null;
  const [ultima] = await db
    .select({ consultorioId: sesiones.consultorioId })
    .from(sesiones)
    .where(and(eq(sesiones.usuarioId, usuarioId), isNotNull(sesiones.verificadaEn), inArray(sesiones.consultorioId, membresias.map((m) => m.id))))
    .orderBy(desc(sesiones.ultimoUsoEn))
    .limit(1);
  return ultima?.consultorioId ?? membresias[0]!.id;
}

export interface SesionEncontrada {
  id: string;
  usuarioId: string;
  consultorioId: string;
  estado: EstadoDeSesion;
  ultimoUsoEn: Date;
}

/** Busca la sesión de un token. Marca como cerrada la que se venció. */
export async function buscarSesion(db: BaseDeDatos, token: string, ahora: Date = new Date(), politica: PoliticaDeSesion = politicaDeSesion()): Promise<SesionEncontrada | null> {
  if (!formatoDeTokenValido(token)) return null;
  const [fila] = await db.select().from(sesiones).where(eq(sesiones.tokenHash, hashToken(token)));
  if (!fila) return null;
  const estado = estadoDeSesion(fila, ahora, politica);
  if (estado === 'vencida' && !fila.cerradaEn) {
    await db.update(sesiones).set({ cerradaEn: ahora, motivoCierre: 'vencida' }).where(and(eq(sesiones.id, fila.id), isNull(sesiones.cerradaEn)));
  }
  return { id: fila.id, usuarioId: fila.usuarioId, consultorioId: fila.consultorioId, estado, ultimoUsoEn: fila.ultimoUsoEn };
}

export type ResultadoCodigo =
  | { estado: 'ingreso'; token: string; sesionId: string; usoCodigoDeRecuperacion: boolean; codigosRestantes: number }
  | { estado: 'error' | 'bloqueado' | 'vencido'; mensaje: string };

export async function ingresarConCodigo(db: BaseDeDatos, entrada: { token: string; codigo: string }, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<ResultadoCodigo> {
  const sesion = await buscarSesion(db, entrada.token, ahora);
  if (!sesion || sesion.estado !== 'falta_codigo') return { estado: 'vencido', mensaje: MENSAJE_PASO_VENCIDO };
  const [usuario] = await db.select({ email: usuarios.email, activo: usuarios.activo }).from(usuarios).where(eq(usuarios.id, sesion.usuarioId));
  if (!usuario?.activo) return { estado: 'vencido', mensaje: MENSAJE_PASO_VENCIDO };
  const huella = huellaDeEmail(usuario.email);
  const conRecuperacion = pareceCodigoRecuperacion(entrada.codigo);

  // Como con la contraseña: de a un pedido por email, así N códigos simultáneos no se saltean el límite.
  const resultado = await conCandadoDeIntentos(db, candadoDeIngreso(huella), async (tx) => {
    const bloqueo = await bloqueoVigente(tx, huella, pedido.ip, ahora);
    if (bloqueo) {
      await registrarIntento(tx, { emailHuella: huella, usuarioId: sesion.usuarioId, pedido, resultado: 'bloqueado', ahora });
      await tx.update(sesiones).set({ cerradaEn: ahora, motivoCierre: 'bloqueo' }).where(eq(sesiones.id, sesion.id));
      return { estado: 'bloqueado', mensaje: mensajeDeBloqueo(bloqueo, ahora) } as const;
    }

    let error: string | null = null;
    let cuentaComoFallo = true;
    if (conRecuperacion) {
      if (!(await usarCodigoDeRecuperacion(tx, sesion.usuarioId, entrada.codigo, ahora))) error = 'Ese código de recuperación no sirve: puede que ya se haya usado.';
    } else {
      const codigo = await usarCodigoDeApp(tx, sesion.usuarioId, entrada.codigo, ahora);
      if (!codigo.ok) {
        error = codigo.error;
        // Escribir algo que ni siquiera tiene 6 números no es un intento de adivinar.
        cuentaComoFallo = codigo.motivo !== 'formato';
      }
    }
    if (error) {
      if (cuentaComoFallo) await registrarIntento(tx, { emailHuella: huella, usuarioId: sesion.usuarioId, pedido, resultado: 'codigo_incorrecto', ahora });
      return { estado: 'error', mensaje: error } as const;
    }

    // Token nuevo al completar el ingreso: el del primer paso deja de servir.
    const token = generarToken();
    const [activada] = await tx
      .update(sesiones)
      .set({ tokenHash: hashToken(token), verificadaEn: ahora, ultimoUsoEn: ahora, ip: pedido.ip, userAgent: pedido.userAgent })
      .where(and(eq(sesiones.id, sesion.id), isNull(sesiones.verificadaEn), isNull(sesiones.cerradaEn)))
      .returning({ id: sesiones.id });
    if (!activada) return { estado: 'vencido', mensaje: MENSAJE_PASO_VENCIDO } as const;
    await registrarIntento(tx, { emailHuella: huella, usuarioId: sesion.usuarioId, pedido, resultado: 'ingreso', ahora });
    return { estado: 'ingreso', token } as const;
  });
  if (resultado.estado !== 'ingreso') return resultado;

  const codigosRestantes = conRecuperacion ? await codigosDeRecuperacionRestantes(db, sesion.usuarioId) : 0;
  await auditarAcceso(db, {
    usuarioId: sesion.usuarioId,
    accion: 'sesion.ingresar',
    entidad: 'sesion',
    entidadId: sesion.id,
    detalle: { consultorioId: sesion.consultorioId, metodo: conRecuperacion ? 'codigo_de_recuperacion' : 'app', ...(conRecuperacion ? { codigosRestantes } : {}) },
    pedido,
    ahora,
  });
  return { estado: 'ingreso', token: resultado.token, sesionId: sesion.id, usoCodigoDeRecuperacion: conRecuperacion, codigosRestantes };
}

/**
 * Sesión activa de un token, con el usuario y sus roles en el consultorio de
 * la sesión. Si la cuenta se desactivó o dejó de pertenecer al consultorio, la
 * sesión se cierra.
 */
export async function validarSesion(db: BaseDeDatos, token: string, ahora: Date = new Date(), politica: PoliticaDeSesion = politicaDeSesion()): Promise<{ sesionId: string; usuario: UsuarioSesion } | null> {
  const sesion = await buscarSesion(db, token, ahora, politica);
  if (!sesion || sesion.estado !== 'activa') return null;
  const usuario = await cargarUsuario(db, sesion.usuarioId, sesion.consultorioId);
  if (!usuario) {
    await db.update(sesiones).set({ cerradaEn: ahora, motivoCierre: 'sin_acceso' }).where(eq(sesiones.id, sesion.id));
    return null;
  }
  if (hayQueRefrescarUso(sesion.ultimoUsoEn, ahora)) await db.update(sesiones).set({ ultimoUsoEn: ahora }).where(eq(sesiones.id, sesion.id));
  return { sesionId: sesion.id, usuario };
}

/** Cierra la sesión del token (salir, o cancelar el paso del código). */
export async function cerrarSesion(db: BaseDeDatos, token: string, pedido: DatosDelPedido, ahora: Date = new Date()): Promise<void> {
  if (!formatoDeTokenValido(token)) return;
  const [cerrada] = await db
    .update(sesiones)
    .set({ cerradaEn: ahora, motivoCierre: 'salir' })
    .where(and(eq(sesiones.tokenHash, hashToken(token)), isNull(sesiones.cerradaEn)))
    .returning({ id: sesiones.id, usuarioId: sesiones.usuarioId, verificadaEn: sesiones.verificadaEn });
  if (cerrada?.verificadaEn) await auditarAcceso(db, { usuarioId: cerrada.usuarioId, accion: 'sesion.salir', entidad: 'sesion', entidadId: cerrada.id, pedido, ahora });
}

/** Cierra todas las sesiones abiertas de una persona, salvo una si se indica. Devuelve cuántas cerró. */
export async function cerrarSesionesDeUsuario(
  db: Pick<BaseDeDatos, 'update'>,
  usuarioId: string,
  motivo: string,
  ahora: Date,
  opciones: { excepto?: string | null; consultorioId?: string } = {},
): Promise<number> {
  const cerradas = await db
    .update(sesiones)
    .set({ cerradaEn: ahora, motivoCierre: motivo })
    .where(
      and(
        eq(sesiones.usuarioId, usuarioId),
        isNull(sesiones.cerradaEn),
        opciones.excepto ? ne(sesiones.id, opciones.excepto) : undefined,
        opciones.consultorioId ? eq(sesiones.consultorioId, opciones.consultorioId) : undefined,
      ),
    )
    .returning({ id: sesiones.id });
  return cerradas.length;
}
