import { createHash, randomBytes } from 'node:crypto';

/**
 * Sesiones y bloqueos por intentos fallidos. Reglas puras: la base y las
 * cookies se manejan en `src/server/autenticacion.ts`.
 *
 * El token de sesión son 32 bytes al azar que viajan solo en la cookie. En la
 * base se guarda su SHA-256: si alguien copia la tabla de sesiones, con esos
 * hashes no puede entrar.
 */
export const generarToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const formatoDeTokenValido = (token: string): boolean => TOKEN.test(token);

export interface PoliticaDeSesion {
  /** Se cierra sola después de este tiempo sin uso. */
  inactividadMs: number;
  /** Dura como máximo esto desde que se ingresó, aunque se use todo el tiempo. */
  duracionMaximaMs: number;
  /** Tiempo para escribir el código de la app después de la contraseña. */
  pasoCodigoMs: number;
}

const HORA = 60 * 60 * 1000;
export const POLITICA_DE_SESION: PoliticaDeSesion = { inactividadMs: 12 * HORA, duracionMaximaMs: 7 * 24 * HORA, pasoCodigoMs: 10 * 60 * 1000 };

export interface DatosDeSesion {
  creadaEn: Date;
  ultimoUsoEn: Date;
  cerradaEn: Date | null;
  /** Cuándo se verificó el segundo paso. Sin esto, la sesión solo sirve para escribir el código. */
  verificadaEn: Date | null;
}

export type EstadoDeSesion = 'activa' | 'falta_codigo' | 'cerrada' | 'vencida';

export function estadoDeSesion(sesion: DatosDeSesion, ahora: Date, politica: PoliticaDeSesion = POLITICA_DE_SESION): EstadoDeSesion {
  if (sesion.cerradaEn) return 'cerrada';
  const t = ahora.getTime();
  if (!sesion.verificadaEn) return t - sesion.creadaEn.getTime() <= politica.pasoCodigoMs ? 'falta_codigo' : 'vencida';
  if (t - sesion.ultimoUsoEn.getTime() > politica.inactividadMs) return 'vencida';
  if (t - sesion.verificadaEn.getTime() > politica.duracionMaximaMs) return 'vencida';
  return 'activa';
}

/** Para no escribir en la base en cada pedido: el último uso se actualiza cada tantos minutos. */
export const REFRESCO_ULTIMO_USO_MS = 5 * 60 * 1000;
export const hayQueRefrescarUso = (ultimoUsoEn: Date, ahora: Date): boolean => ahora.getTime() - ultimoUsoEn.getTime() >= REFRESCO_ULTIMO_USO_MS;

// ---------------------------------------------------------------------------
// Bloqueo por intentos fallidos
// ---------------------------------------------------------------------------

export interface PoliticaDeBloqueo {
  /** Cuántos fallos seguidos se toleran antes de bloquear. */
  maximo: number;
  /** Ventana en la que se cuentan los fallos. */
  ventanaMs: number;
  /** Cuánto dura el bloqueo desde el último fallo. */
  duracionMs: number;
}

const MINUTO = 60 * 1000;
/** Por usuario: 5 fallos (contraseña o código) en 15 minutos bloquean 15 minutos. */
export const BLOQUEO_POR_USUARIO: PoliticaDeBloqueo = { maximo: 5, ventanaMs: 15 * MINUTO, duracionMs: 15 * MINUTO };
/**
 * Por IP: 20 fallos en 15 minutos. Es más alto porque en el consultorio todas
 * las computadoras salen a internet con la misma IP.
 */
export const BLOQUEO_POR_IP: PoliticaDeBloqueo = { maximo: 20, ventanaMs: 15 * MINUTO, duracionMs: 15 * MINUTO };

/**
 * `fallos`: instantes de los intentos fallidos posteriores al último ingreso
 * exitoso (los anteriores ya no cuentan). Devuelve hasta cuándo está bloqueado.
 */
export function bloqueadoHasta(fallos: readonly Date[], ahora: Date, politica: PoliticaDeBloqueo): Date | null {
  const desde = ahora.getTime() - politica.ventanaMs;
  const enVentana = fallos.map((f) => f.getTime()).filter((t) => t > desde && t <= ahora.getTime());
  if (enVentana.length < politica.maximo) return null;
  const hasta = Math.max(...enVentana) + politica.duracionMs;
  return hasta > ahora.getTime() ? new Date(hasta) : null;
}

/** "Esperá 12 minutos": nunca dice si el email existe. */
export function mensajeDeBloqueo(hasta: Date, ahora: Date): string {
  const minutos = Math.max(1, Math.ceil((hasta.getTime() - ahora.getTime()) / MINUTO));
  return `Hubo demasiados intentos fallidos. Esperá ${minutos === 1 ? '1 minuto' : `${minutos} minutos`} y probá de nuevo.`;
}

// ---------------------------------------------------------------------------
// Enlaces de un solo uso (primer ingreso y blanqueos)
// ---------------------------------------------------------------------------
export const VIGENCIA_ENLACE_MS = 72 * HORA;

/** Emails sin espacios ni mayúsculas: "Mica@Consultorio.com " = "mica@consultorio.com". */
export const normalizarEmail = (email: string): string => email.trim().toLowerCase();

/** Huella del email para contar intentos sin guardar lo que se escribió (a veces es la contraseña). */
export const huellaDeEmail = (email: string): string => createHash('sha256').update(`ingreso:${normalizarEmail(email)}`).digest('hex');
