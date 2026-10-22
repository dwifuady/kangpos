// New-tab modal: pick a template (or a blank request). Works like a command
// palette: type to filter, arrows to move, Enter to open.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FilePlus2, Search, Upload } from 'lucide-react';
import { useAppStore } from '../store';
import type { Template } from '../types';
import { METHOD_COLORS } from '../utils/format';

type Entry = { kind: 'blank' } | { kind: 'template'; template: Template } | { kind: 'import' };

/** Every word of the query must appear somewhere in the template. */
export function matchesQuery(t: Template, query: string): boolean {
  const haystack = `${t.folder} ${t.name} ${t.request.method} ${t.request.url}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => haystack.includes(word));
}

export function TemplatePicker() {
  const open = useAppStore(s => s.pickerOpen);
  const setOpen = useAppStore(s => s.setPickerOpen);
  const templates = useAppStore(s => s.templates);
  const openTemplate = useAppStore(s => s.openTemplate);
  const setImportOpen = useAppStore(s => s.setImportOpen);
  const spaceColor = useAppStore(s => s.spaces.find(x => x.id === s.activeSpaceId)?.color ?? '#0078d4');
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const entries = useMemo<Entry[]>(() => {
    const matched = templates.filter(t => matchesQuery(t, query));
    const list: Entry[] = matched.map(template => ({ kind: 'template', template }));
    // Blank stays reachable; it leads when there's no query.
    if (!query.trim()) list.unshift({ kind: 'blank' });
    else list.push({ kind: 'blank' });
    if (templates.length === 0) list.push({ kind: 'import' });
    return list;
  }, [templates, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setIndex(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const choose = (entry: Entry | undefined) => {
    if (!entry) return;
    if (entry.kind === 'import') {
      setOpen(false);
      setImportOpen(true);
    } else {
      void openTemplate(entry.kind === 'template' ? entry.template : null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex(i => (i + 1) % entries.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex(i => (i - 1 + entries.length) % entries.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(entries[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  let lastFolder: string | null = null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
      <div
        role="dialog"
        aria-label="New request"
        className="relative w-[560px] max-w-[92vw] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl overflow-hidden animate-fade-in"
        onKeyDown={onKeyDown}
      >
        <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">New request from template</div>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search templates… (e.g. get contact)"
              className="w-full pl-8 pr-2 py-1.5 text-sm rounded-md"
            />
          </div>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto pb-1">
          {entries.map((entry, i) => {
            const selected = i === index;
            const rowClass = `w-full px-3 py-2 text-left flex items-center gap-2.5 border-0 ${
              selected ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            }`;

            if (entry.kind === 'blank' || entry.kind === 'import') {
              const isBlank = entry.kind === 'blank';
              return (
                <button key={entry.kind} data-index={i} className={rowClass} onMouseEnter={() => setIndex(i)} onClick={() => choose(entry)}>
                  {isBlank ? <FilePlus2 className="w-4 h-4 shrink-0" style={{ color: spaceColor }} /> : <Upload className="w-4 h-4 shrink-0 opacity-70" />}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium">{isBlank ? 'Blank request' : 'Import templates…'}</span>
                    <span className="block text-[11px] text-[var(--text-muted)]">
                      {isBlank ? 'Start from an empty request' : 'Postman collection, Postman environment, OpenAPI / Swagger'}
                    </span>
                  </span>
                </button>
              );
            }

            const t = entry.template;
            const showFolder = t.folder !== lastFolder;
            lastFolder = t.folder;
            return (
              <div key={t.id}>
                {showFolder && (
                  <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {t.folder || 'No folder'}
                  </div>
                )}
                <button data-index={i} className={rowClass} onMouseEnter={() => setIndex(i)} onClick={() => choose(entry)}>
                  <span className="w-12 shrink-0 text-[10px] font-bold text-right" style={{ color: METHOD_COLORS[t.request.method] }}>
                    {t.request.method}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{t.name}</span>
                    <span className="block text-[11px] text-[var(--text-muted)] truncate font-mono">{t.request.url || '—'}</span>
                  </span>
                  {t.request.params.length > 0 && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">
                      {t.request.params.filter(p => p.required).length}/{t.request.params.length} required
                    </span>
                  )}
                </button>
              </div>
            );
          })}
          {query && entries.length === 1 && (
            <div className="px-3 py-3 text-center text-sm text-[var(--text-muted)]">No templates match "{query}"</div>
          )}
        </div>

        <div className="px-3 py-1.5 border-t border-[var(--border-subtle)] text-[10px] text-[var(--text-muted)] flex gap-3">
          <span>↑↓ navigate</span>
          <span>Enter open</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
