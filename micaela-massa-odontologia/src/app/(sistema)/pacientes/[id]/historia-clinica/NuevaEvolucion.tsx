'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LARGO_MAXIMO_TEXTO_CLINICO, validarTextoClinico } from '@/domain/historia-clinica/registros';
import { formatoHora } from '@/lib/fechas';
import { descartarBorradorAccion, firmarEvolucionAccion, guardarBorradorAccion } from './acciones';
import { DialogoFirma, type FirmaDisponible, type PacienteParaFirmar } from './DialogoFirma';

/** Espera después de la última tecla para guardar el borrador solo. */
const ESPERA_AUTOGUARDADO_MS = 2000;

interface Props {
  paciente: PacienteParaFirmar;
  firma: FirmaDisponible;
  borrador: { texto: string; guardadoEn: string | null };
  especialidades: { valor: string; nombre: string }[];
  turno: { id: string; descripcion: string } | null;
}

type EstadoGuardado = { tipo: 'guardado'; en: string | null } | { tipo: 'sin_guardar' } | { tipo: 'guardando' } | { tipo: 'error'; texto: string };

export function NuevaEvolucion({ paciente, firma, borrador, especialidades, turno }: Props) {
  const [texto, setTexto] = useState(borrador.texto);
  const [especialidad, setEspecialidad] = useState(especialidades[0]?.valor ?? '');
  const [guardado, setGuardado] = useState<EstadoGuardado>({ tipo: 'guardado', en: borrador.guardadoEn });
  const [aviso, setAviso] = useState<string | null>(null);
  const ultimoGuardado = useRef(borrador.texto);
  const idTexto = useId();

  async function guardar(valor: string) {
    if (valor === ultimoGuardado.current) return;
    setGuardado({ tipo: 'guardando' });
    const resultado = await guardarBorradorAccion(paciente.id, valor);
    if (resultado.ok) {
      ultimoGuardado.current = valor;
      setGuardado({ tipo: 'guardado', en: resultado.guardadoEn });
    } else {
      setGuardado({ tipo: 'error', texto: resultado.errores.join(' ') });
    }
  }

  // Autoguardado: el borrador no se pierde si se cierra la pestaña o se corta la luz.
  useEffect(() => {
    if (texto === ultimoGuardado.current) return;
    setGuardado({ tipo: 'sin_guardar' });
    const espera = setTimeout(() => void guardar(texto), ESPERA_AUTOGUARDADO_MS);
    return () => clearTimeout(espera);
  }, [texto]);

  // Si quedó algo sin guardar, el navegador pregunta antes de salir.
  useEffect(() => {
    if (texto === ultimoGuardado.current) return;
    const avisar = (evento: BeforeUnloadEvent) => evento.preventDefault();
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [texto, guardado]);

  const estadoTexto =
    guardado.tipo === 'guardando'
      ? 'Guardando borrador…'
      : guardado.tipo === 'sin_guardar'
        ? 'Cambios sin guardar'
        : guardado.tipo === 'error'
          ? guardado.texto
          : guardado.en
            ? `Borrador guardado a las ${formatoHora(new Date(guardado.en))}`
            : '';

  return (
    <div className="pila">
      <label className="campo" htmlFor={idTexto}>
        <span>Qué se hizo y qué se indicó</span>
        <textarea
          id={idTexto}
          className="texto-evolucion"
          value={texto}
          maxLength={LARGO_MAXIMO_TEXTO_CLINICO}
          onChange={(e) => {
            setTexto(e.target.value);
            setAviso(null);
          }}
          onBlur={() => void guardar(texto)}
          placeholder="Ej.: Obturación de la 36 oclusal con resina. Sin complicaciones. Control en 6 meses."
          rows={5}
        />
      </label>
      <div className="fila-evolucion">
        <span className="suave estado-borrador" role="status" aria-live="polite" style={guardado.tipo === 'error' ? { color: 'var(--rojo)' } : undefined}>
          {estadoTexto}
        </span>
        {especialidades.length > 1 && (
          <label className="campo campo-en-linea">
            <span>Especialidad</span>
            <select value={especialidad} onChange={(e) => setEspecialidad(e.target.value)}>
              {especialidades.map((e) => (
                <option key={e.valor} value={e.valor}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {turno && <p className="suave nota-turno">Queda vinculada al turno: {turno.descripcion}</p>}
      {aviso && (
        <div className="aviso ok" role="status">
          {aviso}
        </div>
      )}
      <div className="herramientas" style={{ marginBottom: 0 }}>
        <DialogoFirma
          paciente={paciente}
          firma={firma}
          textoBoton="Firmar evolución"
          validar={() => validarTextoClinico(texto)}
          resumen={
            <>
              <strong>Evolución</strong>
              <p className="texto-firmado">{texto.trim()}</p>
            </>
          }
          firmar={(pin) => firmarEvolucionAccion(paciente.id, { texto, pin, turnoId: turno?.id ?? null, especialidad: especialidad || null })}
          alFirmar={(estado) => {
            ultimoGuardado.current = '';
            setTexto('');
            setGuardado({ tipo: 'guardado', en: null });
            setAviso(estado.mensaje ?? 'Evolución firmada.');
          }}
        />
        <button type="button" className="boton" disabled={!texto.trim() || guardado.tipo === 'guardando'} onClick={() => void guardar(texto)}>
          Guardar borrador
        </button>
        <button
          type="button"
          className="boton"
          disabled={!texto && !ultimoGuardado.current}
          onClick={async () => {
            if (!window.confirm('¿Descartar el borrador? Se pierde lo escrito.')) return;
            const resultado = await descartarBorradorAccion(paciente.id);
            if (!resultado.ok) {
              setGuardado({ tipo: 'error', texto: resultado.errores.join(' ') });
              return;
            }
            ultimoGuardado.current = '';
            setTexto('');
            setGuardado({ tipo: 'guardado', en: null });
            setAviso('Borrador descartado.');
          }}
        >
          Descartar borrador
        </button>
      </div>
    </div>
  );
}
