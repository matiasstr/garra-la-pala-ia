/**
 * Roles del sistema.
 *
 * Una persona puede tener más de un rol (por ejemplo, la dueña del consultorio
 * es `administrador` y `profesional`). La especialidad NO es un rol: es un dato
 * del profesional que define qué plantillas clínicas ve.
 */
export const ROLES = ['secretaria', 'profesional', 'administrador'] as const;
export type Rol = (typeof ROLES)[number];

export const ESPECIALIDADES = [
  'odontologia_general',
  'odontopediatria',
  'endodoncia',
  'ortodoncia',
  'periodoncia',
  'cirugia_implantes',
  'protesis',
] as const;
export type Especialidad = (typeof ESPECIALIDADES)[number];

export const NOMBRE_ESPECIALIDAD: Record<Especialidad, string> = {
  odontologia_general: 'Odontología general',
  odontopediatria: 'Odontopediatría',
  endodoncia: 'Endodoncia',
  ortodoncia: 'Ortodoncia',
  periodoncia: 'Periodoncia',
  cirugia_implantes: 'Cirugía e implantes',
  protesis: 'Prótesis',
};
