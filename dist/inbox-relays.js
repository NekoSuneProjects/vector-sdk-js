/**
 * NIP-17 kind 10050 (DM relay list) support.
 *
 * A port of the routing half of `vector_core::inbox_relays`. A gift wrap is
 * only useful where its recipient looks for it, so Vector reads the
 * recipient's published inbox relays and delivers there, falling back to the
 * sender's own relays when a pubkey publishes no list.
 */
import { finalizeEvent } from 'nostr-tools/pure';
import { DM_RELAY_LIST } from './kinds.js';
import { normalizePublicKey } from './keys.js';
/** How long a resolved inbox list is trusted before it is re-fetched. */
export const INBOX_CACHE_TTL_MS = 10 * 60 * 1000;
/** How long to wait on relays for a 10050 lookup. */
const FETCH_TIMEOUT_MS = 3000;
/**
 * Cap on relays adopted from a foreign list. Bounds a hostile or bloated remote
 * list from costing us unbounded connections.
 */
export const MAX_INBOX_RELAYS = 10;
/**
 * Normalize a relay URL for comparison: lowercase scheme and host, no trailing
 * slash. The original string form is what gets used for connecting.
 */
export function normalizeRelayUrl(url) {
    const trimmed = url.trim();
    try {
        const parsed = new URL(trimmed);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}`;
    }
    catch {
        return trimmed.toLowerCase().replace(/\/+$/, '');
    }
}
/** Extract relay URLs from a kind 10050 event's `["relay", "wss://…"]` tags. */
export function parseRelayTags(tags) {
    const out = [];
    const seen = new Set();
    for (const tag of tags) {
        if (tag[0] !== 'relay' || typeof tag[1] !== 'string' || !tag[1].trim()) {
            continue;
        }
        const url = tag[1].trim();
        const normalized = normalizeRelayUrl(url);
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        out.push(url);
        if (out.length >= MAX_INBOX_RELAYS) {
            break;
        }
    }
    return out;
}
/**
 * Resolves and caches the inbox relays a pubkey wants its gift wraps delivered
 * to.
 *
 * A miss is cached too: a pubkey that publishes no 10050 is a normal, common
 * state, and re-querying every relay on every send would be far more expensive
 * than the fallback it resolves to.
 */
export class InboxRelayResolver {
    constructor(pool, lookupRelays, ttlMs = INBOX_CACHE_TTL_MS) {
        this.pool = pool;
        this.lookupRelays = lookupRelays;
        this.ttlMs = ttlMs;
        this.cache = new Map();
        this.inFlight = new Map();
    }
    /**
     * The inbox relays for `pubkey`, or an empty array when it publishes none.
     *
     * Concurrent calls for the same pubkey share one lookup, so a burst of sends
     * to the same recipient costs a single query.
     */
    async resolve(pubkey) {
        const hex = normalizePublicKey(pubkey);
        const cached = this.cache.get(hex);
        if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
            return cached.relays;
        }
        const existing = this.inFlight.get(hex);
        if (existing) {
            return existing;
        }
        const lookup = this.fetch(hex)
            .then((relays) => {
            this.cache.set(hex, { relays, fetchedAt: Date.now() });
            return relays;
        })
            .catch(() => {
            // A failed lookup caches as a miss so one unreachable relay set does not
            // stall every subsequent send; the TTL retries it soon enough.
            this.cache.set(hex, { relays: [], fetchedAt: Date.now() });
            return [];
        })
            .finally(() => {
            this.inFlight.delete(hex);
        });
        this.inFlight.set(hex, lookup);
        return lookup;
    }
    /**
     * Where a gift wrap for `pubkey` should go: its inbox relays, or `fallback`
     * when it publishes none.
     */
    async targetsFor(pubkey, fallback) {
        const inbox = await this.resolve(pubkey);
        return inbox.length ? inbox : fallback;
    }
    /** Drop a cached entry, forcing the next resolve to re-query. */
    invalidate(pubkey) {
        this.cache.delete(normalizePublicKey(pubkey));
    }
    async fetch(hex) {
        if (!this.lookupRelays.length) {
            return [];
        }
        const filter = {
            kinds: [DM_RELAY_LIST],
            authors: [hex],
            limit: 1,
        };
        const event = await Promise.race([
            this.pool.get(this.lookupRelays, filter),
            new Promise((resolve) => {
                setTimeout(() => resolve(null), FETCH_TIMEOUT_MS);
            }),
        ]);
        return event ? parseRelayTags(event.tags) : [];
    }
}
/**
 * Build this bot's own kind 10050, advertising where it wants gift wraps
 * delivered. Publishing one is what lets other clients reach the bot without
 * guessing at its relay set.
 */
export function buildInboxRelayList(relays, privateKeyBytes) {
    const seen = new Set();
    const tags = [];
    for (const relay of relays) {
        const url = relay.trim();
        if (!url) {
            continue;
        }
        const normalized = normalizeRelayUrl(url);
        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        tags.push(['relay', url]);
        if (tags.length >= MAX_INBOX_RELAYS) {
            break;
        }
    }
    return finalizeEvent({
        kind: DM_RELAY_LIST,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '',
    }, privateKeyBytes);
}
