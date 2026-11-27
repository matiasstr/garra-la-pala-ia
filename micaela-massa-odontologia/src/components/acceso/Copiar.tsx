'use client';

import { useState } from 'react';

/** Botón que copia un texto. Si el navegador no deja, avisa que lo copien a mano. */
export function BotonCopiar({ texto, etiqueta = 'Copiar' }: { texto: string; etiqueta?: string }) {
  const [estado, setEstado] = useState<'listo' | 'copiado' | 'error'>('listo');
  return (
    <button
      type="button"
      className="boton"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto);
          setEstado('copiado');
        } catch {
          setEstado('error');
        }
        setTimeout(() => setEstado('listo'), 2500);
      }}
    >
      <span aria-live="polite">{estado === 'copiado' ? 'Copiado' : estado === 'error' ? 'Copialo a mano' : etiqueta}</span>
    </button>
  );
}
