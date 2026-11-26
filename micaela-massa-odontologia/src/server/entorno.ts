import 'server-only';
import path from 'node:path';
import { almacenEnBase, almacenLocal, type AlmacenArchivos } from './archivos';

/**
 * Modo desarrollo: datos y usuarios de prueba, y selector de usuario de prueba
 * en lugar de inicio de sesión. Sin `DATABASE_URL`, la base es local y
 * embebida (PGlite) y los archivos van a disco; con `DATABASE_URL` (la demo
 * online, ver docs/demo.md), base y archivos van a PostgreSQL.
 *
 * Está activo con `npm run dev`, o con `MODO_DESARROLLO=1` para mostrar una
 * demo con `npm start` o en Vercel. Nunca se debe activar con datos reales.
 */
export function modoDesarrollo(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.MODO_DESARROLLO === '1';
}

export const directorioDatosLocales = (): string => path.join(process.cwd(), '.data');

export function almacenDelSistema(): AlmacenArchivos {
  if (modoDesarrollo()) {
    // En Vercel el disco no dura: los archivos se guardan en la misma base.
    if (process.env.DATABASE_URL) return almacenEnBase(async () => (await import('../db/client')).baseDeDatos());
    return almacenLocal(path.join(directorioDatosLocales(), 'archivos'));
  }
  throw new Error('Falta configurar el almacenamiento de archivos (S3 con Object Lock).');
}
