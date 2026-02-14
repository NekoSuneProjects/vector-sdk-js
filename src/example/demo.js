import { VectorBotClient, createMlsSidecarAdapter } from '../../dist/index.js';

const mlsSidecarBin = process.env.MLS_SIDECAR_BIN;
const mlsStateDir = process.env.MLS_STATE_DIR ?? '.vector-mls-sidecar';
const mlsAdapter = mlsSidecarBin
  ? createMlsSidecarAdapter({ binPath: mlsSidecarBin, stateDir: mlsStateDir })
  : undefined;
const defaultRelays = [
  'wss://jskitty.cat/nostr',
  'wss://asia.vectorapp.io/nostr',
  'wss://nostr.computingcache.com',
  'wss://relay.damus.io',
];
const configuredRelays = (process.env.NOSTR_RELAYS ?? '')
  .split(',')
  .map((relay) => relay.trim())
  .filter(Boolean);
const relays = Array.from(new Set([...configuredRelays, ...defaultRelays]));

if (!mlsAdapter) {
  console.warn('MLS sidecar is disabled. Set MLS_SIDECAR_BIN to enable private group decrypt/send.');
}

const client = new VectorBotClient({
  privateKey: process.env.NOSTR_PRIVATE_KEY,
  relays,
  groupIds: (process.env.NOSTR_GROUP_IDS ?? '')
    .split(',')
    .map((groupId) => groupId.trim())
    .filter(Boolean),
  vectorOnly: true,
  mlsAdapter,
  autoDiscoverGroups: true,
  discoverGroupsFromHistory: true,
  historySinceHours: Number(process.env.NOSTR_GROUP_HISTORY_HOURS ?? 24 * 14),
  historyMaxEvents: Number(process.env.NOSTR_GROUP_HISTORY_LIMIT ?? 1000),
  debug: process.env.DEBUG === '1',
  reconnect: true,
  reconnectIntervalMs: 15000,
  profile: {
    name: 'NekoBOT',
    displayName: 'NekoBOT',
    about: 'NEKO BOT is a Multipurpose BOT. helping you Know about Genshin Impact and many more to come. Creator: NekoSuneVR',
    picture: "https://cdn.discordapp.com/avatars/1289906859880480798/76da96706805b6c0109128a061edca64.png?size=4096",
    banner: "https://cdn.discordapp.com/banners/1289906859880480798/bbd7c59c329caae2a0d9547061ec4e47.png?size=4096"
  },
});

client.on('ready', ({ pubkey, profile }) => {
  const name = profile?.displayName || profile?.name || 'unknown';
  console.log(`Logged in as ${name} (${pubkey})`);
});

client.on('disconnect', ({ relay, error }) => {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  console.warn(`Disconnected from ${relay}${reason ? `: ${reason}` : ''}`);
});

client.on('reconnect', ({ relay }) => {
  console.log(`Reconnected to ${relay}`);
});

client.on('error', (error) => {
  console.error('Bot error:', error);
});

client.on('group_discovered', ({ groupId, eventId, sender }) => {
  console.log(`Discovered group ${groupId} from ${sender} via event ${eventId}`);
  console.log(`Known groups: ${client.getKnownGroupIds().join(', ')}`);
});

client.on('group_wrapper', ({ groupId }) => {
  console.log(`Vector MLS wrapper seen for group ${groupId}.`);
});

client.on('group_wrapper_unresolved', ({ eventId, sender, tagKeys }) => {
  console.log(`Unresolved Vector MLS wrapper ${eventId} from ${sender}. tagKeys=${tagKeys.join(',')}`);
});

client.on('mls_welcome', () => {
  console.log('Vector MLS welcome received.');
});

client.on('mls_welcome_processed', ({ groupId }) => {
  console.log(`MLS welcome processed${groupId ? ` for group ${groupId}` : ''}.`);
});

client.on('mls_keypackage', ({ published, eventId }) => {
  console.log(`MLS keypackage: published=${published}${eventId ? ` event=${eventId}` : ''}`);
});

client.on('mls_welcome_sync', ({ processed, accepted, groups }) => {
  console.log(`MLS welcome sync: processed=${processed} accepted=${accepted} groups=${groups.length}`);
});

client.on('mls_welcome_process_failed', ({ error }) => {
  console.warn(`MLS welcome processing failed: ${error}`);
});

client.on('mls_wrapper_decrypt_hit', ({ groupId, eventId, sender }) => {
  console.log(`MLS decrypt hit group=${groupId} sender=${sender} event=${eventId}`);
});

client.on('mls_wrapper_decrypt_miss', ({ groupId, eventId }) => {
  console.log(`MLS decrypt miss group=${groupId} event=${eventId}`);
});

client.on('mls_wrapper_decrypt_failed', ({ groupId, eventId, error }) => {
  console.warn(`MLS decrypt failed group=${groupId} event=${eventId}: ${error}`);
});

client.on('group_bootstrap_complete', ({ discovered, knownGroupIds }) => {
  console.log(`Group history bootstrap done. discovered=${discovered} total=${knownGroupIds.length}`);
});

client.on('group_bootstrap_debug', (info) => {
  console.log(
    `Group bootstrap debug: relays=${info.relays.length} giftwrap=${info.giftWrapEvents} wrappers=${info.groupWrapperEvents} sinceHours=${info.sinceHours} limit=${info.limit}`,
  );
});

client.on('message', async (senderPubkey, tags, message, self) => {
  if (self) return;
  if (tags.isGroup && !tags.botInGroup) return;
  if (tags.isGroup && !tags.directedToBot) return;

  const senderName = tags.displayName || senderPubkey;
  const target = tags.isGroup ? `group:${tags.groupId}` : senderPubkey;
  console.log(`${senderName} -> ${target}: ${message}`);

  // Reply only in the same origin where the command was received.
  const reply = async (content) => {
    if (tags.origin === 'group' && tags.groupId) {
      await client.sendGroupMessage(tags.groupId, content);
      return;
    }
    await client.sendMessage(senderPubkey, content);
  };

  if (message.startsWith('!ping')) {
    await reply('pong');
    return;
  }

  if (message.startsWith('!hello')) {
    await reply('Hello! Would you like a cuppa coffee?');
    return;
  }

  if (message.startsWith('!echo')) {
    const content = message.replace('!echo', '').trim() || 'echo';
    await reply(content);
    return;
  }

  if (message.startsWith('!upload')) {
    if (tags.isGroup) {
      await reply('File upload command currently supports DMs only.');
      return;
    }
    if (!process.env.UPLOAD_FILE_PATH) {
      await reply('Set UPLOAD_FILE_PATH to send a file.');
      return;
    }
    await client.sendFile(senderPubkey, process.env.UPLOAD_FILE_PATH);
  }
});

client.connect().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  client.close();
  process.exit(0);
});
