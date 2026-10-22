// Shared dialog shell: dimmed overlay, Escape to close, Larik's dialog styling.
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}

export function Modal({ title, onClose, children, footer, width = 'max-w-md' }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 theme-overlay" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${width} max-h-[88vh] flex flex-col rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl animate-fade-in`}
      >
        {title && (
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h3>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="px-4 pb-3 overflow-y-auto min-h-0">{children}</div>
        {footer && <div className="flex justify-end gap-1.5 px-4 py-3 border-t border-[var(--border-subtle)]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function PrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-3 py-1.5 rounded-md bg-[var(--accent-color)] hover:bg-[var(--accent-hover)] text-white font-medium text-sm ${props.className ?? ''}`}
    />
  );
}

export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-3 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-sm ${props.className ?? ''}`}
    />
  );
}

export const inputClass =
  'w-full px-2.5 py-1.5 text-sm rounded-md placeholder-[var(--text-muted)]';

export const labelClass = 'block text-xs text-[var(--text-secondary)] mb-1';
