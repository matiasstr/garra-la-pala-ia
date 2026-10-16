import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import type { LaunchCommand } from './launch';
import { HOST_NAME } from './protocol';

export interface InstallPlan {
  directory: string;
  manifestPath: string;
  launcherPath: string;
  launcher: string;
  manifest: { name: string; description: string; path: string; type: 'stdio'; allowed_origins: string[] };
  registryArgs?: string[];
}

export function createInstallPlan(extensionId: string, platform: string, home: string,
  nodePath: string, localAppData?: string, configHome?: string): InstallPlan {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('El ID de la extensión debe tener 32 letras entre a y p.');
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw new Error('Sistema operativo no compatible.');
  const path = platform === 'win32' ? win32 : posix;
  const directory = platform === 'win32' ? path.join(localAppData ?? path.join(home, 'AppData', 'Local'), 'GarraLaPala', 'codex-bridge')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'GarraLaPala', 'codex-bridge')
    : path.join(home, '.local', 'share', 'garra-la-pala', 'codex-bridge');
  const manifestDirectory = platform === 'win32' ? directory
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')
    : path.join(configHome ?? path.join(home, '.config'), 'google-chrome', 'NativeMessagingHosts');
  const launcherPath = path.join(directory, platform === 'win32' ? 'launch.cmd' : 'launch.sh');
  const hostPath = path.join(directory, 'host.cjs');
  const manifestPath = path.join(manifestDirectory, `${HOST_NAME}.json`);
  const quoteShell = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const quoteBatch = (value: string) => {
    if (/[\r\n"]/.test(value)) throw new Error('La ruta contiene caracteres incompatibles con el lanzador de Windows.');
    return '"' + value.replaceAll('%', '%%') + '"';
  };
  const launcher = platform === 'win32'
    ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\n${quoteBatch(nodePath)} ${quoteBatch(hostPath)}\r\n`
    : `#!/bin/sh\nexec ${quoteShell(nodePath)} ${quoteShell(hostPath)}\n`;
  return {
    directory, manifestPath, launcherPath, launcher,
    manifest: { name: HOST_NAME, description: 'Puente local de Garra la Pala con Codex', path: launcherPath,
      type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] },
    registryArgs: platform === 'win32' ? ['ADD', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'] : undefined,
  };
}

export async function installHost(extensionId: string, launch: LaunchCommand, bundledHost: string): Promise<InstallPlan> {
  const plan = createInstallPlan(extensionId, process.platform, homedir(), process.execPath,
    process.env.LOCALAPPDATA, process.env.XDG_CONFIG_HOME);
  await mkdir(plan.directory, { recursive: true });
  await mkdir(dirname(plan.manifestPath), { recursive: true });
  await copyFile(bundledHost, join(plan.directory, 'host.cjs'));
  await writeFile(join(plan.directory, 'bridge-config.json'), JSON.stringify(launch, null, 2), { mode: 0o600 });
  await writeFile(plan.launcherPath, plan.launcher, { mode: 0o700 });
  if (process.platform !== 'win32') await chmod(plan.launcherPath, 0o700);
  await writeFile(plan.manifestPath, JSON.stringify(plan.manifest, null, 2), { mode: 0o600 });
  if (plan.registryArgs) execFileSync('reg.exe', plan.registryArgs, { windowsHide: true, stdio: 'pipe' });
  return plan;
}
