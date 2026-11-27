import { baseDeDatos } from '@/db/client';
import { almacenDelSistema } from '@/server/entorno';
import { ErrorDePermiso } from '@/server/errores';
import { leerAdjuntoClinico } from '@/server/hc/adjuntos';
import { datosDelPedido, usuarioActual } from '@/server/sesion';

const texto = (estado: number, mensaje: string) =>
  new Response(mensaje, { status: estado, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

/**
 * Ver (`?descargar=1` para descargar) un adjunto clínico. Solo profesionales;
 * cada vez queda en la auditoría. Antes de entregarlo se comprueba que el
 * archivo siga teniendo la huella que se firmó. Nunca queda en cachés.
 */
export async function GET(pedido: Request, { params }: { params: Promise<{ id: string; adjuntoId: string }> }) {
  const { id, adjuntoId } = await params;
  const descargar = new URL(pedido.url).searchParams.get('descargar') === '1';
  try {
    const lectura = await leerAdjuntoClinico(
      await baseDeDatos(),
      almacenDelSistema(),
      await usuarioActual(),
      { pacienteId: id, adjuntoId, modo: descargar ? 'descargar' : 'ver' },
      await datosDelPedido(),
    );
    if (lectura.estado === 'no_existe') return texto(404, 'No se encontró el archivo.');
    if (lectura.estado === 'alterado') return texto(409, 'El archivo guardado no coincide con la huella que se firmó: no se muestra. Avisá a la administración.');
    const nombreAscii = lectura.nombre.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'archivo';
    return new Response(Buffer.from(lectura.bytes), {
      headers: {
        'Content-Type': lectura.tipo,
        'Content-Length': String(lectura.bytes.byteLength),
        'Content-Disposition': `${descargar ? 'attachment' : 'inline'}; filename="${nombreAscii}"; filename*=UTF-8''${encodeURIComponent(lectura.nombre)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (error instanceof ErrorDePermiso) return texto(403, 'La historia clínica solo la ven los profesionales.');
    throw error;
  }
}
