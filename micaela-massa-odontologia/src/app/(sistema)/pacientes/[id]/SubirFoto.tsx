'use client';

import { useRef, useState, useTransition } from 'react';
import { subirFotoAccion } from '../acciones';

const LADO_MAXIMO = 640;

/** Achica la foto en el navegador: una foto de tablet pasa de varios MB a unos 100 KB. */
async function achicar(archivo: File): Promise<Blob> {
  const imagen = await createImageBitmap(archivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  lienzo.getContext('2d')?.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  imagen.close();
  return new Promise((resolver, rechazar) => lienzo.toBlob((b) => (b ? resolver(b) : rechazar(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.85));
}

export function SubirFoto({ pacienteId, tieneFoto }: { pacienteId: string; tieneFoto: boolean }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [mensaje, setMensaje] = useState<{ error: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  return (
    <div className="pila" style={{ gap: 6, alignItems: 'center' }}>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        capture="user"
        className="visualmente-oculto"
        id={`foto-${pacienteId}`}
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          if (!archivo) return;
          iniciar(async () => {
            try {
              const datos = new FormData();
              datos.set('foto', new File([await achicar(archivo)], 'foto.jpg', { type: 'image/jpeg' }));
              const resultado = await subirFotoAccion(pacienteId, datos);
              setMensaje(resultado.ok ? { error: false, texto: 'Foto guardada.' } : { error: true, texto: resultado.errores.join(' ') });
            } catch {
              setMensaje({ error: true, texto: 'No se pudo leer la foto. Probá con otra.' });
            } finally {
              if (entrada.current) entrada.current.value = '';
            }
          });
        }}
      />
      <label htmlFor={`foto-${pacienteId}`} className="boton chico" style={{ display: 'inline-flex', alignItems: 'center' }} aria-disabled={pendiente}>
        {pendiente ? 'Subiendo…' : tieneFoto ? 'Cambiar foto' : 'Sacar foto'}
      </label>
      {mensaje && (
        <span role="status" className="suave" style={{ fontSize: '0.8rem', color: mensaje.error ? 'var(--rojo)' : undefined }}>
          {mensaje.texto}
        </span>
      )}
    </div>
  );
}
