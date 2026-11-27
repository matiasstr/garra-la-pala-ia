import { describe, expect, it } from 'vitest';
import { esUsuarioDePrueba } from '../db/acceso-de-prueba';
import { MENSAJE_DEMO_SIN_CLAVE, modoDesarrollo, problemaDeConfiguracion } from './modo';

describe('modo desarrollo', () => {
  it('está activo con npm run dev o con MODO_DESARROLLO=1', () => {
    expect(modoDesarrollo({ NODE_ENV: 'development' })).toBe(true);
    expect(modoDesarrollo({ NODE_ENV: 'production', MODO_DESARROLLO: '1' })).toBe(true);
    expect(modoDesarrollo({ NODE_ENV: 'production' })).toBe(false);
    expect(modoDesarrollo({ NODE_ENV: 'production', MODO_DESARROLLO: 'true' })).toBe(false);
  });

  it('una demo compilada sin DEMO_CLAVE no arranca', () => {
    expect(problemaDeConfiguracion({ NODE_ENV: 'production', MODO_DESARROLLO: '1' })).toBe(MENSAJE_DEMO_SIN_CLAVE);
    expect(problemaDeConfiguracion({ NODE_ENV: 'production', MODO_DESARROLLO: '1', DEMO_CLAVE: '   ' })).toBe(MENSAJE_DEMO_SIN_CLAVE);
    expect(problemaDeConfiguracion({ NODE_ENV: 'production', MODO_DESARROLLO: '1', DEMO_CLAVE: 'tres palabras largas 7' })).toBeNull();
    // npm run dev y el modo real no la necesitan.
    expect(problemaDeConfiguracion({ NODE_ENV: 'development' })).toBeNull();
    expect(problemaDeConfiguracion({ NODE_ENV: 'production' })).toBeNull();
  });

  it('el selector solo acepta cuentas del dominio de la semilla', () => {
    expect(esUsuarioDePrueba('sofia@consultorio.local')).toBe(true);
    expect(esUsuarioDePrueba(' Mica@Consultorio.LOCAL ')).toBe(true);
    expect(esUsuarioDePrueba('mica@ejemplo.com')).toBe(false);
    expect(esUsuarioDePrueba('mica@consultorio.local.ejemplo.com')).toBe(false);
    expect(esUsuarioDePrueba('consultorio.local@ejemplo.com')).toBe(false);
  });
});
