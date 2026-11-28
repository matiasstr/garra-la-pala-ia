/** Respuesta de "Reiniciar datos de prueba": si salió bien, la acción redirige a la agenda. */
export interface EstadoReinicio {
  error: string | null;
}

export const SIN_ERROR: EstadoReinicio = { error: null };
