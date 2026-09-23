import { Filter } from 'nostr-tools';
export declare class SubscriptionError extends Error {
}
export interface SubscriptionConfig {
    pubkey: string;
    kind: number;
    limit: number;
}
export declare const DEFAULT_SUBSCRIPTION_CONFIG: SubscriptionConfig;
export declare function createGiftWrapSubscription(pubkey: string, kind?: number, limit?: number): Filter;
