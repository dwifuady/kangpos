// URL-bar style environment selector at the top of the sidebar (where Larik
// shows the database selector).
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe, Settings2 } from 'lucide-react';
import { activeEnvironment, useAppStore } from '../store';

export function EnvironmentSelector() {
  const environments = useAppStore(s => s.environments);
  const env = useAppStore(s => activeEnvironment(s));
  const setActiveEnvironment = useAppStore(s => s.setActiveEnvironment);
  const setEnvDialogOpen = useAppStore(s => s.setEnvDialogOpen);
  const spaceColor = useAppStore(s => s.spaces.find(x => x.id === s.activeSpaceId)?.color ?? '#0078d4');
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

  const baseUrl = env?.variables.find(v => v.enabled && v.key === 'baseUrl')?.value;

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1.5 pl-2 pr-1 h-8 bg-[var(--bg-hover)] border border-[var(--border-color)] rounded-md">
        <button className="flex-1 min-w-0 h-full flex items-center gap-1.5 text-left" onClick={() => setOpen(o => !o)} title="Switch environment">
          <Globe className="w-3.5 h-3.5 shrink-0" style={{ color: env ? spaceColor : 'var(--text-muted)' }} />
          <span className="min-w-0 flex flex-col leading-tight">
            <span className={`truncate text-[12px] font-medium ${env ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
              {env ? env.name : 'No environment'}
            </span>
            {baseUrl && <span className="truncate text-[10px] text-[var(--text-muted)]">{baseUrl}</span>}
          </span>
          <ChevronDown className={`w-3 h-3 ml-auto shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={() => setEnvDialogOpen(true)}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-active)]"
          title="Manage environments"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[20] py-1 rounded-md border border-[var(--border-color)] shadow-2xl bg-[var(--bg-secondary)] max-h-72 overflow-y-auto animate-fade-in">
          <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Environment</div>
          <EnvRow label="No environment" active={!env} onClick={() => { void setActiveEnvironment(null); setOpen(false); }} />
          {environments.map(e => (
            <EnvRow
              key={e.id}
              label={e.name}
              active={env?.id === e.id}
              onClick={() => {
                void setActiveEnvironment(e.id);
                setOpen(false);
              }}
            />
          ))}
          <div className="my-1 mx-2 border-t border-[var(--border-color)] opacity-50" />
          <button
            onClick={() => {
              setOpen(false);
              setEnvDialogOpen(true);
            }}
            className="w-full px-2.5 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            Manage environments…
          </button>
        </div>
      )}
    </div>
  );
}

function EnvRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs ${
        active ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="truncate flex-1">{label}</span>
      {active && <Check className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
    </button>
  );
}
