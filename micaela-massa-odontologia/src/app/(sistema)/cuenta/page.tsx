import type { Metadata } from 'next';
import Link from 'next/link';
import { FormularioAccion } from '@/components/ui/FormularioAccion';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { capitalizar, formatoFechaLarga, formatoHora, fechaDe } from '@/lib/fechas';
import { estadoDeCuenta } from '@/server/acceso/cuenta';
import { modoDesarrollo } from '@/server/entorno';
import { sesionActual, usuarioActual } from '@/server/sesion';
import { cambiarClaveAccion, cambiarConsultorioAccion, cerrarOtrasSesionesAccion } from './acciones';
import { CambiarApp, NuevosCodigos } from './VerificacionEnDosPasos';

export const metadata: Metadata = { title: 'Mi cuenta · Micaela Massa Odontología' };

const cuando = (instante: Date) => `${capitalizar(formatoFechaLarga(fechaDe(instante)))} a las ${formatoHora(instante)}`;

export default async function PaginaCuenta({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [usuario, sesion, parametros] = await Promise.all([usuarioActual(), sesionActual(), searchParams]);
  const cuenta = await estadoDeCuenta(await baseDeDatos(), usuario, sesion?.sesionId ?? null);
  const otras = cuenta.sesiones.filter((s) => !s.actual);

  return (
    <main className="contenedor pila">
      <header className="encabezado" style={{ marginBottom: 0 }}>
        <div>
          <h1>Mi cuenta</h1>
          <p className="suave" style={{ margin: '4px 0 0' }}>
            {usuario.nombre} {usuario.apellido} · {cuenta.email} · {usuario.consultorio.nombre}
          </p>
        </div>
      </header>

      {parametros.recuperacion && (
        <div className="aviso atencion" role="status">
          Entraste con un código de recuperación. Te {cuenta.codigosRestantes === 1 ? 'queda 1' : `quedan ${cuenta.codigosRestantes}`}. Si cambiaste de celular,
          configurá la app de nuevo acá abajo.
        </div>
      )}
      {modoDesarrollo() && !sesion && (
        <div className="aviso atencion" role="status">
          Modo de prueba: estás usando el selector de usuario, sin sesión iniciada. Lo que cambies acá se guarda en la base de prueba.
        </div>
      )}

      <div className="columnas">
        <section className="tarjeta pila" aria-labelledby="titulo-clave">
          <h2 id="titulo-clave">Contraseña</h2>
          <p className="suave" style={{ margin: 0 }}>
            {cuenta.claveCambiadaEn ? `La cambiaste por última vez el ${cuando(cuenta.claveCambiadaEn).toLowerCase()}.` : 'Todavía no la cambiaste.'} Al cambiarla se
            cierran tus otras sesiones.
          </p>
          <FormularioAccion accion={cambiarClaveAccion} textoBoton="Cambiar la contraseña" reiniciarAlGuardar etiqueta="Cambiar la contraseña">
            <input type="email" name="email" value={cuenta.email} readOnly hidden autoComplete="username" />
            <label className="campo">
              <span>Contraseña actual</span>
              <input type="password" name="actual" autoComplete="current-password" required />
            </label>
            <label className="campo">
              <span>Contraseña nueva (al menos 10 caracteres)</span>
              <input type="password" name="nueva" autoComplete="new-password" minLength={10} required />
            </label>
            <label className="campo">
              <span>Repetí la nueva</span>
              <input type="password" name="repetida" autoComplete="new-password" minLength={10} required />
            </label>
          </FormularioAccion>
        </section>

        <section className="tarjeta pila" aria-labelledby="titulo-verificacion">
          <h2 id="titulo-verificacion">Verificación en dos pasos</h2>
          {cuenta.verificacionDesde ? (
            <p style={{ margin: 0 }}>
              <span className="estado estado-atendido">Activa</span> desde el {cuando(cuenta.verificacionDesde).toLowerCase()}.
            </p>
          ) : (
            <div className="aviso atencion">No está configurada.</div>
          )}
          <p className="suave" style={{ margin: 0 }}>
            Códigos de recuperación sin usar: <strong>{cuenta.codigosRestantes}</strong>.
            {cuenta.codigosRestantes <= 3 && ' Te conviene generar códigos nuevos.'}
          </p>
          <CambiarApp email={cuenta.email} />
          {cuenta.verificacionDesde && <NuevosCodigos email={cuenta.email} />}
        </section>

        <section className="tarjeta pila" aria-labelledby="titulo-sesiones">
          <h2 id="titulo-sesiones">Sesiones abiertas</h2>
          {cuenta.sesiones.length ? (
            <ul className="lista-simple">
              {cuenta.sesiones.map((s) => (
                <li key={s.id}>
                  <strong>{s.dispositivo}</strong> {s.actual && <span className="etiqueta">Esta</span>}
                  <div className="suave">
                    Entró el {cuando(s.ingresoEn).toLowerCase()}
                    {s.ip ? ` · IP ${s.ip}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="suave" style={{ margin: 0 }}>
              No hay sesiones abiertas.
            </p>
          )}
          <p className="suave" style={{ margin: 0 }}>
            Si dejaste la sesión abierta en otra computadora o en un celular que ya no tenés, cerrala desde acá.
          </p>
          <FormularioAccion accion={cerrarOtrasSesionesAccion} textoBoton={otras.length ? `Cerrar las otras sesiones (${otras.length})` : 'Cerrar las otras sesiones'} etiqueta="Cerrar las otras sesiones">
            {null}
          </FormularioAccion>
        </section>

        {cuenta.consultorios.length > 1 && sesion && (
          <section className="tarjeta pila" aria-labelledby="titulo-consultorio">
            <h2 id="titulo-consultorio">Consultorio</h2>
            <form action={cambiarConsultorioAccion} className="pila">
              <label className="campo">
                <span>Estás trabajando en</span>
                <select name="consultorioId" defaultValue={usuario.consultorio.id}>
                  {cuenta.consultorios.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <button type="submit" className="boton">
                  Cambiar de consultorio
                </button>
              </div>
            </form>
          </section>
        )}

        {puede(usuario, 'hc.registrar') && (
          <section className="tarjeta pila" aria-labelledby="titulo-firma">
            <h2 id="titulo-firma">Firma de la historia clínica</h2>
            <p className="suave" style={{ margin: 0 }}>
              El PIN de firma se pide cada vez que firmás una evolución. Es distinto de la contraseña.
            </p>
            <div>
              {/* Sin prefetch: se visita poco (la página es de otro módulo). */}
              <Link href="/cuenta/pin-de-firma" className="boton" prefetch={false}>
                PIN de firma
              </Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
