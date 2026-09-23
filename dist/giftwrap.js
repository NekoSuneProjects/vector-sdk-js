import { nip44 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getEventHash, getPublicKey } from 'nostr-tools/pure';
import { GIFT_WRAP, SEAL } from './kinds.js';
const TWO_DAYS = 2 * 24 * 60 * 60;
const nowSeconds = () => Math.round(Date.now() / 1000);
/**
 * Timestamp jitter for seals and wraps: up to two days in the past, so the
 * outer event leaks nothing about when the rumor was actually written.
 */
const jitteredNow = () => Math.round(nowSeconds() - Math.random() * TWO_DAYS);
/** Build a rumor (unsigned, id-bearing) from a partial event. */
export function createRumor(event, privateKey) {
    const rumor = {
        created_at: nowSeconds(),
        content: '',
        tags: [],
        ...event,
        pubkey: getPublicKey(privateKey),
    };
    rumor.id = getEventHash(rumor);
    return rumor;
}
/** Seal a rumor to `recipientPublicKey` (NIP-59 kind 13). */
export function createSeal(rumor, privateKey, recipientPublicKey) {
    const conversationKey = nip44.v2.utils.getConversationKey(privateKey, recipientPublicKey);
    return finalizeEvent({
        kind: SEAL,
        content: nip44.v2.encrypt(JSON.stringify(rumor), conversationKey),
        created_at: jitteredNow(),
        tags: [],
    }, privateKey);
}
/**
 * Wrap a seal for `recipientPublicKey` under a throwaway key (NIP-59 kind 1059).
 *
 * `extraTags` land on the outer wrap alongside the `p` tag. Vector uses this to
 * mirror a rumor's NIP-40 `expiration` onto the wrap, so relays purge the
 * envelope on schedule rather than holding it until a client asks.
 */
export function createWrap(seal, recipientPublicKey, extraTags = []) {
    const randomKey = generateSecretKey();
    const conversationKey = nip44.v2.utils.getConversationKey(randomKey, recipientPublicKey);
    return finalizeEvent({
        kind: GIFT_WRAP,
        content: nip44.v2.encrypt(JSON.stringify(seal), conversationKey),
        created_at: jitteredNow(),
        tags: [['p', recipientPublicKey], ...extraTags],
    }, randomKey);
}
/**
 * Gift-wrap `event` for `recipientPublicKey`, returning the wrap and the rumor
 * it carries.
 *
 * The rumor's id is the message's durable identity — it is what a reply, edit,
 * reaction or deletion references, so callers need it back. `nostr-tools`'
 * `wrapEvent` discards it.
 */
export function wrapEventWithRumor(event, senderPrivateKey, recipientPublicKey, extraTags = []) {
    const rumor = createRumor(event, senderPrivateKey);
    const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);
    return { wrap: createWrap(seal, recipientPublicKey, extraTags), rumor };
}
/**
 * Re-wrap an existing rumor for a second recipient.
 *
 * Used for the self-wrap: Vector sends every outgoing message a second time,
 * addressed to the sender, so the account's other devices see what this one
 * sent. The rumor — and therefore the message id — is identical in both wraps.
 */
export function rewrapRumor(rumor, senderPrivateKey, recipientPublicKey, extraTags = []) {
    const seal = createSeal(rumor, senderPrivateKey, recipientPublicKey);
    return createWrap(seal, recipientPublicKey, extraTags);
}
/** Pull the NIP-40 `expiration` tag off a rumor, if it carries one. */
export function expirationTagsOf(tags) {
    return tags.filter((tag) => tag[0] === 'expiration' && typeof tag[1] === 'string');
}
