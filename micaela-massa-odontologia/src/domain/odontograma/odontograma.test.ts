import { describe, expect, it } from 'vitest';
import { calcularOdontograma, marcasPendientes, validarMarca, type MarcaOdontograma } from './estado';
import { TODAS_LAS_PIEZAS, esPiezaValida, filasOdontograma, nombreCara, ubicacionCaras } from './piezas';

describe('piezas FDI', () => {
  it('valida permanentes y temporales', () => {
    expect(esPiezaValida(11)).toBe(true);
    expect(esPiezaValida(48)).toBe(true);
    expect(esPiezaValida(55)).toBe(true);
    expect(esPiezaValida(85)).toBe(true);
    expect(esPiezaValida(19)).toBe(false);
    expect(esPiezaValida(56)).toBe(false);
    expect(esPiezaValida(10)).toBe(false);
    expect(esPiezaValida(91)).toBe(false);
  });

  it('hay 32 permanentes y 20 temporales', () => {
    expect(TODAS_LAS_PIEZAS).toHaveLength(52);
    expect(new Set(TODAS_LAS_PIEZAS).size).toBe(52);
    expect(filasOdontograma('permanente').flatMap((f) => [...f.izquierda, ...f.derecha])).toHaveLength(32);
    expect(filasOdontograma('temporal').flatMap((f) => [...f.izquierda, ...f.derecha])).toHaveLength(20);
  });

  it('dibuja de frente al paciente: 18 a 11 a la izquierda, 21 a 28 a la derecha', () => {
    const [superior] = filasOdontograma('permanente');
    expect(superior?.izquierda).toEqual([18, 17, 16, 15, 14, 13, 12, 11]);
    expect(superior?.derecha).toEqual([21, 22, 23, 24, 25, 26, 27, 28]);
  });

  it('nombra las caras según la pieza', () => {
    expect(nombreCara(16, 'L')).toBe('Palatina');
    expect(nombreCara(36, 'L')).toBe('Lingual');
    expect(nombreCara(11, 'O')).toBe('Incisal');
    expect(nombreCara(46, 'O')).toBe('Oclusal');
  });

  it('ubica mesial hacia la línea media y vestibular hacia afuera', () => {
    expect(ubicacionCaras(11)).toMatchObject({ derecha: 'M', izquierda: 'D', arriba: 'V', abajo: 'L' });
    expect(ubicacionCaras(21)).toMatchObject({ izquierda: 'M', derecha: 'D' });
    expect(ubicacionCaras(36)).toMatchObject({ izquierda: 'M', arriba: 'L', abajo: 'V' });
    expect(ubicacionCaras(84)).toMatchObject({ derecha: 'M' });
  });
});

const dia = (d: number) => new Date(Date.UTC(2026, 10, d, 12));

describe('estado del odontograma', () => {
  const caries: MarcaOdontograma = { id: 'a', pieza: 36, cara: 'O', hallazgo: 'caries', estado: 'pendiente', registradaEn: dia(1) };
  const obturada: MarcaOdontograma = { id: 'b', pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', registradaEn: dia(10), reemplazaA: 'a' };
  const corona: MarcaOdontograma = { id: 'c', pieza: 11, cara: null, hallazgo: 'corona', estado: 'preexistente', registradaEn: dia(1) };

  it('una marca que reemplaza a otra la oculta', () => {
    const hoy = calcularOdontograma([caries, obturada, corona]);
    expect(hoy.get(36)?.caras.O?.map((m) => m.hallazgo)).toEqual(['restauracion']);
    expect(hoy.get(11)?.completa.map((m) => m.hallazgo)).toEqual(['corona']);
  });

  it('se puede ver cómo estaba la boca en una fecha pasada', () => {
    const antes = calcularOdontograma([caries, obturada, corona], dia(5));
    expect(antes.get(36)?.caras.O?.map((m) => m.hallazgo)).toEqual(['caries']);
  });

  it('una anulación borra del dibujo la marca cargada por error', () => {
    const anulacion: MarcaOdontograma = { id: 'z', pieza: 11, cara: null, hallazgo: 'corona', estado: 'preexistente', registradaEn: dia(2), reemplazaA: 'c', anulacion: true };
    expect(calcularOdontograma([corona, anulacion]).has(11)).toBe(false);
  });

  it('lista lo pendiente (en rojo) para el plan de tratamiento', () => {
    expect(marcasPendientes(calcularOdontograma([caries, corona])).map((m) => m.id)).toEqual(['a']);
    expect(marcasPendientes(calcularOdontograma([caries, obturada, corona]))).toEqual([]);
  });
});

describe('validación de marcas', () => {
  const existente: MarcaOdontograma = { id: 'a', pieza: 36, cara: 'O', hallazgo: 'caries', estado: 'pendiente', registradaEn: dia(1) };

  it('acepta una marca correcta', () => {
    expect(validarMarca({ pieza: 46, cara: 'M', hallazgo: 'caries', estado: 'pendiente' })).toEqual([]);
  });

  it('rechaza piezas inexistentes y ámbitos equivocados', () => {
    expect(validarMarca({ pieza: 19, cara: null, hallazgo: 'corona', estado: 'pendiente' })).toHaveLength(1);
    expect(validarMarca({ pieza: 36, cara: null, hallazgo: 'caries', estado: 'pendiente' })).toHaveLength(1);
    expect(validarMarca({ pieza: 36, cara: 'O', hallazgo: 'corona', estado: 'pendiente' })).toHaveLength(1);
    expect(validarMarca({ pieza: 36, cara: null, hallazgo: 'ausente', estado: 'pendiente' })).toHaveLength(1);
  });

  it('solo reemplaza marcas existentes de la misma pieza y una sola vez', () => {
    expect(validarMarca({ pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: 'a' }, [existente])).toEqual([]);
    expect(validarMarca({ pieza: 46, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: 'a' }, [existente])).toHaveLength(1);
    expect(validarMarca({ pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: 'x' }, [existente])).toHaveLength(1);
    const yaReemplazada: MarcaOdontograma = { id: 'b', pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', registradaEn: dia(2), reemplazaA: 'a' };
    expect(validarMarca({ pieza: 36, cara: 'O', hallazgo: 'caries', estado: 'pendiente', reemplazaA: 'a' }, [existente, yaReemplazada])).toHaveLength(1);
  });
});
