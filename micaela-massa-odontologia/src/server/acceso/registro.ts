import { and, desc, eq, gt, inArray, max, type SQL } from 'drizzle-orm';
import { auditoriaAccesos, intentosIngreso } from '../../db/schema';
import type { BaseDeDatos } from '../../db/tipos';
import { BLOQUEO_POR_IP, BLOQUEO_POR_USUARIO, bloqueadoHasta } from '../../domain/acceso/sesiones';

/** De dónde viene el pedido: queda en la auditoría y sirve para el bloqueo por IP. */
export interface DatosDelPedido {
  ip: string | null;
  userAgent: string | null;
}

export const PEDIDO_DE_CONSOLA: DatosDelPedido = { ip: null, userAgent: 'consola' };

type Escritor = Pick<BaseDeDatos, 'insert'>;

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

export async function registrarIntento(
  db: Escritor,
  entrada: { emailHuella: string | null; usuarioId?: string | null; pedido: DatosDelPedido; resultado: Resultado; ahora: Date },
): Promise<void> {
  await db.insert(intentosIngreso).values({
    emailHuella: entrada.emailHuella,
    usuarioId: entrada.usuarioId ?? null,
    ip: entrada.pedido.ip,
    resultado: entrada.resultado,
    ocurridoEn: entrada.ahora,
  });
}

const FALLOS: Resultado[] = ['clave_incorrecta', 'codigo_incorrecto'];

async function fallos(db: BaseDeDatos, filtro: SQL, desde: Date): Promise<Date[]> {
  const filas = await db
    .select({ en: intentosIngreso.ocurridoEn })
    .from(intentosIngreso)
    .where(and(filtro, inArray(intentosIngreso.resultado, FALLOS), gt(intentosIngreso.ocurridoEn, desde)))
    .orderBy(desc(intentosIngreso.ocurridoEn))
    .limit(100);
  return filas.map((f) => f.en);
}

/**
 * Hasta cuándo está bloqueado el ingreso para ese email o esa IP (null si no lo está).
 * Por email cuentan los fallos desde el último ingreso completo (con código);
 * por IP cuentan todos los fallos de la ventana.
 */
export async function bloqueoVigente(db: BaseDeDatos, emailHuella: string, ip: string | null, ahora: Date): Promise<Date | null> {
  const desdeUsuario = new Date(ahora.getTime() - BLOQUEO_POR_USUARIO.ventanaMs);
  const [ultimoIngreso] = await db
    .select({ en: max(intentosIngreso.ocurridoEn) })
    .from(intentosIngreso)
    .where(and(eq(intentosIngreso.emailHuella, emailHuella), eq(intentosIngreso.resultado, 'ingreso'), gt(intentosIngreso.ocurridoEn, desdeUsuario)));
  const desde = ultimoIngreso?.en && ultimoIngreso.en > desdeUsuario ? ultimoIngreso.en : desdeUsuario;
  const porUsuario = bloqueadoHasta(await fallos(db, eq(intentosIngreso.emailHuella, emailHuella), desde), ahora, BLOQUEO_POR_USUARIO);

  const porIp = ip ? bloqueadoHasta(await fallos(db, eq(intentosIngreso.ip, ip), new Date(ahora.getTime() - BLOQUEO_POR_IP.ventanaMs)), ahora, BLOQUEO_POR_IP) : null;
  if (!porUsuario) return porIp;
  if (!porIp) return porUsuario;
  return porUsuario > porIp ? porUsuario : porIp;
}
