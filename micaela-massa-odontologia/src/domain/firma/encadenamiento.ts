import { createHash } from 'node:crypto';

/**
 * Integridad de la historia clínica (Ley 26.529 art. 13 y Ley 27.706: la HC
 * electrónica tiene que ser auténtica e inalterable).
 *
 * Cada registro clínico guarda el hash SHA-256 de su contenido y el hash del
 * registro anterior de la misma historia clínica. Si alguien modificara un
 * registro viejo directamente en la base, la cadena deja de verificar desde ese
 * punto. La base además impide UPDATE y DELETE sobre estas tablas.
 *
 * Este hash es la base de la firma electrónica de cada evolución. Cuando se
 * sume firma digital (Ley 25.506), lo que se firma con el certificado del
 * profesional es este mismo hash.
 */

/** Hash "anterior" del primer registro de cada historia clínica. */
export const HASH_GENESIS = '0'.repeat(64);

/**
 * JSON canónico: claves ordenadas, sin espacios, fechas en ISO 8601 UTC.
 * Garantiza que el mismo contenido produzca siempre el mismo hash, venga de
 * donde venga (por ejemplo, de un `jsonb` de Postgres, que reordena las claves).
 */
export function canonicalizar(valor: unknown): string {
  if (valor === null) return 'null';
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  switch (typeof valor) {
    case 'string':
    case 'boolean':
      return JSON.stringify(valor);
    case 'number':
      if (!Number.isFinite(valor)) throw new TypeError('No se pueden firmar números no finitos.');
      return JSON.stringify(valor);
    case 'object': {
      if (Array.isArray(valor)) return `[${valor.map((v) => canonicalizar(v === undefined ? null : v)).join(',')}]`;
      const entradas = Object.entries(valor as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${entradas.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizar(v)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`Tipo no firmable: ${typeof valor}`);
  }
}

export interface DatosFirmables {
  historiaClinicaId: string;
  secuencia: number;
  tipo: string;
  contenido: unknown;
  autorId: string;
  firmadoEn: Date;
  hashAnterior: string;
  enmiendaDe?: string | null;
  /** Especialidad con la que se firmó (por ejemplo, endodoncia). */
  especialidad?: string | null;
  /** Turno en el que se atendió: vincula la evolución con la visita. */
  turnoId?: string | null;
}

/**
 * Versión del contenido firmable. La 2 agrega `especialidad` y `turnoId`: en
 * la 1 se podía cambiar en la base con qué turno o especialidad se firmó un
 * registro sin que la cadena lo detectara. No hay datos reales firmados con
 * la 1; las bases de desarrollo viejas se arreglan con `npm run db:reset`.
 */
export const VERSION_FIRMA = 2;

export interface RegistroEncadenado extends DatosFirmables {
  hash: string;
}

export function calcularHashRegistro(datos: DatosFirmables): string {
  // Campos explícitos: un objeto con propiedades extra (por ejemplo, una fila
  // de la base con su `hash`) produce el mismo resultado.
  const firmable = {
    version: VERSION_FIRMA,
    historiaClinicaId: datos.historiaClinicaId,
    secuencia: datos.secuencia,
    tipo: datos.tipo,
    contenido: datos.contenido,
    autorId: datos.autorId,
    firmadoEn: datos.firmadoEn,
    hashAnterior: datos.hashAnterior,
    enmiendaDe: datos.enmiendaDe ?? null,
    especialidad: datos.especialidad ?? null,
    turnoId: datos.turnoId ?? null,
  };
  return createHash('sha256').update(canonicalizar(firmable), 'utf8').digest('hex');
}

export type ResultadoVerificacion = { valida: true } | { valida: false; secuencia: number; motivo: string };

/** Verifica la cadena completa de una historia clínica (registros en cualquier orden). */
export function verificarCadena(registros: readonly RegistroEncadenado[]): ResultadoVerificacion {
  const ordenados = registros.toSorted((a, b) => a.secuencia - b.secuencia);
  let hashAnterior = HASH_GENESIS;
  for (const [i, registro] of ordenados.entries()) {
    const esperada = i + 1;
    if (registro.secuencia !== esperada) {
      return { valida: false, secuencia: esperada, motivo: `Falta el registro ${esperada}.` };
    }
    if (registro.hashAnterior !== hashAnterior) {
      return { valida: false, secuencia: registro.secuencia, motivo: 'No está encadenado al registro anterior.' };
    }
    if (calcularHashRegistro(registro) !== registro.hash) {
      return { valida: false, secuencia: registro.secuencia, motivo: 'El contenido no coincide con su hash: fue alterado.' };
    }
    hashAnterior = registro.hash;
  }
  return { valida: true };
}
