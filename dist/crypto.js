import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
export class CryptoError extends Error {
}
/** AES-256-GCM tag length, in bytes. It is appended to the ciphertext. */
const GCM_TAG_BYTES = 16;
export function generateEncryptionParams() {
    const key = randomBytes(32).toString('hex');
    const nonce = randomBytes(16).toString('hex');
    return { key, nonce };
}
export function encryptData(data, params) {
    const key = Buffer.from(params.key, 'hex');
    const nonce = Buffer.from(params.nonce, 'hex');
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([encrypted, tag]);
}
/**
 * Reverse {@link encryptData}: strip the trailing GCM tag, then decrypt and
 * authenticate.
 *
 * This is what turns a received attachment's bytes back into the original file,
 * using the `decryption-key` and `decryption-nonce` tags that came with it.
 */
export function decryptData(data, params) {
    const payload = Buffer.from(data);
    if (payload.length < GCM_TAG_BYTES) {
        throw new CryptoError('Encrypted payload is too short to contain an auth tag');
    }
    const key = Buffer.from(params.key, 'hex');
    const nonce = Buffer.from(params.nonce, 'hex');
    const ciphertext = payload.subarray(0, payload.length - GCM_TAG_BYTES);
    const tag = payload.subarray(payload.length - GCM_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    try {
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    }
    catch (error) {
        throw new CryptoError(`Failed to decrypt attachment: ${String(error)}`);
    }
}
export function calculateFileHash(data) {
    return createHash('sha256').update(data).digest('hex');
}
