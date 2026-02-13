import { VectorBotClient } from '../../dist/index.js';

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

client.on('message', async (senderPubkey, tags, message, self) => {
  if (self) return;

  const senderName = tags.displayName || senderPubkey;
  console.log(`${senderName}: ${message}`);

  if (message.startsWith('!ping')) {
    await client.sendMessage(senderPubkey, 'pong');
    return;
  }

  if (message.startsWith('!hello')) {
    await client.sendMessage(senderPubkey, 'Hello! Would you like a cuppa coffee?');
    return;
  }

  if (message.startsWith('!echo')) {
    const content = message.replace('!echo', '').trim() || 'echo';
    await client.sendMessage(senderPubkey, content);
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
