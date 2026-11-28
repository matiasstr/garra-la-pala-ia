/**
 * PIN de firma: lo escribe el profesional cada vez que firma un registro
 * clínico (firma electrónica, Ley 25.506 art. 5). Es distinto de la contraseña
 * de su usuario y demuestra que fue él quien firmó en ese momento.
 *
 * Acá están las reglas puras (formato y bloqueo por intentos fallidos). La
 * huella con scrypt y la base de datos están en `src/server/hc/pin.ts`.
 */

export const LARGO_MINIMO_PIN = 4;
export const LARGO_MAXIMO_PIN = 8;
/** Intentos fallidos seguidos antes de bloquear el PIN. */
export const MAXIMO_INTENTOS_PIN = 5;
export const MINUTOS_BLOQUEO_PIN = 15;

const SOLO_NUMEROS = /^\d+$/;

/** Errores de formato de un PIN que se escribe para firmar. Vacío = se puede comprobar. */
export function validarFormatoPin(pin: string): string[] {
  if (!SOLO_NUMEROS.test(pin)) return ['El PIN de firma tiene solo números.'];
  if (pin.length < LARGO_MINIMO_PIN || pin.length > LARGO_MAXIMO_PIN) return [`El PIN de firma tiene entre ${LARGO_MINIMO_PIN} y ${LARGO_MAXIMO_PIN} números.`];
  return [];
}

/** Un PIN que se adivina enseguida: todos iguales (1111) o una escalera (1234, 9876). */
export function esPinDebil(pin: string): boolean {
  const digitos = [...pin].map(Number);
  if (digitos.every((d) => d === digitos[0])) return true;
  const pasos = digitos.slice(1).map((d, i) => d - (digitos[i] ?? 0));
  return pasos.every((p) => p === 1) || pasos.every((p) => p === -1);
}

/** Errores de un PIN nuevo, al crearlo o cambiarlo. */
export function validarPinNuevo(pin: string, repeticion: string): string[] {
  const formato = validarFormatoPin(pin);
  if (formato.length) return formato;
  if (esPinDebil(pin)) return ['Ese PIN es muy fácil de adivinar: no uses números todos iguales ni seguidos.'];
  if (pin !== repeticion) return ['Los dos PIN nuevos no coinciden.'];
  return [];
}

export interface EstadoIntentosPin {
  intentosFallidos: number;
  bloqueadoHasta: Date | null;
}

export function bloqueadoHasta(estado: EstadoIntentosPin, ahora: Date): Date | null {
  return estado.bloqueadoHasta && estado.bloqueadoHasta.getTime() > ahora.getTime() ? estado.bloqueadoHasta : null;
}

export type ResultadoIntentoPin =
  | { resultado: 'correcto'; estado: EstadoIntentosPin }
  | { resultado: 'incorrecto'; estado: EstadoIntentosPin; intentosRestantes: number }
  | { resultado: 'bloqueado'; estado: EstadoIntentosPin; hasta: Date };

/**
 * Nuevo estado después de un intento. Mientras está bloqueado ni se compara el
 * PIN (`correcto` se ignora): así no se puede seguir probando.
 */
export function registrarIntentoPin(estado: EstadoIntentosPin, correcto: boolean, ahora: Date): ResultadoIntentoPin {
  const bloqueo = bloqueadoHasta(estado, ahora);
  if (bloqueo) return { resultado: 'bloqueado', estado, hasta: bloqueo };
  if (correcto) return { resultado: 'correcto', estado: { intentosFallidos: 0, bloqueadoHasta: null } };

  const intentos = estado.intentosFallidos + 1;
  if (intentos >= MAXIMO_INTENTOS_PIN) {
    const hasta = new Date(ahora.getTime() + MINUTOS_BLOQUEO_PIN * 60_000);
    return { resultado: 'bloqueado', estado: { intentosFallidos: 0, bloqueadoHasta: hasta }, hasta };
  }
  return { resultado: 'incorrecto', estado: { intentosFallidos: intentos, bloqueadoHasta: null }, intentosRestantes: MAXIMO_INTENTOS_PIN - intentos };
}
