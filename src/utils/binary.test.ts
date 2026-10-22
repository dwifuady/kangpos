import { describe, expect, it } from 'vitest';
import type { HttpResponse } from '../types';
import { base64ToBytes, bytesToBase64, detectPreview, responseBytes, sniffMime, suggestedFileName } from './binary';

function response(overrides: Partial<HttpResponse>): HttpResponse {
  return {
    status: 200,
    statusText: 'OK',
    httpVersion: 'HTTP/1.1',
    headers: [],
    body: null,
    bodyBase64: null,
    contentType: null,
    sizeBytes: 0,
    durationMs: 1,
    truncated: false,
    finalUrl: 'https://api.test/files/receipt',
    ...overrides,
  };
}

const PDF = 'JVBERi0xLjMK'; // "%PDF-1.3\n"
const PNG = bytesToBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

describe('binary responses', () => {
  it('round-trips base64', () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('reads bytes from base64 or text bodies', () => {
    expect(new TextDecoder().decode(responseBytes(response({ bodyBase64: PDF })))).toBe('%PDF-1.3\n');
    expect(Array.from(responseBytes(response({ body: 'hi' })))).toEqual([104, 105]);
  });

  it('previews by content type, sniffing generic ones', () => {
    expect(detectPreview('application/pdf', base64ToBytes(PDF))).toEqual({ kind: 'pdf', mime: 'application/pdf' });
    expect(detectPreview('image/png; charset=binary', base64ToBytes(PNG))).toEqual({ kind: 'image', mime: 'image/png' });
    expect(detectPreview('application/octet-stream', base64ToBytes(PDF))).toEqual({ kind: 'pdf', mime: 'application/pdf' });
    expect(detectPreview(null, base64ToBytes(PNG))?.mime).toBe('image/png');
    expect(detectPreview('text/html; charset=utf-8', new Uint8Array())).toEqual({ kind: 'html', mime: 'text/html' });
    expect(detectPreview('application/json', new TextEncoder().encode('{}'))).toBeNull();
    expect(sniffMime(new TextEncoder().encode('plain'))).toBeNull();
  });

  it('names files from Content-Disposition, the URL, or the type', () => {
    expect(
      suggestedFileName(response({ headers: [['content-disposition', 'attachment; filename="Bukti-Bayar-C12-2026-09.pdf"']], bodyBase64: PDF }), ''),
    ).toBe('Bukti-Bayar-C12-2026-09.pdf');
    expect(
      suggestedFileName(response({ headers: [['Content-Disposition', "attachment; filename*=UTF-8''kwitansi%20Agustus.pdf"]], bodyBase64: PDF }), ''),
    ).toBe('kwitansi Agustus.pdf');
    expect(suggestedFileName(response({ contentType: 'application/pdf', bodyBase64: PDF }), '')).toBe('receipt.pdf');
    expect(suggestedFileName(response({ finalUrl: 'https://api.test/', bodyBase64: PNG }), '')).toBe('response.png');
    expect(suggestedFileName(response({ headers: [['content-disposition', 'attachment; filename="..\\evil:name.pdf"']], bodyBase64: PDF }), '')).toBe(
      '.._evil_name.pdf',
    );
  });
});
