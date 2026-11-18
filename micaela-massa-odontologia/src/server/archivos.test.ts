import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { almacenLocal, detectarTipoImagen } from './archivos';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

describe('archivos', () => {
  let raiz: string | undefined;
  afterAll(async () => {
    if (raiz) await rm(raiz, { recursive: true, force: true });
  });

  it('reconoce imágenes por su contenido, no por su nombre', () => {
    expect(detectarTipoImagen(JPEG)).toBe('image/jpeg');
    expect(detectarTipoImagen(PNG)).toBe('image/png');
    expect(detectarTipoImagen(new TextEncoder().encode('<script>'))).toBeNull();
  });

  it('guarda por huella, no pisa y no deja salir de la carpeta', async () => {
    raiz = await mkdtemp(path.join(tmpdir(), 'almacen-'));
    const almacen = almacenLocal(raiz);
    const primera = await almacen.guardar('fotos', JPEG, 'image/jpeg');
    const segunda = await almacen.guardar('fotos', JPEG, 'image/jpeg');
    expect(segunda).toEqual(primera);
    expect(primera.clave).toMatch(/^fotos\/[0-9a-f]{64}\.jpg$/);
    expect(await almacen.leer(primera.clave)).toEqual(JPEG);
    expect(await almacen.leer('../../etc/passwd')).toBeNull();
    expect(await almacen.leer(`fotos/${'0'.repeat(64)}.jpg`)).toBeNull();
  });
});
