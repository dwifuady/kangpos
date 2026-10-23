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
  const folders: Row[] = [];
  const tabs: Row[] = [];
  const appState: Record<string, unknown> = {};
  const controllers = new Map<string, AbortController>();

  // Seed one space so the preview isn't empty.
  const spaceId = id();
  spaces.push({ id: spaceId, name: 'Preview', color: '#93C5FD', active_environment_id: null, sync_dir: null, sort_order: 0, created_at: now(), updated_at: now() });

  const patch = (row: Row | undefined, input: Record<string, unknown>) => {
    if (!row) throw { code: 'NotFound', message: 'not found' };
    for (const [k, v] of Object.entries(input)) if (v !== undefined) row[k] = v;
    row.updated_at = now();
    return { ...row };
  };

  // Folder paths match the Rust side: `Contacts / Admin`.
  const normPath = (path: string) =>
    String(path ?? '')
      .replace(/\\/g, '/')
      .split('/')
      .map(s => s.trim())
      .filter(s => s && s !== '.' && s !== '..')
      .join(' / ');

  const folderList = (spaceId: string) =>
    folders
      .filter(f => f.space_id === spaceId)
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number) || String(a.path).localeCompare(String(b.path)));

  const ensureFolders = (spaceId: string, path: string) => {
    const parts = path.split(' / ').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const current = parts.slice(0, i).join(' / ');
      if (folders.some(f => f.space_id === spaceId && f.path === current)) continue;
      const next = folderList(spaceId).reduce((max, f) => Math.max(max, (f.sort_order as number) + 1), 0);
      folders.push({ id: id(), space_id: spaceId, path: current, sort_order: next, created_at: now(), updated_at: now() });
    }
  };

  const listTemplatesFor = (spaceId: string) =>
    templates
      .filter(t => t.space_id === spaceId)
      .sort(
        (a, b) =>
          String(a.folder).localeCompare(String(b.folder)) ||
          (a.sort_order as number) - (b.sort_order as number) ||
          String(a.name).localeCompare(String(b.name)),
      )
      .map(t => ({ ...t }));

  const layout = (spaceId: string) => ({
    folders: folderList(spaceId).map(f => ({ ...f })),
    templates: listTemplatesFor(spaceId),
  });

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
        const row = { id: id(), name: args.name, color: args.color, active_environment_id: null, sync_dir: null, sort_order: spaces.length, created_at: now(), updated_at: now() };
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
        return listTemplatesFor(args.spaceId);
      case 'create_templates':
        return args.inputs.map((input: Row, i: number) => {
          const folder = normPath(String(input.folder ?? ''));
          if (folder) ensureFolders(String(input.space_id), folder);
          const row = { ...input, folder, id: id(), sort_order: i, created_at: now(), updated_at: now() };
          templates.push(row);
          return { ...row };
        });
      case 'update_template': {
        const row = templates.find(t => t.id === args.id);
        if (!row) throw { code: 'NotFound', message: 'not found' };
        const input = { ...args.input };
        if (typeof input.folder === 'string') {
          input.folder = normPath(input.folder);
          if (input.folder) ensureFolders(String(row.space_id), input.folder);
        }
        return patch(row, input);
      }
      case 'delete_template':
        templates.splice(templates.findIndex(t => t.id === args.id), 1);
        return null;
      case 'list_template_folders':
        return folderList(args.spaceId).map(f => ({ ...f }));
      case 'create_template_folder': {
        const path = normPath(args.path);
        if (!path) throw { code: 'Validation', message: 'Folder name is required' };
        if (folders.some(f => f.space_id === args.spaceId && f.path === path))
          throw { code: 'Validation', message: `Folder "${path}" already exists` };
        ensureFolders(args.spaceId, path);
        return layout(args.spaceId);
      }
      case 'rename_template_folder': {
        const folder = folders.find(f => f.id === args.id);
        if (!folder) throw { code: 'NotFound', message: 'Folder not found' };
        const space = String(folder.space_id);
        const old = String(folder.path);
        const next = normPath(args.path);
        if (!next) throw { code: 'Validation', message: 'Folder name is required' };
        if (next === old) return layout(space);
        if (next.startsWith(`${old} / `))
          throw { code: 'Validation', message: 'A folder cannot be moved inside itself' };
        if (folders.some(f => f.space_id === space && f.path === next))
          throw { code: 'Validation', message: `Folder "${next}" already exists` };
        const affected = folders.filter(
          f => f.space_id === space && (f.path === old || String(f.path).startsWith(`${old} / `)),
        );
        const moving = new Set(affected.map(f => f.id));
        const nextPaths = affected.map(f => next + String(f.path).slice(old.length));
        if (folders.some(f => f.space_id === space && !moving.has(f.id) && nextPaths.includes(String(f.path))))
          throw { code: 'Validation', message: `Folder "${next}" already exists` };
        const parent = next.split(' / ').slice(0, -1).join(' / ');
        if (parent) ensureFolders(space, parent);
        for (const f of affected) {
          f.path = next + String(f.path).slice(old.length);
          f.updated_at = now();
        }
        for (const t of templates) {
          if (t.space_id !== space) continue;
          const tf = String(t.folder);
          if (tf === old || tf.startsWith(`${old} / `)) {
            t.folder = next + tf.slice(old.length);
            t.updated_at = now();
          }
        }
        return layout(space);
      }
      case 'delete_template_folder': {
        const folder = folders.find(f => f.id === args.id);
        if (!folder) throw { code: 'NotFound', message: 'Folder not found' };
        const space = String(folder.space_id);
        const path = String(folder.path);
        if (folders.some(f => f.space_id === space && f.id !== folder.id && String(f.path).startsWith(`${path} / `)))
          throw { code: 'Validation', message: 'Folder has subfolders; delete them first' };
        if (templates.some(t => t.space_id === space && t.folder === path))
          throw { code: 'Validation', message: 'Folder still holds templates; move or delete them first' };
        folders.splice(folders.indexOf(folder), 1);
        return layout(space);
      }
      case 'arrange_template_folders': {
        const listed: string[] = args.paths ?? [];
        const all = folderList(args.spaceId);
        const ordered = [
          ...listed.map(p => all.find(f => f.path === p)).filter((f): f is Row => !!f),
          ...all.filter(f => !listed.includes(String(f.path))),
        ];
        ordered.forEach((f, i) => {
          f.sort_order = i;
          f.updated_at = now();
        });
        return layout(args.spaceId);
      }
      case 'arrange_templates':
        for (const item of args.items ?? []) {
          const row = templates.find(t => t.id === item.id);
          if (!row) continue;
          const folder = normPath(item.folder);
          if (folder) ensureFolders(String(row.space_id), folder);
          row.folder = folder;
          row.sort_order = item.sort_order;
          row.updated_at = now();
        }
        return layout(args.spaceId);
      case 'list_tabs':
        return tabs
          .filter(t => t.space_id === args.spaceId)
          .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || (b.sort_order as number) - (a.sort_order as number))
          .map(t => ({ ...t }));
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
      case 'reorder_tabs': {
        const count = (args.ids as string[]).length;
        (args.ids as string[]).forEach((tabId, i) => {
          const row = tabs.find(t => t.id === tabId && t.space_id === args.spaceId);
          if (row) row.sort_order = count - i;
        });
        return null;
      }
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
      case 'get_sync_status':
        return null;
      case 'link_space_folder':
      case 'open_workspace_folder':
      case 'reload_space_folder':
        throw { code: 'Validation', message: 'Folder sync needs the desktop app (no file system in the browser preview)' };
      case 'unlink_space_folder':
        return patch(spaces.find(s => s.id === args.spaceId), { sync_dir: null });
      case 'read_import_file':
        throw { code: 'Validation', message: 'File access is not available in the browser preview; paste the content instead' };
      default:
        // Window/dialog plugin calls: no-ops in the preview.
        return null;
    }
  });
}
