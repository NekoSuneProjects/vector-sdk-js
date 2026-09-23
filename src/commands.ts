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

import type {
  ArgType,
  ArgValue,
  BotManifest,
  CommandSpec,
  ParsedCommand,
} from './bot-interface.js';
import { MAX_COMMANDS, typedArgs, validateManifest } from './bot-interface.js';

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

export type CommandHandler<TMessage = unknown> = (
  context: CommandContext<TMessage>,
) => void | Promise<void>;

export class CommandRegistrationError extends Error {}

interface Registration<TMessage> {
  spec: CommandSpec;
  handler: CommandHandler<TMessage>;
}

/**
 * A builder for one command. Chain typed args, then attach the handler with
 * {@link run}.
 */
export class CommandBuilder<TMessage = unknown> {
  private readonly spec: CommandSpec;

  constructor(
    private readonly registry: CommandRegistry<TMessage>,
    name: string,
    description: string,
  ) {
    this.spec = { name, description, args: [] };
  }

  private push(
    name: string,
    type: ArgType,
    description: string,
    required: boolean,
    choices?: string[],
  ): this {
    this.spec.args = this.spec.args ?? [];
    this.spec.args.push({ name, type, description, required, choices });
    return this;
  }

  /**
   * Free-text argument. In trailing position it swallows the rest of the line,
   * so `/say hello there` is one value.
   */
  public string(name: string, description: string, required = false): this {
    return this.push(name, 'string', description, required);
  }

  /** Integer argument. */
  public int(name: string, description: string, required = false): this {
    return this.push(name, 'int', description, required);
  }

  /** Float argument. */
  public number(name: string, description: string, required = false): this {
    return this.push(name, 'number', description, required);
  }

  /** Boolean argument (true/false/yes/no/1/0). */
  public flag(name: string, description: string, required = false): this {
    return this.push(name, 'bool', description, required);
  }

  /** An `npub1…` user argument. */
  public user(name: string, description: string, required = false): this {
    return this.push(name, 'user', description, required);
  }

  /** One-of-a-fixed-set argument. Clients render it as a picker. */
  public choice(
    name: string,
    description: string,
    choices: string[],
    required = false,
  ): this {
    return this.push(name, 'choice', description, required, [...choices]);
  }

  /**
   * Register the handler. Throws on an invalid spec (bad name, duplicate,
   * arg-order violation): registration is developer code, so it fails loudly at
   * startup rather than silently dropping a command.
   */
  public run(handler: CommandHandler<TMessage>): void {
    this.registry.insert(this.spec, handler);
  }
}

/**
 * The bot's command table.
 *
 * An array, not a map: the manifest publishes commands in registration order,
 * because the arrangement is the bot author's choice and clients render it
 * verbatim. Registration order is code order, so the published event stays
 * deterministic across restarts.
 */
export class CommandRegistry<TMessage = unknown> {
  private readonly registrations: Array<Registration<TMessage>> = [];

  public insert(spec: CommandSpec, handler: CommandHandler<TMessage>): void {
    const invalid = validateManifest({ v: 1, commands: [spec] });
    if (invalid) {
      throw new CommandRegistrationError(`invalid command registration: ${invalid}`);
    }
    if (this.registrations.length >= MAX_COMMANDS) {
      throw new CommandRegistrationError(`too many commands (max ${MAX_COMMANDS})`);
    }
    if (this.registrations.some((registration) => registration.spec.name === spec.name)) {
      throw new CommandRegistrationError(`command name already registered: ${spec.name}`);
    }
    this.registrations.push({ spec, handler });
  }

  public isEmpty(): boolean {
    return this.registrations.length === 0;
  }

  public get size(): number {
    return this.registrations.length;
  }

  /** The manifest derived from every registration, in registration order. */
  public manifest(): BotManifest {
    return {
      v: 1,
      commands: this.registrations.map((registration) => registration.spec),
    };
  }

  public find(name: string): Registration<TMessage> | undefined {
    return this.registrations.find((registration) => registration.spec.name === name);
  }
}

/** Read a typed argument map back as plain accessors. */
export function argAccessors(args: Map<string, ArgValue>): {
  str(name: string): string | undefined;
  int(name: string): number | undefined;
  number(name: string): number | undefined;
  flag(name: string): boolean | undefined;
} {
  return {
    str(name) {
      const value = args.get(name);
      if (!value) {
        return undefined;
      }
      if (value.kind === 'string' || value.kind === 'user' || value.kind === 'choice') {
        return value.value || undefined;
      }
      return undefined;
    },
    int(name) {
      const value = args.get(name);
      return value?.kind === 'int' ? value.value : undefined;
    },
    number(name) {
      const value = args.get(name);
      if (value?.kind === 'number') {
        return value.value;
      }
      // An int coerces to a float, matching the Rust accessor.
      return value?.kind === 'int' ? value.value : undefined;
    },
    flag(name) {
      const value = args.get(name);
      return value?.kind === 'bool' ? value.value : undefined;
    },
  };
}

/** Type a parsed invocation against its spec. Re-exported for convenience. */
export { typedArgs };
export type { ParsedCommand };
