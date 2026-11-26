import { describe, expect, it } from 'vitest';
import { consolidarCambios, denticionSugerida, describirMarca } from './cambios';
import { calcularOdontograma, validarMarca, type MarcaOdontograma } from './estado';

const ahora = new Date('2026-11-20T13:00:00Z');
const firmada: MarcaOdontograma = { id: 'f1', pieza: 36, cara: 'O', hallazgo: 'caries', estado: 'pendiente', registradaEn: new Date('2026-10-01T13:00:00Z') };
const borrador = (id: string, datos: Partial<MarcaOdontograma>): MarcaOdontograma => ({ id, pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', registradaEn: ahora, ...datos });

describe('cambios del odontograma listos para firmar', () => {
  it('describe cada marca en palabras', () => {
    expect(describirMarca(firmada)).toBe('36 oclusal: Caries (a realizar)');
    expect(describirMarca({ pieza: 11, cara: null, hallazgo: 'corona', estado: 'preexistente' })).toBe('11: Corona (preexistente)');
    expect(describirMarca({ ...firmada, anulacion: true })).toContain('se quita Caries');
  });

  it('deja pasar los cambios simples tal cual', () => {
    expect(consolidarCambios([borrador('b1', { reemplazaA: 'f1' })])).toEqual([
      { pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: 'f1', anulacion: false, prestacionCodigo: null },
    ]);
  });

  it('descarta los pasos intermedios: la marca final reemplaza a la firmada', () => {
    const cambios = [borrador('b1', { reemplazaA: 'f1', hallazgo: 'caries', estado: 'realizado' }), borrador('b2', { reemplazaA: 'b1' })];
    const consolidados = consolidarCambios(cambios);
    expect(consolidados).toHaveLength(1);
    expect(consolidados[0]).toMatchObject({ hallazgo: 'restauracion', reemplazaA: 'f1' });
    expect(validarMarca(consolidados[0]!, [firmada])).toEqual([]);
  });

  it('una marca nueva que reemplaza a otra nueva no reemplaza nada firmado', () => {
    const cambios = [borrador('b1', { pieza: 46, hallazgo: 'caries', estado: 'pendiente' }), borrador('b2', { pieza: 46, reemplazaA: 'b1' })];
    expect(consolidarCambios(cambios)).toEqual([expect.objectContaining({ pieza: 46, hallazgo: 'restauracion', reemplazaA: null })]);
  });

  it('no envía la anulación de algo que nunca se firmó', () => {
    const cambios = [borrador('b1', { pieza: 46, hallazgo: 'caries', estado: 'pendiente' }), borrador('b2', { pieza: 46, hallazgo: 'caries', estado: 'pendiente', reemplazaA: 'b1', anulacion: true })];
    expect(consolidarCambios(cambios)).toEqual([]);
  });

  it('una anulación de una marca firmada la saca del dibujo', () => {
    const anulacion = borrador('b1', { hallazgo: 'caries', estado: 'pendiente', reemplazaA: 'f1', anulacion: true });
    const [consolidada] = consolidarCambios([anulacion]);
    expect(consolidada).toMatchObject({ anulacion: true, reemplazaA: 'f1' });
    expect(calcularOdontograma([firmada, { ...consolidada!, id: 'n1', registradaEn: ahora }]).has(36)).toBe(false);
  });
});

describe('dentición según la edad', () => {
  it('temporal en los más chicos, mixta de 6 a 12 y permanente después', () => {
    expect(denticionSugerida(4)).toBe('temporal');
    expect(denticionSugerida(6)).toBe('mixta');
    expect(denticionSugerida(12)).toBe('mixta');
    expect(denticionSugerida(13)).toBe('permanente');
    expect(denticionSugerida(41)).toBe('permanente');
  });

  it('muestra la mixta si hay marcas en piezas de la otra dentición', () => {
    expect(denticionSugerida(30, [36, 75])).toBe('mixta');
    expect(denticionSugerida(4, [16])).toBe('mixta');
    expect(denticionSugerida(30, [36, 11])).toBe('permanente');
  });
});
