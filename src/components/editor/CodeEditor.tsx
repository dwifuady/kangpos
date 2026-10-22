import Editor, { type OnMount } from '@monaco-editor/react';
import { useEffect, useState } from 'react';
import { monacoTheme } from '../../utils/monaco';

interface CodeEditorProps {
  value: string;
  language: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  onMount?: OnMount;
  /** Monaco model path; keep one per tab so undo history doesn't leak between tabs. */
  path?: string;
}

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

export function CodeEditor({ value, language, onChange, readOnly, onMount, path }: CodeEditorProps) {
  const theme = useMonacoTheme();
  return (
    <div className="code-editor-frame h-full w-full min-h-0 border border-[var(--border-color)] rounded-md overflow-hidden">
      <Editor
        value={value}
        language={language}
        path={path}
        theme={theme}
        onChange={v => onChange?.(v ?? '')}
        onMount={onMount}
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
        }}
      />
    </div>
  );
}
