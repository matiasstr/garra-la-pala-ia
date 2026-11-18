'use client';

import { startTransition, useActionState, useEffect, useRef } from 'react';
import { ESTADO_INICIAL, type AccionFormulario } from './estado-formulario';

interface Props {
  accion: AccionFormulario;
  textoBoton: string;
  children: React.ReactNode;
  /** Vacía el formulario después de guardar (por ejemplo, una nota nueva). */
  reiniciarAlGuardar?: boolean;
  etiqueta?: string;
}

/**
 * Formulario que llama a una acción del servidor, muestra los errores y no
 * pierde lo escrito si algo falla.
 */
export function FormularioAccion({ accion, textoBoton, children, reiniciarAlGuardar = false, etiqueta }: Props) {
  const [estado, despachar, pendiente] = useActionState(accion, ESTADO_INICIAL);
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok && reiniciarAlGuardar) formulario.current?.reset();
  }, [estado, reiniciarAlGuardar]);

  return (
    <form
      ref={formulario}
      className="pila"
      aria-label={etiqueta}
      onSubmit={(evento) => {
        evento.preventDefault();
        const datos = new FormData(evento.currentTarget, (evento.nativeEvent as SubmitEvent).submitter);
        startTransition(() => despachar(datos));
      }}
    >
      {children}
      {estado.errores.length > 0 && (
        <div className="aviso error" role="alert">
          {estado.errores.length === 1 ? estado.errores[0] : <ul>{estado.errores.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
      {estado.ok && estado.mensaje && (
        <div className="aviso ok" role="status">
          {estado.mensaje}
        </div>
      )}
      <div>
        <button type="submit" className="boton primario" disabled={pendiente}>
          {pendiente ? 'Guardando…' : textoBoton}
        </button>
      </div>
    </form>
  );
}
