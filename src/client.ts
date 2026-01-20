import { finishEvent, getPublicKey, SimplePool, Event } from 'nostr-tools';
import type { Metadata } from './metadata';

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

export class VectorClient {
  public readonly pool = new SimplePool();
  public readonly relays: string[];
  public readonly publicKey: string;
  public readonly privateKey: string;

  constructor(keys: string, config?: ClientConfig) {
    this.privateKey = keys;
    this.publicKey = getPublicKey(keys);
    this.relays = config?.defaultRelays ?? DEFAULT_RELAYS;
  }

  public async setMetadata(metadata: Metadata): Promise<void> {
    const event: Event = finishEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: JSON.stringify(metadata),
        pubkey: this.publicKey,
      },
      this.privateKey,
    );

    await this.publish(event);
  }

  public async publishEvent(event: Event, relays?: string[]): Promise<void> {
    return this.publish(event, relays ?? this.relays);
  }

  private publish(event: Event, relays: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const pub = this.pool.publish(relays, event);
      pub.on('ok', () => resolve());
      pub.on('failed', (_relay, reason) => reject(new Error(reason ?? 'Publish failed')));
    });
  }
}

export function buildClient(keys: string, config?: ClientConfig): VectorClient {
  return new VectorClient(keys, config);
}
