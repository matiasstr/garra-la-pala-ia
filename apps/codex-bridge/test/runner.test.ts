import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BridgeError, failure } from '../src/errors';
import { buildExecArgs, handleRequest } from '../src/runner';
import type { ProcessRequest, RunProcess } from '../src/runner';

const request = { type: 'complete' as const, system: 'Solo JSON.', user: 'Datos del CV: ' + 'á'.repeat(40_000) };
const launch = { command: '/fake/codex', args: [] };

describe('ejecución de Codex', () => {
  it('pasa el prompt largo por stdin, usa workspace vacío y devuelve solo el archivo final', async () => {
    let directory = '';
    const run: RunProcess = vi.fn(async invocation => {
      directory = dirname(invocation.cwd);
      expect(await readdir(invocation.cwd)).toEqual([]);
      expect(invocation.input).toContain(JSON.stringify(request.user));
      expect(invocation.args.join(' ')).not.toContain(request.user);
      expect(invocation.args).toContain('read-only');
      expect(invocation.args).toContain('never');
      expect(invocation.args).toContain('--ignore-user-config');
      expect(invocation.args).toContain('shell_tool');
      expect(invocation.args.at(-1)).toBe('-');
      const output = invocation.args[invocation.args.indexOf('--output-last-message') + 1]!;
      await writeFile(output, ' {"answers": []} \n');
      return { code: 0, stdout: 'ruido que no debe devolverse', stderr: 'diagnóstico' };
    });
    expect(await handleRequest(request, { run, launch })).toEqual({ ok: true, text: '{"answers": []}' });
    expect(existsSync(directory)).toBe(false);
  });
  it('agrega modelo y timeout sin interpretación por un shell', async () => {
    const run = vi.fn(async (invocation: ProcessRequest) => {
      expect(invocation.timeoutMs).toBe(2000);
      expect(invocation.args).toContain('test-model');
      throw new BridgeError('TIMEOUT', 'Tiempo agotado.');
    });
    expect(await handleRequest({ ...request, model: 'test-model', timeoutMs: 2000 }, { run, launch }))
      .toMatchObject({ ok: false, code: 'TIMEOUT' });
    expect(buildExecArgs(request, '/tmp/empty', '/tmp/out')).not.toContain('--model');
  });
  it('ping consulta versión sin generar una respuesta', async () => {
    const run = vi.fn(async (invocation: ProcessRequest) => {
      expect(invocation.args).toEqual(['--version']);
      return { code: 0, stdout: 'codex-cli 0.163.0-alpha.10.2\n', stderr: '' };
    });
    expect(await handleRequest({ type: 'ping' }, { run, launch }))
      .toEqual({ ok: true, version: '0.1.0', codexVersion: '0.163.0-alpha.10.2' });
  });
  it('no ejecuta procesos para solicitudes inválidas', async () => {
    const run = vi.fn();
    expect(await handleRequest({ ...request, timeoutMs: -1 }, { run, launch })).toMatchObject({ ok: false, code: 'UNKNOWN' });
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['usage limit reached', 'rate_limit_exceeded', 'quota exceeded'])('propaga %s como cupo agotado', async message => {
    const run: RunProcess = async () => ({ code: 1, stdout: '', stderr: message });
    expect(await handleRequest(request, { run, launch })).toMatchObject({ ok: false, code: 'USAGE_LIMIT' });
  });
  it.each([undefined, '', 'x'.repeat(600_000)])('rechaza archivo final ausente, vacío o grande', async content => {
    const run: RunProcess = async invocation => {
      if (content !== undefined) await writeFile(invocation.args[invocation.args.indexOf('--output-last-message') + 1]!, content);
      return { code: 0, stdout: 'texto engañoso', stderr: '' };
    };
    expect(await handleRequest(request, { run, launch })).toMatchObject({ ok: false, code: 'UNKNOWN' });
  });
  it.each([
    ['not logged in', 'NOT_LOGGED_IN'], ['Please sign in', 'NOT_LOGGED_IN'],
    ['refresh_token_expired', 'NOT_LOGGED_IN'], ['request timed out', 'TIMEOUT'],
    ['datos privados del CV', 'UNKNOWN'],
  ])('mapea %s y no expone el diagnóstico', (message, code) => {
    expect(failure(new Error(message))).toMatchObject({ ok: false, code });
    expect(failure(new Error(message)).error).not.toContain(message);
  });
  it('distingue un ejecutable ausente', () => {
    expect(failure(Object.assign(new Error('spawn'), { code: 'ENOENT' }))).toMatchObject({ code: 'NOT_INSTALLED' });
  });
});
