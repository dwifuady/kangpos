// Arc-style layout (same shape as Larik): sidebar with environment selector,
// space switcher, Tabs/Templates toggle and footer; request editor on the right.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BookMarked, LayoutList, Plus, Settings, Upload } from 'lucide-react';
import { useAppStore } from '../store';
import { useShortcuts } from '../hooks/useShortcuts';
import { SPACE_COLORS } from '../utils/spaceColors';
import { TitleBar } from './TitleBar';
import { EnvironmentSelector } from './EnvironmentSelector';
import { SpaceDialog, SpaceSwitcher } from './SpaceSwitcher';
import { TabsList } from './TabsList';
import { TemplatesList } from './TemplatesList';
import { TemplatePicker } from './TemplatePicker';
import { RequestEditor } from './RequestEditor';
import { EnvironmentDialog } from './EnvironmentDialog';
import { SaveTemplateDialog } from './SaveTemplateDialog';
import { ImportDialog } from './ImportDialog';
import { SettingsDialog } from './SettingsDialog';
import { ToastContainer } from './Toast';
import { ErrorBoundary } from './ErrorBoundary';

export function AppLayout() {
  const loadInitial = useAppStore(s => s.loadInitial);
  const initTheme = useAppStore(s => s.initTheme);
  const theme = useAppStore(s => s.theme);
  const spaces = useAppStore(s => s.spaces);
  const activeSpaceId = useAppStore(s => s.activeSpaceId);
  const spacesLoading = useAppStore(s => s.spacesLoading);
  const setActiveSpace = useAppStore(s => s.setActiveSpace);
  const tab = useAppStore(s => s.tabs.find(t => t.id === s.activeTabId) ?? null);
  const lastCreatedTabId = useAppStore(s => s.lastCreatedTabId);
  const templatesCount = useAppStore(s => s.templates.length);
  const sidebarWidth = useAppStore(s => s.sidebarWidth);
  const setSidebarWidth = useAppStore(s => s.setSidebarWidth);
  const sidebarHidden = useAppStore(s => s.sidebarHidden);
  const toggleSidebarHidden = useAppStore(s => s.toggleSidebarHidden);
  const sidebarView = useAppStore(s => s.sidebarView);
  const setSidebarView = useAppStore(s => s.setSidebarView);
  const setSpaceDialog = useAppStore(s => s.setSpaceDialog);
  const setImportOpen = useAppStore(s => s.setImportOpen);
  const setSettingsOpen = useAppStore(s => s.setSettingsOpen);
  const setPickerOpen = useAppStore(s => s.setPickerOpen);
  const flushTabSaves = useAppStore(s => s.flushTabSaves);

  const [resizing, setResizing] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);
  const prevSpaceRef = useRef<string | null>(null);

  useShortcuts();

  useEffect(() => {
    document.getElementById('html-loader')?.classList.add('hidden');
    initTheme();
    void loadInitial();
  }, [initTheme, loadInitial]);

  // Write pending edits before the window goes away.
  useEffect(() => {
    const onUnload = () => void flushTabSaves();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [flushTabSaves]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  // Slide direction when switching spaces (Arc-style).
  useEffect(() => {
    const prev = prevSpaceRef.current;
    if (prev && activeSpaceId && prev !== activeSpaceId) {
      const from = spaces.findIndex(s => s.id === prev);
      const to = spaces.findIndex(s => s.id === activeSpaceId);
      if (from !== -1 && to !== -1) setDirection(to > from ? 'right' : 'left');
    }
    prevSpaceRef.current = activeSpaceId;
  }, [activeSpaceId, spaces]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => setSidebarWidth(Math.max(220, Math.min(420, e.clientX)));
    const onUp = () => setResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, setSidebarWidth]);

  const activeSpace = spaces.find(s => s.id === activeSpaceId);
  const spaceColor = activeSpace?.color ?? '#0078d4';
  const floating = sidebarHidden && hoverOpen;
  const shown = !sidebarHidden || floating;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[var(--app-bg)] relative">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(135deg, ${spaceColor}08 0%, ${spaceColor}04 25%, transparent 50%, ${spaceColor}04 75%, ${spaceColor}08 100%)`,
          zIndex: 1,
        }}
      />

      <div className="absolute top-0 left-0 right-0 z-[60] pointer-events-none">
        <TitleBar sidebarWidth={sidebarWidth} sidebarHidden={sidebarHidden} onToggleSidebar={toggleSidebarHidden} />
      </div>

      <div className="flex flex-1 overflow-hidden relative z-10" onMouseMove={e => sidebarHidden && e.clientX < 12 && setHoverOpen(true)}>
        <aside
          className={`flex flex-col overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] backdrop-blur-xl ${floating ? 'rounded-xl m-1.5 pr-1.5' : ''}`}
          style={{
            width: floating ? sidebarWidth - 16 : sidebarWidth,
            minWidth: floating ? sidebarWidth - 16 : sidebarWidth,
            height: floating ? 'calc(100% - 12px)' : '100%',
            opacity: shown ? 1 : 0,
            transform: shown ? 'translateX(0)' : 'translateX(-100%)',
            background: floating ? 'rgba(var(--sidebar-bg-rgb), 0.96)' : 'var(--sidebar-surface)',
            position: sidebarHidden ? 'absolute' : 'relative',
            left: 0,
            top: 0,
            zIndex: sidebarHidden ? (floating ? 30 : -1) : 10,
            boxShadow: floating ? '0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px var(--border-color)' : 'none',
            pointerEvents: shown ? 'auto' : 'none',
          }}
          onMouseLeave={() => floating && setHoverOpen(false)}
        >
          <div className="pl-1.5 pt-1.5 pb-0.5 flex flex-col gap-1">
            {spacesLoading && spaces.length === 0 ? (
              <div className="h-8 rounded-md bg-[var(--bg-hover)] animate-pulse" />
            ) : (
              activeSpace && <EnvironmentSelector />
            )}
            <SpaceSwitcher />
          </div>

          <div
            key={activeSpaceId ?? 'none'}
            className={`flex-1 flex flex-col min-h-0 ${direction === 'right' ? 'animate-space-slide-in-right' : direction === 'left' ? 'animate-space-slide-in-left' : ''}`}
            onAnimationEnd={() => setDirection(null)}
          >
            {activeSpace && (
              <div className="pl-1.5 py-1">
                <div className="bg-[var(--bg-hover)] p-0.5 rounded-md flex gap-0.5">
                  {(
                    [
                      ['tabs', 'Requests', LayoutList],
                      ['templates', `Templates${templatesCount ? ` · ${templatesCount}` : ''}`, BookMarked],
                    ] as const
                  ).map(([view, label, Icon]) => (
                    <button
                      key={view}
                      onClick={() => setSidebarView(view)}
                      className={`flex-1 flex items-center justify-center py-1 rounded-md text-[11px] font-medium transition-all duration-200 ${
                        sidebarView === view ? 'shadow-sm text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                      }`}
                      style={sidebarView === view ? { backgroundColor: `${spaceColor}25` } : undefined}
                    >
                      <Icon className="w-3 h-3 mr-1" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {activeSpace && (sidebarView === 'tabs' ? <TabsList /> : <TemplatesList />)}
          </div>

          <div className="pl-2 py-1.5 flex items-center justify-between shrink-0">
            <button
              onClick={() => setImportOpen(true)}
              disabled={!activeSpace}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Import Postman / OpenAPI"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar px-1">
              {spaces.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => void setActiveSpace(s.id)}
                  className="p-1 rounded-full hover:bg-[var(--bg-hover)]"
                  title={s.name}
                  aria-label={`Switch to space ${s.name}`}
                >
                  <span
                    className={`block rounded-full transition-all ${s.id === activeSpaceId ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5 opacity-60'}`}
                    style={{ backgroundColor: s.color ?? SPACE_COLORS[i % SPACE_COLORS.length] }}
                  />
                </button>
              ))}
              <button
                onClick={() => setSpaceDialog({ mode: 'create' })}
                className="p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                title="New space"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title="Settings & shortcuts"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </aside>

        {!sidebarHidden && (
          <div
            className={`w-1 cursor-col-resize flex-shrink-0 ${resizing ? 'bg-[var(--accent-color)]' : 'bg-transparent hover:bg-[var(--border-subtle)]'}`}
            onMouseDown={startResize}
          />
        )}

        <main className="win-content-layer flex-1 flex flex-col min-w-0 relative z-10">
          {spaces.length === 0 && !spacesLoading ? (
            <EmptyState
              title="Welcome to KangPos"
              hint="Create a space (e.g. one per API or team) to get started"
              action="Create a space"
              onAction={() => setSpaceDialog({ mode: 'create' })}
            />
          ) : tab ? (
            <div key={tab.id} className={`flex-1 flex flex-col min-h-0 min-w-0 ${tab.id === lastCreatedTabId ? 'animate-tab-content-in' : ''}`}>
              <ErrorBoundary>
                <RequestEditor tab={tab} />
              </ErrorBoundary>
            </div>
          ) : activeSpace ? (
            <EmptyState
              title="No request open"
              hint={templatesCount > 0 ? 'Press Ctrl+T and pick a template' : 'Press Ctrl+T for a blank request, or import a Postman collection / OpenAPI spec'}
              action="New request"
              onAction={() => setPickerOpen(true)}
              secondary={templatesCount === 0 ? { label: 'Import…', onClick: () => setImportOpen(true) } : undefined}
            />
          ) : null}
        </main>
      </div>

      <TemplatePicker />
      <SpaceDialog />
      <EnvironmentDialog />
      <SaveTemplateDialog />
      <ImportDialog />
      <SettingsDialog />
      <ToastContainer />
    </div>
  );
}

function EmptyState({
  title,
  hint,
  action,
  onAction,
  secondary,
}: {
  title: string;
  hint: string;
  action: string;
  onAction: () => void;
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <button onClick={onAction} className="w-16 h-16 rounded-2xl bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] flex items-center justify-center mx-auto mb-4 group">
          <Plus className="w-8 h-8 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]" strokeWidth={1.5} />
        </button>
        <p className="text-[var(--text-secondary)] mb-1">{title}</p>
        <p className="text-[var(--text-muted)] text-sm mb-3">{hint}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={onAction} className="text-[var(--accent-color)] hover:underline font-medium text-sm">
            {action}
          </button>
          {secondary && (
            <button onClick={secondary.onClick} className="text-[var(--text-secondary)] hover:underline text-sm">
              {secondary.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
