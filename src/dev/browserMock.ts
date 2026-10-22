// In-memory stand-in for the Rust backend, used only when the frontend runs in a
// plain browser (`npm run dev` without Tauri) so the UI can be previewed.
// HTTP requests go through fetch(), so they are subject to the browser's CORS rules.

import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { base64ToBytes, bytesToBase64 } from '../utils/binary';

type Row = Record<string, unknown> & { id: string };

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

export function installBrowserMock(): void {
  mockWindows('main');

  const spaces: Row[] = [];
  const environments: Row[] = [];
  const templates: Row[] = [];
  const tabs: Row[] = [];
  const appState: Record<string, unknown> = {};
  const controllers = new Map<string, AbortController>();

  // Seed one space so the preview isn't empty.
  const spaceId = id();
  spaces.push({ id: spaceId, name: 'Preview', color: '#93C5FD', active_environment_id: null, sort_order: 0, created_at: now(), updated_at: now() });

  const patch = (row: Row | undefined, input: Record<string, unknown>) => {
    if (!row) throw { code: 'NotFound', message: 'not found' };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) row[k] = v;
    row.updated_at = now();
    return { ...row };
  };

  mockIPC(async (cmd, raw) => {
    const args = (raw ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (cmd) {
      case 'is_mica_enabled':
        return false;
      case 'plugin:window|is_maximized':
        return true;
      case 'list_spaces':
        return spaces.map(s => ({ ...s }));
      case 'create_space': {
        const row = { id: id(), name: args.name, color: args.color, active_environment_id: null, sort_order: spaces.length, created_at: now(), updated_at: now() };
        spaces.push(row);
        return { ...row };
      }
      case 'update_space':
        return patch(spaces.find(s => s.id === args.id), args.input);
      case 'delete_space':
        spaces.splice(spaces.findIndex(s => s.id === args.id), 1);
        return null;
      case 'list_environments':
        return environments.filter(e => e.space_id === args.spaceId).map(e => ({ ...e }));
      case 'create_environment': {
        const row = { id: id(), space_id: args.spaceId, name: args.name, variables: args.variables, sort_order: environments.length, created_at: now(), updated_at: now() };
        environments.push(row);
        return { ...row };
      }
      case 'update_environment':
        return patch(environments.find(e => e.id === args.id), args.input);
      case 'delete_environment':
        environments.splice(environments.findIndex(e => e.id === args.id), 1);
        return null;
      case 'list_templates':
        return templates.filter(t => t.space_id === args.spaceId).map(t => ({ ...t }));
      case 'create_templates':
        return args.inputs.map((input: Row, i: number) => {
          const row = { ...input, id: id(), sort_order: i, created_at: now(), updated_at: now() };
          templates.push(row);
          return { ...row };
        });
      case 'update_template':
        return patch(templates.find(t => t.id === args.id), args.input);
      case 'delete_template':
        templates.splice(templates.findIndex(t => t.id === args.id), 1);
        return null;
      case 'list_tabs':
        return tabs.filter(t => t.space_id === args.spaceId).map(t => ({ ...t }));
      case 'create_tab': {
        const row = { ...args.input, id: id(), custom_title: null, response: null, is_pinned: false, sort_order: tabs.length, created_at: now(), updated_at: now() };
        tabs.push(row);
        return { ...row };
      }
      case 'update_tab':
        return patch(tabs.find(t => t.id === args.id), args.input);
      case 'delete_tab':
        tabs.splice(tabs.findIndex(t => t.id === args.id), 1);
        return null;
      case 'get_app_state':
        return { ...appState };
      case 'set_app_state':
        appState[args.key] = args.value;
        return null;
      case 'cancel_request':
        controllers.get(args.requestId)?.abort();
        return true;
      case 'send_request': {
        const input = args.input;
        const controller = new AbortController();
        controllers.set(input.requestId, controller);
        const started = performance.now();
        try {
          const res = await fetch(input.url, {
            method: input.method,
            headers: input.headers,
            body: input.body.type === 'raw' ? input.body.content : undefined,
            signal: controller.signal,
          });
          const bytes = new Uint8Array(await res.arrayBuffer());
          let body: string | null = null;
          try {
            body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            body = null; // not UTF-8: hand it back as base64, like the Rust side
          }
          return {
            status: res.status,
            statusText: res.statusText,
            httpVersion: 'HTTP/1.1',
            headers: [...res.headers.entries()],
            body,
            bodyBase64: body === null ? bytesToBase64(bytes) : null,
            contentType: res.headers.get('content-type'),
            sizeBytes: bytes.length,
            durationMs: Math.round(performance.now() - started),
            truncated: false,
            finalUrl: res.url,
          };
        } catch (e) {
          throw { code: 'Http', message: `Browser preview: ${(e as Error).message} (CORS applies here; the desktop app has no CORS)` };
        } finally {
          controllers.delete(input.requestId);
        }
      }
      case 'save_response_file': {
        // Browser preview: download instead of writing to the chosen path.
        const name = String(args.path).split(/[\\/]/).pop() || 'response';
        const url = URL.createObjectURL(new Blob([base64ToBytes(args.base64) as BlobPart]));
        const a = Object.assign(document.createElement('a'), { href: url, download: name });
        a.click();
        URL.revokeObjectURL(url);
        return null;
      }
      case 'plugin:dialog|save':
        return args.options?.defaultPath ?? 'response';
      case 'read_import_file':
        throw { code: 'Validation', message: 'File access is not available in the browser preview; paste the content instead' };
      default:
        // Window/dialog plugin calls: no-ops in the preview.
        return null;
    }
  });
}
