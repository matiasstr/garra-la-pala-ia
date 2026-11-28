import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DIAS_HABILES_CON_TURNOS } from '@/db/semilla';
import { permiteReiniciarDemo } from '@/server/demo';
import { reiniciarDatosDePruebaAccion } from './acciones';
import { BotonReiniciar } from './BotonReiniciar';

export const metadata: Metadata = { title: 'Reiniciar datos de prueba · Micaela Massa Odontología' };

// Las variables se leen en cada pedido, nunca al compilar.
export const dynamic = 'force-dynamic';

/** Solo en la demo (MODO_DESARROLLO=1 y DEMO_PERMITE_REINICIO=1); si no, la página no existe. */
export default function PaginaDemo() {
  if (!permiteReiniciarDemo()) notFound();

  return (
    <main className="contenedor">
      <header className="encabezado">
        <div>
          <h1>Reiniciar datos de prueba</h1>
          <span className="suave">Versión de prueba con datos inventados</span>
        </div>
      </header>

      <section className="tarjeta pila" style={{ maxWidth: 640 }}>
        <p style={{ margin: 0 }}>
          Borra todo lo que se cargó en la prueba (pacientes, turnos, fotos y notas) y vuelve a los datos inventados del principio, con turnos para hoy y los
          próximos {DIAS_HABILES_CON_TURNOS} días hábiles.
        </p>
        <p style={{ margin: 0 }}>Sirve cuando pasaron unos días y la agenda quedó vacía, o para empezar una prueba desde cero.</p>
        <p className="suave" style={{ margin: 0 }}>
          Tarda unos segundos. Si otra persona está usando la prueba en ese momento, va a ver los datos nuevos cuando recargue la página.
        </p>
        <BotonReiniciar accion={reiniciarDatosDePruebaAccion} />
      </section>
    </main>
  );
}
