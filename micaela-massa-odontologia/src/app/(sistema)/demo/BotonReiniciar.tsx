'use client';

import { useActionState, useState } from 'react';
import { SIN_ERROR, type EstadoReinicio } from './estado';

interface Props {
  accion: (estado: EstadoReinicio, datos: FormData) => Promise<EstadoReinicio>;
}

/** Botón de reinicio con un segundo paso de confirmación, para no borrar todo sin querer. */
export function BotonReiniciar({ accion }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, despachar, pendiente] = useActionState(accion, SIN_ERROR);

  if (!confirmando) {
    return (
      <div>
        <button type="button" className="boton peligro" onClick={() => setConfirmando(true)}>
          Reiniciar datos de prueba
        </button>
      </div>
    );
  }

  return (
    <form action={despachar} className="confirmar-reinicio pila" aria-label="Confirmar el reinicio">
      <p role="alert" style={{ margin: 0 }}>
        <strong>¿Seguro?</strong> Se borra todo lo que se cargó en la prueba y no se puede deshacer.
      </p>
      {estado.error && (
        <div className="aviso error" role="alert">
          {estado.error}
        </div>
      )}
      <div className="fila-botones">
        <button type="submit" className="boton peligro" disabled={pendiente}>
          {pendiente ? 'Reiniciando… (tarda unos segundos)' : 'Sí, borrar y volver a empezar'}
        </button>
        <button type="button" className="boton" onClick={() => setConfirmando(false)} disabled={pendiente}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
