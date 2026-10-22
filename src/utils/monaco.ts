// Bundle Monaco locally (no CDN) so the editor works offline inside Tauri.
// Only the editor core and the languages an API client needs are included.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import * as jsonLanguage from 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import { placeholderPrefix, variableSuggestions, type ResolveContext } from './variables';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

// Monaco's own JSON validation flags every {{placeholder}}; request bodies are
// checked by our placeholder-aware validator instead (see CodeEditor).
(jsonLanguage as unknown as { jsonDefaults: { setDiagnosticsOptions(o: { validate: boolean }): void } }).jsonDefaults.setDiagnosticsOptions({
  validate: false,
});

/** Monaco theme that follows the app theme. */
export function monacoTheme(): string {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'vs' : 'vs-dark';
}

// The focused body editor supplies the variables to complete.
let completionContext: (() => ResolveContext | null) | null = null;

export function setCompletionContext(get: (() => ResolveContext | null) | null): void {
  completionContext = get;
}

const KIND = {
  param: monaco.languages.CompletionItemKind.Field,
  env: monaco.languages.CompletionItemKind.Variable,
  dynamic: monaco.languages.CompletionItemKind.Function,
};
const LABEL = { param: 'input', env: 'environment', dynamic: 'dynamic' };

for (const language of ['json', 'plaintext', 'xml']) {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: ['{'],
    provideCompletionItems(model, position) {
      const ctx = completionContext?.();
      if (!ctx) return { suggestions: [] };
      const line = model.getLineContent(position.lineNumber);
      const prefix = placeholderPrefix(line.slice(0, position.column - 1));
      if (prefix === null) return { suggestions: [] };
      // Also replace an existing `name}}` after the caret (e.g. auto-closed braces).
      const rest = /^[^{}\s]*\}\}/.exec(line.slice(position.column - 1));
      const range = new monaco.Range(
        position.lineNumber,
        position.column - prefix.length,
        position.lineNumber,
        position.column + (rest ? rest[0].length : 0),
      );
      return {
        suggestions: variableSuggestions(ctx, prefix).map((s, i) => ({
          label: { label: s.name, description: s.preview },
          kind: KIND[s.source],
          detail: LABEL[s.source],
          insertText: `${s.name}}}`,
          filterText: s.name,
          sortText: String(i).padStart(4, '0'),
          range,
        })),
      };
    },
  });
}
