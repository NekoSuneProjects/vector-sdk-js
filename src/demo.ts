import { EventEmitter } from 'events';
import type { Event } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import * as nip59 from 'nostr-tools/nip59';
import { ChatMessage, EncryptedDirectMessage, PrivateDirectMessage } from 'nostr-tools/kinds';
import { finalizeEvent } from 'nostr-tools/pure';

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
  groupIds?: string[];
  autoDiscoverGroups?: boolean;
  discoverGroupsFromHistory?: boolean;
  historySinceHours?: number;
  historyMaxEvents?: number;
  debug?: boolean;
  profile?: Partial<BotProfile>;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
};

export type MessageTags = {
  pubkey: string;
  conversationId: string;
  groupId?: string;
  isGroup?: boolean;
  kind: number;
  rawEvent: Event;
  wrapped?: boolean;
  displayName?: string;
};

export class VectorBotClient extends EventEmitter {
  private bot?: VectorBot;
  private giftWrapSubscription?: { close: (reason?: string) => void };
  private dmSubscription?: { close: (reason?: string) => void };
  private groupSubscription?: { close: (reason?: string) => void };
  private readonly options: BotClientOptions;
  private readonly profileCache = new Map<string, { name?: string; displayName?: string }>();
  private readonly connectionState = new Map<string, boolean>();
  private readonly reconnectingRelays = new Set<string>();
  private readonly knownGroupIds = new Set<string>();
  private connectionMonitor?: NodeJS.Timeout;

  constructor(options: BotClientOptions) {
    super();
    this.options = options;
    for (const groupId of options.groupIds ?? []) {
      const normalized = groupId.trim();
      if (normalized) {
        this.knownGroupIds.add(normalized);
      }
    }
  }

  public getKnownGroupIds(): string[] {
    return Array.from(this.knownGroupIds);
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
    await this.bootstrapKnownGroups(bot);
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

  public async sendGroupMessage(groupId: string, message: string): Promise<boolean> {
    if (!this.bot) {
      throw new Error('Bot is not connected');
    }

    const normalizedGroupId = groupId.trim();
    if (!normalizedGroupId) {
      throw new Error('Missing groupId');
    }

    const event = finalizeEvent(
      {
        kind: ChatMessage,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['h', normalizedGroupId],
          ['ms', (Date.now() % 1000).toString()],
        ],
        content: message,
      },
      this.bot.privateKeyBytes,
    );

    await this.bot.client.publishEvent(event);
    this.log('Sent group message to', normalizedGroupId);
    return true;
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
    this.groupSubscription?.close('shutdown');
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

    const autoDiscoverGroups = this.options.autoDiscoverGroups === true;
    const groupIds = this.getKnownGroupIds();
    if (!autoDiscoverGroups && !groupIds.length) {
      this.groupSubscription = undefined;
      return;
    }

    const groupFilter = {
      kinds: [ChatMessage],
      ...(autoDiscoverGroups ? {} : { '#h': groupIds }),
    };

    this.groupSubscription = bot.client.pool.subscribe(bot.client.relays, groupFilter, {
      onevent: (event) => this.handleGroupMessage(bot, event),
      onclose: (reasons) => {
        this.log('Group subscription closed:', reasons);
        this.emit('disconnect', { relay: 'group', error: new Error(reasons.join(', ')) });
      },
    });
  }

  private async bootstrapKnownGroups(bot: VectorBot): Promise<void> {
    if (!this.options.discoverGroupsFromHistory) {
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const sinceHours = Math.max(1, this.options.historySinceHours ?? 24 * 7);
    const limit = Math.max(10, this.options.historyMaxEvents ?? 500);

    try {
      const events = await bot.client.pool.querySync(
        bot.client.relays,
        {
          kinds: [ChatMessage],
          since: now - sinceHours * 3600,
          limit,
        },
        { maxWait: 4000 },
      );

      let discovered = 0;
      for (const event of events) {
        const groupId = this.findFirstTagValue(event, 'h');
        if (!groupId) {
          continue;
        }
        if (!this.knownGroupIds.has(groupId)) {
          this.knownGroupIds.add(groupId);
          discovered += 1;
          this.emit('group_discovered', {
            groupId,
            eventId: event.id,
            sender: event.pubkey,
            source: 'history',
          });
        }
      }

      this.log('Group history bootstrap complete. discovered:', discovered, 'known:', this.knownGroupIds.size);
      this.emit('group_bootstrap_complete', {
        discovered,
        knownGroupIds: this.getKnownGroupIds(),
      });
    } catch (error) {
      this.log('Group history bootstrap failed:', error);
      this.emit('error', error);
    }
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

  private handleGroupMessage(bot: VectorBot, event: Event): void {
    if (event.kind !== ChatMessage) {
      this.log('Unhandled group event:', event);
      return;
    }

    const groupId = this.findFirstTagValue(event, 'h');
    if (!groupId) {
      this.log('Skipping group event without h tag:', event.id);
      return;
    }

    if (!this.knownGroupIds.has(groupId)) {
      this.knownGroupIds.add(groupId);
      this.log('Discovered group:', groupId);
      this.emit('group_discovered', { groupId, eventId: event.id, sender: event.pubkey, source: 'live' });
    }

    this.emitMessage(bot, event.pubkey, event.kind, event, event.content, false, {
      conversationId: groupId,
      groupId,
      isGroup: true,
    }).catch((error) => {
      this.log('Failed to emit group message:', error);
      this.emit('error', error);
    });
  }

  private async emitMessage(
    bot: VectorBot,
    pubkey: string,
    kind: number,
    rawEvent: Event,
    content: string,
    wrapped: boolean,
    override?: { conversationId?: string; groupId?: string; isGroup?: boolean },
  ): Promise<void> {
    const profile = await this.getProfile(bot, pubkey);
    const conversationId = override?.conversationId ?? pubkey;
    const self = pubkey === bot.publicKey;
    this.emit(
      'message',
      pubkey,
      {
        pubkey,
        conversationId,
        groupId: override?.groupId,
        isGroup: override?.isGroup ?? false,
        kind,
        rawEvent,
        wrapped,
        displayName: profile?.displayName || profile?.name,
      },
      content,
      self,
    );
  }

  private findFirstTagValue(event: Event, tagName: string): string | undefined {
    for (const tag of event.tags) {
      if (tag[0] === tagName && typeof tag[1] === 'string') {
        return tag[1];
      }
    }
    return undefined;
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
