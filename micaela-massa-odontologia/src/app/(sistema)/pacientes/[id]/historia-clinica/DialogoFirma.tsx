'use client';

import Link from 'next/link';
import { useId, useRef, useState, useTransition } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import type { EstadoFormulario } from '@/components/ui/estado-formulario';
import { LARGO_MAXIMO_PIN } from '@/domain/firma/pin';

export interface PacienteParaFirmar {
  id: string;
  nombre: string;
  apellido: string;
  documento: string;
  edad: number;
  fotoKey: string | null;
}

export interface FirmaDisponible {
  /** Profesional con matrícula: puede firmar. */
  firma: boolean;
  tienePin: boolean;
  /** ISO 8601 si el PIN está bloqueado por intentos fallidos. */
  bloqueadoHasta: string | null;
}

interface Props {
  paciente: PacienteParaFirmar;
  firma: FirmaDisponible;
  /** "Firmar evolución", "Firmar cambios"... */
  textoBoton: string;
  /** Qué se va a firmar, en pocas palabras. */
  resumen: React.ReactNode;
  deshabilitado?: boolean;
  /** Antes de abrir: devuelve errores si falta algo (por ejemplo, el texto). */
  validar?: () => string[];
  firmar: (pin: string) => Promise<EstadoFormulario>;
  alFirmar?: (estado: EstadoFormulario) => void;
}

/**
 * Confirmación de firma: muestra la foto y el nombre del paciente (para no
 * firmar en la historia clínica equivocada), avisa que lo firmado no se puede
 * modificar y pide el PIN de firma.
 */
export function DialogoFirma({ paciente, firma, textoBoton, resumen, deshabilitado = false, validar, firmar, alFirmar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const entradaPin = useRef<HTMLInputElement>(null);
  const [pin, setPin] = useState('');
  const [errores, setErrores] = useState<string[]>([]);
  const [avisoPrevio, setAvisoPrevio] = useState<string[]>([]);
  const [pendiente, iniciar] = useTransition();
  const idTitulo = useId();
  const idPin = useId();
  const volver = `/pacientes/${paciente.id}/historia-clinica`;

  function abrir() {
    const faltan = validar?.() ?? [];
    setAvisoPrevio(faltan);
    if (faltan.length) return;
    setErrores([]);
    setPin('');
    dialogo.current?.showModal();
    requestAnimationFrame(() => entradaPin.current?.focus());
  }

  function cerrar() {
    setPin('');
    dialogo.current?.close();
  }

  return (
    <>
      <button type="button" className="boton primario" onClick={abrir} disabled={deshabilitado || pendiente}>
        {pendiente ? 'Firmando…' : textoBoton}
      </button>
      {avisoPrevio.length > 0 && (
        <div className="aviso error" role="alert">
          {avisoPrevio.join(' ')}
        </div>
      )}

      <dialog ref={dialogo} className="dialogo-firma" aria-labelledby={idTitulo} onClose={() => setPin('')}>
        <form
          method="dialog"
          className="pila"
          onSubmit={(evento) => {
            evento.preventDefault();
            iniciar(async () => {
              const resultado = await firmar(pin);
              if (resultado.ok) {
                cerrar();
                alFirmar?.(resultado);
              } else {
                setErrores(resultado.errores);
                setPin('');
                entradaPin.current?.focus();
              }
            });
          }}
        >
          <h2 id={idTitulo}>{textoBoton}</h2>
          <div className="confirmar-paciente">
            <Avatar pacienteId={paciente.id} nombre={paciente.nombre} apellido={paciente.apellido} fotoKey={paciente.fotoKey} tamanio={72} />
            <div>
              <span className="suave">Vas a firmar en la historia clínica de</span>
              <strong className="nombre-confirmar">
                {paciente.apellido}, {paciente.nombre}
              </strong>
              <span className="suave">
                {paciente.edad} años · {paciente.documento}
              </span>
            </div>
          </div>
          <div className="resumen-firma">{resumen}</div>
          <p className="aviso atencion" style={{ margin: 0 }}>
            Lo firmado queda en la historia clínica con tu nombre, tu matrícula, la fecha y la hora, y no se puede modificar ni borrar. Si después hay que
            corregir algo, se agrega una enmienda.
          </p>

          {!firma.tienePin ? (
            <p className="aviso error" style={{ margin: 0 }}>
              Para firmar necesitás tu PIN de firma. <Link href={`/cuenta/pin-de-firma?volver=${encodeURIComponent(volver)}`}>Crear mi PIN de firma</Link>
            </p>
          ) : (
            <label className="campo" htmlFor={idPin}>
              <span>Tu PIN de firma</span>
              <input
                id={idPin}
                ref={entradaPin}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={LARGO_MAXIMO_PIN}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                required
                className="entrada-pin"
              />
            </label>
          )}

          {errores.length > 0 && (
            <div className="aviso error" role="alert">
              {errores.join(' ')}
            </div>
          )}

          <div className="herramientas" style={{ marginBottom: 0 }}>
            {firma.tienePin && (
              <button type="submit" className="boton primario" disabled={pendiente || pin.length < 4}>
                {pendiente ? 'Firmando…' : 'Firmar'}
              </button>
            )}
            <button type="button" className="boton" onClick={cerrar} disabled={pendiente}>
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
