import { useEffect, useMemo, useState } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { save } from '@tauri-apps/plugin-dialog';
import { AlertTriangle, CheckCircle2, Copy, Download, FileQuestion, Send, XCircle } from 'lucide-react';
import * as api from '../../api';
import type { ScriptLog, ScriptTest, StoredResponse } from '../../types';
import { formatBytes, formatDuration, languageFor, prettyJson, statusColor } from '../../utils/format';
import { bytesToBase64, detectPreview, responseBytes, suggestedFileName } from '../../utils/binary';
import { CodeEditor } from './CodeEditor';
import { renderTemplate } from '../../scripting/handlebars';
import { useAppStore } from '../../store';

type View = 'visualize' | 'preview' | 'pretty' | 'raw' | 'headers' | 'tests' | 'console';

const VIEW_LABEL: Record<View, string> = { visualize: 'Visualize', preview: 'Preview', pretty: 'Pretty', raw: 'Raw', headers: 'Headers', tests: 'Tests', console: 'Console' };

const LOG_COLOR: Record<ScriptLog['level'], string> = {
  log: 'text-[var(--text-primary)]',
  info: 'text-[var(--text-secondary)]',
  warn: 'text-amber-400',
  error: 'text-red-400',
};

export function ResponseViewer({ stored, sending, onCancel, tabId }: { stored: StoredResponse | null; sending: boolean; onCancel: () => void; tabId: string }) {
  const addToast = useAppStore(s => s.addToast);
  const response = stored?.response;
  // Rust trims very large bodies when it stores the response; the cut copy can't be previewed.
  const cutOnSave = !!(stored as (StoredResponse & { truncated?: boolean }) | null)?.truncated;

  const body = response?.body ?? null;
  const bytes = useMemo(() => {
    if (!response) return null;
    try {
      return responseBytes(response);
    } catch {
      return null; // malformed base64 (e.g. cut on save)
    }
  }, [response]);
  const preview = useMemo(() => (response && bytes ? detectPreview(response.contentType, bytes) : null), [response, bytes]);
  const language = useMemo(() => (response && body !== null ? languageFor(response.contentType, body) : 'plaintext'), [response, body]);
  const pretty = useMemo(() => (body !== null && language === 'json' ? prettyJson(body) : (body ?? '')), [body, language]);

  // Script results: tests from both scripts, console output tagged by script.
  const scriptInfo = stored?.scripts;
  const tests: (ScriptTest & { phase: string })[] = [
    ...(scriptInfo?.before?.tests ?? []).map(t => ({ ...t, phase: 'before' })),
    ...(scriptInfo?.after?.tests ?? []).map(t => ({ ...t, phase: 'after' })),
  ];
  const logs: (ScriptLog & { phase: string })[] = [
    ...(scriptInfo?.before?.logs ?? []).map(l => ({ ...l, phase: 'before' })),
    ...(scriptInfo?.after?.logs ?? []).map(l => ({ ...l, phase: 'after' })),
  ];
  const passed = tests.filter(t => t.passed).length;
  const scriptError = scriptInfo?.before?.error ?? scriptInfo?.after?.error;

  // pm.visualizer.set() output; the template is rendered once per response.
  const visualizer = scriptInfo?.after?.visualizer ?? scriptInfo?.before?.visualizer;
  const visualized = useMemo(() => {
    if (!visualizer) return null;
    try {
      return { html: renderTemplate(visualizer.template, visualizer.data) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [visualizer]);

  const views: View[] = [];
  if (visualized) views.push('visualize');
  if (response) {
    if (preview) views.push('preview');
    if (body !== null) views.push('pretty', 'raw');
    views.push('headers');
  }
  if (tests.length > 0) views.push('tests');
  if (logs.length > 0) views.push('console');

  // Images and PDFs open in Preview; text (including HTML) opens as Pretty.
  const defaultView: View = visualized
    ? 'visualize'
    : !response
      ? tests.length > 0 ? 'tests' : 'console'
      : preview && (preview.kind !== 'html' || body === null) ? 'preview' : body !== null ? 'pretty' : 'headers';
  const [view, setView] = useState<View>(defaultView);
  useEffect(() => setView(defaultView), [stored?.sentAt, tabId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per response
  const activeView = views.includes(view) ? view : defaultView;

  // Blob URL for image / PDF previews.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!preview || preview.kind === 'html' || !bytes || cutOnSave) {
      setBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: preview.mime }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview, bytes, cutOnSave]);

  const [imageSize, setImageSize] = useState<string | null>(null);
  useEffect(() => setImageSize(null), [blobUrl]);

  const copy = async (text: string) => {
    await writeText(text);
    addToast({ type: 'success', message: 'Copied to clipboard', duration: 1500 });
  };

  const saveToFile = async () => {
    if (!response || !bytes) return;
    const name = suggestedFileName(response, stored?.url ?? '');
    const ext = name.includes('.') ? name.split('.').pop()! : '';
    const path = await save({
      title: 'Save response',
      defaultPath: name,
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : undefined,
    });
    if (!path) return;
    try {
      await api.saveResponseFile(path, bytesToBase64(bytes));
      addToast({ type: 'success', message: `Saved ${path.split(/[\\/]/).pop()}` });
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
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
            {preview && preview.kind !== 'html' && <span className="text-[11px] text-[var(--text-muted)]">{preview.mime}</span>}
            {(response.truncated || cutOnSave) && (
              <span
                className="text-[11px] text-amber-400 flex items-center gap-1"
                title={cutOnSave ? 'Only the first 2 MB was kept when this tab was saved; send again for the full body' : 'Body was cut off (very large response)'}
              >
                <AlertTriangle className="w-3 h-3" /> truncated
              </span>
            )}
          </>
        )}
        {tests.length > 0 && (
          <button
            onClick={() => setView('tests')}
            className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${passed === tests.length ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'}`}
            title="Test results"
          >
            Tests {passed}/{tests.length}
          </button>
        )}
        {scriptError && (
          <button onClick={() => setView('console')} className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-500/15 text-red-400" title={scriptError}>
            Script error
          </button>
        )}
        {stored && (
          <span className="text-[10px] text-[var(--text-muted)] truncate min-w-0" title={`${stored.method} ${stored.url}`}>
            {new Date(stored.sentAt).toLocaleTimeString()} · {stored.method} {stored.url}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {sending && (
            <button onClick={onCancel} className="px-2 py-0.5 text-[12px] rounded-md bg-red-500/15 text-red-400 hover:bg-red-500/25">
              Cancel
            </button>
          )}
          {views.map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded-md text-[12px] ${activeView === v ? 'bg-[var(--bg-active)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              {v === 'headers' && response ? `Headers (${response.headers.length})` : v === 'console' ? `Console (${logs.length})` : VIEW_LABEL[v]}
            </button>
          ))}
          {response && (
            <>
              {activeView !== 'preview' && activeView !== 'visualize' && activeView !== 'tests' && activeView !== 'console' && (body !== null || activeView === 'headers') && (
                <button
                  onClick={() => copy(activeView === 'headers' ? response.headers.map(([k, v]) => `${k}: ${v}`).join('\n') : activeView === 'pretty' ? pretty : (body ?? ''))}
                  className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  title="Copy"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={saveToFile}
                disabled={!bytes || cutOnSave}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                title={cutOnSave ? 'Send again to save the full body' : 'Save response body to a file'}
              >
                <Download className="w-3.5 h-3.5" />
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
            <div className="font-semibold mb-1">{stored.error.startsWith('Before script failed') ? 'Not sent' : 'Request failed'}</div>
            {stored.error}
          </div>
        )}

        {activeView === 'tests' && tests.length > 0 && (
          <div className="h-full overflow-auto px-1 py-1 space-y-0.5">
            {tests.map((t, i) => (
              <div key={i} className="flex items-start gap-2 px-2 py-1 rounded hover:bg-[var(--bg-hover)] text-[13px]">
                {t.passed ? <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <div className="text-[var(--text-primary)]">
                    {t.name}
                    {t.phase === 'before' && <span className="ml-1.5 text-[10px] text-[var(--text-muted)]">before script</span>}
                  </div>
                  {t.error && <div className="text-[12px] text-red-400 font-mono break-words">{t.error}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeView === 'visualize' && visualized && (
          <div className="h-full rounded-md border border-[var(--border-color)] overflow-hidden">
            {'error' in visualized ? (
              <div className="p-3 text-[13px] text-red-400 font-mono break-words">Visualizer template error: {visualized.error}</div>
            ) : (
              // Visualizer templates are HTML: shown without scripts, forms or navigation.
              <iframe srcDoc={visualized.html} sandbox="" title="Visualizer" className="w-full h-full bg-white" />
            )}
          </div>
        )}

        {activeView === 'console' && logs.length > 0 && (
          <div className="h-full overflow-auto px-1 py-1 font-mono text-[12px]">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2 px-2 py-0.5 border-b border-[var(--border-subtle)]">
                <span className="shrink-0 w-12 text-[10px] uppercase text-[var(--text-muted)] pt-0.5">{l.phase}</span>
                <pre className={`whitespace-pre-wrap break-words m-0 font-mono ${LOG_COLOR[l.level]}`}>{l.message}</pre>
              </div>
            ))}
          </div>
        )}

        {response && activeView === 'headers' && (
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

        {response && activeView === 'preview' && preview && (
          <div className="h-full rounded-md border border-[var(--border-color)] overflow-hidden">
            {cutOnSave ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-[13px] text-[var(--text-muted)]">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
                Only part of this response was kept when the tab was saved. Send again to preview it.
              </div>
            ) : preview.kind === 'image' ? (
              blobUrl && (
                <div className="h-full flex flex-col">
                  <div
                    className="flex-1 min-h-0 flex items-center justify-center p-3 overflow-auto"
                    style={{ background: 'repeating-conic-gradient(var(--bg-hover) 0% 25%, transparent 0% 50%) 50% / 16px 16px' }}
                  >
                    <img
                      src={blobUrl}
                      alt="Response image"
                      className="max-w-full max-h-full object-contain"
                      onLoad={e => setImageSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
                      onError={() => setImageSize('could not display this image')}
                    />
                  </div>
                  {imageSize && <div className="px-2 py-1 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)]">{imageSize}</div>}
                </div>
              )
            ) : preview.kind === 'pdf' ? (
              blobUrl && <iframe src={blobUrl} title="PDF preview" className="w-full h-full bg-white" />
            ) : (
              // HTML: rendered without scripts, forms or navigation.
              <iframe srcDoc={body ?? ''} sandbox="" title="HTML preview" className="w-full h-full bg-white" />
            )}
          </div>
        )}

        {response && activeView !== 'headers' && activeView !== 'preview' && body !== null && (
          <CodeEditor
            path={`kangpos://tab/${tabId}/response-${activeView}`}
            value={activeView === 'pretty' ? pretty : body}
            language={activeView === 'pretty' ? language : 'plaintext'}
            readOnly
          />
        )}

        {response && body === null && !preview && activeView !== 'headers' && (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-[13px] text-[var(--text-muted)]">
            <FileQuestion className="w-6 h-6 opacity-60" />
            <p>
              Binary response ({formatBytes(response.sizeBytes)}, {response.contentType ?? 'unknown type'}) that can't be previewed.
            </p>
            <button onClick={saveToFile} className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-primary)]">
              <Download className="w-3.5 h-3.5" /> Save to file…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
