/**
 * Reglas de configuración que dependen de las variables de entorno. No usa
 * `server-only`: la comparten el servidor (`src/server/entorno.ts`), el proxy
 * (`src/proxy.ts`) y los tests.
 */
export type Variables = Record<string, string | undefined>;

/**
 * Modo desarrollo: datos y usuarios de prueba, y selector de usuario de prueba
 * en lugar de inicio de sesión. Está activo con `npm run dev`, o con
 * `MODO_DESARROLLO=1` para mostrar una demo con `npm start` o en Vercel.
 * Nunca se debe activar con datos reales (y el sistema se niega a hacerlo
 * sobre una base que no sea de prueba: ver `src/db/marca-de-prueba.ts`).
 */
export function modoDesarrollo(variables: Variables = process.env): boolean {
  return variables.NODE_ENV !== 'production' || variables.MODO_DESARROLLO === '1';
}

export const MENSAJE_DEMO_SIN_CLAVE =
  'El sistema no arranca: MODO_DESARROLLO=1 en una versión compilada (npm start o Vercel) necesita DEMO_CLAVE, la contraseña que pide el navegador. ' +
  'Sin ella, cualquiera que llegue a la dirección entra sin contraseña con el selector de usuarios de prueba. Ver docs/demo.md.';

/**
 * Configuración con la que el sistema se niega a funcionar, o null si está
 * bien. Hoy: una demo compilada sin contraseña.
 */
export function problemaDeConfiguracion(variables: Variables = process.env): string | null {
  if (variables.NODE_ENV === 'production' && variables.MODO_DESARROLLO === '1' && !variables.DEMO_CLAVE?.trim()) return MENSAJE_DEMO_SIN_CLAVE;
  return null;
}
