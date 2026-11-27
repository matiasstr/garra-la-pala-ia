'use client';

import { startTransition, useActionState, useMemo, useState } from 'react';
import { EnlaceParaPasar } from '@/components/acceso/EnlaceParaPasar';
import { accionSobreUsuario, type AccionSobreUsuario, type EstadoAdministracion } from './acciones';

interface Props {
  usuarioId: string;
  nombre: string;
  accion: AccionSobreUsuario;
  texto: string;
  /** Si hay que confirmar antes: qué va a pasar, en palabras simples. */
  confirmacion?: string;
  peligro?: boolean;
}

/** Un botón de administración (desactivar, blanquear...) que confirma antes y muestra el resultado. */
export function AccionUsuario({ usuarioId, nombre, accion, texto, confirmacion, peligro = false }: Props) {
  const ligada = useMemo(() => accionSobreUsuario.bind(null, usuarioId, accion), [usuarioId, accion]);
  const [estado, despachar, pendiente] = useActionState<EstadoAdministracion, FormData>(ligada, { ok: false, errores: [] });
  const [confirmando, setConfirmando] = useState(false);
  const ejecutar = () => {
    setConfirmando(false);
    startTransition(() => despachar(new FormData()));
  };

  return (
    <div className="pila accion-usuario">
      {confirmando ? (
        <div className={`aviso ${peligro ? 'error' : 'atencion'} pila`} role="alertdialog" aria-label={texto}>
          <span>{confirmacion}</span>
          <div className="herramientas" style={{ marginBottom: 0 }}>
            <button type="button" className={`boton ${peligro ? 'peligro' : 'primario'}`} onClick={ejecutar}>
              Sí, {texto.charAt(0).toLowerCase() + texto.slice(1)}
            </button>
            <button type="button" className="boton" onClick={() => setConfirmando(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" className={`boton ${peligro ? 'peligro' : ''}`} disabled={pendiente} onClick={() => (confirmacion ? setConfirmando(true) : ejecutar())}>
            {pendiente ? 'Un momento…' : texto}
          </button>
        </div>
      )}
      {estado.errores.length > 0 && (
        <div className="aviso error" role="alert">
          {estado.errores.join(' ')}
        </div>
      )}
      {estado.ok && estado.mensaje && !estado.enlace && (
        <div className="aviso ok" role="status">
          {estado.mensaje}
        </div>
      )}
      {estado.ok && estado.enlace && (
        <>
          {estado.mensaje && <p style={{ margin: 0 }}>{estado.mensaje}</p>}
          <EnlaceParaPasar url={estado.enlace.url} vence={estado.enlace.vence} nombre={nombre} />
        </>
      )}
    </div>
  );
}
