import 'server-only';
import path from 'node:path';
import { modoDesarrollo as modoSegunVariables } from '../lib/modo';
import { almacenEnBase, almacenLocal, type AlmacenArchivos } from './archivos';

/**
 * Modo desarrollo (ver `src/lib/modo.ts`). Sin `DATABASE_URL`, la base es
 * local y embebida (PGlite) y los archivos van a disco; con `DATABASE_URL` (la
 * demo online, ver docs/demo.md), base y archivos van a PostgreSQL.
 */
export const modoDesarrollo = (): boolean => modoSegunVariables(process.env);

export const directorioDatosLocales = (): string => path.join(process.cwd(), '.data');

export function almacenDelSistema(): AlmacenArchivos {
  if (modoDesarrollo()) {
    // En Vercel el disco no dura: los archivos se guardan en la misma base.
    if (process.env.DATABASE_URL) return almacenEnBase(async () => (await import('../db/client')).baseDeDatos());
    return almacenLocal(path.join(directorioDatosLocales(), 'archivos'));
  }
  throw new Error('Falta configurar el almacenamiento de archivos (S3 con Object Lock).');
}
