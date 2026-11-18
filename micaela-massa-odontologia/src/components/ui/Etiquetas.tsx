import { NOMBRE_ESTADO_TURNO, type EstadoTurno } from '@/domain/agenda/turnos';

export function EstadoDeTurno({ estado }: { estado: EstadoTurno }) {
  return <span className={`estado estado-${estado}`}>{NOMBRE_ESTADO_TURNO[estado]}</span>;
}

/** Alertas médicas y aviso de homónimos: lo que evita confundir o dañar a un paciente. */
export function EtiquetasPaciente({ alertas = [], homonimos = 0 }: { alertas?: readonly string[]; homonimos?: number }) {
  if (!alertas.length && !homonimos) return null;
  return (
    <span className="etiquetas">
      {alertas.map((alerta) => (
        <span key={alerta} className="etiqueta alerta">
          <span aria-hidden="true">!</span> {alerta}
        </span>
      ))}
      {homonimos > 0 && (
        <span className="etiqueta homonimo">
          {homonimos === 1 ? 'Hay otro paciente con el mismo nombre' : `Hay ${homonimos} pacientes más con el mismo nombre`}
        </span>
      )}
    </span>
  );
}

export function SinAcceso({ mensaje }: { mensaje: string }) {
  return (
    <div className="aviso atencion" role="alert">
      {mensaje}
    </div>
  );
}
