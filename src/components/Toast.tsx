import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore } from '../store';

const STYLE = {
  success: 'bg-green-500/10 border-green-500/30 text-green-400',
  error: 'bg-red-500/10 border-red-500/30 text-red-400',
  info: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
};

const ICON = {
  success: <CheckCircle2 className="w-4 h-4" />,
  error: <XCircle className="w-4 h-4" />,
  info: <Info className="w-4 h-4" />,
};

export function ToastContainer() {
  const toasts = useAppStore(s => s.toasts);
  const removeToast = useAppStore(s => s.removeToast);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[70] flex flex-col gap-2 max-w-md" role="status" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-lg border backdrop-blur-md shadow-lg animate-fade-in ${STYLE[t.type]}`}
        >
          <span className="shrink-0 mt-0.5">{ICON[t.type]}</span>
          <p className="text-[13px] font-medium flex-1 break-words">{t.message}</p>
          <button onClick={() => removeToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
