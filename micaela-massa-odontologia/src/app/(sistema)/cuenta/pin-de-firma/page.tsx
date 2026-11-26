import type { Metadata } from 'next';
import Link from 'next/link';
import { SinAcceso } from '@/components/ui/Etiquetas';
import { FormularioAccion } from '@/components/ui/FormularioAccion';
import { baseDeDatos } from '@/db/client';
import { LARGO_MAXIMO_PIN, LARGO_MINIMO_PIN, MAXIMO_INTENTOS_PIN, MINUTOS_BLOQUEO_PIN } from '@/domain/firma/pin';
import { puedeFirmarRegistroClinico } from '@/domain/permisos/permisos';
import { fechaDe, formatoFechaCorta, formatoHora } from '@/lib/fechas';
import { estadoPinDeFirma } from '@/server/hc/pin';
import { usuarioActual } from '@/server/sesion';
import { guardarPinAccion } from './acciones';

export const metadata: Metadata = { title: 'PIN de firma · Micaela Massa Odontología' };

/** Solo se vuelve a pantallas de la propia app (nunca a otro sitio). */
const VOLVER_VALIDO = /^\/pacientes\/[0-9a-f-]{36}\/historia-clinica$/i;

const propsPin = { type: 'password', inputMode: 'numeric', pattern: '[0-9]*', autoComplete: 'off', minLength: LARGO_MINIMO_PIN, maxLength: LARGO_MAXIMO_PIN, required: true } as const;

export default async function PaginaPinDeFirma({ searchParams }: { searchParams: Promise<{ volver?: string }> }) {
  const { volver } = await searchParams;
  const usuario = await usuarioActual();
  const volverA = volver && VOLVER_VALIDO.test(volver) ? volver : null;

  if (!puedeFirmarRegistroClinico(usuario)) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="El PIN de firma es solo para profesionales con matrícula: es lo que se pide para firmar en la historia clínica." />
      </main>
    );
  }
  const estado = await estadoPinDeFirma(await baseDeDatos(), usuario);

  return (
    <main className="contenedor pila pin-de-firma" style={{ gap: 16 }}>
      <header className="encabezado" style={{ marginBottom: 0 }}>
        <h1>PIN de firma</h1>
        {volverA && <Link href={volverA}>Volver a la historia clínica</Link>}
      </header>

      <section className="tarjeta pila" aria-labelledby="titulo-que-es">
        <h2 id="titulo-que-es">Qué es</h2>
        <p style={{ margin: 0 }}>
          Es un número que solo vos sabés y que escribís cada vez que firmás algo en la historia clínica: una evolución, un cambio en el odontograma o un archivo
          adjunto. Es distinto de la contraseña con la que entrás al sistema.
        </p>
        <ul className="lista-simple">
          <li>
            Tiene de {LARGO_MINIMO_PIN} a {LARGO_MAXIMO_PIN} números. No uses números todos iguales ni seguidos (como 1111 o 1234).
          </li>
          <li>El sistema no lo guarda: guarda solo una huella cifrada. Nadie puede verlo, ni la administración.</li>
          <li>
            Si te equivocás {MAXIMO_INTENTOS_PIN} veces seguidas, se bloquea {MINUTOS_BLOQUEO_PIN} minutos.
          </li>
          <li>Si te lo olvidás, pedile a la administración que lo restablezca y creá uno nuevo.</li>
        </ul>
      </section>

      <section className="tarjeta pila" aria-labelledby="titulo-pin">
        <h2 id="titulo-pin">{estado.tienePin ? 'Cambiar tu PIN de firma' : 'Crear tu PIN de firma'}</h2>
        {estado.tienePin ? (
          <p className="suave" style={{ margin: 0 }}>
            Ya tenés un PIN de firma{estado.actualizadoEn ? `, creado o cambiado el ${formatoFechaCorta(fechaDe(estado.actualizadoEn))}` : ''}.
          </p>
        ) : (
          <p className="aviso atencion" style={{ margin: 0 }}>
            Todavía no tenés PIN de firma: sin él no podés firmar en la historia clínica.
          </p>
        )}
        {estado.bloqueadoHasta && (
          <div className="aviso error" role="alert">
            Tu PIN está bloqueado hasta las {formatoHora(estado.bloqueadoHasta)} por demasiados intentos fallidos.
          </div>
        )}
        <FormularioAccion accion={guardarPinAccion} textoBoton={estado.tienePin ? 'Cambiar PIN' : 'Crear PIN'} reiniciarAlGuardar etiqueta="PIN de firma">
          <div className="fila-campos">
            {estado.tienePin && (
              <label className="campo">
                <span>PIN actual</span>
                <input name="actual" {...propsPin} />
              </label>
            )}
            <label className="campo">
              <span>PIN nuevo</span>
              <input name="nuevo" {...propsPin} />
            </label>
            <label className="campo">
              <span>Repetí el PIN nuevo</span>
              <input name="repeticion" {...propsPin} />
            </label>
          </div>
        </FormularioAccion>
      </section>
    </main>
  );
}
