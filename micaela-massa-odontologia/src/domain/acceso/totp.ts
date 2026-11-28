import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Verificación en dos pasos con una app de autenticación (Google Authenticator,
 * Microsoft Authenticator, Authy, 2FAS...). Implementa TOTP (RFC 6238) sobre
 * HOTP (RFC 4226) con `node:crypto`: códigos de 6 números que cambian cada 30
 * segundos, calculados con HMAC-SHA1 sobre una clave secreta compartida.
 *
 * Reglas del sistema:
 * - se acepta el código del intervalo actual, el anterior y el siguiente
 *   (±30 segundos), por si la hora del celular no está exacta;
 * - un código ya usado no sirve de nuevo: se guarda el último intervalo
 *   aceptado y solo valen intervalos posteriores.
 */
export const PERIODO_TOTP = 30;
export const DIGITOS_TOTP = 6;
export const TOLERANCIA_TOTP = 1;

export type AlgoritmoTotp = 'sha1' | 'sha256' | 'sha512';

// ---------------------------------------------------------------------------
// Base32 (RFC 4648), el formato en que las apps esperan la clave
// ---------------------------------------------------------------------------
const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function aBase32(datos: Uint8Array): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

/** Acepta minúsculas, espacios y guiones (como lo copia una persona). Sin relleno. */
export function desdeBase32(texto: string): Buffer {
  const limpio = texto.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const caracter of limpio) {
    const indice = ALFABETO_BASE32.indexOf(caracter);
    if (indice < 0) throw new RangeError('La clave tiene caracteres que no son de base32.');
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Clave nueva de 160 bits (lo que recomienda el RFC 4226 para SHA-1), en base32. */
export function generarSecretoTotp(): string {
  return aBase32(randomBytes(20));
}

// ---------------------------------------------------------------------------
// HOTP y TOTP
// ---------------------------------------------------------------------------

/** HOTP (RFC 4226): código para un contador. */
export function codigoHotp(secreto: Uint8Array, contador: number, digitos = DIGITOS_TOTP, algoritmo: AlgoritmoTotp = 'sha1'): string {
  const mensaje = Buffer.alloc(8);
  mensaje.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac(algoritmo, secreto).update(mensaje).digest();
  const desplazamiento = hmac[hmac.length - 1]! & 0x0f;
  const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Intervalo de 30 segundos al que pertenece un instante. */
export const pasoTotp = (instante: Date | number, periodo = PERIODO_TOTP): number => Math.floor((typeof instante === 'number' ? instante : instante.getTime()) / 1000 / periodo);

/** TOTP (RFC 6238): código vigente en un instante. */
export function codigoTotp(secreto: Uint8Array, instante: Date | number, opciones: { digitos?: number; algoritmo?: AlgoritmoTotp; periodo?: number } = {}): string {
  return codigoHotp(secreto, pasoTotp(instante, opciones.periodo), opciones.digitos, opciones.algoritmo);
}

/** Deja solo los números: la gente escribe "123 456" o "123-456". */
export const normalizarCodigoTotp = (entrada: string): string => entrada.replace(/[\s-]/g, '');

export type ResultadoTotp = { valido: true; paso: number } | { valido: false; motivo: 'formato' | 'incorrecto' | 'ya_usado' };

/**
 * Verifica un código: acepta el intervalo actual y ±1, y rechaza los
 * intervalos iguales o anteriores al último aceptado (un código no se reusa).
 */
export function verificarCodigoTotp(secreto: Uint8Array, entrada: string, ahora: Date, ultimoPasoUsado: number | null = null): ResultadoTotp {
  const codigo = normalizarCodigoTotp(entrada);
  if (!new RegExp(`^\\d{${DIGITOS_TOTP}}$`).test(codigo)) return { valido: false, motivo: 'formato' };
  const actual = pasoTotp(ahora);
  let coincidio: number | null = null;
  // Se revisan todos los intervalos, sin cortar antes, para que el tiempo de
  // respuesta no dependa de cuál coincidió.
  for (let paso = actual - TOLERANCIA_TOTP; paso <= actual + TOLERANCIA_TOTP; paso++) {
    const esperado = Buffer.from(codigoHotp(secreto, paso));
    if (timingSafeEqual(esperado, Buffer.from(codigo)) && coincidio === null) coincidio = paso;
  }
  if (coincidio === null) return { valido: false, motivo: 'incorrecto' };
  if (ultimoPasoUsado !== null && coincidio <= ultimoPasoUsado) return { valido: false, motivo: 'ya_usado' };
  return { valido: true, paso: coincidio };
}

/**
 * Enlace `otpauth://` para cargar la clave en la app. En un celular, tocarlo
 * abre la app de autenticación con todo completo (no hace falta un QR).
 */
export function enlaceOtpauth({ emisor, cuenta, secreto }: { emisor: string; cuenta: string; secreto: string }): string {
  const etiqueta = `${encodeURIComponent(emisor)}:${encodeURIComponent(cuenta)}`;
  const parametros = new URLSearchParams({ secret: secreto, issuer: emisor, algorithm: 'SHA1', digits: String(DIGITOS_TOTP), period: String(PERIODO_TOTP) });
  return `otpauth://totp/${etiqueta}?${parametros.toString().replace(/\+/g, '%20')}`;
}
