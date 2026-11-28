/**
 * Mensaje de WhatsApp para retomar el contacto, listo para abrir con un clic.
 * Solo se ofrece si el paciente dio permiso para mensajes, y nunca lleva
 * información clínica: ni el tratamiento ni el motivo del turno.
 */
import { normalizarTelefonoArgentino } from '../agenda/turnos';
import type { TipoPendiente } from './reglas';

const CONSULTORIO = 'Micaela Massa Odontología';

export function textoWhatsAppSeguimiento(tipo: TipoPendiente, nombrePaciente: string): string {
  const saludo = `Hola ${nombrePaciente}, te escribimos de ${CONSULTORIO}.`;
  switch (tipo) {
    case 'ausente_sin_reprogramar':
      return `${saludo} Te esperábamos en tu último turno y no pudiste venir. ¿Querés que coordinemos uno nuevo? ¿Qué día y horario te queda cómodo?`;
    case 'presupuesto_sin_respuesta':
      return `${saludo} ¿Pudiste ver el presupuesto? Si tenés dudas o querés coordinar un turno, respondenos por acá.`;
    case 'conversacion_sin_respuesta':
      return `${saludo} Perdón la demora en responderte. ¿En qué te podemos ayudar?`;
    default:
      return `${saludo} Queremos coordinar tu próximo turno. ¿Qué día y horario te queda cómodo?`;
  }
}

export function enlaceWhatsAppSeguimiento(opciones: { telefono: string; nombrePaciente: string; tipo: TipoPendiente }): string {
  return `https://wa.me/${normalizarTelefonoArgentino(opciones.telefono)}?text=${encodeURIComponent(textoWhatsAppSeguimiento(opciones.tipo, opciones.nombrePaciente))}`;
}
