import { GiftWrap } from 'nostr-tools/kinds';
export class SubscriptionError extends Error {
}
export const DEFAULT_SUBSCRIPTION_CONFIG = {
    pubkey: '',
    kind: GiftWrap,
    limit: 0,
};
export function createGiftWrapSubscription(pubkey, kind, limit) {
    const resolvedKind = kind ?? GiftWrap;
    const resolvedLimit = limit ?? 0;
    if (resolvedLimit > 1000) {
        throw new SubscriptionError('Limit exceeds maximum allowed value (1000)');
    }
    return {
        kinds: [resolvedKind],
        '#p': [pubkey],
        limit: resolvedLimit,
    };
}
