import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  shortcut?: string;
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: (MenuItem | 'separator')[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep the menu on screen.
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - items.length * 30 - 16);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[90] min-w-[200px] py-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl animate-fade-in"
      style={{ left, top }}
    >
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="my-1 mx-2 border-t border-[var(--border-color)]" />
        ) : (
          <button
            key={i}
            role="menuitem"
            onClick={() => {
              onClose();
              item.onClick();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-[var(--bg-hover)] ${
              item.danger ? 'text-red-400' : 'text-[var(--text-primary)]'
            }`}
          >
            <span className="w-4 h-4 flex items-center justify-center opacity-70">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <span className="text-[11px] text-[var(--text-muted)]">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
