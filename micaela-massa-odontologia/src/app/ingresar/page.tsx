import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { baseDeDatos } from '@/db/client';
import { CLAVE_DE_PRUEBA } from '@/db/acceso-de-prueba';
import { modoDesarrollo } from '@/server/entorno';
import { pasoDeIngreso, rutaInterna } from '@/server/sesion';
import { cargarUsuario } from '@/server/usuarios';
import { FormularioClave, FormularioCodigo } from './Formularios';

export const metadata: Metadata = { title: 'Ingresar · Micaela Massa Odontología', robots: { index: false } };
export const dynamic = 'force-dynamic';

const AVISOS: Record<string, { clase: 'ok' | 'atencion'; texto: string }> = {
  salio: { clase: 'ok', texto: 'Saliste del sistema.' },
  sesion: { clase: 'atencion', texto: 'Tu sesión se cerró (por tiempo sin uso o desde otra computadora). Ingresá de nuevo.' },
  paso_vencido: { clase: 'atencion', texto: 'Pasó mucho tiempo. Escribí de nuevo tu email y tu contraseña.' },
  bloqueado: { clase: 'atencion', texto: 'Hubo demasiados intentos fallidos. Esperá unos minutos y probá de nuevo.' },
};

export default async function PaginaIngresar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametros = await searchParams;
  const volver = rutaInterna(typeof parametros.volver === 'string' ? parametros.volver : null);
  const motivo = typeof parametros.motivo === 'string' ? parametros.motivo : parametros.salio ? 'salio' : null;
  const aviso = motivo ? AVISOS[motivo] : undefined;

  const paso = await pasoDeIngreso();
  if (paso?.paso === 'activa') redirect(volver);
  const usuario = paso?.paso === 'falta_codigo' ? await cargarUsuario(await baseDeDatos(), paso.usuarioId) : null;

  return (
    <main className="pantalla-acceso">
      <div className="tarjeta tarjeta-acceso pila">
        <div>
          <p className="marca-acceso">Micaela Massa Odontología</p>
          <h1>{usuario ? 'Verificación en dos pasos' : 'Ingresar'}</h1>
        </div>
        {aviso && !usuario && (
          <div className={`aviso ${aviso.clase}`} role="status">
            {aviso.texto}
          </div>
        )}
        {usuario ? <FormularioCodigo nombre={usuario.nombre} volver={volver} /> : <FormularioClave volver={volver} />}
        {!usuario && <p className="suave nota-acceso">¿Te olvidaste la contraseña o cambiaste de celular? Pedile a quien administra el consultorio que te la blanquee.</p>}
        {modoDesarrollo() && (
          <div className="aviso atencion nota-acceso">
            <strong>Modo de prueba.</strong> Usuarios: mica@consultorio.local, laura@consultorio.local o sofia@consultorio.local, contraseña{' '}
            <code>{CLAVE_DE_PRUEBA}</code>. El código sale de la clave de prueba del README. O <Link href="/agenda">seguí con el selector de usuario</Link>.
          </div>
        )}
      </div>
    </main>
  );
}
