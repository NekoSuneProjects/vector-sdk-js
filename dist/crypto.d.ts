export interface EncryptionParams {
    key: string;
    nonce: string;
}
export declare class CryptoError extends Error {
}
export declare function generateEncryptionParams(): EncryptionParams;
export declare function encryptData(data: Buffer | Uint8Array, params: EncryptionParams): Buffer;
/**
 * Reverse {@link encryptData}: strip the trailing GCM tag, then decrypt and
 * authenticate.
 *
 * This is what turns a received attachment's bytes back into the original file,
 * using the `decryption-key` and `decryption-nonce` tags that came with it.
 */
export declare function decryptData(data: Buffer | Uint8Array, params: EncryptionParams): Buffer;
export declare function calculateFileHash(data: Buffer): string;
