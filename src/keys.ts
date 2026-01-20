import { nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

export class KeyFormatError extends Error {}

export function normalizePrivateKey(privateKey: string): { hex: string; bytes: Uint8Array } {
  const trimmed = privateKey.trim();

  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') {
      throw new KeyFormatError('Invalid nsec private key');
    }
    return { hex: bytesToHex(decoded.data), bytes: decoded.data };
  }

  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new KeyFormatError('Private key must be a 32-byte hex string or nsec');
  }

  const hex = trimmed.toLowerCase();
  return { hex, bytes: hexToBytes(hex) };
}

export function normalizePublicKey(publicKey: string): string {
  const trimmed = publicKey.trim();

  if (trimmed.startsWith('npub1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'npub') {
      throw new KeyFormatError('Invalid npub public key');
    }
    return decoded.data;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new KeyFormatError('Public key must be a 32-byte hex string or npub');
  }

  return trimmed.toLowerCase();
}
