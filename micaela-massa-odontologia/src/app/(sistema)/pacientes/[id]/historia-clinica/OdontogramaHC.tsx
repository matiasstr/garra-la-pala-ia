'use client';

import { useId, useState } from 'react';
import { EditorOdontograma } from '@/components/odontograma/EditorOdontograma';
import { consolidarCambios, describirMarca } from '@/domain/odontograma/cambios';
import type { MarcaOdontograma } from '@/domain/odontograma/estado';
import type { VistaDenticion } from '@/domain/odontograma/piezas';
import { firmarOdontogramaAccion } from './acciones';
import { DialogoFirma, type FirmaDisponible, type PacienteParaFirmar } from './DialogoFirma';

interface Props {
  paciente: PacienteParaFirmar;
  firma: FirmaDisponible;
  marcas: MarcaOdontograma[];
  vista: VistaDenticion;
  especialidades: { valor: string; nombre: string }[];
}

/** Odontograma de la historia clínica: muestra lo firmado y firma los cambios con PIN. */
export function OdontogramaHC({ paciente, firma, marcas, vista, especialidades }: Props) {
  const [nota, setNota] = useState('');
  const [especialidad, setEspecialidad] = useState(especialidades[0]?.valor ?? '');
  const idNota = useId();

  return (
    <EditorOdontograma
      marcasIniciales={marcas}
      vistaInicial={vista}
      pieDeCambios={(cambios, vaciar) => {
        const aFirmar = consolidarCambios(cambios);
        return (
          <div className="pila" style={{ marginTop: 12 }}>
            {cambios.length > 0 && (
              <div className="fila-campos">
                <label className="campo" htmlFor={idNota}>
                  <span>Nota (opcional)</span>
                  <input id={idNota} type="text" value={nota} maxLength={2000} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: Odontograma inicial" />
                </label>
                {especialidades.length > 1 && (
                  <label className="campo">
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
            )}
            <div className="herramientas" style={{ marginBottom: 0 }}>
              <DialogoFirma
                paciente={paciente}
                firma={firma}
                textoBoton="Firmar cambios"
                deshabilitado={aFirmar.length === 0}
                resumen={
                  <>
                    <strong>
                      {aFirmar.length === 1 ? '1 cambio en el odontograma' : `${aFirmar.length} cambios en el odontograma`}
                      {nota.trim() ? `: ${nota.trim()}` : ''}
                    </strong>
                    <ul className="lista-cambios">
                      {aFirmar.map((m, i) => (
                        <li key={i}>{describirMarca(m)}</li>
                      ))}
                    </ul>
                  </>
                }
                firmar={(pin) => firmarOdontogramaAccion(paciente.id, { marcas: aFirmar, nota, pin, especialidad: especialidad || null })}
                alFirmar={(estado) => {
                  vaciar(estado.mensaje ?? 'Cambios firmados.');
                  setNota('');
                }}
              />
              <button
                type="button"
                className="boton"
                disabled={cambios.length === 0}
                onClick={() => vaciar()}
              >
                Descartar
              </button>
            </div>
          </div>
        );
      }}
    />
  );
}
