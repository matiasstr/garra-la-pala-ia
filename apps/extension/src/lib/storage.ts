import type { CandidateProfile, CvDocument, JobPosting, ProviderConfig } from '@garra/core';

/** Todo lo que guarda la extensión en chrome.storage.local (queda solo en esta compu). */
export interface StoredState {
  profile: CandidateProfile;
  cvs: CvDocument[];
  /** APIs de respaldo, en el orden en que se prueban. */
  providers: ProviderConfig[];
  /** Ofertas vistas hace poco, para el formulario que no trae la descripción. */
  recentJobs: JobPosting[];
}

const DEFAULTS: StoredState = {
  profile: {},
  cvs: [],
  providers: [],
  recentJobs: [],
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
