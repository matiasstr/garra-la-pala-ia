import { createHash, randomInt } from 'node:crypto';

/**
 * Códigos de recuperación: sirven para entrar si se pierde el celular con la
 * app de autenticación. Cada uno se usa una sola vez.
 *
 * - 10 códigos de 10 caracteres (50 bits de azar cada uno), con el alfabeto
 *   de Crockford: sin I, L, O ni U, para que no se confundan al copiarlos.
 * - En la base se guarda solo su SHA-256. Alcanza con un hash rápido porque
 *   son largos y al azar (no son contraseñas elegidas por una persona), y
 *   además para usarlos hace falta la contraseña.
 */
export const CANTIDAD_CODIGOS_RECUPERACION = 10;
const ALFABETO = '0123456789abcdefghjkmnpqrstvwxyz';
const LARGO = 10;

/** "k7m2q-9xz4h" */
export function generarCodigosRecuperacion(cantidad = CANTIDAD_CODIGOS_RECUPERACION): string[] {
  const codigos = new Set<string>();
  while (codigos.size < cantidad) {
    let codigo = '';
    for (let i = 0; i < LARGO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];
    codigos.add(`${codigo.slice(0, 5)}-${codigo.slice(5)}`);
  }
  return [...codigos];
}

/**
 * Lo que escribió la persona, llevado a la forma canónica: minúsculas, sin
 * espacios ni guiones, y las letras parecidas a números como números.
 * Devuelve null si no puede ser un código.
 */
export function normalizarCodigoRecuperacion(entrada: string): string | null {
  const limpio = entrada
    .toLowerCase()
    .replace(/[\s-]/g, '')
    .replace(/o/g, '0')
    .replace(/[il]/g, '1');
  if (limpio.length !== LARGO || [...limpio].some((c) => !ALFABETO.includes(c))) return null;
  return limpio;
}

export const hashCodigoRecuperacion = (codigoNormalizado: string): string => createHash('sha256').update(`recuperacion:${codigoNormalizado}`).digest('hex');

/** Distingue un código de recuperación ("k7m2q-9xz4h", 10 caracteres) de uno de la app ("123456"). */
export const pareceCodigoRecuperacion = (entrada: string): boolean => normalizarCodigoRecuperacion(entrada) !== null;
