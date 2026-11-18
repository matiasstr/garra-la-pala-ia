import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/ui/Avatar';
import { EstadoDeTurno, EtiquetasPaciente, SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { enlaceRecordatorioWhatsApp, esEstadoFinal, puedeCambiarEstado, type EstadoTurno } from '@/domain/agenda/turnos';
import { puede } from '@/domain/permisos/permisos';
import { capitalizar, esFechaValida, formatoFechaLarga, formatoHora, hoyEnArgentina, sumarDias } from '@/lib/fechas';
import { agendaDelDia, type TurnoAgenda } from '@/server/agenda';
import { usuarioActual } from '@/server/sesion';
import { cambiarEstadoAccion } from './acciones';

export const metadata: Metadata = { title: 'Agenda · Micaela Massa Odontología' };

/** Botones que se ofrecen en cada turno, en el orden en que suele avanzar el día. */
const ACCIONES: { estado: EstadoTurno; texto: string }[] = [
  { estado: 'confirmado', texto: 'Confirmó' },
  { estado: 'en_sala', texto: 'Llegó' },
  { estado: 'atendido', texto: 'Atendido' },
  { estado: 'ausente', texto: 'Ausente' },
  { estado: 'cancelado', texto: 'Cancelar' },
];

interface Props {
  searchParams: Promise<{ fecha?: string; profesional?: string; error?: string; aviso?: string }>;
}

export default async function PaginaAgenda({ searchParams }: Props) {
  const parametros = await searchParams;
  const usuario = await usuarioActual();
  if (!puede(usuario, 'turnos.ver')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no tiene acceso a la agenda." />
      </main>
    );
  }

  const hoy = hoyEnArgentina();
  const fecha = parametros.fecha && esFechaValida(parametros.fecha) ? parametros.fecha : hoy;
  const db = await baseDeDatos();
  const todos = await agendaDelDia(db, usuario, fecha);
  const agenda = parametros.profesional ? todos.filter((p) => p.id === parametros.profesional) : todos;
  const gestiona = puede(usuario, 'turnos.gestionar');

  const turnos = agenda.flatMap((p) => p.turnos);
  const contar = (estados: EstadoTurno[]) => turnos.filter((t) => estados.includes(t.estado)).length;
  const cantidad = (estados: EstadoTurno[], singular: string, plural: string) => {
    const n = contar(estados);
    return `${n} ${n === 1 ? singular : plural}`;
  };
  const conProfesional = (f: string) => `/agenda?${new URLSearchParams({ fecha: f, ...(parametros.profesional ? { profesional: parametros.profesional } : {}) })}`;

  return (
    <main className="contenedor">
      <header className="encabezado">
        <div>
          <h1>{capitalizar(formatoFechaLarga(fecha))}</h1>
          <span className="suave">{fecha === hoy ? 'Hoy' : fecha < hoy ? 'Día pasado' : 'Próximamente'}</span>
        </div>
        {gestiona && (
          <Link className="boton primario" href={`/agenda/nuevo?fecha=${fecha}`}>
            Nuevo turno
          </Link>
        )}
      </header>

      <div className="controles-agenda">
        <Link className="boton" href={conProfesional(sumarDias(fecha, -1))} aria-label="Día anterior">
          ←
        </Link>
        <Link className="boton" href={conProfesional(hoy)}>
          Hoy
        </Link>
        <Link className="boton" href={conProfesional(sumarDias(fecha, 1))} aria-label="Día siguiente">
          →
        </Link>
        <form className="controles-agenda" style={{ margin: 0 }} action="/agenda">
          <label className="campo">
            <span>Fecha</span>
            <input type="date" name="fecha" defaultValue={fecha} />
          </label>
          <label className="campo">
            <span>Profesional</span>
            <select name="profesional" defaultValue={parametros.profesional ?? ''}>
              <option value="">Todos</option>
              {todos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} {p.apellido}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="boton">
            Ver
          </button>
        </form>
      </div>

      {parametros.error && (
        <div className="aviso error" role="alert" style={{ marginBottom: 16 }}>
          {parametros.error}
        </div>
      )}
      {parametros.aviso && (
        <div className="aviso ok" role="status" style={{ marginBottom: 16 }}>
          {parametros.aviso}
        </div>
      )}

      <p className="resumen-dia">
        <strong>{cantidad(['reservado', 'confirmado', 'en_sala', 'atendido'], 'turno', 'turnos')}</strong>
        <span>{cantidad(['confirmado'], 'confirmado', 'confirmados')}</span>
        <span>{contar(['en_sala'])} en sala</span>
        <span>{cantidad(['atendido'], 'atendido', 'atendidos')}</span>
        <span>{cantidad(['ausente'], 'ausente', 'ausentes')}</span>
      </p>

      {agenda.map((profesional) => (
        <section key={profesional.id} className="tarjeta agenda-profesional" aria-labelledby={`prof-${profesional.id}`}>
          <h2 id={`prof-${profesional.id}`}>
            {profesional.nombre} {profesional.apellido}
            <span className="suave" style={{ fontWeight: 400, fontSize: '0.88rem' }}>
              {profesional.turnos.length === 0 ? 'Sin turnos' : `${profesional.turnos.length} turnos`}
            </span>
          </h2>
          {profesional.turnos.map((turno) => (
            <Turno key={turno.id} turno={turno} profesional={profesional.nombre} gestiona={gestiona} fecha={fecha} filtro={parametros.profesional} />
          ))}
        </section>
      ))}
    </main>
  );
}

function Turno({ turno, profesional, gestiona, fecha, filtro }: { turno: TurnoAgenda; profesional: string; gestiona: boolean; fecha: string; filtro?: string }) {
  const { paciente } = turno;
  const pendiente = turno.estado === 'reservado' || turno.estado === 'confirmado';
  const whatsapp =
    paciente.telefono && paciente.aceptaMensajes
      ? enlaceRecordatorioWhatsApp({ telefono: paciente.telefono, nombrePaciente: paciente.nombre, inicio: turno.inicio, profesional })
      : null;

  return (
    <article className={`turno${esEstadoFinal(turno.estado) && turno.estado !== 'atendido' ? ' terminado' : ''}`} aria-label={`${formatoHora(turno.inicio)}, ${paciente.nombre} ${paciente.apellido}`}>
      <div className="turno-hora">
        {formatoHora(turno.inicio)}
        <small>a {formatoHora(turno.fin)}</small>
      </div>
      <div className="turno-foto">
        <Avatar pacienteId={paciente.id} nombre={paciente.nombre} apellido={paciente.apellido} fotoKey={paciente.fotoKey} />
      </div>
      <div className="turno-paciente">
        <Link href={`/pacientes/${paciente.id}`}>
          {paciente.apellido}, {paciente.nombre}
        </Link>{' '}
        <span className="suave">
          · {paciente.edad} años · {paciente.documento}
        </span>
      </div>
      <div className="turno-estado">
        <EstadoDeTurno estado={turno.estado} />
      </div>
      <div className="turno-detalle">
        <span>
          {turno.motivo ?? 'Sin motivo cargado'}
          {turno.sillon ? ` · ${turno.sillon}` : ''}
        </span>
        <EtiquetasPaciente alertas={paciente.alertas} homonimos={paciente.homonimos} />
      </div>
      {gestiona && !esEstadoFinal(turno.estado) && (
        <div className="turno-acciones">
          {ACCIONES.filter((a) => puedeCambiarEstado(turno.estado, a.estado)).map((a) => (
            <form key={a.estado} action={cambiarEstadoAccion}>
              <input type="hidden" name="turnoId" value={turno.id} />
              <input type="hidden" name="estado" value={a.estado} />
              <input type="hidden" name="fecha" value={fecha} />
              {filtro && <input type="hidden" name="profesional" value={filtro} />}
              <button type="submit" className="boton chico">
                {a.texto}
              </button>
            </form>
          ))}
          {(pendiente || turno.estado === 'ausente') && (
            <Link className="boton chico" href={`/agenda/nuevo?reprogramar=${turno.id}`}>
              Reprogramar
            </Link>
          )}
          {pendiente &&
            (whatsapp ? (
              <a className="boton chico" href={whatsapp} target="_blank" rel="noopener noreferrer">
                Recordar por WhatsApp
              </a>
            ) : (
              <span className="suave" style={{ fontSize: '0.82rem', alignSelf: 'center' }}>
                {paciente.telefono ? 'Sin permiso para mensajes' : 'Sin teléfono'}
              </span>
            ))}
        </div>
      )}
    </article>
  );
}
