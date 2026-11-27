import { sql } from 'drizzle-orm';
import { exigirBaseDePrueba } from './marca-de-prueba';
import { sembrarDatosDePrueba } from './semilla';
import type { BaseDeDatos } from './tipos';

/**
 * Preparación de la base en modo desarrollo y en la demo online: migrar,
 * sembrar datos de prueba y, si se pide, reiniciarlos.
 *
 * En la demo puede haber varias instancias del servidor arrancando a la vez
 * (Vercel levanta una por demanda). Un bloqueo de PostgreSQL (advisory lock)
 * hace que una sola migre o siembre por vez; las demás esperan y después ven
 * la base lista. El bloqueo es de sesión: hay que usarlo con una conexión
 * directa y única, no a través de un pooler en modo transacción.
 */

/** Número fijo del bloqueo; cualquier número sirve mientras sea siempre el mismo. */
export const BLOQUEO_PREPARACION = 2026_1126_01;

/** Si otra instancia tarda más que esto en preparar la base, se desiste con error. */
const ESPERA_MAXIMA = '60s';

async function conBloqueo<T>(db: BaseDeDatos, tarea: () => Promise<T>): Promise<T> {
  await db.execute(sql.raw(`set lock_timeout = '${ESPERA_MAXIMA}'`));
  await db.execute(sql.raw(`select pg_advisory_lock(${BLOQUEO_PREPARACION})`));
  try {
    return await tarea();
  } finally {
    await db.execute(sql.raw(`select pg_advisory_unlock(${BLOQUEO_PREPARACION})`));
    await db.execute(sql.raw('reset lock_timeout'));
  }
}

/**
 * Aplica las migraciones que falten y, si la base está vacía, la siembra (y la
 * marca como base de prueba). Se niega a seguir si la base tiene datos y no
 * tiene la marca: puede ser la del consultorio (ver `marca-de-prueba.ts`).
 */
export async function prepararBase(db: BaseDeDatos, migrar: () => Promise<void>, hoy: string): Promise<void> {
  await conBloqueo(db, async () => {
    await migrar();
    await sembrarDatosDePrueba(db, hoy);
    await exigirBaseDePrueba(db);
  });
}

/**
 * Borra todo y vuelve a empezar con los datos de prueba, fechados desde hoy.
 *
 * Lo clínico y los historiales no se pueden borrar fila por fila (los triggers
 * lo impiden, como tiene que ser), así que se descartan los esquemas enteros y
 * se vuelve a migrar. Solo para la demo: quien llama debe verificar antes que
 * el reinicio está permitido, y acá se comprueba además que la base sea de prueba.
 */
export async function reiniciarBase(db: BaseDeDatos, migrar: () => Promise<void>, hoy: string): Promise<void> {
  await conBloqueo(db, async () => {
    // Nunca se descarta una base que no sea de prueba, aunque alguien llegue acá por error.
    await exigirBaseDePrueba(db);
    await db.transaction(async (tx) => {
      await tx.execute(sql`drop schema if exists drizzle cascade`);
      await tx.execute(sql`drop schema if exists public cascade`);
      await tx.execute(sql`create schema public`);
      // Los mismos permisos que trae PostgreSQL 15 o superior.
      await tx.execute(sql`grant usage on schema public to public`);
    });
    await migrar();
    await sembrarDatosDePrueba(db, hoy);
  });
}

/**
 * Ajusta la dirección de la base para node-postgres:
 * - `sslmode=require` (la que entrega Neon) hoy ya verifica el certificado en
 *   node-postgres, pero avisa que va a dejar de hacerlo: se pide `verify-full`
 *   explícito, que es lo mismo sin el aviso.
 * - Neon siempre exige SSL: si falta, se agrega.
 * - `channel_binding` es de libpq y node-postgres no lo lee: se quita.
 */
export function urlDeConexion(url: string): string {
  let direccion: URL;
  try {
    direccion = new URL(url);
  } catch {
    return url;
  }
  const modo = direccion.searchParams.get('sslmode');
  if (!direccion.searchParams.has('uselibpqcompat') && (modo === 'require' || modo === 'prefer' || modo === 'verify-ca')) {
    direccion.searchParams.set('sslmode', 'verify-full');
  }
  if (!modo && direccion.hostname.endsWith('.neon.tech')) direccion.searchParams.set('sslmode', 'verify-full');
  direccion.searchParams.delete('channel_binding');
  return direccion.toString();
}

/**
 * Dirección para migrar y sembrar: tiene que ser una conexión directa, porque
 * el pooler de Neon (PgBouncer en modo transacción) no respeta los bloqueos de
 * sesión. La integración de Neon con Vercel la carga en `DATABASE_URL_UNPOOLED`;
 * si no está, se deduce de `DATABASE_URL` sacando `-pooler` del servidor.
 */
export function urlDirecta(variables: Record<string, string | undefined>): string {
  if (variables.DATABASE_URL_UNPOOLED) return variables.DATABASE_URL_UNPOOLED;
  const url = variables.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL.');
  try {
    const direccion = new URL(url);
    const [primero, ...resto] = direccion.hostname.split('.');
    if (primero?.endsWith('-pooler') && direccion.hostname.endsWith('.neon.tech')) {
      direccion.hostname = [primero.slice(0, -'-pooler'.length), ...resto].join('.');
      return direccion.toString();
    }
  } catch {
    // No es una URL: se usa tal cual.
  }
  return url;
}
