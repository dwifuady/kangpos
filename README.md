# KangPos

A template-first API client, built on the layout and stack of [Larik SQL Studio](../larik-sql-studio).
"Kang Pos" is Indonesian slang for the postman.

- **Spaces** hold your templates, environments and open requests.
- **New tab = pick a template** (Ctrl+T). Each tab is a copy you fill in, so you can have many
  `Get contact` tabs with different payloads.
- **Params** (`{{id}}`) are filled per tab in a small form; anything else in `{{…}}` comes from the
  active **environment**.
- **Import** Postman collections, Postman environments and OpenAPI 3 / Swagger 2 (JSON or YAML).

See [docs/DESIGN.md](docs/DESIGN.md) for the model and the rules (tabs are snapshots, etc.).

## Run

```bash
npm install
npm run tauri dev
```

Behind a corporate proxy or VPN, cargo on Windows can fail with `CRYPT_E_NO_REVOCATION_CHECK`.
Run it with `CARGO_HTTP_CHECK_REVOKE=false` (set it in your shell profile to make it stick).
`task run` and `task build` already do this.

`npm run dev` alone serves the UI in a normal browser with an in-memory mock backend
(`src/dev/browserMock.ts`), which is handy for UI work. Requests there go through `fetch`, so CORS
applies; the desktop app sends from Rust and has no CORS.

## Test

```bash
npm test                         # vitest: variables, request building, importers
cd src-tauri && cargo test       # storage + HTTP (real loopback server)
```

## Shortcuts

| Keys | Action |
|---|---|
| Ctrl+T / Ctrl+N | New request (template picker) |
| Ctrl+Enter | Send |
| Ctrl+S | Update the tab's template (or save as a template) |
| Ctrl+Shift+S | Save as a new template |
| Ctrl+W | Close tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+L | Focus URL |
| Ctrl+E | Environments |
| Ctrl+B | Toggle sidebar |
| F2 | Rename tab |

## Data

SQLite at `%APPDATA%\kangpos\KangPos\data\kangpos.db`. Environment values marked secret are masked
on screen only; they are stored in plain text in that file.
