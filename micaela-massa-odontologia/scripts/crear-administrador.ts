/**
 * Primer administrador de una base nueva (o recuperar el acceso de uno).
 *
 *   npm run crear-administrador -- --email mica@ejemplo.com --nombre Micaela --apellido Massa \
 *     [--matricula "MP 12345" --especialidad odontologia_general --especialidad odontopediatria] \
 *     [--consultorio "Micaela Massa Odontología"] [--url https://sistema.ejemplo.com]
 *
 *   npm run crear-administrador -- --recuperar mica@ejemplo.com [--url ...]
 *
 * Usa `DATABASE_URL` (o la de `.env.local`). Imprime un enlace de un solo uso:
 * con él la persona elige su contraseña y configura la verificación en dos
 * pasos. Se niega a trabajar sobre una base de prueba (sembrada por el modo
 * desarrollo). Corre con `tsx`, que ya viene instalado con drizzle-kit.
 */
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ErrorDeBaseDeDatos, exigirBaseReal } from '../src/db/marca-de-prueba';
import * as schema from '../src/db/schema';
import { ESPECIALIDADES, type Especialidad } from '../src/domain/permisos/roles';
import { crearPrimerAdministrador, recuperarAccesoPorConsola } from '../src/server/acceso/administracion';
import { rutaDeEnlace } from '../src/server/acceso/enlaces';

const AYUDA = `Uso:
  npm run crear-administrador -- --email <email> --nombre <nombre> --apellido <apellido>
      [--matricula <matrícula> --especialidad <especialidad>...] [--consultorio <nombre>] [--url <dirección del sistema>]
  npm run crear-administrador -- --recuperar <email> [--url <dirección del sistema>]

Especialidades: ${ESPECIALIDADES.join(', ')}`;

function salir(mensaje: string, codigo = 1): never {
  console.error(mensaje);
  process.exit(codigo);
}

async function principal() {
  if (!process.env.DATABASE_URL && existsSync('.env.local')) process.loadEnvFile('.env.local');
  const { values: opciones } = parseArgs({
    options: {
      email: { type: 'string' },
      nombre: { type: 'string' },
      apellido: { type: 'string' },
      matricula: { type: 'string' },
      especialidad: { type: 'string', multiple: true },
      consultorio: { type: 'string', default: 'Micaela Massa Odontología' },
      url: { type: 'string' },
      recuperar: { type: 'string' },
      ayuda: { type: 'boolean', short: 'h' },
    },
  });
  if (opciones.ayuda) salir(AYUDA, 0);
  const url = process.env.DATABASE_URL;
  if (!url) salir('Falta DATABASE_URL (ver .env.example).');

  const base = (opciones.url ?? process.env.URL_PUBLICA ?? '').replace(/\/+$/, '');
  const mostrarEnlace = (token: string) => (base ? `${base}${rutaDeEnlace(token)}` : `<dirección del sistema>${rutaDeEnlace(token)}`);

  const pool = new pg.Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  try {
    // Nunca sobre una base de prueba: sus usuarios tienen contraseñas públicas.
    try {
      await exigirBaseReal(db);
    } catch (error) {
      if (error instanceof ErrorDeBaseDeDatos) salir(error.message);
      throw error;
    }
    if (opciones.recuperar) {
      const resultado = await recuperarAccesoPorConsola(db, opciones.recuperar);
      if (!resultado.ok) salir(resultado.error);
      console.log(`Listo: se borraron la contraseña y la verificación de ${resultado.nombre} y se cerraron sus sesiones.`);
      console.log(`Enlace de un solo uso (vence el ${resultado.enlace.venceEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}):`);
      console.log(mostrarEnlace(resultado.enlace.token));
      return;
    }

    if (!opciones.email || !opciones.nombre || !opciones.apellido) salir(AYUDA);
    const especialidades = (opciones.especialidad ?? []) as Especialidad[];
    const desconocida = especialidades.find((e) => !ESPECIALIDADES.includes(e));
    if (desconocida) salir(`Especialidad desconocida: ${desconocida}.\n\n${AYUDA}`);

    const resultado = await crearPrimerAdministrador(db, {
      email: opciones.email,
      nombre: opciones.nombre,
      apellido: opciones.apellido,
      consultorio: opciones.consultorio ?? '',
      matricula: opciones.matricula ?? null,
      especialidades,
    });
    if (resultado.estado === 'invalido') salir(resultado.errores.join('\n'));
    if (resultado.estado === 'ya_hay_administradores') {
      salir(`"${resultado.consultorio}" ya tiene quien lo administre: los demás usuarios se crean desde el sistema. Para recuperar un acceso usá --recuperar <email>.`);
    }
    console.log(`Listo: ${opciones.nombre} ${opciones.apellido} administra "${opciones.consultorio}".`);
    console.log(`Pasale este enlace de un solo uso (vence el ${resultado.enlace.venceEn.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}):`);
    console.log(mostrarEnlace(resultado.enlace.token));
  } finally {
    await pool.end();
  }
}

principal().catch((error: unknown) => {
  // Drizzle envuelve el error de Postgres: el motivo real está en `cause`.
  const causa = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';
  const mensaje = error instanceof Error ? error.message : String(error);
  if (/relation .* does not exist/.test(`${causa} ${mensaje}`)) salir('La base no tiene las tablas: corré primero `npm run db:migrate`.');
  salir(`No se pudo: ${causa || mensaje}`);
});
