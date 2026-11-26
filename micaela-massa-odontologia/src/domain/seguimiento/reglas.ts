/**
 * Reglas del tablero de pendientes: detectan pacientes que se pueden perder y
 * generan un aviso para que una secretaria haga el seguimiento.
 *
 * Son funciones puras: reciben la situación del paciente y devuelven los
 * pendientes. El servidor las corre al abrir el tablero y después de cada
 * cambio relevante (turno nuevo, atendido, ausente), y crea o resuelve las
 * filas de `pendientes` sin duplicarlas (ver `src/server/pendientes.ts`).
 *
 * La que manda es la profesional: si indicó "¿Cuándo debería volver?", el
 * pendiente sigue ese plazo. Si no indicó nada, el sistema no inventa plazos:
 * muestra el caso y el tablero lo ordena por días sin contacto.
 */
import { fechaDe, fechaHoraArgentina, formatoFechaCorta, sumarDias } from '../../lib/fechas';
import { PLAZO_EN_TEXTO, contactarDesdeSegunPlazo, esPlazoLargo, fechaEsperadaDeRegreso, tienePlazo, type PlazoRegreso } from './regreso';

export const TIPOS_PENDIENTE = [
  'tratamiento_sin_turno',
  'presupuesto_sin_respuesta',
  'ausente_sin_reprogramar',
  'control_periodico',
  'conversacion_sin_respuesta',
  'manual',
] as const;
export type TipoPendiente = (typeof TIPOS_PENDIENTE)[number];

/** Motivo, en palabras de la recepción (filtros y etiquetas del tablero). */
export const NOMBRE_TIPO_PENDIENTE: Record<TipoPendiente, string> = {
  tratamiento_sin_turno: 'Se fue sin turno',
  presupuesto_sin_respuesta: 'Presupuesto sin respuesta',
  ausente_sin_reprogramar: 'Faltó al turno',
  control_periodico: 'Control',
  conversacion_sin_respuesta: 'Mensaje sin responder',
  manual: 'Otro',
};

export const PRIORIDADES = ['alta', 'media', 'baja'] as const;
export type Prioridad = (typeof PRIORIDADES)[number];
export const ORDEN_PRIORIDAD: Record<Prioridad, number> = { alta: 0, media: 1, baja: 2 };

export interface Pendiente {
  tipo: TipoPendiente;
  pacienteId: string;
  prioridad: Prioridad;
  /** Desde cuándo está pendiente. */
  desde: Date;
  detalle: string;
  /** Identifica el caso: al recalcular, la misma clave es el mismo pendiente. */
  clave: string;
  /** Desde cuándo se muestra en el tablero. */
  apareceDesde: Date;
  /** Día sugerido para contactarlo (YYYY-MM-DD, Argentina). */
  contactarDesde: string;
  /** Día en que debería volver, si la profesional indicó un plazo. */
  fechaEsperada: string | null;
  /** "Es importante que vuelva": si no responde, le llega a la profesional. */
  importante: boolean;
  profesionalId: string | null;
  turnoId: string | null;
  indicacionId: string | null;
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

/** "¿Cuándo debería volver?" de la última visita. */
export interface IndicacionDeRegreso {
  id: string;
  plazo: PlazoRegreso;
  importante: boolean;
  /** Día de la visita en que se indicó (YYYY-MM-DD). */
  fechaVisita: string;
  /** Inicio del turno atendido o, si se cargó sin turno, cuándo se cargó. */
  referencia: Date;
  turnoId: string | null;
  profesionalId: string;
  /** Nombre de quien lo indicó, para el texto del pendiente. */
  profesional?: string | null;
}

export interface SituacionPaciente {
  pacienteId: string;
  tieneTurnoFuturo: boolean;
  /** El próximo turno, si tiene: sirve para explicar por qué se resolvió solo. */
  proximoTurno?: { turnoId: string; inicio: Date } | null;
  /** Última visita atendida. */
  ultimaVisita?: { turnoId: string; inicio: Date } | null;
  /** Última indicación de "¿Cuándo debería volver?". */
  indicacion?: IndicacionDeRegreso | null;
  /** Tratamiento empezado y no terminado (por ejemplo, una endodoncia a medias). */
  tratamientoEnCurso?: { desde: Date; descripcion: string; profesionalId?: string | null; turnoId?: string | null } | null;
  presupuestosSinRespuesta?: readonly { id?: string; entregadoEn: Date }[];
  /** Último turno al que faltó. */
  ausencia?: { turnoId: string; inicio: Date; profesionalId: string | null } | null;
  /** Igual que `ausencia`, cuando solo se conoce la fecha. */
  ultimaAusencia?: Date | null;
  /**
   * Último control, para la regla de meses fijos. El servidor no la completa:
   * los controles salen de la indicación de 3 o 6 meses.
   */
  ultimoControl?: Date | null;
  /** Último mensaje del paciente (WhatsApp o Instagram, Versión 2). */
  ultimoMensajeEntrante?: { recibidoEn: Date; respondido: boolean } | null;
}

const HORA = 3_600_000;
const DIA = 24 * HORA;

function sumarMesesInstante(fecha: Date, meses: number): Date {
  const resultado = new Date(fecha);
  resultado.setUTCMonth(resultado.getUTCMonth() + meses);
  return resultado;
}

const inicioDelDia = (fecha: string) => fechaHoraArgentina(fecha, '00:00');
const posterior = (a: Date, b: Date) => a.getTime() > b.getTime();

/**
 * Todos los casos que hoy corresponden al paciente, aunque todavía no sea
 * momento de mostrarlos (`apareceDesde` en el futuro). Sirve para saber qué
 * pendientes siguen vigentes y cuándo va a aparecer el próximo.
 */
export function evaluarPendientes(situacion: SituacionPaciente, ahora: Date, config: ConfiguracionSeguimiento = CONFIGURACION_POR_DEFECTO): Pendiente[] {
  const { pacienteId, tieneTurnoFuturo } = situacion;
  const sinDatos = { pacienteId, importante: false, profesionalId: null, turnoId: null, indicacionId: null, fechaEsperada: null };
  const pendientes: Pendiente[] = [];
  const volvioDespuesDe = (instante: Date) => Boolean(situacion.ultimaVisita && posterior(situacion.ultimaVisita.inicio, instante));

  // Una ausencia deja de contar si después volvió a atenderse.
  const ausenciaConocida =
    situacion.ausencia ?? (situacion.ultimaAusencia ? { turnoId: null, inicio: situacion.ultimaAusencia, profesionalId: null } : null);
  const ausencia = ausenciaConocida && !volvioDespuesDe(ausenciaConocida.inicio) ? ausenciaConocida : null;

  // La indicación vale hasta la próxima visita atendida.
  const indicacion = situacion.indicacion && !volvioDespuesDe(situacion.indicacion.referencia) ? situacion.indicacion : null;
  const faltoDespuesDe = (instante: Date) => Boolean(ausencia && posterior(ausencia.inicio, instante));

  if (indicacion && tienePlazo(indicacion.plazo) && !tieneTurnoFuturo && !faltoDespuesDe(indicacion.referencia)) {
    const fechaEsperada = fechaEsperadaDeRegreso(indicacion.fechaVisita, indicacion.plazo);
    const contactarDesde = contactarDesdeSegunPlazo(indicacion.fechaVisita, indicacion.plazo);
    if (fechaEsperada && contactarDesde) {
      const largo = esPlazoLargo(indicacion.plazo);
      const apareceDesde = inicioDelDia(contactarDesde);
      const quien = indicacion.profesional ? ` Lo indicó ${indicacion.profesional}.` : '';
      pendientes.push({
        ...sinDatos,
        tipo: largo ? 'control_periodico' : 'tratamiento_sin_turno',
        prioridad: indicacion.importante ? 'alta' : largo ? 'baja' : 'media',
        desde: largo ? apareceDesde : indicacion.referencia,
        detalle: largo
          ? `Le toca volver a los ${PLAZO_EN_TEXTO[indicacion.plazo]}: hacia el ${formatoFechaCorta(fechaEsperada)}. Todavía no tiene turno.${quien}`
          : `Tenía que volver en ${PLAZO_EN_TEXTO[indicacion.plazo]} (hacia el ${formatoFechaCorta(fechaEsperada)}) y se fue sin turno.${quien}`,
        clave: `indicacion:${indicacion.id}`,
        apareceDesde,
        contactarDesde,
        fechaEsperada,
        importante: indicacion.importante,
        profesionalId: indicacion.profesionalId,
        turnoId: indicacion.turnoId,
        indicacionId: indicacion.id,
      });
    }
  }

  // Sin indicación, un tratamiento a medias igual se avisa, sin plazo inventado.
  const tratamiento = situacion.tratamientoEnCurso;
  if (tratamiento && !tieneTurnoFuturo && !indicacion && !faltoDespuesDe(tratamiento.desde)) {
    const contactarDesde = sumarDias(fechaDe(tratamiento.desde), 1);
    pendientes.push({
      ...sinDatos,
      tipo: 'tratamiento_sin_turno',
      prioridad: 'alta',
      desde: tratamiento.desde,
      detalle: `Tratamiento en curso sin próximo turno: ${tratamiento.descripcion}.`,
      clave: `tratamiento:${pacienteId}:${fechaDe(tratamiento.desde)}`,
      apareceDesde: inicioDelDia(contactarDesde),
      contactarDesde,
      profesionalId: tratamiento.profesionalId ?? null,
      turnoId: tratamiento.turnoId ?? null,
    });
  }

  if (ausencia && !tieneTurnoFuturo) {
    const apareceDesde = new Date(ausencia.inicio.getTime() + config.diasAusenteSinReprogramar * DIA);
    // Si faltó al turno que seguía a una indicación, hereda si era importante.
    const heredada = indicacion && posterior(ausencia.inicio, indicacion.referencia) ? indicacion : null;
    pendientes.push({
      ...sinDatos,
      tipo: 'ausente_sin_reprogramar',
      prioridad: 'alta',
      desde: ausencia.inicio,
      detalle: ausencia.turnoId ? `Faltó al turno del ${formatoFechaCorta(fechaDe(ausencia.inicio))} y no se reprogramó.` : 'Faltó al último turno y no se reprogramó.',
      clave: ausencia.turnoId ? `ausente:${ausencia.turnoId}` : `ausente:${pacienteId}:${ausencia.inicio.toISOString()}`,
      apareceDesde,
      contactarDesde: fechaDe(apareceDesde),
      importante: heredada?.importante ?? false,
      profesionalId: ausencia.profesionalId ?? heredada?.profesionalId ?? null,
      turnoId: ausencia.turnoId,
      indicacionId: heredada?.id ?? null,
    });
  }

  const mensaje = situacion.ultimoMensajeEntrante;
  if (mensaje && !mensaje.respondido) {
    const apareceDesde = new Date(mensaje.recibidoEn.getTime() + config.horasConversacionSinRespuesta * HORA);
    pendientes.push({
      ...sinDatos,
      tipo: 'conversacion_sin_respuesta',
      prioridad: 'alta',
      desde: mensaje.recibidoEn,
      detalle: `Mensaje sin responder hace más de ${config.horasConversacionSinRespuesta} horas.`,
      clave: `conversacion:${pacienteId}:${mensaje.recibidoEn.toISOString()}`,
      apareceDesde,
      contactarDesde: fechaDe(apareceDesde),
    });
  }

  // Un solo aviso por paciente, desde el presupuesto más viejo.
  const masViejo = (situacion.presupuestosSinRespuesta ?? []).toSorted((a, b) => a.entregadoEn.getTime() - b.entregadoEn.getTime())[0];
  if (masViejo) {
    const apareceDesde = new Date(masViejo.entregadoEn.getTime() + config.diasPresupuestoSinRespuesta * DIA);
    pendientes.push({
      ...sinDatos,
      tipo: 'presupuesto_sin_respuesta',
      prioridad: 'media',
      desde: masViejo.entregadoEn,
      detalle: `Presupuesto entregado hace más de ${config.diasPresupuestoSinRespuesta} días sin respuesta.`,
      clave: masViejo.id ? `presupuesto:${masViejo.id}` : `presupuesto:${pacienteId}:${masViejo.entregadoEn.toISOString()}`,
      apareceDesde,
      contactarDesde: fechaDe(apareceDesde),
    });
  }

  if (situacion.ultimoControl && !tieneTurnoFuturo) {
    const vence = sumarMesesInstante(situacion.ultimoControl, config.mesesControlPeriodico);
    pendientes.push({
      ...sinDatos,
      tipo: 'control_periodico',
      prioridad: 'baja',
      desde: vence,
      detalle: `Le toca el control de los ${config.mesesControlPeriodico} meses.`,
      clave: `control:${pacienteId}:${fechaDe(vence)}`,
      apareceDesde: vence,
      contactarDesde: fechaDe(vence),
    });
  }

  return pendientes;
}

/** Los pendientes que ya hay que mostrar, por prioridad y antigüedad. */
export function detectarPendientes(
  situacion: SituacionPaciente,
  ahora: Date,
  config: ConfiguracionSeguimiento = CONFIGURACION_POR_DEFECTO,
): Pendiente[] {
  return evaluarPendientes(situacion, ahora, config)
    .filter((p) => ahora.getTime() >= p.apareceDesde.getTime())
    .sort((a, b) => ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] || a.desde.getTime() - b.desde.getTime());
}

/** El próximo pendiente que va a aparecer si nada cambia (para mostrarlo en la ficha). */
export function proximoPendiente(situacion: SituacionPaciente, ahora: Date, config: ConfiguracionSeguimiento = CONFIGURACION_POR_DEFECTO): Pendiente | null {
  return (
    evaluarPendientes(situacion, ahora, config)
      .filter((p) => p.apareceDesde.getTime() > ahora.getTime())
      .toSorted((a, b) => a.apareceDesde.getTime() - b.apareceDesde.getTime())[0] ?? null
  );
}

/** Por qué un pendiente se resolvió solo, en palabras simples. */
export function motivoDeCierreAutomatico(tipo: TipoPendiente, situacion: SituacionPaciente, desde: Date): string {
  const esperaTurno = tipo !== 'presupuesto_sin_respuesta' && tipo !== 'conversacion_sin_respuesta';
  if (esperaTurno && situacion.tieneTurnoFuturo) {
    return situacion.proximoTurno ? `Sacó turno para el ${formatoFechaCorta(fechaDe(situacion.proximoTurno.inicio))}.` : 'Sacó turno.';
  }
  if (tipo === 'presupuesto_sin_respuesta') return 'El presupuesto ya tuvo respuesta.';
  if (tipo === 'conversacion_sin_respuesta') return 'El mensaje ya se respondió.';
  if (situacion.ultimaVisita && posterior(situacion.ultimaVisita.inicio, desde)) return 'Volvió al consultorio.';
  return 'Cambió la indicación de cuándo volver.';
}
