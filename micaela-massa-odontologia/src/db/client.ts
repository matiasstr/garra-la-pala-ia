import 'server-only';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hoyEnArgentina } from '../lib/fechas';
import { problemaDeConfiguracion } from '../lib/modo';
import { permiteReiniciarDemo } from '../server/demo';
import { directorioDatosLocales, modoDesarrollo } from '../server/entorno';
import { exigirBaseReal } from './marca-de-prueba';
import * as schema from './schema';
import type { BaseDeDatos } from './tipos';

/**
 * Conexión a la base:
 * - con `DATABASE_URL`, PostgreSQL. En producción no se migra ni se siembra
 *   solo (eso se hace con `npm run db:migrate`). En modo desarrollo o demo
 *   (por ejemplo, la demo online en Vercel con Neon) se aplican las
 *   migraciones y los datos de prueba al conectar;
 * - sin ella y en modo desarrollo, un Postgres embebido (PGlite) en `.data/pglite`,
 *   también con las migraciones aplicadas y datos de prueba.
 *
 * Antes de usarla se comprueba que la configuración y la base vayan juntas
 * (si no, ningún pedido funciona y el error explica por qué):
 * - una demo compilada (`MODO_DESARROLLO=1` en producción) exige `DEMO_CLAVE`;
 * - el modo desarrollo solo usa una base vacía o marcada como de prueba;
 * - el modo real nunca usa una base de prueba (ver `marca-de-prueba.ts`).
 *
 * Se guarda en `globalThis` para que la recarga en caliente de Next.js no abra
 * dos instancias sobre la misma carpeta.
 */
interface Conexion {
  db: BaseDeDatos;
  /** Borra todo y vuelve a sembrar con fechas de hoy (solo demo). */
  reiniciar: () => Promise<void>;
}

const global = globalThis as typeof globalThis & { __conexionBase?: Promise<Conexion> };

function conexion(): Promise<Conexion> {
  global.__conexionBase ??= conectar().catch((error) => {
    global.__conexionBase = undefined;
    throw error;
  });
  return global.__conexionBase;
}

export async function baseDeDatos(): Promise<BaseDeDatos> {
  return (await conexion()).db;
}

/**
 * "Reiniciar datos de prueba" de la demo. Se niega si no están
 * `MODO_DESARROLLO=1` y `DEMO_PERMITE_REINICIO=1`, aunque alguien llegue acá
 * sin pasar por el botón.
 */
export async function reiniciarDatosDePrueba(): Promise<void> {
  if (!permiteReiniciarDemo()) throw new Error('Reiniciar los datos solo está permitido en la demo.');
  const actual = await conexion();
  const reinicio = actual.reiniciar();
  // Mientras tanto, los pedidos de esta instancia esperan a que termine.
  global.__conexionBase = reinicio.then(
    () => actual,
    () => actual,
  );
  await reinicio;
}

const carpetaMigraciones = () => path.join(process.cwd(), 'drizzle');

async function conectar(): Promise<Conexion> {
  const problema = problemaDeConfiguracion();
  if (problema) throw new Error(problema);
  const url = process.env.DATABASE_URL;
  if (url) {
    const [{ Pool }, { drizzle }, { urlDeConexion }] = await Promise.all([import('pg'), import('drizzle-orm/node-postgres'), import('./preparar')]);
    if (modoDesarrollo()) await prepararPostgres({ reiniciar: false });
    // Pocas conexiones y que se cierren pronto: en Vercel hay muchas instancias
    // cortas, y Neon apaga la base cuando no se usa.
    const pool = new Pool({ connectionString: urlDeConexion(url), max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
    // Una conexión ociosa que la base corta (por ejemplo, al dormirse) no debe tirar el servidor.
    pool.on('error', (error) => console.error('Se cortó una conexión ociosa con la base:', error.message));
    const db = drizzle(pool, { schema });
    if (!modoDesarrollo()) {
      try {
        await exigirBaseReal(db);
      } catch (error) {
        await pool.end();
        throw error;
      }
    }
    return { db, reiniciar: () => prepararPostgres({ reiniciar: true }) };
  }
  if (!modoDesarrollo()) throw new Error('Falta DATABASE_URL (ver .env.example).');
  // En Vercel no hay disco donde guardar la base embebida.
  if (process.env.VERCEL) throw new Error('Falta conectar la base de datos (Neon): ver docs/demo.md, paso 3.');

  const [{ PGlite }, { drizzle }, { migrate }, { prepararBase, reiniciarBase }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-orm/pglite/migrator'),
    import('./preparar'),
  ]);
  const carpeta = path.join(directorioDatosLocales(), 'pglite');
  await mkdir(carpeta, { recursive: true });
  const db = drizzle(new PGlite(carpeta), { schema });
  const migrar = () => migrate(db, { migrationsFolder: carpetaMigraciones() });
  await prepararBase(db, migrar, hoyEnArgentina());
  return { db, reiniciar: () => reiniciarBase(db, migrar, hoyEnArgentina()) };
}

/**
 * Migra y siembra (o reinicia) PostgreSQL por una conexión directa y única,
 * con el bloqueo que ordena a las instancias que arrancan a la vez.
 */
async function prepararPostgres({ reiniciar }: { reiniciar: boolean }): Promise<void> {
  const [{ Client }, { drizzle }, { migrate }, { prepararBase, reiniciarBase, urlDeConexion, urlDirecta }] = await Promise.all([
    import('pg'),
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm/node-postgres/migrator'),
    import('./preparar'),
  ]);
  const cliente = new Client({ connectionString: urlDeConexion(urlDirecta(process.env)), connectionTimeoutMillis: 15_000 });
  cliente.on('error', (error) => console.error('Se cortó la conexión para preparar la base:', error.message));
  await cliente.connect();
  try {
    const db = drizzle(cliente, { schema });
    const migrar = () => migrate(db, { migrationsFolder: carpetaMigraciones() });
    await (reiniciar ? reiniciarBase : prepararBase)(db, migrar, hoyEnArgentina());
  } finally {
    await cliente.end();
  }
}
