import type { Metadata } from 'next';
import Link from 'next/link';
import { baseDeDatos } from '@/db/client';
import { buscarEnlace } from '@/server/acceso/enlaces';
import { ConfigurarAcceso } from './ConfigurarAcceso';

// El token va en la dirección: que no viaje a otros sitios en el encabezado Referer.
export const metadata: Metadata = { title: 'Configurar tu acceso · Micaela Massa Odontología', referrer: 'no-referrer', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function PaginaConfigurarAcceso({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const enlace = await buscarEnlace(await baseDeDatos(), token);

  return (
    <main className="pantalla-acceso">
      <div className="tarjeta tarjeta-acceso pila">
        <div>
          <p className="marca-acceso">Micaela Massa Odontología</p>
          <h1>{enlace ? `Hola, ${enlace.usuario.nombre}` : 'Enlace vencido'}</h1>
        </div>
        {enlace ? (
          <>
            <p style={{ margin: 0 }}>
              {enlace.motivo === 'primer_ingreso'
                ? 'Vamos a dejar listo tu acceso al sistema del consultorio. Son dos pasos y tardás unos minutos.'
                : enlace.usuario.tieneClave && !enlace.usuario.tieneVerificacion
                  ? 'Vas a configurar de nuevo la verificación en dos pasos, por ejemplo en un celular nuevo.'
                  : 'Elegí una contraseña nueva para entrar al sistema.'}
            </p>
            <ConfigurarAcceso token={token} nombre={enlace.usuario.nombre} email={enlace.usuario.email} tieneClave={enlace.usuario.tieneClave} />
          </>
        ) : (
          <>
            <div className="aviso atencion" role="alert">
              Este enlace ya no sirve: se usó, venció o se generó uno más nuevo. Pedile otro a quien administra el consultorio.
            </div>
            <Link href="/ingresar" className="boton ancho">
              Ir a ingresar
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
