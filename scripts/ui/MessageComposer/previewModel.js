/**
 * Preview as recipient — the pure view-model (2026-10-28).
 * @file scripts/ui/MessageComposer/previewModel.js
 * @module night-city-messenger
 * @description What the player will OPEN, built from the composer's state and
 *   names the composer resolved. No Foundry globals (the sim drives it). The
 *   body goes through the same `mail` cleaner the viewer renders with; an
 *   encrypted message shows the ICE lock block instead of the body, an
 *   anonymous one the mask + alias instead of the sender.
 */

import { cleanHtml } from '../../utils/richText.js';

const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent', critical: 'Critical' };
const ENC_TYPE_LABELS = { ICE: 'ICE', RED_ICE: 'Red ICE', BLACK_ICE: 'Black ICE' };
const SD_LABELS = { after_read: 'after reading', '1h': 'in 1 hour', '6h': 'in 6 hours', '24h': 'in 24 hours' };

function missText(failureMode, typeLabel) {
  if (failureMode === 'damage') return `A failed breach deals damage — the ${typeLabel} bites back.`;
  if (failureMode === 'lockout') return 'A failed breach locks the message for a while.';
  return 'A failed breach just fails; they can try again.';
}

/**
 * @param {object} s
 * @param {boolean} s.anon            masked sender
 * @param {string}  [s.anonStyle]
 * @param {string}  [s.anonAlias]
 * @param {string}  [s.anonMaskedEmail]
 * @param {boolean} [s.anonAllowReplies]
 * @param {string}  s.fromName
 * @param {string}  [s.fromEmail]
 * @param {string}  [s.fromImg]
 * @param {string}  [s.fromInitials]
 * @param {string}  [s.networkName]
 * @param {string}  [s.when]            formatted date the message will carry
 * @param {string}  [s.priority]
 * @param {string}  [s.subject]
 * @param {string}  [s.body]            raw editor HTML
 * @param {{enabled:boolean, dv?:number, type?:string, failureMode?:string}} [s.encryption]
 * @param {{enabled:boolean, mode?:string}} [s.selfDestruct]
 * @param {{enabled:boolean, timeFormatted?:string}} [s.schedule]
 * @param {Array<{name:string, isGroup?:boolean, members?:Array<{name?:string, email?:string}>, isAnonTarget?:boolean}>} [s.recipients]
 * @param {Array<{name:string, isEddies?:boolean, eddiesFormatted?:string, icon?:string, isMedia?:boolean}>} [s.attachments]
 * @param {boolean} [s.isReply]
 */
export function buildPreview(s = {}) {
  const recipients = s.recipients || [];
  const people = [];
  for (const r of recipients) {
    if (r.isGroup) for (const m of (r.members || [])) people.push(m.name || m.email || '?');
    else people.push(r.name || r.email || '?');
  }
  const first = people[0] || 'the recipient';
  const who = people.length > 1 ? `${first} and ${people.length - 1} other${people.length > 2 ? 's' : ''}` : first;
  const toLine = recipients.some(r => r.isGroup)
    ? people.join(', ')
    : people.join(', ');

  const anon = !!s.anon;
  const sender = anon
    ? { anon: true, style: s.anonStyle || 'scrambled', name: (s.anonAlias || '').trim() || 'UNKNOWN', email: s.anonMaskedEmail || '', img: null, initials: '?' }
    : { anon: false, style: '', name: s.fromName || 'Unknown', email: s.fromEmail || '', img: s.fromImg || null, initials: s.fromInitials || '?' };

  const enc = s.encryption?.enabled ? s.encryption : null;
  const typeLabel = enc ? (ENC_TYPE_LABELS[enc.type] || 'ICE') : '';
  const lock = enc ? {
    dv: Number(enc.dv) || 0,
    typeLabel,
    lethal: enc.type === 'BLACK_ICE' || enc.type === 'RED_ICE',
    text: `The body stays scrambled until ${first} breaches it. ${missText(enc.failureMode, typeLabel)}`,
  } : null;

  const bodyHtml = enc ? '' : cleanHtml(String(s.body || ''), { mode: 'mail' });
  const bodyEmpty = !enc && !bodyHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

  const pri = s.priority || 'normal';
  const notes = [];
  if (s.selfDestruct?.enabled) notes.push({ icon: 'fa-bomb', text: `Self-destructs ${SD_LABELS[s.selfDestruct.mode] || 'after reading'}` });
  if (anon) notes.push({ icon: s.anonAllowReplies ? 'fa-reply' : 'fa-reply-slash', text: s.anonAllowReplies ? 'Replies go back to the mask' : 'One-way — no reply' });
  if (s.schedule?.enabled && s.schedule.timeFormatted) notes.push({ icon: 'fa-clock', text: `Arrives ${s.schedule.timeFormatted}` });

  const metaParts = [sender.email, s.networkName, s.when].filter(Boolean);

  return {
    who,
    sender,
    meta: metaParts.join(' · '),
    priority: { key: pri, label: PRIORITY_LABELS[pri] || pri, show: pri !== 'normal', bad: pri === 'critical', attn: pri === 'urgent' || pri === 'high' },
    subject: String(s.subject || '').trim() || (s.isReply ? '' : '(no subject)'),
    toLine,
    toCount: people.length,
    lock,
    bodyHtml,
    bodyEmpty,
    attachments: (s.attachments || []).map(a => ({
      name: a.isEddies ? (a.eddiesFormatted || 'eddies') : (a.name || 'attachment'),
      icon: a.icon || (a.isEddies ? 'fa-coins' : 'fa-paperclip'),
      isEddies: !!a.isEddies,
    })),
    notes,
  };
}
