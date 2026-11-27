import { NOMBRE_ESPECIALIDAD, type Especialidad, type Rol } from '@/domain/permisos/roles';
import { capitalizar, fechaDe, formatoFechaLarga, formatoHora } from '@/lib/fechas';

export const NOMBRE_ROL: Record<Rol, string> = { secretaria: 'Secretaria', profesional: 'Profesional', administrador: 'Administración' };

export const DESCRIPCION_ROL: Record<Rol, string> = {
  secretaria: 'Agenda, pacientes y seguimiento. No ve la historia clínica.',
  profesional: 'Historia clínica, odontograma y firma. Necesita matrícula.',
  administrador: 'Usuarios, aranceles y auditoría del consultorio.',
};

export const ESTADO_ACCESO: Record<'activo' | 'falta_configurar' | 'desactivado', { texto: string; clase: string }> = {
  activo: { texto: 'Activo', clase: 'estado-atendido' },
  falta_configurar: { texto: 'Falta configurar el acceso', clase: 'estado-en_sala' },
  desactivado: { texto: 'Desactivado', clase: 'estado-cancelado' },
};

export const NOMBRE_MOVIMIENTO: Record<string, string> = {
  'usuario.crear': 'Alta del usuario',
  'usuario.editar': 'Cambio de datos o roles',
  'usuario.desactivar': 'Desactivado',
  'usuario.reactivar': 'Reactivado',
  'usuario.blanquear_clave': 'Contraseña blanqueada',
  'usuario.blanquear_verificacion': 'Verificación en dos pasos blanqueada',
  'usuario.enlace_nuevo': 'Enlace nuevo para configurar el acceso',
  'cuenta.definir_clave': 'Eligió su contraseña',
  'cuenta.cambiar_clave': 'Cambió su contraseña',
  'cuenta.configurar_verificacion': 'Configuró la verificación en dos pasos',
  'cuenta.nuevos_codigos_de_recuperacion': 'Generó códigos de recuperación nuevos',
  'sesion.cerrar_otras': 'Cerró sus otras sesiones',
};

export const nombresDeEspecialidades = (lista: readonly Especialidad[]) => lista.map((e) => NOMBRE_ESPECIALIDAD[e]).join(', ');

export const cuando = (instante: Date): string => `${capitalizar(formatoFechaLarga(fechaDe(instante)))} a las ${formatoHora(instante)}`;
