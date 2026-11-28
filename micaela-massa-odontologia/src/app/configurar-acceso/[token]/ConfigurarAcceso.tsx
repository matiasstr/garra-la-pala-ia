'use client';

import Link from 'next/link';
import { startTransition, useActionState, useMemo, useState } from 'react';
import { ClaveDeApp } from '@/components/acceso/ClaveDeApp';
import { CodigosDeRecuperacion } from '@/components/acceso/CodigosDeRecuperacion';
import { pasoClaveAccion, pasoCodigoAccion, type EstadoPasoClave, type EstadoPasoCodigo } from './acciones';

interface Props {
  token: string;
  nombre: string;
  email: string;
  tieneClave: boolean;
}

function Errores({ errores }: { errores: string[] }) {
  if (!errores.length) return null;
  return (
    <div className="aviso error" role="alert">
      {errores.length === 1 ? errores[0] : <ul>{errores.map((e) => <li key={e}>{e}</li>)}</ul>}
    </div>
  );
}

const alEnviar = (despachar: (datos: FormData) => void) => (evento: React.FormEvent<HTMLFormElement>) => {
  evento.preventDefault();
  const datos = new FormData(evento.currentTarget);
  startTransition(() => despachar(datos));
};

/**
 * Configuración del acceso con el enlace de un solo uso:
 * 1. contraseña (elegirla, o escribirla si ya tenía);
 * 2. app de autenticación, confirmada con un código;
 * 3. códigos de recuperación, que se muestran una sola vez.
 */
export function ConfigurarAcceso({ token, nombre, email, tieneClave }: Props) {
  const acciones = useMemo(() => ({ clave: pasoClaveAccion.bind(null, token), codigo: pasoCodigoAccion.bind(null, token) }), [token]);
  const [paso1, despacharClave, pendiente1] = useActionState<EstadoPasoClave, FormData>(acciones.clave, { errores: [] });
  const [paso2, despacharCodigo, pendiente2] = useActionState<EstadoPasoCodigo, FormData>(acciones.codigo, { errores: [] });
  const [guardados, setGuardados] = useState(false);

  if (paso2.codigos) {
    return (
      <section className="pila" aria-labelledby="titulo-codigos">
        <h2 id="titulo-codigos">Último paso: tus códigos de recuperación</h2>
        <CodigosDeRecuperacion codigos={paso2.codigos} cuenta={email} />
        <label className="casilla">
          <input type="checkbox" checked={guardados} onChange={(e) => setGuardados(e.currentTarget.checked)} />
          <span>Ya los guardé en un lugar seguro.</span>
        </label>
        {guardados ? (
          <Link href="/ingresar" className="boton primario ancho">
            Listo: ir a ingresar
          </Link>
        ) : (
          <button type="button" className="boton primario ancho" disabled>
            Listo: ir a ingresar
          </button>
        )}
      </section>
    );
  }

  if (paso1.siguiente === 'listo') {
    return (
      <div className="pila">
        <div className="aviso ok" role="status">
          Listo, {nombre}: tu contraseña nueva quedó guardada. Tu verificación en dos pasos sigue siendo la misma.
        </div>
        <Link href="/ingresar" className="boton primario ancho">
          Ir a ingresar
        </Link>
      </div>
    );
  }

  if (paso1.siguiente === 'verificacion' && paso1.clave) {
    return (
      <section className="pila" aria-labelledby="titulo-app">
        <h2 id="titulo-app">Paso 2: verificación en dos pasos</h2>
        <p style={{ margin: 0 }}>
          Para entrar al sistema vas a usar tu contraseña y, además, un código que genera una app en tu celular. Así nadie puede entrar aunque sepa tu contraseña.
        </p>
        <ClaveDeApp clave={paso1.clave} />
        <form className="pila" onSubmit={alEnviar(despacharCodigo)} aria-label="Confirmar la app de autenticación">
          <label className="campo">
            <span>Código de 6 números que muestra la app</span>
            <input type="text" name="codigo" className="campo-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" required />
          </label>
          <Errores errores={paso2.errores} />
          <button type="submit" className="boton primario ancho" disabled={pendiente2}>
            {pendiente2 ? 'Verificando…' : 'Confirmar'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <form className="pila" onSubmit={alEnviar(despacharClave)} aria-label={tieneClave ? 'Escribir tu contraseña' : 'Elegir tu contraseña'}>
      <h2>{tieneClave ? 'Paso 1: escribí tu contraseña' : 'Paso 1: elegí tu contraseña'}</h2>
      {/* Para que el gestor de contraseñas del navegador la guarde con el email correcto. */}
      <label className="campo">
        <span>Tu email</span>
        <input type="email" name="email" value={email} readOnly autoComplete="username" />
      </label>
      {tieneClave ? (
        <label className="campo">
          <span>Contraseña</span>
          <input type="password" name="clave" autoComplete="current-password" required autoFocus />
        </label>
      ) : (
        <>
          <p className="suave" style={{ margin: 0 }}>
            Al menos 10 caracteres. Lo más fácil y seguro es una frase que solo vos conozcas, por ejemplo: “el mate de la mañana está frío”.
          </p>
          <label className="campo">
            <span>Contraseña nueva</span>
            <input type="password" name="clave" autoComplete="new-password" minLength={10} required autoFocus />
          </label>
          <label className="campo">
            <span>Repetila</span>
            <input type="password" name="repetida" autoComplete="new-password" minLength={10} required />
          </label>
        </>
      )}
      <Errores errores={paso1.errores} />
      <button type="submit" className="boton primario ancho" disabled={pendiente1}>
        {pendiente1 ? 'Guardando…' : 'Seguir'}
      </button>
    </form>
  );
}
