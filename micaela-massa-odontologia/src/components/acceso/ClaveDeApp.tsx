'use client';

import { BotonCopiar } from './Copiar';

/** "ABCD EFGH IJKL ...": más fácil de copiar a mano en el celular. */
const agruparSecreto = (secreto: string): string => secreto.replace(/(.{4})(?=.)/g, '$1 ');

export interface ClaveDeAppVisible {
  secreto: string;
  enlace: string;
  emisor: string;
  cuenta: string;
}

/**
 * Cómo cargar la clave en la app de autenticación. No hay código QR (haría
 * falta otra dependencia): en el celular se toca el botón, que abre la app con
 * todo cargado; en la computadora se escribe la clave en la app.
 */
export function ClaveDeApp({ clave }: { clave: ClaveDeAppVisible }) {
  return (
    <div className="pila">
      <ol className="pasos-acceso">
        <li>
          Instalá en tu celular una app de autenticación, por ejemplo <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong> (son
          gratis).
        </li>
        <li>
          <strong>Si estás en el celular:</strong> tocá el botón y la app se abre con todo cargado.
          <div className="herramientas" style={{ marginTop: 8, marginBottom: 0 }}>
            <a className="boton primario" href={clave.enlace}>
              Agregar a la app de autenticación
            </a>
          </div>
        </li>
        <li>
          <strong>Si estás en la computadora:</strong> en la app elegí “Ingresar una clave de configuración” (o “Introducir clave”) y escribí:
          <dl className="datos-clave">
            <dt>Cuenta</dt>
            <dd>
              {clave.emisor} ({clave.cuenta})
            </dd>
            <dt>Clave</dt>
            <dd>
              <code className="clave-totp" data-clave={clave.secreto}>
                {agruparSecreto(clave.secreto)}
              </code>
            </dd>
            <dt>Tipo</dt>
            <dd>Basada en el tiempo</dd>
          </dl>
          <BotonCopiar texto={clave.secreto} etiqueta="Copiar la clave" />
        </li>
        <li>La app va a mostrar un código de 6 números que cambia cada 30 segundos. Escribilo abajo.</li>
      </ol>
    </div>
  );
}
