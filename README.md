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
```

## Building

The package is authored in TypeScript. Run `npm run build` to emit the `dist/` artifacts used by consumers.
