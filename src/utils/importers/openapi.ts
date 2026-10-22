// OpenAPI 3.x and Swagger 2.0 importer: one template per operation.

import {
  emptyRequest,
  type AuthSpec,
  type BodyField,
  type EnvVariable,
  type HttpMethod,
  type RequestSpec,
  type TemplateParam,
} from '../../types';
import { addParam, WarningList, type ImportedTemplate, type ImportResult } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any -- OpenAPI documents are untyped input */

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const;
const MAX_DEPTH = 6;

export function isOpenApi(doc: any): boolean {
  return (
    !!doc &&
    typeof doc === 'object' &&
    (typeof doc.openapi === 'string' || doc.swagger === '2.0') &&
    typeof doc.paths === 'object'
  );
}

/** Resolve a local `#/a/b` reference; external refs are not followed. */
function deref(doc: any, node: any, warnings: WarningList, seen = new Set<string>()): any {
  if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
  const ref: string = node.$ref;
  if (!ref.startsWith('#/')) {
    warnings.add(`External $ref "${ref}" was not followed`);
    return {};
  }
  if (seen.has(ref)) return {};
  seen.add(ref);
  let target: any = doc;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    target = target?.[key];
  }
  return deref(doc, target ?? {}, warnings, seen);
}

/** Build an example value from a schema: example → default → enum → type. */
export function sampleFromSchema(doc: any, schema: any, warnings: WarningList, depth = 0): unknown {
  const s = deref(doc, schema, warnings);
  if (!s || typeof s !== 'object' || depth > MAX_DEPTH) return null;
  if (s.example !== undefined) return s.example;
  if (Array.isArray(s.examples) && s.examples.length > 0) return s.examples[0];
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];

  if (Array.isArray(s.allOf)) {
    const merged: Record<string, unknown> = {};
    for (const part of s.allOf) {
      const v = sampleFromSchema(doc, part, warnings, depth + 1);
      if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(merged, v);
    }
    return merged;
  }
  const variant = s.oneOf?.[0] ?? s.anyOf?.[0];
  if (variant) return sampleFromSchema(doc, variant, warnings, depth + 1);

  const type = Array.isArray(s.type) ? s.type.find((t: string) => t !== 'null') : s.type;
  if (type === 'object' || (!type && s.properties)) {
    const out: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries<any>(s.properties ?? {})) {
      const p = deref(doc, prop, warnings);
      if (p?.readOnly) continue;
      out[key] = sampleFromSchema(doc, p, warnings, depth + 1);
    }
    return out;
  }
  if (type === 'array') {
    const item = sampleFromSchema(doc, s.items, warnings, depth + 1);
    return item === null ? [] : [item];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') {
    switch (s.format) {
      case 'date-time':
        return '2026-01-01T00:00:00Z';
      case 'date':
        return '2026-01-01';
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '00000000-0000-0000-0000-000000000000';
      case 'uri':
        return 'https://example.com';
      default:
        return 'string';
    }
  }
  return null;
}

/** An `enum` becomes a dropdown input. Works for OpenAPI 3 (`schema.enum`) and Swagger 2 (`enum` on the parameter). */
function enumInput(doc: any, schemaOrParam: any, warnings: WarningList): Pick<TemplateParam, 'type' | 'options'> {
  const s = deref(doc, schemaOrParam?.schema ?? schemaOrParam, warnings);
  const values: unknown[] = Array.isArray(s?.enum) ? s.enum : Array.isArray(schemaOrParam?.enum) ? schemaOrParam.enum : [];
  const options = [...new Set(values.filter(v => v !== null && v !== undefined).map(v => String(v)))];
  return options.length > 0 ? { type: 'select', options } : {};
}

/** Default for an input: a required dropdown starts unselected unless the spec names a default or example. */
function inputDefault(doc: any, param: any, example: string, warnings: WarningList): string {
  if (!enumInput(doc, param, warnings).type) return example;
  const declared = [param.example, param.schema?.example, param.schema?.default, param.default, param['x-example']];
  return declared.some(v => v !== undefined) || (param.examples && typeof param.examples === 'object') ? example : '';
}

function exampleString(doc: any, param: any, warnings: WarningList): string {
  const value =
    param.example ??
    (param.examples && typeof param.examples === 'object'
      ? (Object.values<any>(param.examples)[0]?.value ?? undefined)
      : undefined) ??
    param.schema?.example ??
    param.schema?.default ??
    param.default ??
    param['x-example'];
  if (value === undefined) {
    const schema = deref(doc, param.schema ?? {}, warnings);
    if (Array.isArray(schema.enum) && schema.enum.length > 0) return String(schema.enum[0]);
    return '';
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function baseUrlOf(doc: any): string {
  if (doc.swagger === '2.0') {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length > 0 ? doc.schemes[0] : 'https';
    const host = doc.host ?? 'localhost';
    return `${scheme}://${host}${doc.basePath ?? ''}`.replace(/\/$/, '');
  }
  const server = Array.isArray(doc.servers) ? doc.servers[0] : undefined;
  if (!server?.url) return '';
  let url: string = server.url;
  for (const [name, variable] of Object.entries<any>(server.variables ?? {})) {
    url = url.replace(`{${name}}`, String(variable?.default ?? ''));
  }
  return url.replace(/\/$/, '');
}

/** Map the operation's security requirement to auth + the env vars it needs. */
function convertSecurity(
  doc: any,
  operation: any,
  envVars: Map<string, string>,
  warnings: WarningList,
): AuthSpec {
  const requirements = operation.security ?? doc.security;
  if (!Array.isArray(requirements) || requirements.length === 0) return { type: 'none' };
  const schemes = doc.components?.securitySchemes ?? doc.securityDefinitions ?? {};
  for (const requirement of requirements) {
    for (const name of Object.keys(requirement ?? {})) {
      const scheme = deref(doc, schemes[name], warnings);
      if (!scheme?.type) continue;
      const httpScheme = String(scheme.scheme ?? '').toLowerCase();
      if ((scheme.type === 'http' && httpScheme === 'bearer') || scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
        if (scheme.type !== 'http') warnings.add(`${scheme.type} flows are not automated; set {{token}} in the environment`);
        envVars.set('token', '');
        return { type: 'bearer', token: '{{token}}' };
      }
      if ((scheme.type === 'http' && httpScheme === 'basic') || scheme.type === 'basic') {
        envVars.set('username', '');
        envVars.set('password', '');
        return { type: 'basic', username: '{{username}}', password: '{{password}}' };
      }
      if (scheme.type === 'apiKey') {
        if (scheme.in === 'cookie') {
          warnings.add('Cookie API keys are not supported; add a Cookie header by hand');
          continue;
        }
        envVars.set('apiKey', '');
        return { type: 'apikey', key: String(scheme.name ?? 'X-API-Key'), value: '{{apiKey}}', in: scheme.in === 'query' ? 'query' : 'header' };
      }
    }
  }
  return { type: 'none' };
}

/**
 * Required top-level string fields become `{{field}}` params, so the user fills
 * them in the params form instead of hunting through the JSON.
 */
function jsonBody(doc: any, schema: any, request: RequestSpec, warnings: WarningList): void {
  const s = deref(doc, schema, warnings);
  const sample = sampleFromSchema(doc, s, warnings);
  if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
    const required: string[] = Array.isArray(s?.required) ? s.required : [];
    for (const field of required) {
      const prop = deref(doc, s.properties?.[field], warnings);
      const type = Array.isArray(prop?.type) ? prop.type[0] : prop?.type;
      if (type !== 'string') continue;
      const current = (sample as Record<string, unknown>)[field];
      const hasExample = prop?.example !== undefined || prop?.default !== undefined;
      addParam(request.params, {
        name: field,
        default: hasExample ? String(current ?? '') : '',
        required: true,
        description: prop?.description,
        ...enumInput(doc, prop, warnings),
      });
      (sample as Record<string, unknown>)[field] = `{{${field}}}`;
    }
  }
  request.body = { type: 'json', raw: JSON.stringify(sample ?? {}, null, 2), fields: [] };
}

function formFields(doc: any, schema: any, warnings: WarningList): BodyField[] {
  const s = deref(doc, schema, warnings);
  return Object.entries<any>(s?.properties ?? {}).map(([key, prop]) => {
    const p = deref(doc, prop, warnings);
    const isFile = p?.format === 'binary' || p?.type === 'file';
    const sample = isFile ? '' : sampleFromSchema(doc, p, warnings);
    return {
      key,
      value: sample === null || sample === undefined ? '' : String(sample),
      enabled: true,
      kind: isFile ? 'file' : 'text',
    };
  });
}

function convertRequestBody(doc: any, operation: any, request: RequestSpec, warnings: WarningList): void {
  // OpenAPI 3
  const body = deref(doc, operation.requestBody, warnings);
  if (body?.content) {
    const types = Object.keys(body.content);
    const pick =
      types.find(t => /json/i.test(t)) ??
      types.find(t => t === 'application/x-www-form-urlencoded') ??
      types.find(t => t === 'multipart/form-data') ??
      types[0];
    const media = body.content[pick] ?? {};
    if (/json/i.test(pick)) {
      const example = media.example ?? (media.examples ? Object.values<any>(media.examples)[0]?.value : undefined);
      if (example !== undefined) request.body = { type: 'json', raw: JSON.stringify(example, null, 2), fields: [] };
      else jsonBody(doc, media.schema, request, warnings);
      if (pick !== 'application/json') request.headers.push({ key: 'Content-Type', value: pick, enabled: true });
    } else if (pick === 'application/x-www-form-urlencoded') {
      request.body = { type: 'form-urlencoded', raw: '', fields: formFields(doc, media.schema, warnings) };
    } else if (pick === 'multipart/form-data') {
      request.body = { type: 'multipart', raw: '', fields: formFields(doc, media.schema, warnings) };
    } else if (/xml/i.test(pick)) {
      request.body = { type: 'xml', raw: '', fields: [] };
    } else {
      request.body = { type: 'text', raw: '', fields: [] };
      request.headers.push({ key: 'Content-Type', value: pick, enabled: true });
    }
    return;
  }

  // Swagger 2: `in: body` / `in: formData` parameters
  const params: any[] = (operation.parameters ?? []).map((p: any) => deref(doc, p, warnings));
  const bodyParam = params.find(p => p?.in === 'body');
  if (bodyParam) {
    jsonBody(doc, bodyParam.schema, request, warnings);
    return;
  }
  const formParams = params.filter(p => p?.in === 'formData');
  if (formParams.length > 0) {
    const consumes: string[] = operation.consumes ?? doc.consumes ?? [];
    const multipart = consumes.includes('multipart/form-data') || formParams.some(p => p.type === 'file');
    request.body = {
      type: multipart ? 'multipart' : 'form-urlencoded',
      raw: '',
      fields: formParams.map(p => ({
        key: String(p.name),
        value: p.type === 'file' ? '' : exampleString(doc, p, warnings),
        enabled: true,
        kind: p.type === 'file' ? 'file' : 'text',
      })),
    };
  }
}

const SKIPPED_HEADERS = new Set(['authorization', 'content-type', 'accept']);

function convertOperation(
  doc: any,
  path: string,
  method: string,
  pathItem: any,
  envVars: Map<string, string>,
  warnings: WarningList,
): ImportedTemplate {
  const operation = pathItem[method];
  const request = emptyRequest();
  request.method = method.toUpperCase() as HttpMethod;
  request.url = `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`;

  // Operation-level parameters override path-level ones with the same name + location.
  const merged = new Map<string, any>();
  for (const raw of [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]) {
    const p = deref(doc, raw, warnings);
    if (p?.name && p?.in) merged.set(`${p.in}:${p.name}`, p);
  }

  for (const p of merged.values()) {
    const name = String(p.name);
    const example = exampleString(doc, p, warnings);
    if (p.in === 'path') {
      addParam(request.params, { name, default: inputDefault(doc, p, example, warnings), required: true, description: p.description, ...enumInput(doc, p, warnings) });
    } else if (p.in === 'query' || p.in === 'header') {
      if (p.in === 'header' && SKIPPED_HEADERS.has(name.toLowerCase())) continue;
      const rows = p.in === 'query' ? request.query : request.headers;
      if (p.required) {
        rows.push({ key: name, value: `{{${name}}}`, enabled: true, description: p.description });
        addParam(request.params, { name, default: inputDefault(doc, p, example, warnings), required: true, description: p.description, ...enumInput(doc, p, warnings) });
      } else {
        rows.push({ key: name, value: example, enabled: false, description: p.description });
      }
    } else if (p.in === 'cookie') {
      warnings.add('Cookie parameters are not supported and were skipped');
    }
  }

  convertRequestBody(doc, operation, request, warnings);
  request.auth = convertSecurity(doc, operation, envVars, warnings);

  const name = String(operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`).trim();
  const folder = Array.isArray(operation.tags) && operation.tags.length > 0 ? String(operation.tags[0]) : '';
  return { name, folder, request };
}

export function importOpenApi(doc: any): ImportResult {
  const warnings = new WarningList();
  const templates: ImportedTemplate[] = [];
  const envVars = new Map<string, string>();

  for (const [path, rawItem] of Object.entries<any>(doc.paths ?? {})) {
    const pathItem = deref(doc, rawItem, warnings);
    for (const method of METHODS) {
      if (!pathItem?.[method]) continue;
      if (pathItem[method].deprecated) warnings.add('Deprecated operations were imported too');
      templates.push(convertOperation(doc, path, method, pathItem, envVars, warnings));
    }
  }

  const name = String(doc.info?.title || 'API');
  const baseUrl = baseUrlOf(doc);
  if (!baseUrl) warnings.add('No server URL in the spec; set baseUrl in the environment');
  const variables: EnvVariable[] = [
    { key: 'baseUrl', value: baseUrl, enabled: true },
    ...[...envVars].map(([key, value]) => ({ key, value, enabled: true, secret: key !== 'username' || undefined })),
  ];

  return {
    kind: 'openapi',
    name,
    templates,
    environments: [{ name, variables }],
    warnings: warnings.list(),
  };
}
