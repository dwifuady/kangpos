// One tab: URL bar, template banner, params form, request sections, response.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { AlertTriangle, Copy, FilePlus2, MoreHorizontal, Pencil, Save, Send, Square } from 'lucide-react';
import { activeEnvironment, useAppStore } from '../store';
import { HTTP_METHODS, type HttpMethod, type Tab } from '../types';
import { addParamsAsQuery, buildRequest, toCurl, unusedParams } from '../utils/request';
import { missingRequiredParams, type ResolveContext } from '../utils/variables';
import { METHOD_COLORS } from '../utils/format';
import { getReadableTextColor } from '../utils/color';
import { HighlightInput } from './editor/HighlightInput';
import { KeyValueTable, makeKeyValue } from './editor/KeyValueTable';
import { BodyEditor } from './editor/BodyEditor';
import { AuthEditor } from './editor/AuthEditor';
import { ParamsForm } from './editor/ParamsForm';
import { ParamDefinitions } from './editor/ParamDefinitions';
import { ResponseViewer } from './editor/ResponseViewer';
import { ContextMenu, type MenuItem } from './ContextMenu';

type Section = 'params' | 'query' | 'headers' | 'body' | 'auth';

// Remember the open section per tab while the app runs.
const sectionByTab = new Map<string, Section>();
const SPLIT_KEY = 'kangpos-split';

function defaultSection(tab: Tab): Section {
  if (tab.request.body.type !== 'none') return 'body';
  if (tab.request.query.length > 0) return 'query';
  return 'headers';
}

export function RequestEditor({ tab }: { tab: Tab }) {
  const env = useAppStore(s => activeEnvironment(s));
  const space = useAppStore(s => s.spaces.find(x => x.id === s.activeSpaceId));
  const template = useAppStore(s => (tab.template_id ? s.templates.find(t => t.id === tab.template_id) : undefined));
  const sending = useAppStore(s => !!s.inFlight[tab.id]);
  const editTabRequest = useAppStore(s => s.editTabRequest);
  const setTabParamValue = useAppStore(s => s.setTabParamValue);
  const sendTab = useAppStore(s => s.sendTab);
  const cancelTab = useAppStore(s => s.cancelTab);
  const updateTemplateFromTab = useAppStore(s => s.updateTemplateFromTab);
  const setSaveTemplateOpen = useAppStore(s => s.setSaveTemplateOpen);
  const duplicateTab = useAppStore(s => s.duplicateTab);
  const addToast = useAppStore(s => s.addToast);

  const spaceColor = space?.color ?? '#0078d4';
  const [section, setSectionState] = useState<Section>(() => sectionByTab.get(tab.id) ?? defaultSection(tab));
  const [attempted, setAttempted] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [split, setSplit] = useState(() => Number(localStorage.getItem(SPLIT_KEY)) || 0.45);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSectionState(sectionByTab.get(tab.id) ?? defaultSection(tab));
    setAttempted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when switching tabs
  }, [tab.id]);

  // Focus the URL of a blank new tab.
  useEffect(() => {
    if (!tab.template_id && tab.request.url === '') urlRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when switching tabs
  }, [tab.id]);

  const setSection = (s: Section) => {
    sectionByTab.set(tab.id, s);
    setSectionState(s);
  };

  const ctx: ResolveContext = useMemo(
    () => ({ params: tab.request.params, paramValues: tab.param_values, env: env?.variables ?? [] }),
    [tab.request.params, tab.param_values, env],
  );

  const request = tab.request;
  const edit = useCallback((patch: Partial<typeof request>) => editTabRequest(tab.id, r => ({ ...r, ...patch })), [editTabRequest, tab.id]);

  const unused = useMemo(() => unusedParams(request), [request]);

  const modified = useMemo(
    () => !!template && JSON.stringify(template.request) !== JSON.stringify(tab.request),
    [template, tab.request],
  );

  const send = useCallback(() => {
    setAttempted(missingRequiredParams(tab.request.params, tab.param_values).length > 0);
    void sendTab(tab.id);
  }, [sendTab, tab.id, tab.request.params, tab.param_values]);

  // Shortcut handlers (useShortcuts) talk to the active editor through events.
  useEffect(() => {
    const onSend = () => send();
    const onFocusUrl = () => urlRef.current?.focus();
    window.addEventListener('kangpos:send', onSend);
    window.addEventListener('kangpos:focus-url', onFocusUrl);
    return () => {
      window.removeEventListener('kangpos:send', onSend);
      window.removeEventListener('kangpos:focus-url', onFocusUrl);
    };
  }, [send]);

  const copyCurl = async () => {
    const built = buildRequest(tab.request, ctx);
    await writeText(toCurl(built));
    addToast({ type: 'success', message: 'Copied as cURL', duration: 1500 });
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ratio = Math.min(0.8, Math.max(0.15, (ev.clientY - rect.top) / rect.height));
      setSplit(ratio);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      setSplit(r => {
        localStorage.setItem(SPLIT_KEY, String(r));
        return r;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  const menuItems: (MenuItem | 'separator')[] = [
    { label: 'Copy as cURL', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => void copyCurl() },
    ...(template ? [{ label: `Update "${template.name}"`, icon: <Save className="w-3.5 h-3.5" />, shortcut: 'Ctrl+S', onClick: () => void updateTemplateFromTab(tab.id) }] : []),
    { label: 'Save as new template…', icon: <FilePlus2 className="w-3.5 h-3.5" />, shortcut: template ? 'Ctrl+Shift+S' : 'Ctrl+S', onClick: () => setSaveTemplateOpen(true) },
    'separator',
    { label: 'Duplicate tab', icon: <Copy className="w-3.5 h-3.5" />, onClick: () => void duplicateTab(tab.id) },
    { label: 'Rename tab', icon: <Pencil className="w-3.5 h-3.5" />, shortcut: 'F2', onClick: () => window.dispatchEvent(new CustomEvent('kangpos:rename-tab', { detail: tab.id })) },
  ];

  const counts = {
    params: request.params.length,
    query: request.query.filter(q => q.enabled).length,
    headers: request.headers.filter(h => h.enabled).length,
  };
  const sections: { id: Section; label: string; badge?: string }[] = [
    { id: 'params', label: 'Inputs', badge: counts.params ? String(counts.params) : undefined },
    { id: 'query', label: 'Query params', badge: counts.query ? String(counts.query) : undefined },
    { id: 'headers', label: 'Headers', badge: counts.headers ? String(counts.headers) : undefined },
    { id: 'body', label: 'Body', badge: request.body.type !== 'none' ? request.body.type.replace('form-urlencoded', 'form') : undefined },
    { id: 'auth', label: 'Auth', badge: request.auth.type !== 'none' ? request.auth.type : undefined },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 p-2 pt-2.5 gap-2" style={{ ['--space-color' as string]: spaceColor }}>
      {/* URL bar */}
      <div className="flex items-center gap-1.5 shrink-0">
        <div className="flex items-stretch flex-1 min-w-0 h-9 rounded-md border border-[var(--border-color)] bg-[var(--bg-tertiary)] focus-within:border-b-[var(--accent-color)] focus-within:shadow-[0_1px_0_0_var(--accent-color)]">
          <select
            value={request.method}
            onChange={e => edit({ method: e.target.value as HttpMethod })}
            className="shrink-0 w-[92px] pl-2.5 text-[12px] font-bold rounded-l-md rounded-r-none border-0 border-r border-[var(--border-color)] bg-transparent"
            style={{ color: METHOD_COLORS[request.method], border: 'none', borderRight: '1px solid var(--border-color)', boxShadow: 'none' }}
            aria-label="HTTP method"
          >
            {HTTP_METHODS.map(m => (
              <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>
                {m}
              </option>
            ))}
          </select>
          <HighlightInput
            inputRef={urlRef}
            value={request.url}
            onChange={url => edit({ url })}
            ctx={ctx}
            placeholder="{{baseUrl}}/path  —  type a URL or pick a template"
            className="flex-1 h-full font-mono text-[13px]"
            ariaLabel="Request URL"
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.ctrlKey) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        {sending ? (
          <button
            onClick={() => void cancelTab(tab.id)}
            className="h-9 px-3.5 flex items-center gap-1.5 rounded-md bg-red-500 text-white text-[13px] font-semibold hover:brightness-110"
            title="Cancel request"
          >
            <Square className="w-3.5 h-3.5" fill="currentColor" /> Cancel
          </button>
        ) : (
          <button
            onClick={send}
            className="h-9 px-4 flex items-center gap-1.5 rounded-md text-[13px] font-semibold hover:brightness-110 active:scale-95 transition-transform"
            style={{ backgroundColor: spaceColor, color: getReadableTextColor(spaceColor) }}
            title="Send (Ctrl+Enter)"
          >
            <Send className="w-3.5 h-3.5" /> Send
          </button>
        )}
        <button
          onClick={e => setMenu({ x: e.clientX - 180, y: e.clientY + 12 })}
          className="h-9 w-9 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          title="More actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Template banner */}
      {tab.template_name && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-[var(--text-muted)] shrink-0">
          <span>
            From template <span className="font-medium text-[var(--text-secondary)]">{tab.template_name}</span>
            {!template && <span> (deleted)</span>}
          </span>
          {template && modified && (
            <>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-medium">modified</span>
              <button onClick={() => void updateTemplateFromTab(tab.id)} className="hover:text-[var(--text-primary)] underline-offset-2 hover:underline" title="Ctrl+S">
                Update template
              </button>
              <span>·</span>
              <button onClick={() => setSaveTemplateOpen(true)} className="hover:text-[var(--text-primary)] underline-offset-2 hover:underline">
                Save as new
              </button>
            </>
          )}
          <span className="ml-auto opacity-80">This tab is a copy; template changes don't affect it.</span>
        </div>
      )}

      {/* Inputs form (template params) */}
      {request.params.length > 0 && (
        <div className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-hover)] px-3 py-2.5">
          <ParamsForm
            params={request.params}
            values={tab.param_values}
            onChange={(name, value) => setTabParamValue(tab.id, name, value)}
            spaceColor={spaceColor}
            highlightMissing={attempted}
            unused={unused.map(p => p.name)}
          />
          {unused.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Not used in the request, so not sent: <span className="font-mono">{unused.map(p => p.name).join(', ')}</span>. Inputs go only where you write{' '}
                <span className="font-mono">{'{{name}}'}</span>.
              </span>
              <button
                onClick={() => {
                  editTabRequest(tab.id, r => addParamsAsQuery(r, unused));
                  setSection('query');
                }}
                className="px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-medium"
              >
                Add as query params
              </button>
            </div>
          )}
        </div>
      )}

      {/* Request sections + response, vertically split */}
      <div ref={containerRef} className="flex-1 min-h-0 flex flex-col">
        <div className="flex flex-col min-h-0" style={{ height: `${split * 100}%` }}>
          <div className="flex items-center gap-0.5 shrink-0 border-b border-[var(--border-subtle)]" role="tablist">
            {sections.map(s => (
              <button
                key={s.id}
                role="tab"
                aria-selected={section === s.id}
                onClick={() => setSection(s.id)}
                className={`relative px-2.5 py-1.5 text-[12px] font-medium ${section === s.id ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}
              >
                {s.label}
                {s.badge && <span className="ml-1 text-[10px] text-[var(--text-muted)]">{s.badge}</span>}
                {section === s.id && <span className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full" style={{ backgroundColor: spaceColor }} />}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pt-2">
            {section === 'params' && <ParamDefinitions request={request} ctx={ctx} onChange={params => edit({ params })} />}
            {section === 'query' && <KeyValueTable rows={request.query} onChange={query => edit({ query })} ctx={ctx} makeRow={makeKeyValue} keyPlaceholder="Name" />}
            {section === 'headers' && <KeyValueTable rows={request.headers} onChange={headers => edit({ headers })} ctx={ctx} makeRow={makeKeyValue} keyPlaceholder="Header" />}
            {section === 'body' && <BodyEditor body={request.body} onChange={body => edit({ body })} ctx={ctx} tabId={tab.id} spaceColor={spaceColor} />}
            {section === 'auth' && <AuthEditor auth={request.auth} onChange={auth => edit({ auth })} ctx={ctx} />}
          </div>
        </div>

        <div onMouseDown={startResize} className="h-2 shrink-0 cursor-row-resize flex items-center group" role="separator" aria-orientation="horizontal">
          <div className="w-full h-px bg-[var(--border-color)] group-hover:bg-[var(--accent-color)]" />
        </div>

        <div className="flex-1 min-h-0">
          <ResponseViewer stored={tab.response} sending={sending} onCancel={() => void cancelTab(tab.id)} tabId={tab.id} />
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
