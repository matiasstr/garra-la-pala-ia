'use client';

import Link from 'next/link';
import { startTransition, useActionState } from 'react';
import { formatoFechaCorta } from '@/lib/fechas';
import { altaPacienteAccion, type EstadoAltaPaciente } from '../acciones';

const TIPOS = [
  { valor: 'DNI', texto: 'DNI' },
  { valor: 'PAS', texto: 'Pasaporte' },
  { valor: 'LC', texto: 'LC' },
  { valor: 'LE', texto: 'LE' },
  { valor: 'CI', texto: 'Cédula' },
];

const MOTIVO = {
  mismo_documento: 'Mismo documento',
  mismo_nombre_y_nacimiento: 'Mismo nombre y fecha de nacimiento',
  homonimo: 'Mismo nombre',
} as const;

export function FormularioPaciente({ financiadores, hoy }: { financiadores: { id: string; nombre: string; esParticular: boolean }[]; hoy: string }) {
  const [estado, despachar, pendiente] = useActionState<EstadoAltaPaciente, FormData>(altaPacienteAccion, { ok: false, errores: [] });
  const pideConfirmar = Boolean(estado.coincidencias?.length) && !estado.duplicado;

  return (
    <form
      className="pila"
      onSubmit={(evento) => {
        evento.preventDefault();
        const datos = new FormData(evento.currentTarget, (evento.nativeEvent as SubmitEvent).submitter);
        startTransition(() => despachar(datos));
      }}
    >
      <section className="tarjeta pila" aria-labelledby="titulo-identidad">
        <h2 id="titulo-identidad">Identidad</h2>
        <div className="fila-campos">
          <label className="campo">
            <span>Tipo de documento</span>
            <select name="tipoDocumento" defaultValue="DNI">
              {TIPOS.map((t) => (
                <option key={t.valor} value={t.valor}>
                  {t.texto}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Número</span>
            <input type="text" name="numeroDocumento" inputMode="numeric" autoComplete="off" required />
          </label>
        </div>
        <div className="fila-campos">
          <label className="campo">
            <span>Apellido</span>
            <input type="text" name="apellido" autoComplete="off" required />
          </label>
          <label className="campo">
            <span>Nombre</span>
            <input type="text" name="nombre" autoComplete="off" required />
          </label>
          <label className="campo">
            <span>Fecha de nacimiento</span>
            <input type="date" name="fechaNacimiento" max={hoy} required />
          </label>
        </div>
      </section>

      <section className="tarjeta pila" aria-labelledby="titulo-contacto">
        <h2 id="titulo-contacto">Contacto</h2>
        <div className="fila-campos">
          <label className="campo">
            <span>Celular</span>
            <input type="tel" name="telefono" autoComplete="off" placeholder="Ej.: 11 2345 6789" />
          </label>
          <label className="campo">
            <span>Email</span>
            <input type="email" name="email" autoComplete="off" />
          </label>
        </div>
        <label className="casilla">
          <input type="checkbox" name="aceptaMensajes" value="si" />
          <span>
            Acepta recibir recordatorios de turnos por WhatsApp.
            <br />
            <span className="suave">Preguntárselo al paciente. Queda registrado cuándo lo aceptó.</span>
          </span>
        </label>
      </section>

      <section className="tarjeta pila" aria-labelledby="titulo-cobertura">
        <h2 id="titulo-cobertura">Cobertura</h2>
        <div className="fila-campos">
          <label className="campo">
            <span>Cobertura</span>
            <select name="financiadorId" defaultValue={financiadores.find((f) => f.esParticular)?.id} required>
              {financiadores.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>N.º de afiliado</span>
            <input type="text" name="numeroAfiliado" autoComplete="off" />
          </label>
          <label className="campo">
            <span>Plan</span>
            <input type="text" name="plan" autoComplete="off" />
          </label>
        </div>
      </section>

      {estado.coincidencias && estado.coincidencias.length > 0 && (
        <div className={`aviso ${estado.duplicado ? 'error' : 'atencion'}`} role="alert">
          <strong>{estado.duplicado ? 'Este paciente ya está cargado.' : 'Ojo: puede ser un paciente que ya existe.'}</strong>
          <ul>
            {estado.coincidencias.map((c) => (
              <li key={c.id}>
                <Link href={`/pacientes/${c.id}`} target="_blank">
                  {c.apellido}, {c.nombre}
                </Link>{' '}
                · {c.documento} · nació el {formatoFechaCorta(c.fechaNacimiento)} ({MOTIVO[c.motivo]})
              </li>
            ))}
          </ul>
          {pideConfirmar && <p style={{ margin: '8px 0 0' }}>Revisá que no sea la misma persona antes de crear otra ficha.</p>}
        </div>
      )}

      {estado.errores.length > 0 && !estado.duplicado && (
        <div className="aviso error" role="alert">
          {estado.errores.length === 1 ? estado.errores[0] : <ul>{estado.errores.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}

      <div className="herramientas">
        {pideConfirmar ? (
          <button type="submit" name="confirmar" value="si" className="boton primario" disabled={pendiente}>
            Es otra persona: crear igual
          </button>
        ) : (
          <button type="submit" className="boton primario" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar paciente'}
          </button>
        )}
      </div>
    </form>
  );
}
