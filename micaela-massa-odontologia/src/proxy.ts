import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy de Next.js 16 (el reemplazo de `middleware`): corre antes de cada
 * pedido, en Node.js.
 *
 * 1. Demo protegida: si existe `DEMO_CLAVE`, todo el sitio pide usuario y
 *    contraseña del navegador (HTTP Basic; cualquier usuario, esa contraseña).
 * 2. Sin cookie de sesión, las pantallas mandan a `/ingresar` y las acciones
 *    responden 401. Es un filtro rápido: no consulta la base. La verificación
 *    que vale (sesión vigente, código verificado, usuario activo, permisos) la
 *    hace el servidor en `usuarioActual()` y en cada función de `src/server/`.
 *
 * No importa `src/server/entorno.ts` (usa `server-only`), así que repite acá
 * la regla de `modoDesarrollo()`.
 */
const enDesarrollo = () => process.env.NODE_ENV !== 'production' || process.env.MODO_DESARROLLO === '1';

/** Las mismas que `nombreCookieSesion()` en src/server/sesion.ts. */
const COOKIES_DE_SESION = ['__Host-mm_sesion', 'mm_sesion'];
const ENCABEZADO_RUTA = 'x-mm-ruta';

const esPublica = (ruta: string) =>
  ruta === '/ingresar' || ruta.startsWith('/ingresar/') || ruta.startsWith('/configurar-acceso/') || ruta.startsWith('/_next/') || ruta === '/favicon.ico' || ruta === '/robots.txt';

const huella = (texto: string) => createHash('sha256').update(texto, 'utf8').digest();

/** Compara la contraseña de la demo en tiempo constante. */
function demoAutorizada(pedido: NextRequest, clave: string): boolean {
  const encabezado = pedido.headers.get('authorization');
  if (!encabezado?.toLowerCase().startsWith('basic ')) return false;
  let credenciales: string;
  try {
    credenciales = Buffer.from(encabezado.slice(6).trim(), 'base64').toString('utf8');
  } catch {
    return false;
  }
  const separador = credenciales.indexOf(':');
  if (separador < 0) return false;
  return timingSafeEqual(huella(credenciales.slice(separador + 1)), huella(clave));
}

export function proxy(pedido: NextRequest) {
  const claveDemo = process.env.DEMO_CLAVE;
  if (claveDemo && !demoAutorizada(pedido, claveDemo)) {
    return new NextResponse('Esta demo pide una contraseña.', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Demo Micaela Massa Odontologia", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }

  const { pathname, search } = pedido.nextUrl;
  const encabezados = new Headers(pedido.headers);
  // Lo pisa siempre: nunca se usa un valor que mande el navegador.
  encabezados.set(ENCABEZADO_RUTA, `${pathname}${search}`);
  const seguir = () => NextResponse.next({ request: { headers: encabezados } });

  if (enDesarrollo() || esPublica(pathname)) return seguir();
  if (COOKIES_DE_SESION.some((nombre) => pedido.cookies.has(nombre))) return seguir();

  if (pedido.method === 'GET' || pedido.method === 'HEAD') {
    const destino = new URL('/ingresar', pedido.url);
    if (pathname !== '/') destino.searchParams.set('volver', `${pathname}${search}`);
    return NextResponse.redirect(destino);
  }
  return new NextResponse('Tenés que ingresar al sistema.', { status: 401, headers: { 'Cache-Control': 'no-store' } });
}

// Sin `matcher`: corre en todos los pedidos, también los archivos estáticos
// (la demo protegida no deja ver nada sin la contraseña).
