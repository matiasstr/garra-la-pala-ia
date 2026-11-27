import { describe, expect, it } from 'vitest';
import { datosDeEncabezados, rutaInterna } from './pedido';

describe('rutaInterna (?volver=)', () => {
  it('deja pasar las rutas del sistema, con su consulta y su ancla', () => {
    expect(rutaInterna('/pacientes')).toBe('/pacientes');
    expect(rutaInterna('/agenda?fecha=2026-11-27&profesional=x#turno-1')).toBe('/agenda?fecha=2026-11-27&profesional=x#turno-1');
    expect(rutaInterna('/pacientes/../agenda')).toBe('/agenda');
    expect(rutaInterna('/ agenda')).toBe('/%20agenda');
  });

  it('rechaza todo lo que termina en otro sitio', () => {
    for (const ruta of [
      '/\t/sitio-externo.com',
      '/\n/sitio-externo.com',
      '/\r\n/sitio-externo.com',
      '/%09/sitio-externo.com',
      '/%0a/sitio-externo.com',
      '//sitio-externo.com',
      '//sitio-externo.com/agenda',
      '/\\sitio-externo.com',
      '/\\/sitio-externo.com',
      '\\/sitio-externo.com',
      '\\\\sitio-externo.com',
      'https:',
      'https://sitio-externo.com',
      'https:sitio-externo.com',
      'javascript:alert(1)',
      ' /agenda',
      ' //sitio-externo.com',
      'sitio-externo.com',
      '',
    ]) {
      expect(rutaInterna(ruta), JSON.stringify(ruta)).toBe('/agenda');
    }
  });

  it('no vuelve a /ingresar (ni escrito de otra forma)', () => {
    expect(rutaInterna('/ingresar')).toBe('/agenda');
    expect(rutaInterna('/ingresar?volver=/pacientes')).toBe('/agenda');
    expect(rutaInterna('/./ingresar')).toBe('/agenda');
    expect(rutaInterna('/pacientes/../ingresar/')).toBe('/agenda');
    expect(rutaInterna('/ingresos')).toBe('/ingresos');
  });

  it('usa el valor por defecto que se pide', () => {
    expect(rutaInterna(null, '')).toBe('');
    expect(rutaInterna(undefined)).toBe('/agenda');
    expect(rutaInterna('//sitio-externo.com', '/cuenta')).toBe('/cuenta');
  });
});

describe('datosDeEncabezados (IP y navegador)', () => {
  const encabezados = (valores: Record<string, string>) => new Headers(valores);

  it('toma el último valor de X-Forwarded-For: el que agrega el proxy de confianza', () => {
    expect(datosDeEncabezados(encabezados({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1', 'user-agent': 'Firefox' }))).toEqual({ ip: '10.0.0.1', userAgent: 'Firefox' });
    expect(datosDeEncabezados(encabezados({ 'x-forwarded-for': '6.6.6.6,10.0.0.1 , ' })).ip).toBe('10.0.0.1');
  });

  it('limpia el prefijo IPv4 en IPv6, usa X-Real-IP si no hay otro y recorta lo largo', () => {
    expect(datosDeEncabezados(encabezados({ 'x-forwarded-for': '::ffff:192.168.0.5' })).ip).toBe('192.168.0.5');
    expect(datosDeEncabezados(encabezados({ 'x-real-ip': '10.0.0.9' })).ip).toBe('10.0.0.9');
    expect(datosDeEncabezados(encabezados({}))).toEqual({ ip: null, userAgent: null });
    expect(datosDeEncabezados(encabezados({ 'user-agent': 'x'.repeat(500) })).userAgent).toHaveLength(300);
  });
});
