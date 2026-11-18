import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { turnos } from '@/db/schema';
import { puede } from '@/domain/permisos/permisos';
import { esFechaValida, fechaDe, formatoFechaLarga, formatoHora, hoyEnArgentina } from '@/lib/fechas';
import { DURACIONES_MINUTOS, listarSillones } from '@/server/agenda';
import { fichaPaciente, type PacienteListado } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';
import { listarProfesionales } from '@/server/usuarios';
import { FormularioTurno } from './FormularioTurno';

export const metadata: Metadata = { title: 'Nuevo turno · Micaela Massa Odontología' };

interface Props {
  searchParams: Promise<{ fecha?: string; paciente?: string; reprogramar?: string }>;
}

export default async function PaginaNuevoTurno({ searchParams }: Props) {
  const parametros = await searchParams;
  const usuario = await usuarioActual();
  if (!puede(usuario, 'turnos.gestionar')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no puede dar turnos." />
      </main>
    );
  }

  const db = await baseDeDatos();
  const [profesionales, sillones] = await Promise.all([listarProfesionales(db), listarSillones(db)]);
  // Si quien da el turno es profesional, se propone su propia agenda.
  const profesionalPorDefecto = profesionales.some((p) => p.id === usuario.id) ? usuario.id : undefined;

  const resumenPaciente = async (id: string): Promise<PacienteListado | null> => {
    const ficha = await fichaPaciente(db, usuario, id);
    if (!ficha) return null;
    const { paciente } = ficha;
    return {
      id: paciente.id,
      nombre: paciente.nombre,
      apellido: paciente.apellido,
      documento: `${paciente.tipoDocumento} ${paciente.numeroDocumento}`,
      edad: paciente.edad,
      fotoKey: paciente.fotoKey,
      homonimos: ficha.homonimos.length,
    };
  };

  // Reprogramar: se parte del turno original.
  if (parametros.reprogramar) {
    const [original] = await db.select().from(turnos).where(eq(turnos.id, parametros.reprogramar));
    if (!original) {
      return (
        <main className="contenedor">
          <SinAcceso mensaje="El turno a reprogramar no existe." />
        </main>
      );
    }
    return (
      <main className="contenedor">
        <header className="encabezado">
          <div>
            <h1>Reprogramar turno</h1>
            <span className="suave">
              Turno original: {formatoFechaLarga(fechaDe(original.inicio))}, {formatoHora(original.inicio)}
              {original.motivo ? ` · ${original.motivo}` : ''}
            </span>
          </div>
          <Link href={`/agenda?fecha=${fechaDe(original.inicio)}`}>Volver a la agenda</Link>
        </header>
        <FormularioTurno
          profesionales={profesionales}
          sillones={sillones}
          duraciones={DURACIONES_MINUTOS}
          inicial={{
            fecha: hoyEnArgentina(),
            hora: formatoHora(original.inicio),
            duracionMinutos: Math.round((original.fin.getTime() - original.inicio.getTime()) / 60_000),
            profesionalId: original.profesionalId,
            sillonId: original.sillonId,
            motivo: original.motivo,
            paciente: await resumenPaciente(original.pacienteId),
            reprogramaA: original.id,
          }}
        />
      </main>
    );
  }

  const fecha = parametros.fecha && esFechaValida(parametros.fecha) ? parametros.fecha : hoyEnArgentina();
  const paciente = parametros.paciente ? await resumenPaciente(parametros.paciente) : null;

  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Nuevo turno</h1>
        <Link href={`/agenda?fecha=${fecha}`}>Volver a la agenda</Link>
      </header>
      <FormularioTurno
        profesionales={profesionales}
        sillones={sillones}
        duraciones={DURACIONES_MINUTOS}
        inicial={{ fecha, hora: '09:00', duracionMinutos: 30, paciente, profesionalId: profesionalPorDefecto }}
      />
    </main>
  );
}
