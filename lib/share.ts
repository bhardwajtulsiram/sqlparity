import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

/**
 * Encodes state into a compressed, URL-safe base64 string suitable for a URL hash fragment.
 *
 * Privacy Note:
 * Hash fragments (#share=...) are strictly client-side. Browsers never include URL hash
 * fragments in HTTP requests to the host or any third party, preserving the promise
 * that no user data or queries leave the machine.
 */
function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeShareState<T>(state: T): string {
  try {
    const json = JSON.stringify(state);
    const u8 = strToU8(json);
    const compressed = deflateSync(u8, { level: 9 });
    return uint8ArrayToBase64Url(compressed);
  } catch {
    return '';
  }
}

export function decodeShareState<T>(hashOrPayload: string): T | null {
  try {
    let payload = hashOrPayload.trim();
    if (payload.startsWith('#')) {
      payload = payload.slice(1);
    }
    if (payload.startsWith('share=')) {
      payload = payload.slice(6);
    }
    if (!payload) return null;

    const compressed = base64UrlToUint8Array(payload);
    const decompressed = inflateSync(compressed);
    const json = strFromU8(decompressed);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Builds a full share URL for the current window location.
 */
export function buildShareUrl<T>(state: T, pathname?: string): string {
  const hash = encodeShareState(state);
  if (!hash) return '';
  if (typeof window === 'undefined') {
    return `${pathname || ''}#share=${hash}`;
  }
  const base = `${window.location.origin}${pathname || window.location.pathname}`;
  return `${base}#share=${hash}`;
}
