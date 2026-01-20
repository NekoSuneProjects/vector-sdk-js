import { promises as fs } from 'fs';
import mime from 'mime-types';
import { fileTypeFromBuffer } from 'file-type';
import { finalizeEvent } from 'nostr-tools/pure';
import * as kinds from 'nostr-tools/kinds';
import * as nip04 from 'nostr-tools/nip04';
import * as nip59 from 'nostr-tools/nip59';

import { buildClient, ClientConfig, VectorClient } from './client.js';
import { createMetadata } from './metadata.js';
import { calculateFileHash, encryptData, generateEncryptionParams } from './crypto.js';
import { getServerConfig, ProgressCallback, uploadDataWithProgress } from './upload.js';
import { normalizePublicKey } from './keys.js';

export interface ImageMetadata {
  blurhash: string;
  width: number;
  height: number;
}

export class AttachmentFile {
  constructor(
    public bytes: Buffer,
    public extension: string,
    public imgMeta?: ImageMetadata,
  ) {}

  public static async fromPath(path: string): Promise<AttachmentFile> {
    const bytes = await fs.readFile(path);
    return AttachmentFile.fromBytes(bytes);
  }

  public static async fromBytes(bytes: Buffer, extension?: string): Promise<AttachmentFile> {
    const resolvedExtension = extension ?? (await inferExtensionFromBytes(bytes));
    return new AttachmentFile(bytes, resolvedExtension);
  }
}

export async function loadFile(path: string): Promise<AttachmentFile> {
  return AttachmentFile.fromPath(path);
}

async function inferExtensionFromBytes(bytes: Buffer): Promise<string> {
  const fileType = await fileTypeFromBuffer(bytes);
  return fileType?.ext ?? 'bin';
}

export function createProgressCallback(): ProgressCallback {
  return (percentage: number | null) => {
    if (percentage !== null) {
      console.log(`Upload progress: ${percentage}%`);
    }
  };
}

function sanitizeUrl(candidate: string, fallback: string): string {
  try {
    return new URL(candidate).toString();
  } catch (error) {
    console.error('Invalid URL provided, falling back', error);
    return fallback;
  }
}

export class VectorBot {
  public readonly publicKey: string;
  public readonly privateKey: string;
  public readonly privateKeyBytes: Uint8Array;
  public readonly client: VectorClient;

  private constructor(
    privateKey: string,
    public name: string,
    public displayName: string,
    public about: string,
    public picture: string,
    public banner: string,
    public nip05: string,
    public lud16: string,
    client: VectorClient,
  ) {
    this.privateKey = privateKey;
    this.privateKeyBytes = client.privateKeyBytes;
    this.publicKey = client.publicKey;
    this.client = client;
  }

  public static async quick(privateKey: string): Promise<VectorBot> {
    return VectorBot.new(
      privateKey,
      'vector bot',
      'Vector Bot',
      'vector bot created with quick',
      'https://example.com/avatar.png',
      'https://example.com/banner.png',
      'example@example.com',
      'example@example.com',
    );
  }

  public static async new(
    privateKey: string,
    name: string,
    displayName: string,
    about: string,
    picture: string,
    banner: string,
    nip05: string,
    lud16: string,
    clientConfig?: ClientConfig,
  ): Promise<VectorBot> {
    const resolvedPicture = sanitizeUrl(picture, 'https://example.com/avatar.png');
    const resolvedBanner = sanitizeUrl(banner, 'https://example.com/banner.png');

    const client = buildClient(privateKey, clientConfig);
    const metadata = createMetadata(
      name,
      displayName,
      about,
      resolvedPicture,
      resolvedBanner,
      nip05,
      lud16,
    );

    try {
      await client.setMetadata(metadata);
    } catch (error) {
      console.error('Failed to set metadata', error);
    }

    return new VectorBot(
      client.privateKey,
      name,
      displayName,
      about,
      resolvedPicture,
      resolvedBanner,
      nip05,
      lud16,
      client,
    );
  }

  public getChat(recipient: string): Channel {
    return new Channel(recipient, this);
  }
}

export class Channel {
  public readonly recipient: string;
  public readonly baseBot: VectorBot;

  constructor(recipient: string, baseBot: VectorBot) {
    this.recipient = normalizePublicKey(recipient);
    this.baseBot = baseBot;
  }

  public async sendPrivateMessage(message: string): Promise<boolean> {
    const createdAt = Math.floor(Date.now() / 1000);
    const tags = [
      ['p', this.recipient],
      ['ms', (Date.now() % 1000).toString()],
    ];

    let sent = false;

    try {
      const payload = await nip04.encrypt(this.baseBot.privateKey, this.recipient, message);
      const event = finalizeEvent(
        {
          kind: kinds.EncryptedDirectMessage,
          created_at: createdAt,
          tags,
          content: payload,
        },
        this.baseBot.privateKeyBytes,
      );

      await this.baseBot.client.publishEvent(event);
      sent = true;
    } catch (error) {
      console.error('Failed to send NIP-04 private message', error);
    }

    try {
      const rumor = {
        kind: kinds.PrivateDirectMessage,
        created_at: createdAt,
        tags,
        content: message,
      };
      const wrapped = nip59.wrapEvent(rumor, this.baseBot.privateKeyBytes, this.recipient);
      await this.baseBot.client.publishEvent(wrapped);
      sent = true;
    } catch (error) {
      console.error('Failed to send NIP-59 gift-wrap', error);
    }

    return sent;
  }

  public async sendReaction(referenceId: string, emoji: string): Promise<boolean> {
    try {
      const event = finalizeEvent(
        {
          kind: kinds.Reaction,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['e', referenceId],
            ['p', this.recipient],
            ['ms', (Date.now() % 1000).toString()],
          ],
          content: emoji,
        },
        this.baseBot.privateKeyBytes,
      );

      await this.baseBot.client.publishEvent(event);
      return true;
    } catch (error) {
      console.error('Failed to send reaction', error);
      return false;
    }
  }

  public async sendTypingIndicator(): Promise<boolean> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const event = finalizeEvent(
        {
          kind: kinds.Application,
          created_at: now,
          tags: [
            ['p', this.recipient],
            ['ms', (Date.now() % 1000).toString()],
            ['expiration', (now + 3600).toString()],
          ],
          content: 'typing',
        },
        this.baseBot.privateKeyBytes,
      );

      await this.baseBot.client.publishEvent(event);
      return true;
    } catch (error) {
      console.error('Failed to send typing indicator', error);
      return false;
    }
  }

  public async sendPrivateFile(file?: AttachmentFile): Promise<boolean> {
    if (!file) {
      console.error('No file provided for sendPrivateFile');
      return false;
    }

    try {
      const rawMimeType = mime.lookup(file.extension);
      const mimeType = typeof rawMimeType === 'string' ? rawMimeType : 'application/octet-stream';
      const params = generateEncryptionParams();
      const encrypted = encryptData(file.bytes, params);
      const fileHash = calculateFileHash(file.bytes);
      const serverConfig = await getServerConfig();
      const progressCallback = createProgressCallback();
      const url = await uploadDataWithProgress(
        this.baseBot.privateKey,
        serverConfig,
        encrypted,
        mimeType,
        undefined,
        progressCallback,
      );

      const tags: string[][] = [
        ['p', this.recipient],
        ['file-type', mimeType],
        ['size', encrypted.length.toString()],
        ['encryption-algorithm', 'aes-gcm'],
        ['decryption-key', params.key],
        ['decryption-nonce', params.nonce],
        ['ox', fileHash],
        ['ms', (Date.now() % 1000).toString()],
      ];

      if (file.imgMeta) {
        tags.push(['blurhash', file.imgMeta.blurhash]);
        tags.push(['dim', `${file.imgMeta.width}x${file.imgMeta.height}`]);
      }

      const event = finalizeEvent(
        {
          kind: kinds.FileMessage,
          created_at: Math.floor(Date.now() / 1000),
          tags,
          content: url,
        },
        this.baseBot.privateKeyBytes,
      );

      await this.baseBot.client.publishEvent(event);
      return true;
    } catch (error) {
      console.error('Failed to send private file', error);
      return false;
    }
  }
}
