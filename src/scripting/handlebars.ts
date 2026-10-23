// A Handlebars subset for pm.visualizer templates.
//
// Postman renders `pm.visualizer.set(template, data)` with Handlebars. This
// covers the constructs visualizer templates use: `{{value}}` (escaped),
// `{{{value}}}` (raw), `{{#each}}`, `{{#if}}`, `{{#unless}}`, `{{#with}}`,
// `{{else}}`, `{{@index}}` / `{{@key}}` / `{{@first}}` / `{{@last}}`,
// `{{../parent}}` and `{{! comments}}`. Scripts inside the template are not
// run: the result is shown in a sandboxed frame.

type Node =
  | { kind: 'text'; value: string }
  | { kind: 'var'; path: string; raw: boolean }
  | { kind: 'block'; helper: string; arg: string; body: Node[]; otherwise: Node[] };

interface Frame {
  value: unknown;
  parent: Frame | null;
  data: Record<string, unknown>;
}

const TOKEN = /\{\{\{([\s\S]*?)\}\}\}|\{\{([\s\S]*?)\}\}/g;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;', '=': '&#x3D;' };

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"'`=]/g, ch => ESCAPES[ch]);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function truthy(value: unknown): boolean {
  return !isEmpty(value) && value !== 0;
}

function parse(template: string): Node[] {
  const tokens: { text?: string; tag?: string; raw?: boolean }[] = [];
  let last = 0;
  for (const match of template.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: template.slice(last, at) });
    tokens.push({ tag: (match[1] ?? match[2] ?? '').trim().replace(/^~|~$/g, '').trim(), raw: match[1] !== undefined });
    last = at + match[0].length;
  }
  if (last < template.length) tokens.push({ text: template.slice(last) });

  let cursor = 0;
  const parseNodes = (stop: string[]): { nodes: Node[]; stop: string | null } => {
    const nodes: Node[] = [];
    while (cursor < tokens.length) {
      const token = tokens[cursor++];
      if (token.text !== undefined) {
        nodes.push({ kind: 'text', value: token.text });
        continue;
      }
      const tag = token.tag ?? '';
      if (stop.includes(tag.split(/\s+/)[0])) return { nodes, stop: tag.split(/\s+/)[0] };
      if (tag.startsWith('!')) continue;
      if (tag.startsWith('&')) {
        nodes.push({ kind: 'var', path: tag.slice(1).trim(), raw: true });
        continue;
      }
      if (tag.startsWith('#')) {
        const [helper, ...rest] = tag.slice(1).trim().split(/\s+/);
        const parsed = parseNodes(['else', `/${helper}`]);
        let otherwise: Node[] = [];
        if (parsed.stop === 'else') {
          const tail = parseNodes([`/${helper}`]);
          otherwise = tail.nodes;
          if (tail.stop === null) throw new Error(`Missing {{/${helper}}} in the visualizer template`);
        } else if (parsed.stop === null) {
          throw new Error(`Missing {{/${helper}}} in the visualizer template`);
        }
        nodes.push({ kind: 'block', helper, arg: rest.join(' ').trim(), body: parsed.nodes, otherwise });
        continue;
      }
      if (tag.startsWith('/')) throw new Error(`Unexpected {{${tag}}} in the visualizer template`);
      nodes.push({ kind: 'var', path: tag, raw: token.raw === true });
    }
    return { nodes, stop: null };
  };

  return parseNodes([]).nodes;
}

function resolve(path: string, frame: Frame): unknown {
  const text = path.trim();
  if (text === '' || text === '.' || text === 'this') return frame.value;
  if (text === '@root') return rootOf(frame).value;
  if (text.startsWith('@root.')) {
    let value: unknown = rootOf(frame).value;
    for (const key of text.slice(6).split('.')) value = (value as Record<string, unknown> | null | undefined)?.[key];
    return value;
  }
  if (text.startsWith('@')) return frame.data[text.slice(1)];

  let current: Frame | null = frame;
  let rest = text;
  while (rest.startsWith('../')) {
    current = current?.parent ?? null;
    rest = rest.slice(3);
  }
  if (current === null) return undefined;
  if (rest === '' || rest === '.' || rest === 'this') return current.value;

  let value: unknown = current.value;
  for (const key of rest.split('.')) {
    if (value === null || value === undefined) return undefined;
    if (key === 'this') continue;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function rootOf(frame: Frame): Frame {
  let current = frame;
  while (current.parent !== null) current = current.parent;
  return current;
}

function renderNodes(nodes: Node[], frame: Frame): string {
  let out = '';
  for (const node of nodes) {
    if (node.kind === 'text') {
      out += node.value;
      continue;
    }
    if (node.kind === 'var') {
      // Inline helpers: {{lookup object key}}.
      const call = /^([A-Za-z]+)\s+(.+)$/.exec(node.path);
      if (call && call[1] === 'lookup') {
        const [target, rawKey] = call[2].split(/\s+/);
        const key = rawKey?.replace(/^["']|["']$/g, '');
        const value = (resolve(target, frame) as Record<string, unknown> | null | undefined)?.[key];
        out += value === undefined || value === null ? '' : node.raw ? String(value) : escapeHtml(value);
        continue;
      }
      const value = resolve(node.path, frame);
      if (value === undefined || value === null) continue;
      out += node.raw ? String(value) : escapeHtml(value);
      continue;
    }

    const value = resolve(node.arg, frame);
    switch (node.helper) {
      case 'each': {
        const items = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value) : [];
        if (items.length === 0) {
          out += renderNodes(node.otherwise, frame);
          break;
        }
        items.forEach((entry, index) => {
          const isPair = !Array.isArray(value);
          const item = isPair ? (entry as [string, unknown])[1] : entry;
          const key = isPair ? (entry as [string, unknown])[0] : index;
          out += renderNodes(node.body, {
            value: item,
            parent: frame,
            data: { index, key, first: index === 0, last: index === items.length - 1 },
          });
        });
        break;
      }
      case 'if':
        out += renderNodes(truthy(value) ? node.body : node.otherwise, frame);
        break;
      case 'unless':
        out += renderNodes(truthy(value) ? node.otherwise : node.body, frame);
        break;
      case 'with':
        out += renderNodes(value === undefined || value === null ? node.otherwise : node.body, { value, parent: frame, data: frame.data });
        break;
      default:
        throw new Error(`Unknown helper {{#${node.helper}}} in the visualizer template. Supported: each, if, unless, with.`);
    }
  }
  return out;
}

export function renderTemplate(template: string, data?: unknown): string {
  return renderNodes(parse(template), { value: data, parent: null, data: {} });
}
