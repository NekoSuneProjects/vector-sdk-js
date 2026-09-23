/**
 * The registry behind {@link VectorBotClient.command}.
 *
 * Commands are declared with typed arguments; the client derives the Bot
 * Interface Manifest from the registrations and publishes it when it connects,
 * so every Vector client renders a `/` picker with a field per argument and
 * validates input before it hits the wire. A matched invocation runs its
 * handler and is *consumed* — it never reaches the `message` event, mirroring
 * how interaction frameworks separate commands from chat.
 */
import type { ArgValue, BotManifest, CommandSpec, ParsedCommand } from './bot-interface.js';
import { typedArgs } from './bot-interface.js';
/** Everything a command handler needs: the typed arguments and where it came from. */
export interface CommandContext<TMessage = unknown> {
    /** The command name, without its leading slash. */
    name: string;
    /** The message that invoked it. */
    message: TMessage;
    /** The invoking pubkey, hex. */
    senderPubkey: string;
    /** True when the command was invoked in a group rather than a DM. */
    isGroup: boolean;
    /** The group the command came from, when it came from one. */
    groupId?: string;
    /** Raw argument values in manifest order, before typing. */
    raw: Array<[string, string]>;
    /** A string-ish arg (string / user / choice) by name, if provided. */
    str(name: string): string | undefined;
    /** An integer arg by name, if provided. */
    int(name: string): number | undefined;
    /** A float arg by name (an int coerces), if provided. */
    number(name: string): number | undefined;
    /** A boolean arg by name, if provided. */
    flag(name: string): boolean | undefined;
    /**
     * Answer where the command was invoked: in the group when it came from a
     * group, in the DM when it came from a DM.
     */
    reply(text: string): Promise<boolean>;
    /**
     * Answer the invoker privately, even when the command was invoked in a group.
     *
     * The group sees nothing. This is the place for anything the rest of the room
     * shouldn't read — a personal balance, a long result, an error that would
     * just be noise in the channel.
     */
    replyPrivately(text: string): Promise<boolean>;
    /**
     * DM any user, by npub or hex pubkey.
     *
     * Pairs with a `.user(...)` argument: a command invoked in a group can act on
     * someone the invoker named and deliver the result straight to them.
     */
    dm(user: string, text: string): Promise<boolean>;
}
export type CommandHandler<TMessage = unknown> = (context: CommandContext<TMessage>) => void | Promise<void>;
export declare class CommandRegistrationError extends Error {
}
interface Registration<TMessage> {
    spec: CommandSpec;
    handler: CommandHandler<TMessage>;
}
/**
 * A builder for one command. Chain typed args, then attach the handler with
 * {@link run}.
 */
export declare class CommandBuilder<TMessage = unknown> {
    private readonly registry;
    private readonly spec;
    constructor(registry: CommandRegistry<TMessage>, name: string, description: string);
    private push;
    /**
     * Free-text argument. In trailing position it swallows the rest of the line,
     * so `/say hello there` is one value.
     */
    string(name: string, description: string, required?: boolean): this;
    /** Integer argument. */
    int(name: string, description: string, required?: boolean): this;
    /** Float argument. */
    number(name: string, description: string, required?: boolean): this;
    /** Boolean argument (true/false/yes/no/1/0). */
    flag(name: string, description: string, required?: boolean): this;
    /** An `npub1…` user argument. */
    user(name: string, description: string, required?: boolean): this;
    /** One-of-a-fixed-set argument. Clients render it as a picker. */
    choice(name: string, description: string, choices: string[], required?: boolean): this;
    /**
     * Register the handler. Throws on an invalid spec (bad name, duplicate,
     * arg-order violation): registration is developer code, so it fails loudly at
     * startup rather than silently dropping a command.
     */
    run(handler: CommandHandler<TMessage>): void;
}
/**
 * The bot's command table.
 *
 * An array, not a map: the manifest publishes commands in registration order,
 * because the arrangement is the bot author's choice and clients render it
 * verbatim. Registration order is code order, so the published event stays
 * deterministic across restarts.
 */
export declare class CommandRegistry<TMessage = unknown> {
    private readonly registrations;
    insert(spec: CommandSpec, handler: CommandHandler<TMessage>): void;
    isEmpty(): boolean;
    get size(): number;
    /** The manifest derived from every registration, in registration order. */
    manifest(): BotManifest;
    find(name: string): Registration<TMessage> | undefined;
}
/** Read a typed argument map back as plain accessors. */
export declare function argAccessors(args: Map<string, ArgValue>): {
    str(name: string): string | undefined;
    int(name: string): number | undefined;
    number(name: string): number | undefined;
    flag(name: string): boolean | undefined;
};
/** Type a parsed invocation against its spec. Re-exported for convenience. */
export { typedArgs };
export type { ParsedCommand };
