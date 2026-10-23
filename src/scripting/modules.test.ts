import { describe, expect, it } from 'vitest';
import { createMoment } from './moment';
import { executeScript, type ScriptContext } from './sandbox';

const ctx = (): ScriptContext => ({
  kind: 'after',
  requestName: 'Test',
  envName: null,
  env: {},
  inputs: {},
  request: { method: 'GET', url: 'https://api.test/x', query: [], headers: [], body: { mode: 'none', raw: '' } },
  response: { code: 200, status: 'OK', headers: [], body: '{}', bodyBase64: null, responseTime: 5, responseSize: 2 },
});

const noNetwork = { sendRequest: async () => ctx().response! };

async function run(code: string): Promise<string> {
  const out = await executeScript(code, ctx(), noNetwork);
  if (out.error) throw new Error(out.error);
  return out.logs.at(-1)?.message ?? '';
}

/** Run `fn` as if the machine were in `tz`; the host timezone is restored afterwards. */
function withTz<T>(tz: string, fn: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

describe('script modules', () => {
  it('hashes with crypto-js and encodes the digest', async () => {
    expect(
      await run(`
        const CryptoJS = require('crypto-js');
        console.log([
          CryptoJS.SHA256('abc').toString(),
          CryptoJS.MD5('abc').toString(),
          CryptoJS.SHA256('abc').toString(CryptoJS.enc.Base64),
          CryptoJS.HmacSHA256('message', 'secret').toString(),
          CryptoJS.SHA256('abc').toString(CryptoJS.enc.Base64url),
          CryptoJS.lib.WordArray.random(8).sigBytes,
        ].join(' '));
      `),
    ).toBe(
      [
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        '900150983cd24fb0d6963f7d28e17f72',
        'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
        '8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b',
        'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0=',
        '8',
      ].join(' '),
    );
  });

  it('hashes with node crypto and supports streaming updates', async () => {
    expect(
      await run(`
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update('a').update('bc').digest('hex');
        const hmac = crypto.createHmac('sha256', 'secret').update('message').digest('hex');
        console.log(hash + ' ' + hmac + ' ' + crypto.randomBytes(4).length);
      `),
    ).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad 8b5f48702995c1598c573db1e21866a9b825d4a794d169d7060a03605796360b 4',
    );
  });

  it('makes uuids and buffers', async () => {
    const out = await run(`
      const { expect } = require('chai');
      expect(1).to.equal(1);
      const { v4, validate } = require('uuid');
      const { Buffer } = require('buffer');
      console.log(validate(v4()) && Buffer.from('hi').toString('hex'));
    `);
    expect(out).toBe('6869');
  });

  it('provides lodash both as a module and as the _ global', async () => {
    expect(
      await run(`
        const _ = require('lodash');
        console.log(_.camelCase('hello world') + ' ' + _.get({ a: { b: 2 } }, 'a.b') + ' ' + _.uniq([1, 2, 2]).join('-'));
      `),
    ).toBe('helloWorld 2 1-2');

    const out = await executeScript(`console.log(_.kebabCase('Hello There') + ' ' + _.chunk([1, 2, 3], 2).length);`, ctx(), noNetwork);
    expect(out.logs.at(-1)?.message).toBe('hello-there 2');
  });

  it('formats and parses dates with moment', async () => {
    expect(
      await run(`
        const moment = require('moment');
        const m = moment.utc('2024-02-03T04:05:06Z');
        console.log([
          m.format('YYYY-MM-DD HH:mm:ss'),
          m.clone().add(1, 'day').format('DD/MM/YYYY'),
          moment('2024-02-03', 'YYYY-MM-DD').endOf('month').format('YYYY-MM-DD'),
          moment.utc(0).format('HH:mm'),
          m.diff(moment.utc('2024-02-01T04:05:06Z'), 'days'),
        ].join(' '));
      `),
    ).toBe('2024-02-03 04:05:06 04/02/2024 2024-02-29 00:00 2');
  });

  it('computes day-of-year from the calendar date, not the host timezone', async () => {
    expect(
      await run(`
        const moment = require('moment');
        console.log(['2024-01-01', '2024-01-03', '2024-02-29', '2024-12-31']
          .map(d => moment.utc(d + 'T02:00:00Z').format('DDD') + '/' + moment.utc(d + 'T02:00:00Z').format('DDDD'))
          .join(' '));
      `),
    ).toBe('1/001 3/003 60/060 366/366');

    // Hosts west of UTC used to shift (and even zero) the day-of-year.
    const moment = createMoment();
    for (const tz of ['America/Los_Angeles', 'Asia/Jakarta', 'UTC']) {
      withTz(tz, () => {
        expect(moment.utc('2024-01-03').format('DDD')).toBe('3');
        expect(moment.utc('2024-01-01T02:00:00Z').format('DDDD')).toBe('001');
      });
    }
  });

  it('applies a zone offset in a parsed string regardless of the host timezone', () => {
    const moment = createMoment();
    for (const tz of ['America/Los_Angeles', 'Asia/Jakarta', 'UTC']) {
      withTz(tz, () => {
        expect(moment('2024-07-01 12:00:00 -0400', 'YYYY-MM-DD HH:mm:ss ZZ').utc().format('HH:mm')).toBe('16:00');
        expect(moment('2024-07-01 12:00:00 +0700', 'YYYY-MM-DD HH:mm:ss ZZ').utc().format('HH:mm')).toBe('05:00');
      });
    }
  });

  it('fills buffers with strings and tolerates empty concatenations', async () => {
    expect(
      await run(`
        const { Buffer } = require('buffer');
        console.log([
          Buffer.alloc(4, 'a').toString(),
          Buffer.alloc(3, 'ab').toString(),
          Buffer.alloc(2, 7).toString('hex'),
          Buffer.alloc(0).length,
          Buffer.concat([]).length,
          Buffer.concat([Buffer.alloc(0), Buffer.from('x')]).toString(),
        ].join('|'));
      `),
    ).toBe('aaaa|aba|0707|0|0|x');
  });

  it('keeps chai assert.equal loose and assert.strictEqual strict', async () => {
    expect(
      await run(`
        const assert = require('chai').assert;
        assert.equal('1', 1);
        assert.equal(0, false);
        let strictThrew = false;
        try { assert.strictEqual('1', 1); } catch { strictThrew = true; }
        let messageKept = false;
        try { assert.equal(1, 2, 'nope'); } catch (e) { messageKept = e.message === 'nope'; }
        console.log(strictThrew && messageKept ? 'ok' : 'bad');
      `),
    ).toBe('ok');
  });

  it('refuses to write prototype keys from lodash setters and mergers', async () => {
    expect(
      await run(`
        const _ = require('lodash');
        _.set({}, '__proto__.polluted', 'yes');
        _.set({}, ['a', '__proto__', 'polluted'], 'yes');
        _.unset({}, '__proto__.polluted');
        _.merge({}, JSON.parse('{"__proto__":{"polluted":"yes"}}'));
        _.merge({}, JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}}}'));
        _.assign({}, JSON.parse('{"__proto__":{"polluted":"yes"}}'));
        _.defaults({}, JSON.parse('{"__proto__":{"polluted":"yes"}}'));
        _.pick({}, ['__proto__.polluted']);
        console.log(String(({}).polluted) + ' ' + String([].polluted));
      `),
    ).toBe('undefined undefined');
  });

  it('explains unavailable pm APIs instead of failing on undefined', async () => {
    const cookies = await executeScript(`pm.cookies.get('session');`, ctx(), noNetwork);
    expect(cookies.error).toBe('pm.cookies is not available in KangPos scripts (cookie jars are not implemented).');

    const vault = await executeScript(`pm.vault.get('token');`, ctx(), noNetwork);
    expect(vault.error).toMatch(/^pm\.vault is not available in KangPos scripts/);

    // Everything Postman scripts do use still resolves.
    expect(await run(`console.log(pm.info.eventName + ' ' + typeof pm.visualizer.set + ' ' + typeof pm.variables.get);`)).toBe(
      'test function function',
    );
  });

  it('explains when a module or crypto-js algorithm is missing', async () => {
    const missing = await executeScript(`require('left-pad');`, ctx(), noNetwork);
    expect(missing.error).toMatch(/Built in: buffer, chai, crypto, crypto-js, lodash, moment, querystring, uuid/);

    const algorithm = await executeScript(`require('crypto-js').AES.encrypt('x', 'y');`, ctx(), noNetwork);
    expect(algorithm.error).toMatch(/CryptoJS\.AES is not available/);
  });

  it('hands pm.visualizer output back to the response view', async () => {
    const out = await executeScript(
      `pm.visualizer.set('<h1>{{title}}</h1>', { title: 'Orders' });`,
      ctx(),
      noNetwork,
    );
    expect(out.visualizer).toEqual({ template: '<h1>{{title}}</h1>', data: { title: 'Orders' } });
  });
});
