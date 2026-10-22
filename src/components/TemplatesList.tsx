// Sidebar "Templates" view: templates grouped by folder. Click opens a new tab.
import { useMemo, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { ChevronRight, FilePlus2, FolderInput, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { useAppStore } from '../store';
import type { Template } from '../types';
import { METHOD_COLORS } from '../utils/format';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GhostButton, inputClass, labelClass, Modal, PrimaryButton } from './Modal';

export function groupByFolder(templates: Template[]): [string, Template[]][] {
  const groups = new Map<string, Template[]>();
  for (const t of templates) {
    const list = groups.get(t.folder) ?? [];
    list.push(t);
    groups.set(t.folder, list);
  }
  // Unfoldered templates last.
  return [...groups].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
}

export function TemplatesList() {
  const templates = useAppStore(s => s.templates);
  const openTemplate = useAppStore(s => s.openTemplate);
  const deleteTemplate = useAppStore(s => s.deleteTemplate);
  const setImportOpen = useAppStore(s => s.setImportOpen);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; template: Template } | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const visible = q
      ? templates.filter(t => `${t.folder} ${t.name} ${t.request.method} ${t.request.url}`.toLowerCase().includes(q))
      : templates;
    return groupByFolder(visible);
  }, [templates, filter]);

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

  const items = (t: Template): (MenuItem | 'separator')[] => [
    { label: 'Open in new tab', icon: <FilePlus2 className="w-3.5 h-3.5" />, onClick: () => void openTemplate(t) },
    { label: 'Rename / move…', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => setEditing(t) },
    'separator',
    { label: 'Delete', icon: <Trash2 className="w-3.5 h-3.5" />, danger: true, onClick: () => void remove(t) },
  ];

  if (templates.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
        <p className="text-[var(--text-muted)] text-sm">No templates yet</p>
        <p className="text-[var(--text-muted)] text-xs">Save a tab as a template, or import a Postman collection or OpenAPI spec.</p>
        <button
          onClick={() => setImportOpen(true)}
          className="mt-1 flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-primary)]"
        >
          <Upload className="w-3.5 h-3.5" /> Import…
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
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
      <div className="flex-1 overflow-y-auto pb-2">
        {groups.map(([folder, list]) => {
          const isCollapsed = collapsed.has(folder) && !filter;
          return (
            <div key={folder || '__none'}>
              <button
                onClick={() => toggle(folder)}
                className="w-full flex items-center gap-1 pl-1.5 pr-2 py-1 mt-1 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                <ChevronRight className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} />
                <span className="truncate">{folder || 'No folder'}</span>
                <span className="ml-auto font-normal normal-case tracking-normal">{list.length}</span>
              </button>
              {!isCollapsed &&
                list.map(t => (
                  <button
                    key={t.id}
                    onClick={() => void openTemplate(t)}
                    onContextMenu={e => {
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, template: t });
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
                ))}
            </div>
          );
        })}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items(menu.template)} onClose={() => setMenu(null)} />}
      {editing && <TemplateEditDialog template={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateEditDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const updateTemplate = useAppStore(s => s.updateTemplate);
  const templates = useAppStore(s => s.templates);
  const folders = useMemo(() => [...new Set(templates.map(t => t.folder).filter(Boolean))], [templates]);
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
