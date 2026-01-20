# Vector Bot SDK (Node.js)

A JavaScript/TypeScript port of the Vector Bot SDK that mirrors the structure of the original Rust crate while staying idiomatic for the Node.js ecosystem. It provides helpers for creating Vector bots, sending encrypted private messages and files, building metadata, subscribing to gift-wrap events, and uploading data through a NIP-96 server.

## Highlights

- `VectorBot` and `Channel` classes that wrap a Nostr client for message, reaction, typing, and file flows.
- Metadata builders, filters, and utilities ported from the Rust implementation.
- AES-256-GCM file encryption helpers and attachment helpers with extension inference.
- Upload helpers that target the trusted NIP-96 server used by Vector and emit progress callbacks.

## Getting Started

```bash
npm install @vector/vector-sdk
```

Then import the pieces you need:

```ts
import { VectorBot, AttachmentFile, createMetadata } from '@vector/vector-sdk';

// Initialize the bot with your Nostr private key
const privateKey = 'your_private_key_here';
const bot = new VectorBot(privateKey);

// Connect to Nostr
bot.connect().then(() => {
  console.log('Connected to Nostr!');

  // Subscribe to events in a specific channel
  const channel = bot.channel('example_channel');

  channel.on('event', (event) => {
    console.log('Received event:', event);
    // Respond to the received event
    channel.reply(event.id, 'Hello! This is a bot response.');
  });

  // Send a message to all subscribers
  setInterval(() => {
    const message = `This is an automated message at ${new Date()}`;
    channel.send(message);
  }, 60000); // Every minute

  // Handle file upload
  const attachmentFile = new AttachmentFile('path/to/file.txt', 'text/plain');
  channel.upload(attachmentFile).then((fileId) => {
    console.log('Uploaded file with ID:', fileId);
  }).catch(err => {
    console.error('Failed to upload file:', err);
  });

  // Build and send metadata
  const metadata = createMetadata({
    name: 'Example Bot',
    description: 'A bot demonstrating all features of the Vector Bot SDK',
    tags: ['bot', 'vector', 'nostr'],
  });
  channel.send(metadata).then(() => {
    console.log('Sent metadata successfully');
  }).catch(err => {
    console.error('Failed to send metadata:', err);
  });

}).catch(err => {
  console.error('Failed to connect to Nostr:', err);
});
```

## Building

The package is authored in TypeScript. Run `npm run build` to emit the `dist/` artifacts used by consumers.
