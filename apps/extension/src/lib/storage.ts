import type { CandidateProfile, CvDocument, JobPosting, ProviderConfig } from '@garra/core';

/** Codex instalado en la compu, vía el puente local (apps/codex-bridge). */
export interface CodexSettings {
  /** Probar Codex local antes que las APIs gratis. */
  enabled: boolean;
  /** Modelo opcional. Vacío = el que tengas configurado en Codex. */
  model: string;
  /** Codex razona antes de responder: le damos más tiempo que a una API. */
  timeoutMs: number;
}

export const DEFAULT_CODEX_SETTINGS: CodexSettings = { enabled: false, model: '', timeoutMs: 180_000 };

/** Todo lo que guarda la extensión en chrome.storage.local (queda solo en esta compu). */
export interface StoredState {
  profile: CandidateProfile;
  cvs: CvDocument[];
  /** APIs de respaldo, en el orden en que se prueban. */
  providers: ProviderConfig[];
  /** Ofertas vistas hace poco, para el formulario que no trae la descripción. */
  recentJobs: JobPosting[];
  codex: CodexSettings;
}

const DEFAULTS: StoredState = {
  profile: {},
  cvs: [],
  providers: [],
  recentJobs: [],
  codex: DEFAULT_CODEX_SETTINGS,
};

export async function getState<K extends keyof StoredState>(...keys: K[]): Promise<Pick<StoredState, K>> {
  const stored = (await chrome.storage.local.get(keys)) as Partial<StoredState>;
  const result = {} as Pick<StoredState, K>;
  for (const key of keys) result[key] = (stored[key] ?? structuredClone(DEFAULTS[key])) as StoredState[K];
  return result;
}

export async function setState(partial: Partial<StoredState>): Promise<void> {
  await chrome.storage.local.set(partial);
}
