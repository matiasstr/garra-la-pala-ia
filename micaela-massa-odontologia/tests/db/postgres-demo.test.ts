import { fileURLToPath } from 'node:url';
import { count, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { prepararBase, reiniciarBase } from '../../src/db/preparar';

/**
 * Con PostgreSQL de verdad (varias conexiones a la vez, como varias
 * instancias de Vercel). Solo corre si `PRUEBA_POSTGRES_URL` apunta a una base
 * descartable: la vacía por completo. Por ejemplo:
 *   PRUEBA_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/mm_demo_tests npx vitest run tests/db/postgres-demo.test.ts
 */
const URL_PRUEBA = process.env.PRUEBA_POSTGRES_URL;
const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe.skipIf(!URL_PRUEBA)('demo con PostgreSQL real', () => {
  const clientes: Client[] = [];
  const nuevaInstancia = async () => {
    const cliente = new Client({ connectionString: URL_PRUEBA });
    await cliente.connect();
    clientes.push(cliente);
    const db = drizzle(cliente, { schema });
    return { db, migrar: () => migrate(db, { migrationsFolder: CARPETA_MIGRACIONES }) };
  };

  beforeAll(async () => {
    const { db } = await nuevaInstancia();
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`create schema public`);
  });

  afterAll(async () => {
    await Promise.all(clientes.map((c) => c.end()));
  });

  it('varias instancias que arrancan a la vez migran y siembran una sola vez', async () => {
    const instancias = await Promise.all([nuevaInstancia(), nuevaInstancia(), nuevaInstancia()]);
    await Promise.all(instancias.map(({ db, migrar }) => prepararBase(db, migrar, '2026-11-26')));
    const { db } = instancias[0]!;
    expect(await db.select({ cantidad: count() }).from(schema.usuarios)).toEqual([{ cantidad: 3 }]);
    expect(await db.select({ cantidad: count() }).from(schema.pacientes)).toEqual([{ cantidad: 6 }]);
  });

  it('un reinicio espera a que termine otro y deja la base sembrada una sola vez', async () => {
    const [a, b] = await Promise.all([nuevaInstancia(), nuevaInstancia()]);
    await Promise.all([reiniciarBase(a.db, a.migrar, '2026-12-01'), prepararBase(b.db, b.migrar, '2026-12-01')]);
    expect(await a.db.select({ cantidad: count() }).from(schema.usuarios)).toEqual([{ cantidad: 3 }]);
    await expect(a.db.execute(sql`delete from turno_eventos`)).rejects.toThrow();
  });
});
