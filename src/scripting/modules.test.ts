import { describe, expect, it } from 'vitest';
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
