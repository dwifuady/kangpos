// Sidebar "Templates" view: templates in a folder tree. Click opens a new tab.
// Right-click empty space for a new folder; drag templates between folders,
// and drag folders to reorder them or nest them inside another folder.
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
import { dropEdgeAt, dropEdgeClass, dropZoneAt, type DropEdge, type DropZone } from '../utils/drag';
import {
  buildFolderTree,
  folderName,
  folderParent,
  isSameOrInsideFolder,
  moveFolderInOrder,
  pruneEmptyFolders,
  type FolderNode,
} from '../utils/folderTree';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GhostButton, inputClass, labelClass, Modal, PrimaryButton } from './Modal';

type Drag = { kind: 'template'; id: string } | { kind: 'folder'; path: string };

type Drop =
  | { kind: 'template'; id: string; folder: string; edge: 'before' | 'after' }
  | { kind: 'folder'; path: string; edge: 'before' | 'after' }
  /** A template dropped on a folder header. */
  | { kind: 'intoFolder'; folder: string }
  /** A folder dropped on the middle of another folder header. */
  | { kind: 'folderInto'; folder: string };

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
  const renameTemplateFolder = useAppStore(s => s.renameTemplateFolder);
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
  const filtering = filter.trim() !== '';

  const tree = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q
      ? templates.filter(t => `${t.folder} ${t.name} ${t.request.method} ${t.request.url}`.toLowerCase().includes(q))
      : templates;
    const built = buildFolderTree(visible, folderPaths);
    // While filtering, hide folders with no match.
    return q ? pruneEmptyFolders(built) : built;
  }, [templates, folderPaths, filter]);

  const toggle = (folder: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  /** Open a folder so a drop into it is visible straight away. */
  const expand = (folder: string) =>
    setCollapsed(prev => {
      if (!prev.has(folder)) return prev;
      const next = new Set(prev);
      next.delete(folder);
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

  /** Move a template into `folder`, next to `target` (or to the end). */
  const moveTemplate = (
    id: string,
    folder: string,
    target: { id: string; edge: 'before' | 'after' } | null,
  ) => {
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
    const at = target ? dest.findIndex(t => t.id === target.id) : -1;
    const index = at < 0 ? dest.length : target?.edge === 'after' ? at + 1 : at;
    dest.splice(index, 0, { ...moved, folder });
    byFolder.set(folder, dest);
    const items: TemplateOrderInput[] = [];
    for (const [path, list] of byFolder) {
      list.forEach((t, i) => items.push({ id: t.id, folder: path, sort_order: i }));
    }
    void arrangeTemplates(items);
  };

  /** Move a folder (with its subfolders) to `newPath` and put it at `placement`. */
  const moveFolder = async (
    fromPath: string,
    newPath: string,
    placement: { parent: string } | { target: string; edge: 'before' | 'after' },
  ) => {
    const row = templateFolders.find(f => f.path === fromPath);
    if (!row) return;
    const paths = moveFolderInOrder(folderPaths, fromPath, newPath, placement);
    if (newPath !== fromPath && !(await renameTemplateFolder(row.id, newPath))) return;
    await arrangeTemplateFolders(paths);
  };

  const finishDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const dropTemplate = (target: Template, edge: 'before' | 'after') => {
    if (drag?.kind !== 'template' || drag.id === target.id) return finishDrag();
    moveTemplate(drag.id, target.folder, { id: target.id, edge });
    finishDrag();
  };

  const dropIntoFolder = (folder: string) => {
    if (drag?.kind !== 'template') return finishDrag();
    expand(folder);
    moveTemplate(drag.id, folder, null);
    finishDrag();
  };

  /** Dropped on the middle of a folder header: nest it there. */
  const dropFolderInto = (target: string) => {
    if (drag?.kind !== 'folder') return finishDrag();
    if (drag.path === target || isSameOrInsideFolder(target, drag.path)) return finishDrag();
    void moveFolder(drag.path, `${target} / ${folderName(drag.path)}`, { parent: target });
    expand(target);
    finishDrag();
  };

  /** Dropped on a folder header's edge: reorder it next to that folder. */
  const dropFolderBeside = (target: string, edge: 'before' | 'after') => {
    if (drag?.kind !== 'folder' || drag.path === target) return finishDrag();
    if (isSameOrInsideFolder(target, drag.path)) return finishDrag();
    const parent = folderParent(target);
    const newPath = parent ? `${parent} / ${folderName(drag.path)}` : folderName(drag.path);
    void moveFolder(drag.path, newPath, { target, edge });
    expand(parent);
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

  const renderTemplate = (t: Template, depth: number) => {
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
          // The zone is read from the event, so a drop never depends on a
          // previous dragover render having committed.
          dropTemplate(t, dropEdgeAt(e));
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
          style={{ paddingLeft: `${(depth + 1) * 12 + 6}px` }}
          className="group w-[calc(100%-0.25rem)] ml-1 flex items-center gap-1.5 pr-1 py-1 rounded-md text-left hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          title={`${t.request.method} ${t.request.url}\n${t.folder || 'No folder'}\nClick to open a new tab`}
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

  const renderFolder = (node: FolderNode) => {
    const path = node.path;
    const isRootBucket = path === '';
    const isCollapsed = collapsed.has(path) && !filtering;
    const folderDrag = drag?.kind === 'folder' && drag.path === path;
    const edge: DropEdge =
      drag?.kind === 'folder' && drop?.kind === 'folder' && drop.path === path && drag.path !== path
        ? drop.edge
        : null;
    const templateHighlight = drag?.kind === 'template' && drop?.kind === 'intoFolder' && drop.folder === path;
    const folderHighlight = drag?.kind === 'folder' && drop?.kind === 'folderInto' && drop.folder === path;
    const label = isRootBucket ? 'No folder' : node.name;
    return (
      <div key={path || '__none'}>
        <div
          role="button"
          tabIndex={0}
          aria-expanded={!isCollapsed}
          draggable={!isRootBucket}
          onDragStart={e => {
            if (isRootBucket) return;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', path);
            setDrag({ kind: 'folder', path });
          }}
          onDragEnd={finishDrag}
          onDragOver={e => {
            if (drag?.kind === 'folder' && !isRootBucket && drag.path !== path) {
              // A folder cannot move into itself or its own subfolders.
              if (isSameOrInsideFolder(path, drag.path)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const zone: DropZone = dropZoneAt(e);
              if (zone === 'inside') {
                setDrop(prev =>
                  prev?.kind === 'folderInto' && prev.folder === path ? prev : { kind: 'folderInto', folder: path },
                );
              } else {
                setDrop(prev =>
                  prev?.kind === 'folder' && prev.path === path && prev.edge === zone
                    ? prev
                    : { kind: 'folder', path, edge: zone },
                );
              }
            } else if (drag?.kind === 'template') {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDrop(prev => (prev?.kind === 'intoFolder' && prev.folder === path ? prev : { kind: 'intoFolder', folder: path }));
            }
          }}
          onDragLeave={() =>
            setDrop(prev => {
              if (prev?.kind === 'folder' && prev.path === path) return null;
              if (prev?.kind === 'folderInto' && prev.folder === path) return null;
              if (prev?.kind === 'intoFolder' && prev.folder === path) return null;
              return prev;
            })
          }
          onDrop={e => {
            if (drag?.kind === 'template') {
              e.preventDefault();
              dropIntoFolder(path);
            } else if (drag?.kind === 'folder' && drag.path !== path) {
              e.preventDefault();
              const zone = dropZoneAt(e);
              if (zone === 'inside') dropFolderInto(path);
              else dropFolderBeside(path, zone);
            }
          }}
          onClick={() => toggle(path)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle(path);
            }
          }}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
            setMenu(
              isRootBucket
                ? { x: e.clientX, y: e.clientY, kind: 'background' }
                : { x: e.clientX, y: e.clientY, kind: 'folder', folder: path },
            );
          }}
          style={{ paddingLeft: `${node.depth * 12 + 6}px` }}
          className={`w-full flex items-center gap-1 pr-2 py-1 mt-1 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-md ${dropEdgeClass(edge)} ${
            templateHighlight || folderHighlight ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : ''
          } ${folderDrag ? 'opacity-40' : ''}`}
        >
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
          <span className="truncate" title={isRootBucket ? 'Templates that are not in a folder' : path}>
            {label}
          </span>
          <span
            className="ml-auto font-normal normal-case tracking-normal"
            title={
              node.templates.length === node.total
                ? `${node.total} template${node.total === 1 ? '' : 's'}`
                : `${node.templates.length} here, ${node.total} with subfolders`
            }
          >
            {node.total}
          </span>
        </div>
        {!isCollapsed && (
          <>
            {node.children.map(renderFolder)}
            {node.templates.map(t => renderTemplate(t, node.depth))}
            {node.total === 0 && !filtering && (
              <p style={{ paddingLeft: `${(node.depth + 1) * 12 + 6}px` }} className="py-1 text-[11px] text-[var(--text-muted)] italic">
                Empty folder — drop a template here
              </p>
            )}
          </>
        )}
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
        {tree.map(renderFolder)}
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
        {templates.length > 0 && tree.length === 0 && (
          <p className="p-4 text-center text-xs text-[var(--text-muted)]">No templates match “{filter}”.</p>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu)} onClose={() => setMenu(null)} />}
      {editing && <TemplateEditDialog template={editing} onClose={() => setEditing(null)} />}
      {folderDialog && (
        <FolderDialog
          state={folderDialog}
          onClose={() => setFolderDialog(null)}
          onSaved={saved => expand(folderParent(saved))}
        />
      )}
    </div>
  );
}

function FolderDialog({
  state,
  onClose,
  onSaved,
}: {
  state: FolderDialogState;
  onClose: () => void;
  /** Called with the saved path so its parent can be expanded. */
  onSaved?: (path: string) => void;
}) {
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
    onSaved?.(clean);
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
