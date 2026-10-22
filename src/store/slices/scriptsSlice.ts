// Script trust for spaces synced with a folder. Scripts can arrive through
// `git pull`, so a script runs without asking only if:
//   - the space is not linked to a folder (everything in it was typed here), or
//   - the user trusted every script in the space, or
//   - this exact script text was approved before (typed in this app, present
//     when the folder was linked, imported here, or allowed in the prompt).
// Trust lives in the local app state, never in the shared folder.

import type { StateCreator } from 'zustand';
import type { AppState } from '..';
import * as api from '../../api';

export type ScriptDecision = 'run' | 'skip' | 'cancel';
export type ScriptPromptAnswer = 'allow' | 'trust-space' | 'skip' | 'cancel';

export interface ScriptPrompt {
  spaceName: string;
  requestName: string;
  before: string;
  after: string;
  answer: (choice: ScriptPromptAnswer) => void;
}

interface SpaceTrust {
  all: boolean;
  hashes: string[];
}

export interface ScriptsSlice {
  scriptTrust: Record<string, SpaceTrust>;
  scriptPrompt: ScriptPrompt | null;
  loadScriptTrust: () => Promise<void>;
  approveScripts: (spaceId: string, texts: string[]) => Promise<void>;
  setSpaceScriptTrust: (spaceId: string, all: boolean) => Promise<void>;
  ensureScriptsAllowed: (spaceId: string, requestName: string, scripts: { before: string; after: string }) => Promise<ScriptDecision>;
}

const TRUST_KEY = 'script_trust';
const MAX_HASHES = 1000;

export async function scriptHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const createScriptsSlice: StateCreator<AppState, [], [], ScriptsSlice> = (set, get) => {
  const save = (trust: Record<string, SpaceTrust>) => {
    set({ scriptTrust: trust });
    void api.setAppState(TRUST_KEY, trust).catch(() => undefined);
  };

  return {
    scriptTrust: {},
    scriptPrompt: null,

    loadScriptTrust: async () => {
      const state = await api.getAppState().catch(() => ({}) as Record<string, unknown>);
      const trust = state[TRUST_KEY];
      if (trust && typeof trust === 'object') set({ scriptTrust: trust as Record<string, SpaceTrust> });
    },

    approveScripts: async (spaceId, texts) => {
      const wanted = texts.filter(t => t.trim() !== '');
      if (wanted.length === 0) return;
      const hashes = await Promise.all(wanted.map(scriptHash));
      const current = get().scriptTrust[spaceId] ?? { all: false, hashes: [] };
      const merged = [...current.hashes.filter(h => !hashes.includes(h)), ...hashes].slice(-MAX_HASHES);
      save({ ...get().scriptTrust, [spaceId]: { ...current, hashes: merged } });
    },

    setSpaceScriptTrust: async (spaceId, all) => {
      const current = get().scriptTrust[spaceId] ?? { all: false, hashes: [] };
      save({ ...get().scriptTrust, [spaceId]: { ...current, all } });
    },

    ensureScriptsAllowed: async (spaceId, requestName, scripts) => {
      const space = get().spaces.find(s => s.id === spaceId);
      if (!space?.sync_dir) return 'run';
      const trust = get().scriptTrust[spaceId];
      if (trust?.all) return 'run';
      const texts = [scripts.before, scripts.after].filter(t => t.trim() !== '');
      const hashes = await Promise.all(texts.map(scriptHash));
      if (hashes.every(h => trust?.hashes.includes(h))) return 'run';

      const choice = await new Promise<ScriptPromptAnswer>(resolve =>
        set({ scriptPrompt: { spaceName: space.name, requestName, before: scripts.before, after: scripts.after, answer: resolve } }),
      );
      set({ scriptPrompt: null });
      if (choice === 'allow') await get().approveScripts(spaceId, texts);
      if (choice === 'trust-space') await get().setSpaceScriptTrust(spaceId, true);
      return choice === 'allow' || choice === 'trust-space' ? 'run' : choice;
    },
  };
};
