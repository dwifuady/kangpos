// Folder sync UI: the section in the space dialog, and the status banner
// shown above the template list when the folder has problems.
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { confirm } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, FolderGit2, FolderOpen, RefreshCw, Unlink } from 'lucide-react';
import { useAppStore } from '../store';
import type { Space, SyncStatus } from '../types';

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

/** Problems worth showing for a linked space, or null when all is well. */
export function syncProblem(status: SyncStatus | undefined): string | null {
  if (!status) return null;
  if (status.missing) return 'Workspace folder not found';
  if (status.errors.length > 0) return `${status.errors.length} file${status.errors.length > 1 ? 's' : ''} in the folder couldn't be read`;
  return null;
}

export function FolderSyncSection({ space }: { space: Space }) {
  const status = useAppStore(s => s.syncStatus[space.id]);
  const linkFolder = useAppStore(s => s.linkFolder);
  const unlinkFolder = useAppStore(s => s.unlinkFolder);
  const reloadFolder = useAppStore(s => s.reloadFolder);
  const trustAll = useAppStore(s => !!s.scriptTrust[space.id]?.all);
  const setSpaceScriptTrust = useAppStore(s => s.setSpaceScriptTrust);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const link = () =>
    run(async () => {
      const dir = await pickFolder('Choose an empty folder (for example inside a git repository)');
      if (dir) await linkFolder(space.id, dir);
    });

  const unlink = () =>
    run(async () => {
      const ok = await confirm('Stop syncing this space with its folder? Templates and environments stay in KangPos, and the files stay where they are.', {
        title: 'Unlink folder',
        kind: 'warning',
      });
      if (ok) await unlinkFolder(space.id);
    });

  return (
    <div className="mt-4 p-2.5 rounded-md bg-[var(--bg-hover)]">
      <h4 className="text-sm font-medium mb-1.5 flex items-center gap-1.5">
        <FolderGit2 className="w-3.5 h-3.5 opacity-70" /> Workspace folder
      </h4>
      {!space.sync_dir ? (
        <>
          <p className="text-[12px] text-[var(--text-muted)] mb-2">
            Save this space's templates and environments as YAML files in a folder, for example inside a git repository, so they can be
            versioned and shared. Tabs, responses and secret values stay on this computer.
          </p>
          <button
            onClick={link}
            disabled={busy}
            className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md bg-[var(--bg-active)] hover:brightness-110 text-[var(--text-primary)]"
          >
            <FolderOpen className="w-3.5 h-3.5" /> Link to folder…
          </button>
        </>
      ) : (
        <>
          <div className="font-mono text-[12px] text-[var(--text-primary)] truncate mb-1" title={space.sync_dir}>
            {space.sync_dir}
          </div>
          <SyncDetails status={status} />
          <label className="flex items-start gap-2 mt-2 text-[12px] text-[var(--text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={trustAll}
              onChange={e => void setSpaceScriptTrust(space.id, e.target.checked)}
              className="mt-0.5 accent-[var(--accent-color)]"
            />
            <span>
              Run scripts from this folder without asking
              <span className="block text-[11px] text-[var(--text-muted)]">
                Off: KangPos asks before running a script that arrived or changed through the folder (e.g. git pull).
              </span>
            </span>
          </label>
          <div className="flex gap-1.5 mt-2">
            <button
              onClick={() => run(() => reloadFolder(space.id))}
              disabled={busy}
              className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md bg-[var(--bg-active)] hover:brightness-110 text-[var(--text-primary)]"
              title="Read the folder again"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Reload
            </button>
            <button
              onClick={unlink}
              disabled={busy}
              className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-active)]"
            >
              <Unlink className="w-3.5 h-3.5" /> Unlink
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SyncDetails({ status }: { status: SyncStatus | undefined }) {
  const problem = syncProblem(status);
  if (!status) return <p className="text-[11px] text-[var(--text-muted)]">Loading…</p>;
  if (!problem) return <p className="text-[11px] text-green-400">In sync. Changes in the folder (git pull, other editors) load automatically.</p>;
  return (
    <div className="text-[11px] text-amber-400">
      <div className="flex items-center gap-1 font-medium">
        <AlertTriangle className="w-3 h-3" /> {problem}
      </div>
      {status.missing && <p className="text-[var(--text-muted)] mt-0.5">Reconnect the drive or restore the folder, then press Reload. Nothing was deleted.</p>}
      {status.errors.length > 0 && (
        <ul className="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
          {status.errors.map(e => (
            <li key={e.path} className="break-words">
              <span className="font-mono text-[var(--text-primary)]">{e.path}</span>: {e.message}
            </li>
          ))}
        </ul>
      )}
      {status.errors.length > 0 && (
        <p className="text-[var(--text-muted)] mt-1">These templates keep their last good version until the file is fixed.</p>
      )}
    </div>
  );
}

/** Banner above the template list when the active space's folder has problems. */
export function FolderSyncBanner() {
  const space = useAppStore(s => s.spaces.find(x => x.id === s.activeSpaceId));
  const status = useAppStore(s => (s.activeSpaceId ? s.syncStatus[s.activeSpaceId] : undefined));
  const setSpaceDialog = useAppStore(s => s.setSpaceDialog);
  const problem = space?.sync_dir ? syncProblem(status) : null;
  if (!space || !problem) return null;
  return (
    <button
      onClick={() => setSpaceDialog({ mode: 'edit', spaceId: space.id })}
      className="mx-1.5 mb-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-left text-[11px] text-amber-400 hover:bg-amber-500/15"
      title="Show details"
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{problem}</span>
    </button>
  );
}
