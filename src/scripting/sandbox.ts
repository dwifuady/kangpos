// The Postman-style `pm` API that before/after scripts run against.
//
// This module is plain TypeScript with no DOM or Tauri access. It runs inside a
// Web Worker (see worker.ts), which also removes network globals, so a script
// can only reach the outside world through pm.sendRequest. Tests import it
// directly.

import { AssertionError, expect, inspect } from './expect';
import type { ScriptLog, ScriptTest } from '../types';

export type ScriptKind = 'before' | 'after';

export interface SandboxRow {
  key: string;
  value: string;
  enabled: boolean;
}

/** The request as scripts see it. Before: unresolved ({{vars}} intact). After: what was sent. */
export interface SandboxRequest {
  method: string;
  url: string;
  query: SandboxRow[];
  headers: SandboxRow[];
  body: { mode: 'none' | 'raw' | 'urlencoded' | 'formdata'; raw: string };
}

export interface SandboxResponse {
  code: number;
  status: string;
  headers: [string, string][];
  body: string | null;
  bodyBase64: string | null;
  responseTime: number;
  responseSize: number;
}

export interface ScriptContext {
  kind: ScriptKind;
  requestName: string;
  envName: string | null;
  /** Enabled environment variables. */
  env: Record<string, string>;
  /** The tab's input values (defaults applied). */
  inputs: Record<string, string>;
  request: SandboxRequest;
  response?: SandboxResponse;
}

/** What pm.sendRequest asks the host to send. */
export interface OutgoingRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body?: string;
}

export interface ScriptHooks {
  sendRequest(request: OutgoingRequest): Promise<SandboxResponse>;
}

export interface ScriptOutcome {
  tests: ScriptTest[];
  logs: ScriptLog[];
  /** Environment changes to persist: value, or null for unset. */
  envChanges: Record<string, string | null>;
  /** pm.variables.set() values; they apply to this send only. */
  locals: Record<string, string>;
  /** The request after the script's edits (before scripts). */
  request: SandboxRequest;
  error?: string;
  durationMs: number;
}

const UNSUPPORTED_REQUIRE =
  'require() is not available in KangPos scripts. Built in: pm, console, crypto (Web Crypto), btoa/atob, TextEncoder/TextDecoder.';

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function format(args: unknown[]): string {
  return args.map(a => (typeof a === 'string' ? a : inspectLong(a))).join(' ');
}

function inspectLong(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === undefined) return 'undefined';
  try {
    return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  } catch {
    return String(value);
  }
}

/** Postman's list API over header / query rows. */
function rowList(rows: SandboxRow[], caseInsensitive: boolean, readOnly = false, separator = ':') {
  const same = (a: string, b: string) => (caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
  const guard = () => {
    if (readOnly) throw new Error('This list is read-only in after scripts');
  };
  const toRow = (item: unknown, value?: unknown): SandboxRow => {
    if (typeof item === 'string') {
      // "Key: value" (headers) / "key=value" (query), or ("Key", "value")
      if (value !== undefined) return { key: item, value: asString(value), enabled: true };
      const at = item.indexOf(separator);
      return at >= 0
        ? { key: item.slice(0, at).trim(), value: item.slice(at + 1).trim(), enabled: true }
        : { key: item, value: '', enabled: true };
    }
    const obj = (item ?? {}) as { key?: unknown; value?: unknown; disabled?: unknown };
    return { key: asString(obj.key), value: asString(obj.value), enabled: !obj.disabled };
  };
  return {
    get(key: string) {
      return rows.find(r => r.enabled && same(r.key, key))?.value;
    },
    has(key: string, value?: string) {
      return rows.some(r => r.enabled && same(r.key, key) && (value === undefined || r.value === value));
    },
    add(item: unknown, value?: unknown) {
      guard();
      rows.push(toRow(item, value));
    },
    upsert(item: unknown, value?: unknown) {
      guard();
      const row = toRow(item, value);
      const existing = rows.find(r => same(r.key, row.key));
      if (existing) {
        existing.value = row.value;
        existing.enabled = true;
      } else rows.push(row);
    },
    remove(key: string | ((row: SandboxRow) => boolean)) {
      guard();
      for (let i = rows.length - 1; i >= 0; i--) {
        if (typeof key === 'function' ? key(rows[i]) : same(rows[i].key, key)) rows.splice(i, 1);
      }
    },
    clear() {
      guard();
      rows.length = 0;
    },
    toObject() {
      const out: Record<string, string> = {};
      for (const r of rows) if (r.enabled) out[caseInsensitive ? r.key.toLowerCase() : r.key] = r.value;
      return out;
    },
    all() {
      return rows.filter(r => r.enabled).map(r => ({ ...r }));
    },
    each(fn: (row: SandboxRow) => void) {
      rows.filter(r => r.enabled).forEach(r => fn({ ...r }));
    },
    count() {
      return rows.filter(r => r.enabled).length;
    },
  };
}

function urlWithQuery(url: string, query: SandboxRow[]): string {
  const pairs = query.filter(q => q.enabled && q.key !== '').map(q => `${q.key}=${q.value}`);
  if (pairs.length === 0) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${pairs.join('&')}`;
}

/** Turn what a script passes to pm.sendRequest into an OutgoingRequest. */
export function toOutgoing(arg: unknown): OutgoingRequest {
  if (typeof arg === 'string') return { method: 'GET', url: arg, headers: [] };
  const req = (arg ?? {}) as Record<string, unknown>;
  const url = typeof req.url === 'object' && req.url !== null ? asString((req.url as { raw?: unknown }).raw ?? req.url) : asString(req.url);
  const headers: [string, string][] = [];
  const header = req.header ?? req.headers;
  if (Array.isArray(header)) {
    for (const h of header) {
      if (typeof h === 'string') {
        const at = h.indexOf(':');
        if (at > 0) headers.push([h.slice(0, at).trim(), h.slice(at + 1).trim()]);
      } else if (h && typeof h === 'object' && !(h as { disabled?: boolean }).disabled) {
        headers.push([asString((h as { key?: unknown }).key), asString((h as { value?: unknown }).value)]);
      }
    }
  } else if (header && typeof header === 'object') {
    for (const [k, v] of Object.entries(header)) headers.push([k, asString(v)]);
  }
  let body: string | undefined;
  const b = req.body as Record<string, unknown> | string | undefined;
  if (typeof b === 'string') body = b;
  else if (b && typeof b === 'object') {
    if (b.mode === 'urlencoded' && Array.isArray(b.urlencoded)) {
      body = (b.urlencoded as { key?: unknown; value?: unknown; disabled?: boolean }[])
        .filter(f => !f.disabled)
        .map(f => `${encodeURIComponent(asString(f.key))}=${encodeURIComponent(asString(f.value))}`)
        .join('&');
      if (!headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    } else if (b.raw !== undefined) {
      body = asString(b.raw);
    }
  }
  return { method: asString(req.method || 'GET').toUpperCase(), url, headers, body };
}

/** The response object scripts get (pm.response, and pm.sendRequest results). */
function responseApi(res: SandboxResponse) {
  const headers = res.headers.map(([key, value]) => ({ key, value, enabled: true }));
  const text = () => {
    if (res.body !== null) return res.body;
    try {
      return atob(res.bodyBase64 ?? '');
    } catch {
      return '';
    }
  };
  const json = () => {
    try {
      return JSON.parse(text());
    } catch {
      throw new Error(`Response is not valid JSON (first characters: ${inspect(text().slice(0, 40))})`);
    }
  };
  const assertStatus = (expected: number | string) => {
    const ok = typeof expected === 'number' ? res.code === expected : res.status.toLowerCase() === expected.toLowerCase();
    if (!ok) throw new AssertionError(`expected response to have status ${inspect(expected)} but got ${res.code} ${res.status}`);
  };
  const assertRange = (lo: number, hi: number, what: string) => {
    if (res.code < lo || res.code > hi) throw new AssertionError(`expected response to be ${what} but got ${res.code}`);
  };
  const api = {
    code: res.code,
    status: res.status,
    responseTime: res.responseTime,
    responseSize: res.responseSize,
    headers: rowList(headers, true, true),
    text,
    json,
    reason: () => res.status,
    to: {
      have: {
        status: assertStatus,
        header(name: string, value?: string) {
          const actual = headers.find(h => h.key.toLowerCase() === name.toLowerCase())?.value;
          if (actual === undefined) throw new AssertionError(`expected response to have header '${name}'`);
          if (value !== undefined && actual !== value) throw new AssertionError(`expected header '${name}' to be ${inspect(value)} but got ${inspect(actual)}`);
        },
        body(expected?: string) {
          if (expected === undefined ? text() === '' : text() !== expected) {
            throw new AssertionError(expected === undefined ? 'expected response to have a body' : `expected body to be ${inspect(expected)}`);
          }
        },
        jsonBody(path?: string, value?: unknown) {
          const body = json();
          if (path === undefined) return;
          const found = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), body);
          if (found === undefined) throw new AssertionError(`expected JSON body to have '${path}'`);
          if (value !== undefined) expect(found, path).to.eql(value);
        },
      },
      be: {
        get ok() {
          assertRange(200, 299, 'ok (2xx)');
          return true;
        },
        get success() {
          assertRange(200, 299, 'successful (2xx)');
          return true;
        },
        get clientError() {
          assertRange(400, 499, 'a client error (4xx)');
          return true;
        },
        get serverError() {
          assertRange(500, 599, 'a server error (5xx)');
          return true;
        },
        get error() {
          assertRange(400, 599, 'an error (4xx/5xx)');
          return true;
        },
        get json() {
          json();
          return true;
        },
      },
    },
  };
  return api;
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...args: unknown[]) => Promise<unknown>;

export async function executeScript(code: string, ctx: ScriptContext, hooks: ScriptHooks): Promise<ScriptOutcome> {
  const started = Date.now();
  const tests: ScriptTest[] = [];
  const logs: ScriptLog[] = [];
  const envChanges: Record<string, string | null> = {};
  const locals: Record<string, string> = {};
  const request: SandboxRequest = structuredClone(ctx.request);
  const pending: Promise<unknown>[] = [];

  const log = (level: ScriptLog['level']) => (...args: unknown[]) => logs.push({ level, message: format(args) });
  const console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('log') };

  const envGet = (key: string): string | undefined => {
    if (Object.hasOwn(envChanges, key)) return envChanges[key] ?? undefined;
    return Object.hasOwn(ctx.env, key) ? ctx.env[key] : undefined;
  };
  const environment = {
    name: ctx.envName ?? '',
    get: envGet,
    has: (key: string) => envGet(key) !== undefined,
    set: (key: string, value: unknown) => {
      envChanges[key] = asString(value);
    },
    unset: (key: string) => {
      envChanges[key] = null;
    },
    toObject: () => {
      const out: Record<string, string> = { ...ctx.env };
      for (const [k, v] of Object.entries(envChanges)) {
        if (v === null) delete out[k];
        else out[k] = v;
      }
      return out;
    },
    replaceIn: (text: string) => replaceIn(text),
  };

  const variablesGet = (key: string): string | undefined => {
    if (Object.hasOwn(locals, key)) return locals[key];
    if (Object.hasOwn(ctx.inputs, key)) return ctx.inputs[key];
    return envGet(key);
  };
  const replaceIn = (text: string) =>
    String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, name: string) => variablesGet(name.trim()) ?? whole);
  const variables = {
    get: variablesGet,
    has: (key: string) => variablesGet(key) !== undefined,
    set: (key: string, value: unknown) => {
      locals[key] = asString(value);
    },
    unset: (key: string) => {
      delete locals[key];
    },
    toObject: () => ({ ...environment.toObject(), ...ctx.inputs, ...locals }),
    replaceIn,
  };

  const editable = ctx.kind === 'before';
  const queryList = rowList(request.query, false, !editable, '=');
  const url = {
    toString: () => urlWithQuery(request.url, request.query),
    getRaw: () => urlWithQuery(request.url, request.query),
    getQueryString: () => request.query.filter(q => q.enabled).map(q => `${q.key}=${q.value}`).join('&'),
    query: queryList,
    update: (next: string) => {
      if (!editable) throw new Error('pm.request can only be changed in before scripts');
      request.url = asString(next);
    },
  };
  const requestApi = {
    get method() {
      return request.method;
    },
    set method(value: string) {
      if (!editable) throw new Error('pm.request can only be changed in before scripts');
      request.method = asString(value).toUpperCase();
    },
    get url() {
      return url;
    },
    set url(value: unknown) {
      url.update(asString(value));
    },
    headers: rowList(request.headers, true, !editable),
    body: {
      get mode() {
        return request.body.mode;
      },
      get raw() {
        return request.body.raw;
      },
      set raw(value: string) {
        if (!editable) throw new Error('pm.request can only be changed in before scripts');
        request.body.raw = asString(value);
      },
      update(value: unknown) {
        if (!editable) throw new Error('pm.request can only be changed in before scripts');
        request.body.raw = typeof value === 'object' && value !== null && 'raw' in value ? asString((value as { raw: unknown }).raw) : asString(value);
      },
      toString: () => request.body.raw,
    },
    addHeader: (h: unknown) => requestApi.headers.add(h),
    removeHeader: (key: string) => requestApi.headers.remove(key),
  };

  const test = (name: string, fn?: () => unknown) => {
    const record = (passed: boolean, error?: unknown) =>
      tests.push({ name: String(name), passed, error: error === undefined ? undefined : error instanceof Error ? error.message : String(error) });
    if (typeof fn !== 'function') {
      // pm.test('name') without a function is a skipped test in Postman.
      return;
    }
    try {
      const result = fn();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        pending.push((result as Promise<unknown>).then(() => record(true), e => record(false, e)));
      } else record(true);
    } catch (e) {
      record(false, e);
    }
  };
  test.skip = (_name: string) => undefined;

  const sendRequest = (arg: unknown, callback?: (err: unknown, res: unknown) => void) => {
    const outgoing = toOutgoing(arg);
    logs.push({ level: 'info', message: `→ ${outgoing.method} ${outgoing.url}` });
    const promise = hooks.sendRequest(outgoing).then(
      res => {
        logs.push({ level: 'info', message: `← ${res.code} ${res.status} (${res.responseTime} ms)` });
        const api = responseApi(res);
        if (callback) callback(null, api);
        return api;
      },
      err => {
        const message = err instanceof Error ? err.message : String(err);
        logs.push({ level: 'error', message: `pm.sendRequest failed: ${message}` });
        if (callback) callback(new Error(message), undefined);
        else throw new Error(message);
      },
    );
    pending.push(promise.catch(() => undefined));
    return promise;
  };

  const response = ctx.response ? responseApi(ctx.response) : undefined;

  const pm = {
    info: { requestName: ctx.requestName, eventName: ctx.kind === 'before' ? 'prerequest' : 'test', iteration: 0, iterationCount: 1 },
    environment,
    variables,
    // KangPos has one variable scope per space: Postman's collection and global
    // variables map to the active environment.
    collectionVariables: environment,
    globals: environment,
    iterationData: { get: () => undefined, has: () => false, toObject: () => ({}) },
    request: requestApi,
    response,
    test,
    expect,
    sendRequest,
  };

  // Postman's legacy globals, still common in older collections.
  const legacyTests = new Proxy({} as Record<string, unknown>, {
    set(_target, key, value) {
      tests.push({ name: String(key), passed: !!value, error: value ? undefined : 'tests[...] was set to a falsy value' });
      return true;
    },
  });
  const postman = {
    setEnvironmentVariable: environment.set,
    getEnvironmentVariable: environment.get,
    clearEnvironmentVariable: environment.unset,
    setGlobalVariable: environment.set,
    getGlobalVariable: environment.get,
    setNextRequest: () => logs.push({ level: 'warn', message: 'postman.setNextRequest() is not supported (KangPos runs one request at a time)' }),
  };
  const require = (name: string) => {
    throw new Error(`${UNSUPPORTED_REQUIRE} (asked for '${name}')`);
  };

  let error: string | undefined;
  try {
    const fn = new AsyncFunction('pm', 'console', 'postman', 'tests', 'require', 'responseBody', 'responseCode', 'responseTime', 'responseHeaders', code);
    await fn(
      pm,
      console,
      postman,
      legacyTests,
      require,
      ctx.response ? response!.text() : undefined,
      ctx.response ? { code: ctx.response.code, name: ctx.response.status } : undefined,
      ctx.response?.responseTime,
      ctx.response ? Object.fromEntries(ctx.response.headers) : undefined,
    );
    // Wait for async tests and pm.sendRequest callbacks (which may start more).
    for (let seen = 0; seen < pending.length; ) {
      const batch = pending.slice(seen);
      seen = pending.length;
      await Promise.all(batch);
    }
  } catch (e) {
    error = e instanceof Error ? `${e.name === 'Error' ? '' : `${e.name}: `}${e.message}` : String(e);
    logs.push({ level: 'error', message: error });
  }

  return { tests, logs, envChanges, locals, request, error, durationMs: Date.now() - started };
}
