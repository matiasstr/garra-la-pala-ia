import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearBaseDePrueba } from './base-de-prueba';

let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;

beforeAll(async () => {
  base = await crearBaseDePrueba();
});

afterAll(async () => {
  await base.cliente.close();
});

/** Tablas con un trigger que impide borrar filas, y si además tienen uno que impide TRUNCATE. */
async function tablasProtegidas(): Promise<{ tabla: string; sinTruncate: boolean }[]> {
  const resultado = await base.db.execute(sql`
    select c.relname as tabla, bool_or((t.tgtype & 32) <> 0) as sin_truncate
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal
     group by c.relname
    having bool_or((t.tgtype & 8) <> 0 and p.proname in ('impedir_modificacion', 'impedir_borrado'))
     order by 1`);
  return (resultado.rows as { tabla: string; sin_truncate: boolean }[]).map((f) => ({ tabla: f.tabla, sinTruncate: f.sin_truncate }));
}

describe('TRUNCATE', () => {
  it('toda tabla que no deja borrar filas tampoco deja vaciarla con TRUNCATE (que saltea los triggers por fila)', async () => {
    const protegidas = await tablasProtegidas();
    expect(protegidas.map((t) => t.tabla)).toEqual(expect.arrayContaining(['turno_eventos', 'codigos_recuperacion', 'enlaces_acceso', 'consultorio_miembros', 'registros_clinicos']));
    expect(protegidas.filter((t) => !t.sinTruncate).map((t) => t.tabla)).toEqual([]);
  });

  it('turno_eventos, codigos_recuperacion, enlaces_acceso y consultorio_miembros no se vacían, ni en cascada', async () => {
    for (const tabla of ['turno_eventos', 'codigos_recuperacion', 'enlaces_acceso', 'consultorio_miembros', 'usuarios', 'profesionales', 'alertas_medicas']) {
      await expect(base.db.execute(sql.raw(`truncate ${tabla} cascade`)), tabla).rejects.toThrow();
    }
  });
});
