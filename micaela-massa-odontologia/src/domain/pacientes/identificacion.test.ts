import { describe, expect, it } from 'vitest';
import { buscarCoincidencias, edad, normalizarDocumento, normalizarTexto, quienConsiente, type PacienteExistente } from './identificacion';

describe('normalización', () => {
  it('ignora tildes, mayúsculas y signos', () => {
    expect(normalizarTexto('  José  María PÉREZ-Gómez ')).toBe('jose maria perez gomez');
  });

  it('limpia el documento', () => {
    expect(normalizarDocumento('30.123.456')).toBe('30123456');
    expect(normalizarDocumento('abc')).toBeNull();
  });
});

describe('coincidencias de pacientes', () => {
  const existentes: PacienteExistente[] = [
    { id: '1', documento: '30123456', nombre: 'Juan', apellido: 'Pérez', fechaNacimiento: '1985-03-10' },
    { id: '2', documento: '40111222', nombre: 'Ana', apellido: 'López', fechaNacimiento: '1999-07-01' },
  ];

  it('bloquea un documento ya cargado', () => {
    const [primera] = buscarCoincidencias({ documento: '30.123.456', nombre: 'Juan Carlos', apellido: 'Perez', fechaNacimiento: '1985-03-10' }, existentes);
    expect(primera).toMatchObject({ motivo: 'mismo_documento', bloqueante: true });
  });

  it('avisa de homónimos sin bloquear', () => {
    const coincidencias = buscarCoincidencias({ documento: '35999888', nombre: 'juan', apellido: 'PEREZ', fechaNacimiento: '1990-01-01' }, existentes);
    expect(coincidencias).toEqual([expect.objectContaining({ motivo: 'homonimo', bloqueante: false })]);
  });

  it('marca como probable duplicado mismo nombre y nacimiento con otro documento', () => {
    const [primera] = buscarCoincidencias({ documento: '99999999', nombre: 'Ana', apellido: 'Lopez', fechaNacimiento: '1999-07-01' }, existentes);
    expect(primera?.motivo).toBe('mismo_nombre_y_nacimiento');
  });
});

describe('edad y consentimiento', () => {
  const hoy = new Date(2026, 10, 17);

  it('calcula años cumplidos', () => {
    expect(edad('2016-11-17', hoy)).toBe(10);
    expect(edad('2016-11-18', hoy)).toBe(9);
  });

  it('define quién firma el consentimiento según la edad', () => {
    expect(quienConsiente('2018-01-01', false, hoy)).toBe('representante');
    expect(quienConsiente('2012-01-01', false, hoy)).toBe('paciente');
    expect(quienConsiente('2012-01-01', true, hoy)).toBe('paciente_con_representante');
    expect(quienConsiente('2009-01-01', true, hoy)).toBe('paciente');
  });
});
