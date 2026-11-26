import type { Metadata } from 'next';
import Link from 'next/link';
import { Avatar } from '@/components/ui/Avatar';
import { EtiquetasPaciente, SinAcceso } from '@/components/ui/Etiquetas';
import { FormularioAccion } from '@/components/ui/FormularioAccion';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { enlaceWhatsAppSeguimiento } from '@/domain/seguimiento/mensajes';
import { NOMBRE_TIPO_PENDIENTE, TIPOS_PENDIENTE, type TipoPendiente } from '@/domain/seguimiento/reglas';
import {
  CANALES_CONTACTO,
  INTENTOS_HASTA_NO_RESPONDE,
  NOMBRE_CANAL,
  NOMBRE_ESTADO_PENDIENTE,
  NOMBRE_PRIORIDAD,
  NOMBRE_RESPUESTA,
  RESPUESTAS_CONTACTO,
} from '@/domain/seguimiento/tablero';
import { formatoFechaCorta, hoyEnArgentina, sumarDias } from '@/lib/fechas';
import { listarPendientes, type FiltroVer, type PendienteTablero } from '@/server/pendientes';
import { recalcularEnEstePedido } from '@/server/pendientes-al-dia';
import { usuarioActual } from '@/server/sesion';
import { descartarPendienteAccion, registrarContactoAccion, resolverPendienteAccion, tomarPendienteAccion } from './acciones';

export const metadata: Metadata = { title: 'Pendientes · Micaela Massa Odontología' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  searchParams: Promise<{ ver?: string; motivo?: string; paciente?: string }>;
}

const hace = (dias: number) => (dias <= 0 ? 'hoy' : dias === 1 ? 'ayer' : `hace ${dias} días`);

export default async function PaginaPendientes({ searchParams }: Props) {
  const parametros = await searchParams;
  const usuario = await usuarioActual();
  if (!puede(usuario, 'seguimientos.gestionar')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="El tablero de pendientes lo usan las secretarias y las profesionales. Tu usuario no hace el seguimiento de pacientes." />
      </main>
    );
  }

  // Al abrir el tablero se recalcula: aparecen los que vencieron y se resuelven los que sacaron turno.
  await recalcularEnEstePedido();
  const ver: FiltroVer = parametros.ver === 'mios' ? 'mios' : 'todos';
  const motivo = TIPOS_PENDIENTE.find((t) => t === parametros.motivo) ?? null;
  const pacienteId = parametros.paciente && UUID.test(parametros.paciente) ? parametros.paciente : null;
  const tablero = await listarPendientes(await baseDeDatos(), usuario, { ver, tipo: motivo, pacienteId });
  const hoy = hoyEnArgentina();
  const paraMi = tablero.paraHoy.filter((p) => p.paraMi).length;
  const paciente = pacienteId ? (tablero.paraHoy[0] ?? tablero.masAdelante[0])?.paciente : null;

  const enlace = (cambios: { ver?: FiltroVer; motivo?: TipoPendiente | null }) => {
    const nuevoVer = cambios.ver ?? ver;
    const nuevoMotivo = cambios.motivo === undefined ? motivo : cambios.motivo;
    const query = new URLSearchParams({
      ...(nuevoVer === 'mios' ? { ver: 'mios' } : {}),
      ...(nuevoMotivo ? { motivo: nuevoMotivo } : {}),
      ...(pacienteId ? { paciente: pacienteId } : {}),
    }).toString();
    return query ? `/pendientes?${query}` : '/pendientes';
  };

  return (
    <main className="contenedor">
      <header className="encabezado">
        <div>
          <h1>Pendientes</h1>
          <span className="suave">
            {tablero.paraHoy.length === 1 ? '1 para hoy' : `${tablero.paraHoy.length} para hoy`}
            {tablero.masAdelante.length > 0 && ` · ${tablero.masAdelante.length} más adelante`} · Bandeja común: el que tomás queda a tu nombre.
          </span>
        </div>
      </header>

      {paciente && (
        <div className="aviso atencion" role="status" style={{ marginBottom: 16 }}>
          Mostrando los pendientes de {paciente.apellido}, {paciente.nombre}. <Link href="/pendientes">Ver todos</Link>
        </div>
      )}
      {paraMi > 0 && (
        <div className="aviso error" role="status" style={{ marginBottom: 16 }}>
          {paraMi === 1
            ? 'Te llegó 1 paciente importante que no responde. Está primero en la lista.'
            : `Te llegaron ${paraMi} pacientes importantes que no responden. Están primeros en la lista.`}
        </div>
      )}

      <nav className="filtros-pendientes" aria-label="Filtros">
        <div className="filtro-grupo" role="group" aria-label="De quién">
          <Link className="boton chico" href={enlace({ ver: 'todos' })} aria-current={ver === 'todos' ? 'true' : undefined}>
            Todos
          </Link>
          <Link className="boton chico" href={enlace({ ver: 'mios' })} aria-current={ver === 'mios' ? 'true' : undefined}>
            Míos
          </Link>
        </div>
        <div className="filtro-grupo" role="group" aria-label="Motivo">
          <Link className="boton chico" href={enlace({ motivo: null })} aria-current={!motivo ? 'true' : undefined}>
            Todos los motivos
          </Link>
          {TIPOS_PENDIENTE.filter((t) => tablero.porTipo[t] > 0 || t === motivo).map((t) => (
            <Link key={t} className="boton chico" href={enlace({ motivo: t })} aria-current={motivo === t ? 'true' : undefined}>
              {NOMBRE_TIPO_PENDIENTE[t]} <span className="cantidad">{tablero.porTipo[t]}</span>
            </Link>
          ))}
        </div>
      </nav>

      <section aria-labelledby="titulo-hoy" className="tarjeta lista-pendientes">
        <h2 id="titulo-hoy">Para hoy</h2>
        {tablero.paraHoy.length === 0 ? (
          <p className="suave">{ver === 'mios' ? 'No tenés pendientes para hoy.' : 'No hay pendientes para hoy.'}</p>
        ) : (
          tablero.paraHoy.map((p) => <TarjetaPendiente key={p.id} p={p} hoy={hoy} usuarioId={usuario.id} />)
        )}
      </section>

      {tablero.masAdelante.length > 0 && (
        <details className="tarjeta lista-pendientes mas-adelante">
          <summary>
            <h2>Más adelante ({tablero.masAdelante.length})</h2>
            <span className="suave">Los que pidieron que los contactemos otro día.</span>
          </summary>
          {tablero.masAdelante.map((p) => (
            <TarjetaPendiente key={p.id} p={p} hoy={hoy} usuarioId={usuario.id} />
          ))}
        </details>
      )}
    </main>
  );
}

function TarjetaPendiente({ p, hoy, usuarioId }: { p: PendienteTablero; hoy: string; usuarioId: string }) {
  const { paciente } = p;
  const whatsapp = paciente.telefono && paciente.aceptaMensajes ? enlaceWhatsAppSeguimiento({ telefono: paciente.telefono, nombrePaciente: paciente.nombre, tipo: p.tipo }) : null;
  const esMio = p.responsable?.id === usuarioId;
  const ultimo = p.ultimoContacto;

  return (
    <article
      id={`pendiente-${p.id}`}
      className={`pendiente prioridad-${p.prioridad}${p.paraMi ? ' para-mi' : ''}`}
      aria-label={`${paciente.apellido}, ${paciente.nombre}: ${NOMBRE_TIPO_PENDIENTE[p.tipo]}`}
    >
      <div className="pendiente-foto">
        <Avatar pacienteId={paciente.id} nombre={paciente.nombre} apellido={paciente.apellido} fotoKey={paciente.fotoKey} />
      </div>
      <div className="pendiente-cuerpo">
        <div className="pendiente-paciente">
          <Link href={`/pacientes/${paciente.id}`}>
            {paciente.apellido}, {paciente.nombre}
          </Link>{' '}
          <span className="suave">
            · {paciente.edad} años · {paciente.documento}
          </span>
        </div>
        <EtiquetasPaciente homonimos={paciente.homonimos} />
        <div className="etiquetas">
          <span className="etiqueta motivo">{NOMBRE_TIPO_PENDIENTE[p.tipo]}</span>
          <span className={`etiqueta prioridad prioridad-${p.prioridad}`}>{NOMBRE_PRIORIDAD[p.prioridad]}</span>
          {p.importante && <span className="etiqueta importante">Es importante que vuelva</span>}
          {p.estado !== 'en_curso' && <span className={`etiqueta estado-pendiente-${p.estado}`}>{NOMBRE_ESTADO_PENDIENTE[p.estado]}</span>}
          {p.paraMi ? (
            <span className="etiqueta para-mi">Te llegó a vos</span>
          ) : (
            p.estado === 'no_responde' && p.escaladoA && <span className="etiqueta">Le llegó a {p.escaladoA.nombre}</span>
          )}
        </div>
        <p className="pendiente-detalle">{p.detalle}</p>
        <ul className="pendiente-datos">
          <li>Pendiente {hace(p.diasPendiente)}</li>
          <li>
            {ultimo
              ? `Último contacto ${hace(p.diasSinContacto)} por ${NOMBRE_CANAL[ultimo.canal ?? 'llamada']}: ${NOMBRE_RESPUESTA[ultimo.respuesta ?? 'no_contesta'].toLowerCase()}`
              : p.diasSinContacto > 0
                ? `Sin contacto ${hace(p.diasSinContacto)}`
                : 'Todavía sin contacto'}
          </li>
          <li>
            {p.intentos === 0 ? 'Sin intentos' : p.intentos === 1 ? '1 intento' : `${p.intentos} intentos`}
            {p.intentosSinRespuesta > 0 && ` · ${p.intentosSinRespuesta} de ${INTENTOS_HASTA_NO_RESPONDE} sin respuesta`}
          </li>
          <li>{p.responsable ? `Responsable: ${p.responsable.nombre}${esMio ? ' (vos)' : ''}` : 'Sin responsable'}</li>
          {p.contactarDesde > hoy && (
            <li>
              Volver a contactar el {formatoFechaCorta(p.contactarDesde)}
              {p.contactarDesdeMotivo ? `: ${p.contactarDesdeMotivo}` : ''}
            </li>
          )}
          {ultimo?.resultado && <li className="nota-contacto">“{ultimo.resultado}”</li>}
        </ul>

        <div className="pendiente-acciones">
          {!esMio && (
            <form action={tomarPendienteAccion}>
              <input type="hidden" name="pendienteId" value={p.id} />
              <button type="submit" className="boton chico primario">
                {p.responsable ? 'Tomarlo yo' : 'Tomar'}
              </button>
            </form>
          )}
          <Link className="boton chico" href={`/agenda/nuevo?paciente=${paciente.id}`}>
            Dar turno
          </Link>
          {whatsapp ? (
            <a className="boton chico" href={whatsapp} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
          ) : (
            <span className="suave sin-whatsapp">{paciente.telefono ? 'Sin permiso para mensajes' : 'Sin teléfono'}</span>
          )}
          <details className="desplegable">
            <summary className="boton chico">Registrar contacto</summary>
            <FormularioAccion accion={registrarContactoAccion.bind(null, p.id)} textoBoton="Guardar contacto" etiqueta={`Registrar contacto con ${paciente.nombre} ${paciente.apellido}`}>
              <fieldset className="opciones">
                <legend>¿Por dónde?</legend>
                {CANALES_CONTACTO.map((c) => (
                  <label key={c} className="opcion">
                    <input type="radio" name="canal" value={c} defaultChecked={c === (whatsapp ? 'whatsapp' : 'llamada')} />
                    <span>{NOMBRE_CANAL[c]}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="opciones">
                <legend>¿Qué pasó?</legend>
                {RESPUESTAS_CONTACTO.map((r) => (
                  <label key={r} className="opcion">
                    <input type="radio" name="respuesta" value={r} required />
                    <span>{NOMBRE_RESPUESTA[r]}</span>
                  </label>
                ))}
              </fieldset>
              <label className="campo">
                <span>Qué dijo (opcional, sin datos de salud)</span>
                <input type="text" name="resultado" maxLength={500} placeholder="Ej.: Cobra el 10, llamarlo después" />
              </label>
              <div className="fila-campos">
                <label className="campo">
                  <span>Volver a contactar el (opcional)</span>
                  <input type="date" name="contactarDesde" min={hoy} max={sumarDias(hoy, 366)} />
                </label>
                <label className="campo">
                  <span>Por qué esa fecha</span>
                  <input type="text" name="contactarDesdeMotivo" maxLength={200} placeholder="Ej.: Cobra el 10" />
                </label>
              </div>
            </FormularioAccion>
          </details>
          <details className="desplegable">
            <summary className="boton chico">Cerrar</summary>
            <div className="pila">
              <FormularioAccion accion={resolverPendienteAccion.bind(null, p.id)} textoBoton="Marcar resuelto" etiqueta="Marcar resuelto">
                <label className="campo">
                  <span>Nota (opcional)</span>
                  <input type="text" name="nota" maxLength={300} placeholder="Ej.: Ya vino, avisó que viene el lunes" />
                </label>
              </FormularioAccion>
              <FormularioAccion accion={descartarPendienteAccion.bind(null, p.id)} textoBoton="Descartar" etiqueta="Descartar">
                <label className="campo">
                  <span>Por qué se descarta</span>
                  <input type="text" name="motivo" maxLength={300} required placeholder="Ej.: Se mudó, se atiende en otro lado" />
                </label>
              </FormularioAccion>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}
