import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
  entryPoints: { host: 'src/host.ts', install: 'src/install.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
});
