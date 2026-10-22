import { useAppStore } from '../store';
import type { Theme } from '../store/slices/uiSlice';
import { labelClass, Modal, PrimaryButton } from './Modal';

const SHORTCUTS: [string, string][] = [
  ['Ctrl+T / Ctrl+N', 'New request (template picker)'],
  ['Ctrl+Enter', 'Send'],
  ['Ctrl+S', 'Update template (or save as template)'],
  ['Ctrl+Shift+S', 'Save as new template'],
  ['Ctrl+W', 'Close tab'],
  ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous tab'],
  ['Ctrl+L', 'Focus URL'],
  ['Ctrl+E', 'Environments'],
  ['Ctrl+B', 'Toggle sidebar'],
  ['F2', 'Rename tab'],
];

export function SettingsDialog() {
  const open = useAppStore(s => s.settingsOpen);
  const setOpen = useAppStore(s => s.setSettingsOpen);
  const theme = useAppStore(s => s.theme);
  const setTheme = useAppStore(s => s.setTheme);
  const options = useAppStore(s => s.sendOptions);
  const setSendOptions = useAppStore(s => s.setSendOptions);
  if (!open) return null;

  return (
    <Modal title="Settings" onClose={() => setOpen(false)} width="max-w-lg" footer={<PrimaryButton onClick={() => setOpen(false)}>Done</PrimaryButton>}>
      <label className={labelClass}>Theme</label>
      <div className="flex gap-1 mb-4">
        {(['system', 'dark', 'light'] as Theme[]).map(t => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            className={`px-3 py-1 rounded-md text-[13px] capitalize ${theme === t ? 'bg-[var(--accent-color)] text-white' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-active)]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="text-xs font-medium text-[var(--text-secondary)] mb-2">Requests</div>
      <div className="flex flex-col gap-2.5 mb-4 text-[13px]">
        <label className="flex items-center justify-between gap-3">
          <span>Timeout (seconds, 0 = none)</span>
          <input
            type="number"
            min={0}
            value={Math.round(options.timeoutMs / 1000)}
            onChange={e => setSendOptions({ timeoutMs: Math.max(0, Number(e.target.value) || 0) * 1000 })}
            className="w-24 px-2 py-1 rounded"
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Follow redirects</span>
          <input type="checkbox" checked={options.followRedirects} onChange={e => setSendOptions({ followRedirects: e.target.checked })} className="accent-[var(--accent-color)]" />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>
            Verify TLS certificates
            <span className="block text-[11px] text-[var(--text-muted)]">Turn off only for local dev servers with self-signed certs.</span>
          </span>
          <input type="checkbox" checked={options.verifyTls} onChange={e => setSendOptions({ verifyTls: e.target.checked })} className="accent-[var(--accent-color)]" />
        </label>
      </div>

      <div className="text-xs font-medium text-[var(--text-secondary)] mb-1.5">Keyboard shortcuts</div>
      <table className="w-full text-[12px]">
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={keys}>
              <td className="py-0.5 pr-3 font-mono text-[var(--text-secondary)] whitespace-nowrap">{keys}</td>
              <td className="py-0.5 text-[var(--text-primary)]">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
