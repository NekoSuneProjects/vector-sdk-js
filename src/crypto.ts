import { randomBytes, createCipheriv, createHash } from 'crypto';

export interface EncryptionParams {
  key: string;
  nonce: string;
}

export class CryptoError extends Error {}

export function generateEncryptionParams(): EncryptionParams {
  const key = randomBytes(32).toString('hex');
  const nonce = randomBytes(16).toString('hex');

  return { key, nonce };
}

export function encryptData(data: Buffer | Uint8Array, params: EncryptionParams): Buffer {
  const key = Buffer.from(params.key, 'hex');
  const nonce = Buffer.from(params.nonce, 'hex');
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]);
}

export function calculateFileHash(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
