import 'server-only';
import { headers } from 'next/headers';
import type { ContextoAuditoria } from './hc/historia-clinica';

/** IP y navegador del pedido actual, para la auditoría de accesos a la historia clínica. */
export async function contextoDelPedido(): Promise<ContextoAuditoria> {
  const encabezados = await headers();
  const ip = encabezados.get('x-forwarded-for')?.split(',')[0]?.trim() || encabezados.get('x-real-ip') || null;
  return { ip: ip?.slice(0, 64) ?? null, userAgent: encabezados.get('user-agent')?.slice(0, 300) ?? null };
}
