# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- File sends never reached Vector. Kind 15 attachments were published as plain
  signed events, but Vector only reads a kind 15 as a gift-wrapped rumor, so
  every file this SDK sent was invisible to it. Files now travel wrapped,
  exactly like text messages.
- Gift wraps ignored the recipient's inbox. Sends went to the bot's own relays
  only. They now resolve the recipient's NIP-17 kind 10050 relay list and
  deliver there, falling back to the bot's relays when a pubkey publishes none.
  The bot also publishes its own 10050 on connect, so other clients can route to
  it. Disable with `useInboxRelays: false`.
- Image metadata used the wrong hash. Vector moved from BlurHash to ThumbHash, so
  a `blurhash` tag is no longer part of the protocol. `ImageMetadata.blurhash` is
  now `ImageMetadata.thumbhash` (base91).

### Added

- Slash commands and the Bot Interface Manifest (kind 10304). Declare commands
  with typed arguments and the manifest publishes on connect, so every Vector
  client renders a `/` picker with a field per argument and validates input
  before it is sent. A matched invocation runs its handler and is consumed — it
  never reaches the `message` event. Argument types: `.string()`, `.int()`,
  `.number()`, `.flag()`, `.user()`, `.choice()`; read them off the context with
  `ctx.str/int/number/flag(name)`. The parser, validator and canonical error
  strings are ported from `vector_core::bot_interface` and verified against that
  crate's own test vectors (`npm test`).
- Commands answer publicly or privately. `ctx.reply()` answers where the command
  was invoked, `ctx.replyPrivately()` DMs the invoker even when the command came
  from a group, and `ctx.dm(user, text)` messages anyone, which pairs with a
  `.user()` argument.
- Bot addressing. `["bot", <hex>]` tags route an invocation to specific bots, so
  two bots can share a command name. Untagged is broadcast, so the tag is never
  required. Surfaced as `tags.addressedBots`.
- Message edits (kind 16) via `channel.edit(id, text)` and
  `client.editMessage(...)`. An edit is its own event referencing the original,
  matching Vector's event-sourced model.
- Message deletion (NIP-09) via `channel.delete(id)` and
  `client.deleteMessage(...)`.
- Threaded replies via `channel.reply(id, text)` and `client.replyTo(...)`,
  emitting the `["e", id, "", "reply"]` tag form Vector reads.
- NIP-40 self-destruct: pass `expiration` (Unix seconds) to any send. It is
  stamped on the rumor and mirrored onto the outer wrap, so relays purge the
  envelope on schedule rather than holding it.
- NIP-30 custom emoji: pass `emoji: [[shortcode, url], ...]` to a send, or
  `emojiUrl` to `react()` with a `:shortcode:`.
- Self-wrapping. Every outgoing message is also wrapped to the bot itself, so the
  account's other devices see what this one sent. Disable with `selfWrap: false`.
- Receiving attachments: `parseAttachment()`, plus `downloadAttachment()` and
  `saveAttachment()` on the bot and client, with `decryptData()` for AES-256-GCM
  payloads.
- New events: `attachment`, `message_update`, `reaction`, `message_delete`,
  `typing`, `command` and `manifest_published`. `ready` now reports the
  registered command count.
- Message ids. Sends return `{ id, sent }`, where the id is the rumor id that
  replies, edits, reactions and deletions reference. Incoming messages carry
  `tags.messageId` and `tags.replyTo`.
- Event kind constants (the `kinds` export), including the Concord v2 community
  block (3300-3311) for identification and filtering.

### Changed

- NIP-04 (kind 4) DMs are off by default, because Vector dropped NIP-04 entirely
  and ignores kind 4. Re-enable with `legacyNip04: true` to reach a client that
  still speaks it.
- The Concord v2 community protocol (kinds 3300-3311) is not implemented here.
  Its encrypted envelopes, epoch keys, consensus folding and rekeys live in
  `vector-core` and are not portable to this package at a sensible cost. The
  existing MLS sidecar path (kinds 443/444, via `mlsAdapter`) is unchanged and
  still works, and the v2 kind constants are exported so consumers can recognise
  the traffic.

### Deprecated

- `sendPrivateMessage`, `sendReaction`, `sendTypingIndicator` and
  `sendPrivateFile` still work and still return booleans, but are superseded by
  `send`, `react`, `typing` and `sendFile`, which return the message id.

[unreleased]: https://github.com/NekoSuneProjects/vector-sdk-js/compare/v1.0.5...HEAD
