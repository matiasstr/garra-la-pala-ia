import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Contraseñas con scrypt (`node:crypto`), con una sal aleatoria por usuario.
 *
 * Parámetros: N = 2^15, r = 8, p = 3, 32 bytes de salida y 16 bytes de sal.
 * Es una de las combinaciones equivalentes que recomienda OWASP para scrypt:
 * usa 32 MiB de memoria y tarda unos 300 ms por intento, lo que vuelve muy
 * caro adivinar contraseñas aunque alguien se lleve la base.
 *
 * El hash guarda sus propios parámetros (`scrypt$ln=15,r=8,p=3$sal$hash`), así
 * que se pueden endurecer más adelante sin invalidar las contraseñas viejas:
 * `necesitaRehash` avisa cuándo conviene recalcularlo al ingresar.
 */
export const PARAMETROS_SCRYPT = { ln: 15, r: 8, p: 3, largo: 32, largoSal: 16 } as const;

export const LARGO_MINIMO_CLAVE = 10;
/** Tope para que nadie mande un texto enorme a calcular. */
export const LARGO_MAXIMO_CLAVE = 200;

interface Parametros {
  ln: number;
  r: number;
  p: number;
}

function derivar(clave: string, sal: Buffer, largo: number, { ln, r, p }: Parametros): Promise<Buffer> {
  const N = 2 ** ln;
  return new Promise((resolver, rechazar) => {
    scrypt(clave.normalize('NFC'), sal, largo, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (error, clave) => (error ? rechazar(error) : resolver(clave)));
  });
}

export async function hashearContrasena(clave: string): Promise<string> {
  const { ln, r, p, largo, largoSal } = PARAMETROS_SCRYPT;
  const sal = randomBytes(largoSal);
  const hash = await derivar(clave, sal, largo, { ln, r, p });
  return `scrypt$ln=${ln},r=${r},p=${p}$${sal.toString('base64url')}$${hash.toString('base64url')}`;
}

const FORMATO = /^scrypt\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9_-]{16,})\$([A-Za-z0-9_-]{16,})$/;

function leerHash(guardado: string): { parametros: Parametros; sal: Buffer; hash: Buffer } | null {
  const partes = FORMATO.exec(guardado);
  if (!partes) return null;
  const [, ln, r, p, sal, hash] = partes;
  const parametros = { ln: Number(ln), r: Number(r), p: Number(p) };
  // Límites para que un valor adulterado en la base no tumbe el servidor.
  if (parametros.ln < 10 || parametros.ln > 20 || parametros.r < 1 || parametros.r > 16 || parametros.p < 1 || parametros.p > 16) return null;
  return { parametros, sal: Buffer.from(sal!, 'base64url'), hash: Buffer.from(hash!, 'base64url') };
}

/** Compara en tiempo constante. Un hash con otro formato nunca coincide. */
export async function verificarContrasena(clave: string, guardado: string): Promise<boolean> {
  if (clave.length > LARGO_MAXIMO_CLAVE) return false;
  const leido = leerHash(guardado);
  if (!leido) return false;
  const calculado = await derivar(clave, leido.sal, leido.hash.length, leido.parametros);
  return calculado.length === leido.hash.length && timingSafeEqual(calculado, leido.hash);
}

/** El hash se hizo con parámetros más débiles que los actuales. */
export function necesitaRehash(guardado: string): boolean {
  const leido = leerHash(guardado);
  if (!leido) return true;
  const { ln, r, p } = PARAMETROS_SCRYPT;
  return leido.parametros.ln < ln || leido.parametros.r < r || leido.parametros.p < p;
}

/**
 * Hash de una contraseña que nadie tiene. Cuando el email no existe se verifica
 * igual contra este hash, para que la respuesta tarde lo mismo y no delate qué
 * emails están cargados.
 */
let hashSenuelo: Promise<string> | undefined;
export function hashDeSenuelo(): Promise<string> {
  hashSenuelo ??= hashearContrasena(randomBytes(24).toString('base64url'));
  return hashSenuelo;
}

/** Las más usadas, que cualquiera prueba primero. */
const MUY_COMUNES = new Set([
  '1234567890',
  '12345678910',
  '0123456789',
  '9876543210',
  '1111111111',
  'qwertyuiop',
  'contraseña',
  'contrasena',
  'contraseña1',
  'contrasena1',
  'password123',
  'passwordpassword',
  'micaelamassa',
  'consultorio',
  'odontologia',
  'odontología',
]);

/**
 * Reglas para una contraseña nueva. Pocas y razonables: largo mínimo, que no
 * sea el propio email ni una de las más usadas. No se piden mayúsculas ni
 * símbolos: una frase larga es más segura y más fácil de recordar.
 */
export function validarContrasenaNueva(clave: string, datos: { email?: string; nombre?: string; apellido?: string } = {}): string[] {
  const errores: string[] = [];
  const limpia = clave.trim().toLowerCase();
  if (clave.length < LARGO_MINIMO_CLAVE) errores.push(`La contraseña tiene que tener al menos ${LARGO_MINIMO_CLAVE} caracteres.`);
  if (clave.length > LARGO_MAXIMO_CLAVE) errores.push(`La contraseña puede tener hasta ${LARGO_MAXIMO_CLAVE} caracteres.`);
  if (clave.length >= LARGO_MINIMO_CLAVE) {
    const email = datos.email?.trim().toLowerCase();
    const personales = [email, email?.split('@')[0], `${datos.nombre ?? ''}${datos.apellido ?? ''}`.toLowerCase().replace(/\s+/g, '')].filter(
      (v): v is string => Boolean(v && v.length >= 4),
    );
    if (MUY_COMUNES.has(limpia) || MUY_COMUNES.has(limpia.replace(/\d+$/, '')) || /^(.)\1+$/.test(limpia)) {
      errores.push('Esa contraseña es muy fácil de adivinar. Probá con una frase que solo vos conozcas.');
    } else if (personales.some((p) => limpia === p || limpia.replace(/\d+$/, '') === p)) {
      errores.push('La contraseña no puede ser tu email ni tu nombre.');
    }
  }
  return errores;
}
