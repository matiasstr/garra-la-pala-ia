import type { DatosDelPedido } from './acceso/registro';

/**
 * Lo que se lee de un pedido HTTP, en funciones puras (sin `next/headers`)
 * para poder probarlas: de dónde viene y a qué ruta interna volver después de
 * ingresar. `src/server/sesion.ts` las usa con los encabezados del pedido.
 */

/**
 * IP y navegador del pedido: la misma función para todo el sistema (bloqueos
 * de ingreso, auditoría de accesos y auditoría de la historia clínica).
 *
 * La IP es el último valor de `X-Forwarded-For`: los anteriores los puede
 * inventar cualquiera. El último lo pone el proxy de confianza que está
 * delante del sistema (en Vercel, la plataforma, que además descarta lo que
 * mande el navegador; con nginx o Caddy, `proxy_add_x_forwarded_for` o
 * equivalente). Sin ese proxy, Next.js deja el encabezado tal como llega y
 * también el último valor se puede inventar (ver docs/arquitectura.md).
 */
export function datosDeEncabezados(encabezados: { get(nombre: string): string | null }): DatosDelPedido {
  const reenviada = encabezados
    .get('x-forwarded-for')
    ?.split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const ip = reenviada?.at(-1) ?? encabezados.get('x-real-ip') ?? null;
  return { ip: ip ? ip.replace(/^::ffff:/, '').slice(0, 64) : null, userAgent: encabezados.get('user-agent')?.slice(0, 300) ?? null };
}

/** Origen inventado para resolver la ruta: cualquier cosa que termine en otro origen no es interna. */
const ORIGEN_INTERNO = 'http://interno';
/** Caracteres de control, también escritos con `%` (el parser de URL saca tabulaciones y saltos de línea en silencio). */
const CONTROL = /\p{Cc}|%(?:[01][0-9a-f]|7f)/iu;

const esIngresar = (ruta: string) => ruta === '/ingresar' || /^\/ingresar[/?#]/.test(ruta);

/**
 * Solo rutas de este mismo sistema: evita que `?volver=` mande a otro sitio
 * (`//otro.com`, `/\otro.com`, `/<tab>/otro.com`...). La ruta se resuelve como
 * lo haría el navegador y se exige que quede en el mismo origen; se devuelve
 * ya normalizada (ruta, consulta y ancla). `/ingresar` no cuenta: volvería a
 * la misma pantalla.
 */
export function rutaInterna(ruta: string | null | undefined, porDefecto = '/agenda'): string {
  if (!ruta || !ruta.startsWith('/') || CONTROL.test(ruta)) return porDefecto;
  let url: URL;
  try {
    url = new URL(ruta, ORIGEN_INTERNO);
  } catch {
    return porDefecto;
  }
  if (url.origin !== ORIGEN_INTERNO) return porDefecto;
  const resultado = `${url.pathname}${url.search}${url.hash}`;
  return esIngresar(resultado) ? porDefecto : resultado;
}
