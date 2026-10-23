// A small lodash for scripts (`require('lodash')`, and the `_` global Postman
// provides). It covers the collection / path / string helpers that request
// scripts actually use; anything missing is undefined, so feature detection
// still works.

/* eslint-disable @typescript-eslint/no-explicit-any -- lodash's API is untyped by nature */

type Fn = (...args: any[]) => any;

export function getPath(path: any): (string | number)[] {
  if (Array.isArray(path)) return path;
  return String(path)
    .replace(/\[["']?([^"'\]]+)["']?\]/g, '.$1')
    .split('.')
    .filter(part => part !== '')
    .map(part => (/^\d+$/.test(part) ? Number(part) : part));
}

export function get(object: any, path: any, fallback?: any): any {
  let current = object;
  for (const key of getPath(path)) {
    if (current === null || current === undefined) return fallback;
    current = current[key];
  }
  return current === undefined ? fallback : current;
}

export function has(object: any, path: any): boolean {
  let current = object;
  for (const key of getPath(path)) {
    if (current === null || current === undefined || !Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = current[key];
  }
  return true;
}

/** Keys that would let a script reach or replace a prototype. Real lodash skips them too. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isUnsafeKey(key: string | number): boolean {
  return typeof key === 'string' && UNSAFE_KEYS.has(key);
}

function isUnsafePath(path: any): boolean {
  return getPath(path).some(isUnsafeKey);
}

export function set(object: any, path: any, value: any): any {
  const keys = getPath(path);
  if (keys.length === 0) return object;
  if (isUnsafePath(keys)) return object;
  if (object === null || typeof object !== 'object') return object;
  let current = object;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) current[key] = value;
    else {
      if (current[key] === null || typeof current[key] !== 'object') current[key] = typeof keys[i + 1] === 'number' ? [] : {};
      current = current[key];
    }
  });
  return object;
}

export function unset(object: any, path: any): boolean {
  const keys = getPath(path);
  if (keys.length === 0) return true;
  if (isUnsafePath(keys)) return true;
  const parent = get(object, keys.slice(0, -1));
  if (parent === null || typeof parent !== 'object') return true;
  return delete parent[keys[keys.length - 1]];
}

function isPlainObject(value: any): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isEqual(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => isEqual(v, b[i]));
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(b, k) && isEqual(a[k], b[k]));
  }
  return false;
}

function cloneDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map(cloneDeep) as unknown as T;
  const out: any = {};
  for (const [k, v] of Object.entries(value)) if (!isUnsafeKey(k)) out[k] = cloneDeep(v);
  return out as T;
}

function iteratee(fn: any): (value: any, index?: any) => any {
  if (typeof fn === 'function') return fn;
  if (fn === undefined || fn === null) return (v: any) => v;
  if (typeof fn === 'string' || typeof fn === 'number' || Array.isArray(fn)) return (v: any) => get(v, fn);
  if (typeof fn === 'object') return (v: any) => Object.entries(fn).every(([k, wanted]) => isEqual(get(v, k), wanted));
  return (v: any) => v;
}

function collectionValues(collection: any): any[] {
  if (collection === null || collection === undefined) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection === 'string') return collection.split('');
  if (typeof collection.length === 'number') return Array.from(collection);
  if (typeof collection === 'object') return Object.values(collection);
  return [];
}

function each(collection: any, fn: (value: any, key: any, collection: any) => unknown): any {
  if (collection === null || collection === undefined) return collection;
  if (Array.isArray(collection) || typeof collection === 'string') {
    for (let i = 0; i < collection.length; i++) if (fn(collection[i], i, collection) === false) break;
    return collection;
  }
  for (const [key, value] of Object.entries(collection)) if (fn(value, key, collection) === false) break;
  return collection;
}

function map(collection: any, fn?: any): any[] {
  const out: any[] = [];
  each(collection, (value, key) => out.push(iteratee(fn)(value, key)));
  return out;
}

function filter(collection: any, fn?: any): any[] {
  const predicate = iteratee(fn);
  const out: any[] = [];
  each(collection, (value, key) => {
    if (predicate(value, key)) out.push(value);
  });
  return out;
}

function find(collection: any, fn?: any): any {
  const predicate = iteratee(fn);
  let found: any;
  each(collection, (value, key) => {
    if (found !== undefined) return false;
    if (predicate(value, key)) found = value;
    return undefined;
  });
  return found;
}

function reduce(collection: any, fn: Fn, initial?: any): any {
  let acc = initial;
  let first = arguments.length < 3;
  each(collection, (value, key) => {
    if (first) {
      acc = value;
      first = false;
      return;
    }
    acc = fn(acc, value, key, collection);
    return undefined;
  });
  return acc;
}

function includes(collection: any, value: any, fromIndex = 0): boolean {
  if (typeof collection === 'string') return collection.includes(String(value), fromIndex);
  const values = collectionValues(collection);
  return values.slice(fromIndex).some(v => Object.is(v, value) || isEqual(v, value));
}

function uniq(values: any[]): any[] {
  const out: any[] = [];
  for (const v of values) if (!out.some(o => isEqual(o, v))) out.push(v);
  return out;
}

function uniqBy(values: any[], fn: any): any[] {
  const seen: any[] = [];
  const out: any[] = [];
  for (const value of values) {
    const key = iteratee(fn)(value);
    if (seen.some(s => isEqual(s, key))) continue;
    seen.push(key);
    out.push(value);
  }
  return out;
}

function flattenDeep(values: any[]): any[] {
  return values.reduce((out: any[], v) => out.concat(Array.isArray(v) ? flattenDeep(v) : [v]), []);
}

function chunk(values: any[], size = 1): any[][] {
  const out: any[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let i = 0; i < values.length; i += step) out.push(values.slice(i, i + step));
  return out;
}

function groupBy(values: any[], fn: any): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const value of values) {
    const key = String(iteratee(fn)(value));
    (out[key] ??= []).push(value);
  }
  return out;
}

function sortBy(values: any[], ...fns: any[]): any[] {
  const keys = fns.map(iteratee);
  return [...values].sort((a, b) => {
    for (const fn of keys) {
      const x = fn(a);
      const y = fn(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  });
}

function orderBy(values: any[], fns: any, orders: any): any[] {
  const list = (Array.isArray(fns) ? fns : [fns]).map(iteratee);
  const directions = (Array.isArray(orders) ? orders : [orders]).map(o => (o === 'desc' ? -1 : 1));
  return [...values].sort((a, b) => {
    for (let i = 0; i < list.length; i++) {
      const x = list[i](a);
      const y = list[i](b);
      if (x < y) return -1 * (directions[i] ?? 1);
      if (x > y) return 1 * (directions[i] ?? 1);
    }
    return 0;
  });
}

function words(text: any): string[] {
  return String(text ?? '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function deburr(text: any): string {
  return String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(text: any): string {
  return String(text ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}

export function createLodash(): Record<string, any> {
  const lodash: Record<string, any> = {
    identity: (v: any) => v,
    noop: () => undefined,
    get,
    set,
    has,
    unset,
    isEqual,
    isEmpty(value: any): boolean {
      if (value === null || value === undefined) return true;
      if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
      if (ArrayBuffer.isView(value)) return value.byteLength === 0;
      if (value instanceof Map || value instanceof Set) return value.size === 0;
      return typeof value === 'object' ? Object.keys(value).length === 0 : true;
    },
    isArray: Array.isArray,
    isObject: (v: any) => v !== null && (typeof v === 'object' || typeof v === 'function'),
    isPlainObject,
    isString: (v: any) => typeof v === 'string' || v instanceof String,
    isNumber: (v: any) => typeof v === 'number' || v instanceof Number,
    isBoolean: (v: any) => typeof v === 'boolean' || v instanceof Boolean,
    isFunction: (v: any) => typeof v === 'function',
    isNil: (v: any) => v === null || v === undefined,
    isNull: (v: any) => v === null,
    isUndefined: (v: any) => v === undefined,
    isDate: (v: any) => v instanceof Date,
    isRegExp: (v: any) => v instanceof RegExp,
    keys: Object.keys,
    values: (v: any) => Object.values(v ?? {}),
    entries: (v: any) => Object.entries(v ?? {}),
    toPairs: (v: any) => Object.entries(v ?? {}),
    fromPairs: (pairs: any[]) => Object.fromEntries(pairs ?? []),
    assign(target: any, ...sources: any[]): any {
      for (const source of sources) {
        for (const key of Reflect.ownKeys(source ?? {})) {
          if (isUnsafeKey(key as string)) continue;
          if (Object.prototype.propertyIsEnumerable.call(source, key)) target[key as any] = source[key as any];
        }
      }
      return target;
    },
    merge(target: any, ...sources: any[]): any {
      const deep = (to: any, from: any) => {
        for (const [k, v] of Object.entries(from ?? {})) {
          if (isUnsafeKey(k)) continue;
          if (isPlainObject(v) && isPlainObject(to[k])) deep(to[k], v);
          else if (Array.isArray(v)) to[k] = cloneDeep(v);
          else to[k] = v;
        }
        return to;
      };
      return sources.reduce((acc, source) => deep(acc, source), target);
    },
    defaults(target: any, ...sources: any[]): any {
      for (const source of sources) {
        for (const [k, v] of Object.entries(source ?? {})) {
          if (!isUnsafeKey(k) && target[k] === undefined) target[k] = v;
        }
      }
      return target;
    },
    pick(object: any, ...paths: any[]): any {
      const list = paths.flat();
      const out: any = {};
      for (const path of list) if (has(object, path)) set(out, path, get(object, path));
      return out;
    },
    omit(object: any, ...paths: any[]): any {
      const out = cloneDeep(object);
      for (const path of paths.flat()) unset(out, path);
      return out;
    },
    cloneDeep,
    each,
    forEach: each,
    forOwn: each,
    map,
    flatMap: (values: any, fn?: any) => flattenDeep(map(values, fn)),
    filter,
    reject: (values: any, fn?: any) => filter(values, (v: any, i: any) => !iteratee(fn)(v, i)),
    find,
    findIndex(values: any[], fn?: any): number {
      const predicate = iteratee(fn);
      for (let i = 0; i < (values?.length ?? 0); i++) if (predicate(values[i], i)) return i;
      return -1;
    },
    some(values: any, fn?: any): boolean {
      let found = false;
      each(values, (v, i) => {
        if (iteratee(fn)(v, i)) {
          found = true;
          return false;
        }
        return undefined;
      });
      return found;
    },
    every(values: any, fn?: any): boolean {
      let ok = true;
      each(values, (v, i) => {
        if (!iteratee(fn)(v, i)) {
          ok = false;
          return false;
        }
        return undefined;
      });
      return ok;
    },
    reduce,
    includes,
    indexOf: (values: any[], value: any) => (values ?? []).indexOf(value),
    lastIndexOf: (values: any[], value: any) => (values ?? []).lastIndexOf(value),
    size: (v: any) => collectionValues(v).length,
    uniq,
    uniqBy,
    compact: (values: any[]) => (values ?? []).filter(Boolean),
    flatten: (values: any[]) => (values ?? []).reduce((out: any[], v) => out.concat(v), []),
    flattenDeep,
    chunk,
    take: (values: any[], n = 1) => (values ?? []).slice(0, n),
    drop: (values: any[], n = 1) => (values ?? []).slice(n),
    head: (values: any[]) => (values ?? [])[0],
    last: (values: any[]) => (values ?? [])[values?.length - 1],
    nth: (values: any[], n = 0) => (n < 0 ? (values ?? [])[(values?.length ?? 0) + n] : (values ?? [])[n]),
    first: (values: any[]) => (values ?? [])[0],
    sortBy,
    orderBy,
    groupBy,
    keyBy: (values: any[], fn: any) => Object.fromEntries((values ?? []).map(v => [String(iteratee(fn)(v)), v])),
    countBy: (values: any[], fn: any) => {
      const out: Record<string, number> = {};
      for (const value of values ?? []) {
        const key = String(iteratee(fn)(value));
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    },
    partition: (values: any[], fn: any) => [(values ?? []).filter((v: any) => iteratee(fn)(v)), (values ?? []).filter((v: any) => !iteratee(fn)(v))],
    mapValues: (object: any, fn?: any) => Object.fromEntries(Object.entries(object ?? {}).map(([k, v]) => [k, iteratee(fn)(v, k)])),
    mapKeys: (object: any, fn?: any) => Object.fromEntries(Object.entries(object ?? {}).map(([k, v]) => [String(iteratee(fn)(v, k)), v])),
    invert: (object: any) => Object.fromEntries(Object.entries(object ?? {}).map(([k, v]) => [String(v), k])),
    sum: (values: any[]) => (values ?? []).reduce((a, b) => a + (Number(b) || 0), 0),
    sumBy: (values: any[], fn?: any) => (values ?? []).reduce((a, v) => a + (Number(iteratee(fn)(v)) || 0), 0),
    mean: (values: any[]) => (values?.length ? (values ?? []).reduce((a, b) => a + (Number(b) || 0), 0) / values.length : NaN),
    max: (values: any[]) => (values?.length ? Math.max(...values.map(Number)) : undefined),
    min: (values: any[]) => (values?.length ? Math.min(...values.map(Number)) : undefined),
    maxBy: (values: any[], fn?: any) => (values ?? []).reduce((best, v) => (best === undefined || iteratee(fn)(v) > iteratee(fn)(best) ? v : best), undefined),
    minBy: (values: any[], fn?: any) => (values ?? []).reduce((best, v) => (best === undefined || iteratee(fn)(v) < iteratee(fn)(best) ? v : best), undefined),
    range: (start: number, end?: number, step = 1) => {
      const from = end === undefined ? 0 : start;
      const to = end === undefined ? start : end;
      const out: number[] = [];
      for (let n = from; step > 0 ? n < to : n > to; n += step) out.push(n);
      return out;
    },
    times: (n: number, fn?: any) => Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => (fn ? fn(i) : i)),
    uniqueId: (() => {
      let id = 0;
      return (prefix = '') => `${prefix}${++id}`;
    })(),
    random: (lower = 0, upper = 1) => {
      const lo = upper === undefined ? 0 : lower;
      const hi = upper === undefined ? lower : upper;
      return Math.floor(Math.random() * (hi - lo + 1)) + lo;
    },
    now: Date.now,
    toLower: (v: any) => String(v ?? '').toLowerCase(),
    toUpper: (v: any) => String(v ?? '').toUpperCase(),
    trim: (v: any) => String(v ?? '').trim(),
    trimStart: (v: any) => String(v ?? '').trimStart(),
    trimEnd: (v: any) => String(v ?? '').trimEnd(),
    capitalize: (v: any) => {
      const text = String(v ?? '').toLowerCase();
      return text.charAt(0).toUpperCase() + text.slice(1);
    },
    camelCase: (v: any) => words(v).map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(''),
    kebabCase: (v: any) => words(v).map(w => w.toLowerCase()).join('-'),
    snakeCase: (v: any) => words(v).map(w => w.toLowerCase()).join('_'),
    startCase: (v: any) => words(v).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
    lowerCase: (v: any) => words(v).map(w => w.toLowerCase()).join(' '),
    upperCase: (v: any) => words(v).map(w => w.toUpperCase()).join(' '),
    truncate: (v: any, options: any = {}) => {
      const text = String(v ?? '');
      const length = options.length ?? 30;
      if (text.length <= length) return text;
      const omission = options.omission ?? '...';
      return text.slice(0, Math.max(0, length - omission.length)) + omission;
    },
    padStart: (v: any, length: number, chars = ' ') => String(v ?? '').padStart(length, chars),
    padEnd: (v: any, length: number, chars = ' ') => String(v ?? '').padEnd(length, chars),
    repeat: (v: any, n = 1) => String(v ?? '').repeat(n),
    replace: (v: any, pattern: any, replacement: any) => String(v ?? '').replace(pattern, replacement),
    split: (v: any, separator: any, limit?: number) => String(v ?? '').split(separator, limit),
    escape: escapeHtml,
    deburr,
    toNumber: (v: any) => Number(v),
    parseInt: (v: any, radix = 10) => parseInt(String(v), radix),
    toInteger: (v: any) => Math.trunc(Number(v)) || 0,
    toString: (v: any) => (v === null || v === undefined ? '' : String(v)),
    castArray: (v: any) => (Array.isArray(v) ? v : v === undefined ? [] : [v]),
    difference: (values: any[], ...others: any[]) => (values ?? []).filter(v => !others.flat().some(o => isEqual(o, v))),
    intersection: (values: any[], ...others: any[]) => (values ?? []).filter(v => others.every(o => o.some((x: any) => isEqual(x, v)))),
    union: (...values: any[][]) => uniq(values.flat()),
    without: (values: any[], ...excluded: any[]) => (values ?? []).filter(v => !excluded.some(e => isEqual(e, v))),
  };
  lodash._ = lodash;
  return lodash;
}
