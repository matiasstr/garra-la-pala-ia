'use client';

import { useId, useState } from 'react';
import { LARGO_MAXIMO_TEXTO_CLINICO, validarTextoClinico } from '@/domain/historia-clinica/registros';
import { firmarEnmiendaAccion } from './acciones';
import { DialogoFirma, type FirmaDisponible, type PacienteParaFirmar } from './DialogoFirma';

/** Enmienda de un registro propio: queda como un registro nuevo vinculado, el original no cambia. */
export function Enmendar({ paciente, firma, registroId, secuencia }: { paciente: PacienteParaFirmar; firma: FirmaDisponible; registroId: string; secuencia: number }) {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const idTexto = useId();

  return (
    <details className="enmendar" open={abierto} onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary>Agregar una enmienda</summary>
      <div className="pila" style={{ marginTop: 8 }}>
        <label className="campo" htmlFor={idTexto}>
          <span>Qué se corrige o se aclara</span>
          <textarea id={idTexto} value={texto} maxLength={LARGO_MAXIMO_TEXTO_CLINICO} onChange={(e) => setTexto(e.target.value)} rows={3} />
        </label>
        <div>
          <DialogoFirma
            paciente={paciente}
            firma={firma}
            textoBoton="Firmar enmienda"
            validar={() => validarTextoClinico(texto)}
            resumen={
              <>
                <strong>Enmienda al registro N.º {secuencia}</strong>
                <p className="texto-firmado">{texto.trim()}</p>
              </>
            }
            firmar={(pin) => firmarEnmiendaAccion(paciente.id, registroId, { texto, pin })}
            alFirmar={() => {
              setTexto('');
              setAbierto(false);
            }}
          />
        </div>
      </div>
    </details>
  );
}
