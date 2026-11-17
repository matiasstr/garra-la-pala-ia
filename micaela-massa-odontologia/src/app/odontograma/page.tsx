import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorOdontograma } from '@/components/odontograma/EditorOdontograma';

export const metadata: Metadata = {
  title: 'Odontograma · Micaela Massa Odontología',
};

export default function PaginaOdontograma() {
  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Odontograma</h1>
        <Link href="/">Volver al inicio</Link>
      </header>
      <section className="zona-clinica" aria-label="Historia clínica">
        <div className="etiqueta-zona">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 10V8a6 6 0 1 1 12 0v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z" fill="currentColor" />
          </svg>
          Historia clínica · solo profesionales
        </div>
        <EditorOdontograma />
      </section>
    </main>
  );
}
