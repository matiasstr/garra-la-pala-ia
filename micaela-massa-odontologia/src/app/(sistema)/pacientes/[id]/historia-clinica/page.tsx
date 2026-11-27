import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Odontograma } from '@/components/odontograma/Odontograma';
import { Avatar } from '@/components/ui/Avatar';
import { EtiquetasPaciente, SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { tamanioLegible } from '@/domain/historia-clinica/registros';
import { calcularOdontograma } from '@/domain/odontograma/estado';
import { puede, puedeFirmarRegistroClinico } from '@/domain/permisos/permisos';
import { NOMBRE_ESPECIALIDAD } from '@/domain/permisos/roles';
import { capitalizar, esFechaValida, fechaDe, formatoFechaCorta, formatoFechaLarga, formatoHora, hoyEnArgentina, rangoDelDia } from '@/lib/fechas';
import { verHistoriaClinica, type VistaHistoriaClinica } from '@/server/hc/vista';
import { datosDelPedido, usuarioActual } from '@/server/sesion';
import type { FirmaDisponible, PacienteParaFirmar } from './DialogoFirma';
import { LineaDeTiempo } from './LineaDeTiempo';
import { NuevaEvolucion } from './NuevaEvolucion';
import { OdontogramaHC } from './OdontogramaHC';
import { SubirAdjunto } from './SubirAdjunto';

export const metadata: Metadata = { title: 'Historia clínica · Micaela Massa Odontología' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fecha?: string; turno?: string }>;
}

function Candado() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 10V8a6 6 0 1 1 12 0v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z" fill="currentColor" />
    </svg>
  );
}

export default async function PaginaHistoriaClinica({ params, searchParams }: Props) {
  const [{ id }, parametros] = await Promise.all([params, searchParams]);
  const usuario = await usuarioActual();
  if (!puede(usuario, 'hc.ver')) {
    return (
      <main className="contenedor pila">
        <SinAcceso mensaje="La historia clínica solo la ven los profesionales. Tu usuario no tiene acceso al contenido clínico." />
        {UUID.test(id) && (
          <p>
            <Link href={`/pacientes/${id}`}>Volver a la ficha del paciente</Link>
          </p>
        )}
      </main>
    );
  }
  if (!UUID.test(id)) notFound();

  const hoy = hoyEnArgentina();
  const fecha = parametros.fecha && esFechaValida(parametros.fecha) && parametros.fecha <= hoy ? parametros.fecha : null;
  const vista = await verHistoriaClinica(await baseDeDatos(), usuario, id, { fecha, turnoId: parametros.turno }, await datosDelPedido());
  if (!vista) notFound();

  const { paciente } = vista;
  const firmaHabilitada = puedeFirmarRegistroClinico(usuario) && puede(usuario, 'hc.registrar') && vista.firma.firma;
  const paraFirmar: PacienteParaFirmar = { id: paciente.id, nombre: paciente.nombre, apellido: paciente.apellido, documento: paciente.documento, edad: paciente.edad, fotoKey: paciente.fotoKey };
  const firma: FirmaDisponible = { firma: firmaHabilitada, tienePin: vista.firma.tienePin, bloqueadoHasta: vista.firma.bloqueadoHasta?.toISOString() ?? null };
  const especialidades = vista.firma.especialidades.map((e) => ({ valor: e, nombre: NOMBRE_ESPECIALIDAD[e] }));
  const base = `/pacientes/${paciente.id}/historia-clinica`;
  const conTurno = (extra: Record<string, string> = {}) => {
    const query = new URLSearchParams({ ...(vista.turno ? { turno: vista.turno.id } : {}), ...extra }).toString();
    return query ? `${base}?${query}` : base;
  };

  return (
    <main className="contenedor">
      <div className="zona-clinica hc">
        <EncabezadoHC vista={vista} />

        <nav className="hc-secciones" aria-label="Secciones de la historia clínica">
          {firmaHabilitada && <a href="#evolucion">Nueva evolución</a>}
          <a href="#odontograma">Odontograma</a>
          <a href="#linea-de-tiempo">Registros ({vista.cantidadRegistros})</a>
          <a href="#adjuntos">Adjuntos ({vista.adjuntos.length})</a>
          <Link href={`/pacientes/${paciente.id}`}>Ficha del paciente</Link>
        </nav>

        <Integridad vista={vista} />

        {firmaHabilitada && !vista.firma.tienePin && (
          <div className="aviso atencion" role="status">
            Para firmar en la historia clínica necesitás un PIN de firma. <Link href={`/cuenta/pin-de-firma?volver=${encodeURIComponent(base)}`}>Crear mi PIN de firma</Link>
          </div>
        )}
        {firmaHabilitada && vista.firma.bloqueadoHasta && (
          <div className="aviso error" role="alert">
            Tu PIN de firma está bloqueado hasta las {formatoHora(vista.firma.bloqueadoHasta)} por demasiados intentos fallidos.
          </div>
        )}
        {!firmaHabilitada && (
          <p className="aviso atencion" style={{ margin: 0 }}>
            Podés leer la historia clínica, pero para escribir en ella hace falta ser profesional con matrícula cargada.
          </p>
        )}

        {firmaHabilitada && (
          <section id="evolucion" className="tarjeta hc-seccion" aria-labelledby="titulo-evolucion">
            <h2 id="titulo-evolucion">Nueva evolución</h2>
            <NuevaEvolucion
              paciente={paraFirmar}
              firma={firma}
              borrador={{ texto: vista.borrador?.texto ?? '', guardadoEn: vista.borrador?.actualizadoEn.toISOString() ?? null }}
              especialidades={especialidades}
              turno={vista.turno ? { id: vista.turno.id, descripcion: `${formatoFechaCorta(fechaDe(vista.turno.inicio))} ${formatoHora(vista.turno.inicio)}${vista.turno.motivo ? ` · ${vista.turno.motivo}` : ''}` } : null}
            />
          </section>
        )}

        <section id="odontograma" className="tarjeta hc-seccion" aria-labelledby="titulo-odontograma">
          <div className="hc-seccion-titulo">
            <h2 id="titulo-odontograma">Odontograma</h2>
            <form className="ver-a-fecha" action={`${base}#odontograma`}>
              {vista.turno && <input type="hidden" name="turno" value={vista.turno.id} />}
              <label className="campo">
                <span>Ver cómo estaba el</span>
                <input type="date" name="fecha" max={hoy} defaultValue={fecha ?? ''} required />
              </label>
              <button type="submit" className="boton">
                Ver a fecha
              </button>
            </form>
          </div>
          {vista.fechasConCambios.length > 0 && (
            <p className="hc-fechas suave">
              Cambios firmados:{' '}
              {vista.fechasConCambios.map((f, i) => (
                <span key={f}>
                  {i > 0 && ', '}
                  <Link href={`${conTurno({ fecha: f })}#odontograma`} aria-current={f === fecha ? 'true' : undefined}>
                    {formatoFechaCorta(f)}
                  </Link>
                </span>
              ))}
            </p>
          )}
          {fecha ? (
            <OdontogramaAFecha vista={vista} fecha={fecha} volver={`${conTurno()}#odontograma`} />
          ) : firmaHabilitada ? (
            <OdontogramaHC paciente={paraFirmar} firma={firma} marcas={vista.marcas} vista={vista.denticion} especialidades={especialidades} />
          ) : (
            <OdontogramaSoloLectura vista={vista} />
          )}
        </section>

        <section id="linea-de-tiempo" className="tarjeta hc-seccion" aria-labelledby="titulo-linea">
          <h2 id="titulo-linea">Registros firmados</h2>
          <LineaDeTiempo vista={vista} paciente={paraFirmar} firma={firma} puedeEnmendar={firmaHabilitada} />
        </section>

        <section id="adjuntos" className="tarjeta hc-seccion" aria-labelledby="titulo-adjuntos">
          <h2 id="titulo-adjuntos">Adjuntos</h2>
          {firmaHabilitada && puede(usuario, 'adjuntos_clinicos.subir') && (
            <details className="hc-subir">
              <summary>Adjuntar radiografía, foto o estudio</summary>
              <div style={{ marginTop: 12 }}>
                <SubirAdjunto paciente={paraFirmar} firma={firma} />
              </div>
            </details>
          )}
          {vista.adjuntos.length === 0 ? (
            <p className="suave">Todavía no hay archivos adjuntos.</p>
          ) : (
            <ul className="hc-adjuntos">
              {vista.adjuntos.map((a) => (
                <li key={a.id}>
                  <span className="hc-icono-archivo" aria-hidden="true">
                    {a.tipoMime === 'application/pdf' ? 'PDF' : 'IMG'}
                  </span>
                  <div className="hc-adjunto-datos">
                    <strong>{a.descripcion ?? a.nombreOriginal}</strong>
                    <span className="suave">
                      {a.pieza ? `Pieza ${a.pieza} · ` : ''}
                      {a.nombreOriginal} · {tamanioLegible(a.bytes)}
                    </span>
                    <span className="suave">
                      {a.subidoPor} · {formatoFechaCorta(fechaDe(a.subidoEn))} {formatoHora(a.subidoEn)}
                    </span>
                  </div>
                  <div className="hc-adjunto-acciones">
                    <a className="boton" href={`${base}/adjuntos/${a.id}`} target="_blank" rel="noopener">
                      Ver
                    </a>
                    <a className="boton" href={`${base}/adjuntos/${a.id}?descargar=1`}>
                      Descargar
                    </a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="suave hc-nota-auditoria">Cada vez que se abre esta historia clínica, o se ve o descarga un adjunto, queda registrado quién lo hizo y cuándo.</p>
        </section>
      </div>
    </main>
  );
}

/** Encabezado fijo: quién es el paciente, siempre a la vista, para no escribir en la historia equivocada. */
function EncabezadoHC({ vista }: { vista: VistaHistoriaClinica }) {
  const { paciente, homonimos } = vista;
  return (
    <header className="hc-encabezado" aria-label="Paciente">
      <Avatar pacienteId={paciente.id} nombre={paciente.nombre} apellido={paciente.apellido} fotoKey={paciente.fotoKey} tamanio={52} />
      <div className="hc-encabezado-datos">
        <div className="etiqueta-zona hc-etiqueta">
          <Candado />
          Historia clínica N.º {vista.historia.numero} · solo profesionales
        </div>
        <h1>
          {paciente.apellido}, {paciente.nombre}
        </h1>
        <div className="datos-cortos">
          <span>{paciente.edad} años</span>
          <span>{paciente.documento}</span>
          <span className="hc-nacimiento">Nació el {formatoFechaCorta(paciente.fechaNacimiento)}</span>
        </div>
        <EtiquetasPaciente alertas={vista.alertas} homonimos={homonimos.length} />
        {homonimos.length > 0 && (
          <p className="hc-homonimo">
            Verificá el documento. No es{' '}
            {homonimos.map((h, i) => (
              <span key={h.id}>
                {i > 0 && ' ni '}
                {h.apellido}, {h.nombre} (DNI {h.documento}, nació el {formatoFechaCorta(h.fechaNacimiento)})
              </span>
            ))}
            .
          </p>
        )}
      </div>
    </header>
  );
}

function Integridad({ vista }: { vista: VistaHistoriaClinica }) {
  if (!vista.integridad.valida) {
    return (
      <div className="aviso error integridad" role="alert">
        <strong>Atención: la historia clínica no pasó la verificación de integridad.</strong> El registro N.º {vista.integridad.secuencia}: {vista.integridad.motivo} No firmes nada
        nuevo y avisá a la administración.
      </div>
    );
  }
  return (
    <p className="integridad integridad-ok" role="status">
      <span aria-hidden="true">✓</span>{' '}
      {vista.cantidadRegistros === 0
        ? 'Historia clínica abierta. Todavía no tiene registros firmados.'
        : `Integridad verificada: ${vista.cantidadRegistros === 1 ? 'el registro está intacto' : `los ${vista.cantidadRegistros} registros están intactos y encadenados`}.`}
    </p>
  );
}

function Leyenda() {
  return (
    <div className="leyenda">
      <span>
        <span className="punto" style={{ background: 'var(--rojo)' }} />A realizar
      </span>
      <span>
        <span className="punto" style={{ background: 'var(--azul)' }} />
        Realizado o preexistente
      </span>
    </div>
  );
}

function OdontogramaAFecha({ vista, fecha, volver }: { vista: VistaHistoriaClinica; fecha: string; volver: string }) {
  const hasta = new Date(rangoDelDia(fecha).hasta.getTime() - 1);
  const estado = calcularOdontograma(vista.marcas, hasta);
  return (
    <div className="pila">
      <div className="aviso atencion" role="status">
        Así estaba el odontograma el {capitalizar(formatoFechaLarga(fecha))} de {fecha.slice(0, 4)}, con lo firmado hasta ese día. <Link href={volver}>Volver a hoy</Link>
      </div>
      <div className="tarjeta desplazable" style={{ padding: 8 }}>
        <Odontograma vista={vista.denticion} estado={estado} />
      </div>
      <Leyenda />
    </div>
  );
}

function OdontogramaSoloLectura({ vista }: { vista: VistaHistoriaClinica }) {
  return (
    <div className="pila">
      <div className="tarjeta desplazable" style={{ padding: 8 }}>
        <Odontograma vista={vista.denticion} estado={calcularOdontograma(vista.marcas)} />
      </div>
      <Leyenda />
    </div>
  );
}
