import { describe, expect, it } from 'vitest';
import { LARGO_MINIMO_CLAVE, PARAMETROS_SCRYPT, hashDeSenuelo, hashearContrasena, necesitaRehash, validarContrasenaNueva, verificarContrasena } from './contrasenas';

describe('hash de contraseñas con scrypt', () => {
  it('verifica la contraseña correcta y rechaza otra', async () => {
    const hash = await hashearContrasena('el mate de la mañana');
    expect(await verificarContrasena('el mate de la mañana', hash)).toBe(true);
    expect(await verificarContrasena('el mate de la manana', hash)).toBe(false);
    expect(await verificarContrasena('', hash)).toBe(false);
  });

  it('guarda los parámetros y usa una sal distinta cada vez', async () => {
    const [a, b] = await Promise.all([hashearContrasena('misma contraseña'), hashearContrasena('misma contraseña')]);
    expect(a).toMatch(new RegExp(`^scrypt\\$ln=${PARAMETROS_SCRYPT.ln},r=${PARAMETROS_SCRYPT.r},p=${PARAMETROS_SCRYPT.p}\\$`));
    expect(a).not.toBe(b);
    expect(a).not.toContain('misma');
    expect(necesitaRehash(a)).toBe(false);
  });

  it('acepta la ñ escrita de dos formas Unicode distintas', async () => {
    const compuesta = 'año nuevo en la costa';
    const descompuesta = compuesta.normalize('NFD');
    expect(descompuesta).not.toBe(compuesta);
    expect(await verificarContrasena(descompuesta, await hashearContrasena(compuesta))).toBe(true);
  });

  it('un hash adulterado o con otro formato nunca coincide', async () => {
    const hash = await hashearContrasena('una contraseña larga');
    const partes = hash.split('$');
    const otroHash = Buffer.alloc(32, 1).toString('base64url');
    expect(await verificarContrasena('una contraseña larga', [...partes.slice(0, 3), otroHash].join('$'))).toBe(false);
    expect(await verificarContrasena('una contraseña larga', 'texto plano')).toBe(false);
    // Parámetros absurdos (que tumbarían el servidor) se rechazan sin calcular.
    expect(await verificarContrasena('una contraseña larga', hash.replace('ln=15', 'ln=30'))).toBe(false);
  });

  it('avisa cuando un hash viejo es más débil que los parámetros actuales', () => {
    expect(necesitaRehash(`scrypt$ln=14,r=8,p=1$${'a'.repeat(22)}$${'b'.repeat(43)}`)).toBe(true);
  });

  it('el señuelo no coincide con nada', async () => {
    expect(await verificarContrasena('', await hashDeSenuelo())).toBe(false);
  });
});

describe('reglas para una contraseña nueva', () => {
  const persona = { email: 'mica@consultorio.com', nombre: 'Micaela', apellido: 'Massa' };

  it('pide un largo mínimo y nada más raro', () => {
    expect(validarContrasenaNueva('corta', persona)).toHaveLength(1);
    expect(validarContrasenaNueva('a'.repeat(LARGO_MINIMO_CLAVE - 1), persona)[0]).toMatch(/al menos 10/);
    // Sin mayúsculas, números ni símbolos obligatorios.
    expect(validarContrasenaNueva('el mate de la mañana', persona)).toEqual([]);
    expect(validarContrasenaNueva('tomate perita', persona)).toEqual([]);
  });

  it('rechaza las más usadas, las repetidas y las personales', () => {
    expect(validarContrasenaNueva('1234567890', persona)).toHaveLength(1);
    expect(validarContrasenaNueva('Contraseña1', persona)).toHaveLength(1);
    expect(validarContrasenaNueva('aaaaaaaaaaaa', persona)).toHaveLength(1);
    expect(validarContrasenaNueva('mica@consultorio.com', persona)[0]).toMatch(/email/);
    expect(validarContrasenaNueva('MicaelaMassa2026', persona)).toHaveLength(1);
  });

  it('tiene un tope para no calcular textos enormes', () => {
    expect(validarContrasenaNueva('x'.repeat(201), persona)[0]).toMatch(/hasta 200/);
  });
});
