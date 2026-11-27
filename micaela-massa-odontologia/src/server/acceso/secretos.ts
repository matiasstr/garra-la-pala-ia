import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cifrado de la clave de la app de autenticación (TOTP) en la base.
 *
 * A diferencia de una contraseña, esa clave no se puede guardar como hash: el
 * servidor la necesita para calcular el código. Se guarda cifrada con
 * AES-256-GCM y una clave que vive fuera de la base (variable `CLAVE_SECRETOS`),
 * así una copia de la base sola no alcanza para generar códigos.
 *
 * Formato: `v1.<iv>.<etiqueta>.<cifrado>` en base64url. El `v1` permite cambiar
 * de clave más adelante sin perder lo guardado.
 */
const CLAVE_DE_DESARROLLO = 'solo-para-desarrollo:micaela-massa-odontologia';

/** Igual que `modoDesarrollo()` de src/server/entorno.ts (acá sin `server-only`, porque también lo usa la consola). */
const enDesarrollo = () => process.env.NODE_ENV !== 'production' || process.env.MODO_DESARROLLO === '1';

function clave(): Buffer {
  const configurada = process.env.CLAVE_SECRETOS;
  if (configurada) {
    if (configurada.length < 32) throw new Error('CLAVE_SECRETOS tiene que tener al menos 32 caracteres (ver .env.example).');
    return createHash('sha256').update(configurada).digest();
  }
  if (!enDesarrollo()) throw new Error('Falta CLAVE_SECRETOS (ver .env.example).');
  return createHash('sha256').update(CLAVE_DE_DESARROLLO).digest();
}

export function cifrarSecreto(texto: string): string {
  const iv = randomBytes(12);
  const cifrador = createCipheriv('aes-256-gcm', clave(), iv);
  const cifrado = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return ['v1', iv.toString('base64url'), cifrador.getAuthTag().toString('base64url'), cifrado.toString('base64url')].join('.');
}

export function descifrarSecreto(guardado: string): string {
  const [version, iv, etiqueta, cifrado] = guardado.split('.');
  if (version !== 'v1' || !iv || !etiqueta || !cifrado) throw new Error('Secreto con un formato desconocido.');
  const descifrador = createDecipheriv('aes-256-gcm', clave(), Buffer.from(iv, 'base64url'));
  descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
  return Buffer.concat([descifrador.update(Buffer.from(cifrado, 'base64url')), descifrador.final()]).toString('utf8');
}
