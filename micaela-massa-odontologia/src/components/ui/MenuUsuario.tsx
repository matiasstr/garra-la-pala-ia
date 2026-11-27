'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

interface Props {
  /** Texto del botón: el nombre de la persona. */
  titulo: string;
  detalle?: string;
  administra: boolean;
  /** Con una sesión iniciada se ofrece "Salir" (en modo desarrollo con el selector, no). */
  salir?: () => Promise<void>;
}

/** Menú del usuario en el encabezado: "Mi cuenta", "Usuarios" (si administra) y "Salir". Funciona sin JavaScript. */
export function MenuUsuario({ titulo, detalle, administra, salir }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const ruta = usePathname();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [ruta]);
  useEffect(() => {
    const cerrar = (evento: MouseEvent | KeyboardEvent) => {
      if (!menu.current?.open) return;
      if (evento instanceof KeyboardEvent ? evento.key === 'Escape' : !menu.current.contains(evento.target as Node)) menu.current.open = false;
    };
    document.addEventListener('click', cerrar);
    document.addEventListener('keydown', cerrar);
    return () => {
      document.removeEventListener('click', cerrar);
      document.removeEventListener('keydown', cerrar);
    };
  }, []);

  return (
    <details className="menu-usuario" ref={menu}>
      <summary>
        <span className="menu-usuario-nombre">{titulo}</span>
        <span aria-hidden="true">▾</span>
      </summary>
      <div className="menu-usuario-opciones">
        {detalle && <p className="suave">{detalle}</p>}
        <Link href="/cuenta">Mi cuenta</Link>
        {administra && <Link href="/administracion/usuarios">Usuarios del consultorio</Link>}
        {salir && (
          <form action={salir}>
            <button type="submit">Salir</button>
          </form>
        )}
      </div>
    </details>
  );
}
