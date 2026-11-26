'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { baseDeDatos, reiniciarDatosDePrueba } from '@/db/client';
import { permiteReiniciarDemo, quienPideElReinicio, registrarReinicioDemo } from '@/server/demo';
import { COOKIE_USUARIO_DESARROLLO, usuarioActual } from '@/server/sesion';
import type { EstadoReinicio } from './estado';

/** Borra todo y vuelve a los datos de prueba, con turnos desde hoy. Solo en la demo. */
export async function reiniciarDatosDePruebaAccion(_estado: EstadoReinicio, _datos: FormData): Promise<EstadoReinicio> {
  // Se vuelve a verificar acá: el botón oculto no alcanza.
  if (!permiteReiniciarDemo()) return { error: 'Esta función no está disponible.' };
  const pedido = await quienPideElReinicio(await baseDeDatos(), (await usuarioActual()).id);
  try {
    await reiniciarDatosDePrueba();
    await registrarReinicioDemo(await baseDeDatos(), pedido);
  } catch (error) {
    console.error('No se pudieron reiniciar los datos de prueba:', error);
    return { error: 'No se pudieron reiniciar los datos. Esperá un minuto y probá de nuevo.' };
  }
  // Los usuarios de prueba vuelven con otro id: se empieza con el de siempre.
  (await cookies()).delete(COOKIE_USUARIO_DESARROLLO);
  revalidatePath('/', 'layout');
  redirect(`/agenda?${new URLSearchParams({ aviso: 'Listo: los datos de prueba volvieron a empezar, con turnos desde hoy.' })}`);
}
