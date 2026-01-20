import { Filter } from 'nostr-tools';
import { GiftWrap } from 'nostr-tools/kinds';

export class SubscriptionError extends Error {}

export interface SubscriptionConfig {
  pubkey: string;
  kind: number;
  limit: number;
}

export const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig = {
  pubkey: '',
  kind: GiftWrap,
  limit: 0,
};

export function createGiftWrapSubscription(
  pubkey: string,
  kind?: number,
  limit?: number,
): Filter {
  const resolvedKind = kind ?? GiftWrap;
  const resolvedLimit = limit ?? 0;

  if (resolvedLimit > 1000) {
    throw new SubscriptionError('Limit exceeds maximum allowed value (1000)');
  }

  return {
    kinds: [resolvedKind],
    '#p': [pubkey],
    limit: resolvedLimit,
  } as Filter;
}
