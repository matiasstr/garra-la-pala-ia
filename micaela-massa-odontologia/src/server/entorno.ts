import 'server-only';
import path from 'node:path';
import { almacenLocal, type AlmacenArchivos } from './archivos';

/**
 * Modo desarrollo: base local embebida (PGlite), archivos en disco y selector
 * de usuario de prueba en lugar de inicio de sesión.
 *
 * Está activo con `npm run dev`, o con `MODO_DESARROLLO=1` para mostrar una
 * demo con `npm start`. Nunca se debe activar con datos reales.
 */
export function modoDesarrollo(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.MODO_DESARROLLO === '1';
}

export const directorioDatosLocales = (): string => path.join(process.cwd(), '.data');

export function almacenDelSistema(): AlmacenArchivos {
  if (modoDesarrollo()) return almacenLocal(path.join(directorioDatosLocales(), 'archivos'));
  throw new Error('Falta configurar el almacenamiento de archivos (S3 con Object Lock).');
}
