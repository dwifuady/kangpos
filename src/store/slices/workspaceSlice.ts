// Spaces, their environments and templates.

import type { StateCreator } from 'zustand';
import type { AppState } from '..';
import * as api from '../../api';
import type {
  Environment,
  EnvVariable,
  RequestSpec,
  Space,
  SyncEvent,
  SyncStatus,
  Template,
  TemplateFolder,
  TemplateLayout,
  TemplateOrderInput,
} from '../../types';
import type { ImportResult } from '../../utils/importers';
import { DEFAULT_SEND_OPTIONS } from './uiSlice';

export interface WorkspaceSlice {
  spaces: Space[];
  activeSpaceId: string | null;
  spacesLoading: boolean;
  environments: Environment[];
  templates: Template[];
  /** Folder rows of the active space, in sidebar order. */
  templateFolders: TemplateFolder[];
  /** Folder sync state per linked space. */
  syncStatus: Record<string, SyncStatus>;

  loadInitial: () => Promise<void>;
  linkFolder: (spaceId: string, path: string) => Promise<boolean>;
  unlinkFolder: (spaceId: string) => Promise<void>;
  openWorkspaceFolder: (path: string) => Promise<void>;
  reloadFolder: (spaceId: string) => Promise<void>;
  handleSyncEvent: (event: SyncEvent) => Promise<void>;
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

  createTemplateFolder: (path: string) => Promise<void>;
  /** False when the rename was rejected (for example a duplicate path). */
  renameTemplateFolder: (id: string, path: string) => Promise<boolean>;
  deleteTemplateFolder: (id: string) => Promise<void>;
  /** New folder order, top to bottom. False when it was rejected. */
  arrangeTemplateFolders: (paths: string[]) => Promise<boolean>;
  /** New folder and position of templates after a drag. */
  arrangeTemplates: (items: TemplateOrderInput[]) => Promise<void>;

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
    // A Sync error means the database change went through but the folder write
    // didn't: say so plainly and reload, so the UI shows what was saved.
    if ((e as { code?: string })?.code === 'Sync') {
      get().addToast({ type: 'error', message: errorMessage(e), duration: 7000 });
      const spaceId = get().activeSpaceId;
      if (spaceId) void reloadDefinitions(spaceId);
      return null;
    }
    get().addToast({ type: 'error', message: `${what}: ${errorMessage(e)}` });
    return null;
  };

  /** Re-read templates, folders and environments (not tabs) of the active space. */
  const reloadDefinitions = async (spaceId: string) => {
    const [environments, templates, templateFolders] = await Promise.all([
      api.listEnvironments(spaceId),
      api.listTemplates(spaceId),
      api.listTemplateFolders(spaceId),
    ]);
    if (get().activeSpaceId === spaceId) set({ environments, templates, templateFolders });
  };

  const setStatus = (status: SyncStatus | null, spaceId: string) =>
    set(s => {
      const next = { ...s.syncStatus };
      if (status) next[spaceId] = status;
      else delete next[spaceId];
      return { syncStatus: next };
    });

  const replaceSpace = (space: Space) => set(s => ({ spaces: s.spaces.map(x => (x.id === space.id ? space : x)) }));

  /** Folders and templates come back together after a sidebar change. */
  const applyLayout = (layout: TemplateLayout) =>
    set({ templateFolders: layout.folders, templates: sortTemplates(layout.templates) });

  /** Load everything that belongs to one space and restore its last tab. */
  const loadSpaceContents = async (spaceId: string, preferredTabId?: string | null) => {
    const [environments, templates, templateFolders, tabs] = await Promise.all([
      api.listEnvironments(spaceId),
      api.listTemplates(spaceId),
      api.listTemplateFolders(spaceId),
      api.listTabs(spaceId),
    ]);
    if (get().activeSpaceId !== spaceId) return; // user switched again meanwhile
    const activeTabId =
      preferredTabId && tabs.some(t => t.id === preferredTabId) ? preferredTabId : (tabs[0]?.id ?? null);
    set({ environments, templates, templateFolders, tabs, activeTabId, lastCreatedTabId: null });
  };

  return {
    spaces: [],
    activeSpaceId: null,
    spacesLoading: true,
    environments: [],
    templates: [],
    templateFolders: [],
    syncStatus: {},

    linkFolder: async (spaceId, path) => {
      const space = await api.linkSpaceFolder(spaceId, path).catch(fail('Could not link folder'));
      if (!space) return false;
      replaceSpace(space);
      // Scripts already in the space were written here: trust them.
      const own = await api.listTemplates(spaceId).catch(() => []);
      await get().approveScripts(spaceId, own.flatMap(t => [t.request.scripts.before, t.request.scripts.after]));
      setStatus(await api.getSyncStatus(spaceId).catch(() => null), spaceId);
      get().addToast({ type: 'success', message: `Templates and environments are now saved in ${space.sync_dir}` });
      return true;
    },

    unlinkFolder: async (spaceId) => {
      const space = await api.unlinkSpaceFolder(spaceId).catch(fail('Could not unlink folder'));
      if (!space) return;
      replaceSpace(space);
      setStatus(null, spaceId);
      get().addToast({ type: 'info', message: 'Folder unlinked. Everything stays in this space; the folder was left as it is.' });
    },

    openWorkspaceFolder: async (path) => {
      const space = await api.openWorkspaceFolder(path).catch(fail('Could not open folder'));
      if (!space) return;
      set(s => ({ spaces: [...s.spaces, space] }));
      setStatus(await api.getSyncStatus(space.id).catch(() => null), space.id);
      await get().setActiveSpace(space.id);
      get().addToast({ type: 'success', message: `Opened "${space.name}" from ${space.sync_dir}` });
    },

    reloadFolder: async (spaceId) => {
      const status = await api.reloadSpaceFolder(spaceId).catch(fail('Could not read folder'));
      if (!status) return;
      setStatus(status, spaceId);
      replaceSpace(await api.listSpaces().then(list => list.find(s => s.id === spaceId)!));
      if (get().activeSpaceId === spaceId) await reloadDefinitions(spaceId);
    },

    handleSyncEvent: async ({ space_id, changed, status }) => {
      setStatus(status, space_id);
      if (!changed) return;
      // Name or colour may have changed through kangpos.yaml.
      const spaces = await api.listSpaces().catch(() => null);
      if (spaces) set({ spaces });
      if (get().activeSpaceId === space_id) {
        await reloadDefinitions(space_id);
        get().addToast({ type: 'info', message: 'Templates updated from the workspace folder. Open tabs are unchanged.', duration: 2500 });
      }
    },

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
        await get().loadScriptTrust();
        // Folder status (missing folder, unreadable files) for linked spaces.
        const statuses = await Promise.all(
          spaces.filter(s => s.sync_dir).map(s => api.getSyncStatus(s.id).catch(() => null)),
        );
        set({ syncStatus: Object.fromEntries(statuses.filter((st): st is SyncStatus => !!st).map(st => [st.space_id, st])) });
      } catch (e) {
        fail('Failed to load data')(e);
      } finally {
        set({ spacesLoading: false });
      }
    },

    setActiveSpace: async (id) => {
      if (get().activeSpaceId === id) return;
      set({ activeSpaceId: id, environments: [], templates: [], templateFolders: [], tabs: [], activeTabId: null });
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
        set({ activeSpaceId: null, tabs: [], templates: [], templateFolders: [], environments: [], activeTabId: null });
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
      // The new folder (and its parents) are rows now.
      const templateFolders = await api.listTemplateFolders(spaceId).catch(() => get().templateFolders);
      set(s => ({ templates: sortTemplates([...s.templates, created[0]]), templateFolders }));
      return created[0];
    },

    updateTemplate: async (id, input) => {
      const tpl = await api.updateTemplate(id, input).catch(fail('Failed to update template'));
      if (!tpl) return;
      const spaceId = get().activeSpaceId;
      const templateFolders = spaceId
        ? await api.listTemplateFolders(spaceId).catch(() => get().templateFolders)
        : get().templateFolders;
      set(s => ({ templates: sortTemplates(s.templates.map(t => (t.id === id ? tpl : t))), templateFolders }));
    },

    deleteTemplate: async (id) => {
      const ok = await api.deleteTemplate(id).then(() => true).catch(fail('Failed to delete template'));
      if (ok) set(s => ({ templates: s.templates.filter(t => t.id !== id) }));
    },

    createTemplateFolder: async (path) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return;
      const layout = await api
        .createTemplateFolder(spaceId, path)
        .catch(fail('Failed to create folder'));
      if (layout) applyLayout(layout);
    },

    renameTemplateFolder: async (id, path) => {
      const layout = await api.renameTemplateFolder(id, path).catch(fail('Failed to rename folder'));
      if (!layout) return false;
      applyLayout(layout);
      return true;
    },

    deleteTemplateFolder: async (id) => {
      const layout = await api.deleteTemplateFolder(id).catch(fail('Failed to delete folder'));
      if (layout) applyLayout(layout);
    },

    arrangeTemplateFolders: async (paths) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return false;
      const layout = await api.arrangeTemplateFolders(spaceId, paths).catch(fail('Failed to reorder folders'));
      if (!layout) return false;
      applyLayout(layout);
      return true;
    },

    arrangeTemplates: async (items) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return;
      const layout = await api.arrangeTemplates(spaceId, items).catch(fail('Failed to move template'));
      if (layout) applyLayout(layout);
    },

    applyImport: async (result) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return;
      if (result.templates.length > 0) {
        // Importing is the user's choice: trust the scripts that came with it.
        await get().approveScripts(spaceId, result.templates.flatMap(t => [t.request.scripts.before, t.request.scripts.after]));
        const created = await api.createTemplates(
          result.templates.map(t => ({ space_id: spaceId, name: t.name, folder: t.folder, request: t.request })),
        );
        const templateFolders = await api.listTemplateFolders(spaceId).catch(() => get().templateFolders);
        set(s => ({ templates: sortTemplates([...s.templates, ...created]), templateFolders }));
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
