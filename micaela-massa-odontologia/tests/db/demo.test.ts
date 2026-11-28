import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { count, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema';
import { prepararBase, reiniciarBase } from '../../src/db/preparar';
import { DIAS_HABILES_CON_TURNOS, sembrarDatosDePrueba } from '../../src/db/semilla';
import { fechaDe, proximosDiasHabiles } from '../../src/lib/fechas';
import { agendaDelDia } from '../../src/server/agenda';
import { almacenEnBase } from '../../src/server/archivos';
import { quienPideElReinicio, registrarReinicioDemo } from '../../src/server/demo';
import { altaPaciente, guardarFotoPaciente, leerFotoPaciente } from '../../src/server/pacientes';
import { cargarUsuario } from '../../src/server/usuarios';
import { crearBaseDePrueba } from './base-de-prueba';

const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../drizzle', import.meta.url));
const MIGRACIONES = (JSON.parse(readFileSync(`${CARPETA_MIGRACIONES}/meta/_journal.json`, 'utf8')) as { entries: unknown[] }).entries.length;

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);
const OTRO_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);

/** Un viernes: el siguiente día hábil es el lunes. */
const VIERNES = '2026-11-27';

let base: Awaited<ReturnType<typeof crearBaseDePrueba>>;
const migrar = () => migrate(base.db, { migrationsFolder: CARPETA_MIGRACIONES });

async function turnosPorFecha() {
  const filas = await base.db.select({ inicio: schema.turnos.inicio }).from(schema.turnos);
  const porFecha = new Map<string, number>();
  for (const { inicio } of filas) porFecha.set(fechaDe(inicio), (porFecha.get(fechaDe(inicio)) ?? 0) + 1);
  return porFecha;
}

const usuarioPorNombre = async (nombre: string) => {
  const [fila] = await base.db.select({ id: schema.usuarios.id }).from(schema.usuarios).where(eq(schema.usuarios.nombre, nombre));
  return (await cargarUsuario(base.db, fila!.id))!;
};

beforeAll(async () => {
  base = await crearBaseDePrueba();
});

afterAll(async () => {
  await base.cliente.close();
});

describe('almacén de archivos en la base', () => {
  const almacen = () => almacenEnBase(async () => base.db);

  it('guarda por huella, no duplica y devuelve los mismos bytes', async () => {
    const primera = await almacen().guardar('fotos', JPEG, 'image/jpeg');
    const segunda = await almacen().guardar('fotos', JPEG, 'image/jpeg');
    expect(segunda).toEqual(primera);
    expect(primera.clave).toMatch(/^fotos\/[0-9a-f]{64}\.jpg$/);
    expect(await almacen().leer(primera.clave)).toEqual(JPEG);
    const [{ cantidad } = { cantidad: 0 }] = await base.db.select({ cantidad: count() }).from(schema.archivos);
    expect(cantidad).toBe(1);
  });

  it('no deja leer claves raras ni inexistentes', async () => {
    expect(await almacen().leer('../../etc/passwd')).toBeNull();
    expect(await almacen().leer(`fotos/${'0'.repeat(64)}.jpg`)).toBeNull();
    await expect(almacen().guardar('../fotos', JPEG, 'image/jpeg')).rejects.toThrow('Carpeta inválida');
  });

  it('la base rechaza cambiar, borrar o vaciar archivos', async () => {
    await expect(base.db.execute(sql`update archivos set tipo_mime = 'image/png'`)).rejects.toThrow();
    await expect(base.db.execute(sql`delete from archivos`)).rejects.toThrow();
    await expect(base.db.execute(sql`truncate archivos`)).rejects.toThrow();
  });

  it('la base comprueba que el nombre sea la huella del contenido', async () => {
    const huellaFalsa = 'a'.repeat(64);
    await expect(
      base.db.insert(schema.archivos).values({ clave: `fotos/${huellaFalsa}.jpg`, sha256: huellaFalsa, tipoMime: 'image/jpeg', bytes: OTRO_JPEG.byteLength, contenido: OTRO_JPEG }),
    ).rejects.toThrow();
  });
});

describe('semilla con fechas relativas', () => {
  it('carga turnos para hoy y para los próximos días hábiles, no los fines de semana', async () => {
    expect(await sembrarDatosDePrueba(base.db, VIERNES)).toBe(true);
    const porFecha = await turnosPorFecha();
    expect(porFecha.get(VIERNES)).toBe(7);
    expect(porFecha.has('2026-11-28')).toBe(false);
    expect(porFecha.has('2026-11-29')).toBe(false);
    const habiles = proximosDiasHabiles(VIERNES, DIAS_HABILES_CON_TURNOS);
    expect(habiles[0]).toBe('2026-11-30');
    for (const dia of habiles) expect(porFecha.get(dia) ?? 0).toBeGreaterThanOrEqual(4);
    expect(porFecha.get(proximosDiasHabiles(habiles.at(-1)!, 1)[0]!)).toBeUndefined();
  });

  it('el día siguiente ya tiene turnos confirmados, y nadie va dos veces el mismo día', async () => {
    const secretaria = await usuarioPorNombre('Sofía');
    const agenda = await agendaDelDia(base.db, secretaria, '2026-11-30');
    const turnos = agenda.flatMap((p) => p.turnos);
    expect(turnos.some((t) => t.estado === 'confirmado')).toBe(true);
    expect(new Set(turnos.map((t) => t.paciente.id)).size).toBe(turnos.length);
  });

  it('las fotos de la ficha funcionan con el almacén en la base', async () => {
    const secretaria = await usuarioPorNombre('Sofía');
    const [paciente] = await base.db.select().from(schema.pacientes).where(eq(schema.pacientes.apellido, 'Sosa'));
    const almacen = almacenEnBase(async () => base.db);
    expect(await guardarFotoPaciente(base.db, almacen, secretaria, paciente!.id, OTRO_JPEG)).toEqual({ errores: [] });
    expect(await leerFotoPaciente(base.db, almacen, secretaria, paciente!.id)).toEqual({ bytes: OTRO_JPEG, tipo: 'image/jpeg' });
  });
});

describe('preparar y reiniciar la base de la demo', () => {
  it('preparar de nuevo no duplica nada', async () => {
    const antes = await base.db.select({ cantidad: count() }).from(schema.turnos);
    await prepararBase(base.db, migrar, '2026-12-15');
    expect(await base.db.select({ cantidad: count() }).from(schema.turnos)).toEqual(antes);
  });

  it('reiniciar borra todo, aunque haya historiales inalterables, y vuelve a sembrar con la fecha nueva', async () => {
    const secretaria = await usuarioPorNombre('Sofía');
    // Lo que deja la semilla, sin contar el paciente que se agrega en la prueba.
    const [{ cantidad: pacientesDeLaSemilla } = { cantidad: 0 }] = await base.db.select({ cantidad: count() }).from(schema.pacientes);
    const [particular] = await base.db.select().from(schema.financiadores).where(eq(schema.financiadores.esParticular, true));
    const datos = { numeroDocumento: '49876543', nombre: 'Carla', apellido: 'Prueba', fechaNacimiento: '1990-01-01', financiadorId: particular!.id };
    const alta = await altaPaciente(base.db, secretaria, datos, { confirmarQueEsOtraPersona: true });
    expect(alta.estado).toBe('creado');
    const pedido = await quienPideElReinicio(base.db, secretaria.id);
    expect(pedido).toEqual({ email: 'sofia@consultorio.local', nombre: 'Sofía Gómez' });

    const nuevoHoy = '2026-12-14';
    await reiniciarBase(base.db, migrar, nuevoHoy);
    await registrarReinicioDemo(base.db, pedido);

    const pacientes = await base.db.select({ apellido: schema.pacientes.apellido }).from(schema.pacientes);
    expect(pacientes.map((p) => p.apellido)).not.toContain('Prueba');
    expect(pacientes).toHaveLength(pacientesDeLaSemilla);
    expect(await base.db.select().from(schema.archivos)).toEqual([]);
    const porFecha = await turnosPorFecha();
    expect(porFecha.get(nuevoHoy)).toBe(7);
    expect(porFecha.has(VIERNES)).toBe(false);

    // Las migraciones quedaron todas aplicadas y los triggers siguen en pie.
    const aplicadas = await base.db.execute(sql`select count(*)::int as cantidad from drizzle.__drizzle_migrations`);
    expect(aplicadas.rows[0]).toEqual({ cantidad: MIGRACIONES });
    await expect(base.db.execute(sql`delete from turno_eventos`)).rejects.toThrow();

    // El reinicio queda auditado a nombre de quien lo pidió (con su usuario nuevo).
    const [auditoria] = await base.db.select().from(schema.auditoriaAccesos).where(eq(schema.auditoriaAccesos.accion, 'demo.reiniciar'));
    const sofiaNueva = await usuarioPorNombre('Sofía');
    expect(auditoria).toMatchObject({ usuarioId: sofiaNueva.id, entidad: 'demo', detalle: { pedidoPor: 'Sofía Gómez' } });
  });
});
