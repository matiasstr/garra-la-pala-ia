/**
 * Identificación segura de pacientes: evita duplicados y avisa de homónimos,
 * para que nadie cargue datos en la historia clínica equivocada.
 */

export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-zñ0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "30.123.456" → "30123456". Devuelve `null` si no parece un documento. */
export function normalizarDocumento(documento: string): string | null {
  const digitos = documento.replace(/\D/g, '').replace(/^0+/, '');
  return digitos.length >= 6 && digitos.length <= 9 ? digitos : null;
}

export interface DatosIdentificacion {
  documento: string;
  nombre: string;
  apellido: string;
  /** YYYY-MM-DD */
  fechaNacimiento: string;
}

export interface PacienteExistente extends DatosIdentificacion {
  id: string;
}

export type MotivoCoincidencia =
  /** Mismo documento: es el mismo paciente, no se puede crear otro. */
  | 'mismo_documento'
  /** Mismo nombre y fecha de nacimiento: muy probablemente el mismo paciente. */
  | 'mismo_nombre_y_nacimiento'
  /** Mismo nombre completo: homónimo, hay que avisar en cada búsqueda y turno. */
  | 'homonimo';

export interface Coincidencia {
  paciente: PacienteExistente;
  motivo: MotivoCoincidencia;
  bloqueante: boolean;
}

const nombreCompleto = (p: Pick<DatosIdentificacion, 'nombre' | 'apellido'>) => normalizarTexto(`${p.apellido} ${p.nombre}`);

export function buscarCoincidencias(nuevo: DatosIdentificacion, existentes: readonly PacienteExistente[]): Coincidencia[] {
  const documento = normalizarDocumento(nuevo.documento);
  const nombre = nombreCompleto(nuevo);
  const coincidencias: Coincidencia[] = [];

  for (const paciente of existentes) {
    if (documento && normalizarDocumento(paciente.documento) === documento) {
      coincidencias.push({ paciente, motivo: 'mismo_documento', bloqueante: true });
    } else if (nombreCompleto(paciente) === nombre) {
      const mismoNacimiento = paciente.fechaNacimiento === nuevo.fechaNacimiento;
      coincidencias.push({
        paciente,
        motivo: mismoNacimiento ? 'mismo_nombre_y_nacimiento' : 'homonimo',
        bloqueante: false,
      });
    }
  }
  const orden: Record<MotivoCoincidencia, number> = { mismo_documento: 0, mismo_nombre_y_nacimiento: 1, homonimo: 2 };
  return coincidencias.sort((a, b) => orden[a.motivo] - orden[b.motivo]);
}

/** Edad en años cumplidos a una fecha. */
export function edad(fechaNacimiento: string, hoy: Date = new Date()): number {
  const [anio, mes, dia] = fechaNacimiento.split('-').map(Number);
  if (!anio || !mes || !dia) throw new RangeError(`Fecha inválida: ${fechaNacimiento}`);
  let anios = hoy.getFullYear() - anio;
  const cumpleEsteAnio = hoy.getMonth() + 1 > mes || (hoy.getMonth() + 1 === mes && hoy.getDate() >= dia);
  if (!cumpleEsteAnio) anios -= 1;
  return anios;
}

/**
 * Consentimiento de menores (Código Civil y Comercial, art. 26):
 * - menos de 13 años: firman los padres o representantes;
 * - de 13 a 16: el adolescente decide en tratamientos no invasivos; en los
 *   invasivos, con asistencia de los padres;
 * - desde los 16: decide como un adulto sobre el cuidado de su cuerpo.
 * Validar los modelos con el abogado del consultorio.
 */
export function quienConsiente(fechaNacimiento: string, invasivo: boolean, hoy: Date = new Date()): 'representante' | 'paciente_con_representante' | 'paciente' {
  const anios = edad(fechaNacimiento, hoy);
  if (anios >= 16) return 'paciente';
  if (anios >= 13) return invasivo ? 'paciente_con_representante' : 'paciente';
  return 'representante';
}
