import { NOMBRE_PLAZO, PLAZOS_REGRESO, frasePlazo, type PlazoRegreso } from '@/domain/seguimiento/regreso';
import { fechaDe, formatoFechaCorta, formatoHora } from '@/lib/fechas';

interface PropsPregunta {
  /** Acción del servidor que guarda la indicación (`registrarRegresoAccion`). */
  accion: (datos: FormData) => Promise<void>;
  pacienteId: string;
  /** Turno atendido al que corresponde (si hay). */
  turnoId?: string | null;
  volverA: 'agenda' | 'ficha';
  /** Agenda: a qué día y filtro volver. */
  fecha?: string;
  filtroProfesional?: string;
  /** Profesional que lo indicó, si ya se sabe (en la agenda, la del turno). */
  profesionalId?: string | null;
  /** En la ficha se elige quién lo indicó. */
  profesionales?: { id: string; nombre: string; apellido: string }[];
  /** Texto chico debajo del título, por ejemplo para qué visita es. */
  aclaracion?: string;
}

/**
 * "¿Cuándo debería volver?" con pocos toques: cada plazo es un botón que
 * guarda al tocarlo. "Es importante que vuelva" se marca antes.
 */
export function PreguntaRegreso({ accion, pacienteId, turnoId, volverA, fecha, filtroProfesional, profesionalId, profesionales, aclaracion }: PropsPregunta) {
  return (
    <form action={accion} className="pregunta-regreso">
      <input type="hidden" name="pacienteId" value={pacienteId} />
      <input type="hidden" name="volverA" value={volverA} />
      {turnoId && <input type="hidden" name="turnoId" value={turnoId} />}
      {fecha && <input type="hidden" name="fecha" value={fecha} />}
      {filtroProfesional && <input type="hidden" name="profesional" value={filtroProfesional} />}
      {!profesionales && profesionalId && <input type="hidden" name="profesionalId" value={profesionalId} />}
      <fieldset>
        <legend>¿Cuándo debería volver?</legend>
        {aclaracion && <p className="suave aclaracion">{aclaracion}</p>}
        {profesionales && (
          <label className="campo">
            <span>Lo indicó</span>
            <select name="profesionalId" defaultValue={profesionalId ?? profesionales[0]?.id}>
              {profesionales.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} {p.apellido}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="casilla">
          <input type="checkbox" name="importante" value="si" />
          <span>
            Es importante que vuelva <span className="suave">(marcalo antes de elegir)</span>
          </span>
        </label>
        <div className="botones-plazo">
          {PLAZOS_REGRESO.map((plazo) => (
            <button key={plazo} type="submit" name="plazo" value={plazo} className="boton chico">
              {NOMBRE_PLAZO[plazo]}
            </button>
          ))}
        </div>
      </fieldset>
    </form>
  );
}

export interface DatosRegreso {
  plazo: PlazoRegreso;
  importante: boolean;
  fechaVisita: string;
  fechaEsperada: string | null;
  indicadaPor: string;
  cargadaPor: string;
  creadoEn: Date;
}

/** "Vuelve en 2 semanas (hacia el 10/12/2026) · Importante · Lo indicó… · Lo cargó…" */
export function ResumenRegreso({ indicacion, conVisita = false }: { indicacion: DatosRegreso; conVisita?: boolean }) {
  return (
    <div className="resumen-regreso">
      <strong>{frasePlazo(indicacion.plazo)}</strong>
      {indicacion.fechaEsperada && <span> (hacia el {formatoFechaCorta(indicacion.fechaEsperada)})</span>}
      {indicacion.importante && <span className="etiqueta importante">Es importante que vuelva</span>}
      <div className="suave quien-regreso">
        {conVisita && `Visita del ${formatoFechaCorta(indicacion.fechaVisita)} · `}
        Lo indicó {indicacion.indicadaPor} · Lo cargó {indicacion.cargadaPor} el {formatoFechaCorta(fechaDe(indicacion.creadoEn))} a las {formatoHora(indicacion.creadoEn)}
      </div>
    </div>
  );
}
