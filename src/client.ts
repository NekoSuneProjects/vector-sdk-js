import { SimplePool, Event } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import WebSocket from 'ws';
import type { Metadata } from './metadata.js';
import { normalizePrivateKey } from './keys.js';

export interface ClientConfig {
  proxy?: string;
  defaultRelays?: string[];
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

  constructor(keys: string, config?: ClientConfig) {
    ensureWebSocket();
    const normalized = normalizePrivateKey(keys);
    this.privateKey = normalized.hex;
    this.privateKeyBytes = normalized.bytes;
    this.publicKey = getPublicKey(this.privateKeyBytes);
    this.relays = config?.defaultRelays ?? DEFAULT_RELAYS;
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

    await this.publish(event, this.relays);
  }

  public async publishEvent(event: Event, relays?: string[]): Promise<void> {
    return this.publish(event, relays ?? this.relays);
  }

  private async publish(event: Event, relays: string[]): Promise<void> {
    const results = await Promise.allSettled(this.pool.publish(relays, event));
    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected && rejected.status === 'rejected') {
      const reason = rejected.reason instanceof Error ? rejected.reason : new Error(String(rejected.reason));
      throw reason;
    }
  }
}

export function buildClient(keys: string, config?: ClientConfig): VectorClient {
  return new VectorClient(keys, config);
}
