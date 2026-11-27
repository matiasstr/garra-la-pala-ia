'use client';

import { BotonCopiar } from './Copiar';

/** Se muestran una sola vez: en la base quedan solo sus hashes. */
export function CodigosDeRecuperacion({ codigos, cuenta }: { codigos: string[]; cuenta: string }) {
  const texto = [`Códigos de recuperación de ${cuenta} (Micaela Massa Odontología).`, 'Cada uno sirve una sola vez.', '', ...codigos].join('\n');
  const descarga = `data:text/plain;charset=utf-8,${encodeURIComponent(texto)}`;
  return (
    <div className="pila">
      <div className="aviso atencion" role="status">
        <strong>Guardá estos códigos ahora: no se vuelven a mostrar.</strong> Si perdés el celular, cada uno te deja entrar una vez en lugar del código de la
        app. Anotalos en papel o guardalos en un lugar seguro, fuera del celular.
      </div>
      <ul className="lista-codigos" aria-label="Códigos de recuperación">
        {codigos.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
      <div className="herramientas">
        <BotonCopiar texto={texto} etiqueta="Copiar los códigos" />
        <a className="boton" href={descarga} download="codigos-de-recuperacion.txt">
          Descargar
        </a>
      </div>
    </div>
  );
}
