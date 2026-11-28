import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema';

/** Sirve tanto para node-postgres (producción) como para PGlite (desarrollo y tests). */
export type BaseDeDatos = PgDatabase<PgQueryResultHKT, typeof schema>;
