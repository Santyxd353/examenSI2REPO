const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const lookup = new Uint8Array(256);
lookup.fill(255);
for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;
lookup[61] = 0;
const maximumBytes = 50 * 1024 * 1024;
export function toBase64(bytes: Uint8Array): string {
  if (bytes.length > maximumBytes) throw new Error('El recurso supera los 50 MiB.');
  const parts: string[] = [];
  let part = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1],
      c = bytes[i + 2];
    part +=
      alphabet[a >> 2]! +
      alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)]! +
      (b === undefined ? '=' : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]!) +
      (c === undefined ? '=' : alphabet[c & 63]!);
    if (part.length >= 16384) {
      parts.push(part);
      part = '';
    }
  }
  parts.push(part);
  return parts.join('');
}
export function fromBase64(value: string): Uint8Array {
  if (
    value.length > Math.ceil(maximumBytes / 3) * 4 ||
    value.length % 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('El recurso codificado no es válido.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  if (
    (padding === 2 && (lookup[value.charCodeAt(value.length - 3)]! & 15) !== 0) ||
    (padding === 1 && (lookup[value.charCodeAt(value.length - 2)]! & 3) !== 0)
  )
    throw new Error('El recurso codificado no es válido.');
  const bytes = new Uint8Array((value.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < value.length; i += 4) {
    const n =
      (lookup[value.charCodeAt(i)]! << 18) |
      (lookup[value.charCodeAt(i + 1)]! << 12) |
      (lookup[value.charCodeAt(i + 2)]! << 6) |
      lookup[value.charCodeAt(i + 3)]!;
    if (at < bytes.length) bytes[at++] = n >> 16;
    if (at < bytes.length) bytes[at++] = (n >> 8) & 255;
    if (at < bytes.length) bytes[at++] = n & 255;
  }
  return bytes;
}

export const decodeBase64 = fromBase64;

/** Conserva el sobre persistido v1: nonce de 12 bytes y tag GCM de 16 bytes. */
export function splitAesCombined(combined: string) {
  const bytes = fromBase64(combined);
  if (bytes.length < 28) throw new Error('El sobre AES está incompleto.');
  return {
    nonce: toBase64(bytes.subarray(0, 12)),
    ciphertext: toBase64(bytes.subarray(12, -16)),
    tag: toBase64(bytes.subarray(-16)),
  };
}

/** Unir bytes decodificados; concatenar textos base64 perdería segmentos con padding. */
export function combineBase64(parts: readonly (string | undefined)[]): string {
  let size = 0;
  const decoded = parts.map((part, index) => {
    if (typeof part !== 'string') throw new Error('Falta el segmento AES ' + (index + 1));
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(part);
    } catch {
      throw new Error('Segmento base64 inválido.');
    }
    size += bytes.length;
    if (size > maximumBytes) throw new Error('El recurso supera los 50 MiB.');
    return bytes;
  });
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const bytes of decoded) {
    combined.set(bytes, offset);
    offset += bytes.length;
  }
  return toBase64(combined);
}
