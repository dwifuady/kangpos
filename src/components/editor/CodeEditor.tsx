import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { monacoTheme, setCompletionContext } from '../../utils/monaco';
import { checkJsonWithPlaceholders } from '../../utils/format';
import { classifyVariable, previewValue, type ResolveContext } from '../../utils/variables';

type Monaco = Parameters<OnMount>[1];

interface CodeEditorProps {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onMount?: OnMount;
  /** Monaco model path; keep one per tab so undo history doesn't leak between tabs. */
  path?: string;
  /** Enables {{variable}} highlighting, hovers and `{{` autocomplete. */
  variables?: ResolveContext;
  /** Validate as JSON, allowing {{placeholders}}. */
  checkJson?: boolean;
}

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Follow the app theme (data-theme on <html>). */
function useMonacoTheme(): string {
  const [theme, setTheme] = useState(monacoTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(monacoTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function CodeEditor({ value, language, onChange, readOnly, onMount, path, variables, checkJson }: CodeEditorProps) {
  const theme = useMonacoTheme();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const variablesRef = useRef(variables);
  variablesRef.current = variables;
  const [mounted, setMounted] = useState(0);

  // Colour placeholders, add hovers, and mark JSON errors.
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    const model = ed?.getModel();
    if (!ed || !monaco || !model) return;
    const text = model.getValue();

    if (variables) {
      const decorations: editor.IModelDeltaDecoration[] = [];
      for (const m of text.matchAll(PLACEHOLDER)) {
        const name = m[1];
        const start = model.getPositionAt(m.index!);
        const end = model.getPositionAt(m.index! + m[0].length);
        const source = classifyVariable(name, variables);
        decorations.push({
          range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
          options: {
            inlineClassName: `var-${source}`,
            hoverMessage: {
              value:
                source === 'unresolved'
                  ? `\`${name}\` is not an input or a variable in the active environment`
                  : `\`${name}\` (${source === 'param' ? 'input' : source === 'env' ? 'environment' : 'dynamic'}) = \`${previewValue(name, variables)}\``,
            },
          },
        });
      }
      if (decorationsRef.current) decorationsRef.current.set(decorations);
      else decorationsRef.current = ed.createDecorationsCollection(decorations);
    }

    if (checkJson) {
      const problem = checkJsonWithPlaceholders(text);
      const markers: editor.IMarkerData[] = [];
      if (problem) {
        const pos = model.getPositionAt(problem.offset);
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          message: problem.message,
          startLineNumber: pos.lineNumber,
          startColumn: pos.column,
          endLineNumber: pos.lineNumber,
          endColumn: pos.column + 1,
        });
      }
      monaco.editor.setModelMarkers(model, 'kangpos-json', markers);
    } else {
      monaco.editor.setModelMarkers(model, 'kangpos-json', []);
    }
  }, [value, variables, checkJson, mounted, path]);

  // Hand our variables to the shared completion provider while focused.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !variables) return;
    const getter = () => variablesRef.current ?? null;
    const focus = ed.onDidFocusEditorText(() => setCompletionContext(getter));
    if (ed.hasTextFocus()) setCompletionContext(getter);
    return () => focus.dispose();
  }, [mounted, variables]);

  return (
    <div className="code-editor-frame h-full w-full min-h-0 border border-[var(--border-color)] rounded-md overflow-hidden">
      <Editor
        value={value}
        language={language}
        path={path}
        theme={theme}
        onChange={v => onChange?.(v ?? '')}
        onMount={(ed, monaco) => {
          editorRef.current = ed;
          monacoRef.current = monaco;
          decorationsRef.current = null;
          setMounted(n => n + 1);
          onMount?.(ed, monaco);
        }}
        loading={<div className="p-3 text-xs text-[var(--text-muted)]">Loading editor…</div>}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          automaticLayout: true,
          tabSize: 2,
          renderLineHighlight: readOnly ? 'none' : 'line',
          folding: true,
          padding: { top: 8, bottom: 8 },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          fixedOverflowWidgets: true,
          quickSuggestions: variables ? { other: true, strings: true, comments: false } : false,
          suggest: { showWords: false },
        }}
      />
    </div>
  );
}
