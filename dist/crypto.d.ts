export interface EncryptionParams {
    key: string;
    nonce: string;
}
export declare class CryptoError extends Error {
}
export declare function generateEncryptionParams(): EncryptionParams;
export declare function encryptData(data: Buffer | Uint8Array, params: EncryptionParams): Buffer;
export declare function calculateFileHash(data: Buffer): string;
