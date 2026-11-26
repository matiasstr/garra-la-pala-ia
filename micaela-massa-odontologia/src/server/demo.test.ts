import { describe, expect, it } from 'vitest';
import { permiteReiniciarDemo } from './demo';

describe('reinicio de la demo', () => {
  it('solo se permite con las dos variables de la demo', () => {
    expect(permiteReiniciarDemo({ MODO_DESARROLLO: '1', DEMO_PERMITE_REINICIO: '1' })).toBe(true);
    expect(permiteReiniciarDemo({ MODO_DESARROLLO: '1' })).toBe(false);
    expect(permiteReiniciarDemo({ DEMO_PERMITE_REINICIO: '1' })).toBe(false);
    expect(permiteReiniciarDemo({ MODO_DESARROLLO: '1', DEMO_PERMITE_REINICIO: 'true' })).toBe(false);
    // `npm run dev` activa los datos de prueba, pero no el reinicio.
    expect(permiteReiniciarDemo({ NODE_ENV: 'development', DEMO_PERMITE_REINICIO: '1' })).toBe(false);
    expect(permiteReiniciarDemo({})).toBe(false);
  });
});
