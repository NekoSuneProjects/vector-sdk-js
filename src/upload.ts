import fetch from 'node-fetch';
import FormData from 'form-data';
import { sha256 } from '@noble/hashes/sha256';
import * as secp from '@noble/secp256k1';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from 'nostr-tools/pure';
import { normalizePrivateKey } from './keys.js';

const TRUSTED_PRIVATE_NIP96 = 'https://medea-1-swiss.vectorapp.io';

export interface ServerConfig {
  api_url: string;
}

export class UploadConfig {
  constructor(
    public connectTimeout = 5000,
    public stallThreshold = 200,
    public poolMaxIdle = 2,
  ) {}
}

export class UploadParams {
  constructor(
    public retryCount = 3,
    public retrySpacing = 2000,
    public chunkSize = 64 * 1024,
  ) {}
}

export type ProgressCallback = (percentage: number | null, bytes?: number) => void;

export class UploadError extends Error {}

let cachedConfig: ServerConfig | null = null;

export async function getServerConfig(): Promise<ServerConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const response = await fetch(TRUSTED_PRIVATE_NIP96);
  if (!response.ok) {
    throw new UploadError('Failed to fetch NIP-96 server configuration');
  }

  const payload = (await response.json()) as { api_url?: string };
  if (!payload.api_url) {
    throw new UploadError('Malformed server configuration');
  }

  cachedConfig = { api_url: payload.api_url };
  return cachedConfig;
}

async function buildNip98Authorization(
  privateKey: string,
  method: string,
  url: string,
  payload: Buffer,
): Promise<string> {
  const normalized = normalizePrivateKey(privateKey);
  const dataHash = bytesToHex(sha256(payload));
  const message = `${method.toUpperCase()}\n${url}\n${dataHash}`;
  const messageHash = bytesToHex(sha256(Buffer.from(message, 'utf8')));
  const signature = bytesToHex(await secp.sign(messageHash, normalized.hex));
  const publicKey = getPublicKey(normalized.bytes);
  return `NIP98 ${publicKey}:${signature}`;
}

export async function uploadDataWithProgress(
  signerPrivateKey: string,
  config: ServerConfig,
  fileData: Buffer,
  mimeType: string | undefined,
  proxy: string | undefined,
  progressCallback: ProgressCallback,
  params: UploadParams = new UploadParams(),
  _config: UploadConfig = new UploadConfig(),
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= params.retryCount; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, params.retrySpacing));
    }

    try {
      const authHeader = await buildNip98Authorization(
        signerPrivateKey,
        'POST',
        config.api_url,
        fileData,
      );

      const form = new FormData();
      form.append('file', fileData, {
        filename: 'attachment',
        contentType: mimeType ?? 'application/octet-stream',
      });

      progressCallback(0, 0);

      const response = await fetch(config.api_url, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          ...form.getHeaders(),
        },
        body: form,
      });

      if (!response.ok) {
        throw new UploadError(`Upload failed (${response.status})`);
      }

      progressCallback(100, fileData.length);

      const payload = (await response.json()) as {
        status?: string;
        message?: string;
        nip94_event?: { tags?: string[][] };
      };

      if (payload.status === 'error') {
        throw new UploadError(payload.message ?? 'Upload server reported an error');
      }

      const tags = payload.nip94_event?.tags ?? [];
      const urlTag = tags.find((tag) => tag[0] === 'u' || tag[0] === 'url');
      const url = urlTag?.[1];

      if (!url) {
        throw new UploadError('Upload response is missing a URL tag');
      }

      return url;
    } catch (err) {
      lastError = err instanceof Error ? err : new UploadError('Unknown upload error');
    }
  }

  throw lastError ?? new UploadError('Upload failed without a recorded error');
}
