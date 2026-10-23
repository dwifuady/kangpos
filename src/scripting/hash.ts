// Synchronous hashes for the script sandbox.
//
// Postman scripts expect `CryptoJS.HmacSHA256(...)` / `crypto.createHash(...)` to
// return immediately, but the Web Crypto API is async, so these primitives are
// plain TypeScript. They are used by `require('crypto-js')` and `require('crypto')`
// in modules.ts, and are tested against published vectors.

export type HashName = 'md5' | 'sha1' | 'sha256' | 'sha512';

const ENCODER = new TextEncoder();

export const HASH_BYTES: Record<HashName, number> = { md5: 16, sha1: 20, sha256: 32, sha512: 64 };

const BLOCK_BYTES: Record<HashName, number> = { md5: 64, sha1: 64, sha256: 64, sha512: 128 };

export function utf8Bytes(text: string): Uint8Array {
  return ENCODER.encode(text);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Append the 0x80 marker and the bit length, in the padding style of the hash. */
function pad(input: Uint8Array, blockBytes: number, littleEndianLength: boolean): Uint8Array {
  const lengthBytes = blockBytes === 128 ? 16 : 8;
  const total = Math.ceil((input.length + 1 + lengthBytes) / blockBytes) * blockBytes;
  const out = new Uint8Array(total);
  out.set(input);
  out[input.length] = 0x80;
  let bits = BigInt(input.length) * 8n;
  const at = total - lengthBytes;
  if (littleEndianLength) {
    for (let i = 0; i < 8; i++) out[at + i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  } else {
    for (let i = lengthBytes - 1; i >= 0; i--) {
      out[at + i] = Number(bits & 0xffn);
      bits >>= 8n;
    }
  }
  return out;
}

function rotl(value: number, count: number): number {
  return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function rotr(value: number, count: number): number {
  return ((value >>> count) | (value << (32 - count))) >>> 0;
}

function readLeWord(bytes: Uint8Array, at: number): number {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}

function writeLeWord(out: Uint8Array, at: number, word: number): void {
  out[at] = word & 0xff;
  out[at + 1] = (word >>> 8) & 0xff;
  out[at + 2] = (word >>> 16) & 0xff;
  out[at + 3] = (word >>> 24) & 0xff;
}

function readBeWord(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function writeBeWord(out: Uint8Array, at: number, word: number): void {
  out[at] = (word >>> 24) & 0xff;
  out[at + 1] = (word >>> 16) & 0xff;
  out[at + 2] = (word >>> 8) & 0xff;
  out[at + 3] = word & 0xff;
}

const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input: Uint8Array): Uint8Array {
  const message = pad(input, 64, true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Uint32Array(16);
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = readLeWord(message, offset + i * 4);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const previous = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_K[i] + words[g]) | 0;
      const shift = MD5_SHIFTS[(i >> 4) * 4 + (i % 4)];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = previous;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((word, i) => writeLeWord(out, i * 4, word));
  return out;
}

export function sha1(input: Uint8Array): Uint8Array {
  const message = pad(input, 64, false);
  const h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const w = new Uint32Array(80);
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = readBeWord(message, offset + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
  }
  const out = new Uint8Array(20);
  for (let i = 0; i < 5; i++) writeBeWord(out, i * 4, h[i]);
  return out;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(input: Uint8Array): Uint8Array {
  const message = pad(input, 64, false);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < message.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = readBeWord(message, offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + SHA256_K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) writeBeWord(out, i * 4, h[i]);
  return out;
}

const MASK64 = (1n << 64n) - 1n;

const SHA512_K: bigint[] = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn, 0x3956c25bf348b538n,
  0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n, 0xd807aa98a3030242n, 0x12835b0145706fben,
  0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n, 0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n,
  0xc19bf174cf692694n, 0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n, 0x983e5152ee66dfabn,
  0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n, 0xc6e00bf33da88fc2n, 0xd5a79147930aa725n,
  0x06ca6351e003826fn, 0x142929670a0e6e70n, 0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn, 0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n, 0xd192e819d6ef5218n,
  0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n, 0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n,
  0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n, 0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n, 0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn, 0xca273eceea26619cn,
  0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n, 0x06f067aa72176fban, 0x0a637dc5a2c898a6n,
  0x113f9804bef90daen, 0x1b710b35131c471bn, 0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn, 0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

function rotr64(value: bigint, count: bigint): bigint {
  return ((value >> count) | (value << (64n - count))) & MASK64;
}

export function sha512(input: Uint8Array): Uint8Array {
  const message = pad(input, 128, false);
  const h = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
  ];
  const w: bigint[] = Array.from({ length: 80 }, () => 0n);
  for (let offset = 0; offset < message.length; offset += 128) {
    for (let i = 0; i < 16; i++) {
      let word = 0n;
      for (let j = 0; j < 8; j++) word = (word << 8n) | BigInt(message[offset + i * 8 + j]);
      w[i] = word;
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15], 1n) ^ rotr64(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
      const s1 = rotr64(w[i - 2], 19n) ^ rotr64(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 80; i++) {
      const s1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & MASK64 & g);
      const temp1 = (hh + s1 + ch + SHA512_K[i] + w[i]) & MASK64;
      const s0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) & MASK64;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & MASK64;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + next[i]) & MASK64;
  }
  const out = new Uint8Array(64);
  h.forEach((word, i) => {
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((word >> BigInt(8 * (7 - j))) & 0xffn);
  });
  return out;
}

export function hashBytes(name: HashName, input: Uint8Array): Uint8Array {
  switch (name) {
    case 'md5':
      return md5(input);
    case 'sha1':
      return sha1(input);
    case 'sha256':
      return sha256(input);
    case 'sha512':
      return sha512(input);
  }
}

export function hmac(name: HashName, key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = BLOCK_BYTES[name];
  const inner = new Uint8Array(block + message.length);
  const outer = new Uint8Array(block + HASH_BYTES[name]);
  const paddedKey = new Uint8Array(block);
  paddedKey.set(key.length > block ? hashBytes(name, key) : key);
  for (let i = 0; i < block; i++) {
    inner[i] = paddedKey[i] ^ 0x36;
    outer[i] = paddedKey[i] ^ 0x5c;
  }
  inner.set(message, block);
  outer.set(hashBytes(name, inner), block);
  return hashBytes(name, outer);
}

/** `sha-256`, `SHA256`, `hmac-sha1` and friends map to the names above. */
export function hashName(algorithm: string): HashName | null {
  const clean = algorithm.toLowerCase().replace(/[^a-z0-9]/g, '');
  const withoutHmac = clean.startsWith('hmac') ? clean.slice(4) : clean;
  if (withoutHmac === 'md5') return 'md5';
  if (withoutHmac === 'sha1') return 'sha1';
  if (withoutHmac === 'sha256') return 'sha256';
  if (withoutHmac === 'sha512') return 'sha512';
  return null;
}
