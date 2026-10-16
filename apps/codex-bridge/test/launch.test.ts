import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCodexLaunch } from '../src/launch';

const directories: string[] = [];
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'garra-launch-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
describe('resolución del ejecutable', () => {
  it('usa Node para el shim npm de Windows, sin ejecutar cmd.exe', () => {
    const directory = temporary();
    const shim = join(directory, 'codex.cmd');
    const packagePath = join(directory, 'node_modules', '@openai', 'codex', 'bin');
    mkdirSync(packagePath, { recursive: true });
    writeFileSync(shim, '@echo off');
    const script = join(packagePath, 'codex.js'); writeFileSync(script, '');
    expect(resolveCodexLaunch(shim)).toEqual({ command: process.execPath, args: [script] });
  });
  it('acepta un ejecutable y un script explícitos con espacios', () => {
    const directory = temporary();
    const binary = join(directory, 'codex test.exe'); writeFileSync(binary, '', { mode: 0o700 });
    expect(resolveCodexLaunch(binary)).toEqual({ command: binary, args: [] });
    const script = join(directory, 'codex test.js'); writeFileSync(script, '');
    expect(resolveCodexLaunch(script)).toEqual({ command: process.execPath, args: [script] });
  });
  it('informa NOT_INSTALLED si el PATH no contiene Codex', () => {
    vi.stubEnv('PATH', temporary());
    expect(() => resolveCodexLaunch()).toThrow(expect.objectContaining({ code: 'NOT_INSTALLED' }));
  });
});
