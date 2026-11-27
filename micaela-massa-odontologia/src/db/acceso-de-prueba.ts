/**
 * Acceso de los usuarios de prueba de la semilla (documentado en el README).
 * Solo para desarrollo: la semilla solo se carga en una base vacía y la marca
 * como base de prueba (ver `src/db/marca-de-prueba.ts`).
 */
export const CLAVE_DE_PRUEBA = 'prueba-consultorio';
/** Clave de la app de autenticación de los usuarios de prueba (base32). */
export const SECRETO_TOTP_DE_PRUEBA = 'MICAMASSAPRUEBA2MICAMASSAPRUEBA2';

/**
 * Dominio de los emails de la semilla. `.local` no existe en internet: ninguna
 * persona real tiene un email así. El selector de usuario de prueba solo deja
 * elegir cuentas de este dominio.
 */
export const DOMINIO_DE_PRUEBA = '@consultorio.local';

export const esUsuarioDePrueba = (email: string): boolean => email.trim().toLowerCase().endsWith(DOMINIO_DE_PRUEBA);
