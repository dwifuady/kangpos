// "Inputs" section: edit which {{names}} are per-tab params, their defaults
// and whether they are required. Offers placeholders that aren't defined yet.
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import type { RequestSpec, TemplateParam } from '../../types';
import { requestVariables } from '../../utils/request';
import { classifyVariable, type ResolveContext } from '../../utils/variables';

interface ParamDefinitionsProps {
  request: RequestSpec;
  ctx: ResolveContext;
  onChange: (params: TemplateParam[]) => void;
}

/** Placeholders that are neither params, env vars nor dynamic: candidates for params. */
export function undeclaredVariables(request: RequestSpec, ctx: ResolveContext): string[] {
  return requestVariables(request).filter(name => classifyVariable(name, ctx) === 'unresolved');
}

export function ParamDefinitions({ request, ctx, onChange }: ParamDefinitionsProps) {
  const params = request.params;
  const suggestions = undeclaredVariables(request, ctx);
  const update = (i: number, patch: Partial<TemplateParam>) => onChange(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="text-[13px]">
      <p className="text-[11px] text-[var(--text-muted)] mb-2">
        Inputs are values you fill in per tab (the form above). They are <strong>not</strong> query params: an input is only sent where you
        write <span className="font-mono">{'{{name}}'}</span>, e.g. in the URL, a query param value, a header or the body. For plain query
        params use the Query params section. <span className="font-mono">{'{{names}}'}</span> that are not inputs come from the environment.
      </p>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 text-[11px]">
          <Sparkles className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          <span className="text-[var(--text-muted)]">Undefined placeholders:</span>
          {suggestions.map(name => (
            <button
              key={name}
              onClick={() => onChange([...params, { name, default: '', required: true }])}
              className="font-mono px-1.5 py-0.5 rounded bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-primary)]"
              title="Make this a required input"
            >
              + {name}
            </button>
          ))}
        </div>
      )}

      {params.length > 0 && (
        <div className="grid gap-x-1 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]" style={{ gridTemplateColumns: COLUMNS }}>
          <span className="pl-2">Name</span>
          <span className="pl-2">Default</span>
          <span className="pl-2">Description</span>
          <span className="text-center">Required</span>
          <span />
        </div>
      )}
      {params.map((p, i) => (
        <div key={i} className="group grid gap-x-1 items-center px-1 py-0.5" style={{ gridTemplateColumns: COLUMNS }}>
          <input
            value={p.name}
            onChange={e => update(i, { name: e.target.value.replace(/[{}\s]/g, '') })}
            className="cell-input h-7 px-2 font-mono text-[12px]"
            placeholder="name"
            spellCheck={false}
          />
          <input value={p.default} onChange={e => update(i, { default: e.target.value })} className="cell-input h-7 px-2 font-mono text-[12px]" placeholder="(empty)" spellCheck={false} />
          <input value={p.description ?? ''} onChange={e => update(i, { description: e.target.value || undefined })} className="cell-input h-7 px-2 text-[12px]" placeholder="optional" />
          <input type="checkbox" checked={p.required} onChange={e => update(i, { required: e.target.checked })} className="justify-self-center accent-[var(--accent-color)]" aria-label="Required" />
          <button
            onClick={() => onChange(params.filter((_, j) => j !== i))}
            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400"
            title="Remove input"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...params, { name: `param${params.length + 1}`, default: '', required: false }])}
        className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <Plus className="w-3.5 h-3.5" /> Add input
      </button>
    </div>
  );
}

const COLUMNS = 'minmax(110px,1fr) minmax(110px,1fr) minmax(140px,1.5fr) 64px 28px';
