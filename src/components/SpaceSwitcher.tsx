// Space switcher row under the environment selector, plus the create/edit dialog.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, FolderGit2, FolderOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../store';
import { SPACE_COLORS } from '../utils/spaceColors';
import { GhostButton, inputClass, labelClass, Modal, PrimaryButton } from './Modal';
import { FolderSyncSection, pickFolder, syncProblem } from './FolderSync';

export function SpaceSwitcher() {
  const spaces = useAppStore(s => s.spaces);
  const activeSpaceId = useAppStore(s => s.activeSpaceId);
  const setActiveSpace = useAppStore(s => s.setActiveSpace);
  const deleteSpace = useAppStore(s => s.deleteSpace);
  const setSpaceDialog = useAppStore(s => s.setSpaceDialog);
  const openWorkspaceFolder = useAppStore(s => s.openWorkspaceFolder);
  const syncStatus = useAppStore(s => s.syncStatus);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = spaces.find(s => s.id === activeSpaceId);
  if (!active) return null;
  const color = active.color ?? SPACE_COLORS[0];
  const problem = active.sync_dir ? syncProblem(syncStatus[active.id]) : null;

  const handleDelete = async (id: string, name: string) => {
    setOpen(false);
    const ok = await confirm(`Delete "${name}" with all its templates, environments and tabs?`, {
      title: 'Delete space',
      kind: 'warning',
    });
    if (ok) await deleteSpace(id);
  };

  return (
    <div ref={ref} className="relative group">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 h-6 pl-1.5 rounded-md hover:bg-[var(--bg-hover)] text-left"
        aria-expanded={open}
        title="Switch space"
      >
        <ChevronRight className={`w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">{active.name}</span>
        {active.sync_dir && !problem && (
          <span title={`Synced with ${active.sync_dir}`} className="shrink-0 flex">
            <FolderGit2 className="w-3 h-3 text-[var(--text-muted)]" aria-label="Synced with a folder" />
          </span>
        )}
        {problem && (
          <span title={problem} className="shrink-0 flex">
            <AlertTriangle className="w-3 h-3 text-amber-400" aria-label={problem} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[20] py-1 rounded-md border border-[var(--border-color)] shadow-2xl bg-[var(--bg-secondary)] max-h-72 overflow-y-auto animate-fade-in">
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Spaces</div>
          {spaces.map((space, i) => (
            <div key={space.id} className="group/row relative">
              <button
                onClick={() => {
                  void setActiveSpace(space.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 pr-14 text-left text-xs ${
                  space.id === activeSpaceId
                    ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: space.color ?? SPACE_COLORS[i % SPACE_COLORS.length] }} />
                <span className="truncate flex-1">{space.name}</span>
                {space.sync_dir && <FolderGit2 className="w-3 h-3 shrink-0 text-[var(--text-muted)] group-hover/row:opacity-0" aria-label="Synced with a folder" />}
                {space.id === activeSpaceId && <Check className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover/row:opacity-0" />}
              </button>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover/row:opacity-100">
                <button
                  onClick={() => {
                    setOpen(false);
                    setSpaceDialog({ mode: 'edit', spaceId: space.id });
                  }}
                  className="p-1 rounded hover:bg-[var(--bg-active)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  title="Edit space"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => handleDelete(space.id, space.name)}
                  className="p-1 rounded hover:bg-red-500/20 text-[var(--text-muted)] hover:text-red-400"
                  title="Delete space"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          <div className="my-1 mx-2 border-t border-[var(--border-color)] opacity-50" />
          <button
            onClick={() => {
              setOpen(false);
              setSpaceDialog({ mode: 'create' });
            }}
            className="w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            <Plus className="w-3 h-3 opacity-60" /> New Space
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              const dir = await pickFolder('Open a KangPos workspace folder');
              if (dir) await openWorkspaceFolder(dir);
            }}
            className="w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            title="Add a folder that already holds a KangPos workspace, e.g. a cloned git repository"
          >
            <FolderOpen className="w-3 h-3 opacity-60" /> Open workspace folder…
          </button>
        </div>
      )}
    </div>
  );
}

export function SpaceDialog() {
  const dialog = useAppStore(s => s.spaceDialog);
  const setSpaceDialog = useAppStore(s => s.setSpaceDialog);
  const spaces = useAppStore(s => s.spaces);
  const createSpace = useAppStore(s => s.createSpace);
  const updateSpace = useAppStore(s => s.updateSpace);
  const editing = dialog?.mode === 'edit' ? spaces.find(s => s.id === dialog.spaceId) : undefined;

  const [name, setName] = useState('');
  const [color, setColor] = useState(SPACE_COLORS[0]);

  useEffect(() => {
    if (!dialog) return;
    setName(editing?.name ?? '');
    setColor(editing?.color ?? SPACE_COLORS[spaces.length % SPACE_COLORS.length]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [dialog]);

  if (!dialog) return null;
  const close = () => setSpaceDialog(null);
  const submit = async () => {
    if (!name.trim()) return;
    if (editing) await updateSpace(editing.id, { name: name.trim(), color });
    else await createSpace(name.trim(), color);
    close();
  };

  return (
    <Modal
      title={editing ? 'Edit Space' : 'New Space'}
      onClose={close}
      footer={
        <>
          <GhostButton onClick={close}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={!name.trim()}>
            {editing ? 'Save' : 'Create'}
          </PrimaryButton>
        </>
      }
    >
      <label className={labelClass}>Name</label>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="e.g. Payments API"
        className={`${inputClass} mb-3`}
      />
      <label className={labelClass}>Color</label>
      <div className="flex gap-1.5 flex-wrap">
        {SPACE_COLORS.map(c => (
          <button
            key={c}
            onClick={() => setColor(c)}
            className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-[var(--text-primary)] ring-offset-2 ring-offset-[var(--bg-secondary)] scale-110' : ''}`}
            style={{ backgroundColor: c }}
            aria-label={`Color ${c}`}
          />
        ))}
      </div>
      {editing && <FolderSyncSection space={editing} />}
    </Modal>
  );
}
