// Build de la extensión: bundlea con esbuild y copia los estáticos a dist/.
// Uso: node build.mjs [--watch]
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const require = createRequire(import.meta.url);

const common = {
  bundle: true,
  target: 'chrome120',
  sourcemap: 'linked',
  logLevel: 'info',
  legalComments: 'none',
};

const configs = [
  // Los content scripts no pueden ser módulos ES: van como IIFE.
  { ...common, entryPoints: { content: join(root, 'src/content/index.ts') }, outdir: dist, format: 'iife' },
  {
    ...common,
    entryPoints: {
      background: join(root, 'src/background.ts'),
      options: join(root, 'src/options/options.ts'),
      popup: join(root, 'src/popup/popup.ts'),
    },
    outdir: dist,
    format: 'esm',
  },
];

// ---------- Íconos (PNG generado a mano, sin dependencias) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Círculo naranja con tres zarpazos blancos (la "garra"). */
function iconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const r = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - r;
      const dy = y + 0.5 - r;
      const inside = dx * dx + dy * dy <= r * r;
      // Tres franjas diagonales.
      const u = (x - y * 0.45) / size;
      const stripe = [0.05, 0.25, 0.45].some((s) => u > s && u < s + 0.1) && y > size * 0.18 && y < size * 0.82;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const color = !inside ? [0, 0, 0, 0] : stripe ? [255, 255, 255, 255] : [234, 88, 12, 255];
      raw.set(color, i);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function copyStatic() {
  cpSync(join(root, 'public'), dist, { recursive: true });
  cpSync(require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'), join(dist, 'pdf.worker.min.mjs'));
  mkdirSync(join(dist, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(join(dist, 'icons', `icon${size}.png`), iconPng(size));
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
copyStatic();

if (watch) {
  for (const config of configs) await (await context(config)).watch();
  console.log('Mirando cambios... (los estáticos de public/ se copian al reiniciar)');
} else {
  await Promise.all(configs.map((config) => build(config)));
}
