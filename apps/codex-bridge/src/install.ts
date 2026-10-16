import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { resolveCodexLaunch } from './launch';
import { installHost } from './installer';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'extension-id': { type: 'string' }, 'codex-path': { type: 'string' } } });
  if (!values['extension-id']) throw new Error('Uso: npm run install-host -w @garra/codex-bridge -- --extension-id <ID> [--codex-path <ruta>]');
  const launch = resolveCodexLaunch(values['codex-path']);
  const plan = await installHost(values['extension-id'], launch, join(__dirname, 'host.cjs'));
  console.log(`Puente registrado para Chrome: ${plan.manifestPath}`);
  console.log('Reiniciá Chrome y probá el mensaje ping desde el service worker de la extensión.');
}
void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'No se pudo registrar el puente.');
  process.exitCode = 1;
});
