import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../src/db/schema';

/**
 * Postgres real en memoria (PGlite) con todas las migraciones aplicadas,
 * incluidos los triggers de inalterabilidad.
 */
export async function crearBaseDePrueba() {
  const cliente = new PGlite();
  const db = drizzle(cliente, { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
  return { db, cliente };
}

/** Datos mínimos: una secretaria, dos odontólogas, un paciente con su HC. */
export async function sembrarConsultorio(db: Awaited<ReturnType<typeof crearBaseDePrueba>>['db']) {
  const [secretaria, mica, otra] = await db
    .insert(schema.usuarios)
    .values([
      { email: 'secretaria@consultorio.test', nombre: 'Sofía', apellido: 'Recepción' },
      { email: 'mica@consultorio.test', nombre: 'Micaela', apellido: 'Massa' },
      { email: 'endo@consultorio.test', nombre: 'Laura', apellido: 'Endo' },
    ])
    .returning();
  if (!secretaria || !mica || !otra) throw new Error('No se pudieron crear usuarios.');

  const [consultorio] = await db.insert(schema.consultorios).values({ nombre: 'Consultorio de prueba' }).returning();
  if (!consultorio) throw new Error('No se pudo crear el consultorio.');
  await db.insert(schema.consultorioMiembros).values([secretaria, mica, otra].map((u) => ({ consultorioId: consultorio.id, usuarioId: u.id })));
  await db.insert(schema.usuarioRoles).values([
    { consultorioId: consultorio.id, usuarioId: secretaria.id, rol: 'secretaria' },
    { consultorioId: consultorio.id, usuarioId: mica.id, rol: 'profesional' },
    { consultorioId: consultorio.id, usuarioId: mica.id, rol: 'administrador' },
    { consultorioId: consultorio.id, usuarioId: otra.id, rol: 'profesional' },
  ]);
  await db.insert(schema.profesionales).values([
    { usuarioId: mica.id, matricula: 'MP 0001' },
    { usuarioId: otra.id, matricula: 'MP 0002' },
  ]);

  const [paciente] = await db
    .insert(schema.pacientes)
    .values({ numeroDocumento: '30123456', nombre: 'Juan', apellido: 'Pérez', fechaNacimiento: '1985-03-10', creadoPor: secretaria.id })
    .returning();
  if (!paciente) throw new Error('No se pudo crear el paciente.');

  return {
    consultorio,
    paciente,
    secretaria: { id: secretaria.id, roles: ['secretaria'] as const, activo: true },
    mica: { id: mica.id, roles: ['profesional', 'administrador'] as const, activo: true, matricula: 'MP 0001' },
    otra: { id: otra.id, roles: ['profesional'] as const, activo: true, matricula: 'MP 0002' },
  };
}
