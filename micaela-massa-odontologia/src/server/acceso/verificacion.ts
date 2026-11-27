import { and, count, eq, isNull, lt, or } from 'drizzle-orm';
import { codigosRecuperacion, usuarios } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { generarCodigosRecuperacion, hashCodigoRecuperacion, normalizarCodigoRecuperacion } from '../../domain/acceso/codigos-recuperacion';
import { desdeBase32, enlaceOtpauth, generarSecretoTotp, verificarCodigoTotp, type ResultadoTotp } from '../../domain/acceso/totp';
import { consultoriosDeUsuario } from '../usuarios';
import { cifrarSecreto, descifrarSecreto } from './secretos';

/** Nombre con el que aparece la cuenta en la app de autenticación. */
const EMISOR_POR_DEFECTO = 'Micaela Massa Odontología';

/** Tiempo para cargar la clave nueva en la app y confirmarla con un código. */
const VIGENCIA_CLAVE_PENDIENTE_MS = 30 * 60 * 1000;

export interface ClaveParaLaApp {
  /** En base32, para escribirla a mano en la app. */
  secreto: string;
  /** `otpauth://...`: en el celular, tocarlo abre la app con todo cargado. */
  enlace: string;
  emisor: string;
  cuenta: string;
}

/**
 * Genera una clave nueva para la app de autenticación y la deja pendiente.
 * La actual (si había) sigue valiendo hasta que se confirme la nueva con un código.
 */
export async function prepararClaveDeApp(db: BaseDeDatos, usuarioId: string, ahora: Date): Promise<ClaveParaLaApp> {
  const [usuario] = await db.select({ email: usuarios.email }).from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!usuario) throw new Error('El usuario no existe.');
  const [consultorio] = await consultoriosDeUsuario(db, usuarioId);
  const emisor = consultorio?.nombre ?? EMISOR_POR_DEFECTO;
  const secreto = generarSecretoTotp();
  await db.update(usuarios).set({ totpPendiente: cifrarSecreto(secreto), totpPendienteEn: ahora }).where(eq(usuarios.id, usuarioId));
  return { secreto, enlace: enlaceOtpauth({ emisor, cuenta: usuario.email, secreto }), emisor, cuenta: usuario.email };
}

/** Genera códigos de recuperación nuevos y anula los anteriores. Devuelve los códigos para mostrarlos una sola vez. */
export async function renovarCodigosDeRecuperacion(db: Pick<BaseDeDatos, 'insert' | 'update'>, usuarioId: string, ahora: Date): Promise<string[]> {
  await db
    .update(codigosRecuperacion)
    .set({ anuladoEn: ahora })
    .where(and(eq(codigosRecuperacion.usuarioId, usuarioId), isNull(codigosRecuperacion.usadoEn), isNull(codigosRecuperacion.anuladoEn)));
  const codigos = generarCodigosRecuperacion();
  await db.insert(codigosRecuperacion).values(
    codigos.map((codigo) => ({ usuarioId, codigoHash: hashCodigoRecuperacion(normalizarCodigoRecuperacion(codigo)!), creadoEn: ahora })),
  );
  return codigos;
}

export type ResultadoConfirmacion = { ok: true; codigos: string[] } | { ok: false; error: string };

const MENSAJE_CODIGO: Record<Exclude<ResultadoTotp, { valido: true }>['motivo'], string> = {
  formato: 'El código tiene 6 números.',
  incorrecto: 'El código no coincide. Fijate que la hora del celular esté en automático y probá con el código que se ve ahora.',
  ya_usado: 'Ese código ya se usó. Esperá a que la app muestre uno nuevo.',
};

/**
 * Confirma la clave pendiente con un código de la app: pasa a ser la clave
 * vigente, se marca ese código como usado y se generan códigos de recuperación
 * nuevos.
 */
export async function confirmarClaveDeApp(db: BaseDeDatos, usuarioId: string, codigo: string, ahora: Date): Promise<ResultadoConfirmacion> {
  const [usuario] = await db
    .select({ pendiente: usuarios.totpPendiente, pendienteEn: usuarios.totpPendienteEn })
    .from(usuarios)
    .where(eq(usuarios.id, usuarioId));
  if (!usuario?.pendiente || !usuario.pendienteEn || ahora.getTime() - usuario.pendienteEn.getTime() > VIGENCIA_CLAVE_PENDIENTE_MS) {
    return { ok: false, error: 'Pasó mucho tiempo. Empezá de nuevo para generar otra clave.' };
  }
  const secreto = descifrarSecreto(usuario.pendiente);
  const resultado = verificarCodigoTotp(desdeBase32(secreto), codigo, ahora);
  if (!resultado.valido) return { ok: false, error: MENSAJE_CODIGO[resultado.motivo] };

  return db.transaction(async (tx) => {
    const [actualizado] = await tx
      .update(usuarios)
      .set({ totpSecreto: usuario.pendiente, totpConfirmadoEn: ahora, totpUltimoPaso: resultado.paso, totpPendiente: null, totpPendienteEn: null })
      .where(and(eq(usuarios.id, usuarioId), eq(usuarios.totpPendiente, usuario.pendiente!)))
      .returning({ id: usuarios.id });
    if (!actualizado) return { ok: false, error: 'La clave cambió mientras tanto. Empezá de nuevo.' } as const;
    return { ok: true, codigos: await renovarCodigosDeRecuperacion(tx, usuarioId, ahora) } as const;
  });
}

/**
 * Verifica un código de la app contra la clave vigente y lo marca como usado
 * (de forma atómica: dos pedidos con el mismo código no pasan los dos).
 */
export async function usarCodigoDeApp(db: BaseDeDatos, usuarioId: string, codigo: string, ahora: Date): Promise<{ ok: true } | { ok: false; motivo: 'formato' | 'incorrecto' | 'ya_usado' | 'sin_configurar'; error: string }> {
  const [usuario] = await db.select({ secreto: usuarios.totpSecreto, ultimoPaso: usuarios.totpUltimoPaso }).from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!usuario?.secreto) return { ok: false, motivo: 'sin_configurar', error: 'La verificación en dos pasos no está configurada.' };
  const resultado = verificarCodigoTotp(desdeBase32(descifrarSecreto(usuario.secreto)), codigo, ahora, usuario.ultimoPaso);
  if (!resultado.valido) return { ok: false, motivo: resultado.motivo, error: MENSAJE_CODIGO[resultado.motivo] };
  const [marcado] = await db
    .update(usuarios)
    .set({ totpUltimoPaso: resultado.paso })
    .where(and(eq(usuarios.id, usuarioId), or(isNull(usuarios.totpUltimoPaso), lt(usuarios.totpUltimoPaso, resultado.paso))))
    .returning({ id: usuarios.id });
  if (!marcado) return { ok: false, motivo: 'ya_usado', error: MENSAJE_CODIGO.ya_usado };
  return { ok: true };
}

/** Marca un código de recuperación como usado, si es válido y no se usó antes. */
export async function usarCodigoDeRecuperacion(db: BaseDeDatos, usuarioId: string, entrada: string, ahora: Date): Promise<boolean> {
  const normalizado = normalizarCodigoRecuperacion(entrada);
  if (!normalizado) return false;
  const [usado] = await db
    .update(codigosRecuperacion)
    .set({ usadoEn: ahora })
    .where(
      and(
        eq(codigosRecuperacion.usuarioId, usuarioId),
        eq(codigosRecuperacion.codigoHash, hashCodigoRecuperacion(normalizado)),
        isNull(codigosRecuperacion.usadoEn),
        isNull(codigosRecuperacion.anuladoEn),
      ),
    )
    .returning({ id: codigosRecuperacion.id });
  return Boolean(usado);
}

export async function codigosDeRecuperacionRestantes(db: BaseDeDatos, usuarioId: string): Promise<number> {
  const [fila] = await db
    .select({ cantidad: count() })
    .from(codigosRecuperacion)
    .where(and(eq(codigosRecuperacion.usuarioId, usuarioId), isNull(codigosRecuperacion.usadoEn), isNull(codigosRecuperacion.anuladoEn)));
  return fila?.cantidad ?? 0;
}
