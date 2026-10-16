import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { BridgeError } from './errors';

export interface LaunchCommand { command: string; args: string[] }

/** Evita shell:true y resuelve también los shims .cmd de npm en Windows. */
export function resolveCodexLaunch(explicit?: string): LaunchCommand {
  const candidates = explicit ? [resolve(explicit)] : (process.env.PATH ?? '').split(delimiter)
    .filter(Boolean).flatMap(dir => (process.platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex'])
      .map(name => join(dir.replace(/^"|"$/g, ''), name)));
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || !existsSync(candidate)) continue;
    const extension = extname(candidate).toLowerCase();
    if (extension === '.cmd' || extension === '.ps1') {
      const script = join(dirname(candidate), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      if (existsSync(script)) return { command: process.execPath, args: [script] };
      continue;
    }
    if (extension === '.js' || extension === '.mjs') return { command: process.execPath, args: [candidate] };
    try {
      accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
      return { command: candidate, args: [] };
    } catch { /* Buscar el siguiente ejecutable del PATH. */ }
  }
  throw new BridgeError('NOT_INSTALLED', 'No se encontró Codex. Usá --codex-path con la ruta al ejecutable o a bin/codex.js.');
}
