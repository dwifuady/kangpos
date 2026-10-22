// Manage the active space's environments and their variables.
import { useEffect, useRef, useState } from 'react';
import { confirm } from '@tauri-apps/plugin-dialog';
import { Check, Eye, EyeOff, Lock, Plus, Trash2 } from 'lucide-react';
import { activeEnvironment, useAppStore } from '../store';
import type { EnvVariable } from '../types';
import { GhostButton, Modal, PrimaryButton } from './Modal';

export function EnvironmentDialog() {
  const open = useAppStore(s => s.envDialogOpen);
  const setOpen = useAppStore(s => s.setEnvDialogOpen);
  const environments = useAppStore(s => s.environments);
  const active = useAppStore(s => activeEnvironment(s));
  const createEnvironment = useAppStore(s => s.createEnvironment);
  const updateEnvironment = useAppStore(s => s.updateEnvironment);
  const deleteEnvironment = useAppStore(s => s.deleteEnvironment);
  const setActiveEnvironment = useAppStore(s => s.setActiveEnvironment);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [vars, setVars] = useState<EnvVariable[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const dirty = useRef(false);

  const selected = environments.find(e => e.id === selectedId) ?? null;

  useEffect(() => {
    if (open) setSelectedId(active?.id ?? environments[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pick a selection when the dialog opens
  }, [open]);

  useEffect(() => {
    setName(selected?.name ?? '');
    setVars(selected ? selected.variables.map(v => ({ ...v })) : []);
    setRevealed(new Set());
    dirty.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load the draft when the selection changes
  }, [selectedId]);

  if (!open) return null;

  const saveDraft = async () => {
    if (!selected || !dirty.current) return;
    dirty.current = false;
    await updateEnvironment(selected.id, {
      name: name.trim() || selected.name,
      variables: vars.filter(v => v.key.trim() !== ''),
    });
  };

  const select = async (id: string) => {
    await saveDraft();
    setSelectedId(id);
  };

  const close = async () => {
    await saveDraft();
    setOpen(false);
  };

  const add = async () => {
    await saveDraft();
    const env = await createEnvironment(`Environment ${environments.length + 1}`, [{ key: 'baseUrl', value: '', enabled: true }]);
    if (env) setSelectedId(env.id);
  };

  const remove = async () => {
    if (!selected) return;
    const ok = await confirm(`Delete environment "${selected.name}"?`, { title: 'Delete environment', kind: 'warning' });
    if (!ok) return;
    dirty.current = false;
    await deleteEnvironment(selected.id);
    setSelectedId(environments.find(e => e.id !== selected.id)?.id ?? null);
  };

  const editVar = (i: number, patch: Partial<EnvVariable>) => {
    dirty.current = true;
    if (i === vars.length) setVars([...vars, { key: '', value: '', enabled: true, ...patch }]);
    else setVars(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  };

  const rows: (EnvVariable & { ghost?: boolean })[] = [...vars, { key: '', value: '', enabled: true, ghost: true }];

  return (
    <Modal
      title="Environments"
      onClose={close}
      width="max-w-4xl"
      footer={<PrimaryButton onClick={close}>Done</PrimaryButton>}
    >
      <div className="flex gap-3 min-h-[360px]">
        <div className="w-48 shrink-0 flex flex-col gap-0.5 border-r border-[var(--border-subtle)] pr-2">
          {environments.map(e => (
            <button
              key={e.id}
              onClick={() => void select(e.id)}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-left text-[13px] ${
                e.id === selectedId ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              <span className="truncate flex-1">{e.id === selectedId ? name || e.name : e.name}</span>
              {active?.id === e.id && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400">active</span>}
            </button>
          ))}
          <button onClick={add} className="mt-1 flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">
            <Plus className="w-3.5 h-3.5" /> New environment
          </button>
        </div>

        {selected ? (
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={e => {
                  dirty.current = true;
                  setName(e.target.value);
                }}
                className="flex-1 px-2.5 py-1.5 text-sm font-medium rounded-md"
                aria-label="Environment name"
              />
              {active?.id === selected.id ? (
                <span className="flex items-center gap-1 text-[12px] text-green-400 px-2">
                  <Check className="w-3.5 h-3.5" /> Active
                </span>
              ) : (
                <GhostButton onClick={() => void setActiveEnvironment(selected.id)}>Set active</GhostButton>
              )}
              <button onClick={remove} className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/15" title="Delete environment">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="grid gap-x-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]" style={{ gridTemplateColumns: COLS }}>
              <span />
              <span className="pl-2">Variable</span>
              <span className="pl-2">Value</span>
              <span className="text-center">Secret</span>
              <span />
            </div>
            <div className="overflow-y-auto max-h-[50vh]">
              {rows.map((v, i) => {
                const masked = v.secret && !revealed.has(i);
                return (
                  <div key={i} className={`group grid gap-x-1 items-center px-1 py-0.5 ${v.ghost ? 'opacity-60 focus-within:opacity-100' : ''}`} style={{ gridTemplateColumns: COLS }}>
                    <input type="checkbox" checked={!v.ghost && v.enabled} disabled={v.ghost} onChange={e => editVar(i, { enabled: e.target.checked })} className="justify-self-center accent-[var(--accent-color)]" aria-label="Enabled" />
                    <input value={v.key} onChange={e => editVar(i, { key: e.target.value })} placeholder={v.ghost ? 'Add variable' : 'name'} className="cell-input h-7 px-2 font-mono text-[12px]" spellCheck={false} />
                    <div className="flex items-center gap-1 min-w-0">
                      <input
                        type={masked ? 'password' : 'text'}
                        value={v.value}
                        onChange={e => editVar(i, { value: e.target.value })}
                        className="cell-input flex-1 min-w-0 h-7 px-2 font-mono text-[12px]"
                        spellCheck={false}
                      />
                      {v.secret && (
                        <button
                          onClick={() =>
                            setRevealed(prev => {
                              const next = new Set(prev);
                              if (next.has(i)) next.delete(i);
                              else next.add(i);
                              return next;
                            })
                          }
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          title={masked ? 'Show value' : 'Hide value'}
                        >
                          {masked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => editVar(i, { secret: !v.secret || undefined })}
                      disabled={v.ghost}
                      className={`justify-self-center p-1 rounded ${v.secret ? 'text-amber-400' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                      title="Mask this value on screen"
                    >
                      <Lock className="w-3.5 h-3.5" />
                    </button>
                    {v.ghost ? (
                      <span />
                    ) : (
                      <button
                        onClick={() => {
                          dirty.current = true;
                          setVars(vars.filter((_, j) => j !== i));
                        }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              Reference variables as <span className="font-mono">{'{{name}}'}</span>. Values can reference other variables. Secret values are masked on screen but still stored in the local database.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[var(--text-muted)] text-sm">
            <p>No environments in this space yet.</p>
            <PrimaryButton onClick={add}>Create environment</PrimaryButton>
          </div>
        )}
      </div>
    </Modal>
  );
}

const COLS = '24px minmax(140px,1fr) minmax(200px,2fr) 52px 28px';
