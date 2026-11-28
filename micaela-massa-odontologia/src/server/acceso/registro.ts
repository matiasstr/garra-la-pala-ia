import { and, desc, eq, gt, inArray, isNull, max, sql, type SQL } from 'drizzle-orm';
import { auditoriaAccesos, intentosIngreso } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { BLOQUEO_DE_CUENTA, BLOQUEO_POR_EMAIL, BLOQUEO_POR_EMAIL_E_IP, BLOQUEO_POR_IP, bloqueadoHasta, type PoliticaDeBloqueo } from '../../domain/acceso/sesiones';

/** De dónde viene el pedido: queda en la auditoría y sirve para el bloqueo por IP. */
export interface DatosDelPedido {
  ip: string | null;
  userAgent: string | null;
}

export const PEDIDO_DE_CONSOLA: DatosDelPedido = { ip: null, userAgent: 'consola' };

type Escritor = Pick<BaseDeDatos, 'insert'>;
export type Transaccion = Parameters<Parameters<BaseDeDatos['transaction']>[0]>[0];
type Consultas = BaseDeDatos | Transaccion;

export async function auditarAcceso(
  db: Escritor,
  entrada: { usuarioId: string; accion: string; entidad: 'usuario' | 'sesion'; entidadId: string; detalle?: unknown; pedido?: DatosDelPedido; ahora?: Date },
): Promise<void> {
  await db.insert(auditoriaAccesos).values({
    usuarioId: entrada.usuarioId,
    accion: entrada.accion,
    entidad: entrada.entidad,
    entidadId: entrada.entidadId,
    detalle: entrada.detalle ?? null,
    ip: entrada.pedido?.ip ?? null,
    userAgent: entrada.pedido?.userAgent ?? null,
    ...(entrada.ahora ? { ocurridoEn: entrada.ahora } : {}),
  });
}

type Resultado = (typeof intentosIngreso.$inferInsert)['resultado'];
type Ambito = NonNullable<(typeof intentosIngreso.$inferInsert)['ambito']>;

export async function registrarIntento(
  db: Escritor,
  entrada: { emailHuella: string | null; usuarioId?: string | null; pedido: DatosDelPedido; resultado: Resultado; ahora: Date; ambito?: Ambito },
): Promise<void> {
  await db.insert(intentosIngreso).values({
    emailHuella: entrada.emailHuella,
    usuarioId: entrada.usuarioId ?? null,
    ip: entrada.pedido.ip,
    resultado: entrada.resultado,
    ambito: entrada.ambito ?? 'ingreso',
    ocurridoEn: entrada.ahora,
  });
}

// ---------------------------------------------------------------------------
// Un intento por vez
// ---------------------------------------------------------------------------

/** Primera clave del candado (la segunda sale de `clave`): separa estos candados de los demás del sistema. */
const CANDADO_INTENTOS = 2026_1127;

/** Candado del ingreso de un email (contraseña, código y enlaces de un solo uso). */
export const candadoDeIngreso = (emailHuella: string): string => `ingreso:${emailHuella}`;
/** Candado de las acciones de "Mi cuenta" de una persona. */
export const candadoDeCuenta = (usuarioId: string): string => `cuenta:${usuarioId}`;

/**
 * Corre un intento (mirar el bloqueo, verificar la contraseña o el código y
 * registrar el resultado) dentro de una transacción con un candado de la base
 * (`pg_advisory_xact_lock`) por `clave`. Así, N pedidos simultáneos con el
 * mismo email (o de la misma persona en "Mi cuenta") se atienden de a uno, y
 * cada uno ve los fallos que registraron los anteriores: nunca se comparan
 * más contraseñas o códigos que los que permite el bloqueo. El candado se
 * suelta solo al terminar la transacción. Todo lo de adentro tiene que usar
 * `tx`, no `db`.
 */
export async function conCandadoDeIntentos<T>(db: BaseDeDatos, clave: string, tarea: (tx: Transaccion) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CANDADO_INTENTOS}::int, hashtext(${clave}))`);
    return tarea(tx);
  });
}

// ---------------------------------------------------------------------------
// Bloqueos
// ---------------------------------------------------------------------------

const FALLOS: Resultado[] = ['clave_incorrecta', 'codigo_incorrecto'];

const desdeVentana = (politica: PoliticaDeBloqueo, ahora: Date) => new Date(ahora.getTime() - politica.ventanaMs);

async function fallos(db: Consultas, filtro: SQL | undefined, desde: Date): Promise<Date[]> {
  const filas = await db
    .select({ en: intentosIngreso.ocurridoEn })
    .from(intentosIngreso)
    .where(and(filtro, inArray(intentosIngreso.resultado, FALLOS), gt(intentosIngreso.ocurridoEn, desde)))
    .orderBy(desc(intentosIngreso.ocurridoEn))
    .limit(100);
  return filas.map((f) => f.en);
}

/** Desde cuándo cuentan los fallos: el último ingreso completo (con código) dentro de la ventana, o el principio de la ventana. */
async function desdeUltimoIngreso(db: Consultas, filtro: SQL | undefined, desde: Date): Promise<Date> {
  const [ultimo] = await db
    .select({ en: max(intentosIngreso.ocurridoEn) })
    .from(intentosIngreso)
    .where(and(filtro, eq(intentosIngreso.resultado, 'ingreso'), gt(intentosIngreso.ocurridoEn, desde)));
  return ultimo?.en && ultimo.en > desde ? ultimo.en : desde;
}

const elMasLargo = (bloqueos: (Date | null)[]): Date | null =>
  bloqueos.reduce<Date | null>((mayor, b) => (b && (!mayor || b > mayor) ? b : mayor), null);

/**
 * Hasta cuándo está bloqueado el ingreso de ese email desde esa IP (null si no
 * lo está). Se bloquea por cualquiera de las tres reglas (ver
 * `src/domain/acceso/sesiones.ts`):
 * - por email e IP (5): cuentan los fallos desde el último ingreso completo de
 *   ese email desde esa IP;
 * - por email, desde cualquier IP (30): desde el último ingreso completo de
 *   ese email;
 * - por IP, con cualquier email (20): todos los fallos de la ventana.
 * Los fallos de "Mi cuenta" no cuentan acá (ver `bloqueoDeCuenta`).
 */
export async function bloqueoVigente(db: Consultas, emailHuella: string, ip: string | null, ahora: Date): Promise<Date | null> {
  const delIngreso = eq(intentosIngreso.ambito, 'ingreso');
  const delEmail = and(delIngreso, eq(intentosIngreso.emailHuella, emailHuella));
  const delEmailYLaIp = and(delEmail, ip ? eq(intentosIngreso.ip, ip) : isNull(intentosIngreso.ip));

  const porEmailEIp = bloqueadoHasta(
    await fallos(db, delEmailYLaIp, await desdeUltimoIngreso(db, delEmailYLaIp, desdeVentana(BLOQUEO_POR_EMAIL_E_IP, ahora))),
    ahora,
    BLOQUEO_POR_EMAIL_E_IP,
  );
  const porEmail = bloqueadoHasta(await fallos(db, delEmail, await desdeUltimoIngreso(db, delEmail, desdeVentana(BLOQUEO_POR_EMAIL, ahora))), ahora, BLOQUEO_POR_EMAIL);
  const porIp = ip ? bloqueadoHasta(await fallos(db, and(delIngreso, eq(intentosIngreso.ip, ip)), desdeVentana(BLOQUEO_POR_IP, ahora)), ahora, BLOQUEO_POR_IP) : null;
  return elMasLargo([porEmailEIp, porEmail, porIp]);
}

/**
 * Hasta cuándo están bloqueadas las acciones de "Mi cuenta" de esa persona
 * (contraseña actual o código de la app con la sesión abierta). Cuentan solo
 * sus propios fallos ahí: los intentos de ingreso de otros no la bloquean.
 */
export async function bloqueoDeCuenta(db: Consultas, usuarioId: string, ahora: Date): Promise<Date | null> {
  const propios = and(eq(intentosIngreso.ambito, 'cuenta'), eq(intentosIngreso.usuarioId, usuarioId));
  return bloqueadoHasta(await fallos(db, propios, desdeVentana(BLOQUEO_DE_CUENTA, ahora)), ahora, BLOQUEO_DE_CUENTA);
}
