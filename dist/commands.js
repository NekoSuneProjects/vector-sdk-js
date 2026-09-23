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
import { MAX_COMMANDS, typedArgs, validateManifest } from './bot-interface.js';
export class CommandRegistrationError extends Error {
}
/**
 * A builder for one command. Chain typed args, then attach the handler with
 * {@link run}.
 */
export class CommandBuilder {
    constructor(registry, name, description) {
        this.registry = registry;
        this.spec = { name, description, args: [] };
    }
    push(name, type, description, required, choices) {
        this.spec.args = this.spec.args ?? [];
        this.spec.args.push({ name, type, description, required, choices });
        return this;
    }
    /**
     * Free-text argument. In trailing position it swallows the rest of the line,
     * so `/say hello there` is one value.
     */
    string(name, description, required = false) {
        return this.push(name, 'string', description, required);
    }
    /** Integer argument. */
    int(name, description, required = false) {
        return this.push(name, 'int', description, required);
    }
    /** Float argument. */
    number(name, description, required = false) {
        return this.push(name, 'number', description, required);
    }
    /** Boolean argument (true/false/yes/no/1/0). */
    flag(name, description, required = false) {
        return this.push(name, 'bool', description, required);
    }
    /** An `npub1…` user argument. */
    user(name, description, required = false) {
        return this.push(name, 'user', description, required);
    }
    /** One-of-a-fixed-set argument. Clients render it as a picker. */
    choice(name, description, choices, required = false) {
        return this.push(name, 'choice', description, required, [...choices]);
    }
    /**
     * Register the handler. Throws on an invalid spec (bad name, duplicate,
     * arg-order violation): registration is developer code, so it fails loudly at
     * startup rather than silently dropping a command.
     */
    run(handler) {
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
export class CommandRegistry {
    constructor() {
        this.registrations = [];
    }
    insert(spec, handler) {
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
    isEmpty() {
        return this.registrations.length === 0;
    }
    get size() {
        return this.registrations.length;
    }
    /** The manifest derived from every registration, in registration order. */
    manifest() {
        return {
            v: 1,
            commands: this.registrations.map((registration) => registration.spec),
        };
    }
    find(name) {
        return this.registrations.find((registration) => registration.spec.name === name);
    }
}
/** Read a typed argument map back as plain accessors. */
export function argAccessors(args) {
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
