import { EventEmitter } from 'events';
import type { Event } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import * as nip59 from 'nostr-tools/nip59';
import { EncryptedDirectMessage, PrivateDirectMessage } from 'nostr-tools/kinds';

import { VectorBot } from './bot.js';
import { createGiftWrapSubscription } from './subscription.js';
import { loadFile } from './bot.js';

export type BotProfile = {
  name: string;
  displayName: string;
  about: string;
  picture: string;
  banner: string;
  nip05: string;
  lud16: string;
};

export type BotClientOptions = {
  privateKey: string;
  relays: string[];
  debug?: boolean;
  profile?: Partial<BotProfile>;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
};

export type MessageTags = {
  pubkey: string;
  kind: number;
  rawEvent: Event;
  wrapped?: boolean;
  displayName?: string;
};

export class VectorBotClient extends EventEmitter {
  private bot?: VectorBot;
  private giftWrapSubscription?: { close: (reason?: string) => void };
  private dmSubscription?: { close: (reason?: string) => void };
  private readonly options: BotClientOptions;
  private readonly profileCache = new Map<string, { name?: string; displayName?: string }>();
  private readonly connectionState = new Map<string, boolean>();
  private readonly reconnectingRelays = new Set<string>();
  private connectionMonitor?: NodeJS.Timeout;

  constructor(options: BotClientOptions) {
    super();
    this.options = options;
  }

  public async connect(): Promise<void> {
    if (!this.options.privateKey) {
      throw new Error('Missing private key for bot client');
    }

    if (!this.options.relays.length) {
      throw new Error('At least one relay is required');
    }

    const profile: BotProfile = {
      name: 'vector-bot',
      displayName: 'Vector Bot',
      about: 'Vector bot created with the SDK',
      picture: 'https://example.com/avatar.png',
      banner: 'https://example.com/banner.png',
      nip05: '',
      lud16: '',
      ...this.options.profile,
    };

    const bot = await VectorBot.new(
      this.options.privateKey,
      profile.name,
      profile.displayName,
      profile.about,
      profile.picture,
      profile.banner,
      profile.nip05,
      profile.lud16,
      { defaultRelays: this.options.relays },
    );

    this.bot = bot;
    this.log('Connected. Bot public key:', bot.publicKey);
    this.setupSubscriptions(bot);
    this.startConnectionMonitor(bot);
    this.emit('ready', {
      pubkey: bot.publicKey,
      profile: {
        name: profile.name,
        displayName: profile.displayName,
      },
    });
  }

  public async sendMessage(recipient: string, message: string): Promise<boolean> {
    if (!this.bot) {
      throw new Error('Bot is not connected');
    }

    const channel = this.bot.getChat(recipient);
    const sent = await channel.sendPrivateMessage(message);
    this.log('Sent message to', recipient, 'status:', sent);
    return sent;
  }

  public async sendFile(recipient: string, filePath: string): Promise<boolean> {
    if (!this.bot) {
      throw new Error('Bot is not connected');
    }

    const channel = this.bot.getChat(recipient);
    const file = await loadFile(filePath);
    const sent = await channel.sendPrivateFile(file);
    this.log('Sent file to', recipient, 'status:', sent);
    return sent;
  }

  public close(): void {
    if (!this.bot) {
      return;
    }

    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = undefined;
    }
    this.giftWrapSubscription?.close('shutdown');
    this.dmSubscription?.close('shutdown');
    this.bot.client.pool.close(this.bot.client.relays);
  }

  private startConnectionMonitor(bot: VectorBot): void {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
    }

    const shouldReconnect = this.options.reconnect !== false;
    const interval = this.options.reconnectIntervalMs ?? 15000;

    this.connectionMonitor = setInterval(() => {
      const status = bot.client.pool.listConnectionStatus();
      for (const relay of bot.client.relays) {
        const connected = status.get(relay) ?? false;
        const previous = this.connectionState.get(relay);
        this.connectionState.set(relay, connected);

        if (previous === undefined) {
          if (!connected) {
            this.emit('disconnect', { relay, error: new Error('Relay disconnected') });
          }
        } else if (!connected && previous) {
          this.emit('disconnect', { relay, error: new Error('Relay disconnected') });
        } else if (connected && previous === false) {
          this.emit('reconnect', { relay });
        }

        if (shouldReconnect && !connected) {
          this.reconnectRelay(bot, relay);
        }
      }
    }, interval);
  }

  private async reconnectRelay(bot: VectorBot, relay: string): Promise<void> {
    if (this.reconnectingRelays.has(relay)) {
      return;
    }

    this.reconnectingRelays.add(relay);
    try {
      await bot.client.pool.ensureRelay(relay);
      this.connectionState.set(relay, true);
      this.emit('reconnect', { relay });
    } catch (error) {
      this.emit('error', error);
    } finally {
      this.reconnectingRelays.delete(relay);
    }
  }

  private setupSubscriptions(bot: VectorBot): void {
    const giftWrapFilter = createGiftWrapSubscription(bot.publicKey);
    this.giftWrapSubscription = bot.client.pool.subscribe(bot.client.relays, giftWrapFilter, {
      onevent: (event) => this.handleGiftWrap(bot, event),
      onclose: (reasons) => {
        this.log('Gift-wrap subscription closed:', reasons);
        this.emit('disconnect', { relay: 'gift-wrap', error: new Error(reasons.join(', ')) });
      },
    });

    const dmFilter = {
      kinds: [EncryptedDirectMessage, PrivateDirectMessage],
      '#p': [bot.publicKey],
    };

    this.dmSubscription = bot.client.pool.subscribe(bot.client.relays, dmFilter, {
      onevent: (event) => this.handleDirectMessage(bot, event),
      onclose: (reasons) => {
        this.log('DM subscription closed:', reasons);
        this.emit('disconnect', { relay: 'dm', error: new Error(reasons.join(', ')) });
      },
    });
  }

  private handleGiftWrap(bot: VectorBot, event: Event): void {
    try {
      const rumor = nip59.unwrapEvent(event, bot.privateKeyBytes);
      this.log('Gift-wrap rumor:', rumor);

      if (rumor.kind === PrivateDirectMessage && rumor.content) {
        this.emitMessage(bot, rumor.pubkey, rumor.kind, event, rumor.content, true);
      }
    } catch (error) {
      this.log('Failed to unwrap gift-wrap:', error);
      this.emit('error', error);
    }
  }

  private handleDirectMessage(bot: VectorBot, event: Event): void {
    if (event.kind !== EncryptedDirectMessage) {
      this.log('Unhandled DM event:', event);
      return;
    }

    try {
      const message = nip04.decrypt(bot.privateKey, event.pubkey, event.content);
      this.emitMessage(bot, event.pubkey, event.kind, event, message, false);
    } catch (error) {
      this.log('Failed to decrypt NIP-04 DM:', error);
      this.emit('error', error);
    }
  }

  private async emitMessage(
    bot: VectorBot,
    pubkey: string,
    kind: number,
    rawEvent: Event,
    content: string,
    wrapped: boolean,
  ): Promise<void> {
    const profile = await this.getProfile(bot, pubkey);
    this.emit(
      'message',
      pubkey,
      {
        pubkey,
        kind,
        rawEvent,
        wrapped,
        displayName: profile?.displayName || profile?.name,
      },
      content,
      false,
    );
  }

  private async getProfile(
    bot: VectorBot,
    pubkey: string,
  ): Promise<{ name?: string; displayName?: string } | undefined> {
    if (this.profileCache.has(pubkey)) {
      return this.profileCache.get(pubkey);
    }

    try {
      const event = await bot.client.pool.get(
        bot.client.relays,
        { kinds: [0], authors: [pubkey], limit: 1 },
      );
      if (event && event.content) {
        const metadata = JSON.parse(event.content) as { name?: string; displayName?: string };
        const profile = {
          name: metadata.name,
          displayName: metadata.displayName,
        };
        this.profileCache.set(pubkey, profile);
        return profile;
      }
    } catch (error) {
      this.log('Failed to load profile for', pubkey, error);
      this.emit('error', error);
    }

    this.profileCache.set(pubkey, {});
    return undefined;
  }

  private log(...args: unknown[]): void {
    if (!this.options.debug) {
      return;
    }
    console.log('[vector-bot]', ...args);
  }
}
