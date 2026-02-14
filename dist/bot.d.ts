import { ClientConfig, VectorClient } from './client.js';
import { ProgressCallback } from './upload.js';
export interface ImageMetadata {
    blurhash: string;
    width: number;
    height: number;
}
export declare class AttachmentFile {
    bytes: Buffer;
    extension: string;
    imgMeta?: ImageMetadata | undefined;
    constructor(bytes: Buffer, extension: string, imgMeta?: ImageMetadata | undefined);
    static fromPath(path: string): Promise<AttachmentFile>;
    static fromBytes(bytes: Buffer, extension?: string): Promise<AttachmentFile>;
}
export declare function loadFile(path: string): Promise<AttachmentFile>;
export declare function createProgressCallback(): ProgressCallback;
export declare class VectorBot {
    name: string;
    displayName: string;
    about: string;
    picture: string;
    banner: string;
    nip05: string;
    lud16: string;
    readonly publicKey: string;
    readonly privateKey: string;
    readonly privateKeyBytes: Uint8Array;
    readonly client: VectorClient;
    private constructor();
    static quick(privateKey: string): Promise<VectorBot>;
    static new(privateKey: string, name: string, displayName: string, about: string, picture: string, banner: string, nip05: string, lud16: string, clientConfig?: ClientConfig): Promise<VectorBot>;
    getChat(recipient: string): Channel;
}
export declare class Channel {
    readonly recipient: string;
    readonly baseBot: VectorBot;
    constructor(recipient: string, baseBot: VectorBot);
    sendPrivateMessage(message: string): Promise<boolean>;
    sendReaction(referenceId: string, emoji: string): Promise<boolean>;
    sendTypingIndicator(): Promise<boolean>;
    sendPrivateFile(file?: AttachmentFile): Promise<boolean>;
}
