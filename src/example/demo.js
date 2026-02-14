import { VectorBotClient } from '../../dist/index.js';

const client = new VectorBotClient({
  privateKey: process.env.NOSTR_PRIVATE_KEY,
  relays: (process.env.NOSTR_RELAYS
    ?? 'wss://jskitty.cat/nostr,wss://asia.vectorapp.io/nostr,wss://nostr.computingcache.com,wss://relay.damus.io')
    .split(',')
    .map((relay) => relay.trim())
    .filter(Boolean),
  groupIds: (process.env.NOSTR_GROUP_IDS ?? '')
    .split(',')
    .map((groupId) => groupId.trim())
    .filter(Boolean),
  autoDiscoverGroups: true,
  discoverGroupsFromHistory: true,
  historySinceHours: Number(process.env.NOSTR_GROUP_HISTORY_HOURS ?? 24 * 14),
  historyMaxEvents: Number(process.env.NOSTR_GROUP_HISTORY_LIMIT ?? 1000),
  debug: process.env.DEBUG === '1',
  reconnect: true,
  reconnectIntervalMs: 15000,
  profile: {
    name: 'testnekobot',
    displayName: 'NekoSune TestBOT',
    about: 'Vector bot created with the SDK',
    picture: 'https://example.com/avatar.png',
    banner: 'https://example.com/banner.png',
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

client.on('group_bootstrap_complete', ({ discovered, knownGroupIds }) => {
  console.log(`Group history bootstrap done. discovered=${discovered} total=${knownGroupIds.length}`);
});

client.on('message', async (senderPubkey, tags, message, self) => {
  if (self) return;

  const senderName = tags.displayName || senderPubkey;
  const target = tags.isGroup ? `group:${tags.groupId}` : senderPubkey;
  console.log(`${senderName} -> ${target}: ${message}`);

  const reply = async (content) => {
    if (tags.isGroup && tags.groupId) {
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
