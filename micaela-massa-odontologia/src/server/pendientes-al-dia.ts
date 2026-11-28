import 'server-only';
import { cache } from 'react';
import { baseDeDatos } from '../db/client';
import { puede } from '../domain/permisos/permisos';
import { contarPendientesParaHoy, recalcularPendientes } from './pendientes';
import { usuarioActual } from './sesion';

/**
 * Sin tareas programadas, los pendientes que "vencen" con el paso del tiempo
 * (por ejemplo, el control de 6 meses) aparecen cuando alguien abre el sistema.
 * El recálculo corre una sola vez por pedido, aunque lo pidan el encabezado y
 * la página, y como mucho una vez por minuto fuera del tablero.
 */
const CADA_MS = 60_000;
const estado = globalThis as typeof globalThis & { __ultimoRecalculoPendientes?: number };

export const recalcularEnEstePedido = cache(async (): Promise<void> => {
  const usuario = await usuarioActual();
  if (!puede(usuario, 'seguimientos.gestionar')) return;
  await recalcularPendientes(await baseDeDatos(), usuario);
  estado.__ultimoRecalculoPendientes = Date.now();
});

/** Para el contador de la navegación: recalcula si pasó más de un minuto y cuenta. */
export const pendientesParaHoy = cache(async (): Promise<number> => {
  const usuario = await usuarioActual();
  if (!puede(usuario, 'seguimientos.gestionar')) return 0;
  if (Date.now() - (estado.__ultimoRecalculoPendientes ?? 0) > CADA_MS) await recalcularEnEstePedido();
  return contarPendientesParaHoy(await baseDeDatos(), usuario);
});
