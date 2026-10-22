// The per-tab inputs: one field per declared template param.
import { Asterisk } from 'lucide-react';
import type { ParamValues, TemplateParam } from '../../types';

interface ParamsFormProps {
  params: TemplateParam[];
  values: ParamValues;
  onChange: (name: string, value: string) => void;
  spaceColor: string;
  /** Outline required params that are still empty (after a failed send). */
  highlightMissing: boolean;
  /** Params no {{placeholder}} refers to. */
  unused?: string[];
}

export function ParamsForm({ params, values, onChange, spaceColor, highlightMissing, unused = [] }: ParamsFormProps) {
  if (params.length === 0) return null;
  return (
    <div className="grid gap-x-3 gap-y-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
      {params.map(p => {
        const value = values[p.name] ?? '';
        const empty = value.trim() === '' && p.default.trim() === '';
        const missing = highlightMissing && p.required && empty;
        return (
          <label key={p.name} className="flex flex-col gap-1 min-w-0" title={p.description}>
            <span className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-secondary)]">
              <span className="font-mono truncate" style={{ color: spaceColor }}>
                {p.name}
              </span>
              {p.required && <Asterisk className="w-2.5 h-2.5 text-red-400 shrink-0" aria-label="required" />}
              {unused.includes(p.name) && (
                <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-400 shrink-0" title={`Not referenced anywhere; add {{${p.name}}} to the URL, query, headers or body`}>
                  unused
                </span>
              )}
              {p.description && <span className="truncate text-[var(--text-muted)] font-normal">· {p.description}</span>}
            </span>
            <input
              value={value}
              onChange={e => onChange(p.name, e.target.value)}
              placeholder={p.default ? `default: ${p.default}` : p.required ? 'required' : 'optional'}
              className={`w-full px-2 py-1 text-[13px] font-mono rounded ${missing ? 'ring-1 ring-red-400/70' : ''}`}
              spellCheck={false}
            />
          </label>
        );
      })}
    </div>
  );
}
