import { asc, eq } from 'drizzle-orm';
import { auditoriaAccesos, usuarioRoles, usuarios } from '../db/schema';
import type { BaseDeDatos } from '../db/tipos';

/**
 * Demo online con datos inventados (ver docs/demo.md).
 *
 * "Reiniciar datos de prueba" borra todo. Solo existe si están las dos
 * variables: `MODO_DESARROLLO=1` (datos y usuarios de prueba) y
 * `DEMO_PERMITE_REINICIO=1`. Se verifica en el servidor, no solo al mostrar el botón.
 */
export function permiteReiniciarDemo(variables: Record<string, string | undefined> = process.env): boolean {
  return variables.MODO_DESARROLLO === '1' && variables.DEMO_PERMITE_REINICIO === '1';
}

export interface PedidoDeReinicio {
  email: string | null;
  nombre: string;
}

/** Quién pide el reinicio, para dejarlo en la auditoría de la base nueva. */
export async function quienPideElReinicio(db: BaseDeDatos, usuarioId: string): Promise<PedidoDeReinicio> {
  const [usuario] = await db.select({ email: usuarios.email, nombre: usuarios.nombre, apellido: usuarios.apellido }).from(usuarios).where(eq(usuarios.id, usuarioId));
  return { email: usuario?.email ?? null, nombre: usuario ? `${usuario.nombre} ${usuario.apellido}` : 'Usuario desconocido' };
}

/**
 * Deja el reinicio en `auditoria_accesos` de la base recién sembrada. Los
 * usuarios de prueba vuelven con otro id, así que se busca al mismo por su
 * email; si no está (era un usuario creado durante la prueba), queda a nombre
 * del primer administrador, con el nombre de quien lo pidió en el detalle.
 */
export async function registrarReinicioDemo(db: BaseDeDatos, pedido: PedidoDeReinicio): Promise<void> {
  const [mismo] = pedido.email ? await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.email, pedido.email)) : [];
  const [administrador] = await db
    .select({ id: usuarioRoles.usuarioId })
    .from(usuarioRoles)
    .innerJoin(usuarios, eq(usuarios.id, usuarioRoles.usuarioId))
    .where(eq(usuarioRoles.rol, 'administrador'))
    .orderBy(asc(usuarios.email))
    .limit(1);
  const usuarioId = mismo?.id ?? administrador?.id;
  if (!usuarioId) return;
  await db.insert(auditoriaAccesos).values({ usuarioId, accion: 'demo.reiniciar', entidad: 'demo', detalle: { pedidoPor: pedido.nombre } });
}
