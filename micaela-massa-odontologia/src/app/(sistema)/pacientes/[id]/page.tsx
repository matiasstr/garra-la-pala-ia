import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui/Avatar';
import { EstadoDeTurno, EtiquetasPaciente, SinAcceso } from '@/components/ui/Etiquetas';
import { FormularioAccion } from '@/components/ui/FormularioAccion';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { capitalizar, fechaDe, formatoFechaCorta, formatoFechaLarga, formatoHora } from '@/lib/fechas';
import { fichaPaciente, listarFinanciadores, type TurnoDePaciente } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';
import { actualizarContactoAccion, agregarCoberturaAccion, agregarNotaAccion } from '../acciones';
import { SubirFoto } from './SubirFoto';

export const metadata: Metadata = { title: 'Ficha del paciente · Micaela Massa Odontología' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nuevo?: string }>;
}

export default async function PaginaFicha({ params, searchParams }: Props) {
  const [{ id }, { nuevo }] = await Promise.all([params, searchParams]);
  const usuario = await usuarioActual();
  if (!puede(usuario, 'paciente.ver_ficha')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no tiene acceso a los pacientes." />
      </main>
    );
  }
  if (!UUID.test(id)) notFound();
  const db = await baseDeDatos();
  const [ficha, financiadores] = await Promise.all([fichaPaciente(db, usuario, id), listarFinanciadores(db)]);
  if (!ficha) notFound();
  const { paciente } = ficha;
  const cobertura = ficha.coberturas.find((c) => !c.vigenteHasta);

  return (
    <main className="contenedor pila" style={{ gap: 16 }}>
      {nuevo && (
        <div className="aviso ok" role="status">
          Paciente cargado. Si está en el consultorio, sacale una foto: ayuda a no confundirlo con otro.
        </div>
      )}

      {/* Ficha del paciente (zona administrativa) */}
      <section className="tarjeta cabecera-paciente" aria-label="Datos del paciente">
        <div className="pila" style={{ gap: 8, alignItems: 'center' }}>
          <Avatar pacienteId={paciente.id} nombre={paciente.nombre} apellido={paciente.apellido} fotoKey={paciente.fotoKey} tamanio={96} />
          {ficha.puedeEditar && <SubirFoto pacienteId={paciente.id} tieneFoto={Boolean(paciente.fotoKey)} />}
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1>
            {paciente.apellido}, {paciente.nombre}
          </h1>
          <div className="datos-cortos">
            <span>{paciente.edad} años</span>
            <span>
              {paciente.tipoDocumento} {paciente.numeroDocumento}
            </span>
            <span>Nació el {formatoFechaCorta(paciente.fechaNacimiento)}</span>
            {cobertura && (
              <span>
                {cobertura.financiador}
                {cobertura.plan ? ` ${cobertura.plan}` : ''}
                {cobertura.numeroAfiliado ? ` · N.º ${cobertura.numeroAfiliado}` : ''}
              </span>
            )}
            {ficha.ausencias > 0 && <span>{ficha.ausencias === 1 ? 'Faltó 1 vez' : `Faltó ${ficha.ausencias} veces`}</span>}
          </div>
          <EtiquetasPaciente alertas={ficha.alertas.map((a) => a.descripcion)} homonimos={ficha.homonimos.length} />
          {ficha.homonimos.length > 0 && (
            <p className="suave" style={{ fontSize: '0.88rem', marginBottom: 0 }}>
              No confundir con:{' '}
              {ficha.homonimos.map((h, i) => (
                <span key={h.id}>
                  {i > 0 && ', '}
                  <Link href={`/pacientes/${h.id}`}>
                    {h.apellido}, {h.nombre}
                  </Link>{' '}
                  (DNI {h.documento}, nació el {formatoFechaCorta(h.fechaNacimiento)})
                </span>
              ))}
            </p>
          )}
        </div>
        {ficha.puedeDarTurnos && (
          <Link className="boton primario" href={`/agenda/nuevo?paciente=${paciente.id}`}>
            Dar turno
          </Link>
        )}
      </section>

      <div className="columnas">
        <div className="pila" style={{ gap: 16 }}>
          <section className="tarjeta" aria-labelledby="titulo-contacto">
            <h2 id="titulo-contacto">Contacto</h2>
            {ficha.puedeEditar ? (
              <FormularioAccion accion={actualizarContactoAccion.bind(null, paciente.id)} textoBoton="Guardar contacto">
                <div className="fila-campos">
                  <label className="campo">
                    <span>Celular</span>
                    <input type="tel" name="telefono" defaultValue={paciente.telefono ?? ''} />
                  </label>
                  <label className="campo">
                    <span>Email</span>
                    <input type="email" name="email" defaultValue={paciente.email ?? ''} />
                  </label>
                </div>
                <label className="casilla">
                  <input type="checkbox" name="aceptaMensajes" value="si" defaultChecked={paciente.aceptaMensajes} />
                  <span>
                    Acepta recordatorios por WhatsApp
                    {paciente.aceptaMensajes && paciente.aceptaMensajesEn && (
                      <>
                        <br />
                        <span className="suave">Desde el {formatoFechaCorta(fechaDe(paciente.aceptaMensajesEn))}</span>
                      </>
                    )}
                  </span>
                </label>
              </FormularioAccion>
            ) : (
              <ul className="lista-simple">
                <li>Celular: {paciente.telefono ?? '—'}</li>
                <li>Email: {paciente.email ?? '—'}</li>
                <li>Recordatorios por WhatsApp: {paciente.aceptaMensajes ? 'sí' : 'no'}</li>
              </ul>
            )}
          </section>

          <section className="tarjeta" aria-labelledby="titulo-coberturas">
            <h2 id="titulo-coberturas">Coberturas</h2>
            <ul className="lista-simple">
              {ficha.coberturas.map((c) => (
                <li key={c.id}>
                  <strong>{c.financiador}</strong>
                  {c.plan ? ` · plan ${c.plan}` : ''}
                  {c.numeroAfiliado ? ` · N.º ${c.numeroAfiliado}` : ''}
                  <span className="suave"> · desde {formatoFechaCorta(c.vigenteDesde)}</span>
                </li>
              ))}
            </ul>
            {ficha.puedeEditar && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: 'pointer', minHeight: 32 }}>Agregar cobertura</summary>
                <div style={{ marginTop: 12 }}>
                  <FormularioAccion accion={agregarCoberturaAccion.bind(null, paciente.id)} textoBoton="Agregar" reiniciarAlGuardar>
                    <div className="fila-campos">
                      <label className="campo">
                        <span>Cobertura</span>
                        <select name="financiadorId">
                          {financiadores.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="campo">
                        <span>N.º de afiliado</span>
                        <input type="text" name="numeroAfiliado" />
                      </label>
                      <label className="campo">
                        <span>Plan</span>
                        <input type="text" name="plan" />
                      </label>
                    </div>
                  </FormularioAccion>
                </div>
              </details>
            )}
          </section>

          <section className="tarjeta" aria-labelledby="titulo-notas">
            <h2 id="titulo-notas">Notas administrativas</h2>
            <p className="suave" style={{ fontSize: '0.85rem', marginTop: -6 }}>
              Para organizar la atención. No son historia clínica: no anotes acá datos de salud.
            </p>
            {ficha.notas.length > 0 && (
              <ul className="lista-simple" style={{ marginBottom: 12 }}>
                {ficha.notas.map((n) => (
                  <li key={n.id}>
                    {n.texto}
                    <div className="suave" style={{ fontSize: '0.8rem' }}>
                      {n.autor} · {formatoFechaCorta(fechaDe(n.creadoEn))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {ficha.puedeAgregarNotas && (
              <FormularioAccion accion={agregarNotaAccion.bind(null, paciente.id)} textoBoton="Agregar nota" reiniciarAlGuardar>
                <label className="campo">
                  <span className="visualmente-oculto">Nota</span>
                  <textarea name="texto" maxLength={1000} placeholder="Ej.: Prefiere turnos a la tarde" />
                </label>
              </FormularioAccion>
            )}
          </section>
        </div>

        <div className="pila" style={{ gap: 16 }}>
          <section className="tarjeta" aria-labelledby="titulo-turnos">
            <h2 id="titulo-turnos">Próximos turnos</h2>
            <ListaTurnos turnos={ficha.proximosTurnos} vacio="No tiene turnos dados." />
            <h2 style={{ marginTop: 20 }}>Historial de turnos</h2>
            <ListaTurnos turnos={ficha.historialTurnos} vacio="Todavía no tuvo turnos." />
          </section>

          {/* Historia clínica: zona separada, solo profesionales */}
          <section className="zona-clinica" aria-labelledby="titulo-hc">
            <div className="etiqueta-zona" id="titulo-hc">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 10V8a6 6 0 1 1 12 0v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1Zm2 0h8V8a4 4 0 1 0-8 0v2Z" fill="currentColor" />
              </svg>
              Historia clínica
            </div>
            {ficha.puedeVerHistoriaClinica ? (
              <div className="pila" style={{ gap: 8 }}>
                <p style={{ margin: 0 }}>Evoluciones firmadas, odontograma y adjuntos. Cada apertura queda registrada.</p>
                <div>
                  <Link className="boton primario" href={`/pacientes/${paciente.id}/historia-clinica`}>
                    Abrir historia clínica
                  </Link>
                </div>
              </div>
            ) : (
              <p style={{ margin: 0 }}>Solo la ven los profesionales. Tu usuario no tiene acceso al contenido clínico.</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function ListaTurnos({ turnos, vacio }: { turnos: TurnoDePaciente[]; vacio: string }) {
  if (!turnos.length) return <p className="suave">{vacio}</p>;
  return (
    <ul className="lista-simple">
      {turnos.map((t) => (
        <li key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <span>
            <Link href={`/agenda?fecha=${fechaDe(t.inicio)}`}>{capitalizar(formatoFechaLarga(fechaDe(t.inicio)))}</Link>
            , {formatoHora(t.inicio)}
            <div className="suave" style={{ fontSize: '0.85rem' }}>
              {t.profesional}
              {t.motivo ? ` · ${t.motivo}` : ''}
            </div>
          </span>
          <EstadoDeTurno estado={t.estado} />
        </li>
      ))}
    </ul>
  );
}
