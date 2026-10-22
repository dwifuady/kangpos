import { describe, expect, it } from 'vitest';
import { emptyRequest, type RequestSpec } from '../types';
import { appendQuery, buildRequest, requestVariables, tabTitle, toCurl, withScheme } from './request';
import { classifyVariable, missingRequiredParams, resolveText, type ResolveContext } from './variables';

function spec(overrides: Partial<RequestSpec>): RequestSpec {
  return { ...emptyRequest(), ...overrides };
}

const ctx: ResolveContext = {
  params: [
    { name: 'id', default: '', required: true },
    { name: 'status', default: 'active', required: false },
  ],
  paramValues: { id: '42' },
  env: [
    { key: 'baseUrl', value: 'https://api.test/{{version}}', enabled: true },
    { key: 'version', value: 'v1', enabled: true },
    { key: 'token', value: 'abc', enabled: true },
    { key: 'off', value: 'x', enabled: false },
  ],
};

describe('variables', () => {
  it('resolves params, then env, with nested env values', () => {
    expect(resolveText('{{baseUrl}}/contacts/{{id}}?s={{status}}', ctx)).toBe(
      'https://api.test/v1/contacts/42?s=active',
    );
  });

  it('leaves unknown and disabled names and reports them', () => {
    const missing = new Set<string>();
    expect(resolveText('{{nope}} {{off}}', ctx, missing)).toBe('{{nope}} {{off}}');
    expect([...missing]).toEqual(['nope', 'off']);
  });

  it('a param shadows an env var with the same name', () => {
    const c: ResolveContext = { ...ctx, params: [{ name: 'token', default: 'p', required: false }] };
    expect(resolveText('{{token}}', c)).toBe('p');
    expect(classifyVariable('token', c)).toBe('param');
  });

  it('generates dynamic variables', () => {
    expect(resolveText('{{$guid}}', ctx)).toMatch(/^[0-9a-f-]{36}$/);
    expect(classifyVariable('$timestamp', ctx)).toBe('dynamic');
  });

  it('flags required params that are empty', () => {
    expect(missingRequiredParams(ctx.params, {})).toHaveLength(1);
    expect(missingRequiredParams(ctx.params, { id: '1' })).toHaveLength(0);
  });
});

describe('buildRequest', () => {
  it('builds url, query, auth and json body', () => {
    const built = buildRequest(
      spec({
        method: 'POST',
        url: '{{baseUrl}}/contacts/{{id}}',
        query: [
          { key: 'a', value: '1 2', enabled: true },
          { key: 'b', value: 'skip', enabled: false },
        ],
        headers: [{ key: 'X-Trace', value: '{{id}}', enabled: true }],
        body: { type: 'json', raw: '{"id": "{{id}}"}', fields: [] },
        auth: { type: 'bearer', token: '{{token}}' },
      }),
      ctx,
    );
    expect(built.url).toBe('https://api.test/v1/contacts/42?a=1%202');
    expect(built.headers).toEqual([
      ['X-Trace', '42'],
      ['Authorization', 'Bearer abc'],
      ['Content-Type', 'application/json'],
    ]);
    expect(built.body).toEqual({ type: 'raw', content: '{"id": "42"}' });
    expect(built.unresolved).toEqual([]);
  });

  it('does not override an explicit Content-Type or Authorization header', () => {
    const built = buildRequest(
      spec({
        url: 'http://x',
        headers: [
          { key: 'content-type', value: 'application/vnd.api+json', enabled: true },
          { key: 'Authorization', value: 'Custom', enabled: true },
        ],
        body: { type: 'json', raw: '{}', fields: [] },
        auth: { type: 'bearer', token: 't' },
      }),
      ctx,
    );
    expect(built.headers).toEqual([
      ['content-type', 'application/vnd.api+json'],
      ['Authorization', 'Custom'],
    ]);
  });

  it('encodes form bodies and basic auth', () => {
    const built = buildRequest(
      spec({
        url: 'localhost:5000/login',
        body: {
          type: 'form-urlencoded',
          raw: '',
          fields: [{ key: 'user', value: 'a b&c', enabled: true, kind: 'text' }],
        },
        auth: { type: 'basic', username: 'ü', password: 'p' },
      }),
      ctx,
    );
    expect(built.url).toBe('http://localhost:5000/login');
    expect(built.body).toEqual({ type: 'raw', content: 'user=a%20b%26c' });
    expect(built.headers[0]).toEqual(['Authorization', 'Basic w7w6cA==']);
  });

  it('puts an api key in the query when asked', () => {
    const built = buildRequest(
      spec({ url: 'http://x/a?z=1#top', auth: { type: 'apikey', key: 'key', value: '{{token}}', in: 'query' } }),
      ctx,
    );
    expect(built.url).toBe('http://x/a?z=1&key=abc#top');
  });

  it('reports unresolved placeholders', () => {
    const built = buildRequest(spec({ url: '{{missingHost}}/x' }), ctx);
    expect(built.unresolved).toEqual(['missingHost']);
  });
});

describe('helpers', () => {
  it('appendQuery handles existing separators', () => {
    expect(appendQuery('http://x?', [['a', '1']])).toBe('http://x?a=1');
    expect(appendQuery('http://x', [])).toBe('http://x');
  });

  it('withScheme keeps explicit schemes', () => {
    expect(withScheme('https://a')).toBe('https://a');
    expect(withScheme('a.com')).toBe('http://a.com');
  });

  it('collects variables across the request', () => {
    expect(
      requestVariables(
        spec({
          url: '{{baseUrl}}/c/{{id}}',
          headers: [{ key: 'X', value: '{{tenant}}', enabled: true }],
          auth: { type: 'bearer', token: '{{token}}' },
        }),
      ),
    ).toEqual(['baseUrl', 'id', 'tenant', 'token']);
  });

  it('titles tabs from template and key param', () => {
    const request = spec({ url: '{{baseUrl}}/contacts/{{id}}', params: ctx.params });
    expect(tabTitle({ custom_title: null, template_name: 'Get contact', request, param_values: { id: '10045' } })).toBe(
      'Get contact · 10045',
    );
    // No required value: falls back to the first param with a value (the default).
    expect(tabTitle({ custom_title: null, template_name: 'Get contact', request, param_values: {} })).toBe(
      'Get contact · active',
    );
    expect(tabTitle({ custom_title: 'Mine', template_name: 'Get contact', request, param_values: {} })).toBe('Mine');
    expect(
      tabTitle({ custom_title: null, template_name: null, request: spec({ url: '{{baseUrl}}/users/1?x=1' }), param_values: {} }),
    ).toBe('GET /users/1');
  });

  it('renders cURL with shell quoting', () => {
    const curl = toCurl({
      method: 'POST',
      url: 'http://x',
      headers: [['A', "it's"]],
      body: { type: 'raw', content: '{}' },
      unresolved: [],
    });
    expect(curl).toBe(`curl -X POST 'http://x' \\\n  -H 'A: it'\\''s' \\\n  --data-raw '{}'`);
  });
});

import { formatJsonWithPlaceholders } from './format';

describe('formatJsonWithPlaceholders', () => {
  it('keeps placeholders inside and outside strings', () => {
    expect(formatJsonWithPlaceholders('{"id":"{{id}}","age":{{age}},"n":"a {{x}} b"}')).toBe(
      '{\n  "id": "{{id}}",\n  "age": {{age}},\n  "n": "a {{x}} b"\n}',
    );
  });

  it('handles escaped quotes and returns null for invalid JSON', () => {
    expect(formatJsonWithPlaceholders('{"q":"say \\"{{w}}\\""}')).toBe('{\n  "q": "say \\"{{w}}\\""\n}');
    expect(formatJsonWithPlaceholders('{nope')).toBeNull();
  });
});

import { addParamsAsQuery, unusedParams } from './request';

describe('unused inputs', () => {
  const params = [
    { name: 'blok', default: '', required: false },
    { name: 'nomor', default: '', required: false },
  ];

  it('finds inputs no placeholder refers to', () => {
    expect(unusedParams(spec({ url: 'http://x/pdf', params })).map(p => p.name)).toEqual(['blok', 'nomor']);
    expect(
      unusedParams(spec({ url: 'http://x/pdf', params, query: [{ key: 'blok', value: '{{blok}}', enabled: true }] })).map(p => p.name),
    ).toEqual(['nomor']);
  });

  it('adds them as query params, which then get sent', () => {
    const withQuery = addParamsAsQuery(spec({ url: 'http://x/pdf', params }), params);
    expect(withQuery.query).toEqual([
      { key: 'blok', value: '{{blok}}', enabled: true },
      { key: 'nomor', value: '{{nomor}}', enabled: true },
    ]);
    const built = buildRequest(withQuery, { params, paramValues: { blok: 'C5', nomor: '7' }, env: [] });
    expect(built.url).toBe('http://x/pdf?blok=C5&nomor=7');
    expect(unusedParams(withQuery)).toEqual([]);
  });

  it('does not duplicate an existing query row', () => {
    const s = spec({ url: 'http://x', params, query: [{ key: 'blok', value: 'fixed', enabled: true }] });
    expect(addParamsAsQuery(s, params).query.map(q => q.key)).toEqual(['blok', 'nomor']);
  });
});

import { checkJsonWithPlaceholders } from './format';
import { placeholderPrefix, previewValue, variableSuggestions } from './variables';

describe('variable autocomplete', () => {
  const c: ResolveContext = {
    params: [{ name: 'nama', default: '', required: true }],
    paramValues: { nama: 'Budi' },
    env: [
      { key: 'baseUrl', value: 'https://x', enabled: true },
      { key: 'token', value: 'secret-value', enabled: true, secret: true },
      { key: 'nameOld', value: 'x', enabled: false },
    ],
  };

  it('detects an unfinished placeholder before the caret', () => {
    expect(placeholderPrefix('{{baseUrl}}/a/{{na')).toBe('na');
    expect(placeholderPrefix('"x": "{{')).toBe('');
    expect(placeholderPrefix('{{baseUrl}}/a')).toBeNull();
    expect(placeholderPrefix('{ "a": 1')).toBeNull();
  });

  it('suggests inputs, enabled env vars and dynamic vars, masking secrets', () => {
    const all = variableSuggestions(c, '');
    expect(all.slice(0, 3)).toEqual([
      { name: 'nama', source: 'param', preview: 'Budi' },
      { name: 'baseUrl', source: 'env', preview: 'https://x' },
      { name: 'token', source: 'env', preview: '••••••' },
    ]);
    expect(all.some(s => s.name === 'nameOld')).toBe(false);
    expect(all.some(s => s.name === '$guid')).toBe(true);
    expect(variableSuggestions(c, 'TO').map(s => s.name)).toEqual(['token']);
    expect(variableSuggestions(c, 'time').map(s => s.name)).toEqual(['$timestamp', '$isoTimestamp']);
    expect(previewValue('token', c)).toBe('••••••');
    expect(previewValue('nama', c)).toBe('Budi');
  });
});

describe('checkJsonWithPlaceholders', () => {
  it('accepts placeholders as string contents or bare values', () => {
    expect(checkJsonWithPlaceholders('{"nama": "{{nama}}", "jumlah": {{jumlah}}}')).toBeNull();
    expect(checkJsonWithPlaceholders('{\n  "nama": {{nama}}\n}')).toBeNull();
    expect(checkJsonWithPlaceholders('')).toBeNull();
  });

  it('points at real errors in the original text', () => {
    const text = '{"a": "{{x}}" "b": 1}';
    const problem = checkJsonWithPlaceholders(text);
    expect(problem).not.toBeNull();
    expect(text.slice(problem!.offset)).toBe('"b": 1}');
  });
});
