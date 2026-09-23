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
import { BOT_MANIFEST } from './kinds.js';
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
export declare const TAG_BOT = "bot";
/** Recipient tags honored per message. Routing metadata has to stay cheap. */
export declare const MAX_BOT_TAGS = 8;
/**
 * Bounds, validated on both build and parse. A foreign manifest is untrusted
 * input and must never cost unbounded memory or render work.
 */
export declare const MAX_COMMANDS = 64;
export declare const MAX_ARGS = 8;
export declare const MAX_CHOICES = 32;
export declare const MAX_NAME_LEN = 32;
export declare const MAX_DESCRIPTION_LEN = 200;
export declare const MAX_MANIFEST_BYTES = 32768;
/** A single argument value on the wire is clamped before typing. */
export declare const MAX_ARG_VALUE_LEN = 1024;
/**
 * Public relays that index replaceable events network-wide — the reliable
 * discovery path for bot manifests. Queried alongside a chat's own relays, so a
 * manifest resolves even when a community relay is unreachable or drops
 * stranger events.
 */
export declare const DISCOVERY_RELAYS: readonly string[];
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
export type ArgValue = {
    kind: 'string';
    value: string;
} | {
    kind: 'int';
    value: number;
} | {
    kind: 'number';
    value: number;
} | {
    kind: 'bool';
    value: boolean;
} | {
    kind: 'user';
    value: string;
} | {
    kind: 'choice';
    value: string;
};
export declare class ManifestError extends Error {
}
/**
 * Serialize a manifest to its canonical wire JSON: empty `args` and `choices`
 * are dropped, matching the Rust encoder so the same manifest produces the same
 * bytes in both implementations.
 */
export declare function serializeManifest(manifest: BotManifest): string;
/**
 * Fail-closed structural validation, applied to our own manifests before
 * publish and to fetched foreign ones before use. Returns an error message, or
 * `null` when the manifest is sound.
 */
export declare function validateManifest(manifest: BotManifest): string | null;
/** Look up a command by name. */
export declare function findCommand(manifest: BotManifest, name: string): CommandSpec | undefined;
/**
 * Parse and validate a manifest from an event's content. The event must be the
 * manifest kind and is otherwise treated as untrusted input.
 */
export declare function manifestFromEvent(event: Event): BotManifest;
/**
 * Build the signed replaceable manifest event. One manifest per bot identity,
 * keyed by `(kind, pubkey)` with no `d` tag.
 */
export declare function manifestToEvent(manifest: BotManifest, privateKeyBytes: Uint8Array): Event;
/** Build the recipient tag a picker attaches: `["bot", <hex>]`. */
export declare function botTag(botPublicKey: string): string[];
/**
 * Extract the addressed bots from a rumor's tags as npubs, deduped and capped.
 * An empty result means untagged, i.e. broadcast.
 */
export declare function addressedBots(tags: string[][]): string[];
/**
 * The canonical content for an invocation a picker client builds — exactly what
 * a human would have typed. Values containing spaces or quotes are quoted with
 * escapes, so the text re-parses to the same arguments.
 */
export declare function commandText(name: string, args: Array<[string, string]>): string;
/**
 * Parse `"/name arg arg…"` content against the manifest's arg order. Returns
 * `null` when the text isn't a known command — it is then ordinary chat.
 *
 * Multi-word values: a quoted value groups words in any position, and an
 * unquoted trailing `string` arg swallows the raw remainder of the line. So the
 * common forms (`/price btc`, `/say hello there`) need no syntax at all, and two
 * multi-word strings are still expressible.
 */
export declare function parseCommandText(manifest: BotManifest, content: string): ParsedCommand | null;
export declare class CommandArgError extends Error {
}
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
export declare function typedArgs(spec: CommandSpec, parsed: ParsedCommand): Map<string, ArgValue>;
/** `"/name <a:int> [b:text]"` — the one-line usage hint for error replies. */
export declare function usageLine(spec: CommandSpec): string;
