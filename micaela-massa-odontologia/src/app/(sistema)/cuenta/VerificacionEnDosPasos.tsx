'use client';

import { startTransition, useActionState, useState } from 'react';
import { ClaveDeApp } from '@/components/acceso/ClaveDeApp';
import { CodigosDeRecuperacion } from '@/components/acceso/CodigosDeRecuperacion';
import { confirmarCambioDeAppAccion, iniciarCambioDeAppAccion, nuevosCodigosAccion, type EstadoCambioDeApp, type EstadoCodigos } from './acciones';

function Errores({ errores }: { errores: string[] }) {
  if (!errores.length) return null;
  return (
    <div className="aviso error" role="alert">
      {errores.join(' ')}
    </div>
  );
}

const alEnviar = (despachar: (datos: FormData) => void) => (evento: React.FormEvent<HTMLFormElement>) => {
  evento.preventDefault();
  const datos = new FormData(evento.currentTarget);
  startTransition(() => despachar(datos));
};

const CampoCodigo = () => (
  <label className="campo">
    <span>Código de 6 números de la app</span>
    <input type="text" name="codigo" className="campo-codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" required />
  </label>
);

/** Pasar la verificación a otro celular o app: contraseña → clave nueva → código de la app nueva. */
export function CambiarApp({ email }: { email: string }) {
  const [abierto, setAbierto] = useState(false);
  const [inicio, iniciar, iniciando] = useActionState<EstadoCambioDeApp, FormData>(iniciarCambioDeAppAccion, { errores: [] });
  const [fin, confirmar, confirmando] = useActionState<EstadoCodigos, FormData>(confirmarCambioDeAppAccion, { errores: [] });

  if (fin.codigos) {
    return (
      <div className="pila">
        <div className="aviso ok" role="status">
          Listo: desde ahora vale la app nueva. La anterior y los códigos de recuperación viejos ya no sirven.
        </div>
        <CodigosDeRecuperacion codigos={fin.codigos} cuenta={email} />
      </div>
    );
  }
  if (!abierto) {
    return (
      <div>
        <button type="button" className="boton" onClick={() => setAbierto(true)}>
          Cambiar de celular o de app
        </button>
      </div>
    );
  }
  if (inicio.clave) {
    return (
      <div className="pila">
        <ClaveDeApp clave={inicio.clave} />
        <form className="pila" onSubmit={alEnviar(confirmar)} aria-label="Confirmar la app nueva">
          <CampoCodigo />
          <Errores errores={fin.errores} />
          <div className="herramientas">
            <button type="submit" className="boton primario" disabled={confirmando}>
              {confirmando ? 'Verificando…' : 'Confirmar la app nueva'}
            </button>
          </div>
        </form>
      </div>
    );
  }
  return (
    <form className="pila" onSubmit={alEnviar(iniciar)} aria-label="Cambiar de app de autenticación">
      <p style={{ margin: 0 }}>Para seguir, escribí tu contraseña. Hasta que confirmes la app nueva, la actual sigue funcionando.</p>
      <input type="email" name="email" value={email} readOnly hidden autoComplete="username" />
      <label className="campo">
        <span>Contraseña</span>
        <input type="password" name="clave" autoComplete="current-password" required autoFocus />
      </label>
      <Errores errores={inicio.errores} />
      <div className="herramientas">
        <button type="submit" className="boton primario" disabled={iniciando}>
          {iniciando ? 'Verificando…' : 'Seguir'}
        </button>
        <button type="button" className="boton" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Códigos de recuperación nuevos: pide un código de la app y anula los anteriores. */
export function NuevosCodigos({ email }: { email: string }) {
  const [abierto, setAbierto] = useState(false);
  const [estado, despachar, pendiente] = useActionState<EstadoCodigos, FormData>(nuevosCodigosAccion, { errores: [] });
  if (estado.codigos) return <CodigosDeRecuperacion codigos={estado.codigos} cuenta={email} />;
  if (!abierto) {
    return (
      <div>
        <button type="button" className="boton" onClick={() => setAbierto(true)}>
          Generar códigos de recuperación nuevos
        </button>
      </div>
    );
  }
  return (
    <form className="pila" onSubmit={alEnviar(despachar)} aria-label="Generar códigos de recuperación nuevos">
      <p style={{ margin: 0 }}>Los códigos que tenés ahora van a dejar de servir. Para seguir, escribí el código que muestra la app.</p>
      <CampoCodigo />
      <Errores errores={estado.errores} />
      <div className="herramientas">
        <button type="submit" className="boton primario" disabled={pendiente}>
          {pendiente ? 'Generando…' : 'Generar'}
        </button>
        <button type="button" className="boton" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
