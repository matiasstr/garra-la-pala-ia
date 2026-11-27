import { sql, type SQL } from 'drizzle-orm';
import { DOMINIO_DE_PRUEBA } from './acceso-de-prueba';
import type { BaseDeDatos } from './tipos';

/**
 * Marca de "base de prueba" (tabla `base_de_prueba`, una sola fila que no se
 * puede borrar). Separa las bases con datos inventados de las reales:
 *
 * - La semilla solo corre sobre una base vacía, y lo primero que hace es
 *   dejar la marca.
 * - El modo desarrollo se niega a usar una base con datos y sin la marca:
 *   podría ser la del consultorio, y con el selector entraría cualquiera sin
 *   contraseña.
 * - El modo real (y `npm run crear-administrador`) se niega a usar una base
 *   con la marca, o con usuarios del dominio de la semilla (las bases de
 *   prueba de antes de la marca): sus contraseñas son públicas.
 */

export const MENSAJE_BASE_SIN_MARCA =
  'El modo desarrollo se niega a usar esta base: tiene datos, pero no es una base de prueba (no tiene la marca que deja la semilla), así que puede ser la del consultorio. ' +
  'Con el modo desarrollo cualquiera entraría sin contraseña. Si es una base de desarrollo vieja, borrala con `npm run db:reset`; ' +
  'la demo online se vacía como explica docs/demo.md ("Si algo no anda").';

export const MENSAJE_BASE_DE_PRUEBA =
  'El sistema se niega a usar esta base: tiene datos de prueba (la sembró el modo desarrollo, con usuarios de contraseña pública). ' +
  'Para el consultorio hace falta una base nueva (ver README, "Instalación real").';

export class ErrorDeBaseDeDatos extends Error {}

export interface EstadoDeLaBase {
  /** Tiene la marca de base de prueba. */
  marca: boolean;
  /** Tiene usuarios, consultorios o pacientes. */
  conDatos: boolean;
  /** Tiene usuarios con el dominio de la semilla (`@consultorio.local`). */
  usuariosDePrueba: boolean;
}

type Consultas = Pick<BaseDeDatos, 'execute'>;

/** Primera fila de un `execute`: node-postgres y PGlite devuelven `{ rows }`. */
async function fila(db: Consultas, consulta: SQL): Promise<Record<string, unknown>> {
  const resultado = (await db.execute(consulta)) as unknown as { rows?: Record<string, unknown>[] };
  return resultado.rows?.[0] ?? {};
}

/** Qué tiene la base. Funciona aunque falten tablas (una base sin migrar, o de antes de la marca). */
export async function estadoDeLaBase(db: Consultas): Promise<EstadoDeLaBase> {
  const tablas = await fila(
    db,
    sql`select to_regclass('public.base_de_prueba') is not null as marca, to_regclass('public.usuarios') is not null as usuarios,
               to_regclass('public.consultorios') is not null as consultorios, to_regclass('public.pacientes') is not null as pacientes`,
  );
  const existe = (tabla: string) => sql.raw(`exists (select 1 from ${tabla})`);
  const falso = sql.raw('false');
  const datos = await fila(
    db,
    sql`select ${tablas.marca ? existe('base_de_prueba') : falso} as marca,
               ${tablas.usuarios ? existe('usuarios') : falso} or ${tablas.consultorios ? existe('consultorios') : falso} or ${tablas.pacientes ? existe('pacientes') : falso} as con_datos,
               ${tablas.usuarios ? sql`exists (select 1 from usuarios where email like ${`%${DOMINIO_DE_PRUEBA}`})` : falso} as usuarios_de_prueba`,
  );
  return { marca: datos.marca === true, conDatos: datos.con_datos === true, usuariosDePrueba: datos.usuarios_de_prueba === true };
}

/** Deja la marca (la semilla, antes de cargar nada). */
export async function marcarComoBaseDePrueba(db: Consultas): Promise<void> {
  await db.execute(sql`insert into base_de_prueba default values on conflict do nothing`);
}

/** Para el modo desarrollo: la base tiene que estar vacía o tener la marca. */
export async function exigirBaseDePrueba(db: Consultas): Promise<void> {
  const estado = await estadoDeLaBase(db);
  if (estado.conDatos && !estado.marca) throw new ErrorDeBaseDeDatos(MENSAJE_BASE_SIN_MARCA);
}

/** Para el modo real y la consola: la base no puede ser de prueba. */
export async function exigirBaseReal(db: Consultas): Promise<void> {
  const estado = await estadoDeLaBase(db);
  if (estado.marca || estado.usuariosDePrueba) throw new ErrorDeBaseDeDatos(MENSAJE_BASE_DE_PRUEBA);
}
