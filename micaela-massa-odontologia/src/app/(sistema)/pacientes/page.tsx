import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/ui/Avatar';
import { EtiquetasPaciente, SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { buscarPacientes } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';

export const metadata: Metadata = { title: 'Pacientes · Micaela Massa Odontología' };

export default async function PaginaPacientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams;
  const usuario = await usuarioActual();
  if (!puede(usuario, 'paciente.ver_ficha')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no tiene acceso a los pacientes." />
      </main>
    );
  }
  const resultados = await buscarPacientes(await baseDeDatos(), usuario, q);

  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Pacientes</h1>
        {puede(usuario, 'paciente.editar_ficha') && (
          <Link className="boton primario" href="/pacientes/nuevo">
            Nuevo paciente
          </Link>
        )}
      </header>

      <form action="/pacientes" role="search" className="controles-agenda">
        <label className="campo" style={{ flex: 1, minWidth: 240 }}>
          <span>Buscar por nombre, apellido o documento</span>
          <input type="search" name="q" defaultValue={q} placeholder="Ej.: perez juan o 30123456" autoFocus />
        </label>
        <button type="submit" className="boton">
          Buscar
        </button>
      </form>

      <section className="tarjeta" aria-label="Resultados">
        <h2 className="suave" style={{ fontWeight: 500 }}>
          {q ? `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'} para “${q}”` : 'Últimos pacientes cargados'}
        </h2>
        {resultados.length === 0 ? (
          <p className="suave">
            No hay pacientes que coincidan.{' '}
            {puede(usuario, 'paciente.editar_ficha') && <Link href="/pacientes/nuevo">Cargar uno nuevo</Link>}
          </p>
        ) : (
          <ul className="lista-pacientes">
            {resultados.map((p) => (
              <li key={p.id}>
                <Link href={`/pacientes/${p.id}`}>
                  <Avatar pacienteId={p.id} nombre={p.nombre} apellido={p.apellido} fotoKey={p.fotoKey} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>
                      <strong>
                        {p.apellido}, {p.nombre}
                      </strong>{' '}
                      <span className="suave">
                        · {p.edad} años · {p.documento}
                      </span>
                    </span>
                    <EtiquetasPaciente homonimos={p.homonimos} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
