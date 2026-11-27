import { revalidatePath } from 'next/cache';
import { baseDeDatos } from '@/db/client';
import { puede, puedeFirmarRegistroClinico } from '@/domain/permisos/permisos';
import { almacenDelSistema } from '@/server/entorno';
import { ErrorDePermiso, ErrorDeValidacion } from '@/server/errores';
import { TAMANIO_MAXIMO_ADJUNTO, subirAdjuntoClinico } from '@/server/hc/adjuntos';
import { datosDelPedido, usuarioActual } from '@/server/sesion';

/**
 * Sube un adjunto clínico y lo firma. Es una ruta y no una acción de servidor
 * porque las acciones aceptan hasta 1 MB y un PDF puede pesar 10. El archivo
 * viaja como cuerpo del pedido, tal cual (sin multipart), y los datos en
 * encabezados. Los errores de validación vuelven con estado 200 y `ok: false`
 * (son mensajes para la pantalla); los de permiso, con 403.
 */
const respuesta = (estado: number, errores: string[]) => Response.json({ ok: false, errores }, { status: estado });

const encabezado = (pedido: Request, nombre: string): string => {
  try {
    return decodeURIComponent(pedido.headers.get(nombre) ?? '');
  } catch {
    return '';
  }
};

export async function POST(pedido: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Solo desde la propia app (además de la cookie de sesión y el PIN).
  const origen = pedido.headers.get('origin');
  const host = pedido.headers.get('x-forwarded-host') ?? pedido.headers.get('host');
  if (!origen || !host || new URL(origen).host !== host) return respuesta(403, ['Pedido no permitido.']);

  const usuario = await usuarioActual();
  if (!puede(usuario, 'adjuntos_clinicos.subir') || !puedeFirmarRegistroClinico(usuario)) {
    return respuesta(403, ['Solo un profesional con matrícula puede adjuntar archivos a la historia clínica.']);
  }
  if (Number(pedido.headers.get('content-length') ?? 0) > TAMANIO_MAXIMO_ADJUNTO) return respuesta(413, ['El archivo pesa más de 10 MB.']);

  const bytes = new Uint8Array(await pedido.arrayBuffer());
  const declarados = Number(pedido.headers.get('x-adjunto-bytes') ?? '');
  if (Number.isFinite(declarados) && declarados > 0 && declarados !== bytes.byteLength) return respuesta(200, ['El archivo no llegó completo. Probá de nuevo.']);
  const pieza = pedido.headers.get('x-adjunto-pieza');

  try {
    const resultado = await subirAdjuntoClinico(
      await baseDeDatos(),
      almacenDelSistema(),
      usuario,
      {
        pacienteId: id,
        bytes,
        nombreOriginal: encabezado(pedido, 'x-adjunto-nombre'),
        descripcion: encabezado(pedido, 'x-adjunto-descripcion'),
        pieza: pieza ? Number(pieza) : null,
        pin: pedido.headers.get('x-pin-firma') ?? '',
        sha256Declarado: pedido.headers.get('x-adjunto-sha256'),
      },
      await datosDelPedido(),
    );
    if (!resultado.ok) return respuesta(200, resultado.errores);
    revalidatePath(`/pacientes/${id}/historia-clinica`);
    return Response.json({ ok: true, errores: [], mensaje: 'Archivo adjuntado y firmado.' });
  } catch (error) {
    if (error instanceof ErrorDePermiso) return respuesta(403, [error.message]);
    if (error instanceof ErrorDeValidacion) return respuesta(200, error.errores);
    throw error;
  }
}
