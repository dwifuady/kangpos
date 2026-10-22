import type { StateCreator } from 'zustand';
import type { AppState } from '..';
import type { SendOptions } from '../../types';
import { syncNativeTheme } from '../../utils/nativeWindow';
import * as api from '../../api';

export type Theme = 'dark' | 'light' | 'system';
export type SidebarView = 'tabs' | 'templates';

export interface Toast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
  duration?: number;
}

export type SpaceDialogState = { mode: 'create' } | { mode: 'edit'; spaceId: string } | null;

export interface UISlice {
  theme: Theme;
  sidebarWidth: number;
  sidebarHidden: boolean;
  sidebarView: SidebarView;
  pickerOpen: boolean;
  spaceDialog: SpaceDialogState;
  envDialogOpen: boolean;
  saveTemplateOpen: boolean;
  importOpen: boolean;
  settingsOpen: boolean;
  sendOptions: SendOptions;
  toasts: Toast[];

  initTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSidebarWidth: (width: number) => void;
  toggleSidebarHidden: () => void;
  setSidebarView: (view: SidebarView) => void;
  setPickerOpen: (open: boolean) => void;
  setSpaceDialog: (state: SpaceDialogState) => void;
  setEnvDialogOpen: (open: boolean) => void;
  setSaveTemplateOpen: (open: boolean) => void;
  setImportOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSendOptions: (options: Partial<SendOptions>) => void;
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: number) => void;
}

const THEME_KEY = 'kangpos-theme';
let nextToastId = 1;

function applyTheme(theme: Theme) {
  const resolved =
    theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  syncNativeTheme(theme);
}

export const DEFAULT_SEND_OPTIONS: SendOptions = { timeoutMs: 30000, followRedirects: true, verifyTls: true };

export const createUISlice: StateCreator<AppState, [], [], UISlice> = (set, get) => ({
  theme: 'system',
  sidebarWidth: 240,
  sidebarHidden: false,
  sidebarView: 'tabs',
  pickerOpen: false,
  spaceDialog: null,
  envDialogOpen: false,
  saveTemplateOpen: false,
  importOpen: false,
  settingsOpen: false,
  sendOptions: DEFAULT_SEND_OPTIONS,
  toasts: [],

  initTheme: () => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    const theme = saved ?? 'system';
    set({ theme });
    applyTheme(theme);
  },

  setTheme: (theme) => {
    set({ theme });
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  },

  setSidebarWidth: (width) => {
    set({ sidebarWidth: width });
    void api.setAppState('sidebar_width', width).catch(() => undefined);
  },

  toggleSidebarHidden: () => set(s => ({ sidebarHidden: !s.sidebarHidden })),
  setSidebarView: (view) => set({ sidebarView: view }),
  setPickerOpen: (open) => set({ pickerOpen: open }),
  setSpaceDialog: (state) => set({ spaceDialog: state }),
  setEnvDialogOpen: (open) => set({ envDialogOpen: open }),
  setSaveTemplateOpen: (open) => set({ saveTemplateOpen: open }),
  setImportOpen: (open) => set({ importOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setSendOptions: (options) => {
    const sendOptions = { ...get().sendOptions, ...options };
    set({ sendOptions });
    void api.setAppState('send_options', sendOptions).catch(() => undefined);
  },

  addToast: (toast) => {
    const id = nextToastId++;
    set(s => ({ toasts: [...s.toasts, { ...toast, id }] }));
    window.setTimeout(() => get().removeToast(id), toast.duration ?? 3500);
  },

  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
});
