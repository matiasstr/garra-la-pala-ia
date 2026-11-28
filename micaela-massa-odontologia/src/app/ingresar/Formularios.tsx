'use client';

import { startTransition, useActionState, useState } from 'react';
import { cancelarIngresoAccion, ingresarConClaveAccion, ingresarConCodigoAccion, type EstadoIngreso } from './acciones';

const INICIAL: EstadoIngreso = { errores: [] };

function Errores({ errores }: { errores: string[] }) {
  if (!errores.length) return null;
  return (
    <div className="aviso error" role="alert">
      {errores.join(' ')}
    </div>
  );
}

/** Despacha la acción sin que React vacíe el formulario: si hay un error, lo escrito queda. */
function alEnviar(despachar: (datos: FormData) => void) {
  return (evento: React.FormEvent<HTMLFormElement>) => {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    startTransition(() => despachar(datos));
  };
}

export function FormularioClave({ volver }: { volver: string }) {
  const [estado, despachar, pendiente] = useActionState(ingresarConClaveAccion, INICIAL);
  return (
    <form className="pila" onSubmit={alEnviar(despachar)} aria-label="Ingresar con email y contraseña">
      <input type="hidden" name="volver" value={volver} />
      <label className="campo">
        <span>Email</span>
        <input type="email" name="email" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus />
      </label>
      <label className="campo">
        <span>Contraseña</span>
        <input type="password" name="clave" autoComplete="current-password" required />
      </label>
      <Errores errores={estado.errores} />
      <button type="submit" className="boton primario ancho" disabled={pendiente}>
        {pendiente ? 'Verificando…' : 'Seguir'}
      </button>
    </form>
  );
}

export function FormularioCodigo({ nombre, volver }: { nombre: string; volver: string }) {
  const [estado, despachar, pendiente] = useActionState(ingresarConCodigoAccion, INICIAL);
  const [recuperacion, setRecuperacion] = useState(false);
  return (
    <div className="pila">
      <form className="pila" onSubmit={alEnviar(despachar)} aria-label="Código de verificación">
        <input type="hidden" name="volver" value={volver} />
        <p style={{ margin: 0 }}>
          Hola, {nombre}.{' '}
          {recuperacion
            ? 'Escribí uno de tus códigos de recuperación. Cada uno sirve una sola vez.'
            : 'Abrí la app de autenticación del celular y escribí el código de 6 números.'}
        </p>
        {recuperacion ? (
          <label className="campo">
            <span>Código de recuperación</span>
            <input key="recuperacion" type="text" name="codigo" autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="xxxxx-xxxxx" required autoFocus />
          </label>
        ) : (
          <label className="campo">
            <span>Código de la app</span>
            <input
              key="app"
              type="text"
              name="codigo"
              className="campo-codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              placeholder="123456"
              required
              autoFocus
            />
          </label>
        )}
        <Errores errores={estado.errores} />
        <button type="submit" className="boton primario ancho" disabled={pendiente}>
          {pendiente ? 'Verificando…' : 'Ingresar'}
        </button>
      </form>
      <button type="button" className="boton-texto" onClick={() => setRecuperacion((r) => !r)}>
        {recuperacion ? 'Usar el código de la app' : '¿No tenés el celular? Usá un código de recuperación'}
      </button>
      <form action={cancelarIngresoAccion}>
        <button type="submit" className="boton-texto">
          No soy {nombre}: volver a empezar
        </button>
      </form>
    </div>
  );
}
