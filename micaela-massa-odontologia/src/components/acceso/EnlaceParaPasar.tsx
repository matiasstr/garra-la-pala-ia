'use client';

import { BotonCopiar } from './Copiar';

/**
 * El enlace de un solo uso que el administrador le pasa a la persona (no hay
 * envío de emails). Se muestra una sola vez: si se pierde, se genera otro.
 */
export function EnlaceParaPasar({ url, nombre, vence }: { url: string; nombre: string; vence: string }) {
  const mensaje = `Hola ${nombre}. Con este enlace elegís tu contraseña y configurás la verificación en dos pasos del sistema del consultorio. Sirve una sola vez y vence el ${vence}: ${url}`;
  return (
    <div className="aviso ok pila" role="status">
      <div>
        <strong>Enlace para {nombre}.</strong> Pasáselo por WhatsApp o en persona. Sirve una sola vez y vence el {vence}. Este enlace no se vuelve a mostrar: si
        se pierde, generá otro.
      </div>
      <label className="campo">
        <span>Enlace</span>
        <input type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="enlace-acceso" />
      </label>
      <div className="herramientas" style={{ marginBottom: 0 }}>
        <BotonCopiar texto={url} etiqueta="Copiar el enlace" />
        <a className="boton" href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`} target="_blank" rel="noreferrer">
          Mandar por WhatsApp
        </a>
      </div>
    </div>
  );
}
