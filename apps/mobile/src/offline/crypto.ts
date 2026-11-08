import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import { combineBase64, decodeBase64 } from './base64';

export type VaultEnvelope = Readonly<{
  algorithm: 'A256GCM';
  nonce?: string;
  ciphertext?: string;
  tag?: string;
  combined?: string;
  aad: string;
}>;

const encoder = new TextEncoder();

export async function sealJson(value: unknown, keyBase64: string, aad: string): Promise<VaultEnvelope> {
  let key: AESEncryptionKey;
  try { key = await AESEncryptionKey.import(keyBase64, 'base64'); }
  catch { throw new Error('No se pudo importar la clave AES.'); }
  const sealed = await aesEncryptAsync(encoder.encode(JSON.stringify(value)), key, {
    nonce: { length: 12 },
    tagLength: 16,
    additionalData: encoder.encode(aad),
  });
  const combined = await sealed.combined('base64');
  if (typeof combined !== 'string' || !combined)
    throw new Error('El cifrado nativo no entregó un sobre AES válido.');
  return {
    algorithm: 'A256GCM',
    combined,
    aad,
  };
}

export async function openJson<T>(envelope: VaultEnvelope, keyBase64: string, aad: string): Promise<T> {
  if (envelope.algorithm !== 'A256GCM' || envelope.aad !== aad)
    throw new Error('El sobre cifrado no pertenece a este ámbito.');
  let key: AESEncryptionKey;
  try { key = await AESEncryptionKey.import(keyBase64, 'base64'); }
  catch { throw new Error('No se pudo importar la clave AES.'); }
  let combined: string;
  try { combined = envelope.combined || combineBase64([envelope.nonce, envelope.ciphertext, envelope.tag]); }
  catch (error) { throw new Error(`No se pudo reconstruir el sobre AES: ${(error as Error).message}`); }
  let sealed: AESSealedData;
  try { sealed = AESSealedData.fromCombined(decodeBase64(combined)); }
  catch { throw new Error('No se pudo abrir el sobre AES en este dispositivo.'); }
  let bytes: Uint8Array;
  try {
    bytes = await aesDecryptAsync(sealed, key, {
      additionalData: encoder.encode(aad),
      output: 'bytes',
    }) as Uint8Array;
  } catch { throw new Error('No se pudo descifrar la copia.'); }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as T; }
  catch { throw new Error('No se pudo leer la copia descifrada.'); }
}
