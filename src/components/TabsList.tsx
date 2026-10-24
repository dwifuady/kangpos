// Arc-style vertical tab list (Larik's TabsList, for requests).
import { memo, useEffect, useRef, useState } from 'react';
import { Copy, Pencil, Pin, PinOff, Plus, Save, X } from 'lucide-react';
import { useAppStore } from '../store';
import type { Tab } from '../types';
import { tabTitle } from '../utils/request';
import { METHOD_COLORS } from '../utils/format';
import { dropEdgeAt, dropEdgeClass, moveId, type DropEdge } from '../utils/drag';
import { ContextMenu, type MenuItem } from './ContextMenu';

function subtitle(tab: Tab): string {
  if (tab.template_name && !tab.custom_title) return tab.request.url || tab.template_name;
  return tab.template_name ?? (tab.request.url || 'Blank request');
}

const TabItem = memo(function TabItem({
  tab,
  isActive,
  isNew,
  isSending,
  spaceColor,
  onContextMenu,
}: {
  tab: Tab;
  isActive: boolean;
  isNew: boolean;
  isSending: boolean;
  spaceColor: string;
  onContextMenu: (e: React.MouseEvent, tab: Tab) => void;
}) {
  const setActiveTab = useAppStore(s => s.setActiveTab);
  const closeTab = useAppStore(s => s.closeTab);
  const renameTab = useAppStore(s => s.renameTab);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const title = tabTitle(tab);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  // Start renames from the store too (context menu, F2 on the active tab).
  useEffect(() => {
    const onRename = (e: Event) => {
      if ((e as CustomEvent<string>).detail === tab.id) {
        setValue(title);
        setRenaming(true);
      }
    };
    window.addEventListener('kangpos:rename-tab', onRename);
    return () => window.removeEventListener('kangpos:rename-tab', onRename);
  }, [tab.id, title]);

  const finish = () => {
    // Clearing the name (or typing the automatic one) goes back to automatic titles.
    const auto = tabTitle({ ...tab, custom_title: null });
    renameTab(tab.id, value.trim() === '' || value.trim() === auto ? null : value);
    setRenaming(false);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'page' : undefined}
      aria-label={`Tab: ${title}`}
      className={`group flex items-center gap-1.5 pl-2 pr-0 py-1.5 ml-1 my-0.5 rounded-md cursor-pointer relative transition-all duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-color)] ${
        isActive ? 'text-[var(--text-primary)] pl-2.5' : 'hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]'
      } ${isNew ? 'animate-tab-pop-in' : ''}`}
      style={{ backgroundColor: isActive ? `color-mix(in srgb, ${spaceColor}, transparent 70%)` : undefined }}
      onClick={() => setActiveTab(tab.id)}
      onDoubleClick={() => {
        setValue(title);
        setRenaming(true);
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') setActiveTab(tab.id);
        if (e.key === 'F2') {
          setValue(title);
          setRenaming(true);
        }
      }}
      onMouseDown={e => {
        if (e.button === 1) {
          e.preventDefault();
          void closeTab(tab.id);
        }
      }}
      onContextMenu={e => {
        e.preventDefault();
        onContextMenu(e, tab);
      }}
    >
      {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full" style={{ backgroundColor: spaceColor }} />}

      <span
        className="shrink-0 w-9 text-[9px] font-bold tracking-wide text-right"
        style={{ color: METHOD_COLORS[tab.request.method] ?? 'var(--text-muted)' }}
      >
        {tab.request.method === 'DELETE' ? 'DEL' : tab.request.method === 'OPTIONS' ? 'OPT' : tab.request.method}
      </span>

      {renaming ? (
        <input
          ref={inputRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') finish();
            if (e.key === 'Escape') setRenaming(false);
          }}
          onBlur={finish}
          onClick={e => e.stopPropagation()}
          className="flex-1 min-w-0 text-xs px-1.5 py-0.5 rounded"
        />
      ) : (
        <div className="flex-1 min-w-0 flex flex-col leading-tight">
          <span className={`truncate text-[13px] ${isActive ? 'font-semibold text-[var(--text-primary)]' : 'font-medium'}`}>{title}</span>
          <span
            className={`truncate text-[11px] transition-all duration-150 ${
              isActive
                ? 'text-[var(--text-secondary)] max-h-4 opacity-100'
                : 'text-[var(--text-muted)] max-h-0 opacity-0 overflow-hidden group-hover:max-h-4 group-hover:opacity-100'
            }`}
          >
            {subtitle(tab)}
          </span>
        </div>
      )}

      {isSending && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" title="Sending" />}
      {tab.response && !isSending && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            backgroundColor: tab.response.error
              ? '#ef4444'
              : (tab.response.response?.status ?? 0) >= 400
                ? '#f97316'
                : '#22c55e',
          }}
          title={tab.response.error ? 'Last send failed' : `Last status ${tab.response.response?.status}`}
        />
      )}
      {tab.is_pinned && <Pin className="w-2.5 h-2.5 text-[var(--text-muted)] shrink-0" />}
      {!tab.is_pinned && (
        <button
          onClick={e => {
            e.stopPropagation();
            void closeTab(tab.id);
          }}
          className="p-0.5 mr-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-active)] rounded transition-all shrink-0"
          title="Close (Ctrl+W)"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
});

export function TabsList() {
  const tabs = useAppStore(s => s.tabs);
  const activeTabId = useAppStore(s => s.activeTabId);
  const lastCreatedTabId = useAppStore(s => s.lastCreatedTabId);
  const inFlight = useAppStore(s => s.inFlight);
  const spaceColor = useAppStore(s => s.spaces.find(x => x.id === s.activeSpaceId)?.color ?? '#0078d4');
  const setPickerOpen = useAppStore(s => s.setPickerOpen);
  const reorderTabs = useAppStore(s => s.reorderTabs);
  const [menu, setMenu] = useState<{ x: number; y: number; tab: Tab } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; edge: DropEdge } | null>(null);

  const pinned = tabs.filter(t => t.is_pinned);
  const regular = tabs.filter(t => !t.is_pinned);
  const dragged = dragId ? tabs.find(t => t.id === dragId) : undefined;

  const dropTab = (targetId: string, after: boolean) => {
    setDragId(null);
    setDropTarget(null);
    if (!dragged) return;
    const pinnedIds = pinned.map(t => t.id);
    const regularIds = regular.map(t => t.id);
    const next = moveId(dragged.is_pinned ? pinnedIds : regularIds, dragged.id, targetId, after);
    void reorderTabs(dragged.is_pinned ? [...next, ...regularIds] : [...pinnedIds, ...next]);
  };

  const menuItems = (tab: Tab): (MenuItem | 'separator')[] => {
    const s = useAppStore.getState();
    return [
      { label: 'Rename', icon: <Pencil className="w-3.5 h-3.5" />, shortcut: 'F2', onClick: () => window.dispatchEvent(new CustomEvent('kangpos:rename-tab', { detail: tab.id })) },
      { label: 'Duplicate', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => void s.duplicateTab(tab.id) },
      {
        label: tab.is_pinned ? 'Unpin' : 'Pin',
        icon: tab.is_pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />,
        onClick: () => s.togglePin(tab.id),
      },
      {
        label: 'Save as template…',
        icon: <Save className="w-3.5 h-3.5" />,
        onClick: () => {
          s.setActiveTab(tab.id);
          s.setSaveTemplateOpen(true);
        },
      },
      'separator',
      { label: 'Close', icon: <X className="w-3.5 h-3.5" />, shortcut: 'Ctrl+W', danger: true, onClick: () => void s.closeTab(tab.id) },
    ];
  };

  const renderTab = (tab: Tab) => {
    // Pinned and regular tabs are separate lists: a drag never crosses the divider.
    const sameGroup = !!dragged && dragged.is_pinned === tab.is_pinned && dragged.id !== tab.id;
    const edge = dropTarget?.id === tab.id && sameGroup ? dropTarget.edge : null;
    return (
      <div
        key={tab.id}
        draggable
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', tab.id);
          setDragId(tab.id);
        }}
        onDragEnd={() => {
          setDragId(null);
          setDropTarget(null);
        }}
        onDragOver={e => {
          if (!sameGroup) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const nextEdge = dropEdgeAt(e);
          setDropTarget(prev => (prev?.id === tab.id && prev.edge === nextEdge ? prev : { id: tab.id, edge: nextEdge }));
        }}
        onDragLeave={() => setDropTarget(prev => (prev?.id === tab.id ? null : prev))}
        onDrop={e => {
          e.preventDefault();
          // The zone is read from the event, so a drop never depends on a
          // previous dragover render having committed.
          if (sameGroup) dropTab(tab.id, dropEdgeAt(e) === 'after');
        }}
        className={`rounded-md ${dropEdgeClass(edge)} ${dragId === tab.id ? 'opacity-40' : ''}`}
      >
        <TabItem
          tab={tab}
          isActive={tab.id === activeTabId}
          isNew={tab.id === lastCreatedTabId}
          isSending={!!inFlight[tab.id]}
          spaceColor={spaceColor}
          onContextMenu={(e, t) => setMenu({ x: e.clientX, y: e.clientY, tab: t })}
        />
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {pinned.length > 0 && (
        <div className="py-1">
          <div className="pl-3 mb-0.5 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Pinned</div>
          {pinned.map(renderTab)}
          <div className="ml-3 mt-1 border-t border-[var(--border-subtle)]" />
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        <button
          onClick={() => setPickerOpen(true)}
          className="group flex items-center gap-1.5 w-[calc(100%-0.25rem)] pl-2 pr-2 py-1.5 ml-1 my-0.5 rounded-md text-left text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          title="New request (Ctrl+T)"
        >
          <Plus className="w-4 h-4 shrink-0" />
          <span className="text-[13px] font-medium">New Request</span>
          <span className="ml-auto text-[10px] opacity-0 group-hover:opacity-100">Ctrl+T</span>
        </button>
        {regular.map(renderTab)}
        {tabs.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-center">
            <p className="text-[var(--text-muted)] text-sm">No requests yet</p>
            <p className="text-[var(--text-muted)] text-xs mt-1">Press Ctrl+T and pick a template</p>
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.tab)} onClose={() => setMenu(null)} />}
    </div>
  );
}
