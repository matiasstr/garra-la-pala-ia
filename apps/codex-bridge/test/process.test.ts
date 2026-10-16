import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { runProcess, terminateProcess } from '../src/runner';

vi.mock('node:child_process', () => ({ spawn: vi.fn(), execFile: vi.fn() }));

function mockChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
    kill: vi.fn(() => { child.emit('close', null); return true; }),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
  return child;
}
const request = { launch: { command: 'C:\\Program Files\\node.exe', args: ['C:\\codex\\codex.js'] },
  args: ['exec', '-'], cwd: 'C:\\tmp', input: 'CV privado', timeoutMs: 1000 };
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('proceso sin shell', () => {
  it('escribe stdin, oculta la ventana y elimina claves de API del entorno', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'no-transmitir');
    vi.stubEnv('CODEX_API_KEY', 'no-transmitir');
    const child = mockChild();
    let input = ''; child.stdin.on('data', chunk => { input += String(chunk); });
    const pending = runProcess(request);
    child.stdout.write('salida'); child.stderr.write('diagnóstico'); child.emit('close', 0);
    expect(await pending).toEqual({ code: 0, stdout: 'salida', stderr: 'diagnóstico' });
    expect(input).toBe(request.input);
    expect(spawn).toHaveBeenCalledWith(request.launch.command, ['C:\\codex\\codex.js', 'exec', '-'],
      expect.objectContaining({ shell: false, windowsHide: true, cwd: request.cwd }));
    const options = vi.mocked(spawn).mock.calls[0]?.[2];
    expect(options?.env).not.toHaveProperty('OPENAI_API_KEY');
    expect(options?.env).not.toHaveProperty('CODEX_API_KEY');
  });
  it('mata el proceso al vencer el timeout y espera su cierre', async () => {
    vi.useFakeTimers();
    const child = mockChild();
    const pending = expect(runProcess(request)).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
  it('propaga ENOENT y tolera stdin cerrado sin un error no manejado', async () => {
    const child = mockChild();
    const pending = expect(runProcess(request)).rejects.toMatchObject({ code: 'ENOENT' });
    child.stdin.emit('error', Object.assign(new Error('closed'), { code: 'EPIPE' }));
    child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }));
    await pending;
  });
  it('termina el árbol completo en Windows sin abrir una ventana', () => {
    const child = Object.assign(mockChild(), { pid: 12345 });
    terminateProcess(child as unknown as ChildProcessWithoutNullStreams, 'win32');
    expect(execFile).toHaveBeenCalledWith('taskkill.exe', ['/PID', '12345', '/T', '/F'],
      { windowsHide: true, timeout: 5000 }, expect.any(Function));
  });
  it('termina el grupo de procesos en POSIX', () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    const child = Object.assign(mockChild(), { pid: 12345 });
    terminateProcess(child as unknown as ChildProcessWithoutNullStreams, 'linux');
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
  });
});
