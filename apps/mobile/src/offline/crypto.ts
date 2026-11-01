import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';

export type VaultEnvelope = Readonly<{
  algorithm: 'A256GCM';
  nonce: string;
  ciphertext: string;
  tag: string;
  aad: string;
}>;

const encoder = new TextEncoder();

export async function sealJson(value: unknown, keyBase64: string, aad: string): Promise<VaultEnvelope> {
  const key = await AESEncryptionKey.import(keyBase64, 'base64');
  const sealed = await aesEncryptAsync(encoder.encode(JSON.stringify(value)), key, {
    nonce: { length: 12 },
    tagLength: 16,
    additionalData: encoder.encode(aad),
  });
  return {
    algorithm: 'A256GCM',
    nonce: await sealed.iv('base64'),
    ciphertext: await sealed.ciphertext({ encoding: 'base64', includeTag: false }),
    tag: await sealed.tag('base64'),
    aad,
  };
}

export async function openJson<T>(envelope: VaultEnvelope, keyBase64: string, aad: string): Promise<T> {
  if (envelope.algorithm !== 'A256GCM' || envelope.aad !== aad)
    throw new Error('El sobre cifrado no pertenece a este ámbito.');
  const key = await AESEncryptionKey.import(keyBase64, 'base64');
  const sealed = AESSealedData.fromParts(envelope.nonce, envelope.ciphertext, envelope.tag);
  const bytes = await aesDecryptAsync(sealed, key, {
    additionalData: encoder.encode(aad),
    output: 'bytes',
  });
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
