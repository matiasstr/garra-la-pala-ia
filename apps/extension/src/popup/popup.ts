import { isProviderUsable } from '@garra/core';
import type { TabMessage } from '../lib/messages';
import { getState } from '../lib/storage';

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

function note(text: string): void {
  const box = $('#note');
  box.textContent = text;
  box.hidden = false;
}

async function renderStats(): Promise<void> {
  const { profile, cvs, providers } = await getState('profile', 'cvs', 'providers');
  const filled = Object.values(profile).filter((v) => v?.trim()).length;
  const apis = providers.filter(isProviderUsable).length;
  const items = [
    `Perfil: ${filled ? `${filled} datos cargados` : 'vacío'}`,
    `CVs: ${cvs.length || 'ninguno'}`,
    `IA: Codex/ChatGPT (copiar y pegar)${apis ? ` + ${apis} API(s) de respaldo` : ''}`,
  ];
  $('#stats').replaceChildren(...items.map((text) => Object.assign(document.createElement('li'), { textContent: text })));
}

$('#open-options').addEventListener('click', () => void chrome.runtime.openOptionsPage());

$('#open-panel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) return note('Abrí la página de la postulación primero.');
  if (/(^|\.)linkedin\.com$/.test(new URL(tab.url!).hostname)) return note('En LinkedIn no funciona: abrí la postulación en el sitio de la empresa.');
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-panel' } satisfies TabMessage, { frameId: 0 });
    window.close();
  } catch {
    note('Recargá la página (F5) para que la extensión se active ahí.');
  }
});

void renderStats();
