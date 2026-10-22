// Text input that colours {{placeholders}} by where their value comes from:
// tab params, environment, dynamic, or unresolved. A highlighted copy of the
// text sits behind a transparent-text <input>.
import { useLayoutEffect, useRef } from 'react';
import { classifyVariable, resolveText, type ResolveContext } from '../../utils/variables';

const PLACEHOLDER = /(\{\{\s*[^{}]+?\s*\}\})/g;

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

export function HighlightInput({ value, onChange, ctx, placeholder, className = '', onKeyDown, ariaLabel, inputRef }: HighlightInputProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLInputElement | null>(null);

  const syncScroll = () => {
    if (overlayRef.current && localRef.current) {
      overlayRef.current.style.transform = `translateX(${-localRef.current.scrollLeft}px)`;
    }
  };
  useLayoutEffect(syncScroll, [value]);

  const parts = value.split(PLACEHOLDER);

  return (
    <div className={`relative min-w-0 overflow-hidden ${className}`}>
      <div aria-hidden className="absolute inset-0 pointer-events-none flex items-center px-[var(--hl-px,10px)] whitespace-pre overflow-hidden">
        <div ref={overlayRef} className="whitespace-pre">
          {parts.map((part, i) => {
            if (i % 2 === 0) return <span key={i}>{part}</span>;
            const name = part.slice(2, -2).trim();
            const source = classifyVariable(name, ctx);
            const preview = source === 'unresolved' ? 'Not defined in params or the active environment' : resolveText(part, ctx);
            return (
              <span key={i} className={`var-${source}`} title={preview}>
                {part}
              </span>
            );
          })}
        </div>
      </div>
      <input
        ref={el => {
          localRef.current = el;
          if (typeof inputRef === 'function') inputRef(el);
          else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
        }}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyUp={syncScroll}
        onSelect={syncScroll}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        className="relative w-full h-full bg-transparent px-[var(--hl-px,10px)] text-transparent caret-[var(--text-primary)] placeholder:text-[var(--text-muted)] selection:bg-[var(--accent-glow)] selection:text-transparent"
        style={{ color: 'transparent', background: 'transparent', border: 'none', boxShadow: 'none', borderRadius: 0 }}
      />
    </div>
  );
}
