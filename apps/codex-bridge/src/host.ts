import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LaunchCommand } from './launch';
import { handleRequest } from './runner';
import { serve } from './server';

let launch: LaunchCommand | undefined;
try {
  const value: unknown = JSON.parse(readFileSync(join(__dirname, 'bridge-config.json'), 'utf8'));
  if (value && typeof value === 'object' && 'command' in value && typeof value.command === 'string' &&
      'args' in value && Array.isArray(value.args) && value.args.every(arg => typeof arg === 'string')) {
    launch = { command: value.command, args: value.args as string[] };
  }
} catch { /* Sin registro previo, intentar resolver Codex desde PATH. */ }

// stdout está reservado exclusivamente al protocolo binario de Chrome.
process.stdout.on('error', () => process.exit(1));
void serve(process.stdin, process.stdout, request => handleRequest(request, { launch }))
  .catch(() => { process.exitCode = 1; });
