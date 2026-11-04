/**
 * Conversations: the rules.
 * @file scripts/utils/conversations.js
 * @module night-city-messenger
 * @description Pure, no Foundry globals. Design and gap tracker: dev/design/CONVERSATIONS.md.
 *
 *   A conversation is one journal, found by flag (`type: 'conversation'`). Its flags hold the title, the members and a summary
 *   (`lastSeq`, `lastAt`, `lastPreview`), so an inbox row reads no page. Its pages hold runs of lines, keyed by line id, so a send
 *   writes one key. Nobody but the GM may write: everything relays.
 *
 *   Who may see a line is decided here, by each member's spans of line numbers, and only in the UI. The two-client probe
 *   (2026-11-02) showed Foundry sends pages to every client whatever their ownership, so ownership protects nothing here and the
 *   journal simply stays GM-only, out of every player's sidebar. A conversation is never where a real secret belongs: that is mail.
 */

export const PAGE_LINES = 150;
export const LINE_MAX = 500;
export const TITLE_MAX = 60;
export const TAP_LOG_MAX = 200;

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

/** What someone typed. Plain text: it is escaped when drawn, so a `<3` stays a `<3`. */
export const lineText = (s) => clean(s, LINE_MAX);
export const titleText = (s) => clean(s, TITLE_MAX).replace(/\s+/g, ' ');

/** A picture: a path or an http(s) address. Never data: (it would fill a page), never anything that could break out of an attribute. */
export function safeImage(src) {
  const s = String(src ?? '').trim();
  if (!s || s.length > 500 || /["'<>\s]/.test(s)) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? '' : s;
}

/** A shared contact. Only what was chosen to be shared, and nothing that links an alias to its owner. */
export function sanitizeCard(c) {
  const o = c && typeof c === 'object' ? c : {};
  const name = clean(o.name, 60), email = clean(o.email, 120), phone = clean(o.phone, 40);
  if (!name || (!email && !phone) || o.encrypted) return null;
  return { name, email, phone, role: clean(o.role, 40), portrait: safeImage(o.portrait), contactId: clean(o.contactId, 40) };
}

/** Lowercase address, else a contact, else a character: the key a member keeps if ids change. */
export function memberKeyOf({ email, contactId, actorId } = {}) {
  const e = String(email ?? '').trim().toLowerCase();
  return e || (contactId ? `c:${contactId}` : actorId ? `a:${actorId}` : '');
}

export function sanitizeMember(m) {
  const o = m && typeof m === 'object' ? m : {};
  const spans = (Array.isArray(o.spans) ? o.spans : []).map((s) => ({ from: Math.max(0, Number(s?.from) || 0), to: s?.to === null || s?.to === undefined ? null : Number(s.to) }));
  const member = { key: String(o.key ?? ''), name: clean(o.name, 60), email: clean(o.email, 120), contactId: o.contactId || null, actorId: o.actorId || null, spans };
  member.key ||= memberKeyOf(member);
  return member;
}

/** In the conversation right now? */
export const isIn = (m) => { const last = m?.spans?.[m.spans.length - 1]; return !!last && last.to === null; };
/** Could this member see this line number? Removed and added back keeps both stretches and not the gap. */
export const canSee = (m, seq) => (m?.spans || []).some((s) => seq >= s.from && (s.to === null || seq <= s.to));
/** Join from the next line. Nobody sees what came before they joined. */
export const openSpan = (m, nextSeq) => (isIn(m) ? m : { ...m, spans: [...(m.spans || []), { from: nextSeq, to: null }] });
export const closeSpan = (m, lastSeq) => (!isIn(m) ? m : { ...m, spans: m.spans.map((s, i) => (i === m.spans.length - 1 ? { ...s, to: lastSeq } : s)) });
export const visibleLines = (lines, m) => lines.filter((l) => canSee(m, l.seq));

/** `seq` decides the order, never the time: a paused clock gives many lines one time. The id breaks a tie. */
export const sortLines = (lines) => [...lines].sort((a, b) => (a.seq - b.seq) || String(a.lineId).localeCompare(String(b.lineId)));

/** Who starts it now, when the starter has gone: the longest-standing member still in. */
export function nextStarter(members, starterKey) {
  const inNow = members.filter(isIn);
  if (inNow.some((m) => m.key === starterKey)) return starterKey;
  const first = [...inNow].sort((a, b) => (a.spans.at(-1).from - b.spans.at(-1).from))[0];
  return first?.key || '';
}

/** New lines for this member. Their own read position, never counting before they joined this time. */
export function unreadFor(m, lastSeq, readSeq = 0) {
  if (!isIn(m)) return 0;
  const start = Math.max(Number(readSeq) || 0, m.spans.at(-1).from - 1);
  return Math.max(0, (Number(lastSeq) || 0) - start);
}

/** What a row and a preview say about a line. */
export function previewOf(line) {
  if (!line) return '';
  switch (line.kind) {
    case 'image': return '[picture]';
    case 'card': return `[shared a contact: ${line.card?.name || 'someone'}]`;
    case 'system': return line.text || '';
    case 'gone': return '[line removed]';
    default: return line.text || '';
  }
}

/** The title, or the other people's names. `mine` are the keys of whoever is looking. */
export function titleFor(conv, mine = new Set()) {
  if (conv?.title) return conv.title;
  const others = (conv?.members || []).filter((m) => isIn(m) && !mine.has(m.key)).map((m) => m.name);
  if (!others.length) return 'Just you';
  return others.length <= 3 ? others.join(', ') : `${others.slice(0, 3).join(', ')} +${others.length - 3}`;
}

/** A line, as stored. Returns null when there is nothing to send. */
export function makeLine({ lineId, seq, at, from = {}, kind = 'text', text = '', img = '', card = null, network = '' }) {
  const base = { lineId: String(lineId), seq: Number(seq) || 0, at: at || '', fromKey: from.key || '', fromName: clean(from.name, 60), fromContactId: from.contactId || null, fromActorId: from.actorId || null, kind, network: String(network || '') };
  if (kind === 'image') { const src = safeImage(img); return src ? { ...base, img: src } : null; }
  if (kind === 'card') { const c = sanitizeCard(card); return c ? { ...base, card: c } : null; }
  const t = kind === 'system' ? clean(text, 200) : lineText(text);
  return t ? { ...base, text: t } : null;
}

/** The GM removed it: the words are gone from the data, not just hidden. */
export const goneLine = (line) => ({ lineId: line.lineId, seq: line.seq, at: line.at, kind: 'gone', fromKey: '', fromName: '', fromContactId: null, fromActorId: null, network: '' });

/**
 * Is an NPC being waited on? Lines from anyone else since the last NPC line.
 * @param {object[]} lines - sorted @param {Set<string>} npcKeys
 * @returns {{n: number, who: string}}
 */
export function waitingOn(lines, npcKeys) {
  let n = 0, who = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.kind === 'system' || l.kind === 'gone') continue;
    if (npcKeys.has(l.fromKey)) { who = l.fromName; break; }
    n++;
  }
  return { n, who };
}

/** A conversation row in the mail list: it sorts and pages as one message, by its latest line. */
export const rowAsMessage = (row) => ({ messageId: `conv:${row.id}`, isConversation: true, conversation: row, subject: row.title, from: row.title, fromName: row.title, to: '', body: row.preview, timestamp: row.lastAt, priority: 'normal', status: { read: !row.unread }, metadata: {} });

/**
 * Notifications, so a busy chat can't flood anyone. One toast per conversation, updated in place, and one sound until it is read.
 * @param {{n: number, heard: boolean}} [state] - this conversation so far @param {{own?: boolean, open?: boolean, muted?: boolean}} line
 * @returns {{state: object, toast: boolean, sound: boolean}}
 */
export function notifyPlan(state, { own = false, open = false, muted = false } = {}) {
  const s = state || { n: 0, heard: false };
  if (own || open || muted) return { state: s, toast: false, sound: false };
  return { state: { n: s.n + 1, heard: true }, toast: true, sound: !s.heard };
}

/** One tap log line. A tap gets words, never a picture or a contact's details. */
export function tapLogLine(line, when = '') {
  return { when, who: line.fromName || 'Unknown', what: previewOf(line) };
}
/** Add to a running log, oldest falling off. */
export const appendTapLog = (log, entry) => [...(Array.isArray(log) ? log : []), entry].slice(-TAP_LOG_MAX);

/** How many NPCs the GM's New conversation offers as one-click chips. */
export const RECENT_NPCS = 6;

/** The same NPC, whichever way they were picked. */
export const npcKey = (raw) => raw?.contactId || raw?.actorId || '';

/** Most recent first, no repeats, capped. Holds only what it takes to join as them again. */
export function pushRecentNpc(list, raw, cap = RECENT_NPCS) {
  const key = npcKey(raw);
  if (!key) return Array.isArray(list) ? list : [];
  const entry = { contactId: raw.contactId || null, actorId: raw.actorId || null, name: raw.name || '' };
  return [entry, ...(Array.isArray(list) ? list : []).filter((r) => npcKey(r) !== key)].slice(0, cap);
}
