export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Pretty-print JSON when the text parses; otherwise return it unchanged. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Monaco language id for a response content type. */
export function languageFor(contentType: string | null, body: string): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('json') || /^\s*[[{]/.test(body)) return 'json';
  if (ct.includes('html')) return 'html';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('javascript')) return 'javascript';
  if (ct.includes('css')) return 'css';
  return 'plaintext';
}

export const METHOD_COLORS: Record<string, string> = {
  GET: '#22c55e',
  POST: '#f59e0b',
  PUT: '#3b82f6',
  PATCH: '#a78bfa',
  DELETE: '#ef4444',
  HEAD: '#14b8a6',
  OPTIONS: '#ec4899',
};

export function statusColor(status: number): string {
  if (status >= 500) return '#ef4444';
  if (status >= 400) return '#f97316';
  if (status >= 300) return '#3b82f6';
  if (status >= 200) return '#22c55e';
  return 'var(--text-muted)';
}

/** Format JSON while leaving {{placeholders}} (which may sit outside quotes) intact. */
export function formatJsonWithPlaceholders(text: string): string | null {
  // Placeholders inside strings are masked as bare text; outside strings
  // (e.g. `"age": {{age}}`) they become a string value so the JSON parses.
  const tokens: string[] = [];
  let masked = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' && text[i + 1] === '{') {
      const end = text.indexOf('}}', i + 2);
      if (end > 0) {
        tokens.push(text.slice(i, end + 2));
        const id = tokens.length - 1;
        masked += inString ? `__kpi_${id}__` : `"__kpo_${id}__"`;
        i = end + 1;
        continue;
      }
    }
    if (ch === '"') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) backslashes++;
      if (backslashes % 2 === 0) inString = !inString;
    }
    masked += ch;
  }
  try {
    return JSON.stringify(JSON.parse(masked), null, 2)
      .replace(/"__kpo_(\d+)__"/g, (_m, i: string) => tokens[Number(i)])
      .replace(/__kpi_(\d+)__/g, (_m, i: string) => tokens[Number(i)]);
  } catch {
    return null;
  }
}
