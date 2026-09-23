import { spawn } from 'child_process';
import type { Event } from 'nostr-tools';
import type { MlsAdapter } from './demo.js';

type SidecarResponse<T> = {
  ok: boolean;
  result?: T;
  error?: string;
};

export type SidecarAdapterOptions = {
  binPath: string;
  stateDir: string;
};

type SidecarContext = {
  botPublicKey: string;
  botPrivateKey?: string;
  relays: string[];
};

async function runSidecar<T>(
  binPath: string,
  command: string,
  payload: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const child = spawn(binPath, [command], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Sidecar exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as SidecarResponse<T>;
        if (!parsed.ok) {
          reject(new Error(parsed.error || 'Sidecar error'));
          return;
        }
        resolve(parsed.result as T);
      } catch (error) {
        reject(new Error(`Invalid sidecar response: ${stdout || stderr || String(error)}`));
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export function createMlsSidecarAdapter(options: SidecarAdapterOptions): MlsAdapter {
  const { binPath, stateDir } = options;

  const base = (context: SidecarContext) => {
    const payload: Record<string, unknown> = {
      relays: context.relays,
      state_dir: stateDir,
    };
    if (context.botPrivateKey) {
      payload.private_key = context.botPrivateKey;
    }
    return payload;
  };

  return {
    async ensureKeyPackage(context) {
      const result = await runSidecar<{ published: boolean; event_id?: string }>(
        binPath,
        'ensure-keypackage',
        {
          ...base({
            botPrivateKey: context.botPrivateKey,
            botPublicKey: context.botPublicKey,
            relays: context.relays,
          }),
        },
      );
      return {
        published: !!result.published,
        eventId: result.event_id,
      };
    },

    async syncWelcomes(context) {
      const result = await runSidecar<{ processed: number; accepted?: number; groups: string[] }>(
        binPath,
        'sync-welcomes',
        {
          ...base({
            botPrivateKey: context.botPrivateKey,
            botPublicKey: context.botPublicKey,
            relays: context.relays,
          }),
          since_hours: context.sinceHours ?? 24 * 30,
          limit: context.limit ?? 1000,
        },
      );
      return {
        processed: result.processed ?? 0,
        accepted: result.accepted ?? 0,
        groups: result.groups ?? [],
      };
    },

    async processWelcome(input) {
      const result = await runSidecar<{ group_id?: string }>(
        binPath,
        'process-welcome',
        {
          ...base({
            botPrivateKey: input.context.botPrivateKey,
            botPublicKey: input.context.botPublicKey,
            relays: input.context.relays,
          }),
          wrapper_event: input.wrapperEvent,
          rumor_json: input.rumorJson,
          group_id_hint: input.groupIdHint,
        },
      );
      return { groupId: result.group_id };
    },

    async decryptGroupWrapper(wrapper: Event) {
      const result = await runSidecar<{
        group_id: string;
        sender_pubkey: string;
        content: string;
        kind: number;
      } | null>(
        binPath,
        'decrypt-wrapper',
        {
          state_dir: stateDir,
          wrapper_event: wrapper,
        },
      );
      if (!result) {
        return null;
      }

      return {
        groupId: result.group_id,
        senderPubkey: result.sender_pubkey,
        content: result.content,
        kind: result.kind,
      };
    },

    async sendGroupMessage(groupId, message, context) {
      const result = await runSidecar<{ sent: boolean }>(
        binPath,
        'send-group',
        {
          ...base({
            botPrivateKey: context.botPrivateKey,
            botPublicKey: context.botPublicKey,
            relays: context.relays,
          }),
          group_id: groupId,
          content: message,
        },
      );
      return !!result.sent;
    },

    async bootstrapGroups(context) {
      const result = await runSidecar<{ groups: string[] }>(
        binPath,
        'list-groups',
        {
          ...base({
            botPrivateKey: undefined,
            botPublicKey: context.botPublicKey,
            relays: context.relays,
          }),
        },
      );
      return result.groups ?? [];
    },
  };
}
