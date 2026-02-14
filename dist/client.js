import { SimplePool } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';
import { normalizePrivateKey } from './keys.js';
const DEFAULT_RELAYS = [
    'wss://jskitty.cat/nostr',
    'wss://relay.damus.io',
    'wss://auth.nostr1.com',
    'wss://nostr.computingcache.com',
];
function ensureWebSocket() {
    if (typeof globalThis.WebSocket === 'undefined') {
        globalThis.WebSocket = WebSocket;
    }
}
export class VectorClient {
    constructor(keys, config) {
        this.pool = new SimplePool();
        ensureWebSocket();
        const normalized = normalizePrivateKey(keys);
        this.privateKey = normalized.hex;
        this.privateKeyBytes = normalized.bytes;
        this.publicKey = getPublicKey(this.privateKeyBytes);
        this.relays = (config?.defaultRelays ?? DEFAULT_RELAYS)
            .map((relay) => relay.trim())
            .filter(Boolean);
        this.publishRetries = Math.max(0, config?.publishRetries ?? 1);
    }
    async setMetadata(metadata) {
        const event = finalizeEvent({
            kind: 0,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: JSON.stringify(metadata),
        }, this.privateKeyBytes);
        await this.publish(event, this.relays, this.publishRetries);
    }
    async publishEvent(event, relays) {
        return this.publish(event, relays ?? this.relays, this.publishRetries);
    }
    async publish(event, relays, retries = 0) {
        if (!relays.length) {
            throw new Error('At least one relay is required');
        }
        await Promise.allSettled(relays.map((relay) => this.pool.ensureRelay(relay)));
        const results = await Promise.allSettled(this.pool.publish(relays, event));
        const fulfilled = results.filter((result) => result.status === 'fulfilled');
        if (fulfilled.length > 0) {
            return;
        }
        const firstRejected = results.find((result) => result.status === 'rejected');
        const reason = firstRejected && firstRejected.status === 'rejected'
            ? firstRejected.reason
            : new Error('Failed to publish to relays');
        const error = reason instanceof Error ? reason : new Error(String(reason));
        if (retries > 0) {
            await this.publish(event, relays, retries - 1);
            return;
        }
        throw error;
    }
}
export function buildClient(keys, config) {
    return new VectorClient(keys, config);
}
