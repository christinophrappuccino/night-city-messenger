/**
 * Reply quoting — the earlier mail, copied into a reply for people who were not on it. Pure: no Foundry globals.
 * @file scripts/utils/replyQuote.js
 * @module night-city-messenger
 * @description A reply carries only its new text; the earlier mail is linked by thread. Once a reply can add people
 *   (testers 2026-11-08), someone added would get "RE: Shipment" with no idea what it answers. So when a reply goes to
 *   anyone who was not on the original, it carries a quoted copy, the way mail apps quote. Never for a locked
 *   (encrypted) original, which would hand its contents to someone who never breached it, nor a self-destructing one,
 *   which would outlive its own timer. One message goes to everyone, so everyone on the reply sees the quote.
 */

import { memberKeys } from './participants.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Every key that stands for someone already on the original: its participants, its sender, its recipient.
 * @param {object} orig - the message replied to
 * @returns {Set<string>}
 */
export function originalKeys(orig = {}) {
  const keys = new Set();
  const add = (m) => { for (const k of memberKeys(m)) keys.add(k); };
  for (const p of Array.isArray(orig.participants) ? orig.participants : []) add(p);
  add({ email: orig.from, hint: { actorId: orig.fromActorId, contactId: orig.fromContactId } });
  add({ email: orig.to, hint: { actorId: orig.toActorId, contactId: orig.toContactId } });
  return keys;
}

/**
 * Who on this reply was not on the original (a group counts by its members).
 * @param {object} orig
 * @param {Array<{actorId?: string, contactId?: string, email?: string, name?: string, isGroup?: boolean, members?: object[], isAnonTarget?: boolean}>} recipients
 * @returns {string[]} their names
 */
export function newcomers(orig, recipients = []) {
  const known = originalKeys(orig);
  const flat = recipients.flatMap((r) => (r?.isGroup ? (r.members || []) : r?.isAnonTarget ? [] : [r]));
  return flat.filter((r) => {
    const ks = memberKeys({ email: r?.email, hint: { actorId: r?.actorId, contactId: r?.contactId } });
    return ks.size > 0 && ![...ks].some((k) => known.has(k));
  }).map((r) => r.name || r.email || 'someone');
}

/** Why the original may not be quoted ('' when it may). */
export function quoteBlockedWhy(orig = {}) {
  if (orig.status?.encrypted || orig.encryption?.type) return 'It was encrypted, so it is not copied in.';
  if (orig.selfDestruct?.enabled || orig.selfDestruct?.mode) return 'It self-destructs, so it is not copied in.';
  return '';
}

/**
 * The quoted copy appended to a reply body (HTML). The original body is already-cleaned mail HTML; the header fields
 * are plain text written by other people, so they are escaped.
 * @param {{sender: string, email?: string, when?: string, subject?: string, body: string}} o
 * @returns {string}
 */
export function quoteHtml({ sender, email = '', when = '', subject = '', body = '' }) {
  const who = esc(sender) + (email ? ` &lt;${esc(email)}&gt;` : '');
  return `<p><br></p><blockquote class="ncm-reply-quote"><p><b>${who}</b>${when ? ` · ${esc(when)}` : ''}${subject ? `<br>${esc(subject)}` : ''}</p>${body}</blockquote>`;
}
