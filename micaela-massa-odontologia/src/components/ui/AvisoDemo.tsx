import Link from 'next/link';
import { permiteReiniciarDemo } from '@/server/demo';

/** Franja arriba de todo en modo desarrollo o demo: que nadie cargue pacientes reales. */
export function AvisoDemo() {
  return (
    <div className="aviso-demo" role="note">
      <span>
        <strong>Versión de prueba:</strong> datos inventados, no cargar pacientes reales.
      </span>
      {permiteReiniciarDemo() && <Link href="/demo">Reiniciar datos de prueba</Link>}
    </div>
  );
}
