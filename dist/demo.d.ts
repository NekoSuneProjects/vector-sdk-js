import { EventEmitter } from 'events';
import type { Event } from 'nostr-tools';
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
    }) => Promise<{
        published: boolean;
        eventId?: string;
    } | null>;
    syncWelcomes?: (context: {
        botPublicKey: string;
        botPrivateKey: string;
        relays: string[];
        sinceHours?: number;
        limit?: number;
    }) => Promise<{
        processed: number;
        accepted?: number;
        groups: string[];
    } | null>;
    processWelcome?: (input: {
        wrapperEvent: Event;
        rumorJson: string;
        groupIdHint?: string;
        context: {
            botPublicKey: string;
            botPrivateKey: string;
            botPrivateKeyBytes: Uint8Array;
            relays: string[];
        };
    }) => Promise<{
        groupId?: string;
    } | null>;
    decryptGroupWrapper: (wrapper: Event) => Promise<MlsDecryptedMessage | null>;
    sendGroupMessage?: (groupId: string, message: string, context: {
        botPublicKey: string;
        botPrivateKey: string;
        botPrivateKeyBytes: Uint8Array;
        relays: string[];
    }) => Promise<boolean>;
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
export declare class VectorBotClient extends EventEmitter {
    private bot?;
    private giftWrapSubscription?;
    private dmSubscription?;
    private groupSubscription?;
    private readonly options;
    private readonly profileCache;
    private readonly connectionState;
    private readonly relayDownStreak;
    private readonly relayUpStreak;
    private readonly relayLastReconnectAttemptAt;
    private readonly reconnectingRelays;
    private readonly configuredGroupIds;
    private readonly joinedGroupIds;
    private readonly knownGroupIds;
    private readonly observedGroupIds;
    private readonly seenMessageIds;
    private connectionMonitor?;
    private connectionMonitorStartedAt;
    constructor(options: BotClientOptions);
    getKnownGroupIds(): string[];
    connect(): Promise<void>;
    sendMessage(recipient: string, message: string): Promise<boolean>;
    sendFile(recipient: string, filePath: string): Promise<boolean>;
    sendGroupMessage(groupId: string, message: string): Promise<boolean>;
    close(): void;
    private startConnectionMonitor;
    private reconnectRelay;
    private setupSubscriptions;
    private bootstrapKnownGroups;
    private handleGiftWrap;
    private normalizeRumorWrapperEvent;
    private handleDirectMessage;
    private handleGroupMessage;
    private emitMessage;
    private findFirstTagValue;
    private extractGroupIdFromEvent;
    private isGroupMessageDirectedToBot;
    private isGroupContentDirectedToBot;
    private isBotInGroup;
    private isGroupTracked;
    private getProfile;
    private log;
}
