import { describe, expect, it } from 'vitest';
import { HASH_GENESIS, VERSION_FIRMA, calcularHashRegistro, canonicalizar, verificarCadena, type RegistroEncadenado } from './encadenamiento';

describe('canonicalizar', () => {
  it('ordena las claves para que el hash no dependa del orden', () => {
    expect(canonicalizar({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    expect(canonicalizar({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it('serializa fechas en ISO UTC', () => {
    expect(canonicalizar({ f: new Date('2026-11-17T10:00:00-03:00') })).toBe('{"f":"2026-11-17T13:00:00.000Z"}');
  });

  it('rechaza valores que no se pueden firmar', () => {
    expect(() => canonicalizar({ n: Number.NaN })).toThrow();
    expect(() => canonicalizar({ f: () => 1 })).toThrow();
  });
});

function cadena(contenidos: unknown[]): RegistroEncadenado[] {
  const registros: RegistroEncadenado[] = [];
  let hashAnterior = HASH_GENESIS;
  contenidos.forEach((contenido, i) => {
    const datos = {
      historiaClinicaId: 'hc-1',
      secuencia: i + 1,
      tipo: 'evolucion',
      contenido,
      autorId: 'prof-1',
      firmadoEn: new Date(Date.UTC(2026, 10, 17, 12, i)),
      hashAnterior,
      especialidad: 'endodoncia',
      turnoId: `turno-${i + 1}`,
    };
    const hash = calcularHashRegistro(datos);
    registros.push({ ...datos, hash });
    hashAnterior = hash;
  });
  return registros;
}

describe('verificarCadena', () => {
  const registros = cadena([{ texto: 'Consulta inicial' }, { texto: 'Obturación 36 O' }, { texto: 'Control' }]);

  it('una cadena íntegra verifica', () => {
    expect(verificarCadena(registros)).toEqual({ valida: true });
    expect(verificarCadena(registros.toReversed())).toEqual({ valida: true });
  });

  it('detecta un contenido alterado', () => {
    const alterada = registros.map((r) => (r.secuencia === 2 ? { ...r, contenido: { texto: 'Obturación 46 O' } } : r));
    expect(verificarCadena(alterada)).toMatchObject({ valida: false, secuencia: 2 });
  });

  it('detecta un registro borrado', () => {
    expect(verificarCadena(registros.filter((r) => r.secuencia !== 2))).toMatchObject({ valida: false, secuencia: 2 });
  });

  it('detecta un cambio de turno o de especialidad (versión 2)', () => {
    expect(VERSION_FIRMA).toBe(2);
    const otroTurno = registros.map((r) => (r.secuencia === 2 ? { ...r, turnoId: 'turno-de-otro-dia' } : r));
    expect(verificarCadena(otroTurno)).toMatchObject({ valida: false, secuencia: 2 });
    const sinTurno = registros.map((r) => (r.secuencia === 2 ? { ...r, turnoId: null } : r));
    expect(verificarCadena(sinTurno)).toMatchObject({ valida: false, secuencia: 2 });
    const otraEspecialidad = registros.map((r) => (r.secuencia === 3 ? { ...r, especialidad: 'odontologia_general' } : r));
    expect(verificarCadena(otraEspecialidad)).toMatchObject({ valida: false, secuencia: 3 });
  });

  it('sin turno ni especialidad, null y ausente firman igual (una fila de la base trae null)', () => {
    const datos = { historiaClinicaId: 'hc-1', secuencia: 1, tipo: 'evolucion', contenido: { texto: 'x' }, autorId: 'p', firmadoEn: new Date(0), hashAnterior: HASH_GENESIS };
    expect(calcularHashRegistro({ ...datos, turnoId: null, especialidad: null })).toBe(calcularHashRegistro(datos));
  });

  it('detecta un cambio de autor o de fecha', () => {
    const otroAutor = registros.map((r) => (r.secuencia === 1 ? { ...r, autorId: 'prof-2' } : r));
    expect(verificarCadena(otroAutor)).toMatchObject({ valida: false, secuencia: 1 });
    const otraFecha = registros.map((r) => (r.secuencia === 3 ? { ...r, firmadoEn: new Date(0) } : r));
    expect(verificarCadena(otraFecha)).toMatchObject({ valida: false, secuencia: 3 });
  });
});
