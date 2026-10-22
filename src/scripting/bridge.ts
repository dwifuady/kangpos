// Conversions between KangPos requests/responses and what scripts see.

import type { EnvVariable, HttpResponse, ParamValues, RequestSpec, ScriptRunInfo, TemplateParam } from '../types';
import type { BuiltRequest } from '../utils/request';
import { paramValue } from '../utils/variables';
import type { SandboxRequest, SandboxResponse, ScriptOutcome } from './sandbox';

const RAW_TYPES = new Set(['json', 'text', 'xml']);

/** Before scripts see the request with {{placeholders}} still in it, like Postman. */
export function toSandboxRequest(spec: RequestSpec): SandboxRequest {
  const t = spec.body.type;
  const mode = RAW_TYPES.has(t) ? 'raw' : t === 'form-urlencoded' ? 'urlencoded' : t === 'multipart' ? 'formdata' : 'none';
  return {
    method: spec.method,
    url: spec.url,
    query: spec.query.map(q => ({ key: q.key, value: q.value, enabled: q.enabled })),
    headers: spec.headers.map(h => ({ key: h.key, value: h.value, enabled: h.enabled })),
    body: { mode, raw: mode === 'raw' ? spec.body.raw : '' },
  };
}

/** Apply a before script's edits to the request that will be sent (not saved to the tab). */
export function applySandboxRequest(spec: RequestSpec, edited: SandboxRequest): RequestSpec {
  const method = (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).find(m => m === edited.method) ?? spec.method;
  return {
    ...spec,
    method,
    url: edited.url,
    query: edited.query.map(q => ({ ...q })),
    headers: edited.headers.map(h => ({ ...h })),
    body: RAW_TYPES.has(spec.body.type) ? { ...spec.body, raw: edited.body.raw } : spec.body,
  };
}

/** After scripts see the request exactly as it went out. */
export function builtToSandbox(built: BuiltRequest): SandboxRequest {
  return {
    method: built.method,
    url: built.url,
    query: [],
    headers: built.headers.map(([key, value]) => ({ key, value, enabled: true })),
    body: built.body.type === 'raw' ? { mode: 'raw', raw: built.body.content } : { mode: built.body.type === 'multipart' ? 'formdata' : 'none', raw: '' },
  };
}

export function toSandboxResponse(r: HttpResponse): SandboxResponse {
  return {
    code: r.status,
    status: r.statusText,
    headers: r.headers,
    body: r.body,
    bodyBase64: r.bodyBase64,
    responseTime: r.durationMs,
    responseSize: r.sizeBytes,
  };
}

/** Enabled environment variables as a map (later rows win, as in resolution). */
export function envMap(vars: EnvVariable[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of vars) if (v.enabled && v.key) out[v.key] = v.value;
  return out;
}

export function inputMap(params: TemplateParam[], values: ParamValues): Record<string, string> {
  return Object.fromEntries(params.filter(p => p.name).map(p => [p.name, paramValue(p, values)]));
}

/** Apply pm.environment.set/unset to a variable list, keeping flags of existing rows. */
export function applyEnvChanges(vars: EnvVariable[], changes: Record<string, string | null>): EnvVariable[] {
  let next = vars.map(v => ({ ...v }));
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) {
      next = next.filter(v => v.key !== key);
      continue;
    }
    const existing = next.filter(v => v.key === key);
    if (existing.length > 0) {
      for (const v of existing) {
        v.value = value;
        v.enabled = true;
      }
    } else {
      next.push({ key, value, enabled: true });
    }
  }
  return next;
}

export function runInfo(outcome: ScriptOutcome): ScriptRunInfo {
  return { tests: outcome.tests, logs: outcome.logs, error: outcome.error, durationMs: outcome.durationMs };
}
