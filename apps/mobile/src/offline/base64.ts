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
