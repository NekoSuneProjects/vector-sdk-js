/**
 * NIP-17 kind 10050 (DM relay list) support.
 *
 * A port of the routing half of `vector_core::inbox_relays`. A gift wrap is
 * only useful where its recipient looks for it, so Vector reads the
 * recipient's published inbox relays and delivers there, falling back to the
 * sender's own relays when a pubkey publishes no list.
 */
import type { Event } from 'nostr-tools';
import { SimplePool } from 'nostr-tools';
/** How long a resolved inbox list is trusted before it is re-fetched. */
export declare const INBOX_CACHE_TTL_MS: number;
/**
 * Cap on relays adopted from a foreign list. Bounds a hostile or bloated remote
 * list from costing us unbounded connections.
 */
export declare const MAX_INBOX_RELAYS = 10;
/**
 * Normalize a relay URL for comparison: lowercase scheme and host, no trailing
 * slash. The original string form is what gets used for connecting.
 */
export declare function normalizeRelayUrl(url: string): string;
/** Extract relay URLs from a kind 10050 event's `["relay", "wss://…"]` tags. */
export declare function parseRelayTags(tags: string[][]): string[];
/**
 * Resolves and caches the inbox relays a pubkey wants its gift wraps delivered
 * to.
 *
 * A miss is cached too: a pubkey that publishes no 10050 is a normal, common
 * state, and re-querying every relay on every send would be far more expensive
 * than the fallback it resolves to.
 */
export declare class InboxRelayResolver {
    private readonly pool;
    private readonly lookupRelays;
    private readonly ttlMs;
    private readonly cache;
    private readonly inFlight;
    constructor(pool: SimplePool, lookupRelays: string[], ttlMs?: number);
    /**
     * The inbox relays for `pubkey`, or an empty array when it publishes none.
     *
     * Concurrent calls for the same pubkey share one lookup, so a burst of sends
     * to the same recipient costs a single query.
     */
    resolve(pubkey: string): Promise<string[]>;
    /**
     * Where a gift wrap for `pubkey` should go: its inbox relays, or `fallback`
     * when it publishes none.
     */
    targetsFor(pubkey: string, fallback: string[]): Promise<string[]>;
    /** Drop a cached entry, forcing the next resolve to re-query. */
    invalidate(pubkey: string): void;
    private fetch;
}
/**
 * Build this bot's own kind 10050, advertising where it wants gift wraps
 * delivered. Publishing one is what lets other clients reach the bot without
 * guessing at its relay set.
 */
export declare function buildInboxRelayList(relays: string[], privateKeyBytes: Uint8Array): Event;
