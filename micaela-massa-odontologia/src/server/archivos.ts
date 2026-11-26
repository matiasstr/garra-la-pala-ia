import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Almacenamiento de archivos (fotos, radiografías, estudios).
 *
 * Los archivos se guardan por su huella SHA-256 y nunca se pisan: lo mismo que
 * va a garantizar en producción un bucket con Object Lock. En desarrollo se
 * usa una carpeta local.
 */
export interface AlmacenArchivos {
  guardar(carpeta: string, bytes: Uint8Array, tipo: TipoArchivo): Promise<{ clave: string; sha256: string }>;
  leer(clave: string): Promise<Uint8Array | null>;
}

export type TipoImagen = 'image/jpeg' | 'image/png' | 'image/webp';
/** Imágenes y PDF (estudios, informes): lo que se puede adjuntar a la historia clínica. */
export type TipoArchivo = TipoImagen | 'application/pdf';

const EXTENSION: Record<TipoArchivo, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const TIPO_POR_EXTENSION: Record<string, TipoImagen> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const CLAVE_VALIDA = /^[a-z0-9-]+\/[0-9a-f]{64}\.(jpg|png|webp|pdf)$/;

const empiezaCon = (bytes: Uint8Array, firma: number[], desde = 0) => firma.every((b, i) => bytes[desde + i] === b);

/** Tipo real de la imagen según sus primeros bytes (no se confía en lo que dice el navegador). */
export function detectarTipoImagen(bytes: Uint8Array): TipoImagen | null {
  if (empiezaCon(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (empiezaCon(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (empiezaCon(bytes, [0x52, 0x49, 0x46, 0x46]) && empiezaCon(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  return null;
}

export function tipoDeClave(clave: string): TipoImagen | null {
  return TIPO_POR_EXTENSION[clave.split('.').at(-1) ?? ''] ?? null;
}

/** Un PDF empieza con `%PDF-`. */
export function esPdf(bytes: Uint8Array): boolean {
  return empiezaCon(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
}

/** Tipo real de una imagen o un PDF según sus primeros bytes. */
export function detectarTipoArchivo(bytes: Uint8Array): TipoArchivo | null {
  return detectarTipoImagen(bytes) ?? (esPdf(bytes) ? 'application/pdf' : null);
}

/** Como `tipoDeClave`, pero también reconoce los PDF. */
export function tipoArchivoDeClave(clave: string): TipoArchivo | null {
  return clave.endsWith('.pdf') ? 'application/pdf' : tipoDeClave(clave);
}

export function almacenLocal(raiz: string): AlmacenArchivos {
  return {
    async guardar(carpeta, bytes, tipo) {
      if (!/^[a-z0-9-]+$/.test(carpeta)) throw new Error(`Carpeta inválida: ${carpeta}`);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const clave = `${carpeta}/${sha256}.${EXTENSION[tipo]}`;
      await mkdir(path.join(raiz, carpeta), { recursive: true });
      try {
        await writeFile(path.join(raiz, clave), bytes, { flag: 'wx' });
      } catch (error) {
        // Mismo contenido, mismo nombre: ya estaba guardado.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      return { clave, sha256 };
    },
    async leer(clave) {
      if (!CLAVE_VALIDA.test(clave)) return null;
      try {
        return new Uint8Array(await readFile(path.join(raiz, clave)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
