import { SimplePool, Event } from 'nostr-tools';
import type { Metadata } from './metadata.js';
export interface ClientConfig {
    proxy?: string;
    defaultRelays?: string[];
    publishRetries?: number;
}
export declare class VectorClient {
    readonly pool: SimplePool;
    readonly relays: string[];
    readonly publicKey: string;
    readonly privateKey: string;
    readonly privateKeyBytes: Uint8Array;
    private readonly publishRetries;
    constructor(keys: string, config?: ClientConfig);
    setMetadata(metadata: Metadata): Promise<void>;
    publishEvent(event: Event, relays?: string[]): Promise<void>;
    private publish;
}
export declare function buildClient(keys: string, config?: ClientConfig): VectorClient;
