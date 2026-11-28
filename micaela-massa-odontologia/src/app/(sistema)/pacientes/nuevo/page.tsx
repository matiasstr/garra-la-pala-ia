import type { Metadata } from 'next';
import Link from 'next/link';
import { SinAcceso } from '@/components/ui/Etiquetas';
import { baseDeDatos } from '@/db/client';
import { puede } from '@/domain/permisos/permisos';
import { hoyEnArgentina } from '@/lib/fechas';
import { listarFinanciadores } from '@/server/pacientes';
import { usuarioActual } from '@/server/sesion';
import { FormularioPaciente } from './FormularioPaciente';

export const metadata: Metadata = { title: 'Nuevo paciente · Micaela Massa Odontología' };

export default async function PaginaNuevoPaciente() {
  const usuario = await usuarioActual();
  if (!puede(usuario, 'paciente.editar_ficha')) {
    return (
      <main className="contenedor">
        <SinAcceso mensaje="Tu usuario no puede cargar pacientes." />
      </main>
    );
  }
  const financiadores = await listarFinanciadores(await baseDeDatos());
  return (
    <main className="contenedor">
      <header className="encabezado">
        <h1>Nuevo paciente</h1>
        <Link href="/pacientes">Volver</Link>
      </header>
      <FormularioPaciente financiadores={financiadores} hoy={hoyEnArgentina()} />
    </main>
  );
}
