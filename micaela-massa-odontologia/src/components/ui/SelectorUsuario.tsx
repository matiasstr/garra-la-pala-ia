'use client';

import { useRef } from 'react';

interface Props {
  accion: (datos: FormData) => Promise<void>;
  usuarios: { id: string; descripcion: string }[];
  actual: string;
}

/** Solo en modo desarrollo: cambia de usuario de prueba para ver cada rol. */
export function SelectorUsuario({ accion, usuarios, actual }: Props) {
  const formulario = useRef<HTMLFormElement>(null);
  return (
    <form ref={formulario} action={accion}>
      <label className="visualmente-oculto" htmlFor="usuario-prueba">
        Usuario de prueba
      </label>
      <select id="usuario-prueba" name="usuarioId" defaultValue={actual} onChange={() => formulario.current?.requestSubmit()} style={{ minHeight: 36, padding: '4px 8px', width: 'auto', maxWidth: '100%' }}>
        {usuarios.map((u) => (
          <option key={u.id} value={u.id}>
            {u.descripcion}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="boton chico">
          Cambiar
        </button>
      </noscript>
    </form>
  );
}
