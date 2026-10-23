import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, bytesToHex, hashBytes, hmac, utf8Bytes } from './hash';

const hex = (bytes: Uint8Array) => bytesToHex(bytes);

describe('synchronous hashes', () => {
  it('matches published vectors', () => {
    expect(hex(hashBytes('sha256', utf8Bytes('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(hashBytes('md5', utf8Bytes('abc')))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(hex(hashBytes('sha512', utf8Bytes('abc')))).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });

  it('hashes UTF-8 text byte-for-byte like Node', () => {
    expect(hex(hashBytes('sha256', utf8Bytes('héllo')))).toBe('3c48591d8d098a4538f5e013dfcf406e948eac4d3277b10bf614e295d6068179');
    expect(hex(hashBytes('md5', utf8Bytes('héllo')))).toBe('be50e8478cf24ff3595bc7307fb91b50');
  });

  it('hashes long HMAC keys instead of truncating them', () => {
    expect(hex(hmac('sha256', utf8Bytes('k'.repeat(200)), utf8Bytes('msg')))).toBe(
      'e2adadca233bc31c6e6126c865132c3e945f9dedd44797a1e5acc3c037bc21fc',
    );
  });

  it('round-trips base64', () => {
    const bytes = utf8Bytes('héllo ✓');
    expect(bytesToBase64(bytes)).toBe('aMOpbGxvIOKckw==');
    expect(bytesToHex(base64ToBytes('aMOpbGxvIOKckw=='))).toBe(bytesToHex(bytes));
  });
});
