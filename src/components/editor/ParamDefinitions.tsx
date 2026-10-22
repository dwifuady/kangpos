// "Inputs" section: edit which {{names}} are per-tab params, their type,
// defaults and whether they are required. Offers placeholders that aren't defined yet.
import { useEffect, useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import type { InputType, RequestSpec, TemplateParam } from '../../types';
import { requestVariables } from '../../utils/request';
import { classifyVariable, isSelect, parseOptions, type ResolveContext } from '../../utils/variables';

interface ParamDefinitionsProps {
  request: RequestSpec;
  ctx: ResolveContext;
  onChange: (params: TemplateParam[]) => void;
}

/** Placeholders that are neither params, env vars nor dynamic: candidates for params. */
export function undeclaredVariables(request: RequestSpec, ctx: ResolveContext): string[] {
  return requestVariables(request).filter(name => classifyVariable(name, ctx) === 'unresolved');
}

/** Options typed as text; parsed on every change but the raw text is kept while typing. */
function OptionsInput({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  const [raw, setRaw] = useState(options.join(', '));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setRaw(options.join(', '));
  }, [options, focused]);
  return (
    <input
      value={raw}
      onChange={e => {
        setRaw(e.target.value);
        onChange(parseOptions(e.target.value));
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className="cell-input w-full h-7 px-2 font-mono text-[12px]"
      placeholder="active, inactive, pending"
      spellCheck={false}
      aria-label="Dropdown options"
    />
  );
}

export function ParamDefinitions({ request, ctx, onChange }: ParamDefinitionsProps) {
  const params = request.params;
  const suggestions = undeclaredVariables(request, ctx);
  const update = (i: number, patch: Partial<TemplateParam>) => onChange(params.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const setType = (i: number, type: InputType) => {
    const p = params[i];
    if (type === 'select') {
      // Seed the list with the current default so it stays valid.
      const options = p.options?.length ? p.options : p.default ? [p.default] : [];
      update(i, { type, options });
    } else {
      update(i, { type: undefined, options: undefined });
    }
  };

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
          <span className="pl-1">Type</span>
          <span className="pl-2">Default</span>
          <span className="pl-2">Description</span>
          <span className="text-center">Required</span>
          <span />
        </div>
      )}
      {params.map((p, i) => {
        const select = isSelect(p);
        const options = p.options ?? [];
        return (
          <div key={i} className="group">
            <div className="grid gap-x-1 items-center px-1 py-0.5" style={{ gridTemplateColumns: COLUMNS }}>
              <input
                value={p.name}
                onChange={e => update(i, { name: e.target.value.replace(/[{}\s]/g, '') })}
                className="cell-input h-7 px-2 font-mono text-[12px]"
                placeholder="name"
                spellCheck={false}
              />
              <select value={select ? 'select' : 'text'} onChange={e => setType(i, e.target.value as InputType)} className="h-7 px-1 text-[12px] rounded" aria-label="Input type">
                <option value="text">Text</option>
                <option value="select">Dropdown</option>
              </select>
              {select ? (
                <select value={p.default} onChange={e => update(i, { default: e.target.value })} className="h-7 px-1 font-mono text-[12px] rounded" aria-label="Default">
                  <option value="">(none)</option>
                  {options.map(o => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  {p.default && !options.includes(p.default) && <option value={p.default}>{p.default} (not in list)</option>}
                </select>
              ) : (
                <input value={p.default} onChange={e => update(i, { default: e.target.value })} className="cell-input h-7 px-2 font-mono text-[12px]" placeholder="(empty)" spellCheck={false} />
              )}
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
            {select && (
              <div className="grid gap-x-1 items-center px-1 pb-1" style={{ gridTemplateColumns: OPTIONS_COLUMNS }}>
                <span className="pl-2 text-[11px] text-[var(--text-muted)]">Options</span>
                <OptionsInput options={options} onChange={next => update(i, { options: next })} />
                <span className="text-[11px] text-[var(--text-muted)] pl-1">{options.length === 0 ? 'Separate with commas' : `${options.length} option${options.length > 1 ? 's' : ''}`}</span>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={() => onChange([...params, { name: `param${params.length + 1}`, default: '', required: false }])}
        className="mt-1 flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        <Plus className="w-3.5 h-3.5" /> Add input
      </button>
    </div>
  );
}

const COLUMNS = 'minmax(110px,1fr) 96px minmax(110px,1fr) minmax(140px,1.5fr) 64px 28px';
const OPTIONS_COLUMNS = 'minmax(110px,1fr) minmax(200px,3fr) 120px';
