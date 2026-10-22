// Editable key/value rows (query, headers, form fields). A blank trailing row
// turns into a real row as soon as the user types in it.
import { open } from '@tauri-apps/plugin-dialog';
import { FileUp, Trash2 } from 'lucide-react';
import type { BodyField, KeyValue } from '../../types';
import type { ResolveContext } from '../../utils/variables';
import { HighlightInput } from './HighlightInput';

interface KeyValueTableProps<T extends KeyValue> {
  rows: T[];
  onChange: (rows: T[]) => void;
  ctx: ResolveContext;
  makeRow: (key: string, value: string) => T;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Show a text/file switch per row (multipart bodies). */
  withKind?: boolean;
}

export function KeyValueTable<T extends KeyValue>({
  rows,
  onChange,
  ctx,
  makeRow,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  withKind,
}: KeyValueTableProps<T>) {
  const update = (index: number, patch: Partial<T>) => {
    if (index === rows.length) {
      onChange([...rows, { ...makeRow('', ''), ...patch }]);
      return;
    }
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

  const display: (T & { ghost?: boolean })[] = [...rows, { ...makeRow('', ''), ghost: true }];

  return (
    <div className="text-[13px]">
      <div className="grid gap-x-1 items-center text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1 pb-1" style={{ gridTemplateColumns: gridColumns(withKind) }}>
        <span />
        <span className="pl-2">{keyPlaceholder}</span>
        {withKind && <span className="pl-1">Type</span>}
        <span className="pl-2">{valuePlaceholder}</span>
        <span />
      </div>
      {display.map((row, i) => {
        const isFile = withKind && (row as unknown as BodyField).kind === 'file';
        return (
          <div
            key={i}
            className={`group grid gap-x-1 items-center px-1 py-0.5 rounded ${row.ghost ? 'opacity-60 focus-within:opacity-100' : ''}`}
            style={{ gridTemplateColumns: gridColumns(withKind) }}
          >
            <input
              type="checkbox"
              checked={row.ghost ? false : row.enabled}
              disabled={row.ghost}
              onChange={e => update(i, { enabled: e.target.checked } as Partial<T>)}
              className="justify-self-center accent-[var(--accent-color)]"
              aria-label="Enabled"
            />
            <input
              value={row.key}
              onChange={e => update(i, { key: e.target.value } as Partial<T>)}
              placeholder={row.ghost ? `Add ${keyPlaceholder.toLowerCase()}` : keyPlaceholder}
              className={`cell-input w-full h-7 px-2 font-mono text-[12px] ${row.enabled || row.ghost ? '' : 'line-through opacity-50'}`}
              spellCheck={false}
            />
            {withKind && (
              <select
                value={(row as unknown as BodyField).kind}
                onChange={e => update(i, { kind: e.target.value } as unknown as Partial<T>)}
                className="h-7 px-1 text-[12px] rounded"
                disabled={row.ghost}
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            )}
            <div className="flex items-center gap-1 min-w-0">
              <HighlightInput
                value={row.value}
                onChange={value => update(i, { value } as Partial<T>)}
                ctx={ctx}
                placeholder={isFile ? 'File path' : valuePlaceholder}
                className={`cell-input-wrap flex-1 h-7 rounded font-mono text-[12px] hover:bg-[var(--bg-hover)] focus-within:bg-[var(--bg-tertiary)] ${row.enabled || row.ghost ? '' : 'opacity-50'}`}
              />
              {isFile && (
                <button
                  onClick={async () => {
                    const picked = await open({ multiple: false, title: 'Choose file' });
                    if (typeof picked === 'string') update(i, { value: picked } as Partial<T>);
                  }}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  title="Choose file"
                >
                  <FileUp className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {row.ghost ? (
              <span />
            ) : (
              <button
                onClick={() => remove(i)}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-[var(--text-muted)] hover:text-red-400"
                title="Remove row"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function gridColumns(withKind?: boolean): string {
  return withKind ? '24px minmax(120px, 1fr) 72px minmax(160px, 2fr) 28px' : '24px minmax(120px, 1fr) minmax(160px, 2fr) 28px';
}

export const makeKeyValue = (key: string, value: string): KeyValue => ({ key, value, enabled: true });
export const makeBodyField = (key: string, value: string): BodyField => ({ key, value, enabled: true, kind: 'text' });
