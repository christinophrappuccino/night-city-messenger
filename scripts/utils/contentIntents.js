/**
 * Content intents — what a player may do to a typed entry, as named actions (audit SEC-04, batch A3a).
 * @file scripts/utils/contentIntents.js
 * @module night-city-messenger
 *
 * Typed entries (eddies, credentials, banking, gallery, payload…) live in GM-owned journals, so a player's
 * content action is written by the GM. The relay used to carry the player's whole new `contentData`, and the
 * GM wrote it as sent: a player could reset someone else's claimed eddies, refill a bank account, or unlock
 * anything. Now the relay carries an INTENT — `{ action, index?, kind?, amount? }` — and the GM re-reads the
 * stored entry and computes the change here, from what is stored.
 *
 * The client flows compute their own update with the SAME function, so the two can't drift.
 * Rolls are still reported by the acting client (the plan's gameplay boundary); what a result may CHANGE is
 * decided here.
 *
 * Pure: no Foundry globals. Sim: dev/tools/sims/test-content-intents.mjs.
 */

/** Max siphonable amount for the account's configured mode. */
export function computeMaxSiphon(banking = {}) {
  const bal = Math.max(0, Number(banking.balance) || 0);
  switch (banking.siphonMode) {
    case 'full': return bal;
    case 'percent': return Math.floor(bal * (Number(banking.siphonPercent) || 25) / 100);
    case 'cap':
    default: {
      const cap = Number(banking.siphonCap);
      return cap > 0 ? Math.min(bal, cap) : bal;
    }
  }
}

/** Which content type each unlock kind belongs to. */
export const UNLOCK_KINDS = Object.freeze({
  gallery: 'gallery', avlog: 'avlog', schematic: 'schematic', calendar: 'calendar', location: 'location',
  'dossier-face': 'dossier', 'dossier-profile': 'dossier', dossier: 'dossier', document: 'document', spreadsheet: 'spreadsheet',
});

/** Every action a player's client may ask the GM to apply, and the content type it applies to. */
export const CONTENT_ACTIONS = Object.freeze({
  claim: ['eddies'],
  crack: ['credentials'],
  unlock: [...new Set(Object.values(UNLOCK_KINDS))],
  camLoop: ['gallery'],
  camCut: ['gallery'],
  siphon: ['banking'],
  freeze: ['banking'],
  deploy: ['malware'],
  sniff: ['payload', 'malware'],
});

const fail = (why) => ({ ok: false, why });
const at = (list, i) => (Array.isArray(list) && Number.isInteger(i) && i >= 0 ? list[i] : undefined);
const setAt = (list, i, patch) => list.map((x, k) => (k === i ? { ...x, ...patch } : x));

/** A banking entry after a successful siphon: lower balance, a debit at the top, drained. */
export function drainBanking(banking, amount, who, nowIso) {
  const d = new Date(nowIso);
  const date = Number.isNaN(d.getTime()) ? '' : `${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
  const txn = { date, desc: `Siphoned by ${who}`, amount, type: 'debit', category: 'flagged' };
  return { ...banking, balance: (Number(banking.balance) || 0) - amount, siphoned: true, transactions: [txn, ...(banking.transactions || [])] };
}

/** The unlock change for one kind, or why there is none. */
function unlockNext(kind, cd, index, ctx) {
  switch (kind) {
    case 'gallery': {
      const img = at(cd.images, index);
      if (!img?.locked) return fail('that frame is not locked');
      return { ok: true, next: { ...cd, images: setAt(cd.images, index, { locked: false }) }, label: img.label || `frame ${index + 1}` };
    }
    case 'avlog':
      if (!cd.locked) return fail('the recording is not sealed');
      return { ok: true, next: { ...cd, locked: false }, label: 'the sealed recording' };
    case 'schematic': {
      const a = at(cd.annotations, index);
      if (!a?.locked) return fail('that marker is not locked');
      return { ok: true, next: { ...cd, annotations: setAt(cd.annotations, index, { locked: false }) }, label: 'a marker' };
    }
    case 'calendar': {
      const ev = at(cd.events, index);
      if (!ev?.locked) return fail('that entry is not locked');
      return { ok: true, next: { ...cd, events: setAt(cd.events, index, { locked: false }) }, label: 'a calendar entry' };
    }
    case 'location':
      if (!cd.locked) return fail('the location is not locked');
      return { ok: true, next: { ...cd, locked: false, revealedAt: ctx.realIso }, label: 'the location data' };
    case 'dossier-face':
      if (!cd.faceLocked) return fail('the identity is not masked');
      return { ok: true, next: { ...cd, faceLocked: false, faceRevealed: true }, label: 'the masked identity' };
    case 'dossier-profile':
      if (!(cd.profile?.enabled && cd.profile.visibility === 'encrypted' && !cd.profile.decrypted)) return fail('the profile is not encrypted');
      return { ok: true, next: { ...cd, profile: { ...cd.profile, decrypted: true } }, label: 'the combat profile' };
    case 'document':
      if (!cd.declassify || !(cd.paragraphs || []).some((p) => p.redacted)) return fail('nothing to declassify');
      return { ok: true, next: { ...cd, declassified: true, paragraphs: cd.paragraphs.map((p) => (p.redacted ? { ...p, redacted: false, declassified: true } : p)) }, label: 'the redacted sections' };
    case 'dossier':
      if (!cd.declassify || !(cd.sections || []).some((s) => s.redacted)) return fail('nothing to declassify');
      return { ok: true, next: { ...cd, declassified: true, sections: cd.sections.map((s) => (s.redacted ? { ...s, redacted: false, declassified: true } : s)) }, label: 'the redacted sections' };
    case 'spreadsheet':
      if (!cd.declassify || !(cd.redacted || []).length) return fail('nothing to declassify');
      return { ok: true, next: { ...cd, declassified: true, redacted: [] }, label: 'the redacted cells' };
    default:
      return fail(`unknown unlock kind "${kind}"`);
  }
}

/**
 * Apply one intent to a stored entry.
 * @param {string} contentType the STORED entry's content type
 * @param {object} cd the STORED contentData
 * @param {{action:string, index?:number, kind?:string, amount?:number, tripped?:boolean}} intent
 * @param {{actorId?:string|null, actorName?:string, nowIso:string, realIso?:string, realMs?:number, clock?:string}} ctx
 *   values the writer supplies: game time, real time, the camera clock string, who acted
 * @returns {{ok:true, next:object, toast:string}|{ok:false, why:string}}
 */
export function applyContentIntent(contentType, cd, intent, ctx) {
  const c = cd && typeof cd === 'object' ? cd : {};
  const it = intent && typeof intent === 'object' ? intent : {};
  const types = CONTENT_ACTIONS[it.action];
  if (!types) return fail(`unknown action "${it.action}"`);
  if (!types.includes(contentType)) return fail(`"${it.action}" does not apply to ${contentType || 'this'} content`);
  const who = ctx?.actorName || 'Someone';
  const index = Number.isInteger(it.index) ? it.index : Number.parseInt(it.index, 10);

  switch (it.action) {
    case 'claim': {
      if (c.claimed) return fail('already claimed');
      const amount = Number(c.amount) || 0;
      if (amount <= 0) return fail('nothing to claim');
      if (!ctx?.actorId) return fail('a claim needs a character');
      return { ok: true, next: { ...c, claimed: true, claimedBy: ctx.actorId, claimedAt: ctx.nowIso, claimedRealMs: ctx.realMs ?? 0 }, toast: `${who} claimed ${amount.toLocaleString()} eb.` };
    }
    case 'crack': {
      const e = at(c.entries, index);
      if (!e?.encrypted || e.cracked) return fail('that login is not locked');
      return { ok: true, next: { ...c, entries: setAt(c.entries, index, { cracked: true }) }, toast: `${who} cracked the ${e.host || 'host'} credentials.` };
    }
    case 'unlock': {
      const kind = String(it.kind || '');
      if (UNLOCK_KINDS[kind] !== contentType) return fail(`unlock "${kind}" does not apply to ${contentType} content`);
      const r = unlockNext(kind, c, index, ctx || {});
      return r.ok ? { ok: true, next: r.next, toast: `${who} revealed ${r.label}.` } : r;
    }
    case 'camLoop':
    case 'camCut': {
      const img = at(c.images, index);
      if (!img) return fail('no such camera');
      const label = img.label || `CAM_${String(index + 1).padStart(2, '0')}`;
      if (it.action === 'camLoop') {
        if (img.looped) return fail('already looped');
        return { ok: true, next: { ...c, images: setAt(c.images, index, { looped: true, loopedTime: ctx?.clock || '' }) }, toast: `${who} looped ${label}.` };
      }
      if (img.cut) return fail('already cut');
      return { ok: true, next: { ...c, images: setAt(c.images, index, { cut: true }) }, toast: `${who} cut ${label}.` };
    }
    case 'siphon': {
      if (c.siphoned) return fail('already drained');
      if (String(c.status || '').toLowerCase() === 'frozen') return fail('the account is frozen');
      const amount = Math.floor(Number(it.amount) || 0);
      const max = computeMaxSiphon(c);
      if (amount <= 0 || amount > max) return fail(`amount ${amount} is outside 1–${max}`);
      const label = c.accountName || c.bankName || 'account';
      return { ok: true, next: drainBanking(c, amount, who, ctx?.nowIso), toast: `SIPHON: ${who} drained ${amount.toLocaleString()} ${c.currency || '€$'} from ${label}.`, amount };
    }
    case 'freeze': {
      // Only an account that locks out on repeated siphon attempts freezes, and only the account's own security does it.
      if (!c.siphonLockout) return fail('this account does not lock out');
      if (String(c.status || '').toLowerCase() === 'frozen') return fail('already frozen');
      const label = c.accountName || c.bankName || 'account';
      return { ok: true, next: { ...c, status: 'frozen' }, toast: `${label} FROZEN — security locked it after repeated siphon attempts.` };
    }
    case 'deploy': {
      if (!c.deployable) return fail('not deployable');
      if (c.deployed) return fail('already deployed');
      // A honeypot always trips; the client can only make a clean run worse, never a decoy better.
      const tripped = !!c.honeypot || !!it.tripped;
      const name = c.name || 'UNKNOWN.exe';
      return {
        ok: true,
        next: { ...c, deployed: true, tripped, deployedBy: ctx?.actorId || null, deployedAt: ctx?.nowIso },
        toast: tripped ? `⚠ ${who} ${c.honeypot ? 'tripped the HONEYPOT' : 'botched the deploy of'} "${name}".` : `${who} deployed "${name}" — adjudicate its effect.`,
      };
    }
    case 'sniff': {
      if (!c.disguised || c.sniffed) return fail('nothing disguised');
      return { ok: true, next: { ...c, sniffed: true }, toast: `${who} exposed a disguised program (${c.name || 'unknown'}).` };
    }
    default:
      return fail(`unknown action "${it.action}"`);
  }
}

/** Only the fields an intent carries, typed. Anything else on the wire is dropped. */
export function sanitizeIntent(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = { action: String(r.action || '') };
  if (r.index !== undefined && r.index !== null) out.index = Number.parseInt(r.index, 10);
  if (r.kind !== undefined) out.kind = String(r.kind);
  if (r.amount !== undefined) out.amount = Math.floor(Number(r.amount) || 0);
  if (r.tripped !== undefined) out.tripped = !!r.tripped;
  return out;
}
