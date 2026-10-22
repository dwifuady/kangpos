// Save the active tab as a new template: name, folder and which placeholders
// become params (with defaults / required).
import { useEffect, useMemo, useState } from 'react';
import { activeEnvironment, useAppStore } from '../store';
import type { TemplateParam } from '../types';
import { requestVariables, tabTitle } from '../utils/request';
import { classifyVariable, isDynamicVariable } from '../utils/variables';
import { GhostButton, inputClass, labelClass, Modal, PrimaryButton } from './Modal';

interface Row extends TemplateParam {
  include: boolean;
  /** Where the name currently resolves from, for the hint column. */
  source: string;
}

export function SaveTemplateDialog() {
  const open = useAppStore(s => s.saveTemplateOpen);
  const setOpen = useAppStore(s => s.setSaveTemplateOpen);
  const tab = useAppStore(s => s.tabs.find(t => t.id === s.activeTabId));
  const env = useAppStore(s => activeEnvironment(s));
  const templates = useAppStore(s => s.templates);
  const saveTabAsTemplate = useAppStore(s => s.saveTabAsTemplate);

  const folders = useMemo(() => [...new Set(templates.map(t => t.folder).filter(Boolean))], [templates]);
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!open || !tab) return;
    const current = templates.find(t => t.id === tab.template_id);
    setName(tab.custom_title ?? (tab.template_name ? `${tab.template_name} copy` : tabTitle(tab)));
    setFolder(current?.folder ?? '');
    const ctx = { params: [], paramValues: {}, env: env?.variables ?? [] };
    const existing = tab.request.params.map<Row>(p => ({ ...p, include: true, source: 'param' }));
    const extra = requestVariables(tab.request)
      .filter(n => !isDynamicVariable(n) && !existing.some(p => p.name === n))
      .map<Row>(n => {
        const source = classifyVariable(n, ctx);
        // Undefined names are clearly meant to be filled in per tab.
        return { name: n, default: '', required: true, include: source === 'unresolved', source };
      });
    setRows([...existing, ...extra]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initialise when the dialog opens
  }, [open]);

  if (!open || !tab) return null;
  const close = () => setOpen(false);

  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const useTabValues = () =>
    setRows(rows.map(r => (r.include && tab.param_values[r.name] ? { ...r, default: tab.param_values[r.name] } : r)));

  const save = async () => {
    if (!name.trim()) return;
    const params: TemplateParam[] = rows
      .filter(r => r.include)
      // Keep everything about the input except the dialog's own fields.
      .map(({ include: _include, source: _source, ...param }) => param);
    await saveTabAsTemplate(tab.id, name.trim(), folder.trim(), { ...structuredClone(tab.request), params });
    close();
  };

  return (
    <Modal
      title="Save as template"
      onClose={close}
      width="max-w-2xl"
      footer={
        <>
          <GhostButton onClick={close}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!name.trim()}>Save template</PrimaryButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className={labelClass}>Name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} className={inputClass} placeholder="e.g. Get contact" />
        </div>
        <div>
          <label className={labelClass}>Folder</label>
          <input value={folder} onChange={e => setFolder(e.target.value)} list="save-template-folders" className={inputClass} placeholder="e.g. Contacts" />
          <datalist id="save-template-folders">
            {folders.map(f => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-[var(--text-secondary)]">Inputs (filled in per tab)</span>
        {rows.some(r => r.include) && (
          <button onClick={useTabValues} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            Use this tab's values as defaults
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          This request has no <span className="font-mono">{'{{placeholders}}'}</span>. Add some (e.g. <span className="font-mono">{'/contacts/{{id}}'}</span>) to make it a reusable template.
        </p>
      ) : (
        <div className="text-[13px]">
          <div className="grid gap-x-2 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]" style={{ gridTemplateColumns: COLS }}>
            <span>Input</span>
            <span>Name</span>
            <span>Default</span>
            <span className="text-center">Required</span>
            <span>Now from</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.name} className={`grid gap-x-2 items-center px-1 py-0.5 ${r.include ? '' : 'opacity-60'}`} style={{ gridTemplateColumns: COLS }}>
              <input type="checkbox" checked={r.include} onChange={e => update(i, { include: e.target.checked })} className="justify-self-start accent-[var(--accent-color)]" aria-label={`Make ${r.name} a param`} />
              <span className="font-mono text-[12px] truncate">{r.name}</span>
              <input value={r.default} disabled={!r.include} onChange={e => update(i, { default: e.target.value })} placeholder="(empty)" className="h-7 px-2 font-mono text-[12px] rounded" />
              <input type="checkbox" checked={r.required} disabled={!r.include} onChange={e => update(i, { required: e.target.checked })} className="justify-self-center accent-[var(--accent-color)]" aria-label="Required" />
              <span className={`text-[11px] var-${r.source}`}>{r.source === 'env' ? 'environment' : r.source}</span>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">Unchecked names stay environment variables. Existing tabs are not changed.</p>
        </div>
      )}
    </Modal>
  );
}

const COLS = '44px minmax(110px,1fr) minmax(140px,1.5fr) 64px 90px';
