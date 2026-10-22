// Turn a RequestSpec + context into what goes on the wire, plus helpers that
// read a request as a whole (placeholders used, tab title, cURL).

import type {
  KeyValue,
  ParamValues,
  RequestSpec,
  SendOptions,
  SendRequestInput,
  Tab,
  TemplateParam,
  WireBody,
} from '../types';
import { extractVariables, paramValue, resolveText, type ResolveContext } from './variables';

export interface BuiltRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body: WireBody;
  /** Placeholders that had no value. */
  unresolved: string[];
}

const CONTENT_TYPES: Record<string, string> = {
  json: 'application/json',
  text: 'text/plain',
  xml: 'application/xml',
  'form-urlencoded': 'application/x-www-form-urlencoded',
};

function enabledRows(rows: KeyValue[]): KeyValue[] {
  return rows.filter(r => r.enabled && r.key.trim() !== '');
}

function hasHeader(headers: [string, string][], name: string): boolean {
  const lower = name.toLowerCase();
  return headers.some(([k]) => k.toLowerCase() === lower);
}

/** Base64 of a UTF-8 string (btoa only takes Latin-1). */
function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Append query pairs to a URL that may already have a query string or fragment. */
export function appendQuery(url: string, pairs: [string, string][]): string {
  if (pairs.length === 0) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const encoded = pairs
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const sep = base.includes('?') ? (base.endsWith('?') || base.endsWith('&') ? '' : '&') : '?';
  return `${base}${sep}${encoded}${hash}`;
}

/** Add a scheme when the user typed a bare host (`localhost:5000/api`). */
export function withScheme(url: string): string {
  const trimmed = url.trim();
  if (trimmed === '' || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function buildRequest(spec: RequestSpec, ctx: ResolveContext): BuiltRequest {
  const unresolved = new Set<string>();
  const r = (text: string) => resolveText(text, ctx, unresolved);

  const headers: [string, string][] = enabledRows(spec.headers).map(h => [r(h.key), r(h.value)]);
  const query: [string, string][] = enabledRows(spec.query).map(q => [r(q.key), r(q.value)]);

  const auth = spec.auth;
  if (auth.type === 'bearer' && auth.token.trim() !== '') {
    if (!hasHeader(headers, 'authorization')) headers.push(['Authorization', `Bearer ${r(auth.token)}`]);
  } else if (auth.type === 'basic') {
    if (!hasHeader(headers, 'authorization')) {
      headers.push(['Authorization', `Basic ${base64Utf8(`${r(auth.username)}:${r(auth.password)}`)}`]);
    }
  } else if (auth.type === 'apikey' && auth.key.trim() !== '') {
    if (auth.in === 'query') query.push([r(auth.key), r(auth.value)]);
    else if (!hasHeader(headers, auth.key)) headers.push([r(auth.key), r(auth.value)]);
  }

  let body: WireBody = { type: 'none' };
  const b = spec.body;
  if (b.type === 'json' || b.type === 'text' || b.type === 'xml') {
    body = { type: 'raw', content: r(b.raw) };
  } else if (b.type === 'form-urlencoded') {
    const content = b.fields
      .filter(f => f.enabled && f.key.trim() !== '')
      .map(f => `${encodeURIComponent(r(f.key))}=${encodeURIComponent(r(f.value))}`)
      .join('&');
    body = { type: 'raw', content };
  } else if (b.type === 'multipart') {
    body = {
      type: 'multipart',
      fields: b.fields
        .filter(f => f.enabled && f.key.trim() !== '')
        .map(f => ({ name: r(f.key), value: r(f.value), kind: f.kind })),
    };
  }
  // reqwest sets the multipart boundary header itself.
  const contentType = CONTENT_TYPES[b.type];
  if (contentType && !hasHeader(headers, 'content-type')) headers.push(['Content-Type', contentType]);

  const url = appendQuery(withScheme(r(spec.url)), query);
  return { method: spec.method, url, headers, body, unresolved: [...unresolved] };
}

export function toSendInput(built: BuiltRequest, requestId: string, options: SendOptions): SendRequestInput {
  return {
    requestId,
    method: built.method,
    url: built.url,
    headers: built.headers,
    body: built.body,
    options,
  };
}

/** All placeholder names used anywhere in a request. */
export function requestVariables(spec: RequestSpec): string[] {
  const parts: string[] = [spec.url, spec.body.raw];
  for (const row of [...spec.query, ...spec.headers, ...spec.body.fields]) parts.push(row.key, row.value);
  const a = spec.auth;
  if (a.type === 'bearer') parts.push(a.token);
  if (a.type === 'basic') parts.push(a.username, a.password);
  if (a.type === 'apikey') parts.push(a.key, a.value);
  return extractVariables(parts.join('\n'));
}

/** Declared params that no {{placeholder}} in the request refers to (so they are never sent). */
export function unusedParams(spec: RequestSpec): TemplateParam[] {
  const used = new Set(requestVariables(spec));
  return spec.params.filter(p => p.name.trim() !== '' && !used.has(p.name));
}

/** Reference each param from the query string: `name={{name}}` rows. */
export function addParamsAsQuery(spec: RequestSpec, params: TemplateParam[]): RequestSpec {
  const rows = params
    .filter(p => !spec.query.some(q => q.key === p.name))
    .map(p => ({ key: p.name, value: `{{${p.name}}}`, enabled: true }));
  return { ...spec, query: [...spec.query, ...rows] };
}

/** First required param with a value, else the first param with a value. */
export function keyParamValue(spec: RequestSpec, values: ParamValues): string | null {
  const filled = spec.params
    .map(p => ({ p, v: paramValue(p, values).trim() }))
    .filter(x => x.v !== '');
  const pick = filled.find(x => x.p.required) ?? filled[0];
  if (!pick) return null;
  return pick.v.length > 32 ? `${pick.v.slice(0, 31)}…` : pick.v;
}

/** Path of a URL without host or query, for blank-tab titles. */
function shortPath(url: string): string {
  const noQuery = url.split(/[?#]/)[0];
  const noScheme = noQuery.replace(/^[a-z]+:\/\//i, '').replace(/^\{\{[^}]+\}\}/, '');
  const path = noScheme.includes('/') ? noScheme.slice(noScheme.indexOf('/')) : noScheme;
  return path || '/';
}

/** Display title: manual rename wins, then `Template · key value`, then `METHOD /path`. */
export function tabTitle(tab: Pick<Tab, 'custom_title' | 'template_name' | 'request' | 'param_values'>): string {
  if (tab.custom_title) return tab.custom_title;
  const key = keyParamValue(tab.request, tab.param_values);
  if (tab.template_name) return key ? `${tab.template_name} · ${key}` : tab.template_name;
  if (tab.request.url.trim() === '') return 'New request';
  return `${tab.request.method} ${shortPath(tab.request.url)}`;
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function toCurl(built: BuiltRequest): string {
  const lines = [`curl -X ${built.method} ${shellQuote(built.url)}`];
  for (const [k, v] of built.headers) lines.push(`  -H ${shellQuote(`${k}: ${v}`)}`);
  if (built.body.type === 'raw' && built.body.content !== '') {
    lines.push(`  --data-raw ${shellQuote(built.body.content)}`);
  } else if (built.body.type === 'multipart') {
    for (const f of built.body.fields) {
      lines.push(`  -F ${shellQuote(f.kind === 'file' ? `${f.name}=@${f.value}` : `${f.name}=${f.value}`)}`);
    }
  }
  return lines.join(' \\\n');
}
