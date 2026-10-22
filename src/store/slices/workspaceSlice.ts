// Spaces, their environments and templates.

import type { StateCreator } from 'zustand';
import type { AppState } from '..';
import * as api from '../../api';
import type { Environment, EnvVariable, RequestSpec, Space, Template } from '../../types';
import type { ImportResult } from '../../utils/importers';
import { DEFAULT_SEND_OPTIONS } from './uiSlice';

export interface WorkspaceSlice {
  spaces: Space[];
  activeSpaceId: string | null;
  spacesLoading: boolean;
  environments: Environment[];
  templates: Template[];

  loadInitial: () => Promise<void>;
  setActiveSpace: (id: string) => Promise<void>;
  createSpace: (name: string, color: string) => Promise<Space | null>;
  updateSpace: (id: string, input: { name?: string; color?: string }) => Promise<void>;
  deleteSpace: (id: string) => Promise<void>;

  setActiveEnvironment: (envId: string | null) => Promise<void>;
  createEnvironment: (name: string, variables?: EnvVariable[]) => Promise<Environment | null>;
  updateEnvironment: (id: string, input: { name?: string; variables?: EnvVariable[] }) => Promise<void>;
  deleteEnvironment: (id: string) => Promise<void>;

  createTemplate: (name: string, folder: string, request: RequestSpec) => Promise<Template | null>;
  updateTemplate: (id: string, input: { name?: string; folder?: string; request?: RequestSpec }) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;

  applyImport: (result: ImportResult) => Promise<void>;
}

export function activeEnvironment(state: Pick<AppState, 'spaces' | 'activeSpaceId' | 'environments'>): Environment | null {
  const space = state.spaces.find(s => s.id === state.activeSpaceId);
  if (!space?.active_environment_id) return null;
  return state.environments.find(e => e.id === space.active_environment_id) ?? null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const createWorkspaceSlice: StateCreator<AppState, [], [], WorkspaceSlice> = (set, get) => {
  const fail = (what: string) => (e: unknown) => {
    get().addToast({ type: 'error', message: `${what}: ${errorMessage(e)}` });
    return null;
  };

  /** Load everything that belongs to one space and restore its last tab. */
  const loadSpaceContents = async (spaceId: string, preferredTabId?: string | null) => {
    const [environments, templates, tabs] = await Promise.all([
      api.listEnvironments(spaceId),
      api.listTemplates(spaceId),
      api.listTabs(spaceId),
    ]);
    if (get().activeSpaceId !== spaceId) return; // user switched again meanwhile
    const activeTabId =
      preferredTabId && tabs.some(t => t.id === preferredTabId) ? preferredTabId : (tabs[0]?.id ?? null);
    set({ environments, templates, tabs, activeTabId, lastCreatedTabId: null });
  };

  return {
    spaces: [],
    activeSpaceId: null,
    spacesLoading: true,
    environments: [],
    templates: [],

    loadInitial: async () => {
      set({ spacesLoading: true });
      try {
        const [spaces, appState] = await Promise.all([api.listSpaces(), api.getAppState()]);
        const sidebarWidth = typeof appState.sidebar_width === 'number' ? appState.sidebar_width : get().sidebarWidth;
        const sendOptions = { ...DEFAULT_SEND_OPTIONS, ...((appState.send_options as object) ?? {}) };
        const lastSpaceId = appState.last_space_id as string | undefined;
        const lastTabs = (appState.last_tab_by_space as Record<string, string> | undefined) ?? {};
        const space = spaces.find(s => s.id === lastSpaceId) ?? spaces[0] ?? null;
        set({ spaces, sidebarWidth, sendOptions, lastTabBySpace: lastTabs, activeSpaceId: space?.id ?? null });
        if (space) await loadSpaceContents(space.id, lastTabs[space.id]);
      } catch (e) {
        fail('Failed to load data')(e);
      } finally {
        set({ spacesLoading: false });
      }
    },

    setActiveSpace: async (id) => {
      if (get().activeSpaceId === id) return;
      set({ activeSpaceId: id, environments: [], templates: [], tabs: [], activeTabId: null });
      void api.setAppState('last_space_id', id).catch(() => undefined);
      await loadSpaceContents(id, get().lastTabBySpace[id]).catch(fail('Failed to load space'));
    },

    createSpace: async (name, color) => {
      const space = await api.createSpace(name, color).catch(fail('Failed to create space'));
      if (!space) return null;
      set(s => ({ spaces: [...s.spaces, space] }));
      await get().setActiveSpace(space.id);
      return space;
    },

    updateSpace: async (id, input) => {
      const space = await api.updateSpace(id, input).catch(fail('Failed to update space'));
      if (space) set(s => ({ spaces: s.spaces.map(x => (x.id === id ? space : x)) }));
    },

    deleteSpace: async (id) => {
      const ok = await api.deleteSpace(id).then(() => true).catch(fail('Failed to delete space'));
      if (!ok) return;
      const spaces = get().spaces.filter(s => s.id !== id);
      set({ spaces });
      if (get().activeSpaceId === id) {
        set({ activeSpaceId: null, tabs: [], templates: [], environments: [], activeTabId: null });
        if (spaces[0]) await get().setActiveSpace(spaces[0].id);
      }
    },

    setActiveEnvironment: async (envId) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return;
      const space = await api
        .updateSpace(spaceId, { active_environment_id: envId })
        .catch(fail('Failed to switch environment'));
      if (space) set(s => ({ spaces: s.spaces.map(x => (x.id === spaceId ? space : x)) }));
    },

    createEnvironment: async (name, variables = []) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return null;
      const env = await api.createEnvironment(spaceId, name, variables).catch(fail('Failed to create environment'));
      if (env) set(s => ({ environments: [...s.environments, env] }));
      return env;
    },

    updateEnvironment: async (id, input) => {
      const env = await api.updateEnvironment(id, input).catch(fail('Failed to save environment'));
      if (env) set(s => ({ environments: s.environments.map(e => (e.id === id ? env : e)) }));
    },

    deleteEnvironment: async (id) => {
      const ok = await api.deleteEnvironment(id).then(() => true).catch(fail('Failed to delete environment'));
      if (!ok) return;
      set(s => ({
        environments: s.environments.filter(e => e.id !== id),
        spaces: s.spaces.map(sp => (sp.active_environment_id === id ? { ...sp, active_environment_id: null } : sp)),
      }));
    },

    createTemplate: async (name, folder, request) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return null;
      const created = await api
        .createTemplates([{ space_id: spaceId, name, folder, request }])
        .catch(fail('Failed to save template'));
      if (!created) return null;
      set(s => ({ templates: sortTemplates([...s.templates, created[0]]) }));
      return created[0];
    },

    updateTemplate: async (id, input) => {
      const tpl = await api.updateTemplate(id, input).catch(fail('Failed to update template'));
      if (tpl) set(s => ({ templates: sortTemplates(s.templates.map(t => (t.id === id ? tpl : t))) }));
    },

    deleteTemplate: async (id) => {
      const ok = await api.deleteTemplate(id).then(() => true).catch(fail('Failed to delete template'));
      if (ok) set(s => ({ templates: s.templates.filter(t => t.id !== id) }));
    },

    applyImport: async (result) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return;
      if (result.templates.length > 0) {
        const created = await api.createTemplates(
          result.templates.map(t => ({ space_id: spaceId, name: t.name, folder: t.folder, request: t.request })),
        );
        set(s => ({ templates: sortTemplates([...s.templates, ...created]) }));
      }
      let firstEnv: Environment | null = null;
      for (const env of result.environments) {
        const created = await api.createEnvironment(spaceId, env.name, env.variables);
        firstEnv ??= created;
        set(s => ({ environments: [...s.environments, created] }));
      }
      // Activate the imported environment when none is active yet.
      if (firstEnv && !activeEnvironment(get())) await get().setActiveEnvironment(firstEnv.id);
    },
  };
};

function sortTemplates(templates: Template[]): Template[] {
  return [...templates].sort(
    (a, b) => a.folder.localeCompare(b.folder) || a.sort_order - b.sort_order || a.name.localeCompare(b.name),
  );
}
