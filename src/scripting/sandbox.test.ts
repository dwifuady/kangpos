import { describe, expect as vexpect, it } from 'vitest';
import { executeScript, toOutgoing, type ScriptContext, type ScriptHooks, type SandboxResponse } from './sandbox';

const noNetwork: ScriptHooks = {
  sendRequest: async () => {
    throw new Error('no network in this test');
  },
};

function ctx(overrides: Partial<ScriptContext> = {}): ScriptContext {
  return {
    kind: 'before',
    requestName: 'Get contact',
    envName: 'Dev',
    env: { baseUrl: 'https://api.test', token: 'old' },
    inputs: { id: '42' },
    request: {
      method: 'GET',
      url: '{{baseUrl}}/contacts/{{id}}',
      query: [{ key: 'expand', value: 'true', enabled: true }],
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      body: { mode: 'none', raw: '' },
    },
    ...overrides,
  };
}

const okJson: SandboxResponse = {
  code: 200,
  status: 'OK',
  headers: [['Content-Type', 'application/json']],
  body: JSON.stringify({ access_token: 'abc123', user: { id: 7, roles: ['admin'] } }),
  bodyBase64: null,
  responseTime: 85,
  responseSize: 60,
};

describe('before scripts', () => {
  it('reads and changes environment, variables and the request', async () => {
    const out = await executeScript(
      `
      pm.environment.set('token', 'new-' + pm.environment.get('token'));
      pm.environment.unset('baseUrl');
      pm.variables.set('signature', 'sig-' + pm.variables.get('id'));
      pm.request.headers.add({ key: 'X-Signature', value: '{{signature}}' });
      pm.request.headers.upsert({ key: 'accept', value: 'text/plain' });
      pm.request.url.query.add('page=2');
      pm.request.method = 'post';
      console.log('url is', pm.request.url.toString(), { n: 1 });
      `,
      ctx(),
      noNetwork,
    );
    vexpect(out.error).toBeUndefined();
    vexpect(out.envChanges).toEqual({ token: 'new-old', baseUrl: null });
    vexpect(out.locals).toEqual({ signature: 'sig-42' });
    vexpect(out.request.method).toBe('POST');
    vexpect(out.request.headers).toEqual([
      { key: 'Accept', value: 'text/plain', enabled: true },
      { key: 'X-Signature', value: '{{signature}}', enabled: true },
    ]);
    vexpect(out.request.query.map(q => `${q.key}=${q.value}`)).toEqual(['expand=true', 'page=2']);
    vexpect(out.logs[0]).toEqual({ level: 'log', message: 'url is {{baseUrl}}/contacts/{{id}}?expand=true&page=2 {\n  "n": 1\n}' });
  });

  it('maps collection and global variables to the environment, and replaces placeholders', async () => {
    const out = await executeScript(
      `pm.collectionVariables.set('a', 1); pm.globals.set('b', { x: true });
       console.log(pm.variables.replaceIn('{{baseUrl}}/{{id}}/{{nope}}'));`,
      ctx(),
      noNetwork,
    );
    vexpect(out.envChanges).toEqual({ a: '1', b: '{"x":true}' });
    vexpect(out.logs[0].message).toBe('https://api.test/42/{{nope}}');
  });

  it('reports errors with a clear message and keeps earlier changes out', async () => {
    const out = await executeScript(`pm.environment.set('x', 1); const CryptoJS = require('crypto-js');`, ctx(), noNetwork);
    vexpect(out.error).toMatch(/require\(\) is not available/);
    vexpect(out.logs.at(-1)?.level).toBe('error');
  });

  it('awaits pm.sendRequest with callback or promise style', async () => {
    const sent: string[] = [];
    const hooks: ScriptHooks = {
      sendRequest: async req => {
        sent.push(`${req.method} ${req.url} ${JSON.stringify(req.headers)} ${req.body ?? ''}`);
        return okJson;
      },
    };
    const out = await executeScript(
      `
      pm.sendRequest({
        url: pm.environment.get('baseUrl') + '/login',
        method: 'POST',
        header: [{ key: 'Content-Type', value: 'application/json' }],
        body: { mode: 'raw', raw: JSON.stringify({ user: 'a' }) },
      }, (err, res) => {
        pm.environment.set('token', res.json().access_token);
      });
      const again = await pm.sendRequest('https://api.test/ping');
      pm.variables.set('pingStatus', again.code);
      `,
      ctx(),
      hooks,
    );
    vexpect(out.error).toBeUndefined();
    vexpect(sent).toEqual([
      'POST https://api.test/login [["Content-Type","application/json"]] {"user":"a"}',
      'GET https://api.test/ping [] ',
    ]);
    vexpect(out.envChanges.token).toBe('abc123');
    vexpect(out.locals.pingStatus).toBe('200');
    vexpect(out.logs.map(l => l.message)).toContain('→ POST https://api.test/login');
  });

  it('reports a failed pm.sendRequest to the callback', async () => {
    const out = await executeScript(
      `pm.sendRequest('https://down.test', (err, res) => { console.log('err:', err.message, res === undefined); });`,
      ctx(),
      noNetwork,
    );
    vexpect(out.error).toBeUndefined();
    vexpect(out.logs.map(l => l.message)).toContain('err: no network in this test true');
  });
});

describe('after scripts', () => {
  const after = (overrides: Partial<ScriptContext> = {}) => ctx({ kind: 'after', response: okJson, ...overrides });

  it('runs pm.test / pm.expect and saves values from the response', async () => {
    const out = await executeScript(
      `
      pm.test('status is 200', () => pm.response.to.have.status(200));
      pm.test('is ok', () => { pm.response.to.be.ok; });
      pm.test('has token', () => {
        const body = pm.response.json();
        pm.expect(body).to.have.property('access_token');
        pm.expect(body.user.roles).to.include('admin');
        pm.expect(body.user.id).to.be.a('number').and.to.be.above(5);
        pm.expect(pm.response.headers.get('content-type')).to.match(/json/);
        pm.expect(pm.response.responseTime).to.be.below(1000);
        pm.environment.set('token', body.access_token);
      });
      pm.test('fails', () => pm.expect(pm.response.code).to.equal(201));
      pm.test('async', async () => { await Promise.resolve(); pm.expect(1).to.not.equal(2); });
      tests['legacy works'] = responseCode.code === 200;
      `,
      after(),
      noNetwork,
    );
    vexpect(out.error).toBeUndefined();
    vexpect(out.tests.map(t => [t.name, t.passed])).toEqual([
      ['status is 200', true],
      ['is ok', true],
      ['has token', true],
      ['fails', false],
      ['legacy works', true],
      ['async', true],
    ]);
    vexpect(out.tests[3].error).toBe('expected 200 to equal 201');
    vexpect(out.envChanges).toEqual({ token: 'abc123' });
  });

  it('does not let after scripts change the request', async () => {
    const out = await executeScript(`pm.request.headers.add({ key: 'X', value: '1' });`, after(), noNetwork);
    vexpect(out.error).toMatch(/read-only/);
  });

  it('explains when the body is not JSON', async () => {
    const out = await executeScript(
      `pm.test('json', () => pm.response.json());`,
      after({ response: { ...okJson, body: '<html>oops</html>' } }),
      noNetwork,
    );
    vexpect(out.tests[0].passed).toBe(false);
    vexpect(out.tests[0].error).toMatch(/not valid JSON/);
  });
});

describe('expect', () => {
  it('covers the common chai assertions', async () => {
    const out = await executeScript(
      `
      const e = pm.expect;
      pm.test('a', () => { e([1,2]).to.have.lengthOf(2); e({a:{b:1}}).to.eql({a:{b:1}}); e('abc').to.include('b'); e(null).to.be.null; e([]).to.be.empty; });
      pm.test('b', () => { e(3).to.be.within(1, 5); e('x').to.be.oneOf(['x','y']); e({a:1,b:2}).to.include({a:1}); e({a:1}).to.have.keys('a'); });
      pm.test('c', () => { e(undefined).to.not.exist; e(true).to.be.true; e(0).to.not.be.ok; e({id: 3}).to.have.property('id', 3); });
      pm.test('d', () => e({id: 3}).to.have.property('id', 4));
      `,
      ctx(),
      noNetwork,
    );
    vexpect(out.tests.map(t => t.passed)).toEqual([true, true, true, false]);
    vexpect(out.tests[3].error).toBe("expected property 'id' to equal 4 (got 3)");
  });
});

describe('toOutgoing', () => {
  it('accepts Postman request shapes', () => {
    vexpect(toOutgoing('https://x.test')).toEqual({ method: 'GET', url: 'https://x.test', headers: [] });
    vexpect(
      toOutgoing({ url: { raw: 'https://x.test/a' }, method: 'post', header: { A: 1 }, body: { mode: 'urlencoded', urlencoded: [{ key: 'u', value: 'a b' }] } }),
    ).toEqual({
      method: 'POST',
      url: 'https://x.test/a',
      headers: [['A', '1'], ['Content-Type', 'application/x-www-form-urlencoded']],
      body: 'u=a%20b',
    });
  });
});
