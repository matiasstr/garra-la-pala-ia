import 'server-only';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

let pool: Pool | undefined;

/** Conexión a PostgreSQL para el servidor. Se crea al primer uso. */
export function baseDeDatos() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL (ver .env.example).');
  pool ??= new Pool({ connectionString: url, max: 10 });
  return drizzle(pool, { schema });
}
