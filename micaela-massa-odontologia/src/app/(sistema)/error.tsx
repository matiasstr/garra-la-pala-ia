'use client';

export default function ErrorDelSistema({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="contenedor">
      <div className="aviso error" role="alert">
        <strong>Algo salió mal.</strong> {process.env.NODE_ENV !== 'production' ? error.message : 'Probá de nuevo; si sigue pasando, avisá a soporte.'}
        {error.digest && <div className="suave">Código: {error.digest}</div>}
      </div>
      <p>
        <button type="button" className="boton" onClick={reset}>
          Reintentar
        </button>
      </p>
    </main>
  );
}
