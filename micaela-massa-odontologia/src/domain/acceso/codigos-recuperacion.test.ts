import { describe, expect, it } from 'vitest';
import { CANTIDAD_CODIGOS_RECUPERACION, generarCodigosRecuperacion, hashCodigoRecuperacion, normalizarCodigoRecuperacion, pareceCodigoRecuperacion } from './codigos-recuperacion';

describe('códigos de recuperación', () => {
  it('genera 10 códigos distintos, legibles y sin letras confusas', () => {
    const codigos = generarCodigosRecuperacion();
    expect(codigos).toHaveLength(CANTIDAD_CODIGOS_RECUPERACION);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const codigo of codigos) {
      expect(codigo).toMatch(/^[0-9a-hjkmnp-tv-z]{5}-[0-9a-hjkmnp-tv-z]{5}$/);
      expect(codigo).not.toMatch(/[ilou]/);
    }
    expect(generarCodigosRecuperacion()).not.toEqual(codigos);
  });

  it('acepta el código como lo copie la persona', () => {
    expect(normalizarCodigoRecuperacion('K7M2Q-9XZ4H')).toBe('k7m2q9xz4h');
    expect(normalizarCodigoRecuperacion(' k7m2q 9xz4h ')).toBe('k7m2q9xz4h');
    // La "o" se lee como cero y la "l" o la "i" como uno.
    expect(normalizarCodigoRecuperacion('k7m2q-9xz4O')).toBe('k7m2q9xz40');
    expect(normalizarCodigoRecuperacion('l7m2q-9xz4i')).toBe('17m2q9xz41');
  });

  it('rechaza lo que no puede ser un código', () => {
    expect(normalizarCodigoRecuperacion('123456')).toBeNull();
    expect(normalizarCodigoRecuperacion('k7m2q-9xz4hh')).toBeNull();
    expect(normalizarCodigoRecuperacion('k7m2q-9xz4!')).toBeNull();
    expect(pareceCodigoRecuperacion('123456')).toBe(false);
    expect(pareceCodigoRecuperacion('123 456')).toBe(false);
    expect(pareceCodigoRecuperacion('k7m2q-9xz4h')).toBe(true);
  });

  it('se guarda como hash: el mismo código da el mismo hash y no se ve el código', () => {
    const hash = hashCodigoRecuperacion('k7m2q9xz4h');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashCodigoRecuperacion(normalizarCodigoRecuperacion('K7M2Q-9XZ4H')!));
    expect(hash).not.toContain('k7m2q');
    expect(hashCodigoRecuperacion('k7m2q9xz4j')).not.toBe(hash);
  });
});
