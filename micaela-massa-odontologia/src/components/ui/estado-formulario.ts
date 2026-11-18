/** Respuesta de una acción de formulario: errores para mostrar o confirmación. */
export interface EstadoFormulario {
  ok: boolean;
  errores: string[];
  mensaje?: string;
}

export const ESTADO_INICIAL: EstadoFormulario = { ok: false, errores: [] };

export type AccionFormulario = (estado: EstadoFormulario, datos: FormData) => Promise<EstadoFormulario>;
