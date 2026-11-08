const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decode(input: string) {
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (let index = 0; index < input.length; index++) {
    const character = input.charAt(index);
    if (character === '=') break;
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('La copia cifrada tiene base64 inválido.');
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return bytes;
}

export function decodeBase64(input: string) {
  return new Uint8Array(decode(input));
}

function encode(bytes: readonly number[]) {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    result += alphabet[first >>> 2];
    result += alphabet[((first & 3) << 4) | ((second ?? 0) >>> 4)];
    result += second === undefined ? '=' : alphabet[((second & 15) << 2) | ((third ?? 0) >>> 6)];
    result += third === undefined ? '=' : alphabet[third & 63];
  }
  return result;
}

/** Reconstruye el formato IV + cifrado + etiqueta de sobres AES anteriores. */
export function combineBase64(parts: readonly (string | undefined)[]) {
  const bytes: number[] = [];
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    if (typeof part !== 'string') throw new Error(`Falta el segmento AES ${partIndex + 1}.`);
    let segment: number[];
    try { segment = decode(part); }
    catch (error) { throw new Error(`Segmento AES ${partIndex + 1}: ${(error as Error).message}`); }
    for (let index = 0; index < segment.length; index++) bytes.push(segment[index]!);
  }
  try { return encode(bytes); }
  catch (error) { throw new Error(`Codificación AES: ${(error as Error).message}`); }
}
