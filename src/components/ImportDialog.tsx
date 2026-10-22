// Import a Postman collection / environment or an OpenAPI spec into the active space.
import { useEffect, useMemo, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, FileJson, FolderOpen } from 'lucide-react';
import * as api from '../api';
import { useAppStore } from '../store';
import { importDocument, type ImportResult } from '../utils/importers';
import { groupByFolder } from './TemplatesList';
import { GhostButton, Modal, PrimaryButton } from './Modal';
import type { Template } from '../types';

const KIND_LABEL: Record<ImportResult['kind'], string> = {
  'postman-collection': 'Postman collection',
  'postman-environment': 'Postman environment',
  openapi: 'OpenAPI spec',
};

export function ImportDialog() {
  const open = useAppStore(s => s.importOpen);
  const setOpen = useAppStore(s => s.setImportOpen);
  const applyImport = useAppStore(s => s.applyImport);
  const addToast = useAppStore(s => s.addToast);
  const spaceName = useAppStore(s => s.spaces.find(x => x.id === s.activeSpaceId)?.name ?? '');

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setFileName(null);
    }
  }, [open]);

  const parsed = useMemo<{ result?: ImportResult; error?: string }>(() => {
    if (!text.trim()) return {};
    try {
      return { result: importDocument(text) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [text]);

  if (!open) return null;
  const close = () => setOpen(false);

  const pickFile = async () => {
    const path = await openDialog({
      multiple: false,
      title: 'Import Postman or OpenAPI file',
      filters: [{ name: 'Postman / OpenAPI', extensions: ['json', 'yaml', 'yml'] }],
    });
    if (typeof path !== 'string') return;
    try {
      setText(await api.readImportFile(path));
      setFileName(path.split(/[/\\]/).pop() ?? path);
    } catch (e) {
      addToast({ type: 'error', message: `Cannot read file: ${(e as Error).message}` });
    }
  };

  const doImport = async () => {
    const result = parsed.result;
    if (!result) return;
    setBusy(true);
    try {
      await applyImport(result);
      const parts = [
        result.templates.length ? `${result.templates.length} templates` : '',
        result.environments.length ? `${result.environments.length} environment${result.environments.length > 1 ? 's' : ''}` : '',
      ].filter(Boolean);
      addToast({ type: 'success', message: `Imported ${parts.join(' and ')} from ${result.name}` });
      close();
    } catch (e) {
      addToast({ type: 'error', message: `Import failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  const result = parsed.result;
  // Group preview rows with the same helper as the sidebar.
  const groups = result ? groupByFolder(result.templates.map((t, i) => ({ ...t, id: String(i), sort_order: i }) as unknown as Template)) : [];

  return (
    <Modal
      title={`Import into "${spaceName}"`}
      onClose={close}
      width="max-w-2xl"
      footer={
        <>
          <GhostButton onClick={close}>Cancel</GhostButton>
          <PrimaryButton onClick={doImport} disabled={!result || busy || (result.templates.length === 0 && result.environments.length === 0)}>
            {busy ? 'Importing…' : 'Import'}
          </PrimaryButton>
        </>
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <button onClick={pickFile} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-sm text-[var(--text-primary)]">
          <FolderOpen className="w-4 h-4" /> Choose file…
        </button>
        <span className="text-[12px] text-[var(--text-muted)] truncate">{fileName ?? 'or paste JSON / YAML below'}</span>
      </div>
      <textarea
        value={text}
        onChange={e => {
          setText(e.target.value);
          setFileName(null);
        }}
        placeholder="Postman collection v2.x, Postman environment, OpenAPI 3.x or Swagger 2.0 (JSON or YAML)"
        className="w-full h-32 px-2.5 py-2 text-[12px] font-mono rounded-md resize-y"
        spellCheck={false}
      />

      {parsed.error && <p className="mt-2 text-[12px] text-red-400">{parsed.error}</p>}

      {result && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[13px]">
            <FileJson className="w-4 h-4 text-[var(--text-muted)]" />
            <span className="font-medium text-[var(--text-primary)]">{result.name}</span>
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">{KIND_LABEL[result.kind]}</span>
          </div>

          {result.templates.length > 0 && (
            <div className="rounded-md border border-[var(--border-subtle)] max-h-48 overflow-y-auto px-2 py-1.5 text-[12px]">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">{result.templates.length} templates</div>
              {groups.map(([folder, list]) => (
                <div key={folder} className="mb-1">
                  <div className="text-[var(--text-secondary)] font-medium">{folder || 'No folder'}</div>
                  {list.map(t => (
                    <div key={t.id} className="pl-3 flex gap-2 text-[var(--text-muted)]">
                      <span className="w-12 font-mono text-[10px] font-bold">{t.request.method}</span>
                      <span className="truncate">{t.name}</span>
                      {t.request.params.length > 0 && <span className="ml-auto shrink-0">{t.request.params.map(p => p.name).join(', ')}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {result.environments.map(env => (
            <div key={env.name} className="text-[12px] text-[var(--text-secondary)]">
              Environment <span className="font-medium text-[var(--text-primary)]">{env.name}</span>: {env.variables.map(v => v.key).join(', ') || 'no variables'}
            </div>
          ))}

          {result.warnings.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-400">
              <div className="flex items-center gap-1.5 font-medium mb-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Not carried over
              </div>
              <ul className="list-disc pl-5">
                {result.warnings.map(w => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
