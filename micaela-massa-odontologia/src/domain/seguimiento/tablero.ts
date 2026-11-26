/**
 * Tablero de pendientes: estados, intentos de contacto y orden de la bandeja.
 *
 * La bandeja es común: todas las secretarias ven todos los pendientes y quien
 * lo toma queda como responsable. Cada contacto queda registrado; después de
 * 3 intentos sin respuesta el pendiente pasa a "No responde" y, si era
 * importante, le llega a la profesional.
 */
import { diasEntre, esFechaValida, sumarDias } from '../../lib/fechas';
import { ORDEN_PRIORIDAD, type Prioridad } from './reglas';

export const ESTADOS_PENDIENTE = ['abierto', 'en_curso', 'no_responde', 'resuelto', 'descartado'] as const;
export type EstadoPendiente = (typeof ESTADOS_PENDIENTE)[number];
export const ESTADOS_ACTIVOS = ['abierto', 'en_curso', 'no_responde'] as const satisfies readonly EstadoPendiente[];
export const estaActivo = (estado: EstadoPendiente): boolean => (ESTADOS_ACTIVOS as readonly EstadoPendiente[]).includes(estado);

export const NOMBRE_ESTADO_PENDIENTE: Record<EstadoPendiente, string> = {
  abierto: 'Sin tomar',
  en_curso: 'En curso',
  no_responde: 'No responde',
  resuelto: 'Resuelto',
  descartado: 'Descartado',
};

export const NOMBRE_PRIORIDAD: Record<Prioridad, string> = { alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja' };

export const CANALES_CONTACTO = ['llamada', 'whatsapp', 'instagram', 'email', 'presencial'] as const;
export type CanalContacto = (typeof CANALES_CONTACTO)[number];
export const NOMBRE_CANAL: Record<CanalContacto, string> = {
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'Email',
  presencial: 'En persona',
};

/** Qué pasó en el contacto. "No contestó" es lo único que cuenta como intento sin respuesta. */
export const RESPUESTAS_CONTACTO = ['no_contesta', 'quiere_turno', 'mas_adelante', 'lo_piensa', 'no_quiere'] as const;
export type RespuestaContacto = (typeof RESPUESTAS_CONTACTO)[number];
export const NOMBRE_RESPUESTA: Record<RespuestaContacto, string> = {
  no_contesta: 'No contestó',
  quiere_turno: 'Quiere turno',
  mas_adelante: 'Pide que lo contactemos más adelante',
  lo_piensa: 'Lo va a pensar',
  no_quiere: 'No quiere volver',
};

/** Historial de solo agregar de cada pendiente (`pendiente_acciones`). */
export const TIPOS_ACCION_PENDIENTE = ['creado', 'tomado', 'contacto', 'nueva_fecha', 'no_responde', 'resuelto', 'descartado', 'reabierto'] as const;
export type TipoAccionPendiente = (typeof TIPOS_ACCION_PENDIENTE)[number];
export const NOMBRE_ACCION: Record<TipoAccionPendiente, string> = {
  creado: 'Apareció en Pendientes',
  tomado: 'Lo tomó',
  contacto: 'Contacto',
  nueva_fecha: 'Nueva fecha de contacto',
  no_responde: 'No responde',
  resuelto: 'Resuelto',
  descartado: 'Descartado',
  reabierto: 'Volvió a la bandeja',
};

/**
 * Quién propuso la acción o la fecha. Hoy: una persona o el sistema (reglas).
 * Preparado para que una IA proponga "volver a contactar desde" a partir de lo
 * que respondió el paciente ("cobro el 10"); una persona la confirma.
 */
export const ORIGENES_ACCION = ['usuario', 'sistema', 'ia'] as const;
export type OrigenAccion = (typeof ORIGENES_ACCION)[number];

export const INTENTOS_HASTA_NO_RESPONDE = 3;

/** Intentos seguidos sin respuesta desde la última vez que contestó (o se reabrió). */
export function intentosSinRespuesta(acciones: readonly { tipo: TipoAccionPendiente; respuesta?: RespuestaContacto | null }[]): number {
  let intentos = 0;
  for (const accion of acciones) {
    if (accion.tipo === 'reabierto') intentos = 0;
    if (accion.tipo !== 'contacto') continue;
    intentos = accion.respuesta === 'no_contesta' ? intentos + 1 : 0;
  }
  return intentos;
}

export interface ResultadoContacto {
  estado: EstadoPendiente;
  intentosSinRespuesta: number;
  /** Recién ahora llegó a los 3 intentos sin respuesta. */
  pasaANoResponde: boolean;
}

/** Estado del pendiente después de registrar un contacto. */
export function estadoTrasContacto(actual: { estado: EstadoPendiente; intentosSinRespuesta: number }, respuesta: RespuestaContacto): ResultadoContacto {
  if (!estaActivo(actual.estado)) throw new RangeError('El pendiente ya está cerrado.');
  if (respuesta !== 'no_contesta') return { estado: 'en_curso', intentosSinRespuesta: 0, pasaANoResponde: false };
  const intentos = actual.intentosSinRespuesta + 1;
  const noResponde = intentos >= INTENTOS_HASTA_NO_RESPONDE;
  return { estado: noResponde ? 'no_responde' : 'en_curso', intentosSinRespuesta: intentos, pasaANoResponde: noResponde && actual.estado !== 'no_responde' };
}

/** Si no responde y era importante, se le avisa a la profesional que lo indicó. */
export const hayQueAvisarAProfesional = (resultado: ResultadoContacto, pendiente: { importante: boolean; profesionalId: string | null }): boolean =>
  resultado.pasaANoResponde && pendiente.importante && Boolean(pendiente.profesionalId);

/** "Volver a contactar el…": desde hoy y hasta dentro de un año. */
export function validarFechaDeContacto(fecha: string, hoy: string): string | null {
  if (!esFechaValida(fecha)) return 'La fecha para volver a contactar no es válida.';
  if (fecha < hoy) return 'La fecha para volver a contactar ya pasó.';
  if (fecha > sumarDias(hoy, 366)) return 'La fecha para volver a contactar es de dentro de más de un año.';
  return null;
}

export interface PendienteParaOrdenar {
  prioridad: Prioridad;
  estado: EstadoPendiente;
  escaladoAId: string | null;
  /** Último contacto o, si nunca se lo contactó, desde cuándo está pendiente (YYYY-MM-DD). */
  ultimoMovimiento: string;
  desde: Date;
}

/** Le llegó a esta profesional: no responde y era importante. */
export const esParaUsuario = (p: Pick<PendienteParaOrdenar, 'estado' | 'escaladoAId'>, usuarioId: string): boolean =>
  p.estado === 'no_responde' && p.escaladoAId === usuarioId;

export const diasSinContacto = (p: Pick<PendienteParaOrdenar, 'ultimoMovimiento'>, hoy: string): number => Math.max(0, diasEntre(p.ultimoMovimiento, hoy));

/**
 * Orden de la bandeja: primero lo que le llegó a quien mira, después por
 * prioridad y, dentro de cada prioridad, lo que lleva más días sin contacto.
 */
export function ordenarPendientes<T extends PendienteParaOrdenar>(lista: readonly T[], usuarioId: string): T[] {
  return lista.toSorted(
    (a, b) =>
      Number(esParaUsuario(b, usuarioId)) - Number(esParaUsuario(a, usuarioId)) ||
      ORDEN_PRIORIDAD[a.prioridad] - ORDEN_PRIORIDAD[b.prioridad] ||
      a.ultimoMovimiento.localeCompare(b.ultimoMovimiento) ||
      a.desde.getTime() - b.desde.getTime(),
  );
}
