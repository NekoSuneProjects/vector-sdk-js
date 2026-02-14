import { SimplePool, Event } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';
import type { Metadata } from './metadata.js';
import { normalizePrivateKey } from './keys.js';

export interface ClientConfig {
  proxy?: string;
  defaultRelays?: string[];
  publishRetries?: number;
}

const DEFAULT_RELAYS = [
  'wss://jskitty.cat/nostr',
  'wss://relay.damus.io',
  'wss://auth.nostr1.com',
  'wss://nostr.computingcache.com',
];

function ensureWebSocket(): void {
  if (typeof globalThis.WebSocket === 'undefined') {
    globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
  }
}

export class VectorClient {
  public readonly pool = new SimplePool();
  public readonly relays: string[];
  public readonly publicKey: string;
  public readonly privateKey: string;
  public readonly privateKeyBytes: Uint8Array;
  private readonly publishRetries: number;

  constructor(keys: string, config?: ClientConfig) {
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

  public async setMetadata(metadata: Metadata): Promise<void> {
    const event: Event = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(metadata),
      },
      this.privateKeyBytes,
    );

    await this.publish(event, this.relays, this.publishRetries);
  }

  public async publishEvent(event: Event, relays?: string[]): Promise<void> {
    return this.publish(event, relays ?? this.relays, this.publishRetries);
  }

  private async publish(event: Event, relays: string[], retries = 0): Promise<void> {
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
    const reason =
      firstRejected && firstRejected.status === 'rejected'
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

export function buildClient(keys: string, config?: ClientConfig): VectorClient {
  return new VectorClient(keys, config);
}
