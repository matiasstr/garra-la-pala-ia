import Link from 'next/link';

const MODULOS = [
  {
    titulo: 'Historia clínica',
    texto: 'Evoluciones firmadas e inalterables, encadenadas por hash. Solo profesionales.',
    estado: 'Modelo de datos y firma listos',
  },
  {
    titulo: 'Odontograma',
    texto: 'Notación FDI, cinco caras, rojo a realizar y azul realizado. Se ve a cualquier fecha.',
    estado: 'Demo táctil disponible',
    enlace: '/odontograma',
  },
  {
    titulo: 'Roles y permisos',
    texto: 'Secretaria, profesional (con especialidades) y administrador, combinables.',
    estado: 'Reglas listas',
  },
  {
    titulo: 'Agenda y pendientes',
    texto: 'Turnos con historial de estados y avisos de pacientes que se pueden perder.',
    estado: 'Reglas listas, pantallas por hacer',
  },
];

export default function Inicio() {
  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Micaela Massa Odontología</h1>
        <span className="suave">Sistema de gestión · Versión 1 en construcción</span>
      </header>
      <section className="grilla-modulos" aria-label="Módulos">
        {MODULOS.map((m) => (
          <article key={m.titulo} className="tarjeta">
            <h2>{m.enlace ? <Link href={m.enlace}>{m.titulo}</Link> : m.titulo}</h2>
            <p>{m.texto}</p>
            <p className="suave" style={{ marginTop: 8 }}>
              {m.estado}
            </p>
          </article>
        ))}
      </section>
    </main>
  );
}
