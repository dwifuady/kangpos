# KangPos — design

KangPos is an API client built on Larik SQL Studio's layout and stack. Name: "Kang Pos", Indonesian slang for the postman.

It keeps Larik's model of **workspaces → tabs**, but a new tab starts from a **template** instead of a database.

## Core idea

| Concept | What it is |
|---|---|
| **Space** | A workspace (same as Larik). Owns its templates, environments and tabs. Has a colour. |
| **Template** | A reusable request definition: method, URL, headers, query, body, auth, and **declared params** (name, default, required, description). Grouped by folder. |
| **Tab** | One use of a template: a full copy of the template's request plus the values the user typed in. |
| **Environment** | Named set of variables per space (`baseUrl`, `token`, …). One is active per space. |

### Rules

1. **A tab is a copy.** Editing a tab never changes its template. The template changes only through explicit actions:
   - **Update template** (Ctrl+S, when the tab came from a template)
   - **Save as new template**
2. **A tab is a snapshot.** It copies the template when it is created. Later template edits do not reach existing tabs.
3. **Two kinds of placeholder, one syntax: `{{name}}`.**
   - If `name` is one of the tab's **declared params**, the value comes from the tab's params form.
   - Otherwise it comes from the active **environment**.
   - Postman dynamic variables are supported: `{{$guid}}`, `{{$randomUUID}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`.
   - The editor colours them differently: params in the space colour, env vars in blue, unresolved names in red.
4. **Inputs form.** Declared params show as a form at the top of the tab. Send is blocked while a required one is empty.
   - The UI calls them **Inputs**, not "Params", because Postman's "Params" means query parameters. An input is only sent where a `{{name}}` refers to it.
   - An input is free text or a **dropdown** (`type: 'select'` with `options`). An empty dropdown means "use the default"; a required dropdown with no default must be picked before Send.
   - Inputs that nothing refers to are tagged *unused*, and a warning offers **Add as query params** (adds `name={{name}}` rows). Send also shows a toast for unused inputs that have values.
5. **Autocomplete.** Typing `{{` in any field (URL, query, headers, auth, body) suggests inputs, then environment variables, then dynamic values, each with its current value. Secret values are masked.
   - Values are inserted as plain text, so a JSON string needs quotes: `"nama": "{{nama}}"`. Numbers and booleans can go bare: `"jumlah": {{jumlah}}`.
   - The body's JSON check accepts placeholders in both positions. If the body is no longer valid JSON once values are filled in, Send shows a warning (and still sends).
6. **Tab names come from the template plus a key value,** e.g. `Get contact · 10045`. The key value is the first required param that has a value, or else the first param that has one. Renaming a tab by hand (double-click) pins its title.
7. **The template picker is a command palette.** Ctrl+T / Ctrl+N → type to filter → Enter. **Blank request** is always the first option.
8. **No collection tree.** Templates are grouped by `folder` (a path such as `Contacts / Admin`) in the picker and in the sidebar's Templates view.

## Import

| Source | Result |
|---|---|
| Postman collection v2.0/v2.1 (JSON) | One template per request. Folder = item path. Path variables (`:id`) become params. Collection/folder auth is inherited. Collection variables become an environment. |
| Postman environment (JSON) | One environment. `secret` values are kept, but masked in the UI. |
| OpenAPI 3.x / Swagger 2.0 (JSON or YAML) | One template per operation. Folder = first tag. `{{baseUrl}}` + path, with `{id}` turned into `{{id}}`. Path params and required query/header params become required params; an `enum` makes them dropdowns (left unselected unless the spec declares a default or example). The JSON body is generated from the schema (example → default → enum → type), and required top-level string fields become params. Security schemes map to auth with env vars. An environment named after the API gets `baseUrl` from `servers[0]` plus the auth variables. |

Unsupported pieces (Postman pre-request/test scripts, file uploads in Postman collections, etc.) are reported as warnings after an import, never silently dropped.

## Architecture

Same stack as Larik: **Tauri 2 + Rust**, **React 19 + TypeScript + Vite**, **Tailwind 4**, **Zustand** (slices), **Monaco**, **SQLite** (`rusqlite`).

- **Rust is thin.** It handles SQLite persistence, sends HTTP (`reqwest` + rustls, so there's no CORS, and each request can set a timeout, redirect policy and TLS verification), handles cancellation, and reads files for import (with a size limit).
- **TypeScript owns request semantics:** variable resolution, auth → headers, URL-encoded bodies, importers, cURL export. These are pure functions with unit tests.
- Request definitions are stored as one JSON column (`request`) on templates and tabs, so the request shape can change without SQLite migrations.

### Storage (SQLite, `%APPDATA%/com.kangpos.app/kangpos.db`)

```
spaces(id, name, color, active_environment_id, sync_dir NULL, sort_order, created_at, updated_at)
environments(id, space_id, name, variables JSON, file_path NULL, sort_order, created_at, updated_at)
templates(id, space_id, name, folder, request JSON, file_path NULL, sort_order, created_at, updated_at)
tabs(id, space_id, template_id NULL, template_name NULL, custom_title NULL,
     request JSON, param_values JSON, response JSON NULL, is_pinned, sort_order, created_at, updated_at)
app_state(key, value)            -- last space, last tab, theme, sidebar width
```

`template_id` is kept only for "Update template". If the template has been deleted, the tab still works.

### RequestSpec (JSON)

```ts
{
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
  url: string,                                  // may contain {{vars}}
  query:   { key, value, enabled }[],
  headers: { key, value, enabled }[],
  body: { type: 'none' | 'json' | 'text' | 'xml' | 'form-urlencoded' | 'multipart',
          raw: string, fields: { key, value, enabled, kind: 'text' | 'file' }[] },
  auth: { type: 'none' } | { type: 'bearer', token } | { type: 'basic', username, password }
      | { type: 'apikey', key, value, in: 'header' | 'query' },
  params: { name, default, required, description, type?: 'text' | 'select', options?: string[] }[],
  scripts: { before: string, after: string },   // JavaScript, Postman-style pm API
}
```

### Send flow

1. Resolve `{{vars}}` everywhere (params → env → dynamic).
2. Apply auth (adds a header or a query entry).
3. Build the final URL (base URL + enabled query rows) and the body (`form-urlencoded` is encoded in TS; `multipart` is sent as fields to Rust).
4. `send_request` in Rust → `{ status, statusText, headers, body | bodyBase64, size, durationMs }`.
5. The response is saved on the tab. Bodies over 2 MB are truncated in storage only.

## Scripts (before request / after response)

Each request has two optional JavaScript scripts, edited in the **Scripts** section. They are part of the template, so they're shared through folder sync and copied into each tab. The API is the commonly used subset of Postman's `pm`:

| | |
|---|---|
| `pm.environment` / `pm.collectionVariables` / `pm.globals` | get, set, unset, has, toObject, replaceIn. All three map to the active environment; changes are saved to it. |
| `pm.variables` | get (local → input → environment), set (this send only, wins over everything), replaceIn |
| `pm.request` | method, url (+ `url.query`), headers (add, upsert, remove, get), body.raw. Editable in before scripts; read-only (what was sent) in after scripts. |
| `pm.response` | code, status, headers, json(), text(), responseTime, responseSize, `to.have.status/header/jsonBody`, `to.be.ok/success/clientError/serverError/json` |
| `pm.test`, `pm.expect` | sync or async tests; chai-style assertions (equal, eql, a/an, include, property, lengthOf, above/below, match, oneOf, not, ...) |
| `pm.sendRequest` | callback or `await`; goes through the Rust HTTP client (no CORS) and is logged in the console |
| also | `console.*`, legacy `postman.setEnvironmentVariable`, `tests["name"] = bool`, `responseBody`, `responseCode` |

- **Order:** before script → `{{placeholders}}` resolved (script locals first) → send → after script. A before-script error means the request is **not sent**.
- **Sandbox:** each run gets a fresh Web Worker (`src/scripting/worker.ts`). Workers can't reach the app's Tauri bridge, and the worker deletes `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, storage APIs, etc. before running code, so `pm.sendRequest` is the only way out. Each run has a 10 s limit (time waiting on `pm.sendRequest` doesn't count). There's no `require()`; `crypto` (Web Crypto), `btoa`/`atob` and `TextEncoder` are available.
- **Results** go on the tab's last response: a **Tests** view (pass/fail, badge `Tests 2/3`) and a **Console** view with output from both scripts.
- **Postman import** brings scripts across: collection → folder → request, each block labelled `// From collection "X"`. Features KangPos lacks (`require`, `pm.cookies`, `pm.visualizer`, `setNextRequest`, ...) are reported as import warnings.
- **Trust (folder-synced spaces only):** a script runs without asking if this exact text was approved before. Scripts typed in the app, present when the folder was linked, or imported here are approved automatically. Anything new or changed through the folder (e.g. `git pull`) shows a prompt with the code: run it, trust the whole space, send without scripts, or cancel. Approvals are SHA-256 hashes in local app state, never in the folder.

## Folder sync (optional, per space)

By default everything lives in SQLite. A space can be **linked to a folder** (space dialog → *Link to folder…*) so its templates and environments are kept as YAML files that can live in git. This works like Yaak's directory sync.

| In the folder (shared) | Only in SQLite (personal) |
|---|---|
| Templates, environments (non-secret values), space name and colour | Tabs, filled-in inputs, responses, secret values, UI state |

```
kangpos.yaml                     kangpos: 1, name, color
Contacts/Admin/get-contact.yaml  one file per template; directories = template folder
environments/dev.yaml            one file per environment; secret values left out
```

- **Once linked, the folder is the source of truth** and SQLite is a cache. Rust (`src-tauri/src/sync.rs`) watches the folder (`notify`, 400 ms debounce), reloads what changed and emits `kangpos://sync`. The UI then reloads templates and environments. Open tabs are snapshots, so a `git pull` never changes them.
- **Writes go both ways under one lock:** a change in the app updates SQLite, then writes the file (temp file + rename). Renaming or moving a template moves its file and removes empty folders. Reloading after our own write finds nothing to change, so there is no echo loop.
- **Stable diffs:** fixed key order, empty values left out (`body`/`auth` of type none, empty lists), JSON bodies written as `|-` blocks. Number-looking strings stay quoted; hand-written `value: 123` is read back as a string.
- **Ids live in the files**, so renaming a file doesn't break a tab's "Update template". A hand-written file without an `id` gets one written back. Duplicate ids, or ids used by another space, are reported per file.
- **Nothing is lost on bad files:** a file that doesn't parse (e.g. a merge conflict) is listed in the space's sync status, and its template keeps the last good version. Only a file that is gone deletes its template. A missing folder only shows a warning.
- **Secrets:** environment variables marked secret are written without a value. On reload, the local value is kept.
- **Commands:** link (writes everything out; refuses a folder that already has `kangpos.yaml` or is linked to another space), open workspace folder (a clone with `kangpos.yaml` becomes a new space), unlink (keeps everything in SQLite, leaves the files), reload.

## MVP scope

- Spaces (create, rename, recolour, delete, switch)
- Environments (CRUD, active per space, editor modal)
- Templates (picker, sidebar list grouped by folder, rename/move/delete, save/update from tab)
- Tabs (create from template/blank, params form, autosave, rename, pin, close, restore on restart)
- Request editor: method + URL bar, Params / Query / Headers / Body / Auth sections
- Response viewer: status, time, size, pretty body (Monaco), headers
- Import: Postman collection, Postman environment, OpenAPI 3 / Swagger 2 (JSON/YAML)
- Copy as cURL
- Shortcuts: Ctrl+T/N (picker), Ctrl+Enter (send), Ctrl+S (update/save template), Ctrl+W (close tab), Ctrl+Tab / Ctrl+Shift+Tab

## Later

- Request history per tab
- Space-level scripts that run before every request (Postman's collection-level scripts)
- Autocomplete for `pm.` in the script editor
- Export to Postman collection / OpenAPI
- Bulk run: one template × rows of params (CSV)
- Secrets in the OS keychain (Larik already does this for passwords)
