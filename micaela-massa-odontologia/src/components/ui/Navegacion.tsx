'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Navegacion({ enlaces }: { enlaces: { href: string; texto: string }[] }) {
  const ruta = usePathname();
  return (
    <nav className="navegacion" aria-label="Secciones">
      {enlaces.map((e) => (
        <Link key={e.href} href={e.href} aria-current={ruta === e.href || ruta.startsWith(`${e.href}/`) ? 'page' : undefined}>
          {e.texto}
        </Link>
      ))}
    </nav>
  );
}
