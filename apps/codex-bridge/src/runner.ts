import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeError, failure } from './errors';
import { resolveCodexLaunch } from './launch';
import type { LaunchCommand } from './launch';
import { DEFAULT_TIMEOUT_MS, MAX_MESSAGE_BYTES, VERSION, parseRequest } from './protocol';
import type { BridgeResponse, CompleteRequest } from './protocol';

export interface ProcessRequest {
  launch: LaunchCommand;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
}
export interface ProcessResult { code: number | null; stdout: string; stderr: string }
export type RunProcess = (request: ProcessRequest) => Promise<ProcessResult>;

/** npm puede arrancar Codex a través de Node: terminar también sus descendientes. */
export function terminateProcess(child: ChildProcess, platform: string = process.platform): void {
  if (!child.pid) { child.kill('SIGKILL'); return; }
  if (platform === 'win32') {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, error => {
      if (error) child.kill('SIGKILL');
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { child.kill('SIGKILL'); }
  }
}

export const runProcess: RunProcess = request => new Promise((resolve, reject) => {
  // La autenticación se conserva en CODEX_HOME; no heredar claves de API.
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const child = spawn(request.launch.command, [...request.launch.args, ...request.args], {
    cwd: request.cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let inputError: Error | undefined;
  const timer = setTimeout(() => { timedOut = true; terminateProcess(child); }, request.timeoutMs);
  child.stdout.setEncoding('utf8').on('data', (data: string) => { stdout = (stdout + data).slice(-64 * 1024); });
  child.stderr.setEncoding('utf8').on('data', (data: string) => { stderr = (stderr + data).slice(-64 * 1024); });
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => {
    clearTimeout(timer);
    if (timedOut) reject(new BridgeError('TIMEOUT', 'Codex superó el tiempo de espera.'));
    else if (inputError && code === 0) reject(inputError);
    else resolve({ code, stdout, stderr });
  });
  child.stdin.on('error', error => { inputError = error; });
  child.stdin.end(request.input, 'utf8');
});

export function buildExecArgs(request: CompleteRequest, cwd: string, outputPath: string): string[] {
  const args = [
    '--no-daemon', '--ask-for-approval', 'never', 'exec',
    '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', cwd,
    '--color', 'never', '--output-last-message', outputPath,
    '-c', 'forced_login_method="chatgpt"', '-c', 'web_search="disabled"',
    '-c', 'apps._default.enabled=false',
  ];
  for (const feature of ['shell_tool', 'apps', 'plugins', 'hooks', 'multi_agent', 'multi_agent_v2',
    'code_mode', 'code_mode_host', 'browser_use', 'computer_use', 'image_generation']) {
    args.push('--disable', feature);
  }
  if (request.model) args.push('--model', request.model);
  args.push('-');
  return args;
}

export interface RunnerOptions { launch?: LaunchCommand; run?: RunProcess; tempRoot?: string }

export async function handleRequest(value: unknown, options: RunnerOptions = {}): Promise<BridgeResponse> {
  let directory: string | undefined;
  try {
    const request = parseRequest(value);
    const launch = options.launch ?? resolveCodexLaunch();
    const run = options.run ?? runProcess;
    directory = await mkdtemp(join(options.tempRoot ?? tmpdir(), 'garra-codex-'));
    if (request.type === 'ping') {
      const result = await run({ launch, args: ['--version'], cwd: directory, input: '', timeoutMs: 10_000 });
      if (result.code !== 0) throw new Error(result.stderr + result.stdout);
      const version = result.stdout.match(/codex(?:-cli)?\s+(\S+)/)?.[1];
      if (!version) throw new Error('Versión de Codex inválida.');
      return { ok: true, version: VERSION, codexVersion: version };
    }
    const cwd = join(directory, 'workspace');
    await mkdir(cwd);
    const outputPath = join(directory, 'response.txt');
    const input = 'Respondé únicamente el resultado solicitado. No uses herramientas, no ejecutes comandos ni leas archivos. '
      + 'Usá solo los datos provistos; no inventes datos personales verificables.\n\n'
      + JSON.stringify({ system: request.system, user: request.user });
    const result = await run({ launch, args: buildExecArgs(request, cwd, outputPath), cwd, input,
      timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    if (result.code !== 0) throw new Error(result.stderr + '\n' + result.stdout);
    // Un archivo faltante no significa que falte el binario de Codex.
    const info = await stat(outputPath).catch(() => null);
    if (!info || info.size > MAX_MESSAGE_BYTES / 2) throw new Error('Respuesta ausente o demasiado grande.');
    const text = (await readFile(outputPath, 'utf8')).trim();
    if (!text) throw new Error('Respuesta vacía.');
    const response: BridgeResponse = { ok: true, text };
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_MESSAGE_BYTES) throw new Error('Respuesta demasiado grande.');
    return response;
  } catch (error) {
    return failure(error);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
