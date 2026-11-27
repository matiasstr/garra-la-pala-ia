'use client';

import Link from 'next/link';
import { startTransition, useActionState, useRef, useState } from 'react';
import { EnlaceParaPasar } from '@/components/acceso/EnlaceParaPasar';
import { ESPECIALIDADES, NOMBRE_ESPECIALIDAD, ROLES, type Especialidad, type Rol } from '@/domain/permisos/roles';
import type { EstadoAdministracion } from './acciones';
import { DESCRIPCION_ROL, NOMBRE_ROL } from './formato';

export interface DatosIniciales {
  email: string;
  nombre: string;
  apellido: string;
  roles: Rol[];
  matricula: string | null;
  especialidades: Especialidad[];
}

interface Props {
  accion: (estado: EstadoAdministracion, datos: FormData) => Promise<EstadoAdministracion>;
  inicial?: DatosIniciales;
  textoBoton: string;
}

/** Alta o edición de un usuario: datos, roles y, para profesionales, matrícula y especialidades. */
export function FormularioUsuario({ accion, inicial, textoBoton }: Props) {
  const [estado, despachar, pendiente] = useActionState(accion, { ok: false, errores: [] });
  const [profesional, setProfesional] = useState(inicial?.roles.includes('profesional') ?? false);
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const formulario = useRef<HTMLFormElement>(null);
  const creado = !inicial && estado.ok && estado.enlace;

  if (creado && estado.enlace) {
    return (
      <div className="pila">
        <EnlaceParaPasar url={estado.enlace.url} vence={estado.enlace.vence} nombre={nombre} />
        <div className="herramientas">
          <Link href={`/administracion/usuarios/${estado.usuarioId}`} className="boton">
            Ver el usuario
          </Link>
          <Link href="/administracion/usuarios" className="boton">
            Volver a la lista
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={formulario}
      className="pila"
      aria-label={inicial ? 'Datos del usuario' : 'Nuevo usuario'}
      onSubmit={(evento) => {
        evento.preventDefault();
        const datos = new FormData(evento.currentTarget);
        startTransition(() => despachar(datos));
      }}
    >
      <div className="fila-campos">
        <label className="campo">
          <span>Nombre</span>
          <input type="text" name="nombre" defaultValue={inicial?.nombre} onChange={(e) => setNombre(e.currentTarget.value)} autoComplete="off" required />
        </label>
        <label className="campo">
          <span>Apellido</span>
          <input type="text" name="apellido" defaultValue={inicial?.apellido} autoComplete="off" required />
        </label>
      </div>
      <label className="campo">
        <span>Email (con este entra al sistema)</span>
        <input type="email" name="email" defaultValue={inicial?.email} autoComplete="off" autoCapitalize="none" spellCheck={false} required />
      </label>

      <fieldset className="grupo-casillas">
        <legend>Roles</legend>
        {ROLES.map((rol) => (
          <label key={rol} className="casilla">
            <input
              type="checkbox"
              name="roles"
              value={rol}
              defaultChecked={inicial?.roles.includes(rol)}
              onChange={rol === 'profesional' ? (e) => setProfesional(e.currentTarget.checked) : undefined}
            />
            <span>
              <strong>{NOMBRE_ROL[rol]}</strong>
              <br />
              <span className="suave">{DESCRIPCION_ROL[rol]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {profesional && (
        <div className="pila">
          <label className="campo">
            <span>Matrícula</span>
            <input type="text" name="matricula" defaultValue={inicial?.matricula ?? ''} placeholder="Ej.: MP 12345" autoComplete="off" required />
          </label>
          <fieldset className="grupo-casillas columnas-casillas">
            <legend>Especialidades</legend>
            {ESPECIALIDADES.map((e) => (
              <label key={e} className="casilla">
                <input type="checkbox" name="especialidades" value={e} defaultChecked={inicial?.especialidades.includes(e)} />
                <span>{NOMBRE_ESPECIALIDAD[e]}</span>
              </label>
            ))}
          </fieldset>
        </div>
      )}

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
