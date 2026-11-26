import { NOMBRE_TIPO_REGISTRO, tamanioLegible } from '@/domain/historia-clinica/registros';
import { describirMarca } from '@/domain/odontograma/cambios';
import { NOMBRE_ESPECIALIDAD } from '@/domain/permisos/roles';
import { fechaDe, formatoFechaCorta, formatoHora } from '@/lib/fechas';
import type { RegistroParaMostrar, VistaHistoriaClinica } from '@/server/hc/vista';
import type { FirmaDisponible, PacienteParaFirmar } from './DialogoFirma';
import { Enmendar } from './Enmendar';

const cuando = (instante: Date) => `${formatoFechaCorta(fechaDe(instante))} ${formatoHora(instante)}`;

function Firmante({ registro }: { registro: RegistroParaMostrar }) {
  const { firmante } = registro;
  return (
    <div className="hc-firmante">
      {firmante.nombre} {firmante.apellido} · Mat. {firmante.matricula}
      {registro.especialidad ? ` · ${NOMBRE_ESPECIALIDAD[registro.especialidad]}` : ''}
    </div>
  );
}

function Contenido({ registro, pacienteId }: { registro: RegistroParaMostrar; pacienteId: string }) {
  const { contenido } = registro;
  const adjunto = contenido.adjunto;
  return (
    <>
      {contenido.texto && <p className="hc-texto">{contenido.texto}</p>}
      {contenido.marcas.length > 0 && (
        <ul className="hc-marcas">
          {contenido.marcas.map((m) => (
            <li key={m.id}>{describirMarca(m)}</li>
          ))}
        </ul>
      )}
      {adjunto && (
        <div className="hc-adjunto-registro">
          <span className="hc-icono-archivo" aria-hidden="true">
            {adjunto.tipoMime === 'application/pdf' ? 'PDF' : 'IMG'}
          </span>
          <span>
            {adjunto.nombreOriginal} · {tamanioLegible(adjunto.bytes)}
            {adjunto.pieza ? ` · pieza ${adjunto.pieza}` : ''}
            <br />
            <span className="suave hc-huella" title={adjunto.sha256}>
              SHA-256 {adjunto.sha256.slice(0, 16)}…
            </span>
          </span>
          {registro.adjuntoCoincide ? (
            <a className="boton chico" href={`/pacientes/${pacienteId}/historia-clinica/adjuntos/${adjunto.id}`} target="_blank" rel="noopener">
              Ver
            </a>
          ) : (
            <span className="etiqueta alerta">El archivo no coincide con lo firmado</span>
          )}
        </div>
      )}
    </>
  );
}

interface Props {
  vista: VistaHistoriaClinica;
  paciente: PacienteParaFirmar;
  firma: FirmaDisponible;
  puedeEnmendar: boolean;
}

export function LineaDeTiempo({ vista, paciente, firma, puedeEnmendar }: Props) {
  if (!vista.lineaDeTiempo.length) {
    return <p className="suave">Todavía no hay nada firmado en esta historia clínica.</p>;
  }
  return (
    <ol className="hc-linea">
      {vista.lineaDeTiempo.map(({ registro, enmiendas, corrige }) => (
        <li key={registro.id} id={`registro-${registro.secuencia}`} className={`hc-registro tipo-${registro.tipo}`}>
          <article aria-label={`Registro N.º ${registro.secuencia}: ${NOMBRE_TIPO_REGISTRO[registro.tipo]}`}>
            <header className="hc-registro-encabezado">
              <span className="hc-tipo">{NOMBRE_TIPO_REGISTRO[registro.tipo]}</span>
              <time dateTime={registro.firmadoEn.toISOString()}>{cuando(registro.firmadoEn)}</time>
              <span className="suave hc-numero">N.º {registro.secuencia}</span>
            </header>
            <Firmante registro={registro} />
            {corrige && (
              <p className="hc-corrige">
                Corrige el <a href={`#registro-${corrige.secuencia}`}>registro N.º {corrige.secuencia}</a> del {cuando(corrige.firmadoEn)}.
              </p>
            )}
            <Contenido registro={registro} pacienteId={vista.paciente.id} />
            {enmiendas.length > 0 && (
              <div className="hc-enmiendas">
                <strong>{enmiendas.length === 1 ? 'Tiene una enmienda' : `Tiene ${enmiendas.length} enmiendas`}</strong>
                <ul>
                  {enmiendas.map((e) => (
                    <li key={e.id}>
                      <a href={`#registro-${e.secuencia}`}>N.º {e.secuencia}</a> del {cuando(e.firmadoEn)}: {e.contenido.texto}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <footer className="hc-pie">
              <span className="suave hc-huella" title={`Huella del registro: ${registro.hash}`}>
                Firmado electrónicamente · huella {registro.hash.slice(0, 12)}…
              </span>
              {puedeEnmendar && registro.propio && registro.tipo !== 'enmienda' && (
                <Enmendar paciente={paciente} firma={firma} registroId={registro.id} secuencia={registro.secuencia} />
              )}
            </footer>
          </article>
        </li>
      ))}
    </ol>
  );
}
