/**
 * Estados de un turno. Cada cambio de estado queda registrado (quién, cuándo,
 * por qué) para poder reconstruir la historia de turnos de un paciente.
 */
export const ESTADOS_TURNO = ['reservado', 'confirmado', 'en_sala', 'atendido', 'ausente', 'cancelado', 'reprogramado'] as const;
export type EstadoTurno = (typeof ESTADOS_TURNO)[number];

export const NOMBRE_ESTADO_TURNO: Record<EstadoTurno, string> = {
  reservado: 'Reservado',
  confirmado: 'Confirmado',
  en_sala: 'Llegó',
  atendido: 'Atendido',
  ausente: 'Ausente',
  cancelado: 'Cancelado',
  reprogramado: 'Reprogramado',
};

const TRANSICIONES: Record<EstadoTurno, readonly EstadoTurno[]> = {
  reservado: ['confirmado', 'en_sala', 'ausente', 'cancelado', 'reprogramado'],
  confirmado: ['en_sala', 'ausente', 'cancelado', 'reprogramado'],
  en_sala: ['atendido', 'cancelado'],
  atendido: [],
  ausente: ['reprogramado'],
  cancelado: [],
  reprogramado: [],
};

export function puedeCambiarEstado(desde: EstadoTurno, hacia: EstadoTurno): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

export const esEstadoFinal = (estado: EstadoTurno): boolean => TRANSICIONES[estado].length === 0;

/**
 * Mensaje de recordatorio listo para abrir en WhatsApp con un clic (Versión 1,
 * sin integración). No incluye información clínica: solo día, hora y lugar.
 */
export function enlaceRecordatorioWhatsApp(opciones: {
  telefono: string;
  nombrePaciente: string;
  inicio: Date;
  profesional: string;
  zonaHoraria?: string;
}): string {
  const zona = opciones.zonaHoraria ?? 'America/Argentina/Buenos_Aires';
  const fecha = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: zona }).format(opciones.inicio);
  const hora = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zona }).format(opciones.inicio);
  const texto =
    `Hola ${opciones.nombrePaciente}, te recordamos tu turno del ${fecha} a las ${hora} ` +
    `con ${opciones.profesional} en Micaela Massa Odontología. ¿Nos confirmás si venís? Gracias.`;
  return `https://wa.me/${normalizarTelefonoArgentino(opciones.telefono)}?text=${encodeURIComponent(texto)}`;
}

/**
 * Lleva un celular argentino al formato internacional que usa WhatsApp
 * (54 9 + característica + número, sin 0 ni 15). Ejemplos:
 * "011 15 2345-6789" → "5491123456789"; "+54 9 351 234 5678" → "5493512345678".
 */
export function normalizarTelefonoArgentino(telefono: string): string {
  let digitos = telefono.replace(/\D/g, '');
  if (digitos.startsWith('549')) return digitos;
  if (digitos.startsWith('54')) digitos = digitos.slice(2);
  if (digitos.startsWith('0')) digitos = digitos.slice(1);
  // Quita el "15" que sigue a la característica (2 a 4 dígitos) en números de 12 dígitos.
  if (digitos.length === 12) {
    for (const largo of [2, 3, 4]) {
      if (digitos.slice(largo, largo + 2) === '15') {
        digitos = digitos.slice(0, largo) + digitos.slice(largo + 2);
        break;
      }
    }
  }
  return `549${digitos}`;
}
