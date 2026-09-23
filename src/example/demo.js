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

// ── Slash commands ──────────────────────────────────────────────────────────
// Registered before connect(), so the manifest publishes on startup and Vector
// clients render a `/` picker with a field per argument. A matched command is
// consumed and never reaches the 'message' handler below.

client.command('ping', 'Check the bot is alive').run(async (ctx) => {
  await ctx.reply('pong');
});

client.command('echo', 'Repeat something back')
  .string('text', 'What to repeat', true)
  .run(async (ctx) => {
    await ctx.reply(ctx.str('text') ?? '');
  });

client.command('roll', 'Roll a die')
  .int('sides', 'How many sides')
  .run(async (ctx) => {
    const sides = ctx.int('sides') ?? 6;
    await ctx.reply(`🎲 you rolled ${1 + Math.floor(Math.random() * sides)} on a d${sides}`);
  });

// Answers the invoker privately even when invoked in a group — the channel
// sees only the acknowledgement.
client.command('whoami', 'Send your details privately').run(async (ctx) => {
  await ctx.replyPrivately(`You are ${ctx.senderPubkey}`);
  if (ctx.isGroup) {
    await ctx.reply('Sent you a DM.');
  }
});

// Messages a user the invoker named, wherever the command was invoked from.
client.command('tell', 'Send someone a private note')
  .user('who', 'Who to message', true)
  .string('note', 'What to say', true)
  .run(async (ctx) => {
    const who = ctx.str('who');
    await ctx.dm(who, `${ctx.senderPubkey} says: ${ctx.str('note')}`);
    await ctx.reply(`Delivered to ${who}`);
  });

client.command('upload', 'Send the configured file').run(async (ctx) => {
  if (!process.env.UPLOAD_FILE_PATH) {
    await ctx.replyPrivately('Set UPLOAD_FILE_PATH to send a file.');
    return;
  }
  // Files go over DM; a group invocation still delivers to the invoker.
  await client.sendFile(ctx.senderPubkey, process.env.UPLOAD_FILE_PATH);
});

client.on('ready', ({ pubkey, profile, commands }) => {
  const name = profile?.displayName || profile?.name || 'unknown';
  console.log(`Logged in as ${name} (${pubkey}) with ${commands} command(s)`);
});

client.on('manifest_published', ({ commands, relays }) => {
  console.log(`Interface manifest (${commands} command(s)) stored on ${relays.length} relay(s)`);
});

client.on('command', ({ name, senderPubkey }) => {
  console.log(`/${name} invoked by ${senderPubkey}`);
});

client.on('attachment', async ({ sender, attachment }) => {
  console.log(`Attachment from ${sender}: ${attachment.filename ?? attachment.url}`);
});

client.on('reaction', ({ sender, messageId, emoji }) => {
  console.log(`${sender} reacted ${emoji} to ${messageId}`);
});

client.on('message_update', ({ messageId, content }) => {
  console.log(`Message ${messageId} edited to: ${content}`);
});

client.on('message_delete', ({ messageId }) => {
  console.log(`Message ${messageId} deleted`);
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

// The `!command` handlers above are the legacy form, kept working for older
// clients. New commands belong in the slash-command block near the top: those
// get a picker, typed arguments and validation before anything is sent.

client.connect().catch((error) => {
  console.error('Bot failed to start:', error);
  process.exit(1);
});

process.on('SIGINT', () => {
  client.close();
  process.exit(0);
});
