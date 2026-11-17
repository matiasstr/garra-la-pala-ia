/**
 * Reglas del tablero de pendientes: detectan pacientes que se pueden perder y
 * generan un aviso para que una secretaria haga el seguimiento.
 *
 * Son funciones puras: reciben la situación del paciente y devuelven los
 * pendientes. Un proceso periódico las corre y crea las filas en `pendientes`.
 */

export const TIPOS_PENDIENTE = [
  'tratamiento_sin_turno',
  'presupuesto_sin_respuesta',
  'ausente_sin_reprogramar',
  'control_periodico',
  'conversacion_sin_respuesta',
  'manual',
] as const;
export type TipoPendiente = (typeof TIPOS_PENDIENTE)[number];

export type Prioridad = 'alta' | 'media' | 'baja';

export interface Pendiente {
  tipo: TipoPendiente;
  pacienteId: string;
  prioridad: Prioridad;
  /** Desde cuándo está pendiente. */
  desde: Date;
  detalle: string;
}

export interface ConfiguracionSeguimiento {
  diasPresupuestoSinRespuesta: number;
  diasAusenteSinReprogramar: number;
  mesesControlPeriodico: number;
  horasConversacionSinRespuesta: number;
}

export const CONFIGURACION_POR_DEFECTO: ConfiguracionSeguimiento = {
  diasPresupuestoSinRespuesta: 5,
  diasAusenteSinReprogramar: 1,
  mesesControlPeriodico: 6,
  horasConversacionSinRespuesta: 48,
};

export interface SituacionPaciente {
  pacienteId: string;
  tieneTurnoFuturo: boolean;
  /** Tratamiento empezado y no terminado (por ejemplo, una endodoncia a medias). */
  tratamientoEnCurso?: { desde: Date; descripcion: string } | null;
  presupuestosSinRespuesta?: readonly { entregadoEn: Date }[];
  ultimaAusencia?: Date | null;
  ultimoControl?: Date | null;
  /** Último mensaje del paciente (WhatsApp o Instagram, Versión 2). */
  ultimoMensajeEntrante?: { recibidoEn: Date; respondido: boolean } | null;
}

const HORA = 3_600_000;
const DIA = 24 * HORA;

function sumarMeses(fecha: Date, meses: number): Date {
  const resultado = new Date(fecha);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);
  return resultado;
}

export function detectarPendientes(
  situacion: SituacionPaciente,
  ahora: Date,
  config: ConfiguracionSeguimiento = CONFIGURACION_POR_DEFECTO,
): Pendiente[] {
  const { pacienteId } = situacion;
  const pendientes: Pendiente[] = [];

  const tratamiento = situacion.tratamientoEnCurso;
  if (tratamiento && !situacion.tieneTurnoFuturo) {
    pendientes.push({
      tipo: 'tratamiento_sin_turno',
      pacienteId,
      prioridad: 'alta',
      desde: tratamiento.desde,
      detalle: `Tratamiento en curso sin próximo turno: ${tratamiento.descripcion}.`,
    });
  }

  if (situacion.ultimaAusencia && !situacion.tieneTurnoFuturo) {
    const limite = situacion.ultimaAusencia.getTime() + config.diasAusenteSinReprogramar * DIA;
    if (ahora.getTime() >= limite) {
      pendientes.push({
        tipo: 'ausente_sin_reprogramar',
        pacienteId,
        prioridad: 'alta',
        desde: situacion.ultimaAusencia,
        detalle: 'Faltó al último turno y no se reprogramó.',
      });
    }
  }

  const mensaje = situacion.ultimoMensajeEntrante;
  if (mensaje && !mensaje.respondido && ahora.getTime() - mensaje.recibidoEn.getTime() >= config.horasConversacionSinRespuesta * HORA) {
    pendientes.push({
      tipo: 'conversacion_sin_respuesta',
      pacienteId,
      prioridad: 'alta',
      desde: mensaje.recibidoEn,
      detalle: `Mensaje sin responder hace más de ${config.horasConversacionSinRespuesta} horas.`,
    });
  }

  const presupuestosVencidos = (situacion.presupuestosSinRespuesta ?? []).filter(
    (p) => ahora.getTime() - p.entregadoEn.getTime() >= config.diasPresupuestoSinRespuesta * DIA,
  );
  const masViejo = presupuestosVencidos.toSorted((a, b) => a.entregadoEn.getTime() - b.entregadoEn.getTime())[0];
  if (masViejo) {
    pendientes.push({
      tipo: 'presupuesto_sin_respuesta',
      pacienteId,
      prioridad: 'media',
      desde: masViejo.entregadoEn,
      detalle: `Presupuesto entregado hace más de ${config.diasPresupuestoSinRespuesta} días sin respuesta.`,
    });
  }

  if (situacion.ultimoControl && !situacion.tieneTurnoFuturo) {
    const vence = sumarMeses(situacion.ultimoControl, config.mesesControlPeriodico);
    if (ahora.getTime() >= vence.getTime()) {
      pendientes.push({
        tipo: 'control_periodico',
        pacienteId,
        prioridad: 'baja',
        desde: vence,
        detalle: `Le toca el control de los ${config.mesesControlPeriodico} meses.`,
      });
    }
  }

  const orden: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };
  return pendientes.sort((a, b) => orden[a.prioridad] - orden[b.prioridad] || a.desde.getTime() - b.desde.getTime());
}
