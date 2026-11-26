import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { profesionales } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { bloqueadoHasta, registrarIntentoPin, validarFormatoPin, validarPinNuevo } from '../../domain/firma/pin';
import { puede, puedeFirmarRegistroClinico, type UsuarioConRoles } from '../../domain/permisos/permisos';
import { formatoHora } from '../../lib/fechas';
import { ErrorDePermiso } from '../errores';
import { auditar, type ContextoAuditoria } from './historia-clinica';

/**
 * PIN de firma de cada profesional. Se guarda solo su huella con scrypt (una
 * función lenta a propósito) y una sal al azar: ni la base ni quien la
 * administra conocen el PIN. Cinco intentos fallidos seguidos lo bloquean 15
 * minutos (ver `src/domain/firma/pin.ts`).
 */

const PARAMETROS = { N: 16384, r: 8, p: 1 } as const;
const LARGO_HUELLA = 32;

function derivar(pin: string, sal: Buffer, opciones: ScryptOptions): Promise<Buffer> {
  return new Promise((resolver, rechazar) => scrypt(pin, sal, LARGO_HUELLA, opciones, (error, clave) => (error ? rechazar(error) : resolver(clave))));
}

/** `scrypt$N$r$p$sal$huella` (sal y huella en base64). */
export async function hashearPin(pin: string): Promise<string> {
  const sal = randomBytes(16);
  const huella = await derivar(pin, sal, PARAMETROS);
  return ['scrypt', PARAMETROS.N, PARAMETROS.r, PARAMETROS.p, sal.toString('base64'), huella.toString('base64')].join('$');
}

export async function pinCoincide(pin: string, guardado: string): Promise<boolean> {
  const [algoritmo, n, r, p, sal, huella] = guardado.split('$');
  if (algoritmo !== 'scrypt' || !n || !r || !p || !sal || !huella) return false;
  const esperada = Buffer.from(huella, 'base64');
  const calculada = await derivar(pin, Buffer.from(sal, 'base64'), { N: Number(n), r: Number(r), p: Number(p) });
  return calculada.length === esperada.length && timingSafeEqual(calculada, esperada);
}

export interface EstadoPinDeFirma {
  /** Si el usuario firma registros clínicos (profesional con matrícula). */
  firma: boolean;
  tienePin: boolean;
  actualizadoEn: Date | null;
  bloqueadoHasta: Date | null;
}

export async function estadoPinDeFirma(db: BaseDeDatos, usuario: UsuarioConRoles, ahora: Date = new Date()): Promise<EstadoPinDeFirma> {
  if (!puedeFirmarRegistroClinico(usuario)) return { firma: false, tienePin: false, actualizadoEn: null, bloqueadoHasta: null };
  const [fila] = await db.select().from(profesionales).where(eq(profesionales.usuarioId, usuario.id));
  return {
    firma: Boolean(fila),
    tienePin: Boolean(fila?.pinFirmaHash),
    actualizadoEn: fila?.pinFirmaActualizadoEn ?? null,
    bloqueadoHasta: fila ? bloqueadoHasta({ intentosFallidos: fila.pinFirmaIntentosFallidos, bloqueadoHasta: fila.pinFirmaBloqueadoHasta }, ahora) : null,
  };
}

export type ResultadoPin = { ok: true } | { ok: false; errores: string[] };

const mensajeBloqueo = (hasta: Date) =>
  `Tu PIN de firma quedó bloqueado hasta las ${formatoHora(hasta)} por demasiados intentos fallidos. Mientras tanto no se puede firmar.`;

/**
 * Comprueba el PIN antes de firmar. Cada intento fallido queda contado (y en la
 * auditoría) aunque la firma no siga: por eso se guarda en su propia transacción.
 */
export async function comprobarPinDeFirma(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  pin: string,
  contexto: ContextoAuditoria = {},
  ahora: Date = new Date(),
): Promise<ResultadoPin> {
  if (!puedeFirmarRegistroClinico(usuario)) throw new ErrorDePermiso('Solo un profesional con matrícula puede firmar registros clínicos.');
  const formato = validarFormatoPin(pin);

  return db.transaction(async (tx) => {
    // Bloquea la fila: dos intentos al mismo tiempo no pueden saltearse el límite.
    const [fila] = await tx.select().from(profesionales).where(eq(profesionales.usuarioId, usuario.id)).for('update');
    if (!fila?.pinFirmaHash) return { ok: false, errores: ['Todavía no creaste tu PIN de firma.'] };
    const estado = { intentosFallidos: fila.pinFirmaIntentosFallidos, bloqueadoHasta: fila.pinFirmaBloqueadoHasta };
    const bloqueo = bloqueadoHasta(estado, ahora);
    if (bloqueo) return { ok: false, errores: [mensajeBloqueo(bloqueo)] };
    if (formato.length) return { ok: false, errores: formato };

    const intento = registrarIntentoPin(estado, await pinCoincide(pin, fila.pinFirmaHash), ahora);
    await tx
      .update(profesionales)
      .set({ pinFirmaIntentosFallidos: intento.estado.intentosFallidos, pinFirmaBloqueadoHasta: intento.estado.bloqueadoHasta })
      .where(eq(profesionales.usuarioId, usuario.id));
    if (intento.resultado === 'correcto') return { ok: true };

    await auditar(tx, {
      ...contexto,
      usuarioId: usuario.id,
      accion: intento.resultado === 'bloqueado' ? 'firma.pin_bloqueado' : 'firma.pin_incorrecto',
      entidad: 'profesional',
      entidadId: usuario.id,
    });
    if (intento.resultado === 'bloqueado') return { ok: false, errores: [mensajeBloqueo(intento.hasta)] };
    return {
      ok: false,
      errores: [`El PIN de firma no es correcto. ${intento.intentosRestantes === 1 ? 'Te queda 1 intento' : `Te quedan ${intento.intentosRestantes} intentos`} antes de que se bloquee.`],
    };
  });
}

/** Crea el PIN de firma o lo cambia (pidiendo el actual, que cuenta como un intento más). */
export async function guardarPinDeFirma(
  db: BaseDeDatos,
  usuario: UsuarioConRoles,
  entrada: { actual?: string; nuevo: string; repeticion: string },
  contexto: ContextoAuditoria = {},
  ahora: Date = new Date(),
): Promise<{ errores: string[] }> {
  if (!puedeFirmarRegistroClinico(usuario)) throw new ErrorDePermiso('Solo los profesionales con matrícula tienen PIN de firma.');
  const estado = await estadoPinDeFirma(db, usuario, ahora);
  if (!estado.firma) throw new ErrorDePermiso('Tu usuario no está cargado como profesional.');

  if (estado.tienePin) {
    if (!entrada.actual) return { errores: ['Escribí tu PIN actual.'] };
    const comprobado = await comprobarPinDeFirma(db, usuario, entrada.actual, contexto, ahora);
    if (!comprobado.ok) return { errores: comprobado.errores.map((e) => e.replace('El PIN de firma no es correcto.', 'El PIN actual no es correcto.')) };
    if (entrada.actual === entrada.nuevo) return { errores: ['El PIN nuevo tiene que ser distinto del actual.'] };
  }
  const errores = validarPinNuevo(entrada.nuevo, entrada.repeticion);
  if (errores.length) return { errores };

  const huella = await hashearPin(entrada.nuevo);
  await db.transaction(async (tx) => {
    await tx
      .update(profesionales)
      .set({ pinFirmaHash: huella, pinFirmaActualizadoEn: ahora, pinFirmaIntentosFallidos: 0, pinFirmaBloqueadoHasta: null })
      .where(eq(profesionales.usuarioId, usuario.id));
    await auditar(tx, { ...contexto, usuarioId: usuario.id, accion: estado.tienePin ? 'firma.pin_cambiado' : 'firma.pin_creado', entidad: 'profesional', entidadId: usuario.id });
  });
  return { errores: [] };
}

/**
 * Si un profesional se olvida el PIN, la administración lo borra y él crea uno
 * nuevo desde su cuenta. Nunca se puede ver ni elegir el PIN de otro.
 */
export async function restablecerPinDeFirma(db: BaseDeDatos, administrador: UsuarioConRoles, profesionalId: string, contexto: ContextoAuditoria = {}): Promise<void> {
  if (!puede(administrador, 'usuarios.administrar')) throw new ErrorDePermiso('Solo la administración puede restablecer un PIN de firma.');
  await db.transaction(async (tx) => {
    const [fila] = await tx
      .update(profesionales)
      .set({ pinFirmaHash: null, pinFirmaActualizadoEn: null, pinFirmaIntentosFallidos: 0, pinFirmaBloqueadoHasta: null })
      .where(eq(profesionales.usuarioId, profesionalId))
      .returning({ id: profesionales.usuarioId });
    if (!fila) throw new Error('El profesional no existe.');
    await auditar(tx, { ...contexto, usuarioId: administrador.id, accion: 'firma.pin_restablecido', entidad: 'profesional', entidadId: profesionalId });
  });
}
