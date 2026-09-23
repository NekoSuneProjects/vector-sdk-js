import { nip19 } from 'nostr-tools';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
export class KeyFormatError extends Error {
}
function stripNostrUriPrefix(value) {
    const trimmed = value.trim();
    if (trimmed.toLowerCase().startsWith('nostr:')) {
        return trimmed.slice('nostr:'.length).trim();
    }
    return trimmed;
}
export function normalizePrivateKey(privateKey) {
    const trimmed = stripNostrUriPrefix(privateKey);
    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith('nsec1')) {
        const decoded = nip19.decode(lowered);
        if (decoded.type !== 'nsec') {
            throw new KeyFormatError('Invalid nsec private key');
        }
        return { hex: bytesToHex(decoded.data), bytes: decoded.data };
    }
    const hexCandidate = lowered.startsWith('0x') ? lowered.slice(2) : lowered;
    if (!/^[0-9a-f]{64}$/.test(hexCandidate)) {
        throw new KeyFormatError('Private key must be a 32-byte hex string or nsec');
    }
    const hex = hexCandidate;
    return { hex, bytes: hexToBytes(hex) };
}
export function normalizePublicKey(publicKey) {
    const trimmed = stripNostrUriPrefix(publicKey);
    const lowered = trimmed.toLowerCase();
    if (lowered.startsWith('npub1')) {
        const decoded = nip19.decode(lowered);
        if (decoded.type !== 'npub') {
            throw new KeyFormatError('Invalid npub public key');
        }
        return decoded.data;
    }
    const hexCandidate = lowered.startsWith('0x') ? lowered.slice(2) : lowered;
    if (!/^[0-9a-f]{64}$/.test(hexCandidate)) {
        throw new KeyFormatError('Public key must be a 32-byte hex string or npub');
    }
    return hexCandidate;
}
