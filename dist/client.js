import { SimplePool } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';
import { normalizePrivateKey } from './keys.js';
import { buildInboxRelayList, InboxRelayResolver } from './inbox-relays.js';
import { DISCOVERY_RELAYS } from './bot-interface.js';
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
        this.discoveryRelays = (config?.discoveryRelays ?? [...DISCOVERY_RELAYS])
            .map((relay) => relay.trim())
            .filter(Boolean);
        this.publishRetries = Math.max(0, config?.publishRetries ?? 1);
        this.legacyNip04 = config?.legacyNip04 === true;
        this.selfWrap = config?.selfWrap !== false;
        this.useInboxRelays = config?.useInboxRelays !== false;
        // Inbox lists are replaceable events, so the discovery indexers are the
        // reliable place to find one even when a recipient's own relay is down.
        this.inboxRelays = new InboxRelayResolver(this.pool, Array.from(new Set([...this.relays, ...this.discoveryRelays])));
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
    /**
     * Publish this bot's own NIP-17 inbox relay list, so other clients know where
     * to deliver its gift wraps instead of guessing.
     */
    async publishInboxRelayList(relays) {
        const event = buildInboxRelayList(relays ?? this.relays, this.privateKeyBytes);
        await this.publish(event, Array.from(new Set([...this.relays, ...this.discoveryRelays])), this.publishRetries);
    }
    async publishEvent(event, relays) {
        return this.publish(event, relays ?? this.relays, this.publishRetries);
    }
    /**
     * Publish a gift wrap to where `recipientPubkey` actually looks for it.
     *
     * The recipient's inbox relays are used when it publishes a kind 10050 and
     * {@link useInboxRelays} is on; otherwise this falls back to the bot's own
     * relays, which is also where the send lands if the lookup finds nothing.
     */
    async publishGiftWrap(event, recipientPubkey) {
        if (!this.useInboxRelays) {
            return this.publishEvent(event);
        }
        let targets = this.relays;
        try {
            targets = await this.inboxRelays.targetsFor(recipientPubkey, this.relays);
        }
        catch {
            // A lookup failure is never a send failure — fall back to our own relays.
        }
        return this.publish(event, targets, this.publishRetries);
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
