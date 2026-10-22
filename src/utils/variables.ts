// {{placeholder}} resolution.
//
// One syntax for both kinds of value: a name declared as a template param is
// filled from the tab's params form; any other name comes from the active
// environment. Postman-style dynamic variables ({{$guid}}, ...) are generated.

import type { EnvVariable, ParamValues, TemplateParam } from '../types';

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

export type VariableSource = 'param' | 'env' | 'dynamic' | 'unresolved';

export interface ResolveContext {
  params: TemplateParam[];
  paramValues: ParamValues;
  env: EnvVariable[];
}

const DYNAMIC: Record<string, () => string> = {
  $guid: () => crypto.randomUUID(),
  $randomUUID: () => crypto.randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
};

export function isDynamicVariable(name: string): boolean {
  return name in DYNAMIC;
}

/** Every placeholder name in `text`, in order of first appearance. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER)) seen.add(match[1]);
  return [...seen];
}

function envLookup(env: EnvVariable[], name: string): string | undefined {
  // Later rows win, matching how people override a value further down the list.
  let value: string | undefined;
  for (const v of env) if (v.enabled && v.key === name) value = v.value;
  return value;
}

/** Where a placeholder's value would come from. */
export function classifyVariable(name: string, ctx: ResolveContext): VariableSource {
  if (ctx.params.some(p => p.name === name)) return 'param';
  if (isDynamicVariable(name)) return 'dynamic';
  if (envLookup(ctx.env, name) !== undefined) return 'env';
  return 'unresolved';
}

/** Current value of a param: the tab's value, or the template default when the tab has none. */
export function paramValue(param: TemplateParam, values: ParamValues): string {
  const v = values[param.name];
  return v !== undefined && v !== '' ? v : param.default;
}

/**
 * Replace placeholders. Environment values may themselves contain placeholders
 * (e.g. `url = {{host}}/api`), so values are expanded a few levels deep.
 * Unknown names are left as-is and reported in `unresolved`.
 */
export function resolveText(
  text: string,
  ctx: ResolveContext,
  unresolved?: Set<string>,
  depth = 0,
): string {
  return text.replace(PLACEHOLDER, (whole, rawName: string) => {
    const name = rawName.trim();
    const param = ctx.params.find(p => p.name === name);
    let value: string | undefined;
    if (param) value = paramValue(param, ctx.paramValues);
    else if (isDynamicVariable(name)) value = DYNAMIC[name]();
    else value = envLookup(ctx.env, name);

    if (value === undefined) {
      unresolved?.add(name);
      return whole;
    }
    return depth < 5 ? resolveText(value, ctx, unresolved, depth + 1) : value;
  });
}

/** Required params with no value (neither typed in nor defaulted). */
export function missingRequiredParams(params: TemplateParam[], values: ParamValues): TemplateParam[] {
  return params.filter(p => p.required && paramValue(p, values).trim() === '');
}

/** Initial values for a new tab: every param starts at its default. */
export function defaultParamValues(params: TemplateParam[]): ParamValues {
  return Object.fromEntries(params.map(p => [p.name, p.default]));
}

export interface VariableSuggestion {
  name: string;
  source: 'param' | 'env' | 'dynamic';
  /** Value to show next to the name; secrets are masked. */
  preview: string;
}

/**
 * If the text before the caret ends inside an unfinished `{{name`, return the
 * partial name typed so far (possibly ''); otherwise null.
 */
export function placeholderPrefix(textBeforeCaret: string): string | null {
  const m = /\{\{\s*([^{}\s]*)$/.exec(textBeforeCaret);
  return m ? m[1] : null;
}

/** Names that can complete `{{prefix`: inputs first, then environment, then dynamic. */
export function variableSuggestions(ctx: ResolveContext, prefix: string): VariableSuggestion[] {
  const q = prefix.toLowerCase();
  const matches = (name: string) => name.toLowerCase().includes(q);
  const out: VariableSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: VariableSuggestion) => {
    if (seen.has(s.name) || !matches(s.name)) return;
    seen.add(s.name);
    out.push(s);
  };

  for (const p of ctx.params) {
    if (p.name.trim()) push({ name: p.name, source: 'param', preview: paramValue(p, ctx.paramValues) });
  }
  for (const v of ctx.env) {
    if (v.enabled && v.key.trim()) push({ name: v.key, source: 'env', preview: v.secret ? '••••••' : v.value });
  }
  for (const name of Object.keys(DYNAMIC)) push({ name, source: 'dynamic', preview: 'generated on send' });

  // Names that start with the prefix rank above ones that only contain it.
  return out.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
}

/** Resolved value for a hover, with secret environment values masked. */
export function previewValue(name: string, ctx: ResolveContext): string {
  if (classifyVariable(name, ctx) === 'env' && ctx.env.some(v => v.enabled && v.key === name && v.secret)) return '••••••';
  if (isDynamicVariable(name)) return 'generated on send';
  return resolveText(`{{${name}}}`, ctx);
}

/** Parse a dropdown's options as typed by the user: comma- or line-separated, trimmed, no duplicates. */
export function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const option = part.trim();
    if (option) seen.add(option);
  }
  return [...seen];
}

export function isSelect(param: TemplateParam): boolean {
  return param.type === 'select';
}
