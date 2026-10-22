// Postman collection (v2.0 / v2.1) and environment importers.

import {
  emptyRequest,
  HTTP_METHODS,
  type AuthSpec,
  type BodyField,
  type EnvVariable,
  type HttpMethod,
  type KeyValue,
  type RequestSpec,
} from '../../types';
import { addParam, WarningList, type ImportedTemplate, type ImportResult } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any -- Postman JSON is untyped input */

export function isPostmanCollection(doc: any): boolean {
  return !!doc && typeof doc === 'object' && !!doc.info && Array.isArray(doc.item);
}

export function isPostmanEnvironment(doc: any): boolean {
  return (
    !!doc &&
    typeof doc === 'object' &&
    Array.isArray(doc.values) &&
    typeof doc.name === 'string' &&
    !doc.info
  );
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

function description(d: any): string | undefined {
  if (!d) return undefined;
  if (typeof d === 'string') return d;
  if (typeof d.content === 'string') return d.content;
  return undefined;
}

function toRows(list: any): KeyValue[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r: any) => r && typeof r === 'object')
    .map((r: any) => ({
      key: str(r.key),
      value: str(r.value),
      enabled: !r.disabled,
      description: description(r.description),
    }));
}

/** v2.1 stores auth params as [{key, value}], v2.0 as an object. */
function authValue(auth: any, type: string, key: string): string {
  const section = auth?.[type];
  if (Array.isArray(section)) return str(section.find((e: any) => e?.key === key)?.value);
  if (section && typeof section === 'object') return str(section[key]);
  return '';
}

/** `undefined` = inherit from the parent. */
function convertAuth(auth: any, warnings: WarningList): AuthSpec | undefined {
  if (!auth || typeof auth !== 'object' || !auth.type) return undefined;
  switch (auth.type) {
    case 'inherit':
      return undefined;
    case 'noauth':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', token: authValue(auth, 'bearer', 'token') };
    case 'basic':
      return {
        type: 'basic',
        username: authValue(auth, 'basic', 'username'),
        password: authValue(auth, 'basic', 'password'),
      };
    case 'apikey':
      return {
        type: 'apikey',
        key: authValue(auth, 'apikey', 'key') || 'X-API-Key',
        value: authValue(auth, 'apikey', 'value'),
        in: authValue(auth, 'apikey', 'in') === 'query' ? 'query' : 'header',
      };
    default:
      warnings.add(`Auth type "${auth.type}" is not supported; those requests have no auth`);
      return { type: 'none' };
  }
}

interface UrlParts {
  url: string;
  query: KeyValue[];
  pathVars: { key: string; value: string; description?: string }[];
}

function convertUrl(url: any): UrlParts {
  if (!url) return { url: '', query: [], pathVars: [] };
  if (typeof url === 'string') return splitRawUrl(url, [], []);

  let raw = str(url.raw);
  if (!raw) {
    const host = Array.isArray(url.host) ? url.host.join('.') : str(url.host);
    const path = Array.isArray(url.path) ? url.path.join('/') : str(url.path);
    const protocol = url.protocol ? `${url.protocol}://` : '';
    const port = url.port ? `:${url.port}` : '';
    raw = `${protocol}${host}${port}${path ? `/${path}` : ''}`;
  }
  const variables = Array.isArray(url.variable)
    ? url.variable.map((v: any) => ({ key: str(v.key), value: str(v.value), description: description(v.description) }))
    : [];
  return splitRawUrl(raw, toRows(url.query), variables);
}

/**
 * Separate the query string from the URL (query rows are edited on their own),
 * and turn `:id` path segments into `{{id}}` placeholders.
 */
function splitRawUrl(raw: string, queryRows: KeyValue[], variables: UrlParts['pathVars']): UrlParts {
  const qAt = raw.indexOf('?');
  let base = qAt >= 0 ? raw.slice(0, qAt) : raw;
  let query = queryRows;
  if (qAt >= 0 && query.length === 0) {
    query = raw
      .slice(qAt + 1)
      .split('&')
      .filter(Boolean)
      .map(pair => {
        const eq = pair.indexOf('=');
        return {
          key: eq >= 0 ? pair.slice(0, eq) : pair,
          value: eq >= 0 ? pair.slice(eq + 1) : '',
          enabled: true,
        };
      });
  }

  const pathVars = [...variables];
  base = base.replace(/\/:([A-Za-z_][\w-]*)/g, (_m, name: string) => {
    if (!pathVars.some(v => v.key === name)) pathVars.push({ key: name, value: '' });
    return `/{{${name}}}`;
  });
  return { url: base, query, pathVars };
}

function convertBody(body: any, request: RequestSpec, warnings: WarningList): void {
  if (!body || typeof body !== 'object' || body.disabled) return;
  switch (body.mode) {
    case 'raw': {
      const lang = str(body.options?.raw?.language).toLowerCase();
      const raw = str(body.raw);
      const looksJson = /^\s*[[{]/.test(raw);
      const type = lang === 'json' || (lang === '' && looksJson) ? 'json' : lang === 'xml' ? 'xml' : 'text';
      request.body = { type, raw, fields: [] };
      break;
    }
    case 'urlencoded':
      request.body = {
        type: 'form-urlencoded',
        raw: '',
        fields: toRows(body.urlencoded).map(r => ({ ...r, kind: 'text' as const })),
      };
      break;
    case 'formdata': {
      const fields: BodyField[] = (Array.isArray(body.formdata) ? body.formdata : []).map((f: any) => {
        const isFile = f?.type === 'file';
        const src = Array.isArray(f?.src) ? f.src[0] : f?.src;
        if (isFile && !src) warnings.add('Some multipart file fields had no file path; pick the file in the Body tab');
        return {
          key: str(f?.key),
          value: isFile ? str(src) : str(f?.value),
          enabled: !f?.disabled,
          kind: isFile ? 'file' : 'text',
        };
      });
      request.body = { type: 'multipart', raw: '', fields };
      break;
    }
    case 'graphql': {
      let variables: unknown;
      try {
        variables = body.graphql?.variables ? JSON.parse(body.graphql.variables) : {};
      } catch {
        variables = {};
      }
      request.body = {
        type: 'json',
        raw: JSON.stringify({ query: str(body.graphql?.query), variables }, null, 2),
        fields: [],
      };
      break;
    }
    case 'file':
      warnings.add('Binary file bodies are not supported; those requests were imported without a body');
      break;
    default:
      break;
  }
}

function convertRequest(item: any, inheritedAuth: AuthSpec, warnings: WarningList): RequestSpec {
  const src = typeof item.request === 'string' ? { url: item.request, method: 'GET' } : item.request ?? {};
  const request = emptyRequest();

  const method = str(src.method || 'GET').toUpperCase();
  if (HTTP_METHODS.includes(method as HttpMethod)) request.method = method as HttpMethod;
  else warnings.add(`Method ${method} is not supported; imported as GET`);

  const url = convertUrl(src.url);
  request.url = url.url;
  request.query = url.query;
  for (const v of url.pathVars) {
    // A value that is itself a placeholder is a reference, not a default.
    const isReference = /^\{\{.*\}\}$/.test(v.value);
    addParam(request.params, {
      name: v.key,
      default: isReference ? '' : v.value,
      required: true,
      description: v.description,
    });
  }

  request.headers = typeof src.header === 'string' ? parseHeaderBlock(src.header) : toRows(src.header);
  convertBody(src.body, request, warnings);
  request.auth = convertAuth(src.auth, warnings) ?? inheritedAuth;

  if (Array.isArray(item.event) && item.event.some((e: any) => scriptHasCode(e?.script))) {
    warnings.add('Pre-request and test scripts are not supported and were skipped');
  }
  return request;
}

function parseHeaderBlock(block: string): KeyValue[] {
  return block
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const colon = line.indexOf(':');
      return {
        key: colon >= 0 ? line.slice(0, colon).trim() : line,
        value: colon >= 0 ? line.slice(colon + 1).trim() : '',
        enabled: true,
      };
    });
}

function scriptHasCode(script: any): boolean {
  if (!script) return false;
  const exec = Array.isArray(script.exec) ? script.exec.join('\n') : str(script.exec);
  return exec.trim() !== '';
}

export function importPostmanCollection(doc: any): ImportResult {
  const warnings = new WarningList();
  const templates: ImportedTemplate[] = [];
  const rootAuth = convertAuth(doc.auth, warnings) ?? { type: 'none' };

  if (Array.isArray(doc.event) && doc.event.some((e: any) => scriptHasCode(e?.script))) {
    warnings.add('Collection-level scripts are not supported and were skipped');
  }

  const walk = (items: any[], folderPath: string[], auth: AuthSpec) => {
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      if (Array.isArray(item.item)) {
        const folderAuth = convertAuth(item.auth, warnings) ?? auth;
        if (Array.isArray(item.event) && item.event.some((e: any) => scriptHasCode(e?.script))) {
          warnings.add('Folder-level scripts are not supported and were skipped');
        }
        walk(item.item, [...folderPath, str(item.name) || 'Folder'], folderAuth);
      } else if (item.request) {
        templates.push({
          name: str(item.name) || 'Request',
          folder: folderPath.join(' / '),
          request: convertRequest(item, auth, warnings),
        });
      }
    }
  };
  walk(doc.item, [], rootAuth);

  const name = str(doc.info?.name) || 'Postman collection';
  const collectionVars: EnvVariable[] = (Array.isArray(doc.variable) ? doc.variable : [])
    .filter((v: any) => v && v.key)
    .map((v: any) => ({ key: str(v.key), value: str(v.value), enabled: !v.disabled }));

  return {
    kind: 'postman-collection',
    name,
    templates,
    environments: collectionVars.length > 0 ? [{ name: `${name} variables`, variables: collectionVars }] : [],
    warnings: warnings.list(),
  };
}

export function importPostmanEnvironment(doc: any): ImportResult {
  const variables: EnvVariable[] = doc.values
    .filter((v: any) => v && v.key)
    .map((v: any) => ({
      key: str(v.key),
      value: str(v.value),
      enabled: v.enabled !== false,
      secret: v.type === 'secret' || undefined,
    }));
  const name = str(doc.name) || 'Environment';
  return {
    kind: 'postman-environment',
    name,
    templates: [],
    environments: [{ name, variables }],
    warnings: [],
  };
}
