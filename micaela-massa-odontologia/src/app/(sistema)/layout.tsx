import Link from 'next/link';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import type { Rol } from '@/domain/permisos/roles';
import { MenuUsuario } from '@/components/ui/MenuUsuario';
import { Navegacion } from '@/components/ui/Navegacion';
import { SelectorUsuario } from '@/components/ui/SelectorUsuario';
import { modoDesarrollo } from '@/server/entorno';
import { sesionActual, usuarioActual } from '@/server/sesion';
import { listarUsuarios } from '@/server/usuarios';
import { cambiarUsuarioDePrueba, salirAccion } from './acciones-sesion';

const NOMBRE_ROL: Record<Rol, string> = { secretaria: 'Secretaria', profesional: 'Profesional', administrador: 'Administración' };

export const dynamic = 'force-dynamic';

export default async function LayoutSistema({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioActual();
  const conSesion = Boolean(await sesionActual());
  const desarrollo = modoDesarrollo();
  const usuarios = desarrollo ? await listarUsuarios(await baseDeDatos(), usuario.consultorio.id) : [];
  const administra = puede(usuario, 'usuarios.administrar');
  const descripcion = (u: { nombre: string; apellido: string; roles: readonly Rol[] }) => `${u.nombre} ${u.apellido} · ${u.roles.map((r) => NOMBRE_ROL[r]).join(' y ')}`;

  return (
    <>
      <header className="barra">
        <div className="barra-interior">
          <Link href="/agenda" className="marca">
            Micaela Massa Odontología
          </Link>
          <Navegacion
            enlaces={[
              { href: '/agenda', texto: 'Agenda' },
              { href: '/pacientes', texto: 'Pacientes' },
              { href: '/odontograma', texto: 'Odontograma (demo)' },
            ]}
          />
          <div className="usuario-sesion">
            {desarrollo ? (
              <>
                <span className="pastilla-desarrollo" title="Datos de prueba. Sin inicio de sesión real.">
                  Prueba
                </span>
                <SelectorUsuario accion={cambiarUsuarioDePrueba} actual={usuario.id} usuarios={usuarios.map((u) => ({ id: u.id, descripcion: descripcion(u) }))} />
                <MenuUsuario titulo="Cuenta" administra={administra} salir={conSesion ? salirAccion : undefined} />
              </>
            ) : (
              <MenuUsuario titulo={`${usuario.nombre} ${usuario.apellido}`} detalle={`${usuario.roles.map((r) => NOMBRE_ROL[r]).join(' y ')} · ${usuario.consultorio.nombre}`} administra={administra} salir={salirAccion} />
            )}
          </div>
        </div>
      </header>
      {children}
    </>
  );
}
