// Modules available to scripts through `require()`.
//
// Postman ships a handful of libraries in its sandbox. KangPos provides the
// ones request scripts use in practice, implemented locally so the sandbox
// stays self-contained: `crypto-js`, `crypto`, `uuid`, `lodash`, `moment`,
// `buffer` and `querystring`. Unknown modules raise a clear error instead of
// pretending.

/* eslint-disable @typescript-eslint/no-explicit-any -- module APIs mirror untyped libraries */

import { AssertionError, expect, inspect } from './expect';
import { base64ToBytes, bytesToBase64, bytesToHex, hashBytes, hashName, hexToBytes, hmac, utf8Bytes, type HashName } from './hash';
import { createLodash } from './lodash';
import { createMoment } from './moment';

export const BUILTIN_MODULES = ['buffer', 'chai', 'crypto', 'crypto-js', 'lodash', 'moment', 'querystring', 'uuid'] as const;

const TEXT_DECODER = new TextDecoder();

type Bytes = Uint8Array;

function concatBytes(chunks: Bytes[]): Bytes {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/* ---------------------------------- buffer --------------------------------- */

class ByteArray extends Uint8Array {
  toString(encoding: 'utf8' | 'hex' | 'base64' | 'base64url' | 'latin1' | 'binary' | 'ascii' = 'utf8'): string {
    return encodeBytes(this, encoding);
  }

  toJSON(): { type: string; data: number[] } {
    return { type: 'Buffer', data: Array.from(this) };
  }
}

function asBuffer(bytes: Bytes): ByteArray {
  return new ByteArray(bytes);
}

function bufferFromString(text: string, encoding = 'utf8'): Bytes {
  switch (encoding.toLowerCase()) {
    case 'hex':
      return hexToBytes(text);
    case 'base64':
    case 'base64url':
      return base64ToBytes(text.replace(/-/g, '+').replace(/_/g, '/'));
    case 'latin1':
    case 'binary':
    case 'ascii':
      return Uint8Array.from(text, ch => ch.charCodeAt(0) & 0xff);
    default:
      return utf8Bytes(text);
  }
}

function encodeBytes(bytes: Bytes, encoding = 'utf8'): string {
  switch (encoding.toLowerCase()) {
    case 'hex':
      return bytesToHex(bytes);
    case 'base64':
      return bytesToBase64(bytes);
    case 'base64url':
      return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    case 'latin1':
    case 'binary':
    case 'ascii':
      return Array.from(bytes, b => String.fromCharCode(b)).join('');
    default:
      return TEXT_DECODER.decode(bytes);
  }
}

/** Accept strings, another WordArray, a Buffer or a plain byte array. */
function toBytes(value: unknown, encoding?: string): Bytes {
  if (value instanceof WordArray) return value.toBytes();
  if (typeof value === 'string') return bufferFromString(value, encoding);
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value.map(Number));
  if (value === undefined || value === null) return new Uint8Array(0);
  if (typeof value === 'number') return utf8Bytes(String(value));
  throw new Error(`Expected a string or bytes, got ${typeof value}`);
}

function makeBuffer(): Record<string, any> {
  return {
    from(input: unknown, encoding?: string): ByteArray {
      if (typeof input === 'string') return asBuffer(bufferFromString(input, encoding));
      if (input instanceof Uint8Array) return asBuffer(input);
      if (Array.isArray(input)) return asBuffer(Uint8Array.from(input.map(Number)));
      if (ArrayBuffer.isView(input)) return asBuffer(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
      if (input instanceof ArrayBuffer) return asBuffer(new Uint8Array(input));
      throw new Error('Buffer.from expects a string, array or ArrayBuffer');
    },
    alloc(size: number, fill: unknown = 0): ByteArray {
      const length = Math.max(0, Math.floor(Number(size)) || 0);
      const out = new ByteArray(length);
      if (typeof fill === 'string') {
        // Node repeats the utf8 bytes of a string fill across the buffer.
        const pattern = utf8Bytes(fill);
        if (pattern.length > 0) for (let i = 0; i < length; i++) out[i] = pattern[i % pattern.length];
      } else {
        const byte = Number(fill) & 0xff;
        if (byte) out.fill(byte);
      }
      return out;
    },
    allocUnsafe(size: number): ByteArray {
      return new ByteArray(Math.max(0, Math.floor(size)));
    },
    concat(list: Bytes[], total?: number): ByteArray {
      const joined = concatBytes(list.map(item => toBytes(item)));
      return asBuffer(total === undefined ? joined : joined.subarray(0, total));
    },
    isBuffer(value: unknown): boolean {
      return value instanceof ByteArray;
    },
    byteLength(input: unknown, encoding?: string): number {
      return typeof input === 'string' ? bufferFromString(input, encoding).length : toBytes(input).length;
    },
  };
}

/* --------------------------------- crypto-js -------------------------------- */

/** The subset of crypto-js's WordArray that scripts touch. */
class WordArray {
  words: number[];
  sigBytes: number;

  constructor(words: number[], sigBytes = words.length * 4) {
    this.words = words;
    this.sigBytes = sigBytes;
  }

  static create(words: number[], sigBytes = words.length * 4): WordArray {
    return new WordArray(words, sigBytes);
  }

  static random(bytes: number): WordArray {
    const out = new Uint8Array(Math.max(0, Math.floor(bytes)));
    globalThis.crypto.getRandomValues(out);
    return WordArray.fromBytes(out);
  }

  static fromBytes(bytes: Bytes): WordArray {
    const words: number[] = [];
    for (let i = 0; i < bytes.length; i += 4) {
      words.push(((bytes[i] << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)) >>> 0);
    }
    return new WordArray(words, bytes.length);
  }

  toBytes(): Bytes {
    const out = new Uint8Array(this.sigBytes);
    for (let i = 0; i < this.sigBytes; i++) out[i] = (this.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    return out;
  }

  toString(encoder?: { stringify(value: WordArray): string }): string {
    return (encoder ?? ENC_Hex).stringify(this);
  }

  concat(other: WordArray): WordArray {
    return WordArray.fromBytes(concatBytes([this.toBytes(), other.toBytes()]));
  }

  clamp(): void {
    const excess = this.sigBytes % 4;
    if (excess) this.words[this.sigBytes >>> 2] &= 0xffffffff << (32 - excess * 8);
    this.words.length = Math.ceil(this.sigBytes / 4);
  }

  clone(): WordArray {
    return new WordArray([...this.words], this.sigBytes);
  }
}

const ENC_Hex = {
  stringify: (value: WordArray) => bytesToHex(value.toBytes()),
  parse: (text: string) => WordArray.fromBytes(hexToBytes(text)),
};
const ENC_Base64 = {
  stringify: (value: WordArray) => bytesToBase64(value.toBytes()),
  parse: (text: string) => WordArray.fromBytes(base64ToBytes(text)),
};
const ENC_Base64url = {
  // crypto-js keeps the `=` padding; only the alphabet changes.
  stringify: (value: WordArray) => bytesToBase64(value.toBytes()).replace(/\+/g, '-').replace(/\//g, '_'),
  parse: (text: string) => WordArray.fromBytes(base64ToBytes(text.replace(/-/g, '+').replace(/_/g, '/'))),
};
const ENC_Latin1 = {
  stringify: (value: WordArray) => encodeBytes(value.toBytes(), 'latin1'),
  parse: (text: string) => WordArray.fromBytes(Uint8Array.from(text, ch => ch.charCodeAt(0) & 0xff)),
};
const ENC_Utf8 = {
  stringify: (value: WordArray) => TEXT_DECODER.decode(value.toBytes()),
  parse: (text: string) => WordArray.fromBytes(utf8Bytes(text)),
};
const ENC_Utf16LE = {
  stringify: (value: WordArray) => {
    const bytes = value.toBytes();
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
    return out;
  },
  parse: (text: string) => {
    const bytes = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes[i * 2] = code & 0xff;
      bytes[i * 2 + 1] = code >>> 8;
    }
    return WordArray.fromBytes(bytes);
  },
};

function hasher(name: HashName, withKey: boolean) {
  return (message: unknown, key?: unknown) =>
    WordArray.fromBytes(withKey ? hmac(name, toBytes(key), toBytes(message)) : hashBytes(name, toBytes(message)));
}

/** Reading a missing crypto-js algorithm should explain itself. */
function guardModule<T extends Record<string, unknown>>(label: string, api: T, hint: string): T {
  return new Proxy(api, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || property === 'then' || property === 'toJSON' || property in target) {
        return Reflect.get(target, property, receiver);
      }
      throw new Error(`${label}.${property} is not available in KangPos scripts. ${hint}`);
    },
  });
}

function makeCryptoJs(): Record<string, any> {
  const api: Record<string, any> = {
    lib: { WordArray, Base: WordArray },
    enc: { Hex: ENC_Hex, Base64: ENC_Base64, Base64url: ENC_Base64url, Latin1: ENC_Latin1, Utf8: ENC_Utf8, Utf16LE: ENC_Utf16LE },
    MD5: hasher('md5', false),
    SHA1: hasher('sha1', false),
    SHA256: hasher('sha256', false),
    SHA512: hasher('sha512', false),
    HmacMD5: hasher('md5', true),
    HmacSHA1: hasher('sha1', true),
    HmacSHA256: hasher('sha256', true),
    HmacSHA512: hasher('sha512', true),
  };
  return guardModule('CryptoJS', api, 'Supported: MD5, SHA1, SHA256, SHA512, HmacMD5, HmacSHA1, HmacSHA256, HmacSHA512, enc, lib.WordArray.');
}

/* ---------------------------------- crypto --------------------------------- */

function makeNodeCrypto(): Record<string, any> {
  const state = (algorithm: string, key?: Bytes) => {
    const name = hashName(algorithm);
    if (!name) throw new Error(`Hash algorithm '${algorithm}' is not available in KangPos scripts (md5, sha1, sha256, sha512).`);
    const chunks: Bytes[] = [];
    const digest = (encoding?: string): any => {
      const input = concatBytes(chunks);
      const bytes = key === undefined ? hashBytes(name, input) : hmac(name, key, input);
      return encoding ? encodeBytes(bytes, encoding) : asBuffer(bytes);
    };
    return {
      update(data: unknown, encoding?: string) {
        chunks.push(toBytes(data, encoding));
        return this;
      },
      digest,
    };
  };

  return {
    createHash(algorithm: string) {
      return state(algorithm);
    },
    createHmac(algorithm: string, key: unknown) {
      return state(algorithm, toBytes(key));
    },
    randomBytes(size: number): ByteArray {
      const out = new ByteArray(Math.max(0, Math.floor(size)));
      globalThis.crypto.getRandomValues(out);
      return out;
    },
    randomUUID(): string {
      return randomUuid();
    },
    timingSafeEqual(a: unknown, b: unknown): boolean {
      const left = toBytes(a);
      const right = toBytes(b);
      if (left.length !== right.length) return false;
      let diff = 0;
      for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
      return diff === 0;
    },
    getRandomValues<T extends ArrayBufferView>(array: T): T {
      return globalThis.crypto.getRandomValues(array);
    },
    webcrypto: globalThis.crypto,
  };
}

function randomUuid(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ----------------------------------- uuid ---------------------------------- */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeUuid(): Record<string, any> {
  return {
    v4: () => randomUuid(),
    validate: (value: unknown) => typeof value === 'string' && UUID_PATTERN.test(value),
    version: (value: string) => {
      const match = UUID_PATTERN.exec(value);
      return match ? Number(match[1]) : 0;
    },
    NIL: '00000000-0000-0000-0000-000000000000',
  };
}

/* ----------------------------------- chai ---------------------------------- */

function makeChai(): Record<string, any> {
  const assert = {
    equal(actual: unknown, wanted: unknown, message?: string) {
      // chai's assert.equal is the loose (==) assertion; strictEqual is the === one.
      if (!(actual == wanted)) {
        throw new AssertionError(message ?? `expected ${inspect(actual)} to equal ${inspect(wanted)}`);
      }
    },
    strictEqual(actual: unknown, wanted: unknown, message?: string) {
      expect(actual, message).to.equal(wanted);
    },
    deepEqual(actual: unknown, wanted: unknown, message?: string) {
      expect(actual, message).to.eql(wanted);
    },
    isTrue(value: unknown, message?: string) {
      expect(value, message).to.be.true;
    },
    isFalse(value: unknown, message?: string) {
      expect(value, message).to.be.false;
    },
    isOk(value: unknown, message?: string) {
      expect(value, message).to.be.ok;
    },
    isNotOk(value: unknown, message?: string) {
      expect(value, message).to.not.be.ok;
    },
    include(haystack: unknown, needle: unknown, message?: string) {
      expect(haystack, message).to.include(needle);
    },
    match(value: unknown, pattern: RegExp, message?: string) {
      expect(value, message).to.match(pattern);
    },
    throws(fn: () => unknown, message?: string) {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      expect(threw, message ?? 'expected the function to throw').to.be.true;
    },
    fail(message?: string): never {
      throw new AssertionError(message ?? 'assert.fail()');
    },
  };
  return { expect, assert };
}

/* -------------------------------- querystring ------------------------------ */

function makeQuerystring(): Record<string, any> {
  return {
    parse(text: string): Record<string, string | string[]> {
      const out: Record<string, string | string[]> = {};
      for (const pair of String(text ?? '').replace(/^\?/, '').split('&')) {
        if (pair === '') continue;
        const at = pair.indexOf('=');
        const key = decodeURIComponent((at < 0 ? pair : pair.slice(0, at)).replace(/\+/g, ' '));
        const value = decodeURIComponent((at < 0 ? '' : pair.slice(at + 1)).replace(/\+/g, ' '));
        const existing = out[key];
        if (existing === undefined) out[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else out[key] = [existing, value];
      }
      return out;
    },
    stringify(values: Record<string, unknown>): string {
      const parts: string[] = [];
      for (const [key, value] of Object.entries(values ?? {})) {
        const list = Array.isArray(value) ? value : [value];
        for (const item of list) parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item === undefined || item === null ? '' : String(item))}`);
      }
      return parts.join('&');
    },
    encode: encodeURIComponent,
    decode: decodeURIComponent,
  };
}

/* --------------------------------- registry -------------------------------- */

export type RequireFn = (name: string) => unknown;

export function createRequire(): RequireFn {
  const modules = new Map<string, unknown>();
  modules.set('crypto-js', makeCryptoJs());
  modules.set('crypto', makeNodeCrypto());
  modules.set('uuid', makeUuid());
  modules.set('lodash', createLodash());
  modules.set('moment', createMoment());
  const buffer = makeBuffer();
  modules.set('buffer', { Buffer: buffer, ...buffer });
  modules.set('querystring', makeQuerystring());
  modules.set('chai', makeChai());

  return (name: string) => {
    const clean = String(name).trim();
    const key = clean.startsWith('node:') ? clean.slice(5) : clean;
    if (modules.has(key)) return modules.get(key);
    throw new Error(
      `require('${clean}') is not available in KangPos scripts. Built in: ${BUILTIN_MODULES.join(', ')}. Also available without require(): pm, console, crypto (Web Crypto), btoa/atob, TextEncoder/TextDecoder.`,
    );
  };
}

/** The `_` global Postman provides. */
export function lodashGlobal(): Record<string, any> {
  return createLodash();
}
