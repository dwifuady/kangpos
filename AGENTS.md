# KangPos — agent guide

Template-first API client. Tauri 2 + Rust backend, React 19 + TypeScript + Vite + Tailwind 4 +
Zustand frontend. Layout and visual language come from Larik SQL Studio
(`../larik-sql-studio`); keep them in step (see Larik's `DESIGN.md` / `PRODUCT.md`).

Read `docs/DESIGN.md` first. The rules that matter most:

1. A tab is a **copy** of its template; it never edits the template except through
   "Update template" / "Save as new template".
2. A tab is a **snapshot**; template edits never reach existing tabs.
3. `{{name}}` is a tab param if declared in `request.params`, otherwise an environment variable.

## Layout

- `src-tauri/src/storage.rs` — SQLite (spaces, environments, templates, tabs, app_state).
  Request specs are JSON columns owned by the frontend.
- `src-tauri/src/http.rs` — sends an already-resolved request with reqwest; cancel by request id.
- `src-tauri/src/commands.rs` — Tauri commands; errors are `{ code, message }`.
- `src/utils/variables.ts`, `src/utils/request.ts` — placeholder resolution, auth, bodies, cURL,
  tab titles. Pure and unit-tested.
- `src/utils/importers/` — Postman collection/environment and OpenAPI/Swagger importers. Anything
  not carried over must be reported in `warnings`, never dropped silently.
- `src/store/slices/` — `workspaceSlice` (spaces, envs, templates), `tabsSlice` (tabs, autosave,
  send), `uiSlice`.
- `src/dev/browserMock.ts` — in-memory backend for `npm run dev` in a plain browser.

## Checks before committing

```bash
npx tsc --noEmit && npx eslint src && npx vitest run
cd src-tauri && cargo test && cargo clippy
```

Keep the Tauri npm packages on the same minor version as the Rust crates in `Cargo.lock`
(`tauri dev` warns otherwise).
