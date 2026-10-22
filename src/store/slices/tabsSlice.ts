// Tabs: create from a template (snapshot), edit with debounced autosave, send.

import type { StateCreator } from 'zustand';
import type { AppState } from '..';
import * as api from '../../api';
import type { UpdateTabInput } from '../../api';
import { emptyRequest, type ParamValues, type RequestSpec, type StoredResponse, type Tab, type Template } from '../../types';
import { buildRequest, toSendInput, unusedParams } from '../../utils/request';
import { defaultParamValues, missingRequiredParams } from '../../utils/variables';
import { activeEnvironment } from './workspaceSlice';

export interface TabsSlice {
  tabs: Tab[];
  activeTabId: string | null;
  lastCreatedTabId: string | null;
  lastTabBySpace: Record<string, string>;
  /** tabId -> in-flight request id */
  inFlight: Record<string, string>;

  setActiveTab: (id: string) => void;
  openTemplate: (template: Template | null) => Promise<void>;
  editTabRequest: (id: string, update: (request: RequestSpec) => RequestSpec) => void;
  setTabParamValue: (id: string, name: string, value: string) => void;
  renameTab: (id: string, title: string | null) => void;
  togglePin: (id: string) => void;
  duplicateTab: (id: string) => Promise<void>;
  closeTab: (id: string) => Promise<void>;
  cycleTab: (direction: 1 | -1) => void;
  flushTabSaves: () => Promise<void>;

  sendTab: (id: string) => Promise<void>;
  cancelTab: (id: string) => Promise<void>;

  saveTabAsTemplate: (id: string, name: string, folder: string, request: RequestSpec) => Promise<void>;
  updateTemplateFromTab: (id: string) => Promise<void>;
}

const SAVE_DELAY = 400;
const pending = new Map<string, { timer: number; input: UpdateTabInput }>();

export const createTabsSlice: StateCreator<AppState, [], [], TabsSlice> = (set, get) => {
  const toastError = (what: string, e: unknown) =>
    get().addToast({ type: 'error', message: `${what}: ${e instanceof Error ? e.message : String(e)}` });

  const persistNow = async (id: string) => {
    const entry = pending.get(id);
    if (!entry) return;
    window.clearTimeout(entry.timer);
    pending.delete(id);
    await api.updateTab(id, entry.input).catch(e => toastError('Failed to save tab', e));
  };

  /** Merge a change into the tab now; write it to SQLite after a short pause. */
  const patchTab = (id: string, input: UpdateTabInput, immediate = false) => {
    set(s => ({ tabs: s.tabs.map(t => (t.id === id ? { ...t, ...input } as Tab : t)) }));
    const prev = pending.get(id);
    if (prev) window.clearTimeout(prev.timer);
    const merged = { ...(prev?.input ?? {}), ...input };
    const timer = window.setTimeout(() => void persistNow(id), immediate ? 0 : SAVE_DELAY);
    pending.set(id, { timer, input: merged });
  };

  const rememberTab = (id: string | null) => {
    const spaceId = get().activeSpaceId;
    if (!spaceId || !id) return;
    const lastTabBySpace = { ...get().lastTabBySpace, [spaceId]: id };
    set({ lastTabBySpace });
    void api.setAppState('last_tab_by_space', lastTabBySpace).catch(() => undefined);
  };

  return {
    tabs: [],
    activeTabId: null,
    lastCreatedTabId: null,
    lastTabBySpace: {},
    inFlight: {},

    setActiveTab: (id) => {
      set({ activeTabId: id });
      rememberTab(id);
    },

    openTemplate: async (template) => {
      const spaceId = get().activeSpaceId;
      if (!spaceId) return;
      // Deep copy: the tab is a snapshot and must never share objects with the template.
      const request: RequestSpec = structuredClone(template ? template.request : emptyRequest());
      try {
        const tab = await api.createTab({
          space_id: spaceId,
          template_id: template?.id ?? null,
          template_name: template?.name ?? null,
          request,
          param_values: defaultParamValues(request.params),
        });
        set(s => ({ tabs: insertTab(s.tabs, tab), activeTabId: tab.id, lastCreatedTabId: tab.id, pickerOpen: false }));
        rememberTab(tab.id);
      } catch (e) {
        toastError('Failed to create tab', e);
      }
    },

    editTabRequest: (id, update) => {
      const tab = get().tabs.find(t => t.id === id);
      if (!tab) return;
      patchTab(id, { request: update(tab.request) });
    },

    setTabParamValue: (id, name, value) => {
      const tab = get().tabs.find(t => t.id === id);
      if (!tab) return;
      patchTab(id, { param_values: { ...tab.param_values, [name]: value } as ParamValues });
    },

    renameTab: (id, title) => {
      const clean = title?.trim() ? title.trim() : null;
      patchTab(id, { custom_title: clean }, true);
    },

    togglePin: (id) => {
      const tab = get().tabs.find(t => t.id === id);
      if (!tab) return;
      patchTab(id, { is_pinned: !tab.is_pinned }, true);
      set(s => ({ tabs: sortTabs(s.tabs) }));
    },

    duplicateTab: async (id) => {
      const tab = get().tabs.find(t => t.id === id);
      if (!tab) return;
      try {
        const copy = await api.createTab({
          space_id: tab.space_id,
          template_id: tab.template_id,
          template_name: tab.template_name,
          request: structuredClone(tab.request),
          param_values: { ...tab.param_values },
        });
        set(s => ({ tabs: insertTab(s.tabs, copy), activeTabId: copy.id, lastCreatedTabId: copy.id }));
        rememberTab(copy.id);
      } catch (e) {
        toastError('Failed to duplicate tab', e);
      }
    },

    closeTab: async (id) => {
      const entry = pending.get(id);
      if (entry) {
        window.clearTimeout(entry.timer);
        pending.delete(id);
      }
      const requestId = get().inFlight[id];
      if (requestId) void api.cancelRequest(requestId).catch(() => undefined);
      const { tabs, activeTabId } = get();
      const index = tabs.findIndex(t => t.id === id);
      const remaining = tabs.filter(t => t.id !== id);
      let nextActive = activeTabId;
      if (activeTabId === id) nextActive = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
      set({ tabs: remaining, activeTabId: nextActive });
      rememberTab(nextActive);
      await api.deleteTab(id).catch(e => toastError('Failed to close tab', e));
    },

    cycleTab: (direction) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0) return;
      const index = tabs.findIndex(t => t.id === activeTabId);
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      get().setActiveTab(next.id);
    },

    flushTabSaves: async () => {
      await Promise.all([...pending.keys()].map(persistNow));
    },

    sendTab: async (id) => {
      const state = get();
      const tab = state.tabs.find(t => t.id === id);
      if (!tab || state.inFlight[id]) return;

      const missing = missingRequiredParams(tab.request.params, tab.param_values);
      if (missing.length > 0) {
        state.addToast({ type: 'error', message: `Fill in required params: ${missing.map(p => p.name).join(', ')}` });
        return;
      }

      const unused = unusedParams(tab.request).filter(p => (tab.param_values[p.name] ?? p.default).trim() !== '');
      if (unused.length > 0) {
        state.addToast({
          type: 'info',
          message: `Inputs not used in the request (not sent): ${unused.map(p => p.name).join(', ')}. Reference them as {{name}} or use "Add as query params".`,
          duration: 6000,
        });
      }

      const env = activeEnvironment(state);
      const built = buildRequest(tab.request, {
        params: tab.request.params,
        paramValues: tab.param_values,
        env: env?.variables ?? [],
      });
      if (built.unresolved.length > 0) {
        state.addToast({
          type: 'info',
          message: `Unresolved: ${built.unresolved.map(n => `{{${n}}}`).join(', ')}${env ? '' : ' (no environment selected)'}`,
        });
      }

      const requestId = crypto.randomUUID();
      set(s => ({ inFlight: { ...s.inFlight, [id]: requestId } }));
      let stored: StoredResponse;
      try {
        const response = await api.sendRequest(toSendInput(built, requestId, state.sendOptions));
        stored = { response, sentAt: new Date().toISOString(), method: built.method, url: built.url };
      } catch (e) {
        stored = {
          error: e instanceof Error ? e.message : String(e),
          sentAt: new Date().toISOString(),
          method: built.method,
          url: built.url,
        };
      } finally {
        set(s => {
          const rest = { ...s.inFlight };
          delete rest[id];
          return { inFlight: rest };
        });
      }
      if (get().tabs.some(t => t.id === id)) patchTab(id, { response: stored }, true);
    },

    cancelTab: async (id) => {
      const requestId = get().inFlight[id];
      if (requestId) await api.cancelRequest(requestId).catch(() => undefined);
    },

    saveTabAsTemplate: async (id, name, folder, request) => {
      const tpl = await get().createTemplate(name, folder, request);
      if (!tpl) return;
      // The tab now belongs to the new template (so Ctrl+S updates it).
      patchTab(id, { template_id: tpl.id, template_name: tpl.name, request: structuredClone(request) }, true);
      get().addToast({ type: 'success', message: `Saved template "${tpl.name}"` });
    },

    updateTemplateFromTab: async (id) => {
      const tab = get().tabs.find(t => t.id === id);
      const tpl = tab?.template_id ? get().templates.find(t => t.id === tab.template_id) : undefined;
      if (!tab || !tpl) {
        get().setSaveTemplateOpen(true);
        return;
      }
      await get().updateTemplate(tpl.id, { request: structuredClone(tab.request) });
      get().addToast({ type: 'success', message: `Updated template "${tpl.name}"` });
    },
  };
};

function sortTabs(tabs: Tab[]): Tab[] {
  return [...tabs].sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.sort_order - a.sort_order);
}

/** New tabs go first among unpinned tabs (newest on top, like Larik). */
function insertTab(tabs: Tab[], tab: Tab): Tab[] {
  return sortTabs([tab, ...tabs]);
}
