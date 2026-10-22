import { create } from 'zustand';
import { createTabsSlice, type TabsSlice } from './slices/tabsSlice';
import { createUISlice, type UISlice } from './slices/uiSlice';
import { createWorkspaceSlice, type WorkspaceSlice } from './slices/workspaceSlice';

export type AppState = WorkspaceSlice & TabsSlice & UISlice;

export const useAppStore = create<AppState>((...a) => ({
  ...createWorkspaceSlice(...a),
  ...createTabsSlice(...a),
  ...createUISlice(...a),
}));

export { activeEnvironment } from './slices/workspaceSlice';
