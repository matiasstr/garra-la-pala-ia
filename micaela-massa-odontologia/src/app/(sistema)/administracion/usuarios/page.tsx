import type { Metadata } from 'next';
import Link from 'next/link';
import { SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { listarUsuariosDelConsultorio } from '@/server/acceso/administracion';
import { usuarioActual } from '@/server/sesion';
import { ESTADO_ACCESO, NOMBRE_ROL, cuando } from './formato';

export const metadata: Metadata = { title: 'Usuarios · Micaela Massa Odontología' };

export default async function PaginaUsuarios() {
  const usuario = await usuarioActual();
  if (!puede(usuario, 'usuarios.administrar')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no puede administrar usuarios. Si necesitás un cambio, pedíselo a quien administra el consultorio." />
      </main>
    );
  }
  const usuarios = await listarUsuariosDelConsultorio(await baseDeDatos(), usuario);

  return (
    <main className="contenedor">
      <header className="encabezado">
        <div>
          <h1>Usuarios</h1>
          <p className="suave" style={{ margin: '4px 0 0' }}>
            Quiénes entran al sistema de {usuario.consultorio.nombre}
          </p>
        </div>
        <Link href="/administracion/usuarios/nuevo" className="boton primario">
          Nuevo usuario
        </Link>
      </header>
      <section className="tarjeta">
        <ul className="lista-usuarios">
          {usuarios.map((u) => (
            <li key={u.id}>
              <Link href={`/administracion/usuarios/${u.id}`}>
                <span className="lista-usuarios-nombre">
                  <strong>
                    {u.apellido}, {u.nombre}
                  </strong>
                  {u.id === usuario.id && <span className="etiqueta">Vos</span>}
                  <span className="suave">{u.email}</span>
                </span>
                <span className="lista-usuarios-detalle">
                  <span className="etiquetas">
                    {u.roles.map((r) => (
                      <span key={r} className="etiqueta">
                        {NOMBRE_ROL[r]}
                      </span>
                    ))}
                  </span>
                  <span className={`estado ${ESTADO_ACCESO[u.estado].clase}`}>{ESTADO_ACCESO[u.estado].texto}</span>
                  <span className="suave">{u.ultimoIngresoEn ? `Último ingreso: ${cuando(u.ultimoIngresoEn).toLowerCase()}` : 'Nunca ingresó'}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
