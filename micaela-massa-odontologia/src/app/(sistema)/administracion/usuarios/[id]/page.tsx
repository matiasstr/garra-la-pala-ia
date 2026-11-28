import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { fichaDeUsuario } from '@/server/acceso/administracion';
import { usuarioActual } from '@/server/sesion';
import { actualizarUsuarioAccion } from '../acciones';
import { AccionUsuario } from '../AccionUsuario';
import { FormularioUsuario } from '../FormularioUsuario';
import { ESTADO_ACCESO, ESTADO_PIN, NOMBRE_MOVIMIENTO, NOMBRE_ROL, cuando, nombresDeEspecialidades } from '../formato';

export const metadata: Metadata = { title: 'Usuario · Micaela Massa Odontología' };

export default async function PaginaUsuario({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await usuarioActual();
  if (!puede(admin, 'usuarios.administrar')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no puede administrar usuarios." />
      </main>
    );
  }
  const usuario = await fichaDeUsuario(await baseDeDatos(), admin, id);
  if (!usuario) notFound();
  const esVos = usuario.id === admin.id;
  const desactivado = usuario.estado === 'desactivado';

  return (
    <main className="contenedor pila">
      <header className="encabezado" style={{ marginBottom: 0 }}>
        <div>
          <h1>
            {usuario.nombre} {usuario.apellido}
          </h1>
          <p className="suave" style={{ margin: '4px 0 0' }}>
            {usuario.email}
          </p>
        </div>
        <Link href="/administracion/usuarios">Volver a usuarios</Link>
      </header>

      <div className="columnas">
        <section className="tarjeta pila" aria-labelledby="titulo-acceso">
          <h2 id="titulo-acceso">Acceso</h2>
          <p style={{ margin: 0 }}>
            <span className={`estado ${ESTADO_ACCESO[usuario.estado].clase}`}>{ESTADO_ACCESO[usuario.estado].texto}</span>
          </p>
          <ul className="lista-simple">
            <li>Roles: {usuario.roles.map((r) => NOMBRE_ROL[r]).join(', ') || 'ninguno'}</li>
            {usuario.matricula && (
              <li>
                Matrícula {usuario.matricula}
                {usuario.especialidades.length ? ` · ${nombresDeEspecialidades(usuario.especialidades)}` : ''}
              </li>
            )}
            <li>Contraseña: {usuario.tieneClave ? 'elegida' : 'todavía no la eligió'}</li>
            <li>Verificación en dos pasos: {usuario.tieneVerificacion ? 'configurada' : 'sin configurar'}</li>
            {usuario.pinDeFirma && <li>PIN de firma: {ESTADO_PIN[usuario.pinDeFirma]}</li>}
            {usuario.enlaceVenceEn && <li>Tiene un enlace pendiente que vence el {cuando(usuario.enlaceVenceEn).toLowerCase()}.</li>}
            <li>{usuario.ultimoIngresoEn ? `Último ingreso: ${cuando(usuario.ultimoIngresoEn).toLowerCase()}` : 'Nunca ingresó.'}</li>
          </ul>

          {esVos ? (
            <p className="suave" style={{ margin: 0 }}>
              Es tu usuario: tu contraseña y tu verificación las cambiás desde <Link href="/cuenta">Mi cuenta</Link>.
            </p>
          ) : desactivado ? (
            <AccionUsuario usuarioId={usuario.id} nombre={usuario.nombre} accion="reactivar" texto="Reactivar" confirmacion={`${usuario.nombre} va a poder volver a entrar con su contraseña y su app.`} />
          ) : (
            <div className="pila">
              {(!usuario.tieneClave || !usuario.tieneVerificacion) && (
                <AccionUsuario
                  usuarioId={usuario.id}
                  nombre={usuario.nombre}
                  accion="enlace_nuevo"
                  texto="Generar un enlace nuevo"
                  confirmacion="El enlace anterior deja de servir."
                />
              )}
              {usuario.tieneClave && (
                <AccionUsuario
                  usuarioId={usuario.id}
                  nombre={usuario.nombre}
                  accion="blanquear_clave"
                  texto="Blanquear la contraseña"
                  confirmacion={`La contraseña de ${usuario.nombre} deja de servir y se cierran sus sesiones. Te damos un enlace para que elija otra; su app de autenticación sigue igual.`}
                />
              )}
              {usuario.tieneVerificacion && (
                <AccionUsuario
                  usuarioId={usuario.id}
                  nombre={usuario.nombre}
                  accion="blanquear_verificacion"
                  texto="Blanquear la verificación en dos pasos"
                  confirmacion={`Para cuando ${usuario.nombre} perdió o cambió el celular. Su app y sus códigos de recuperación dejan de servir y se cierran sus sesiones. Con el enlace y su contraseña configura la app de nuevo.`}
                />
              )}
              {/* Para toda profesional, aunque todavía no tenga PIN: si el botón desapareciera al restablecerlo, se perdería el aviso. */}
              {usuario.pinDeFirma && (
                <AccionUsuario
                  usuarioId={usuario.id}
                  nombre={usuario.nombre}
                  accion="restablecer_pin"
                  texto="Restablecer PIN de firma"
                  confirmacion={`Para cuando ${usuario.nombre} se olvidó su PIN de firma o lo tiene bloqueado. Su PIN deja de servir y, hasta que cree uno nuevo en "Mi cuenta" → "PIN de firma", no puede firmar. Lo que ya firmó no cambia. Nadie más conoce ni elige su PIN nuevo.`}
                />
              )}
              <AccionUsuario
                usuarioId={usuario.id}
                nombre={usuario.nombre}
                accion="desactivar"
                texto="Desactivar"
                peligro
                confirmacion={`${usuario.nombre} no va a poder entrar más a este consultorio y se cierran sus sesiones. No se borra nada: lo que registró queda con su nombre y se puede reactivar.`}
              />
            </div>
          )}
        </section>

        <section className="tarjeta pila" aria-labelledby="titulo-datos">
          <h2 id="titulo-datos">Datos y roles</h2>
          <FormularioUsuario
            accion={actualizarUsuarioAccion.bind(null, usuario.id)}
            inicial={{ email: usuario.email, nombre: usuario.nombre, apellido: usuario.apellido, roles: usuario.roles, matricula: usuario.matricula, especialidades: usuario.especialidades }}
            textoBoton="Guardar cambios"
          />
        </section>

        <section className="tarjeta pila" aria-labelledby="titulo-movimientos">
          <h2 id="titulo-movimientos">Movimientos</h2>
          {usuario.movimientos.length ? (
            <ul className="lista-simple">
              {usuario.movimientos.map((m, i) => (
                <li key={i}>
                  <strong>{NOMBRE_MOVIMIENTO[m.accion] ?? m.accion}</strong>
                  <div className="suave">
                    {cuando(m.ocurridoEn)} · {m.quien}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="suave" style={{ margin: 0 }}>
              Sin movimientos.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
