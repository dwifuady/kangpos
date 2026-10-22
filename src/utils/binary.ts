// Binary responses: decode the body, decide how to preview it, name the file.

import type { HttpResponse } from '../types';

export type PreviewKind = 'image' | 'pdf' | 'html';

export interface Preview {
  kind: PreviewKind;
  mime: string;
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** The body as bytes, whether it arrived as text or base64. */
export function responseBytes(response: HttpResponse): Uint8Array {
  if (response.bodyBase64 !== null) return base64ToBytes(response.bodyBase64);
  return new TextEncoder().encode(response.body ?? '');
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}

/** Guess the type from the first bytes, for servers that send no (or a generic) Content-Type. */
export function sniffMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf'; // %PDF
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif'; // GIF8
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (startsWith(bytes, [0x42, 0x4d])) return 'image/bmp';
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
  return null;
}

const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/download', 'application/force-download']);

/** How to preview a response, or null when it is best shown as text. */
export function detectPreview(contentType: string | null, bytes: Uint8Array): Preview | null {
  const declared = (contentType ?? '').split(';')[0].trim().toLowerCase();
  const mime = GENERIC.has(declared) ? (sniffMime(bytes) ?? declared) : declared;
  if (mime === 'application/pdf') return { kind: 'pdf', mime };
  if (mime.startsWith('image/')) return { kind: 'image', mime };
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return { kind: 'html', mime };
  return null;
}

const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/x-icon': 'ico',
  'application/json': 'json',
  'text/html': 'html',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/zip': 'zip',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Filename from Content-Disposition, else the URL's last path segment, else "response". */
export function suggestedFileName(response: HttpResponse, requestUrl: string): string {
  const header = response.headers.find(([k]) => k.toLowerCase() === 'content-disposition')?.[1] ?? '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  let name = '';
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = star[1].trim();
    }
  } else if (plain) {
    name = plain[1].trim();
  }
  if (!name) {
    let path: string;
    try {
      path = new URL(response.finalUrl || requestUrl).pathname;
    } catch {
      path = '';
    }
    const last = path.split('/').filter(Boolean).pop() ?? '';
    try {
      name = decodeURIComponent(last);
    } catch {
      name = last;
    }
    name ||= 'response';
  }
  // Strip path separators and characters Windows rejects.
  name = name.replace(/[\\/:*?"<>|]/g, '_');
  if (!/\.[a-z0-9]{1,5}$/i.test(name)) {
    const bytes = responseBytes(response);
    const mime = (response.contentType ?? '').split(';')[0].trim().toLowerCase() || sniffMime(bytes) || '';
    const ext = EXTENSIONS[mime] ?? EXTENSIONS[sniffMime(bytes) ?? ''];
    if (ext) name = `${name}.${ext}`;
  }
  return name;
}
