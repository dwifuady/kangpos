// Text input that colours {{placeholders}} by where their value comes from:
// tab inputs, environment, dynamic, or unresolved. A highlighted copy of the
// text sits behind a transparent-text <input>. Typing `{{` opens suggestions.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  classifyVariable,
  placeholderPrefix,
  previewValue,
  variableSuggestions,
  type ResolveContext,
  type VariableSuggestion,
} from '../../utils/variables';

const PLACEHOLDER = /(\{\{\s*[^{}]+?\s*\}\})/g;

const SOURCE_LABEL: Record<VariableSuggestion['source'], string> = {
  param: 'input',
  env: 'env',
  dynamic: 'dynamic',
};

interface HighlightInputProps {
  value: string;
  onChange: (value: string) => void;
  ctx: ResolveContext;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

interface SuggestState {
  items: VariableSuggestion[];
  index: number;
  rect: DOMRect;
}

/** Replace the `{{partial` before the caret (and any `name}}` right after it) with `{{name}}`. */
export function insertSuggestion(value: string, caret: number, name: string): { value: string; caret: number } {
  const before = value.slice(0, caret);
  const start = before.lastIndexOf('{{');
  let after = value.slice(caret);
  const rest = /^[^{}\s]*\}\}/.exec(after);
  if (rest) after = after.slice(rest[0].length);
  const inserted = `{{${name}}}`;
  return { value: value.slice(0, start) + inserted + after, caret: start + inserted.length };
}

export function HighlightInput({ value, onChange, ctx, placeholder, className = '', onKeyDown, ariaLabel, inputRef }: HighlightInputProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLInputElement | null>(null);
  const [suggest, setSuggest] = useState<SuggestState | null>(null);

  const syncScroll = () => {
    if (overlayRef.current && localRef.current) {
      overlayRef.current.style.transform = `translateX(${-localRef.current.scrollLeft}px)`;
    }
  };
  useLayoutEffect(syncScroll, [value]);

  const refreshSuggest = (text: string) => {
    const input = localRef.current;
    if (!input || document.activeElement !== input) return setSuggest(null);
    const caret = input.selectionStart ?? text.length;
    const prefix = placeholderPrefix(text.slice(0, caret));
    if (prefix === null) return setSuggest(null);
    const items = variableSuggestions(ctx, prefix);
    if (items.length === 0 || !wrapRef.current) return setSuggest(null);
    setSuggest(prev => ({ items, index: prev ? Math.min(prev.index, items.length - 1) : 0, rect: wrapRef.current!.getBoundingClientRect() }));
  };

  const apply = (name: string) => {
    const input = localRef.current;
    if (!input) return;
    const next = insertSuggestion(value, input.selectionStart ?? value.length, name);
    onChange(next.value);
    setSuggest(null);
    // Move the caret after the controlled value has been applied.
    requestAnimationFrame(() => {
      input.setSelectionRange(next.caret, next.caret);
      syncScroll();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggest) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSuggest({ ...suggest, index: (suggest.index + step + suggest.items.length) % suggest.items.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        apply(suggest.items[suggest.index].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setSuggest(null);
        return;
      }
    }
    onKeyDown?.(e);
  };

  // Hover text: the value this field resolves to (secrets masked).
  const hover = useMemo(() => {
    const names = [...new Set([...value.matchAll(PLACEHOLDER)].map(m => m[1].slice(2, -2).trim()))];
    if (names.length === 0) return undefined;
    return names
      .map(n => `${n} = ${classifyVariable(n, ctx) === 'unresolved' ? '(not defined)' : previewValue(n, ctx)}`)
      .join('\n');
  }, [value, ctx]);

  const parts = value.split(PLACEHOLDER);

  return (
    <div ref={wrapRef} className={`relative min-w-0 overflow-hidden ${className}`}>
      <div aria-hidden className="absolute inset-0 pointer-events-none flex items-center px-[var(--hl-px,10px)] whitespace-pre overflow-hidden">
        <div ref={overlayRef} className="whitespace-pre">
          {parts.map((part, i) =>
            i % 2 === 0 ? (
              <span key={i}>{part}</span>
            ) : (
              <span key={i} className={`var-${classifyVariable(part.slice(2, -2).trim(), ctx)}`}>
                {part}
              </span>
            ),
          )}
        </div>
      </div>
      <input
        ref={el => {
          localRef.current = el;
          if (typeof inputRef === 'function') inputRef(el);
          else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }}
        value={value}
        onChange={e => {
          onChange(e.target.value);
          refreshSuggest(e.target.value);
        }}
        onScroll={syncScroll}
        onKeyUp={e => {
          syncScroll();
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') refreshSuggest(value);
        }}
        onClick={() => refreshSuggest(value)}
        onSelect={syncScroll}
        onKeyDown={handleKeyDown}
        onBlur={() => setSuggest(null)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={!!suggest}
        title={hover}
        spellCheck={false}
        className="relative w-full h-full bg-transparent px-[var(--hl-px,10px)] text-transparent caret-[var(--text-primary)] placeholder:text-[var(--text-muted)] selection:bg-[var(--accent-glow)] selection:text-transparent"
        style={{ color: 'transparent', background: 'transparent', border: 'none', boxShadow: 'none', borderRadius: 0 }}
      />
      {suggest &&
        createPortal(
          <div
            role="listbox"
            className="fixed z-[95] min-w-[260px] max-w-[440px] max-h-64 overflow-y-auto py-1 rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
            style={{ left: suggest.rect.left, top: suggest.rect.bottom + 2 }}
          >
            {suggest.items.map((item, i) => (
              <button
                key={item.name}
                role="option"
                aria-selected={i === suggest.index}
                // mousedown + preventDefault keeps focus (and the caret) in the input
                onMouseDown={e => {
                  e.preventDefault();
                  apply(item.name);
                }}
                onMouseEnter={() => setSuggest({ ...suggest, index: i })}
                className={`w-full flex items-center gap-2 px-2.5 py-1 text-left text-[12px] ${
                  i === suggest.index ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]'
                }`}
              >
                <span className={`font-mono var-${item.source}`}>{item.name}</span>
                <span className="text-[10px] px-1 rounded bg-[var(--bg-hover)] text-[var(--text-muted)] shrink-0">{SOURCE_LABEL[item.source]}</span>
                <span className="ml-auto truncate text-[11px] text-[var(--text-muted)] max-w-[220px]">{item.preview}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
