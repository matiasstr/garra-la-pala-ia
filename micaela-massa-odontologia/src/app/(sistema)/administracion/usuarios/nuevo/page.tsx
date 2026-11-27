import type { Metadata } from 'next';
import Link from 'next/link';
import { SinAcceso } from '@/components/ui/Etiquetas';
import { puede } from '@/domain/permisos/permisos';
import { usuarioActual } from '@/server/sesion';
import { crearUsuarioAccion } from '../acciones';
import { FormularioUsuario } from '../FormularioUsuario';

export const metadata: Metadata = { title: 'Nuevo usuario · Micaela Massa Odontología' };

export default async function PaginaNuevoUsuario() {
  const usuario = await usuarioActual();
  if (!puede(usuario, 'usuarios.administrar')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no puede administrar usuarios." />
      </main>
    );
  }
  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Nuevo usuario</h1>
        <Link href="/administracion/usuarios">Volver</Link>
      </header>
      <section className="tarjeta pila">
        <p className="suave" style={{ margin: 0 }}>
          Al guardar te damos un enlace de un solo uso para pasarle a la persona: con él elige su contraseña y configura la verificación en dos pasos en su celular.
        </p>
        <FormularioUsuario accion={crearUsuarioAccion} textoBoton="Crear usuario" />
      </section>
    </main>
  );
}
