import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hoyEnArgentina } from '../lib/fechas';
import { directorioDatosLocales, modoDesarrollo } from '../server/entorno';
import * as schema from './schema';
import type { BaseDeDatos } from './tipos';

/**
 * Conexión a la base:
 * - con `DATABASE_URL`, PostgreSQL (producción);
 * - sin ella y en modo desarrollo, un Postgres embebido (PGlite) en `.data/pglite`,
 *   con las migraciones aplicadas y datos de prueba.
 *
 * Se guarda en `globalThis` para que la recarga en caliente de Next.js no abra
 * dos instancias sobre la misma carpeta.
 */
const global = globalThis as typeof globalThis & { __baseDeDatos?: Promise<BaseDeDatos> };

export function baseDeDatos(): Promise<BaseDeDatos> {
  global.__baseDeDatos ??= conectar().catch((error) => {
    global.__baseDeDatos = undefined;
    throw error;
  });
  return global.__baseDeDatos;
}

async function conectar(): Promise<BaseDeDatos> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ Pool }, { drizzle }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres')]);
    return drizzle(new Pool({ connectionString: url, max: 10 }), { schema });
  }
  if (!modoDesarrollo()) throw new Error('Falta DATABASE_URL (ver .env.example).');

  const [{ PGlite }, { drizzle }, { migrate }, { sembrarDatosDePrueba }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
    import('./semilla'),
  ]);
  const carpeta = path.join(directorioDatosLocales(), 'pglite');
  await mkdir(carpeta, { recursive: true });
  const cliente = new PGlite(carpeta);
  const db = drizzle(cliente, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  await sembrarDatosDePrueba(db, hoyEnArgentina());
  return db;
}
