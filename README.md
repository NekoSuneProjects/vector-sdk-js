# Vector Bot SDK (Node.js)

A JavaScript/TypeScript port of the Vector Bot SDK that mirrors the structure of the original Rust crate while staying idiomatic for the Node.js ecosystem. It provides helpers for creating Vector bots, sending encrypted private messages and files, building metadata, subscribing to gift-wrap events, and uploading data through a NIP-96 server.

## Highlights

- `VectorBot` and `Channel` classes that wrap a Nostr client for message, reaction, typing, and file flows.
- Partial relay failures no longer fail sends when at least one relay accepts the event.
- Group discovery support via `groupIds` + `autoDiscoverGroups`.
- Optional `vectorOnly` mode matching VectorApp relay filters (`kind:1059` + `kind:444`).
- Optional history bootstrap (`discoverGroupsFromHistory`) to discover already-active groups at startup.
- Group command safety: `tags.directedToBot` lets you ignore commands not addressed to the bot.
- Group command routing: plain `!command` in groups is accepted only when `tags.botInGroup` is true.
- MLS detection path: GiftWrap unwrapping checks for MLS welcome (`kind:443`) and emits `mls_welcome`.
- Vector private group decrypt/send requires `mlsAdapter` (bridge to MLS engine).
- Metadata builders, filters, and utilities ported from the Rust implementation.
- AES-256-GCM file encryption helpers and attachment helpers with extension inference.
- Upload helpers that target the trusted NIP-96 server used by Vector and emit progress callbacks.

## Getting Started

```bash
npm install @nekosuneprojects/vector-sdk
```

Then import the pieces you need:

```ts
import { VectorBotClient } from '@nekosuneprojects/vector-sdk';
import { createMlsSidecarAdapter } from '@nekosuneprojects/vector-sdk';

const mlsAdapter = process.env.MLS_SIDECAR_BIN
  ? createMlsSidecarAdapter({
      binPath: process.env.MLS_SIDECAR_BIN,
      stateDir: process.env.MLS_STATE_DIR ?? '.vector-mls-sidecar',
    })
  : undefined;

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

client.on('group_discovered', ({ groupId }) => {
  console.log(`Discovered group: ${groupId}`);
  console.log(`Known groups: ${client.getKnownGroupIds().join(', ')}`);
});

client.on('group_bootstrap_complete', ({ discovered, knownGroupIds }) => {
  console.log(`Group history bootstrap done. discovered=${discovered} total=${knownGroupIds.length}`);
});

client.on('group_wrapper', ({ groupId }) => {
  console.log(`Vector MLS wrapper seen for group ${groupId}`);
});

client.on('mls_welcome', () => {
  console.log('Vector MLS welcome received');
});

client.on('message', async (senderPubkey, tags, message, self) => {
  if (self) return;
  if (tags.isGroup && !tags.botInGroup) return;
  if (tags.isGroup && !tags.directedToBot) return;

  const reply = async (content: string) => {
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

  if (message.startsWith('!upload')) {
    if (!process.env.UPLOAD_FILE_PATH) {
      await client.sendMessage(senderPubkey, 'Set UPLOAD_FILE_PATH to send a file.');
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
```

For Vector private groups, set `MLS_SIDECAR_BIN` to the compiled Rust sidecar binary (`RUST/mls-sidecar`) so group wrappers can be decrypted and group replies can be sent.

## Building

The package is authored in TypeScript. Run `npm run build` to emit the `dist/` artifacts used by consumers.
