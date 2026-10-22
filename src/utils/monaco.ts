// Bundle Monaco locally (no CDN) so the editor works offline inside Tauri.
// Only the editor core and the languages an API client needs are included.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

/** Monaco theme that follows the app theme. */
export function monacoTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark';
}
