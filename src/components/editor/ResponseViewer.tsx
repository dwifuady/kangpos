import { useMemo, useState } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { AlertTriangle, Copy, Send } from 'lucide-react';
import type { StoredResponse } from '../../types';
import { formatBytes, formatDuration, languageFor, prettyJson, statusColor } from '../../utils/format';
import { CodeEditor } from './CodeEditor';
import { useAppStore } from '../../store';

type View = 'pretty' | 'raw' | 'headers';

export function ResponseViewer({ stored, sending, onCancel, tabId }: { stored: StoredResponse | null; sending: boolean; onCancel: () => void; tabId: string }) {
  const [view, setView] = useState<View>('pretty');
  const addToast = useAppStore(s => s.addToast);
  const response = stored?.response;

  const body = response?.body ?? null;
  const language = useMemo(() => (response && body !== null ? languageFor(response.contentType, body) : 'plaintext'), [response, body]);
  const pretty = useMemo(() => (body !== null && language === 'json' ? prettyJson(body) : (body ?? '')), [body, language]);

  const copy = async (text: string) => {
    await writeText(text);
    addToast({ type: 'success', message: 'Copied to clipboard', duration: 1500 });
  };

  return (
    <div className="flex flex-col h-full min-h-0 relative">
      {sending && (
        <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-10">
          <div className="h-full w-1/4 bg-[var(--accent-color)] animate-loading-bar" />
        </div>
      )}

      <div className="flex items-center gap-2 px-1 h-8 shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Response</span>
        {response && (
          <>
            <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded" style={{ color: statusColor(response.status), backgroundColor: `color-mix(in srgb, ${statusColor(response.status)}, transparent 85%)` }}>
              {response.status} {response.statusText}
            </span>
            <span className="text-[11px] text-[var(--text-secondary)]">{formatDuration(response.durationMs)}</span>
            <span className="text-[11px] text-[var(--text-secondary)]">{formatBytes(response.sizeBytes)}</span>
            {response.truncated && (
              <span className="text-[11px] text-amber-400 flex items-center gap-1" title="Body was cut off (very large response)">
                <AlertTriangle className="w-3 h-3" /> truncated
              </span>
            )}
          </>
        )}
        {stored && (
          <span className="text-[10px] text-[var(--text-muted)] truncate min-w-0" title={`${stored.method} ${stored.url}`}>
            {new Date(stored.sentAt).toLocaleTimeString()} · {stored.method} {stored.url}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {sending && (
            <button onClick={onCancel} className="px-2 py-0.5 text-[12px] rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25">
              Cancel
            </button>
          )}
          {response && (
            <>
              {(['pretty', 'raw', 'headers'] as View[]).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-2 py-0.5 rounded-md text-[12px] capitalize ${view === v ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                  {v === 'headers' ? `Headers (${response.headers.length})` : v}
                </button>
              ))}
              <button
                onClick={() => copy(view === 'headers' ? response.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : view === 'pretty' ? pretty : (body ?? response.bodyBase64 ?? ''))}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                title="Copy"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {!stored && !sending && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-[var(--text-muted)]">
            <Send className="w-6 h-6 opacity-50" />
            <p className="text-sm">Send the request to see the response</p>
            <p className="text-xs">Ctrl+Enter</p>
          </div>
        )}
        {stored?.error && (
          <div className="m-1 p-3 rounded-md border border-red-500/30 bg-red-500/10 text-red-400 text-[13px] break-words">
            <div className="font-semibold mb-1">Request failed</div>
            {stored.error}
          </div>
        )}
        {response && view === 'headers' && (
          <div className="h-full overflow-auto px-1">
            <table className="w-full text-[12px] font-mono">
              <tbody>
                {response.headers.map(([k, v], i) => (
                  <tr key={i} className="border-b border-[var(--border-subtle)] align-top">
                    <td className="py-1 pr-4 text-[var(--text-secondary)] whitespace-nowrap">{k}</td>
                    <td className="py-1 text-[var(--text-primary)] break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {response && view !== 'headers' && body === null && (
          <div className="p-3 text-[13px] text-[var(--text-muted)]">
            Binary response ({formatBytes(response.sizeBytes)}, {response.contentType ?? 'unknown type'}). Copy gives the base64 body.
          </div>
        )}
        {response && view !== 'headers' && body !== null && (
          <CodeEditor
            path={`kangpos://tab/${tabId}/response-${view}`}
            value={view === 'pretty' ? pretty : body}
            language={view === 'pretty' ? language : 'plaintext'}
            readOnly
          />
        )}
      </div>
    </div>
  );
}
