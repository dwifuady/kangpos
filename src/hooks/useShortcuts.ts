// Global keyboard shortcuts. Capture phase so Monaco doesn't swallow them.
import { useEffect } from 'react';
import { useAppStore } from '../store';

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useAppStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const modalOpen = s.pickerOpen || s.envDialogOpen || s.saveTemplateOpen || s.importOpen || s.settingsOpen || !!s.spaceDialog;
      const tabId = s.activeTabId;

      const run = (fn: () => void) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      };

      if (ctrl && (key === 't' || key === 'n') && !e.shiftKey) return run(() => s.activeSpaceId && s.setPickerOpen(true));
      if (modalOpen) return;

      if (ctrl && key === 'enter' && tabId) return run(() => window.dispatchEvent(new Event('kangpos:send')));
      if (ctrl && key === 's' && tabId) {
        return run(() => (e.shiftKey ? s.setSaveTemplateOpen(true) : void s.updateTemplateFromTab(tabId)));
      }
      if (ctrl && key === 'w' && tabId) return run(() => void s.closeTab(tabId));
      if (ctrl && key === 'tab') return run(() => s.cycleTab(e.shiftKey ? -1 : 1));
      if (ctrl && key === 'l' && tabId) return run(() => window.dispatchEvent(new Event('kangpos:focus-url')));
      if (ctrl && key === 'e') return run(() => s.setEnvDialogOpen(true));
      if (ctrl && key === 'b') return run(() => s.toggleSidebarHidden());
      if (e.key === 'F2' && tabId) {
        return run(() => {
          // The rename input lives in the Tabs view.
          s.setSidebarView('tabs');
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('kangpos:rename-tab', { detail: tabId })), 0);
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
