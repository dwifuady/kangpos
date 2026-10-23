// Sidebar "Templates" view: templates grouped by folder. Click opens a new tab.
// Right-click empty space for a new folder; drag templates between folders and
// drag folder headers to reorder them.
import { useMemo, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import {
  ChevronRight,
  FilePlus2,
  FolderInput,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAppStore } from '../store';
import type { Template, TemplateOrderInput } from '../types';
import { METHOD_COLORS } from '../utils/format';
import { dropEdgeAt, dropEdgeClass, moveId, type DropEdge } from '../utils/drag';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GhostButton, inputClass, labelClass, Modal, PrimaryButton } from './Modal';

/**
 * Group templates by folder. `folderOrder` seeds every folder (so empty folders
 * show) and sets their order; folders missing from it follow alphabetically.
 * Templates without a folder come last.
 */
export function groupByFolder(templates: Template[], folderOrder: string[] = []): [string, Template[]][] {
  const groups = new Map<string, Template[]>();
  for (const path of folderOrder) groups.set(path, []);
  for (const t of templates) {
    const list = groups.get(t.folder) ?? [];
    list.push(t);
    groups.set(t.folder, list);
  }
  const rank = new Map(folderOrder.map((path, i) => [path, i]));
  return [...groups].sort(([a], [b]) => {
    if (a === b) return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

type Drag = { kind: 'template'; id: string } | { kind: 'folder'; path: string };

type Drop =
  | { kind: 'template'; id: string; folder: string; edge: 'before' | 'after' }
  | { kind: 'folder'; path: string; edge: 'before' | 'after' }
  | { kind: 'intoFolder'; folder: string };

type MenuState = { x: number; y: number } & (
  | { kind: 'template'; template: Template }
  | { kind: 'folder'; folder: string }
  | { kind: 'background' }
);

type FolderDialogState = { mode: 'create'; path: string } | { mode: 'rename'; id: string; path: string };

export function TemplatesList() {
  const templates = useAppStore(s => s.templates);
  const templateFolders = useAppStore(s => s.templateFolders);
  const openTemplate = useAppStore(s => s.openTemplate);
  const deleteTemplate = useAppStore(s => s.deleteTemplate);
  const deleteTemplateFolder = useAppStore(s => s.deleteTemplateFolder);
  const arrangeTemplateFolders = useAppStore(s => s.arrangeTemplateFolders);
  const arrangeTemplates = useAppStore(s => s.arrangeTemplates);
  const setImportOpen = useAppStore(s => s.setImportOpen);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const folderPaths = useMemo(() => templateFolders.map(f => f.path), [templateFolders]);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q
      ? templates.filter(t => `${t.folder} ${t.name} ${t.request.method} ${t.request.url}`.toLowerCase().includes(q))
      : templates;
    const all = groupByFolder(visible, folderPaths);
    // While filtering, hide folders with no match.
    return q ? all.filter(([, list]) => list.length > 0) : all;
  }, [templates, folderPaths, filter]);

  const toggle = (folder: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const remove = async (t: Template) => {
    const ok = await confirm(`Delete template "${t.name}"? Open tabs made from it keep working.`, {
      title: 'Delete template',
      kind: 'warning',
    });
    if (ok) await deleteTemplate(t.id);
  };

  const removeFolder = async (folder: string) => {
    const row = templateFolders.find(f => f.path === folder);
    if (!row) return;
    const ok = await confirm(`Delete folder "${folder}"?`, { title: 'Delete folder', kind: 'warning' });
    if (ok) await deleteTemplateFolder(row.id);
  };

  /** Move a template into `folder`, directly before `beforeId` (or to the end). */
  const moveTemplate = (id: string, folder: string, beforeId: string | null) => {
    const moved = templates.find(t => t.id === id);
    if (!moved) return;
    const byFolder = new Map<string, Template[]>();
    for (const t of templates) {
      if (t.id === id) continue;
      const list = byFolder.get(t.folder) ?? [];
      list.push(t);
      byFolder.set(t.folder, list);
    }
    const dest = byFolder.get(folder) ?? [];
    const at = beforeId ? dest.findIndex(t => t.id === beforeId) : -1;
    dest.splice(at < 0 ? dest.length : at, 0, { ...moved, folder });
    byFolder.set(folder, dest);
    const items: TemplateOrderInput[] = [];
    for (const [path, list] of byFolder) {
      list.forEach((t, i) => items.push({ id: t.id, folder: path, sort_order: i }));
    }
    void arrangeTemplates(items);
  };

  const finishDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const dropTemplate = (target: Template, edge: 'before' | 'after') => {
    if (drag?.kind !== 'template' || drag.id === target.id) return finishDrag();
    moveTemplate(drag.id, target.folder, edge === 'before' ? target.id : null);
    finishDrag();
  };

  const dropIntoFolder = (folder: string) => {
    if (drag?.kind !== 'template') return finishDrag();
    moveTemplate(drag.id, folder, null);
    finishDrag();
  };

  const dropFolder = (target: string, edge: 'before' | 'after') => {
    if (drag?.kind !== 'folder' || drag.path === target) return finishDrag();
    void arrangeTemplateFolders(moveId(folderPaths, drag.path, target, edge === 'after'));
    finishDrag();
  };

  const items = (state: MenuState): (MenuItem | 'separator')[] => {
    if (state.kind === 'template') {
      const t = state.template;
      return [
        { label: 'Open in new tab', icon: <FilePlus2 className="w-3.5 h-3.5" />, onClick: () => void openTemplate(t) },
        { label: 'Rename / move…', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => setEditing(t) },
        'separator',
        { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => void remove(t) },
      ];
    }
    if (state.kind === 'folder') {
      const folder = state.folder;
      const row = templateFolders.find(f => f.path === folder);
      const hasTemplates = templates.some(t => t.folder === folder);
      const hasSubfolders = templateFolders.some(f => f.path.startsWith(`${folder} / `));
      return [
        {
          label: 'New subfolder…',
          icon: <FolderPlus className="w-3.5 h-3.5" />,
          onClick: () => setFolderDialog({ mode: 'create', path: `${folder} / ` }),
        },
        {
          label: 'Rename folder…',
          icon: <FolderInput className="w-3.5 h-3.5" />,
          onClick: () => row && setFolderDialog({ mode: 'rename', id: row.id, path: folder }),
        },
        'separator',
        {
          label: 'Delete folder',
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          disabled: hasTemplates || hasSubfolders,
          onClick: () => void removeFolder(folder),
        },
      ];
    }
    return [
      {
        label: 'New folder…',
        icon: <FolderPlus className="w-3.5 h-3.5" />,
        onClick: () => setFolderDialog({ mode: 'create', path: '' }),
      },
      { label: 'Import…', icon: <Upload className="w-3.5 h-3.5" />, onClick: () => setImportOpen(true) },
    ];
  };

  const renderTemplate = (t: Template) => {
    const sameDrag = drag?.kind === 'template' && drag.id !== t.id;
    const edge: DropEdge = drop?.kind === 'template' && drop.id === t.id && sameDrag ? drop.edge : null;
    return (
      <div
        key={t.id}
        draggable
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', t.id);
          setDrag({ kind: 'template', id: t.id });
        }}
        onDragEnd={finishDrag}
        onDragOver={e => {
          if (!sameDrag) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const next = dropEdgeAt(e);
          setDrop(prev =>
            prev?.kind === 'template' && prev.id === t.id && prev.edge === next
              ? prev
              : { kind: 'template', id: t.id, folder: t.folder, edge: next },
          );
        }}
        onDragLeave={() => setDrop(prev => (prev?.kind === 'template' && prev.id === t.id ? null : prev))}
        onDrop={e => {
          e.preventDefault();
          if (drop?.kind === 'template' && drop.id === t.id) dropTemplate(t, drop.edge);
        }}
        className={`rounded-md ${dropEdgeClass(edge)} ${drag?.kind === 'template' && drag.id === t.id ? 'opacity-40' : ''}`}
      >
        <button
          onClick={() => void openTemplate(t)}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY, kind: 'template', template: t });
          }}
          className="group w-[calc(100%-0.25rem)] ml-1 flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md text-left hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={`${t.request.method} ${t.request.url}\nClick to open a new tab`}
        >
          <span className="shrink-0 w-9 text-[9px] font-bold text-right" style={{ color: METHOD_COLORS[t.request.method] }}>
            {t.request.method === 'DELETE' ? 'DEL' : t.request.method === 'OPTIONS' ? 'OPT' : t.request.method}
          </span>
          <span className="truncate text-[13px] flex-1">{t.name}</span>
          {t.request.params.length > 0 && (
            <span className="text-[10px] text-[var(--text-muted)] shrink-0" title="Inputs">
              {t.request.params.length} in
            </span>
          )}
          <span
            role="button"
            onClick={e => {
              e.stopPropagation();
              setEditing(t);
            }}
            className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-active)]"
            title="Rename / move"
          >
            <FolderInput className="w-3 h-3" />
          </span>
        </button>
      </div>
    );
  };

  const renderFolder = (folder: string, list: Template[]) => {
    const isCollapsed = collapsed.has(folder) && !filter;
    const folderDrag = drag?.kind === 'folder' && drag.path === folder;
    const edge: DropEdge =
      drag?.kind === 'folder' && drop?.kind === 'folder' && drop.path === folder && drag.path !== folder
        ? drop.edge
        : null;
    const highlightIntoFolder = drag?.kind === 'template' && drop?.kind === 'intoFolder' && drop.folder === folder;
    const folderName = folder || 'No folder';
    return (
      <div key={folder || '__none'}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          draggable={folder !== ''}
          onDragStart={e => {
            if (folder === '') return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', folder);
            setDrag({ kind: 'folder', path: folder });
          }}
          onDragEnd={finishDrag}
          onDragOver={e => {
            if (drag?.kind === 'folder' && folder !== '' && drag.path !== folder) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const next = dropEdgeAt(e);
              setDrop(prev =>
                prev?.kind === 'folder' && prev.path === folder && prev.edge === next
                  ? prev
                  : { kind: 'folder', path: folder, edge: next },
              );
            } else if (drag?.kind === 'template') {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDrop(prev => (prev?.kind === 'intoFolder' && prev.folder === folder ? prev : { kind: 'intoFolder', folder }));
            }
          }}
          onDragLeave={() =>
            setDrop(prev => {
              if (prev?.kind === 'folder' && prev.path === folder) return null;
              if (prev?.kind === 'intoFolder' && prev.folder === folder) return null;
              return prev;
            })
          }
          onDrop={e => {
            e.preventDefault();
            if (drag?.kind === 'template' && drop?.kind === 'intoFolder' && drop.folder === folder) {
              dropIntoFolder(folder);
            } else if (drag?.kind === 'folder' && drop?.kind === 'folder' && drop.path === folder) {
              dropFolder(folder, drop.edge);
            }
          }}
          onClick={() => toggle(folder)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle(folder);
            }
          }}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            setMenu(
              folder === ''
                ? { x: e.clientX, y: e.clientY, kind: 'background' }
                : { x: e.clientX, y: e.clientY, kind: 'folder', folder },
            );
          }}
          className={`w-full flex items-center gap-1 pl-1.5 pr-2 py-1 mt-1 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-md ${dropEdgeClass(edge)} ${
            highlightIntoFolder ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : ''
          } ${folderDrag ? 'opacity-40' : ''}`}
        >
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
          <span className="truncate">{folderName}</span>
          <span className="ml-auto font-normal normal-case tracking-normal">{list.length}</span>
        </div>
        {!isCollapsed &&
          (list.length > 0 ? (
            list.map(renderTemplate)
          ) : (
            !filter && (
              <p className="pl-6 py-1 text-[11px] text-[var(--text-muted)] italic">Empty folder — drop a template here</p>
            )
          ))}
      </div>
    );
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0"
      onContextMenu={e => {
        // Right-clicking anywhere in the view (not a row, not a text field)
        // offers to create a folder.
        if ((e.target as HTMLElement).closest('input, textarea')) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, kind: 'background' });
      }}
    >
      <div className="pl-1.5 pr-0 pb-1">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)]" />
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter templates"
            className="w-full pl-7 pr-2 py-1 text-xs rounded-md"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-2 min-h-[80px]">
        {groups.map(([folder, list]) => renderFolder(folder, list))}
        {templates.length === 0 && templateFolders.length === 0 && (
          <div className="flex flex-col items-center justify-center p-6 text-center gap-2">
            <p className="text-[var(--text-muted)] text-sm">No templates yet</p>
            <p className="text-[var(--text-muted)] text-xs">
              Save a tab as a template, or import a Postman collection or OpenAPI spec.
            </p>
            <div className="mt-1 flex items-center gap-2">
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-primary)]"
              >
                <Upload className="w-3.5 h-3.5" /> Import…
              </button>
              <button
                onClick={() => setFolderDialog({ mode: 'create', path: '' })}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-primary)]"
              >
                <FolderPlus className="w-3.5 h-3.5" /> New folder
              </button>
            </div>
          </div>
        )}
        {templates.length > 0 && groups.length === 0 && (
          <p className="p-4 text-center text-xs text-[var(--text-muted)]">No templates match “{filter}”.</p>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu)} onClose={() => setMenu(null)} />}
      {editing && <TemplateEditDialog template={editing} onClose={() => setEditing(null)} />}
      {folderDialog && <FolderDialog state={folderDialog} onClose={() => setFolderDialog(null)} />}
    </div>
  );
}

function FolderDialog({ state, onClose }: { state: FolderDialogState; onClose: () => void }) {
  const createTemplateFolder = useAppStore(s => s.createTemplateFolder);
  const renameTemplateFolder = useAppStore(s => s.renameTemplateFolder);
  const [path, setPath] = useState(state.path);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const clean = path.trim();
    if (!clean || saving) return;
    setSaving(true);
    if (state.mode === 'create') await createTemplateFolder(clean);
    else await renameTemplateFolder(state.id, clean);
    setSaving(false);
    onClose();
  };

  return (
    <Modal
      title={state.mode === 'create' ? 'New folder' : 'Rename folder'}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!path.trim() || saving}>
            {state.mode === 'create' ? 'Create' : 'Rename'}
          </PrimaryButton>
        </>
      }
    >
      <label className={labelClass}>Folder</label>
      <input
        autoFocus
        value={path}
        onChange={e => setPath(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && void save()}
        placeholder="e.g. Contacts"
        className={inputClass}
      />
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        Use &quot; / &quot; for a subfolder, e.g. Contacts / Admin. Renaming a folder moves its templates and subfolders.
      </p>
    </Modal>
  );
}

function TemplateEditDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const updateTemplate = useAppStore(s => s.updateTemplate);
  const templateFolders = useAppStore(s => s.templateFolders);
  const folders = useMemo(() => templateFolders.map(f => f.path), [templateFolders]);
  const [name, setName] = useState(template.name);
  const [folder, setFolder] = useState(template.folder);

  const save = async () => {
    if (!name.trim()) return;
    await updateTemplate(template.id, { name: name.trim(), folder: folder.trim() });
    onClose();
  };

  return (
    <Modal
      title="Rename / move template"
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!name.trim()}>Save</PrimaryButton>
        </>
      }
    >
      <label className={labelClass}>Name</label>
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} className={`${inputClass} mb-3`} />
      <label className={labelClass}>Folder (use " / " for nesting)</label>
      <input value={folder} onChange={e => setFolder(e.target.value)} list="template-folders" placeholder="e.g. Contacts" className={inputClass} />
      <datalist id="template-folders">
        {folders.map(f => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">Open tabs are not affected; they are copies.</p>
    </Modal>
  );
}
