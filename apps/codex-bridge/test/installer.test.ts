import { describe, expect, it } from 'vitest';
import { createInstallPlan } from '../src/installer';
import { HOST_NAME } from '../src/protocol';

const id = 'abcdefghijklmnopabcdefghijklmnop';
describe('instalación para Chrome', () => {
  it('Windows usa HKCU y rutas absolutas con espacios', () => {
    const plan = createInstallPlan(id, 'win32', 'C:\\Users\\Persona', 'C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\Persona\\AppData\\Local');
    expect(plan.registryArgs).toEqual(['ADD', `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      '/ve', '/t', 'REG_SZ', '/d', plan.manifestPath, '/f']);
    expect(plan.launcher).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(plan.launcher).toContain('DisableDelayedExpansion');
    expect(plan.manifest.allowed_origins).toEqual([`chrome-extension://${id}/`]);
    expect(plan.manifest.path).toBe(plan.launcherPath);
  });
  it('macOS usa Library y cita rutas con comillas simples', () => {
    const plan = createInstallPlan(id, 'darwin', "/Users/O'Connor", '/usr/local/bin/node');
    expect(plan.manifestPath).toBe(`/Users/O'Connor/Library/Application Support/Google/Chrome/NativeMessagingHosts/${HOST_NAME}.json`);
    expect(plan.launcher).toContain("O'\\''Connor");
    expect(plan.registryArgs).toBeUndefined();
  });
  it('Linux respeta XDG_CONFIG_HOME', () => {
    const plan = createInstallPlan(id, 'linux', '/home/persona', '/usr/bin/node', undefined, '/custom/config');
    expect(plan.manifestPath).toBe(`/custom/config/google-chrome/NativeMessagingHosts/${HOST_NAME}.json`);
    expect(plan.launcher.startsWith('#!/bin/sh\nexec ')).toBe(true);
    expect(createInstallPlan(id, 'linux', '/home/p', '/usr/bin/node').manifestPath).toContain('/home/p/.config/');
  });
  it.each(['', '*', 'z'.repeat(32), 'a'.repeat(31), '../id'])('rechaza el ID %s', invalid => {
    expect(() => createInstallPlan(invalid, 'linux', '/home/p', '/usr/bin/node')).toThrow();
  });
  it('rechaza plataformas desconocidas y cita porcentajes en batch', () => {
    expect(() => createInstallPlan(id, 'other', '/', '/node')).toThrow();
    expect(createInstallPlan(id, 'win32', 'C:\\%persona%', 'C:\\node.exe').launcher).toContain('%%persona%%');
  });
});
