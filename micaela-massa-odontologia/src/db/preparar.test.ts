import { describe, expect, it } from 'vitest';
import { urlDeConexion, urlDirecta } from './preparar';

const NEON = 'postgresql://usuario:cl%40ve@ep-algo-123456-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

describe('dirección de la base', () => {
  it('con Neon verifica el certificado y quita lo que node-postgres no entiende', () => {
    const url = new URL(urlDeConexion(NEON));
    expect(url.searchParams.get('sslmode')).toBe('verify-full');
    expect(url.searchParams.has('channel_binding')).toBe(false);
    expect(url.password).toBe('cl%40ve');
    expect(url.hostname).toBe('ep-algo-123456-pooler.sa-east-1.aws.neon.tech');
  });

  it('agrega SSL a Neon si falta y respeta lo pedido explícitamente', () => {
    expect(new URL(urlDeConexion('postgres://u:c@ep-x.sa-east-1.aws.neon.tech/db')).searchParams.get('sslmode')).toBe('verify-full');
    expect(urlDeConexion('postgres://u:c@localhost:5432/db')).toBe('postgres://u:c@localhost:5432/db');
    expect(urlDeConexion('postgres://u:c@localhost/db?sslmode=disable')).toBe('postgres://u:c@localhost/db?sslmode=disable');
    expect(urlDeConexion('postgres://u:c@h/db?uselibpqcompat=true&sslmode=require')).toContain('sslmode=require');
  });

  it('para migrar usa la conexión directa, no la del pooler', () => {
    expect(urlDirecta({ DATABASE_URL: NEON, DATABASE_URL_UNPOOLED: 'postgres://directa/db' })).toBe('postgres://directa/db');
    expect(new URL(urlDirecta({ DATABASE_URL: NEON })).hostname).toBe('ep-algo-123456.sa-east-1.aws.neon.tech');
    expect(urlDirecta({ DATABASE_URL: 'postgres://u:c@localhost:5432/db' })).toBe('postgres://u:c@localhost:5432/db');
    expect(() => urlDirecta({})).toThrow('Falta DATABASE_URL');
  });
});
