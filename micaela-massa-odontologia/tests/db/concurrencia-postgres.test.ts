import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLAVE_DE_PRUEBA } from '../../src/db/acceso-de-prueba';
import * as schema from '../../src/db/schema';
import { sembrarDatosDePrueba } from '../../src/db/semilla';
import { huellaDeEmail } from '../../src/domain/acceso/sesiones';
import { hoyEnArgentina } from '../../src/lib/fechas';
import { ingresarConClave, ingresarConCodigo } from '../../src/server/acceso/autenticacion';
import { cambiarClave } from '../../src/server/acceso/cuenta';
import { crearTurno, reprogramarTurno } from '../../src/server/agenda';
import { sincronizarPendientes } from '../../src/server/pendientes';
import { cargarUsuario, type UsuarioSesion } from '../../src/server/usuarios';

/**
 * Pedidos simultáneos de verdad: varias conexiones a PostgreSQL a la vez (en
 * PGlite hay una sola conexión y las transacciones se atienden de a una, así
 * que estas carreras no se ven): intentos de ingreso, sillón, reprogramar y
 * recálculo de pendientes contra un cierre a mano. Solo corre con `PRUEBA_POSTGRES_URL`, y usa
 * una base propia, la misma con `_concurrencia` al final del nombre, que se
 * borra y se crea de nuevo (`postgres-demo.test.ts` vacía la otra, y los
 * archivos de tests corren en paralelo). Por ejemplo:
 *   PRUEBA_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/mm_tests npx vitest run tests/db/concurrencia-postgres.test.ts
 */
const URL_PRUEBA = process.env.PRUEBA_POSTGRES_URL;
const CARPETA_MIGRACIONES = fileURLToPath(new URL('../../drizzle', import.meta.url));

function urlPropia(url: string): { url: string; nombre: string } {
  const direccion = new URL(url);
  const nombre = `${decodeURIComponent(direccion.pathname.slice(1))}_concurrencia`;
  direccion.pathname = `/${encodeURIComponent(nombre)}`;
  return { url: direccion.toString(), nombre };
}

describe.skipIf(!URL_PRUEBA)('pedidos simultáneos con PostgreSQL real', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let sofia: UsuarioSesion;
  let mica: UsuarioSesion;
  let laura: UsuarioSesion;
  let sillonId: string;
  let pacienteIds: string[];
  const pedido = (ip: string) => ({ ip, userAgent: 'prueba de concurrencia' });
  const fallos = async (filtro: ReturnType<typeof and>, resultado: 'clave_incorrecta' | 'codigo_incorrecto') =>
    (await db.select().from(schema.intentosIngreso).where(and(filtro, eq(schema.intentosIngreso.resultado, resultado)))).length;

  beforeAll(async () => {
    const propia = urlPropia(URL_PRUEBA!);
    const administracion = new Client({ connectionString: URL_PRUEBA });
    await administracion.connect();
    await administracion.query(`drop database if exists "${propia.nombre}" with (force)`);
    await administracion.query(`create database "${propia.nombre}"`);
    await administracion.end();

    pool = new Pool({ connectionString: propia.url, max: 12 });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: CARPETA_MIGRACIONES });
    expect(await sembrarDatosDePrueba(db, hoyEnArgentina())).toBe(true);
    const porEmail = async (email: string) => {
      const [fila] = await db.select({ id: schema.usuarios.id }).from(schema.usuarios).where(eq(schema.usuarios.email, email));
      return (await cargarUsuario(db, fila!.id))!;
    };
    [sofia, mica, laura] = [await porEmail('sofia@consultorio.local'), await porEmail('mica@consultorio.local'), await porEmail('laura@consultorio.local')];
    const [sillon] = await db.select().from(schema.sillones).where(eq(schema.sillones.nombre, 'Sillón 1'));
    sillonId = sillon!.id;
    pacienteIds = (await db.select({ id: schema.pacientes.id }).from(schema.pacientes)).map((p) => p.id);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('el recálculo de pendientes no pisa un pendiente que alguien cierra a mano mientras tanto', async () => {
    const [pendiente] = await db
      .select()
      .from(schema.pendientes)
      .where(and(eq(schema.pendientes.tipo, 'ausente_sin_reprogramar'), inArray(schema.pendientes.estado, ['abierto', 'en_curso', 'no_responde'])));
    if (!pendiente) throw new Error('La semilla tendría que dejar un ausente sin reprogramar.');
    // Saca turno sin pasar por la agenda: el próximo recálculo lo da por resuelto.
    const inicio = new Date(Date.now() + 7 * 24 * 3600_000);
    await db.insert(schema.turnos).values({ pacienteId: pendiente.pacienteId, profesionalId: mica.id, inicio, fin: new Date(inicio.getTime() + 30 * 60_000), creadoPor: sofia.id });

    // Una secretaria lo está descartando (con la fila bloqueada, como descartarPendiente)...
    const secretaria = new Client({ connectionString: urlPropia(URL_PRUEBA!).url });
    await secretaria.connect();
    try {
      await secretaria.query('begin');
      await secretaria.query('select id from pendientes where id = $1 for update', [pendiente.id]);
      // ...cuando el recálculo lo lee como abierto y espera la fila para resolverlo.
      let terminado = false;
      const recalculo = sincronizarPendientes(db, { pacienteIds: [pendiente.pacienteId] }).finally(() => (terminado = true));
      for (let i = 0; i < 200 && !terminado; i++) {
        const { rows } = await pool.query("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
        if (rows[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(terminado, 'el recálculo tendría que estar esperando la fila').toBe(false);
      await secretaria.query("update pendientes set estado = 'descartado', resuelto_en = now(), cerrado_por = $2, motivo_cierre = 'Se atiende en otro lado' where id = $1", [pendiente.id, sofia.id]);
      await secretaria.query('commit');
      expect((await recalculo).resueltos).toBe(0);
    } finally {
      await secretaria.end();
    }
    const [final] = await db.select().from(schema.pendientes).where(eq(schema.pendientes.id, pendiente.id));
    expect(final).toMatchObject({ estado: 'descartado', cerradoPor: sofia.id, motivoCierre: 'Se atiende en otro lado' });
    const resoluciones = await db
      .select()
      .from(schema.pendienteAcciones)
      .where(and(eq(schema.pendienteAcciones.pendienteId, pendiente.id), eq(schema.pendienteAcciones.tipo, 'resuelto')));
    expect(resoluciones).toEqual([]);
  });

  it('40 contraseñas a la vez con el mismo email: se comparan 5 y el resto queda bloqueado', async () => {
    const ahora = new Date();
    const resultados = await Promise.all(
      Array.from({ length: 40 }, (_, i) => ingresarConClave(db, { email: laura.email, clave: `adivinando ${i}` }, pedido('203.0.113.10'), ahora)),
    );
    expect(await fallos(eq(schema.intentosIngreso.emailHuella, huellaDeEmail(laura.email)), 'clave_incorrecta')).toBe(5);
    expect(resultados.filter((r) => r.estado === 'bloqueado')).toHaveLength(35);
  });

  it('40 códigos a la vez en el segundo paso: se comparan 5', async () => {
    const ahora = new Date();
    const paso1 = await ingresarConClave(db, { email: mica.email, clave: CLAVE_DE_PRUEBA }, pedido('203.0.113.20'), ahora);
    if (paso1.estado !== 'falta_codigo') throw new Error(JSON.stringify(paso1));
    const resultados = await Promise.all(
      Array.from({ length: 40 }, (_, i) => ingresarConCodigo(db, { token: paso1.token, codigo: String(200000 + i) }, pedido('203.0.113.20'), ahora)),
    );
    expect(await fallos(eq(schema.intentosIngreso.emailHuella, huellaDeEmail(mica.email)), 'codigo_incorrecto')).toBe(5);
    expect(resultados.some((r) => r.estado === 'ingreso')).toBe(false);
  });

  it('20 contraseñas actuales a la vez en "Mi cuenta": se comparan 5', async () => {
    const malas = { actual: 'no es la mía', nueva: 'otra frase bien larga', repetida: 'otra frase bien larga' };
    await Promise.all(Array.from({ length: 20 }, () => cambiarClave(db, sofia, null, malas, pedido('203.0.113.30'))));
    expect(await fallos(and(eq(schema.intentosIngreso.usuarioId, sofia.id), eq(schema.intentosIngreso.ambito, 'cuenta')), 'clave_incorrecta')).toBe(5);
  });

  it('dos secretarias dan a la vez el mismo sillón y horario con profesionales distintas: queda un turno por horario', async () => {
    const horas = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30'];
    const resultados = await Promise.all(
      horas.flatMap((hora) => {
        const turno = { sillonId, fecha: '2027-03-04', hora, duracionMinutos: 30, motivo: 'Carrera por el sillón' };
        return [
          crearTurno(db, sofia, { ...turno, pacienteId: pacienteIds[0]!, profesionalId: mica.id }),
          crearTurno(db, sofia, { ...turno, pacienteId: pacienteIds[1]!, profesionalId: laura.id }),
        ];
      }),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(horas.length);
    expect(resultados.filter((r) => !r.ok).every((r) => !r.ok && r.errores.includes('El sillón ya está ocupado en ese horario.'))).toBe(true);
  });

  it('dos personas reprograman a la vez el mismo turno: queda un solo turno nuevo', async () => {
    const original = await crearTurno(db, sofia, { pacienteId: pacienteIds[2]!, profesionalId: mica.id, fecha: '2027-04-05', hora: '08:00', duracionMinutos: 30 });
    if (!original.ok) throw new Error(original.errores.join());
    const resultados = await Promise.all([
      reprogramarTurno(db, sofia, original.turnoId, { fecha: '2027-04-06', hora: '08:00' }),
      reprogramarTurno(db, sofia, original.turnoId, { fecha: '2027-04-07', hora: '08:00' }),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.select().from(schema.turnos).where(eq(schema.turnos.reprogramaA, original.turnoId))).toHaveLength(1);
  });
});
