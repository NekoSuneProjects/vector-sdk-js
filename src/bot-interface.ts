/**
 * Bot Interface — manifests and slash commands.
 *
 * A port of `vector_core::bot_interface`. Everything here is content-level, so
 * the same commands work in NIP-17 DMs and community channels alike; the
 * envelope is whatever the conversation already uses.
 *
 * Two pieces:
 *
 * 1. **Manifest** ({@link BotManifest}, kind {@link BOT_MANIFEST}): a replaceable
 *    event signed by the bot's key describing every command with typed args.
 *    Clients fetch it by pubkey to render a `/` picker with argument hints and
 *    validate input before anything hits the wire.
 * 2. **Invocation** ({@link parseCommandText}): a command is a normal chat
 *    message whose content *is* the invocation (`/price btc`). Nothing extra on
 *    the wire, so every existing client is already a capable command sender.
 */

import type { Event } from 'nostr-tools';
import { nip19 } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';

import { BOT_MANIFEST } from './kinds.js';
import { normalizePublicKey } from './keys.js';

export { BOT_MANIFEST };

/**
 * Optional recipient tag a picker client attaches to an invocation:
 * `["bot", <bot pubkey hex>]`.
 *
 * Addressing is the one piece of a command not derivable from content — two
 * bots can share a command name — so it rides a tag while the invocation stays
 * plain text. Tagged means only the named bots execute; untagged means
 * broadcast, so bots never *require* the tag.
 *
 * Deliberately not `p`: chat rumors already carry `p` for DM recipients and
 * reply parents, and a skip-unless-me rule keyed on `p` would silently swallow
 * a command sent as a reply to a human. The tag is routing, not authority —
 * bots authorize by sender, never by tag.
 */
export const TAG_BOT = 'bot';

/** Recipient tags honored per message. Routing metadata has to stay cheap. */
export const MAX_BOT_TAGS = 8;

/**
 * Bounds, validated on both build and parse. A foreign manifest is untrusted
 * input and must never cost unbounded memory or render work.
 */
export const MAX_COMMANDS = 64;
export const MAX_ARGS = 8;
export const MAX_CHOICES = 32;
export const MAX_NAME_LEN = 32;
export const MAX_DESCRIPTION_LEN = 200;
export const MAX_MANIFEST_BYTES = 32_768;
/** A single argument value on the wire is clamped before typing. */
export const MAX_ARG_VALUE_LEN = 1_024;

/**
 * Public relays that index replaceable events network-wide — the reliable
 * discovery path for bot manifests. Queried alongside a chat's own relays, so a
 * manifest resolves even when a community relay is unreachable or drops
 * stranger events.
 */
export const DISCOVERY_RELAYS: readonly string[] = [
  'wss://purplepag.es',
  'wss://relay.nostr.band',
  'wss://nos.lol',
];

/** The typed shape of one command argument. */
export type ArgType = 'string' | 'int' | 'number' | 'bool' | 'user' | 'choice';

/** One declared argument of a command. */
export interface ArgSpec {
  name: string;
  type: ArgType;
  description?: string;
  required?: boolean;
  /** Populated only for `choice` args. */
  choices?: string[];
}

/** One command a bot answers. */
export interface CommandSpec {
  name: string;
  description: string;
  args?: ArgSpec[];
}

/** The bot's full published interface. `v` gates breaking schema changes. */
export interface BotManifest {
  v: number;
  commands?: CommandSpec[];
}

/** A command invocation recovered from a message's content. */
export interface ParsedCommand {
  name: string;
  /** Named argument values in manifest order, still raw strings. */
  args: Array<[string, string]>;
}

/** One argument value, typed per its spec. */
export type ArgValue =
  | { kind: 'string'; value: string }
  | { kind: 'int'; value: number }
  | { kind: 'number'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'user'; value: string }
  | { kind: 'choice'; value: string };

export class ManifestError extends Error {}

/**
 * Command and arg names are lowercase slugs, so every client renders and
 * matches them identically. That uniformity is the cross-client contract.
 */
function validName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_NAME_LEN && /^[a-z0-9_-]+$/.test(value);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Serialize a manifest to its canonical wire JSON: empty `args` and `choices`
 * are dropped, matching the Rust encoder so the same manifest produces the same
 * bytes in both implementations.
 */
export function serializeManifest(manifest: BotManifest): string {
  const commands = (manifest.commands ?? []).map((command) => {
    const args = (command.args ?? []).map((arg) => {
      const encoded: Record<string, unknown> = {
        name: arg.name,
        type: arg.type,
        description: arg.description ?? '',
        required: arg.required ?? false,
      };
      if (arg.choices?.length) {
        encoded.choices = arg.choices;
      }
      return encoded;
    });

    const encoded: Record<string, unknown> = {
      name: command.name,
      description: command.description,
    };
    if (args.length) {
      encoded.args = args;
    }
    return encoded;
  });

  const encoded: Record<string, unknown> = { v: manifest.v };
  if (commands.length) {
    encoded.commands = commands;
  }
  return JSON.stringify(encoded);
}

/**
 * Fail-closed structural validation, applied to our own manifests before
 * publish and to fetched foreign ones before use. Returns an error message, or
 * `null` when the manifest is sound.
 */
export function validateManifest(manifest: BotManifest): string | null {
  if (manifest.v !== 1) {
    return `unsupported manifest version ${manifest.v}`;
  }

  const commands = manifest.commands ?? [];
  if (commands.length > MAX_COMMANDS) {
    return `too many commands (${commands.length} > ${MAX_COMMANDS})`;
  }

  const seen = new Set<string>();
  for (const command of commands) {
    if (!validName(command.name)) {
      return `bad command name ${JSON.stringify(command.name)}`;
    }
    if (seen.has(command.name)) {
      return `duplicate command ${JSON.stringify(command.name)}`;
    }
    seen.add(command.name);
    if ((command.description ?? '').length > MAX_DESCRIPTION_LEN) {
      return `description too long on /${command.name}`;
    }

    const args = command.args ?? [];
    if (args.length > MAX_ARGS) {
      return `too many args on /${command.name}`;
    }

    const argSeen = new Set<string>();
    let optionalSeen = false;
    for (const arg of args) {
      if (!validName(arg.name)) {
        return `bad arg name ${JSON.stringify(arg.name)} on /${command.name}`;
      }
      if (argSeen.has(arg.name)) {
        return `duplicate arg ${JSON.stringify(arg.name)} on /${command.name}`;
      }
      argSeen.add(arg.name);
      if ((arg.description ?? '').length > MAX_DESCRIPTION_LEN) {
        return `arg description too long on /${command.name}`;
      }
      // The positional text fallback needs required args first — an optional
      // hole would make "/cmd a b" ambiguous.
      if (arg.required && optionalSeen) {
        return `required arg ${JSON.stringify(arg.name)} after an optional one on /${command.name}`;
      }
      optionalSeen = optionalSeen || !arg.required;

      const choices = arg.choices ?? [];
      if (arg.type === 'choice') {
        if (!choices.length || choices.length > MAX_CHOICES) {
          return `choice arg ${JSON.stringify(arg.name)} needs 1..=${MAX_CHOICES} choices`;
        }
        if (choices.some((choice) => !choice || choice.length > MAX_NAME_LEN)) {
          return `bad choice value on ${JSON.stringify(arg.name)}`;
        }
      } else if (choices.length) {
        return `choices on non-choice arg ${JSON.stringify(arg.name)}`;
      }
    }
  }

  const bytes = byteLength(serializeManifest(manifest));
  if (bytes > MAX_MANIFEST_BYTES) {
    return `manifest too large (${bytes} > ${MAX_MANIFEST_BYTES} bytes)`;
  }

  return null;
}

/** Look up a command by name. */
export function findCommand(manifest: BotManifest, name: string): CommandSpec | undefined {
  return (manifest.commands ?? []).find((command) => command.name === name);
}

/**
 * Parse and validate a manifest from an event's content. The event must be the
 * manifest kind and is otherwise treated as untrusted input.
 */
export function manifestFromEvent(event: Event): BotManifest {
  if (event.kind !== BOT_MANIFEST) {
    throw new ManifestError(`not a bot manifest (kind ${event.kind})`);
  }
  if (byteLength(event.content) > MAX_MANIFEST_BYTES) {
    throw new ManifestError('manifest content over the size cap');
  }

  let parsed: BotManifest;
  try {
    parsed = JSON.parse(event.content) as BotManifest;
  } catch (error) {
    throw new ManifestError(`manifest parse: ${String(error)}`);
  }

  const invalid = validateManifest(parsed);
  if (invalid) {
    throw new ManifestError(invalid);
  }
  return parsed;
}

/**
 * Build the signed replaceable manifest event. One manifest per bot identity,
 * keyed by `(kind, pubkey)` with no `d` tag.
 */
export function manifestToEvent(manifest: BotManifest, privateKeyBytes: Uint8Array): Event {
  const invalid = validateManifest(manifest);
  if (invalid) {
    throw new ManifestError(invalid);
  }
  return finalizeEvent(
    {
      kind: BOT_MANIFEST,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: serializeManifest(manifest),
    },
    privateKeyBytes,
  );
}

/** Build the recipient tag a picker attaches: `["bot", <hex>]`. */
export function botTag(botPublicKey: string): string[] {
  return [TAG_BOT, normalizePublicKey(botPublicKey)];
}

/**
 * Extract the addressed bots from a rumor's tags as npubs, deduped and capped.
 * An empty result means untagged, i.e. broadcast.
 */
export function addressedBots(tags: string[][]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    if (tag[0] !== TAG_BOT || typeof tag[1] !== 'string') {
      continue;
    }
    let npub: string;
    try {
      npub = nip19.npubEncode(normalizePublicKey(tag[1]));
    } catch {
      continue;
    }
    if (!out.includes(npub)) {
      out.push(npub);
    }
    if (out.length >= MAX_BOT_TAGS) {
      break;
    }
  }
  return out;
}

/**
 * The canonical content for an invocation a picker client builds — exactly what
 * a human would have typed. Values containing spaces or quotes are quoted with
 * escapes, so the text re-parses to the same arguments.
 */
export function commandText(name: string, args: Array<[string, string]>): string {
  let out = `/${name}`;
  for (const [, value] of args) {
    out += ' ';
    if (!value || /\s/.test(value) || value.includes('"')) {
      out += `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    } else {
      out += value;
    }
  }
  return out;
}

/**
 * One shell-style token: a bare word, or a quoted span that may contain spaces
 * (a backslash escapes a literal quote or backslash). Returns the value and the
 * offset just past the token, or `null` at end of input / on an unterminated
 * quote.
 */
function nextToken(input: string, start: number): { value: string; next: number } | null {
  let i = start;
  while (i < input.length && /\s/.test(input[i])) {
    i += 1;
  }
  if (i >= input.length) {
    return null;
  }

  if (input[i] === '"') {
    i += 1;
    let out = '';
    while (i < input.length) {
      const char = input[i];
      if (char === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) {
        out += input[i + 1];
        i += 2;
        continue;
      }
      if (char === '"') {
        return { value: out, next: i + 1 };
      }
      out += char;
      i += 1;
    }
    return null; // unterminated quote — malformed, not a command
  }

  const tokenStart = i;
  while (i < input.length && !/\s/.test(input[i])) {
    i += 1;
  }
  return { value: input.slice(tokenStart, i), next: i };
}

/**
 * Parse `"/name arg arg…"` content against the manifest's arg order. Returns
 * `null` when the text isn't a known command — it is then ordinary chat.
 *
 * Multi-word values: a quoted value groups words in any position, and an
 * unquoted trailing `string` arg swallows the raw remainder of the line. So the
 * common forms (`/price btc`, `/say hello there`) need no syntax at all, and two
 * multi-word strings are still expressible.
 */
export function parseCommandText(manifest: BotManifest, content: string): ParsedCommand | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }
  const rest = trimmed.slice(1);
  // The grammar is `"/" name`: a quoted first token is ordinary chat, not a
  // command word. Test the raw input — `nextToken` strips the quotes, so
  // inspecting the token can never see one.
  if (rest.startsWith('"')) {
    return null;
  }

  const first = nextToken(rest, 0);
  if (!first || !first.value) {
    return null;
  }
  let cursor = first.next;

  // Manifest names are lowercase slugs, so fold the invocation's command word:
  // `/Help` and `/HELP` resolve like `/help`. Argument values keep their case.
  const name = first.value.toLowerCase();
  const spec = findCommand(manifest, name);
  if (!spec) {
    return null;
  }

  const args: Array<[string, string]> = [];
  const declared = spec.args ?? [];
  for (let i = 0; i < declared.length; i += 1) {
    const arg = declared[i];
    const remainder = rest.slice(cursor).replace(/^\s+/, '');
    if (!remainder) {
      break;
    }

    const isLastDeclared = i + 1 === declared.length;
    let value: string;
    if (isLastDeclared && arg.type === 'string' && !remainder.startsWith('"')) {
      // Greedy tail: take the raw remainder verbatim, spacing preserved.
      cursor = rest.length;
      value = remainder.replace(/\s+$/, '');
    } else {
      const token = nextToken(rest, cursor);
      if (!token) {
        return null;
      }
      cursor = token.next;
      value = token.value;
    }

    if (value.length > MAX_ARG_VALUE_LEN) {
      return null;
    }
    // An explicitly empty token is the positional format's hole marker: it skips
    // an optional arg so a later one is still reachable (no category, page 2).
    // A required arg keeps the empty value — an empty string can be a deliberate
    // answer, and typing judges it, not the tokenizer.
    if (!value && !arg.required) {
      continue;
    }
    args.push([arg.name, value]);
  }

  return { name, args };
}

export class CommandArgError extends Error {}

/**
 * Type-check a parsed invocation against the manifest: every provided value
 * parses as its declared type, choices are members, required args are present.
 * Unknown arg names are dropped — a newer client may know newer args, and the
 * bot's manifest is authoritative for what it consumes.
 *
 * Errors are canonical and machine-parsable, always `{arg}: {reason}`, so any
 * implementation in any language emits byte-identical text and a client can
 * split on the first `": "`. Reasons: `not an integer`, `not a number`,
 * `not a boolean`, `not an npub`, `not one of a, b, c`, `required`.
 */
export function typedArgs(spec: CommandSpec, parsed: ParsedCommand): Map<string, ArgValue> {
  const out = new Map<string, ArgValue>();
  const declared = spec.args ?? [];

  for (const [key, raw] of parsed.args) {
    const arg = declared.find((candidate) => candidate.name === key);
    if (!arg) {
      continue;
    }

    switch (arg.type) {
      case 'string':
        out.set(key, { kind: 'string', value: raw });
        break;
      case 'int': {
        if (!/^[+-]?\d+$/.test(raw.trim())) {
          throw new CommandArgError(`${key}: not an integer`);
        }
        const value = Number(raw.trim());
        if (!Number.isSafeInteger(value)) {
          throw new CommandArgError(`${key}: not an integer`);
        }
        out.set(key, { kind: 'int', value });
        break;
      }
      case 'number': {
        const value = Number(raw.trim());
        if (raw.trim() === '' || !Number.isFinite(value)) {
          throw new CommandArgError(`${key}: not a number`);
        }
        out.set(key, { kind: 'number', value });
        break;
      }
      case 'bool': {
        const lowered = raw.toLowerCase();
        if (lowered === 'true' || lowered === 'yes' || lowered === '1') {
          out.set(key, { kind: 'bool', value: true });
        } else if (lowered === 'false' || lowered === 'no' || lowered === '0') {
          out.set(key, { kind: 'bool', value: false });
        } else {
          throw new CommandArgError(`${key}: not a boolean`);
        }
        break;
      }
      case 'user': {
        // The canonical wire form is the bare npub, but clients commonly insert
        // a mention as the NIP-21 `nostr:npub1…` URI — accept it and normalize
        // back. Decoding also rejects a bad bech32 checksum.
        const candidate = raw.startsWith('nostr:') ? raw.slice('nostr:'.length) : raw;
        if (!candidate.startsWith('npub1')) {
          throw new CommandArgError(`${key}: not an npub`);
        }
        let npub: string;
        try {
          npub = nip19.npubEncode(normalizePublicKey(candidate));
        } catch {
          throw new CommandArgError(`${key}: not an npub`);
        }
        out.set(key, { kind: 'user', value: npub });
        break;
      }
      case 'choice': {
        const choices = arg.choices ?? [];
        if (!choices.includes(raw)) {
          throw new CommandArgError(`${key}: not one of ${choices.join(', ')}`);
        }
        out.set(key, { kind: 'choice', value: raw });
        break;
      }
      default:
        throw new CommandArgError(`${key}: unsupported argument type`);
    }
  }

  for (const arg of declared) {
    if (arg.required && !out.has(arg.name)) {
      throw new CommandArgError(`${arg.name}: required`);
    }
  }

  return out;
}

/** `"/name <a:int> [b:text]"` — the one-line usage hint for error replies. */
export function usageLine(spec: CommandSpec): string {
  const types: Record<ArgType, string> = {
    string: 'text',
    int: 'int',
    number: 'number',
    bool: 'true|false',
    user: 'npub',
    choice: 'choice',
  };

  let out = `/${spec.name}`;
  for (const arg of spec.args ?? []) {
    const rendered = `${arg.name}:${types[arg.type]}`;
    out += arg.required ? ` <${rendered}>` : ` [${rendered}]`;
  }
  return out;
}
