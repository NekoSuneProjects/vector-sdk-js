export declare class KeyFormatError extends Error {
}
export declare function normalizePrivateKey(privateKey: string): {
    hex: string;
    bytes: Uint8Array;
};
export declare function normalizePublicKey(publicKey: string): string;
