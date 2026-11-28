import type { Rol } from './roles';

/**
 * Permisos atómicos. La interfaz y las rutas del servidor preguntan siempre por
 * un permiso, nunca por un rol: así un cambio de política se hace en un solo lugar.
 *
 * Se agrupan en dos zonas que la interfaz muestra bien distintas:
 * - Ficha del paciente (administrativa): la usan secretarias y profesionales.
 * - Historia clínica: solo profesionales (Ley 26.529, secreto profesional).
 */
export const PERMISOS = [
  // Ficha del paciente (zona administrativa)
  'paciente.ver_ficha',
  'paciente.editar_ficha',
  'paciente.ver_alertas_medicas',
  'notas_administrativas.gestionar',
  'adjuntos_administrativos.gestionar',
  // Agenda, seguimiento y presupuestos
  'turnos.ver',
  'turnos.gestionar',
  'seguimientos.gestionar',
  'presupuestos.gestionar',
  // Historia clínica (zona clínica)
  'hc.ver',
  'hc.registrar',
  'hc.exportar',
  'alertas_medicas.editar',
  'adjuntos_clinicos.subir',
  'consentimientos.gestionar',
  // Administración del consultorio
  'usuarios.administrar',
  'aranceles.administrar',
  'plantillas.administrar',
  'auditoria.ver',
] as const;
export type Permiso = (typeof PERMISOS)[number];

const PERMISOS_POR_ROL: Record<Rol, readonly Permiso[]> = {
  secretaria: [
    'paciente.ver_ficha',
    'paciente.editar_ficha',
    // Las alertas (alergias, anticoagulantes) se muestran para evitar errores
    // al dar turnos o recibir al paciente, aunque no ven la historia clínica.
    'paciente.ver_alertas_medicas',
    'notas_administrativas.gestionar',
    'adjuntos_administrativos.gestionar',
    'turnos.ver',
    'turnos.gestionar',
    'seguimientos.gestionar',
    'presupuestos.gestionar',
  ],
  profesional: [
    'paciente.ver_ficha',
    'paciente.editar_ficha',
    'paciente.ver_alertas_medicas',
    'notas_administrativas.gestionar',
    // El profesional puede dar el próximo turno desde el sillón: es la mejor
    // forma de que un tratamiento no quede a medias.
    'turnos.ver',
    'turnos.gestionar',
    'seguimientos.gestionar',
    'hc.ver',
    'hc.registrar',
    'hc.exportar',
    'alertas_medicas.editar',
    'adjuntos_clinicos.subir',
    'consentimientos.gestionar',
  ],
  administrador: [
    'paciente.ver_ficha',
    'turnos.ver',
    'usuarios.administrar',
    'aranceles.administrar',
    'plantillas.administrar',
    'auditoria.ver',
  ],
};

export interface UsuarioConRoles {
  id: string;
  roles: readonly Rol[];
  activo: boolean;
  /** Matrícula profesional. Obligatoria para firmar registros clínicos. */
  matricula?: string | null;
}

/** Permisos efectivos: la unión de los permisos de todos sus roles. */
export function permisosDe(usuario: UsuarioConRoles): ReadonlySet<Permiso> {
  if (!usuario.activo) return new Set();
  return new Set(usuario.roles.flatMap((rol) => PERMISOS_POR_ROL[rol]));
}

export function puede(usuario: UsuarioConRoles, permiso: Permiso): boolean {
  return permisosDe(usuario).has(permiso);
}

/**
 * Solo firma un profesional activo con matrícula cargada (Ley 26.529, art. 15:
 * cada asiento lleva firma y sello del profesional).
 */
export function puedeFirmarRegistroClinico(usuario: UsuarioConRoles): boolean {
  return puede(usuario, 'hc.registrar') && Boolean(usuario.matricula?.trim());
}

/**
 * Un registro firmado nunca se edita. Se corrige con una enmienda, y solo la
 * puede hacer quien lo firmó; otro profesional agrega su propia evolución.
 */
export function puedeEnmendar(usuario: UsuarioConRoles, registro: { autorId: string }): boolean {
  return puedeFirmarRegistroClinico(usuario) && registro.autorId === usuario.id;
}

/** Zona de la interfaz a la que pertenece cada permiso. */
export function zonaDe(permiso: Permiso): 'ficha' | 'historia_clinica' | 'administracion' {
  if (permiso.startsWith('hc.') || ['alertas_medicas.editar', 'adjuntos_clinicos.subir', 'consentimientos.gestionar'].includes(permiso)) {
    return 'historia_clinica';
  }
  if (['usuarios.administrar', 'aranceles.administrar', 'plantillas.administrar', 'auditoria.ver'].includes(permiso)) {
    return 'administracion';
  }
  return 'ficha';
}
