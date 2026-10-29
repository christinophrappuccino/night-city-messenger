/**
 * Admin → Messages — the rules, with no Foundry globals (sim-testable).
 * @file scripts/ui/AdminPanel/tabs/messagesModel.js
 * @module night-city-messenger
 *
 * MessagesTab gathers; this decides:
 *   - when a player's message to an NPC counts as ANSWERED (Needs a reply)
 *   - the conversation key (one row per NPC inbox × alias it was addressed to —
 *     the same key the Overview's NEEDS YOU mail item uses)
 *   - the All-mail flag chips and the From players / From NPCs box
 *   - day grouping for the feed
 */

/** A message id without its sent-copy suffix — the id both twins share. */
export const baseIdOf = (id) => String(id || '').replace(/-sent$/, '');

/** Needs a reply: one conversation per NPC inbox × the alias the player wrote to ('' = the main identity). */
export const convKey = (ownerId, aliasId = '') => `${ownerId}|${aliasId || ''}`;

/** The keys a sender is known by: actor id, directory id, address. */
export function senderKeys(m) {
  const out = new Set();
  if (m?.fromActorId) out.add(`a:${m.fromActorId}`);
  if (m?.fromContactId) out.add(`c:${m.fromContactId}`);
  const e = String(m?.from || '').trim().toLowerCase();
  if (e.includes('@')) out.add(`e:${e}`);
  return out;
}

/** The keys a (sent) message went TO: its own fields, every address in a joined "a, b", every non-sender participant. */
export function targetKeys(m) {
  const out = new Set();
  if (m?.toActorId) out.add(`a:${m.toActorId}`);
  if (m?.toContactId) out.add(`c:${m.toContactId}`);
  for (const e of String(m?.to || '').split(',')) { const x = e.trim().toLowerCase(); if (x.includes('@')) out.add(`e:${x}`); }
  for (const p of (Array.isArray(m?.participants) ? m.participants : [])) {
    if (p?.role === 'from') continue;
    if (p?.hint?.actorId) out.add(`a:${p.hint.actorId}`);
    if (p?.hint?.contactId) out.add(`c:${p.hint.contactId}`);
    if (p?.email) out.add(`e:${String(p.email).toLowerCase()}`);
  }
  return out;
}

const tsOf = (m) => (typeof m?._ts === 'number' ? m._ts : (m?.timestamp ? new Date(m.timestamp).getTime() : 0)) || 0;

/**
 * A player's message is answered when the GM marked it (`answered[baseId]`), or
 * when the NPC's inbox holds a SENT copy written after it that went to that
 * player. Reading it is not answering it.
 * @param {object} msg            the received message
 * @param {object[]} sentCopies   the NPC inbox's sent copies (status.sent)
 * @param {object} answered       { [baseId]: iso } — the npcMailAnswered setting
 */
export function isAnswered(msg, sentCopies = [], answered = {}) {
  if (answered && answered[baseIdOf(msg?.messageId)]) return true;
  const who = senderKeys(msg);
  if (!who.size) return false;
  const t = tsOf(msg);
  return (sentCopies || []).some((sc) => tsOf(sc) > t && [...targetKeys(sc)].some((k) => who.has(k)));
}

/** Keep the answered map bounded (oldest marks drop first). */
export function pruneAnswered(map = {}, cap = 1500) {
  const entries = Object.entries(map || {});
  if (entries.length <= cap) return { ...map };
  return Object.fromEntries(entries.sort((a, b) => String(b[1]).localeCompare(String(a[1]))).slice(0, cap));
}

/** Conversation filter chips. */
export function convPasses(conv, filter) {
  if (filter === 'waiting') return conv.waiting > 0;
  if (filter === 'answered') return conv.waiting === 0;
  return true;
}

/** Waiting first (newest waiting on top), then the rest newest first. */
export function sortConversations(list) {
  return [...list].sort((a, b) => (Number(b.waiting > 0) - Number(a.waiting > 0)) || ((b.latestTs || 0) - (a.latestTs || 0)));
}

// ─── All mail ────────────────────────────────────────────────

/** The flag chips, in order: key, label, icon, predicate over a feed entry. */
export const MAIL_FLAGS = [
  ['unread', 'Unread', 'fa-envelope', (e) => !!e.unread],
  ['anon', 'Anonymous', 'fa-user-secret', (e) => !!e.isAnon],
  ['group', 'Group sends', 'fa-users', (e) => !!e.isGroup],
  ['term', 'Typed on a terminal', 'fa-terminal', (e) => !!e.sentVia],
  ['eb', 'Eddies', 'fa-coins', (e) => (e.eddies || 0) > 0],
  ['sd', 'Self-destruct', 'fa-hourglass-half', (e) => !!e.selfDestruct],
  ['att', 'Attachments', 'fa-paperclip', (e) => (e.attachments?.length || 0) > 0],
  ['spam', 'Spam', 'fa-filter', (e) => !!e.isSpam],
];
export const MAIL_FLAG_KEYS = MAIL_FLAGS.map((f) => f[0]);

/** Everything / From players / From NPCs. */
export function boxPasses(e, box) {
  if (box === 'pc') return !!e.fromPlayer;
  if (box === 'npc') return !e.fromPlayer;
  return true;
}

/** Apply the box and every lit flag chip (AND). */
export function applyMailFilters(entries, { box = 'all', flags = [] } = {}) {
  const preds = MAIL_FLAGS.filter((f) => flags.includes(f[0])).map((f) => f[3]);
  return entries.filter((e) => boxPasses(e, box) && preds.every((p) => p(e)));
}

/** Count per flag chip over a set of entries. */
export function flagCounts(entries) {
  const out = {};
  for (const [k, , , p] of MAIL_FLAGS) out[k] = entries.filter(p).length;
  return out;
}

/** UTC day key of a timestamp (ms). */
export const dayKeyOf = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '');

/** "Today" / "Yesterday" / a formatted date, relative to the game clock. */
export function dayLabel(ms, nowMs, fmt = (x) => dayKeyOf(x)) {
  if (!ms) return 'Undated';
  const k = dayKeyOf(ms);
  if (k === dayKeyOf(nowMs)) return 'Today';
  if (k === dayKeyOf(nowMs - 86400000)) return 'Yesterday';
  return fmt(ms);
}

/** Split an already-sorted list into day groups, keeping order. */
export function groupByDay(entries, nowMs, fmt) {
  const out = [];
  let cur = null;
  for (const e of entries) {
    const label = dayLabel(e.rawTimestamp, nowMs, fmt);
    if (!cur || cur.label !== label) { cur = { label, rows: [] }; out.push(cur); }
    cur.rows.push(e);
  }
  return out.map((g) => ({ ...g, count: g.rows.length }));
}

/** Purge rule: read, not saved, older than the cutoff. */
export function purgeable(m, cutoffMs) {
  const t = tsOf(m);
  return !!m?.status?.read && !m?.status?.saved && t > 0 && t < cutoffMs;
}

// ─── The delivery line (All mail → reading pane) ─────────────
//
// One line under From / To / When that says what happened to the message:
// green when fine (answered / read / delivered), amber when it waits (held on a
// player's Agent, not read), red when it failed (refused, not delivered).
// Opened, it shows the steps, why, what the player saw, what happens by itself,
// and the fixes. Mock: dev/mockups/admin-guides-v4-mock.html (slot "dl") and
// admin-guides-v5-mock.html (slot "grp"). These functions take plain facts the
// tab gathers and return a view-model; every string a person typed is escaped
// here, because the template prints `line` / `v` / `why` raw.

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b = (s) => `<b>${h(s)}</b>`;
const step = (cls, icon, label, time = '') => ({ cls, icon, label, time });
const addrHtml = (s) => `<span class="ncm-msg2-dl__addr">${h(s)}</span>`;

/** Why it is held, in words: the line / the step / Why / what the player saw / by itself. */
function heldWords(held, by) {
  if (held.reason === 'gm_offline') return {
    short: 'no GM was online', step: 'Waiting for a GM',
    why: `Player mail goes out through a GM’s client, and no GM was connected when ${b(by)} pressed Send. It waits on their Agent instead of being lost.`,
    sawMark: '◷ MESSAGE QUEUED', sawText: 'it sends when the GM is back',
    alone: `It stays on ${h(by)}’s Agent until it is sent on — delivering it now is the sure way.`,
  };
  return {
    short: `${held.place ? `${h(held.place)} is` : 'they are in'} a dead zone`, step: 'Waiting for signal',
    why: `No network reaches ${held.place ? b(held.place) : `${b(by)}’s scene`} (a dead zone). Mail written there waits on the sender’s Agent instead of being lost.`,
    sawMark: '◷ MESSAGE QUEUED', sawText: 'it sends when you’re back in range',
    alone: `It goes out the moment ${h(by)} has signal — a new scene, or the dead zone off.`,
  };
}

/**
 * One recipient.
 * @param {object} f
 *   toName, fromName, subject, sentAt, readAt ('' when unknown — old mail),
 *   toIsPlayer, playerName, playerOnline, read, deleted, answered (the GM's ✓),
 *   reply {at, snippet, owner, id} | null, gone (a sent copy whose received copy is missing),
 *   held {reason, place, by, ago} | null,
 *   failure {id, why, sendOnly, unlocked, source, contactId, addr, sender, senderActorId} | null,
 *   messageId, inboxOwnerId, toActorId, nudged
 * @returns {{tone, icon, line, pips, steps, grid, fixes}}
 */
export function deliveryLine(f = {}) {
  const to = f.toName || 'the recipient';
  const sent = step('ok', 'fa-paper-plane', 'Sent', f.sentAt || '');
  const noRead = step('no', 'fa-eye', 'Read'), noReply = step('no', 'fa-reply', 'Replied');
  const out = { tone: 'good', icon: 'fa-inbox', line: '', pips: ['on', '', '', ''], steps: [], grid: [], fixes: [] };

  // ── Failed: refused at the door, or not delivered ──
  if (f.failure) {
    const x = f.failure;
    if (x.sendOnly && x.unlocked) {
      out.icon = 'fa-unlock';
      out.line = `${b('Players can write to it now')} — ${h(x.sender || 'the sender')} can send it again from their composer.`;
      out.steps = [sent, step('bad', 'fa-ban', 'Refused at the time'), noRead, noReply];
      out.grid = [{ k: 'What changed', v: `Send-only is off for ${b(to)}. This message didn’t go — it was refused at the time — but the next one will.` }];
      if (x.contactId) out.fixes.push({ op: 'dlRelock', label: 'Make it send-only again', icon: 'fa-rotate-left', quiet: true, data: { contact: x.contactId } });
      return out;
    }
    out.tone = 'bad';
    out.pips = ['on', 'bad', '', ''];
    if (x.sendOnly) {
      out.icon = 'fa-ban';
      out.line = `${b('Refused')} — ${x.addr ? addrHtml(x.addr) : h(to)} is a system address; players can’t write to it.`;
      out.steps = [sent, step('bad', 'fa-ban', 'Refused at the door'), noRead, noReply];
      out.grid = [{ k: 'Why', v: `${b(to)} is set to ${b('send-only')} — for addresses that only ever send (alerts, noreply). Players can’t message, reply to or add them.` }];
      if (x.source !== 'gm') out.grid.push({ k: `${x.sender || 'The sender'} saw`, screen: { tone: 'b', mark: '✕ TRANSMISSION REFUSED', text: 'the message stayed in their composer' } });
      if (x.contactId) out.fixes.push({ op: 'dlUnlock', label: 'Let players write to it', icon: 'fa-unlock', data: { contact: x.contactId } });
      if (x.contactId && x.senderActorId) out.fixes.push({ op: 'dlAnswerAs', label: `Answer as ${to} instead`, icon: 'fa-reply', quiet: true, data: { contact: x.contactId, actor: x.senderActorId, subject: f.subject || '' } });
      return out;
    }
    out.icon = 'fa-triangle-exclamation';
    out.line = `${b('Not delivered')} — ${h(to)} never got it.`;
    out.steps = [sent, step('bad', 'fa-triangle-exclamation', 'Not delivered'), noRead, noReply];
    out.grid = [{ k: 'Why', v: h(x.why || 'unknown error') }];
    if (x.source !== 'gm') out.grid.push({ k: `${x.sender || 'The sender'} saw`, screen: { tone: 'b', mark: '✕ NOT DELIVERED', text: 'their composer stayed open with Retry / Queue / Save Draft' } });
    else out.grid.push({ k: 'Who knows', v: 'Only you — it was your send.' });
    out.grid.push({ k: 'By itself', v: 'Nothing. A failed send is not retried on its own.' });
    if (x.id) out.fixes.push({ op: 'failRetry', label: 'Try it again', icon: 'fa-rotate-right', data: { id: x.id } });
    if (x.contactId) out.fixes.push({ op: 'dlContact', label: `Open ${to}`, icon: 'fa-address-card', quiet: true, data: { contact: x.contactId } });
    return out;
  }

  // ── Held on the sender's Agent ──
  if (f.held) {
    const by = f.held.by || 'the sender';
    const w = heldWords(f.held, by);
    out.tone = 'wait'; out.icon = 'fa-hourglass-half';
    out.pips = ['on', 'wait', '', ''];
    out.line = `${b(`Held on ${by}’s Agent`)} — ${w.short}, so it hasn’t gone yet.`;
    out.steps = [step('ok', 'fa-paper-plane', 'Sent', f.held.ago || f.sentAt || ''), step('wait', 'fa-hourglass-half', w.step), noRead, noReply];
    out.grid = [
      { k: 'Why', v: w.why },
      { k: `${by} saw`, screen: { tone: 'e', mark: w.sawMark, text: w.sawText } },
      { k: 'By itself', v: w.alone },
    ];
    out.fixes.push({ op: 'dlDeliver', label: 'Deliver it now', icon: 'fa-paper-plane', data: { id: f.messageId } });
    if (f.held.reason !== 'gm_offline') out.fixes.push({ op: 'dlNetworks', label: 'Open this scene’s networks', icon: 'fa-tower-broadcast', quiet: true, data: {} });
    return out;
  }

  // ── Sent, but the received copy is gone ──
  if (f.gone) {
    out.tone = 'wait'; out.icon = 'fa-circle-question';
    out.pips = ['on', 'wait', '', ''];
    out.line = `${b('Sent')} — but ${h(to)}’s copy isn’t in any inbox. It may have been deleted.`;
    out.steps = [sent, step('wait', 'fa-circle-question', 'Copy missing'), noRead, noReply];
    out.grid = [{ k: 'Why', v: 'Only the sender’s copy is left. The recipient’s inbox no longer holds this message — deleted for good, or the inbox was removed.' }];
    return out;
  }

  const delivered = step('ok', 'fa-inbox', 'Delivered', f.sentAt || '');
  const readStep = step('ok', 'fa-eye', 'Read', f.readAt || '');
  const openInbox = f.inboxOwnerId ? { action: 'openMsgInInbox', label: `Open ${to}’s inbox`, icon: 'fa-inbox', quiet: true, data: { 'inbox-owner': f.inboxOwnerId, 'message-id': f.messageId } } : null;

  // ── Answered ──
  if (f.reply || f.answered) {
    out.icon = 'fa-reply'; out.pips = ['on', 'on', 'on', 'on'];
    if (f.reply) {
      out.line = `${b('Answered')} — ${h(to)} ${f.readAt ? `read it at ${h(f.readAt)} and ` : ''}replied${f.reply.at ? ` at ${h(f.reply.at)}` : ''}.`;
      out.steps = [sent, delivered, readStep, step('ok', 'fa-reply', 'Replied', f.reply.at || '')];
      if (f.reply.snippet) out.grid.push({ k: 'Their answer', v: `“${h(f.reply.snippet)}”` });
      if (f.reply.owner && f.reply.id) out.fixes.push({ action: 'openMsgInInbox', label: 'Open their answer', icon: 'fa-reply', quiet: true, data: { 'inbox-owner': f.reply.owner, 'message-id': f.reply.id } });
    } else {
      out.line = `${b('Answered')} — you marked it answered.`;
      out.steps = [sent, delivered, f.read ? readStep : noRead, step('ok', 'fa-check', 'Marked answered')];
    }
    return out;
  }

  // ── Deleted by the recipient ──
  if (f.deleted) {
    out.icon = 'fa-trash';
    out.tone = f.read ? 'good' : 'wait';
    out.pips = ['on', 'on', f.read ? 'on' : 'wait', ''];
    out.line = f.read ? `${b('Deleted')} — ${h(to)} read it${f.readAt ? ` at ${h(f.readAt)}` : ''}, then deleted it.` : `${b('Deleted unread')} — ${h(to)} threw it away without opening it.`;
    out.steps = [sent, delivered, f.read ? readStep : step('wait', 'fa-eye-slash', 'Not opened'), step('no', 'fa-trash', 'Deleted')];
    return out;
  }

  // ── Read ──
  if (f.read) {
    out.icon = 'fa-eye'; out.pips = ['on', 'on', 'on', ''];
    out.line = `${b('Read')} — ${h(to)} opened it${f.readAt ? ` at ${h(f.readAt)}` : ''}. No reply yet.`;
    out.steps = [sent, delivered, readStep, noReply];
    return out;
  }

  // ── Delivered to an NPC: nobody reads it but the GM ──
  if (!f.toIsPlayer) {
    out.icon = 'fa-inbox'; out.pips = ['on', 'on', '', ''];
    out.line = `${b('Delivered')} — it’s in ${h(to)}’s inbox for you.`;
    out.steps = [sent, delivered, noRead, noReply];
    out.grid = [{ k: 'Unread', v: `${b(to)} is an NPC — nobody reads it but you.` }];
    if (openInbox) out.fixes.push({ ...openInbox, quiet: false });
    return out;
  }

  // ── Delivered to a player, not read ──
  out.tone = 'wait'; out.icon = 'fa-eye-slash'; out.pips = ['on', 'on', 'wait', ''];
  const who = f.playerName ? `Their player (${h(f.playerName)}) is ${f.playerOnline ? 'online' : 'offline'}.` : 'No player has them as their character.';
  out.line = f.nudged ? `${b('Not read yet')} — you nudged ${h(to)}.` : `${b('Not read yet')} — it’s in ${h(to)}’s inbox. ${who}`;
  out.steps = [sent, delivered, step('wait', 'fa-eye-slash', 'Not opened'), noReply];
  out.grid = [
    { k: `${to} will see`, screen: { tone: '', mark: '▸', text: `${f.fromName || 'Someone'} — ${f.subject || '(no subject)'}  ${f.sentAt || ''}`, tail: '● new' } },
    { k: 'By itself', v: `It waits, unread, until ${h(to)} opens their Agent.` },
  ];
  if (f.toActorId && !f.nudged) out.fixes.push({ op: 'dlNudge', label: f.playerOnline ? 'Nudge them now' : 'Nudge them when they log in', icon: 'fa-bell', data: { id: f.messageId, actor: f.toActorId } });
  if (openInbox) out.fixes.push(openInbox);
  return out;
}

/** Recipient state → [class, icon, word]. */
export const DL_RCP_STATE = {
  ans: ['ans', 'fa-reply', 'answered'], read: ['read', 'fa-eye', 'read'], got: ['got', 'fa-inbox', 'delivered'],
  held: ['held', 'fa-hourglass-half', 'waiting'], fail: ['fail', 'fa-ban', 'not delivered'], gone: ['got', 'fa-trash', 'deleted unread'],
};
/** The square each state paints in the line (answered counts as read). */
const SQ = { ans: 'read', read: 'read', got: 'got', held: 'held', fail: 'fail', gone: 'got' };

/**
 * A fan-out: one row per recipient.
 * @param {object} f
 *   rcp: [{ name, addr, state: ans|read|got|held|fail|gone, time, why (html), fix, toIsPlayer, actorId }]
 *   alias {of} | null, fromName, held (the whole send is held on the sender's Agent), messageId
 */
export function groupDeliveryLine(f = {}) {
  const rcp = (f.rcp || []).map((r) => {
    const [cls, icon, word] = DL_RCP_STATE[r.state] || DL_RCP_STATE.got;
    return { ...r, cls, icon, word, sq: SQ[r.state] || 'got', why: r.why || '', tip: `${r.name}: ${word}` };
  });
  const c = { read: 0, got: 0, held: 0, fail: 0 };
  for (const r of rcp) c[r.sq]++;
  const parts = [`Sent to <b class="is-n">${rcp.length}</b>`];
  if (c.read) parts.push(`<b class="is-good">${c.read} read</b>`);
  if (c.got) parts.push(`${c.got} delivered`);
  if (c.held) parts.push(`<b class="is-wait">${c.held} waiting</b>`);
  if (c.fail) parts.push(`<b class="is-bad">${c.fail} not delivered</b>`);
  const unreadPlayers = rcp.filter((r) => r.state === 'got' && r.toIsPlayer && r.actorId && !r.nudged);
  const foot = {
    text: f.alias
      ? `Sent as <b class="is-secret">${h(f.fromName)}</b> — they see the alias, not ${h(f.alias.of)}.`
      : 'Sent as one message — each person got their own copy.',
    fixes: [],
  };
  if (f.held) foot.fixes.push({ op: 'dlDeliver', label: 'Deliver it now', icon: 'fa-paper-plane', data: { id: f.messageId } });
  if (unreadPlayers.length) foot.fixes.push({ op: 'dlNudgeAll', label: 'Nudge everyone who hasn’t read it', icon: 'fa-bell', quiet: true, data: { id: f.messageId } });
  return {
    tone: c.fail ? 'bad' : c.held ? 'wait' : 'good', group: true, rcp, foot, counts: c,
    icon: c.fail ? 'fa-triangle-exclamation' : c.held ? 'fa-hourglass-half' : 'fa-users',
    line: parts.join(' · '),
  };
}

// ─── All mail → grouping by period (Day / Week / Month) ──────
//
// The list can be grouped by day (the default), week (Monday start, UTC) or month.
// Each group carries a stable key (period + start), so a folded group stays folded
// across re-renders and when "Load more" adds rows to it. Keeps the incoming order,
// so Newest / Oldest is decided by the caller.

export const MAIL_PERIODS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function weekStart(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;            // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
function monthStart(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** {key, label} of the period holding ms, relative to now. */
export function periodOf(ms, nowMs, period = 'day', fmt = (x) => dayKeyOf(x)) {
  if (!ms) return { key: `${period}:none`, label: 'Undated' };
  if (period === 'week') {
    const s = weekStart(ms), now = weekStart(nowMs);
    const label = s === now ? 'This week' : s === now - 7 * 86400000 ? 'Last week' : `Week of ${fmt(s)}`;
    return { key: `week:${s}`, label };
  }
  if (period === 'month') {
    const s = monthStart(ms), now = monthStart(nowMs);
    const d = new Date(s);
    const label = s === now ? 'This month' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    return { key: `month:${s}`, label };
  }
  return { key: `day:${dayKeyOf(ms)}`, label: dayLabel(ms, nowMs, fmt) };
}

/** Split an already-ordered list into period groups: {key, label, rows, count, unread}. */
export function groupByPeriod(entries, nowMs, period = 'day', fmt) {
  const out = [];
  let cur = null;
  for (const e of entries) {
    const p = periodOf(e.rawTimestamp, nowMs, period, fmt);
    if (!cur || cur.key !== p.key) { cur = { ...p, rows: [] }; out.push(cur); }
    cur.rows.push(e);
  }
  return out.map((g) => ({ ...g, count: g.rows.length, unread: g.rows.filter((r) => r.unread).length, failed: g.rows.filter((r) => r.isPending && !r.held).length }));
}

// ─── All mail → the CALENDAR NAVIGATOR (2026-10-28, version A of ──────────
//     dev/mockups/admin-mail-navigator-mock.html)
//
// The left column is a calendar you navigate INTO: YEAR (12 month tiles) → MONTH
// (a cell per day, the month's mail under it) → WEEK (a 7-day strip + the week's
// mail) → DAY (the strip + the day's mail by morning / afternoon / evening).
// Every count is an AGGREGATE from ONE pass over the already-filtered rows
// (calendarCounts), never a mark per message, so 10,000 messages cost one loop.
// Everything is on the UTC day grid of the GAME clock; weeks start on Monday.

const DAY_MS = 86400000;
export const CAL_LEVELS = ['year', 'month', 'week', 'day'];
export const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = MONTHS;

/** UTC day start (ms) of a timestamp. */
export const dayStart = (ms) => Math.floor(ms / DAY_MS) * DAY_MS;
/** Monday-start week (ms) holding a timestamp. */
export const weekStartOf = (ms) => weekStart(ms);
/** Monday = 0 … Sunday = 6 of a timestamp. */
export const dow = (ms) => (new Date(ms).getUTCDay() + 6) % 7;
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
/** ISO week number of a timestamp (the week holding Jan 4 is week 1). */
export function isoWeek(ms) {
  const thu = weekStart(ms) + 3 * DAY_MS;                       // the Thursday decides the year
  const y = new Date(thu).getUTCFullYear();
  const wk1 = weekStart(Date.UTC(y, 0, 4));
  return Math.round((weekStart(ms) - wk1) / (7 * DAY_MS)) + 1;
}
/** The month a week belongs to (the one holding its Thursday). */
export function weekMonthOf(wkStart) {
  const d = new Date(wkStart + 3 * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/**
 * ONE pass over the rows → aggregate counts per year / month / week / day.
 * Each bucket is {n, unread, failed} (failed = not delivered, held mail is not failed).
 * Keys: years by year, months by `${year}-${month}`, weeks by their Monday (ms),
 * days by their UTC day start (ms). Undated rows (no timestamp) are counted in `undated`.
 */
export function calendarCounts(rows = []) {
  const years = new Map(), months = new Map(), weeks = new Map(), days = new Map();
  const bump = (map, key, r) => {
    let b = map.get(key);
    if (!b) { b = { n: 0, unread: 0, failed: 0 }; map.set(key, b); }
    b.n++;
    if (r.unread) b.unread++;
    if (r.isPending && !r.held) b.failed++;
  };
  let undated = 0;
  for (const r of rows) {
    const ms = r.rawTimestamp || 0;
    if (!ms) { undated++; continue; }
    const d = new Date(ms);
    bump(years, d.getUTCFullYear(), r);
    bump(months, `${d.getUTCFullYear()}-${d.getUTCMonth()}`, r);
    bump(weeks, weekStart(ms), r);
    bump(days, dayStart(ms), r);
  }
  return { years, months, weeks, days, undated, total: rows.length };
}

const ZERO = { n: 0, unread: 0, failed: 0 };
const at = (map, key) => map.get(key) || ZERO;

/** The Monday-start weeks overlapping a month, in order: [{start, end, iso, days:[ms…]}]. */
export function monthWeeks(year, month) {
  const first = Date.UTC(year, month, 1), last = Date.UTC(year, month, daysInMonth(year, month));
  const out = [];
  for (let s = weekStart(first); s <= last; s += 7 * DAY_MS) {
    out.push({ start: s, end: s + 6 * DAY_MS, iso: isoWeek(s), days: Array.from({ length: 7 }, (_, i) => s + i * DAY_MS) });
  }
  return out;
}

/**
 * YEAR level: twelve tiles. Bars = one per week overlapping the month, scaled to the
 * year's busiest week (`h` 1..14 px), amber (`hot`) where that week holds unread mail.
 * @returns {{ tiles, year: {n, unread, failed}, prev: {year, n}, next: {year, n} }}
 */
export function yearTiles(counts, year, nowMs = 0) {
  const now = new Date(nowMs || 0);
  let maxWeek = 1;
  for (let m = 0; m < 12; m++) for (const w of monthWeeks(year, m)) maxWeek = Math.max(maxWeek, at(counts.weeks, w.start).n);
  const tiles = [];
  for (let m = 0; m < 12; m++) {
    const c = at(counts.months, `${year}-${m}`);
    const bars = monthWeeks(year, m).map((w) => { const wc = at(counts.weeks, w.start); return { h: wc.n ? Math.max(1, Math.round((wc.n / maxWeek) * 14)) : 0, hot: wc.unread > 0 }; });
    tiles.push({ month: m, label: MONTHS_SHORT[m], n: c.n, unread: c.unread, failed: c.failed, empty: !c.n, now: now.getUTCFullYear() === year && now.getUTCMonth() === m, bars });
  }
  return { tiles, year: at(counts.years, year), prev: { year: year - 1, n: at(counts.years, year - 1).n }, next: { year: year + 1, n: at(counts.years, year + 1).n } };
}

/**
 * MONTH level: a cell per day (leading blanks so the grid starts on Monday), tinted by
 * volume (`v` 0..28, against the month's busiest day), plus the week buttons.
 */
export function monthCells(counts, year, month, nowMs = 0, { selDay = null } = {}) {
  const dim = daysInMonth(year, month);
  const first = Date.UTC(year, month, 1);
  let max = 1;
  for (let d = 0; d < dim; d++) max = Math.max(max, at(counts.days, first + d * DAY_MS).n);
  const today = dayStart(nowMs || 0);
  const cells = Array.from({ length: dow(first) }, () => ({ out: true }));
  for (let d = 0; d < dim; d++) {
    const ms = first + d * DAY_MS;
    const c = at(counts.days, ms);
    cells.push({ ms, day: d + 1, n: c.n, unread: c.unread, failed: c.failed, empty: !c.n, v: c.n ? Math.max(6, Math.round((c.n / max) * 28)) : 0, today: ms === today, sel: ms === selDay });
  }
  const weeks = monthWeeks(year, month).map((w) => { const c = at(counts.weeks, w.start); return { start: w.start, iso: w.iso, label: `WK ${w.iso}`, n: c.n, unread: c.unread }; });
  const c = at(counts.months, `${year}-${month}`);
  const pm = month === 0 ? [year - 1, 11] : [year, month - 1], nm = month === 11 ? [year + 1, 0] : [year, month + 1];
  return { cells, weeks, month: c, prev: { year: pm[0], month: pm[1], n: at(counts.months, `${pm[0]}-${pm[1]}`).n }, next: { year: nm[0], month: nm[1], n: at(counts.months, `${nm[0]}-${nm[1]}`).n } };
}

/** WEEK / DAY level: the seven days of a Monday-start week as strip cells. */
export function weekStrip(counts, wkStart, nowMs = 0, { selDay = null } = {}) {
  const today = dayStart(nowMs || 0);
  let max = 1;
  for (let i = 0; i < 7; i++) max = Math.max(max, at(counts.days, wkStart + i * DAY_MS).n);
  return Array.from({ length: 7 }, (_, i) => {
    const ms = wkStart + i * DAY_MS, c = at(counts.days, ms), d = new Date(ms);
    return { ms, day: d.getUTCDate(), wd: WEEKDAYS_SHORT[i], n: c.n, unread: c.unread, failed: c.failed, empty: !c.n, v: c.n ? Math.max(6, Math.round((c.n / max) * 28)) : 0, today: ms === today, sel: ms === selDay };
  });
}

/** The [from, to) range of a level's state. */
export function calRange(s) {
  if (s.level === 'year') return { from: Date.UTC(s.year, 0, 1), to: Date.UTC(s.year + 1, 0, 1) };
  if (s.level === 'month') return { from: Date.UTC(s.year, s.month, 1), to: Date.UTC(s.year, s.month + 1, 1) };
  if (s.level === 'week') return { from: s.week, to: s.week + 7 * DAY_MS };
  return { from: s.day, to: s.day + DAY_MS };
}
export const inRange = (ms, r) => ms >= r.from && ms < r.to;

/** The state for a timestamp at a level (a day carries its week and month, a week its month). */
export function calStateFor(level, ms) {
  const d = new Date(ms);
  const s = { level, year: d.getUTCFullYear(), month: d.getUTCMonth(), week: weekStart(ms), day: dayStart(ms) };
  if (level === 'week') { const m = weekMonthOf(s.week); s.year = m.year; s.month = m.month; }
  return s;
}

/** ‹ › : the sibling at the current level (dir −1 / +1). */
export function calStep(s, dir) {
  if (s.level === 'year') return { ...s, year: s.year + dir };
  if (s.level === 'month') { const t = Date.UTC(s.year, s.month + dir, 1); return calStateFor('month', t); }
  if (s.level === 'week') return calStateFor('week', s.week + dir * 7 * DAY_MS);
  const n = calStateFor('day', s.day + dir * DAY_MS);
  return { ...n, viaWeek: s.viaWeek };
}

/** Esc / Backspace: one level up. A day opened from a week goes back to the week. */
export function calUp(s) {
  if (s.level === 'day') return s.viaWeek ? { ...s, level: 'week' } : { ...s, level: 'month', viaWeek: false };
  if (s.level === 'week') return { ...s, level: 'month', viaWeek: false };
  if (s.level === 'month') return { ...s, level: 'year' };
  return s;
}

/** The breadcrumb: [{level, label, here}] — every crumb but the last walks back. */
export function calCrumbs(s) {
  const out = [{ level: 'year', label: String(s.year) }];
  if (s.level !== 'year') out.push({ level: 'month', label: MONTHS_LONG[s.month] });
  if (s.level === 'week' || (s.level === 'day' && s.viaWeek)) out.push({ level: 'week', label: `Week ${isoWeek(s.week)}` });
  if (s.level === 'day') { const d = new Date(s.day); out.push({ level: 'day', label: `${WEEKDAYS_SHORT[dow(s.day)]} ${d.getUTCDate()}` }); }
  out[out.length - 1].here = true;
  return out;
}

/** The hour band of a day's mail: morning (to 12) · afternoon (to 18) · evening. */
export const DAY_BANDS = [['morning', 0, 12], ['afternoon', 12, 18], ['evening', 18, 24]];
export function daySplit(rows = []) {
  const out = DAY_BANDS.map(([key, from, to]) => ({ key, label: key, from, to, rows: [] }));
  for (const r of rows) {
    const h = r.rawTimestamp ? new Date(r.rawTimestamp).getUTCHours() : 0;
    (out.find((b) => h >= b.from && h < b.to) || out[0]).rows.push(r);
  }
  return out.filter((b) => b.rows.length);
}

/** The newest-first order says evening sits on top; oldest-first the reverse. */
export const orderBands = (bands, oldest = false) => (oldest ? bands : [...bands].reverse());

/** Where a navigator should land for a timestamp when nothing is picked yet. */
export const calHome = (nowMs) => calStateFor('year', nowMs || 0);

// ─── The default-fold rule (dev-approved 2026-10-28) ─────────
//
// First group open, the rest closed; a closed group still shows its count plus
// anything that needs you; the group holding the selection is forced open; a search
// or a non-default filter opens everything; the GM's own fold/unfold wins for the
// session. `shut` / `open` are the GM's explicit choices (Sets of keys).

/** Is this group folded? */
export function foldShut(key, { defaultOpen = false, shut, open, forced = false, holds = false } = {}) {
  if (forced || holds) return false;
  if (shut?.has(key)) return true;
  if (open?.has(key)) return false;
  return !defaultOpen;
}

/** All mail: the key of the most recent period (whichever end of the list it sits at). */
export function newestPeriodKey(groups) {
  let best = null, bestTs = -Infinity;
  for (const g of groups || []) {
    const ts = Math.max(-Infinity, ...g.rows.map((r) => r.rawTimestamp || 0));
    if (ts > bestTs) { bestTs = ts; best = g.key; }
  }
  return best;
}

/** Inboxes: only the players' group starts open. */
export const inboxGroupDefaultOpen = (key) => key === 'pc';

/** Record one fold choice: the key moves to `shut` or `open`, never both. */
export function recordFold(key, isShut, shut, open) {
  if (isShut) { shut.add(key); open.delete(key); } else { shut.delete(key); open.add(key); }
}

// ─── Messages → Inboxes: view chips, grouping, sorting ───────
//
// Rows are plain facts ({name, isPlayer, orphan, noInbox, total, unread, lastTs,
// role, roleLabel, org, busy, quietDays, oldestUnreadTs}). A view narrows, a group-by
// splits the NPCs into groups (players always keep their own group, orphans always
// sit last), a sort orders inside each group. The list (2026-10-29, list + desk) prints
// the number the current sort is using under every mailbox (`slotMetric`), so the order
// always explains itself.

/** A mailbox counts as quiet when its newest mail is this old (game time). */
export const QUIET_DAYS = 7;
/** "Busiest" counts mail in this many game days. */
export const BUSY_DAYS = 14;

export const INBOX_VIEWS = [['all', 'Everyone'], ['unread', 'Has unread'], ['quiet', `Gone quiet (${QUIET_DAYS}d+)`], ['empty', 'Empty'], ['bad', 'Owner gone']];
export const INBOX_GROUPS = [['kind', 'Kind'], ['role', 'Role'], ['org', 'Organization']];
/** [key, label, what it means] — the menu prints the third so a sort says what it does. */
export const INBOX_SORTS = [
  ['recent', 'Latest mail', 'whoever got mail most recently first'],
  ['unread', 'Most unread', 'the most unread first; a tie goes to whoever has waited longest'],
  ['busy', 'Busiest', `the most mail in the last ${BUSY_DAYS} days first`],
  ['quiet', 'Quietest', 'longest since any mail first — find the NPCs nobody writes to'],
  ['name', 'A–Z', 'by name'],
];

export function inboxPasses(view, r) {
  switch (view) {
    case 'pc': return r.isPlayer && !r.orphan;
    case 'npc': return !r.isPlayer && !r.orphan;
    case 'unread': return r.unread > 0;
    case 'quiet': return !r.orphan && r.total > 0 && (r.quietDays || 0) >= QUIET_DAYS;
    case 'empty': return !r.total;
    case 'bad': return !!r.orphan;
    default: return true;
  }
}

export function inboxViewCounts(rows) {
  const keys = new Set([...INBOX_VIEWS.map(([k]) => k), 'pc', 'npc']);
  return Object.fromEntries([...keys].map((k) => [k, rows.filter(r => inboxPasses(k, r)).length]));
}

export function sortInboxes(rows, sort = 'recent') {
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const byLatest = (a, b) => (b.lastTs || 0) - (a.lastTs || 0);
  let cmp;
  switch (sort) {
    case 'recent': cmp = (a, b) => byLatest(a, b) || byName(a, b); break;
    case 'unread': cmp = (a, b) => (b.unread || 0) - (a.unread || 0) || (a.oldestUnreadTs || Infinity) - (b.oldestUnreadTs || Infinity) || byLatest(a, b) || byName(a, b); break;
    case 'busy': cmp = (a, b) => (b.busy || 0) - (a.busy || 0) || byLatest(a, b) || byName(a, b); break;
    // Quietest: the longest silence first; a mailbox that never had mail has no silence to measure and goes last.
    case 'quiet': cmp = (a, b) => (!a.lastTs) - (!b.lastTs) || (a.lastTs || 0) - (b.lastTs || 0) || byName(a, b); break;
    default: cmp = byName;
  }
  return [...rows].sort(cmp);
}

/** → [{key, label, kind, rows, count, unread}] */
export function groupInboxes(rows, { by = 'kind', sort = 'recent' } = {}) {
  const out = [];
  const push = (key, label, kind, list) => { if (list.length) out.push({ key, label, kind, rows: sortInboxes(list, sort), count: list.length, unread: list.reduce((n, r) => n + (r.unread || 0), 0) }); };
  const live = rows.filter(r => !r.orphan);
  push('pc', 'Players’ characters', 'pc', live.filter(r => r.isPlayer));
  const npcs = live.filter(r => !r.isPlayer);
  if (by === 'role' || by === 'org') {
    const keyOf = (r) => (by === 'role' ? (r.role || '') : String(r.org || '').trim());
    const labelOf = (r) => (by === 'role' ? (r.roleLabel || r.role) : String(r.org || '').trim());
    const keys = [...new Set(npcs.map(keyOf))].sort((a, b) => (!a) - (!b) || a.localeCompare(b));
    for (const k of keys) {
      const list = npcs.filter(r => keyOf(r) === k);
      push(`${by}:${k}`, k ? labelOf(list[0]) : (by === 'role' ? 'No role' : 'No organization'), 'npc', list);
    }
  } else {
    push('npc', 'NPCs & their aliases', 'npc', npcs);
  }
  push('bad', 'Owner gone', 'bad', rows.filter(r => r.orphan));
  return out;
}

/**
 * The line under a mailbox: the number the current sort is ordering by, in words.
 * `age(ts)` formats "2h" / "3d" on the game clock.
 */
export function slotMetric(r, sort, age = (ts) => String(ts)) {
  if (r.orphan) return 'its owner was deleted';
  if (r.noInbox) return 'no inbox yet';
  if (!r.total) return 'empty';
  switch (sort) {
    case 'unread': return r.unread ? `${r.unread} unread · waiting ${age(r.oldestUnreadTs)}` : 'nothing unread';
    case 'busy': return `${r.busy || 0} in ${BUSY_DAYS} days`;
    case 'quiet': return `quiet ${age(r.lastTs)}`;
    case 'name': return `${r.total} mail`;
    default: return `last mail ${age(r.lastTs)} ago`;
  }
}

/** A postmark's short code from a network's name: "CitiNet" → CTN, "Arasaka CorpNet" → ACN, "NCPD" → NCP. */
export function postmarkCode(name = '') {
  const parts = String(name).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!parts.length) return '???';
  let code = parts.map(p => p[0]).join('').slice(0, 3);
  if (code.length < 3) {
    const extra = parts[0].slice(1).replace(/[aeiou]/gi, '') || parts[0].slice(1);
    code = code[0] + extra.slice(0, 3 - code.length) + code.slice(1);
  }
  return code.slice(0, 3).toUpperCase();
}

/** The last `days` game days as bars, oldest first: [{n, unread}]. */
export function inboxTraffic(msgs = [], nowMs = Date.now(), days = BUSY_DAYS) {
  const DAY = 86400000;
  const out = Array.from({ length: days }, () => ({ n: 0, unread: 0 }));
  for (const m of msgs) {
    if (!m._ts) continue;
    const back = Math.floor((nowMs - m._ts) / DAY);
    if (back < 0 || back >= days) continue;
    const b = out[days - 1 - back];
    b.n++; if (!m.isSent && !m.read) b.unread++;
  }
  return out;
}

// ─── All mail → "Where it went" (the journey, mock dev/mockups/admin-guides-mock.html slot "j") ──
//
// The delivery line's steps drawn as stops on one track, with the network the message
// went out on as its own stop when it got that far. A group gets one row of segments
// per person (Sent · Delivered · Read · Replied).

const JR_STATE = { ok: 'done', wait: 'wait', bad: 'bad', no: 'todo' };

/** steps (from deliveryLine) + {netName, netSignal} → [{st, icon, label, sub}] */
export function journeyTrack(steps = [], net = {}) {
  const stops = steps.map((s) => ({ st: JR_STATE[s.cls] || 'todo', icon: s.icon, label: s.label, subline: s.time || '' }));
  const second = steps[1]?.cls;
  if (net.netName && stops.length && (second === 'ok' || second === 'bad')) {
    stops.splice(1, 0, { st: 'done', icon: 'fa-wifi', label: net.netName, subline: net.netSignal ? net.netSignal.replace(/^signal\s*/, '') + ' signal' : '' });
  }
  return stops;
}

const SEG_ICON = { done: 'fa-check', wait: 'fa-hourglass-half', bad: 'fa-xmark', todo: 'fa-minus' };
const SEGS = {
  ans: ['done', 'done', 'done', 'done'], read: ['done', 'done', 'done', 'todo'], got: ['done', 'done', 'todo', 'todo'],
  held: ['done', 'wait', 'todo', 'todo'], fail: ['done', 'bad', 'todo', 'todo'], gone: ['done', 'done', 'todo', 'todo'],
};
/** A recipient's state → four segments [{s, icon}] for Sent · Delivered · Read · Replied. */
export function journeySegs(state) {
  return (SEGS[state] || SEGS.got).map((s) => ({ s, icon: SEG_ICON[s] }));
}

// A group of any size: problems first, a bucket per person for the filter chips, and the
// counts the summary bar draws. Past BIG_GROUP people the view leads with the summary and
// opens on the problems (or everyone, when nothing is wrong).
export const BIG_GROUP = 8;
export const SEARCH_GROUP = 12;
const SEVERITY = { fail: 0, held: 1, got: 2, gone: 2, read: 3, ans: 4 };
const BUCKET = { fail: 'problem', held: 'problem', got: 'unread', gone: 'unread', read: 'read', ans: 'read' };

export function journeyPeople(rcp = []) {
  const people = rcp.map((r, i) => ({ ...r, bucket: BUCKET[r.state] || 'unread', _i: i }))
    .sort((a, b) => (SEVERITY[a.state] ?? 2) - (SEVERITY[b.state] ?? 2) || a._i - b._i);
  const n = { problem: 0, unread: 0, read: 0 };
  for (const p of people) n[p.bucket]++;
  const total = people.length;
  const big = total > BIG_GROUP;
  const pct = (k) => (total ? Math.round((n[k] / total) * 1000) / 10 : 0);
  return {
    people, total, big, searchable: total > SEARCH_GROUP,
    counts: n,
    bar: [['problem', 'bad'], ['unread', 'wait'], ['read', 'good']].filter(([k]) => n[k]).map(([k, tone]) => ({ k, tone, n: n[k], pct: pct(k) })),
    chips: [['problem', 'Problems'], ['unread', 'Not read'], ['read', 'Read'], ['all', 'Everyone']]
      .map(([k, label]) => ({ k, label, n: k === 'all' ? total : n[k] })).filter((c) => c.k === 'all' || c.n),
    defaultFilter: big && n.problem ? 'problem' : 'all',
  };
}

/** One word for a folded journey: where the message stands. */
export function journeyStatus(track = []) {
  const stuck = track.find((s) => s.st === 'wait' || s.st === 'bad');
  if (stuck) return { tone: stuck.st === 'bad' ? 'bad' : 'wait', word: stuck.label };
  const done = [...track].reverse().find((s) => s.st === 'done');
  return { tone: 'good', word: done ? done.label : '' };
}

// ─── Needs a reply: THE DESK (dev/mockups/admin-needs-reply-rethink-mock.html, Version B, 2026-10-28) ───
//
// A queue of conversations on the left (one per NPC × the alias written to), the
// conversation as a chat thread in the middle, and the persona of the identity
// being answered as on the right. The rules below are pure; MessagesTab gathers.

/** The queue's filter chips: [key, label]. */
export const DESK_FILTERS = [['all', 'All lines'], ['waiting', 'Waiting'], ['answered', 'Answered']];

/** A wait is "hot" (red) once the oldest unanswered message is this old. */
export const DESK_HOT_MS = 24 * 3600000;

/** Which queue rows a filter chip shows. Rows: { waiting: <count> }. */
export function deskPasses(row, filter) {
  if (filter === 'waiting') return (row.waiting || 0) > 0;
  if (filter === 'answered') return !(row.waiting || 0);
  return true;
}

/**
 * The wait meter under a queue row: how far along the day the oldest unanswered
 * message is. `pct` 0..100 (full at DESK_HOT_MS), `hot` past it, `age` in ms.
 */
export function waitMeter(oldestWaitTs, nowMs) {
  if (!oldestWaitTs || !nowMs) return { pct: 0, hot: false, age: 0 };
  const age = Math.max(0, nowMs - oldestWaitTs);
  return { pct: Math.min(100, Math.round((age / DESK_HOT_MS) * 100)), hot: age >= DESK_HOT_MS, age };
}

/**
 * Order the queue. Each row: { key, waiting, oldestWaitTs, newestWaitTs, latestTs, name }.
 * Waiting rows first, the one who has waited LONGEST on top (the mock's "oldest
 * first"); answered rows below, most recent first. Returns new objects carrying
 * `meter` (waitMeter), `done` (answered) and `sel`.
 */
export function deskQueue(rows = [], { filter = 'all', selKey = null, nowMs = 0 } = {}) {
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  const shown = rows.filter((r) => deskPasses(r, filter));
  const waiting = shown.filter((r) => (r.waiting || 0) > 0)
    .sort((a, b) => (a.oldestWaitTs || 0) - (b.oldestWaitTs || 0) || byName(a, b))
    .map((r) => ({ ...r, done: false, sel: r.key === selKey, meter: waitMeter(r.oldestWaitTs, nowMs) }));
  const answered = shown.filter((r) => !(r.waiting || 0))
    .sort((a, b) => (b.latestTs || 0) - (a.latestTs || 0) || byName(a, b))
    .map((r) => ({ ...r, done: true, sel: r.key === selKey, meter: { pct: 100, hot: false, age: 0 } }));
  const counts = { all: rows.length, waiting: rows.filter((r) => (r.waiting || 0) > 0).length, answered: rows.filter((r) => !(r.waiting || 0)).length };
  return { waiting, answered, counts, shown: waiting.length + answered.length, selShown: [...waiting, ...answered].some((r) => r.sel) };
}

/** The queue row the desk opens on when nothing is picked: the longest wait, else the most recent answered. */
export function deskDefaultKey(queue) {
  return queue?.waiting?.[0]?.key || queue?.answered?.[0]?.key || null;
}

/**
 * The thread: messages oldest first with a day separator whenever the UTC day
 * changes. Each item: { ts, ... }. `labelDay(ts)` names a day (default ISO date).
 * Returns [{ kind:'day', label, dayKey } | { kind:'msg', ...item }].
 */
export function deskThread(items = [], { labelDay = null } = {}) {
  const DAY = 86400000;
  const sorted = [...items].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const out = [];
  let lastDay = null;
  for (const it of sorted) {
    const dayKey = Math.floor((it.ts || 0) / DAY);
    if (dayKey !== lastDay) {
      out.push({ kind: 'day', dayKey, label: labelDay ? labelDay(it.ts || 0) : new Date(dayKey * DAY).toISOString().slice(0, 10) });
      lastDay = dayKey;
    }
    out.push({ kind: 'msg', ...it });
  }
  return out;
}

/**
 * Reply-as order: the identity the mail reached first, then the rest in their
 * given order (main first). `firstId` absent / unknown leaves the order alone.
 */
export function identityOrder(items = [], firstId = null) {
  const i = firstId ? items.findIndex((x) => x.id === firstId) : -1;
  if (i <= 0) return [...items];
  return [items[i], ...items.slice(0, i), ...items.slice(i + 1)];
}

/**
 * The persona card's voice line from identities.voiceInfo(): the text, a "from
 * <main>" note when inherited, and `empty` when there is nothing to read.
 */
export function deskVoice(info) {
  const text = String(info?.text || '').trim();
  if (!text) return { text: '', note: '', empty: true, inherited: false };
  return { text, note: info?.inherited ? `from ${info?.from?.name || 'their main identity'}` : '', empty: false, inherited: !!info?.inherited };
}

/** "Sent as X to Y" — the line the compose box shows once an inline reply went out. */
export function deskSentLine(sent) {
  if (!sent?.as) return '';
  return `Sent as ${sent.as}${sent.to ? ` to ${sent.to}` : ''}.`;
}
