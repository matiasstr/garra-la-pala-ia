import { baseDeDatos } from '@/db/client';
import { almacenDelSistema } from '@/server/entorno';
import { ErrorDePermiso } from '@/server/errores';
import { leerFotoPaciente } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';

/** Foto del paciente. Se sirve con control de permisos y nunca queda en cachés compartidas. */
export async function GET(_pedido: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const foto = await leerFotoPaciente(await baseDeDatos(), almacenDelSistema(), await usuarioActual(), id);
    if (!foto) return new Response('Sin foto', { status: 404 });
    return new Response(Buffer.from(foto.bytes), {
      headers: {
        'Content-Type': foto.tipo,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ErrorDePermiso) return new Response('Sin acceso', { status: 403 });
    throw error;
  }
}
