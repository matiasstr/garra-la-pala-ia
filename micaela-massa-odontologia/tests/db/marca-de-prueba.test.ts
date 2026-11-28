import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { count, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { MENSAJE_BASE_DE_PRUEBA, MENSAJE_BASE_SIN_MARCA, estadoDeLaBase, exigirBaseDePrueba, exigirBaseReal } from '../../src/db/marca-de-prueba';
import { prepararBase, reiniciarBase } from '../../src/db/preparar';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { crearPrimerAdministrador } from '../../src/server/acceso/administracion';
import { crearBaseDePrueba } from './base-de-prueba';

const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../drizzle', import.meta.url));
const HOY = '2026-11-27';

/** Una base "real": migrada y con su primera administradora creada desde la consola. */
async function baseReal() {
  const base = await crearBaseDePrueba();
  const alta = await crearPrimerAdministrador(base.db, { email: 'mica@ejemplo.com', nombre: 'Micaela', apellido: 'Massa', consultorio: 'Consultorio real', matricula: 'MP 12345' });
  expect(alta.estado).toBe('creado');
  return { ...base, migrar: () => migrate(base.db, { migrationsFolder: CARPETA_MIGRACIONES }) };
}

const usuarios = async (db: Awaited<ReturnType<typeof crearBaseDePrueba>>['db']) => (await db.select({ cantidad: count() }).from(schema.usuarios))[0]?.cantidad;

describe('marca de base de prueba', () => {
  it('la semilla solo siembra una base vacía, y lo primero que hace es marcarla', async () => {
    const { db, cliente } = await crearBaseDePrueba();
    try {
      expect(await estadoDeLaBase(db)).toEqual({ marca: false, conDatos: false, usuariosDePrueba: false });
      expect(await sembrarDatosDePrueba(db, HOY)).toBe(true);
      expect(await estadoDeLaBase(db)).toEqual({ marca: true, conDatos: true, usuariosDePrueba: true });
      expect(await sembrarDatosDePrueba(db, HOY)).toBe(false);
      await expect(exigirBaseDePrueba(db)).resolves.toBeUndefined();
    } finally {
      await cliente.close();
    }
  });

  it('el modo desarrollo se niega a usar una base con datos y sin la marca, y no la siembra ni la reinicia', async () => {
    const real = await baseReal();
    try {
      await expect(prepararBase(real.db, real.migrar, HOY)).rejects.toThrow(MENSAJE_BASE_SIN_MARCA);
      await expect(reiniciarBase(real.db, real.migrar, HOY)).rejects.toThrow(MENSAJE_BASE_SIN_MARCA);
      // Sigue intacta: la administradora sola, sin la marca y sin los usuarios de la semilla.
      expect(await usuarios(real.db)).toBe(1);
      expect(await estadoDeLaBase(real.db)).toEqual({ marca: false, conDatos: true, usuariosDePrueba: false });
      // Y el modo real la acepta.
      await expect(exigirBaseReal(real.db)).resolves.toBeUndefined();
    } finally {
      await real.cliente.close();
    }
  });

  it('una base con solo un consultorio (sin usuarios) tampoco está vacía', async () => {
    const { db, cliente } = await crearBaseDePrueba();
    try {
      await db.insert(schema.consultorios).values({ nombre: 'Consultorio real' });
      expect(await sembrarDatosDePrueba(db, HOY)).toBe(false);
      await expect(exigirBaseDePrueba(db)).rejects.toThrow(MENSAJE_BASE_SIN_MARCA);
    } finally {
      await cliente.close();
    }
  });

  it('el modo real (y la consola) se niega a usar una base de prueba', async () => {
    const { db, cliente } = await crearBaseDePrueba();
    try {
      await sembrarDatosDePrueba(db, HOY);
      await expect(exigirBaseReal(db)).rejects.toThrow(MENSAJE_BASE_DE_PRUEBA);
    } finally {
      await cliente.close();
    }
  });

  it('también una base de prueba de antes de la marca: tiene usuarios @consultorio.local', async () => {
    const { db, cliente } = await crearBaseDePrueba();
    try {
      await db.insert(schema.usuarios).values({ email: 'sofia@consultorio.local', nombre: 'Sofía', apellido: 'Gómez' });
      expect(await estadoDeLaBase(db)).toEqual({ marca: false, conDatos: true, usuariosDePrueba: true });
      await expect(exigirBaseReal(db)).rejects.toThrow(MENSAJE_BASE_DE_PRUEBA);
      // Para el modo desarrollo tampoco sirve: no tiene la marca.
      await expect(exigirBaseDePrueba(db)).rejects.toThrow(MENSAJE_BASE_SIN_MARCA);
    } finally {
      await cliente.close();
    }
  });

  it('funciona sobre una base sin migrar (ni siquiera existe la tabla)', async () => {
    const cliente = new PGlite();
    const db = drizzle(cliente, { schema });
    try {
      expect(await estadoDeLaBase(db)).toEqual({ marca: false, conDatos: false, usuariosDePrueba: false });
      await expect(exigirBaseReal(db)).resolves.toBeUndefined();
    } finally {
      await cliente.close();
    }
  });

  it('la marca no se puede cambiar, borrar ni vaciar', async () => {
    const { db, cliente } = await crearBaseDePrueba();
    try {
      await sembrarDatosDePrueba(db, HOY);
      await expect(db.execute(sql`delete from base_de_prueba`)).rejects.toThrow();
      await expect(db.execute(sql`update base_de_prueba set creado_en = now() - interval '1 day'`)).rejects.toThrow();
      await expect(db.execute(sql`truncate base_de_prueba`)).rejects.toThrow();
      await expect(db.execute(sql`insert into base_de_prueba (unica) values (false)`)).rejects.toThrow();
      expect((await estadoDeLaBase(db)).marca).toBe(true);
    } finally {
      await cliente.close();
    }
  });
});
