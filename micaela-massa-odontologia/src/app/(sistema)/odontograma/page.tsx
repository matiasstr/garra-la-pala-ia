import type { Metadata } from 'next';
import Link from 'next/link';
import { EditorOdontograma } from '@/components/odontograma/EditorOdontograma';

export const metadata: Metadata = {
  title: 'Odontograma de práctica · Micaela Massa Odontología',
};

export default function PaginaOdontograma() {
  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Odontograma de práctica</h1>
        <span className="suave">Con datos de ejemplo: los cambios no se guardan</span>
      </header>
      <p className="aviso atencion">
        Esta pantalla es para practicar. El odontograma de cada paciente está en su historia clínica: buscalo en <Link href="/pacientes">Pacientes</Link> y
        tocá «Abrir historia clínica».
      </p>
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
