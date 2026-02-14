import { EventEmitter } from 'events';
import type { Event } from 'nostr-tools';
import * as nip04 from 'nostr-tools/nip04';
import * as nip59 from 'nostr-tools/nip59';
import { ChatMessage, EncryptedDirectMessage, PrivateDirectMessage } from 'nostr-tools/kinds';
import { finalizeEvent } from 'nostr-tools/pure';

import { VectorBot } from './bot.js';
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
  vectorOnly?: boolean;
  mlsAdapter?: MlsAdapter;
  autoDiscoverGroups?: boolean;
  discoverGroupsFromHistory?: boolean;
  historySinceHours?: number;
  historyMaxEvents?: number;
  debug?: boolean;
  profile?: Partial<BotProfile>;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
};

export type MlsDecryptedMessage = {
  groupId: string;
  senderPubkey: string;
  content: string;
  kind?: number;
};

export type MlsAdapter = {
  ensureKeyPackage?: (context: {
    botPublicKey: string;
    botPrivateKey: string;
    relays: string[];
  }) => Promise<{ published: boolean; eventId?: string } | null>;
  syncWelcomes?: (context: {
    botPublicKey: string;
    botPrivateKey: string;
    relays: string[];
    sinceHours?: number;
    limit?: number;
  }) => Promise<{ processed: number; accepted?: number; groups: string[] } | null>;
  processWelcome?: (
    input: {
      wrapperEvent: Event;
      rumorJson: string;
      groupIdHint?: string;
      context: {
        botPublicKey: string;
        botPrivateKey: string;
        botPrivateKeyBytes: Uint8Array;
        relays: string[];
      };
    },
  ) => Promise<{ groupId?: string } | null>;
  decryptGroupWrapper: (wrapper: Event) => Promise<MlsDecryptedMessage | null>;
  sendGroupMessage?: (
    groupId: string,
    message: string,
    context: {
      botPublicKey: string;
      botPrivateKey: string;
      botPrivateKeyBytes: Uint8Array;
      relays: string[];
    },
  ) => Promise<boolean>;
  bootstrapGroups?: (context: {
    botPublicKey: string;
    relays: string[];
    knownGroupIds: string[];
  }) => Promise<string[]>;
};

export type MessageTags = {
  pubkey: string;
  conversationId: string;
  groupId?: string;
  isGroup?: boolean;
  botInGroup?: boolean;
  directedToBot?: boolean;
  origin?: 'dm' | 'group';
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
  private readonly relayDownStreak = new Map<string, number>();
  private readonly relayUpStreak = new Map<string, number>();
  private readonly relayLastReconnectAttemptAt = new Map<string, number>();
  private readonly reconnectingRelays = new Set<string>();
  private readonly configuredGroupIds = new Set<string>();
  private readonly joinedGroupIds = new Set<string>();
  private readonly knownGroupIds = new Set<string>();
  private readonly observedGroupIds = new Set<string>();
  private readonly seenMessageIds = new Set<string>();
  private connectionMonitor?: NodeJS.Timeout;
  private connectionMonitorStartedAt = 0;

  constructor(options: BotClientOptions) {
    super();
    this.options = options;
    for (const groupId of options.groupIds ?? []) {
      const normalized = groupId.trim();
      if (normalized) {
        this.configuredGroupIds.add(normalized);
        this.joinedGroupIds.add(normalized);
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
    if (this.options.mlsAdapter?.ensureKeyPackage) {
      try {
        const result = await this.options.mlsAdapter.ensureKeyPackage({
          botPublicKey: bot.publicKey,
          botPrivateKey: bot.privateKey,
          relays: bot.client.relays,
        });
        this.emit('mls_keypackage', {
          published: result?.published ?? false,
          eventId: result?.eventId,
        });
      } catch (error) {
        this.log('MLS adapter ensureKeyPackage failed:', error);
        this.emit('error', error);
      }
    }
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

    const vectorOnly = this.options.vectorOnly !== false;
    if (vectorOnly) {
      const adapter = this.options.mlsAdapter;
      if (!adapter?.sendGroupMessage) {
        this.emit('error', new Error('Vector MLS group send requires options.mlsAdapter.sendGroupMessage'));
        return false;
      }
      const sent = await adapter.sendGroupMessage(normalizedGroupId, message, {
        botPublicKey: this.bot.publicKey,
        botPrivateKey: this.bot.privateKey,
        botPrivateKeyBytes: this.bot.privateKeyBytes,
        relays: this.bot.client.relays,
      });
      if (!sent) {
        return false;
      }
    } else {
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
    }

    this.joinedGroupIds.add(normalizedGroupId);
    this.knownGroupIds.add(normalizedGroupId);
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
    const disconnectThreshold = 2;
    const reconnectThreshold = 2;
    const reconnectBackoffMs = Math.max(15000, interval * 2);
    const warmupMs = Math.max(20000, interval * 2);
    this.connectionMonitorStartedAt = Date.now();

    this.connectionMonitor = setInterval(() => {
      const status = bot.client.pool.listConnectionStatus();
      for (const relay of bot.client.relays) {
        const connected = status.get(relay) ?? false;
        const previousStable = this.connectionState.get(relay);
        const downStreak = (this.relayDownStreak.get(relay) ?? 0) + (connected ? 0 : 1);
        const upStreak = (this.relayUpStreak.get(relay) ?? 0) + (connected ? 1 : 0);
        this.relayDownStreak.set(relay, connected ? 0 : downStreak);
        this.relayUpStreak.set(relay, connected ? upStreak : 0);

        if (previousStable === undefined) {
          this.connectionState.set(relay, connected);
        } else if (previousStable && !connected && downStreak >= disconnectThreshold) {
          if (Date.now() - this.connectionMonitorStartedAt >= warmupMs) {
            this.connectionState.set(relay, false);
            this.emit('disconnect', { relay, error: new Error('Relay disconnected') });
          }
        } else if (previousStable === false && connected && upStreak >= reconnectThreshold) {
          this.connectionState.set(relay, true);
          this.emit('reconnect', { relay });
        }

        if (shouldReconnect && !connected) {
          const lastAttempt = this.relayLastReconnectAttemptAt.get(relay) ?? 0;
          if (Date.now() - lastAttempt < reconnectBackoffMs) {
            continue;
          }
          this.relayLastReconnectAttemptAt.set(relay, Date.now());
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
    } catch (error) {
      this.emit('error', error);
    } finally {
      this.reconnectingRelays.delete(relay);
    }
  }

  private setupSubscriptions(bot: VectorBot): void {
    const giftWrapFilter = {
      kinds: [GIFT_WRAP_KIND],
      limit: 0,
    };
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
      limit: 0,
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

    const vectorOnly = this.options.vectorOnly !== false;
    const groupKind = vectorOnly ? VECTOR_MLS_GROUP_WRAPPER_KIND : ChatMessage;
    const groupFilter = {
      kinds: [groupKind],
      ...(autoDiscoverGroups ? {} : { '#h': groupIds }),
      limit: 0,
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
    const sinceHours = Math.max(1, this.options.historySinceHours ?? 24 * 30);
    const limit = Math.max(10, this.options.historyMaxEvents ?? 500);
    const vectorOnly = this.options.vectorOnly !== false;
    const groupKind = vectorOnly ? VECTOR_MLS_GROUP_WRAPPER_KIND : ChatMessage;

    try {
      await Promise.allSettled(bot.client.relays.map((relay) => bot.client.pool.ensureRelay(relay)));

      const giftWrapFilter = {
        kinds: [GIFT_WRAP_KIND],
        since: now - sinceHours * 3600,
        limit,
      };

      let giftWrapEvents = await bot.client.pool.querySync(
        bot.client.relays,
        giftWrapFilter,
        { maxWait: 4000 },
      );
      if (!giftWrapEvents.length) {
        giftWrapEvents = await bot.client.pool.querySync(
          bot.client.relays,
          { kinds: [GIFT_WRAP_KIND], limit },
          { maxWait: 5000 },
        );
      }
      for (const event of giftWrapEvents) {
        this.handleGiftWrap(bot, event, false);
      }

      if (this.options.mlsAdapter?.syncWelcomes) {
        try {
          const synced = await this.options.mlsAdapter.syncWelcomes({
            botPublicKey: bot.publicKey,
            botPrivateKey: bot.privateKey,
            relays: bot.client.relays,
            sinceHours,
            limit,
          });
          this.emit('mls_welcome_sync', {
            processed: synced?.processed ?? 0,
            accepted: synced?.accepted ?? 0,
            groups: synced?.groups ?? [],
          });
          if (synced?.groups?.length) {
            for (const groupId of synced.groups) {
              const normalized = groupId.trim();
              if (!normalized) {
                continue;
              }
              if (!this.knownGroupIds.has(normalized)) {
                this.knownGroupIds.add(normalized);
                this.joinedGroupIds.add(normalized);
                this.emit('group_discovered', {
                  groupId: normalized,
                  eventId: 'adapter-sync-welcomes',
                  sender: bot.publicKey,
                  source: 'adapter',
                });
              }
            }
          }
          if ((synced?.processed ?? 0) > 0 || (synced?.accepted ?? 0) > 0 || (synced?.groups?.length ?? 0) > 0) {
            this.emit('mls_welcome_processed', { groupId: synced?.groups?.join(',') || undefined });
          }
        } catch (error) {
          this.log('MLS adapter syncWelcomes failed:', error);
          this.emit('mls_welcome_process_failed', { error: String(error) });
          this.emit('error', error);
        }
      }

      if (this.options.mlsAdapter?.bootstrapGroups) {
        try {
          const groups = await this.options.mlsAdapter.bootstrapGroups({
            botPublicKey: bot.publicKey,
            relays: bot.client.relays,
            knownGroupIds: this.getKnownGroupIds(),
          });
          for (const groupId of groups) {
            const normalized = groupId.trim();
            if (!normalized) {
              continue;
            }
            if (!this.knownGroupIds.has(normalized)) {
              this.knownGroupIds.add(normalized);
              this.joinedGroupIds.add(normalized);
              this.emit('group_discovered', {
                groupId: normalized,
                eventId: 'adapter-bootstrap',
                sender: bot.publicKey,
                source: 'adapter',
              });
            }
          }
        } catch (error) {
          this.log('MLS adapter bootstrap failed:', error);
          this.emit('error', error);
        }
      }

      const wrapperFilter = {
        kinds: [groupKind],
        since: now - sinceHours * 3600,
        limit,
      };

      let events = await bot.client.pool.querySync(
        bot.client.relays,
        wrapperFilter,
        { maxWait: 4000 },
      );
      if (!events.length) {
        events = await bot.client.pool.querySync(
          bot.client.relays,
          { kinds: [groupKind], limit },
          { maxWait: 5000 },
        );
      }

      let discovered = 0;
      for (const event of events) {
        const groupId = this.extractGroupIdFromEvent(event);
        if (!groupId) {
          continue;
        }
        this.observedGroupIds.add(groupId);
        if (vectorOnly && !this.isGroupTracked(groupId)) {
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
      this.emit('group_bootstrap_debug', {
        relays: bot.client.relays,
        giftWrapEvents: giftWrapEvents.length,
        groupWrapperEvents: events.length,
        sinceHours,
        limit,
      });
      this.emit('group_bootstrap_complete', {
        discovered,
        knownGroupIds: this.getKnownGroupIds(),
      });
    } catch (error) {
      this.log('Group history bootstrap failed:', error);
      this.emit('error', error);
    }
  }

  private handleGiftWrap(bot: VectorBot, event: Event, emitDirectMessages = true): void {
    try {
      const rumor = nip59.unwrapEvent(event, bot.privateKeyBytes);
      this.log('Gift-wrap rumor:', rumor);

      if (emitDirectMessages && rumor.kind === PrivateDirectMessage && rumor.content) {
        this.emitMessage(bot, rumor.pubkey, rumor.kind, event, rumor.content, true);
        return;
      }

      if (rumor.kind === VECTOR_MLS_GROUP_WRAPPER_KIND) {
        const normalizedWrapper = this.normalizeRumorWrapperEvent(rumor, event);
        this.handleGroupMessage(bot, normalizedWrapper);
        return;
      }

      if (rumor.kind === VECTOR_MLS_WELCOME_KIND) {
        const groupIdHint = this.findFirstTagValue(rumor, 'h');
        const discoveredGroupId = groupIdHint;
        if (discoveredGroupId) {
          this.knownGroupIds.add(discoveredGroupId);
          this.joinedGroupIds.add(discoveredGroupId);
          this.emit('group_discovered', {
            groupId: discoveredGroupId,
            eventId: event.id,
            sender: rumor.pubkey,
            source: 'welcome',
          });
        }

        if (this.options.mlsAdapter?.processWelcome) {
          const rumorJson = JSON.stringify(rumor);
          this.options.mlsAdapter.processWelcome({
            wrapperEvent: event,
            rumorJson,
            groupIdHint,
            context: {
              botPublicKey: bot.publicKey,
              botPrivateKey: bot.privateKey,
              botPrivateKeyBytes: bot.privateKeyBytes,
              relays: bot.client.relays,
            },
          }).then((result) => {
            this.emit('mls_welcome_processed', { groupId: result?.groupId });
            const groupId = result?.groupId?.trim();
            if (!groupId) {
              return;
            }
            if (!this.knownGroupIds.has(groupId)) {
              this.knownGroupIds.add(groupId);
              this.joinedGroupIds.add(groupId);
              this.emit('group_discovered', {
                groupId,
                eventId: event.id,
                sender: rumor.pubkey,
                source: 'welcome-adapter',
              });
            }
          }).catch((error) => {
            this.log('MLS adapter processWelcome failed:', error);
            this.emit('mls_welcome_process_failed', { error: String(error) });
            this.emit('error', error);
          });
        }
        this.emit('mls_welcome', { rawEvent: event, rumor });
      }
    } catch (error) {
      // With broad GiftWrap subscription, unwrap failures are expected for events not addressed to us.
      this.log('Ignored non-decryptable gift-wrap event');
    }
  }

  private normalizeRumorWrapperEvent(
    rumor: { kind: number; tags: string[][]; content: string; created_at?: number; pubkey: string; id?: string; sig?: string },
    outerEvent: Event,
  ): Event {
    const rumorId = typeof rumor.id === 'string' && /^[a-f0-9]{64}$/i.test(rumor.id)
      ? rumor.id
      : outerEvent.id;
    const rumorSig = typeof rumor.sig === 'string' && rumor.sig.length > 0
      ? rumor.sig
      : outerEvent.sig;
    const rumorCreatedAt = typeof rumor.created_at === 'number'
      ? rumor.created_at
      : outerEvent.created_at;

    return {
      id: rumorId,
      pubkey: rumor.pubkey || outerEvent.pubkey,
      created_at: rumorCreatedAt,
      kind: rumor.kind,
      tags: Array.isArray(rumor.tags) ? rumor.tags : outerEvent.tags,
      content: typeof rumor.content === 'string' ? rumor.content : outerEvent.content,
      sig: rumorSig,
    };
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
    const vectorOnly = this.options.vectorOnly !== false;
    const expectedKind = vectorOnly ? VECTOR_MLS_GROUP_WRAPPER_KIND : ChatMessage;
    if (event.kind !== expectedKind) {
      this.log('Unhandled group event:', event);
      return;
    }

    const groupId = this.extractGroupIdFromEvent(event);
    if (!groupId) {
      this.log('Skipping group event without h tag:', event.id);
      this.emit('group_wrapper_unresolved', {
        eventId: event.id,
        sender: event.pubkey,
        tagKeys: event.tags.map((tag) => tag[0]),
      });
      return;
    }

    this.observedGroupIds.add(groupId);

    if (vectorOnly) {
      // Vector uses broad Kind:444 streams. Ignore wrappers for groups we are not in.
      if (!this.isGroupTracked(groupId)) {
        return;
      }
      if (!this.knownGroupIds.has(groupId)) {
        this.knownGroupIds.add(groupId);
        this.log('Discovered group:', groupId);
        this.emit('group_discovered', { groupId, eventId: event.id, sender: event.pubkey, source: 'live' });
      }
      this.emit('group_wrapper', { groupId, rawEvent: event });
      if (this.options.mlsAdapter?.decryptGroupWrapper) {
        this.options.mlsAdapter.decryptGroupWrapper(event)
          .then((decrypted) => {
            if (!decrypted?.content) {
              this.emit('mls_wrapper_decrypt_miss', { groupId, eventId: event.id });
              return;
            }
            this.emit('mls_wrapper_decrypt_hit', {
              groupId: decrypted.groupId || groupId,
              eventId: event.id,
              sender: decrypted.senderPubkey || event.pubkey,
            });
            const resolvedGroupId = decrypted.groupId || groupId;
            this.knownGroupIds.add(resolvedGroupId);
            this.joinedGroupIds.add(resolvedGroupId);
            const botInGroup = true;
            const directedToBot = this.isGroupContentDirectedToBot(
              bot,
              decrypted.content,
              true,
              event.tags,
            );
            this.emitMessage(
              bot,
              decrypted.senderPubkey || event.pubkey,
              decrypted.kind ?? ChatMessage,
              event,
              decrypted.content,
              false,
              {
                conversationId: resolvedGroupId,
                groupId: resolvedGroupId,
                isGroup: true,
                botInGroup,
                directedToBot,
              },
            ).catch((error) => {
              this.log('Failed to emit decrypted MLS group message:', error);
              this.emit('error', error);
            });
          })
          .catch((error) => {
            this.log('MLS adapter decrypt failed:', error);
            this.emit('mls_wrapper_decrypt_failed', { groupId, eventId: event.id, error: String(error) });
            this.emit('error', error);
          });
      }
      return;
    }

    const botInGroup = this.isBotInGroup(bot, groupId, event);
    const directedToBot = this.isGroupMessageDirectedToBot(bot, event, botInGroup);
    this.emitMessage(bot, event.pubkey, event.kind, event, event.content, false, {
      conversationId: groupId,
      groupId,
      isGroup: true,
      botInGroup,
      directedToBot,
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
    override?: { conversationId?: string; groupId?: string; isGroup?: boolean; botInGroup?: boolean; directedToBot?: boolean },
  ): Promise<void> {
    if (this.seenMessageIds.has(rawEvent.id)) {
      return;
    }
    this.seenMessageIds.add(rawEvent.id);
    if (this.seenMessageIds.size > 10000) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest) {
        this.seenMessageIds.delete(oldest);
      }
    }

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
        botInGroup: override?.isGroup ? override?.botInGroup ?? false : false,
        directedToBot: override?.isGroup ? override?.directedToBot ?? false : true,
        origin: override?.isGroup ? 'group' : 'dm',
        kind,
        rawEvent,
        wrapped,
        displayName: profile?.displayName || profile?.name,
      },
      content,
      self,
    );
  }

  private findFirstTagValue(eventLike: { tags: string[][] }, tagName: string): string | undefined {
    for (const tag of eventLike.tags) {
      if (tag[0] === tagName && typeof tag[1] === 'string') {
        return tag[1];
      }
    }
    return undefined;
  }

  private extractGroupIdFromEvent(event: Event): string | undefined {
    const fromH = this.findFirstTagValue(event, 'h') ?? this.findFirstTagValue(event, 'H');
    if (fromH) {
      return fromH;
    }

    const fromD = this.findFirstTagValue(event, 'd');
    if (fromD && /^[a-f0-9]{32,64}$/i.test(fromD)) {
      return fromD;
    }

    for (const tag of event.tags) {
      const value = tag[1];
      if (typeof value === 'string' && /^[a-f0-9]{32,64}$/i.test(value)) {
        return value;
      }
    }

    return undefined;
  }

  private isGroupMessageDirectedToBot(bot: VectorBot, event: Event, botInGroup: boolean): boolean {
    return this.isGroupContentDirectedToBot(bot, event.content ?? '', botInGroup, event.tags);
  }

  private isGroupContentDirectedToBot(
    bot: VectorBot,
    content: string,
    botInGroup: boolean,
    tags: string[][],
  ): boolean {
    // Direct mention via p-tag to bot pubkey
    for (const tag of tags) {
      if (tag[0] === 'p' && tag[1] === bot.publicKey) {
        return true;
      }
    }

    const text = (content ?? '').trim();
    if (!text) {
      return false;
    }

    const lower = text.toLowerCase();
    const botName = (bot.name ?? '').toLowerCase();
    const botDisplay = (bot.displayName ?? '').toLowerCase();

    if (botName && (lower.startsWith(`@${botName}`) || lower.startsWith(`${botName}:`))) {
      return true;
    }
    if (botDisplay && (lower.startsWith(`@${botDisplay}`) || lower.startsWith(`${botDisplay}:`))) {
      return true;
    }

    // Allow plain command invocation in groups only when bot is already known in that group.
    if (botInGroup && /^\!\S+/.test(text)) {
      return true;
    }

    return false;
  }

  private isBotInGroup(bot: VectorBot, groupId: string, event: Event): boolean {
    if (event.pubkey === bot.publicKey) {
      this.joinedGroupIds.add(groupId);
      return true;
    }
    if (this.joinedGroupIds.has(groupId)) {
      return true;
    }
    if (this.configuredGroupIds.has(groupId)) {
      return true;
    }
    return false;
  }

  private isGroupTracked(groupId: string): boolean {
    if (this.joinedGroupIds.has(groupId)) {
      return true;
    }
    if (this.configuredGroupIds.has(groupId)) {
      return true;
    }
    if (this.knownGroupIds.has(groupId)) {
      return true;
    }
    return false;
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

const VECTOR_MLS_GROUP_WRAPPER_KIND = 444;
const VECTOR_MLS_WELCOME_KIND = 443;
const GIFT_WRAP_KIND = 1059;
