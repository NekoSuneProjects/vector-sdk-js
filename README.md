# Vector Bot SDK (Node.js)

A JavaScript/TypeScript port of the Vector Bot SDK that mirrors the structure of the original Rust crate while staying idiomatic for the Node.js ecosystem. It provides helpers for creating Vector bots, sending encrypted private messages and files, building metadata, subscribing to gift-wrap events, and uploading data through a NIP-96 server.

## Highlights

- `VectorBot` and `Channel` classes that wrap a Nostr client for message, reaction, typing, and file flows.
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

const client = new VectorBotClient({
  privateKey: process.env.NOSTR_PRIVATE_KEY,
  relays: (process.env.NOSTR_RELAYS ?? 'wss://jskitty.cat/nostr')
    .split(',')
    .map((relay) => relay.trim())
    .filter(Boolean),
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

client.on('message', async (channel, tags, message, self) => {
  if (self) return;

  console.log(`${channel}: ${message}`);

  if (message.startsWith('!ping')) {
    await client.sendMessage(channel, 'pong');
    return;
  }

  if (message.startsWith('!upload')) {
    if (!process.env.UPLOAD_FILE_PATH) {
      await client.sendMessage(channel, 'Set UPLOAD_FILE_PATH to send a file.');
      return;
    }
    await client.sendFile(channel, process.env.UPLOAD_FILE_PATH);
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

## Building

The package is authored in TypeScript. Run `npm run build` to emit the `dist/` artifacts used by consumers.
