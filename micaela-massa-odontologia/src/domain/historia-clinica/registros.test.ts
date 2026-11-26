import { describe, expect, it } from 'vitest';
import { armarLineaDeTiempo, leerContenido, tamanioLegible, validarTextoClinico } from './registros';

describe('contenido de los registros firmados', () => {
  it('lee texto, firmante, marcas y adjunto', () => {
    const contenido = leerContenido({
      texto: 'Obturación 36',
      firmante: { nombre: 'Micaela', apellido: 'Massa', matricula: 'MP 1' },
      marcas: [
        { id: 'm1', pieza: 36, cara: 'O', hallazgo: 'restauracion', estado: 'realizado', reemplazaA: 'm0', anulacion: false },
        { id: 'm2', pieza: 11, cara: null, hallazgo: 'corona', estado: 'preexistente' },
        { id: 'roto', pieza: 'x' },
      ],
      adjunto: { id: 'a1', sha256: 'f'.repeat(64), nombreOriginal: 'rx.png', tipoMime: 'image/png', bytes: 2048, pieza: 36, descripcion: 'Rx' },
    });
    expect(contenido.texto).toBe('Obturación 36');
    expect(contenido.firmante?.matricula).toBe('MP 1');
    expect(contenido.marcas.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(contenido.marcas[1]).toMatchObject({ cara: null, reemplazaA: null, anulacion: false });
    expect(contenido.adjunto).toMatchObject({ id: 'a1', pieza: 36, bytes: 2048 });
  });

  it('no se rompe con contenidos viejos o inesperados', () => {
    expect(leerContenido(null)).toEqual({ texto: null, firmante: null, marcas: [], adjunto: null });
    expect(leerContenido({ texto: 'x', firmante: { nombre: 'Sin matrícula' } })).toMatchObject({ texto: 'x', firmante: null });
    expect(leerContenido({ nota: 'Nota del odontograma' }).texto).toBe('Nota del odontograma');
  });

  it('valida el texto antes de firmar', () => {
    expect(validarTextoClinico('   ')).toHaveLength(1);
    expect(validarTextoClinico('x'.repeat(10_001))).toHaveLength(1);
    expect(validarTextoClinico('Control sin novedades.')).toEqual([]);
  });

  it('muestra tamaños de archivo legibles', () => {
    expect(tamanioLegible(800)).toBe('800 B');
    expect(tamanioLegible(2048)).toBe('2 KB');
    expect(tamanioLegible(2.5 * 1024 * 1024)).toBe('2,5 MB');
  });
});

describe('línea de tiempo', () => {
  const r = (id: string, secuencia: number, enmiendaDe: string | null = null) => ({ id, secuencia, enmiendaDe });

  it('ordena de lo más nuevo a lo más viejo y vincula cada enmienda a su original', () => {
    const linea = armarLineaDeTiempo([r('a', 1), r('b', 2), r('c', 3, 'a'), r('d', 4, 'a')]);
    expect(linea.map((e) => e.registro.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(linea.find((e) => e.registro.id === 'a')?.enmiendas.map((e) => e.id)).toEqual(['c', 'd']);
    expect(linea.find((e) => e.registro.id === 'd')?.corrige?.id).toBe('a');
    expect(linea.find((e) => e.registro.id === 'b')).toMatchObject({ enmiendas: [], corrige: null });
  });
});
