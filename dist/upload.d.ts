export interface ServerConfig {
    api_url: string;
}
export declare class UploadConfig {
    connectTimeout: number;
    stallThreshold: number;
    poolMaxIdle: number;
    constructor(connectTimeout?: number, stallThreshold?: number, poolMaxIdle?: number);
}
export declare class UploadParams {
    retryCount: number;
    retrySpacing: number;
    chunkSize: number;
    constructor(retryCount?: number, retrySpacing?: number, chunkSize?: number);
}
export type ProgressCallback = (percentage: number | null, bytes?: number) => void;
export declare class UploadError extends Error {
}
export declare function getServerConfig(): Promise<ServerConfig>;
export declare function uploadDataWithProgress(signerPrivateKey: string, config: ServerConfig, fileData: Buffer, mimeType: string | undefined, proxy: string | undefined, progressCallback: ProgressCallback, params?: UploadParams, _config?: UploadConfig): Promise<string>;
