'use client';

import { startTransition, useActionState, useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { EtiquetasPaciente } from '@/components/ui/Etiquetas';
import { ESTADO_INICIAL } from '@/components/ui/estado-formulario';
import type { PacienteListado } from '@/server/pacientes';
import { buscarPacientesParaTurno, guardarTurnoAccion } from '../acciones';

interface Props {
  profesionales: { id: string; nombre: string; apellido: string }[];
  sillones: { id: string; nombre: string }[];
  duraciones: readonly number[];
  inicial: {
    fecha: string;
    hora: string;
    duracionMinutos: number;
    profesionalId?: string;
    sillonId?: string | null;
    motivo?: string | null;
    paciente?: PacienteListado | null;
    reprogramaA?: string;
  };
}

export function FormularioTurno({ profesionales, sillones, duraciones, inicial }: Props) {
  const [estado, despachar, pendiente] = useActionState(guardarTurnoAccion, ESTADO_INICIAL);
  const [paciente, setPaciente] = useState<PacienteListado | null>(inicial.paciente ?? null);
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<PacienteListado[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    let vigente = true;
    setBuscando(true);
    const espera = setTimeout(async () => {
      const encontrados = await buscarPacientesParaTurno(busqueda);
      if (vigente) {
        setResultados(encontrados);
        setBuscando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [busqueda]);

  const reprogramando = Boolean(inicial.reprogramaA);

  return (
    <form
      className="pila"
      onSubmit={(evento) => {
        evento.preventDefault();
        const datos = new FormData(evento.currentTarget);
        startTransition(() => despachar(datos));
      }}
    >
      {inicial.reprogramaA && <input type="hidden" name="reprogramaA" value={inicial.reprogramaA} />}
      <input type="hidden" name="pacienteId" value={paciente?.id ?? ''} />

      <fieldset className="tarjeta pila" style={{ margin: 0 }}>
        <legend style={{ fontWeight: 600, padding: '0 4px' }}>Paciente</legend>
        {paciente ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <Avatar pacienteId={paciente.id} nombre={paciente.nombre} apellido={paciente.apellido} fotoKey={paciente.fotoKey} tamanio={56} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <strong>
                {paciente.apellido}, {paciente.nombre}
              </strong>
              <div className="suave">
                {paciente.edad} años · {paciente.documento}
              </div>
              <EtiquetasPaciente homonimos={paciente.homonimos} />
            </div>
            {!reprogramando && (
              <button type="button" className="boton chico" onClick={() => setPaciente(null)}>
                Cambiar
              </button>
            )}
          </div>
        ) : (
          <div className="selector-paciente">
            <label className="campo">
              <span>Buscar por nombre, apellido o DNI</span>
              <input type="search" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoComplete="off" placeholder="Ej.: perez juan o 30123456" autoFocus />
            </label>
            {busqueda.trim().length >= 2 && (
              <ul className="resultados-busqueda" aria-live="polite">
                {resultados.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => setPaciente(p)}>
                      <Avatar pacienteId={p.id} nombre={p.nombre} apellido={p.apellido} fotoKey={p.fotoKey} tamanio={36} />
                      <span>
                        <strong>
                          {p.apellido}, {p.nombre}
                        </strong>{' '}
                        <span className="suave">
                          · {p.edad} años · {p.documento}
                        </span>
                        {p.homonimos > 0 && (
                          <>
                            <br />
                            <EtiquetasPaciente homonimos={p.homonimos} />
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
                {!buscando && resultados.length === 0 && (
                  <li className="suave" style={{ padding: 8 }}>
                    No se encontró. <a href="/pacientes/nuevo">Cargar paciente nuevo</a>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </fieldset>

      <div className="fila-campos">
        <label className="campo">
          <span>Profesional</span>
          <select name="profesionalId" defaultValue={inicial.profesionalId ?? profesionales[0]?.id} required>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} {p.apellido}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Sillón</span>
          <select name="sillonId" defaultValue={inicial.sillonId ?? ''}>
            <option value="">Sin asignar</option>
            {sillones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="fila-campos">
        <label className="campo">
          <span>Fecha</span>
          <input type="date" name="fecha" defaultValue={inicial.fecha} required />
        </label>
        <label className="campo">
          <span>Hora</span>
          <input type="time" name="hora" defaultValue={inicial.hora} step={900} required />
        </label>
        <label className="campo">
          <span>Duración</span>
          <select name="duracionMinutos" defaultValue={String(inicial.duracionMinutos)}>
            {duraciones.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} minutos` : d === 60 ? '1 hora' : `${d / 60} horas`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!reprogramando && (
        <label className="campo">
          <span>Motivo (sin datos clínicos detallados)</span>
          <input type="text" name="motivo" defaultValue={inicial.motivo ?? ''} maxLength={200} placeholder="Ej.: Control, Primera consulta, Endodoncia 2.ª sesión" />
        </label>
      )}

      {estado.errores.length > 0 && (
        <div className="aviso error" role="alert">
          {estado.errores.length === 1 ? estado.errores[0] : <ul>{estado.errores.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      <div>
        <button type="submit" className="boton primario" disabled={pendiente || !paciente}>
          {pendiente ? 'Guardando…' : reprogramando ? 'Reprogramar turno' : 'Guardar turno'}
        </button>
      </div>
    </form>
  );
}
