import { describe, expect, it } from 'vitest';
import { aBase32, codigoHotp, codigoTotp, desdeBase32, enlaceOtpauth, generarSecretoTotp, pasoTotp, verificarCodigoTotp, type AlgoritmoTotp } from './totp';

describe('base32 (RFC 4648)', () => {
  it('codifica los vectores de prueba del RFC, sin relleno', () => {
    const vectores: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [texto, codificado] of vectores) {
      expect(aBase32(Buffer.from(texto))).toBe(codificado);
      expect(desdeBase32(codificado).toString()).toBe(texto);
    }
  });

  it('lee la clave como la copia una persona: minúsculas, espacios y relleno', () => {
    expect(desdeBase32('mzxw 6ytb oi==').toString()).toBe('foobar');
    expect(() => desdeBase32('MZXW1')).toThrow(RangeError);
  });

  it('genera claves de 160 bits distintas', () => {
    const a = generarSecretoTotp();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(desdeBase32(a)).toHaveLength(20);
    expect(generarSecretoTotp()).not.toBe(a);
  });
});

describe('HOTP (RFC 4226, apéndice D)', () => {
  it('coincide con los vectores de prueba', () => {
    const secreto = Buffer.from('12345678901234567890');
    const esperados = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    esperados.forEach((codigo, contador) => expect(codigoHotp(secreto, contador)).toBe(codigo));
  });
});

describe('TOTP (RFC 6238, apéndice B)', () => {
  const secretos: Record<AlgoritmoTotp, Buffer> = {
    sha1: Buffer.from('12345678901234567890'),
    sha256: Buffer.from('12345678901234567890123456789012'),
    sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
  };
  const vectores: [number, string, AlgoritmoTotp][] = [
    [59, '94287082', 'sha1'],
    [59, '46119246', 'sha256'],
    [59, '90693936', 'sha512'],
    [1111111109, '07081804', 'sha1'],
    [1111111109, '68084774', 'sha256'],
    [1111111109, '25091201', 'sha512'],
    [1111111111, '14050471', 'sha1'],
    [1111111111, '67062674', 'sha256'],
    [1111111111, '99943326', 'sha512'],
    [1234567890, '89005924', 'sha1'],
    [1234567890, '91819424', 'sha256'],
    [1234567890, '93441116', 'sha512'],
    [2000000000, '69279037', 'sha1'],
    [2000000000, '90698825', 'sha256'],
    [2000000000, '38618901', 'sha512'],
    [20000000000, '65353130', 'sha1'],
    [20000000000, '77737706', 'sha256'],
    [20000000000, '47863826', 'sha512'],
  ];

  it.each(vectores)('a los %i segundos da %s con %s', (segundos, codigo, algoritmo) => {
    expect(codigoTotp(secretos[algoritmo], segundos * 1000, { digitos: 8, algoritmo })).toBe(codigo);
  });

  it('usa intervalos de 30 segundos', () => {
    expect(pasoTotp(59_000)).toBe(1);
    expect(pasoTotp(new Date(1111111109_000))).toBe(37037036);
  });
});

describe('verificación de un código', () => {
  const secreto = desdeBase32(generarSecretoTotp());
  const ahora = new Date('2026-11-26T13:00:10Z');
  const codigoA = (desfaseSegundos: number) => codigoTotp(secreto, ahora.getTime() + desfaseSegundos * 1000);

  it('acepta el intervalo actual y ±30 segundos, no más', () => {
    expect(verificarCodigoTotp(secreto, codigoA(0), ahora)).toEqual({ valido: true, paso: pasoTotp(ahora) });
    expect(verificarCodigoTotp(secreto, codigoA(-30), ahora).valido).toBe(true);
    expect(verificarCodigoTotp(secreto, codigoA(30), ahora).valido).toBe(true);
    expect(verificarCodigoTotp(secreto, codigoA(-60), ahora)).toEqual({ valido: false, motivo: 'incorrecto' });
    expect(verificarCodigoTotp(secreto, codigoA(60), ahora)).toEqual({ valido: false, motivo: 'incorrecto' });
  });

  it('un código ya usado no sirve de nuevo, ni uno anterior', () => {
    const usado = verificarCodigoTotp(secreto, codigoA(0), ahora);
    if (!usado.valido) throw new Error('debería valer');
    expect(verificarCodigoTotp(secreto, codigoA(0), ahora, usado.paso)).toEqual({ valido: false, motivo: 'ya_usado' });
    expect(verificarCodigoTotp(secreto, codigoA(-30), ahora, usado.paso)).toEqual({ valido: false, motivo: 'ya_usado' });
    // El siguiente intervalo sí vale.
    expect(verificarCodigoTotp(secreto, codigoA(30), ahora, usado.paso).valido).toBe(true);
  });

  it('acepta espacios o guiones y rechaza lo que no son 6 números', () => {
    const codigo = codigoA(0);
    expect(verificarCodigoTotp(secreto, `${codigo.slice(0, 3)} ${codigo.slice(3)}`, ahora).valido).toBe(true);
    expect(verificarCodigoTotp(secreto, '12345', ahora)).toEqual({ valido: false, motivo: 'formato' });
    expect(verificarCodigoTotp(secreto, 'abcdef', ahora)).toEqual({ valido: false, motivo: 'formato' });
  });

  it('con otra clave no coincide', () => {
    expect(verificarCodigoTotp(desdeBase32(generarSecretoTotp()), codigoA(0), ahora).valido).toBe(false);
  });
});

describe('enlace otpauth', () => {
  it('lleva la clave, el emisor y los parámetros estándar', () => {
    const enlace = enlaceOtpauth({ emisor: 'Micaela Massa Odontología', cuenta: 'mica@consultorio.com', secreto: 'JBSWY3DPEHPK3PXP' });
    expect(enlace.startsWith('otpauth://totp/Micaela%20Massa%20Odontolog%C3%ADa:mica%40consultorio.com?')).toBe(true);
    const parametros = new URL(enlace).searchParams;
    expect(parametros.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(parametros.get('issuer')).toBe('Micaela Massa Odontología');
    expect(parametros.get('digits')).toBe('6');
    expect(parametros.get('period')).toBe('30');
    expect(enlace).not.toContain('+');
  });
});
