/**
 * Conversations: the service.
 * @file scripts/services/ConversationService.js
 * @module night-city-messenger
 * @description Design and gap tracker: dev/design/CONVERSATIONS.md. Every write goes through the active GM, one at a time (a player
 *   relays with SOCKET_OPS.CONVERSATION_REQUEST and waits for the answer). With no GM online or in a dead zone a player's lines wait in
 *   this browser, saved, and go when they can. It leans on the rest of the module as little as it can: names and pictures through the
 *   directory, and one call out to the network for taps.
 */

import { MODULE_ID, SOCKET_OPS, EVENTS } from '../utils/constants.js';
import { log, isGM, formatCyberDate } from '../utils/helpers.js';
import { identitiesOf, identityRole, groupKeyOf, identitiesOfKey, identitiesOfContact, identityInboxId } from '../utils/identities.js';
import {
  PAGE_LINES, lineText, titleText, safeImage, sanitizeCard, memberKeyOf, sanitizeMember, isIn, canSee, openSpan, closeSpan,
  visibleLines, sortLines, nextStarter, unreadFor, previewOf, titleFor, makeLine, goneLine, waitingOn, notifyPlan, tapLogLine, appendTapLog,
} from '../utils/conversations.js';

import { serializeMethods } from '../utils/serialize.js';

const FOLDER = 'Conversations';
const REPLY_MS = 8000;

export class ConversationService {
  constructor() {
    this._queue = Promise.resolve();
    this._waiting = new Map();   // reqId → resolve
    this._pending = new Map();   // conversation id → lines being sent or held, oldest first
    this._openIds = new Set();   // conversations on screen right now, for notifications
    this._notes = new Map();     // conversation id → { n, heard }
    this._reads = new Map();     // what was read, not yet written
  }

  get socket() { return game.nightcity?.socketManager; }
  get enabled() { try { return !!game.settings.get(MODULE_ID, 'conversationsEnabled'); } catch { return false; } }
  get directory() { return game.nightcity?.masterContactService?.getAll?.() || []; }
  get _now() { try { return game.nightcity?.timeService?.getCurrentTime?.() || new Date().toISOString(); } catch { return new Date().toISOString(); } }
  get _iAmWriter() { return isGM() && game.users?.activeGM?.id === game.user.id; }

  // ─── reading ───

  _isConv(j) { return j?.getFlag?.(MODULE_ID, 'type') === 'conversation'; }
  _journals() { return (game.journal?.contents || [...(game.journal || [])]).filter((j) => this._isConv(j)); }
  _journal(id) { return this._journals().find((j) => j.getFlag(MODULE_ID, 'conversationId') === id) || null; }

  _view(j) {
    const f = j.flags?.[MODULE_ID] || {};
    return { id: f.conversationId, journalId: j.id, title: f.title || '', starterKey: f.starterKey || '', createdAt: f.createdAt || '', lastSeq: Number(f.lastSeq) || 0, lastAt: f.lastAt || f.createdAt || '', lastPreview: f.lastPreview || null, members: (f.members || []).map(sanitizeMember) };
  }

  all() { return this._journals().map((j) => this._view(j)); }
  get(id) { const j = this._journal(id); return j ? this._view(j) : null; }

  /** Every line, oldest first, or only from the newest `pages` pages. */
  lines(id, { pages = null } = {}) {
    const j = this._journal(id);
    if (!j) return [];
    let list = j.pages.contents.filter((p) => p.getFlag(MODULE_ID, 'convPage')).sort((a, b) => (a.getFlag(MODULE_ID, 'firstSeq') || 0) - (b.getFlag(MODULE_ID, 'firstSeq') || 0));
    const more = pages && list.length > pages;
    if (more) list = list.slice(-pages);
    const out = sortLines(list.flatMap((p) => Object.values(p.getFlag(MODULE_ID, 'lines') || {})));
    out.hasEarlier = !!more;
    return out;
  }

  // ─── who is who ───

  /** The master contacts and keys that are this character. */
  _identity(actorId) {
    const actor = game.actors?.get(actorId);
    const sheetless = actor ? null : this.directory.find((c) => c.id === actorId);
    const ids = sheetless ? identitiesOfContact(this.directory, sheetless) : identitiesOf(this.directory, actorId);
    const email = actor?.getFlag?.(MODULE_ID, 'email') || '';
    return { ids: new Set(ids.map((c) => c.id)), emails: new Set([email, ...ids.map((c) => c.email)].filter(Boolean).map((e) => String(e).toLowerCase())) };
  }

  /** Is this member this character? An alias member carries no character, so the directory answers. */
  isMine(member, actorId, identity = this._identity(actorId)) {
    if (!actorId || !member) return false;
    return member.actorId === actorId || (member.contactId && identity.ids.has(member.contactId)) || identity.emails.has(String(member.email || '').toLowerCase());
  }
  membersOf(conv, actorId) { const me = this._identity(actorId); return conv.members.filter((m) => this.isMine(m, actorId, me)); }
  /** Who this character is in this conversation: still-in first. */
  meIn(conv, actorId) { const mine = this.membersOf(conv, actorId); return mine.find(isIn) || mine[0] || null; }

  /** The character behind a member, for the GM side only. Players never get this from the line itself. */
  _actorOf(member) {
    if (member.actorId) return game.actors?.get(member.actorId) || null;
    const c = member.contactId ? this.directory.find((x) => x.id === member.contactId) : null;
    if (!c) return null;
    const root = identitiesOfKey(this.directory, groupKeyOf(this.directory, c)).find((x) => x.actorId);
    return root ? game.actors?.get(root.actorId) || null : null;
  }

  isNpc(member) { const a = this._actorOf(member); return !a || !a.hasPlayerOwner; }

  _displayOf(member) {
    const c = member.contactId ? this.directory.find((x) => x.id === member.contactId) : null;
    const a = member.actorId ? game.actors?.get(member.actorId) : null;
    return { name: c?.name || a?.name || member.name || 'Unknown', img: c?.portrait || c?.customImg || (a?.img && !/mystery-man/.test(a.img) ? a.img : '') || '' };
  }

  /** Whose inbox a member's chats show in: the character, or the sheetless NPC's directory id. */
  inboxOwnerOf(member) {
    const actor = this._actorOf(member);
    if (actor) return actor.id;
    const c = member?.contactId ? this.directory.find((x) => x.id === member.contactId) : null;
    return c ? identityInboxId(this.directory, c) || c.id : null;
  }

  /** The identities a character could join as. */
  joinChoices(actorId) {
    const actor = game.actors?.get(actorId);
    const sheetless = actor ? null : this.directory.find((c) => c.id === actorId);
    if (sheetless) return identitiesOfContact(this.directory, sheetless).map((c) => ({ contactId: c.id, actorId: null, name: c.name, email: c.email || '', alias: !!identityRole(this.directory, c)?.isAlias }));
    const ids = identitiesOf(this.directory, actorId);
    const email = actor?.getFlag?.(MODULE_ID, 'email') || '';
    const out = ids.map((c) => ({ contactId: c.id, actorId: identityRole(this.directory, c)?.isAlias ? null : actorId, name: c.name, email: c.email || '', alias: !!identityRole(this.directory, c)?.isAlias }));
    if (!out.some((c) => !c.alias)) out.unshift({ contactId: null, actorId, name: actor?.name || 'Unknown', email, alias: false });
    return out;
  }

  /**
   * Turn what someone picked into a member, on the GM side. An alias never carries its character.
   * @returns {{member?: object, error?: string}}
   */
  _resolveRaw(raw = {}) {
    const dir = this.directory;
    const email = String(raw.email || '').trim().toLowerCase();
    const c = (raw.contactId && dir.find((x) => x.id === raw.contactId)) || (email && dir.find((x) => String(x.email || '').toLowerCase() === email)) || (raw.actorId && !raw.contactId ? game.nightcity?.masterContactService?.getByActorId?.(raw.actorId) : null) || null;
    const mcs = game.nightcity?.masterContactService;
    if (c) {
      if (c.sendOnly || mcs?.isSendOnly?.(c.email)) return { error: `${c.name} is a one-way address.` };
      const alias = identityRole(dir, c)?.isAlias;
      return { member: sanitizeMember({ key: memberKeyOf({ email: c.email, contactId: c.id }), name: c.name, email: c.email || '', contactId: c.id, actorId: alias ? null : c.actorId || null, spans: [] }) };
    }
    const actor = raw.actorId ? game.actors?.get(raw.actorId) : null;
    if (actor) {
      const mail = actor.getFlag?.(MODULE_ID, 'email') || '';
      return { member: sanitizeMember({ key: memberKeyOf({ email: mail, actorId: actor.id }), name: actor.name, email: mail, actorId: actor.id, spans: [] }) };
    }
    if (email) {
      const holder = game.actors?.find?.((a) => String(a.getFlag?.(MODULE_ID, 'email') || '').toLowerCase() === email);
      if (holder) return { member: sanitizeMember({ key: email, name: holder.name, email, actorId: holder.id, spans: [] }) };
    }
    return { error: `Nobody answers at ${raw.name || raw.email || 'that address'}.` };
  }

  // ─── the rows ───

  _state() { try { return game.user?.getFlag?.(MODULE_ID, 'conversationState') || {}; } catch { return {}; } }
  readSeq(id, key) { const r = this._reads.get(`${id}|${key}`); return r ?? this._state()[id]?.read?.[key] ?? 0; }
  isMuted(id) { return !!this._state()[id]?.muted; }

  /** The conversations a character is in or was in, as inbox rows. */
  rowsFor(actorId) {
    if (!actorId || !this.enabled) return [];
    const me = this._identity(actorId);
    const rows = [];
    for (const conv of this.all()) {
      const mine = conv.members.filter((m) => this.isMine(m, actorId, me));
      if (!mine.length) continue;
      const m = mine.find(isIn) || mine[0];
      const keys = new Set(mine.map((x) => x.key));
      let preview = conv.lastPreview, lastAt = conv.lastAt, lastSeq = conv.lastSeq;
      if (!isIn(m)) {
        // they have left: nothing after that may show, not even in the row
        const seen = visibleLines(this.lines(conv.id), m).at(-1);
        preview = seen ? { from: seen.fromName, text: previewOf(seen) } : null;
        lastAt = seen?.at || conv.createdAt; lastSeq = seen?.seq || 0;
      }
      const muted = this.isMuted(conv.id);
      const unread = muted ? 0 : unreadFor(m, lastSeq, this.readSeq(conv.id, m.key));
      const others = conv.members.filter((x) => !keys.has(x.key) && isIn(x));
      rows.push({
        id: conv.id, title: titleFor(conv, keys), preview: !preview ? 'Nothing yet' : !preview.from ? preview.text : `${preview.from === m.name ? 'You' : preview.from}: ${preview.text}`, lastAt, unread, muted, left: !isIn(m), count: others.length + 1,
        faces: others.slice(0, 3).map((x) => ({ ...this._displayOf(x), initial: (x.name || '?')[0].toUpperCase() })),
      });
    }
    return rows;
  }

  /** How many of this character's conversations have something new. The badge counts conversations, never lines. */
  unreadConversations(actorId) { return this.rowsFor(actorId).filter((r) => r.unread > 0).length; }

  /** Every character this user can read for. */
  _myActors() { return (game.actors?.contents || []).filter((a) => a.isOwner && a.hasPlayerOwner); }
  totalUnread() { return isGM() ? 0 : new Set(this._myActors().flatMap((a) => this.rowsFor(a.id).filter((r) => r.unread > 0).map((r) => r.id))).size; }

  /** I've read up to here. Held in memory and written after a pause: it lives on the user, so it redraws no character sheet. */
  markRead(id, key, seq) {
    if (!id || !key) return;
    const k = `${id}|${key}`;
    if ((this._reads.get(k) ?? this._state()[id]?.read?.[key] ?? 0) >= seq) return;
    this._reads.set(k, seq);
    this._notes.delete(id);
    game.nightcity?.notificationService?.dismissKeyed?.(`conv:${id}`);
    clearTimeout(this._readT);
    this._readT = setTimeout(() => this.flushReads(), 2500);
    game.nightcity?.eventBus?.emit?.(EVENTS.CONVERSATION_READ, { id });
  }

  async flushReads() {
    clearTimeout(this._readT);
    if (!this._reads.size) return;
    const state = foundry.utils.deepClone(this._state());
    for (const [k, seq] of this._reads) { const cut = k.indexOf('|'), id = k.slice(0, cut), key = k.slice(cut + 1); ((state[id] ??= {}).read ??= {})[key] = seq; }
    this._reads.clear();
    try { await game.user.setFlag(MODULE_ID, 'conversationState', state); } catch (e) { log.warn(`Conversations: could not save read state: ${e.message}`); }
  }

  async setMuted(id, muted) {
    const state = foundry.utils.deepClone(this._state());
    (state[id] ??= {}).muted = !!muted;
    if (muted) { this._notes.delete(id); game.nightcity?.notificationService?.dismissKeyed?.(`conv:${id}`); }
    await game.user.setFlag(MODULE_ID, 'conversationState', state);
    game.nightcity?.eventBus?.emit?.(EVENTS.CONVERSATION_READ, { id });
  }

  setOpen(id, open) { if (open) this._openIds.add(id); else this._openIds.delete(id); }

  // ─── asking ───

  /** Run on the GM, or ask the GM and wait for the answer. */
  async _request(op, data) {
    if (!this.enabled) return { ok: false, error: 'Conversations are switched off.' };
    if (isGM() && this._iAmWriter) return this._run(op, data, game.user.id);
    if (!game.users?.activeGM) return { ok: false, offline: true, error: 'No GM is online.' };
    const reqId = foundry.utils.randomID();
    return new Promise((resolve) => {
      const t = setTimeout(() => { this._waiting.delete(reqId); resolve({ ok: false, timeout: true, error: 'The GM did not answer in time.' }); }, REPLY_MS);
      this._waiting.set(reqId, (res) => { clearTimeout(t); resolve(res); });
      this.socket?.emit?.(SOCKET_OPS.CONVERSATION_REQUEST, { op, data, reqId, userId: game.user.id });
    });
  }

  /** SOCKET_OPS.CONVERSATION_REQUEST: one GM lands it, and says how it went. */
  async handleRequest(payload, senderId) {
    if (!this._iAmWriter) return;
    const res = await this._run(payload.op, payload.data, senderId);
    this.socket?.emit?.(SOCKET_OPS.CONVERSATION_RESULT, { forUserId: senderId, reqId: payload.reqId, res });
  }

  handleResult(payload) {
    if (payload.forUserId !== game.user.id) return;
    const done = this._waiting.get(payload.reqId);
    if (done) { this._waiting.delete(payload.reqId); done(payload.res); }
  }

  /** One write at a time, so two senders can't overwrite each other and the numbers only go up. */
  _run(op, data, userId) {
    const go = () => this._apply(op, data, userId).catch((e) => { log.warn(`Conversations: ${op} failed: ${e.message}`); return { ok: false, error: e.message }; });
    const p = this._queue.then(go, go);
    this._queue = p.catch(() => {});
    return p;
  }

  // ─── the writes (GM only) ───

  /** May this user speak for this member? The check that stops a forged relay. */
  _owns(member, userId) {
    const user = game.users?.get?.(userId);
    if (!user) return false;
    if (user.isGM) return true;
    const actor = this._actorOf(member);
    return !!actor && actor.testUserPermission(user, 'OWNER');
  }

  async _apply(op, d, userId) {
    if (!this._iAmWriter) return { ok: false, error: 'Not the writing GM.' };
    if (op === 'create') return this._create(d, userId);
    const j = this._journal(d.id);
    if (!j) return { ok: false, error: 'That conversation is gone.' };
    const conv = this._view(j);
    const speaker = d.asKey ? conv.members.find((m) => m.key === d.asKey) : null;
    const user = game.users?.get?.(userId);
    const gm = !!user?.isGM;
    const mustSpeak = () => {
      if (gm && !speaker) return null;
      if (!speaker) return 'You are not in this conversation.';
      if (!this._owns(speaker, userId)) return 'That is not you.';
      if (!isIn(speaker) && !gm) return 'You are no longer in this conversation.';
      return null;
    };
    const denied = mustSpeak();
    if (denied) return { ok: false, error: denied };
    const who = speaker?.name || 'The GM';
    switch (op) {
      case 'send': return this._send(j, conv, speaker, d);
      case 'add': {
        const { member, error } = this._resolveRaw(d.raw);
        if (error) return { ok: false, error };
        const seq = conv.lastSeq + 1;
        const had = conv.members.find((m) => m.key === member.key);
        if (had && isIn(had)) return { ok: true };
        const members = had ? conv.members.map((m) => (m.key === member.key ? openSpan(m, seq) : m)) : [...conv.members, openSpan(member, seq)];
        await this._setMeta(j, { members });
        await this._system(j, speaker ? `${who} added ${member.name}` : `${member.name} joined`, 'added');
        return { ok: true };
      }
      case 'remove': {
        const target = conv.members.find((m) => m.key === d.key);
        if (!target || !isIn(target)) return { ok: true };
        if (!gm && conv.starterKey !== speaker?.key) return { ok: false, error: 'Only whoever started it can remove someone.' };
        const members = conv.members.map((m) => (m.key === d.key ? closeSpan(m, conv.lastSeq + 1) : m));
        await this._setMeta(j, { members, starterKey: nextStarter(members, conv.starterKey) });
        await this._system(j, `${who} removed ${target.name}`, 'removed');
        return { ok: true };
      }
      case 'leave': {
        const members = conv.members.map((m) => (m.key === speaker.key ? closeSpan(m, conv.lastSeq + 1) : m));
        await this._setMeta(j, { members, starterKey: nextStarter(members, conv.starterKey) });
        await this._system(j, `${who} left`, 'left');
        return { ok: true };
      }
      case 'rename': {
        if (!gm && conv.starterKey !== speaker?.key) return { ok: false, error: 'Only whoever started it can rename it.' };
        const title = titleText(d.title);
        await this._setMeta(j, { title });
        await this._system(j, title ? `${who} renamed this to ${title}` : `${who} took the name off this`, 'renamed');
        return { ok: true };
      }
      case 'removeLine': {
        if (!gm) return { ok: false, error: 'GM only.' };
        for (const p of j.pages.contents) {
          const line = p.getFlag(MODULE_ID, 'lines')?.[d.lineId];
          if (!line) continue;
          await p.update({ [`flags.${MODULE_ID}.lines.${d.lineId}`]: goneLine(line) }, { render: false });
          return { ok: true };
        }
        return { ok: false, error: 'That line is gone.' };
      }
      case 'delete': {
        if (!gm) return { ok: false, error: 'GM only.' };
        await j.delete();
        return { ok: true };
      }
      default: return { ok: false, error: 'Unknown request.' };
    }
  }

  async _create(d, userId) {
    const { member: first, error } = this._resolveRaw(d.as);
    if (error) return { ok: false, error };
    if (!this._owns(first, userId)) return { ok: false, error: 'That is not you.' };
    const members = [openSpan(first, 1)], refused = [];
    for (const raw of d.members || []) {
      const res = this._resolveRaw(raw);
      if (res.error) { refused.push(res.error); continue; }
      if (!members.some((m) => m.key === res.member.key)) members.push(openSpan(res.member, 1));
    }
    if (members.length < 2) return { ok: false, error: refused[0] || 'Add someone to talk to.' };
    const id = d.id || foundry.utils.randomID();
    const repo = game.nightcity?.messageRepository;
    const folder = await repo?.getSubfolderPath?.([FOLDER]);
    const now = this._now;
    await JournalEntry.create({
      name: `Conversation ${id}`, folder: folder?.id ?? null, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
      flags: { [MODULE_ID]: { type: 'conversation', conversationId: id, title: titleText(d.title), starterKey: first.key, createdAt: now, lastSeq: 0, lastAt: now, lastPreview: null, members } },
      pages: [this._pageData(1, {})],
    }, { render: false });
    return { ok: true, id, refused };
  }

  _pageData(firstSeq, lines) {
    return { name: `Lines from ${firstSeq}`, type: 'text', text: { content: '' }, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE }, flags: { [MODULE_ID]: { convPage: true, firstSeq, lines } } };
  }

  /** Quiet: a journal update would otherwise redraw everyone's Journal sidebar. */
  _setMeta(j, changes) {
    const up = {};
    for (const [k, v] of Object.entries(changes)) up[`flags.${MODULE_ID}.${k}`] = v;
    return j.update(up, { render: false });
  }

  async _writeLine(j, conv, line) {
    const pages = j.pages.contents.filter((p) => p.getFlag(MODULE_ID, 'convPage')).sort((a, b) => (a.getFlag(MODULE_ID, 'firstSeq') || 0) - (b.getFlag(MODULE_ID, 'firstSeq') || 0));
    const last = pages.at(-1);
    if (last && Object.keys(last.getFlag(MODULE_ID, 'lines') || {}).length < PAGE_LINES) await last.update({ [`flags.${MODULE_ID}.lines.${line.lineId}`]: line }, { render: false });
    else await j.createEmbeddedDocuments('JournalEntryPage', [this._pageData(line.seq, { [line.lineId]: line })], { render: false });
    await this._setMeta(j, { lastSeq: line.seq, lastAt: line.at, lastPreview: { from: line.fromName, text: previewOf(line).slice(0, 120) } });
  }

  async _system(j, text) {
    const conv = this._view(j);
    const line = makeLine({ lineId: foundry.utils.randomID(), seq: conv.lastSeq + 1, at: this._now, kind: 'system', text });
    if (line) await this._writeLine(j, conv, line);
  }

  async _send(j, conv, speaker, d) {
    if (!speaker) return { ok: false, error: 'Pick who is speaking.' };
    // a retry after a timeout: it is already there, so just say so
    for (const p of j.pages.contents.slice(-2)) if (p.getFlag(MODULE_ID, 'lines')?.[d.lineId]) return { ok: true, already: true };
    if (d.kind === 'card' && this._iceLocked(speaker, d.card)) return { ok: false, error: 'That contact is locked, so it can\'t be shared.' };
    const line = makeLine({ lineId: d.lineId, seq: conv.lastSeq + 1, at: this._now, from: speaker.actorId ? speaker : { ...speaker, actorId: null }, kind: d.kind || 'text', text: d.text, img: d.img, card: d.card, network: d.network });
    if (!line) return { ok: false, error: 'Nothing to send.' };
    await this._writeLine(j, conv, line);
    this._tap(conv, line, d.scene).catch((e) => log.warn(`Conversations: tap failed: ${e.message}`));
    return { ok: true };
  }

  /** The card's source, on the sender's own list: a locked contact stays locked. */
  _iceLocked(speaker, card) {
    const list = this._actorOf(speaker)?.getFlag?.(MODULE_ID, 'contacts');
    if (!Array.isArray(list) || !card) return false;
    const mail = String(card.email || '').toLowerCase();
    return list.some((c) => c.encrypted && ((card.contactId && (c.masterContactId === card.contactId || c.id === card.contactId)) || (mail && String(c.email || '').toLowerCase() === mail)));
  }

  /** A tap on an up node hears lines sent from that node's scene, as one plain running log. Written read, and it never notifies. */
  async _tap(conv, line, scene) {
    const net = game.nightcity?.networkService;
    if (!line.network || !scene || !net?.tappersAt) return;
    const tappers = net.tappersAt(line.network, scene);
    const repo = game.nightcity?.messageRepository;
    if (!tappers?.size || !repo) return;
    for (const [actorId, { node, sloppy }] of tappers) {
      const members = this.membersOf(conv, actorId);
      if (members.some(isIn)) continue;   // they were in the room anyway
      const when = (() => { try { return formatCyberDate(line.at, { timeOnly: true }); } catch { return ''; } })();
      const entry = sloppy ? { when, who: line.fromName || 'Unknown', what: '[garbled]' } : tapLogLine(line, when);
      const messageId = `convtap-${conv.id}-${actorId}`;
      const had = await repo.getMessage(actorId, messageId);
      const entries = appendTapLog(had?.metadata?.tapLog, entry);
      const body = `<pre class="ncm-conv__taplogp">${entries.map((e) => esc(`${e.when}  ${e.who}: ${e.what}`)).join('\n')}</pre>`;
      if (had) await repo.updateMessageFlags(actorId, messageId, { body, metadata: { ...had.metadata, tapLog: entries }, timestamp: line.at });
      else await repo.createMessage(actorId, { messageId, from: `TAP · ${node.name}`, to: '', subject: 'Log: a conversation on this network', body, timestamp: line.at, network: line.network, status: { read: true }, metadata: { recovered: true, recoveredFrom: `TAP · ${node.name}`, tapLog: entries } });
    }
  }

  // ─── what the UI calls ───

  start({ as, members, title }) { return this._request('create', { id: foundry.utils.randomID(), as, members, title }); }
  add(id, asKey, raw) { return this._request('add', { id, asKey, raw }); }
  remove(id, asKey, key) { return this._request('remove', { id, asKey, key }); }
  leave(id, asKey) { return this._request('leave', { id, asKey }); }
  rename(id, asKey, title) { return this._request('rename', { id, asKey, title }); }
  removeLine(id, lineId) { return this._request('removeLine', { id, lineId }); }
  destroy(id) { return this._request('delete', { id }); }

  get _queueKey() { return `ncm.convQueue.${game.world?.id || 'world'}.${game.user?.id || 'user'}`; }
  pendingFor(id) { return this._pending.get(id) || []; }

  _savePending() {
    try {
      const held = [...this._pending.values()].flat().filter((p) => p.state === 'queued').map(({ state, reason, ...keep }) => keep);
      if (held.length) localStorage.setItem(this._queueKey, JSON.stringify(held)); else localStorage.removeItem(this._queueKey);
    } catch (e) { log.warn(`Conversations: could not save held lines: ${e.message}`); }
  }

  /** Bring back lines held before a reload, then try them. */
  restorePending() {
    try {
      const saved = JSON.parse(localStorage.getItem(this._queueKey) || '[]');
      for (const p of Array.isArray(saved) ? saved : []) { const list = this._pending.get(p.id) || []; if (!list.some((x) => x.lineId === p.lineId)) list.push({ ...p, state: 'queued' }); this._pending.set(p.id, list); }
    } catch (e) { log.warn(`Conversations: could not read held lines: ${e.message}`); }
    return this.flushPending();
  }

  _setPending(id, lineId, patch) {
    const list = this._pending.get(id) || [];
    const next = patch ? list.map((p) => (p.lineId === lineId ? { ...p, ...patch } : p)) : list.filter((p) => p.lineId !== lineId);
    if (next.length) this._pending.set(id, next); else this._pending.delete(id);
    this._savePending();
    game.nightcity?.eventBus?.emit?.(EVENTS.CONVERSATION_PENDING, { id });
  }

  /**
   * Say something. It shows at once as sending, held or failed, in place on the line.
   * @param {string} id @param {{asKey: string, kind?: string, text?: string, img?: string, card?: object}} what
   */
  async send(id, what) {
    const net = game.nightcity?.networkService;
    const line = { id, lineId: foundry.utils.randomID(), asKey: what.asKey, kind: what.kind || 'text', text: what.kind === 'text' || !what.kind ? lineText(what.text) : '', img: safeImage(what.img), card: what.card ? sanitizeCard(what.card) : null, network: net?.currentNetworkId || '', scene: game.scenes?.viewed?.id || '' };
    if ((line.kind === 'text' && !line.text) || (line.kind === 'image' && !line.img) || (line.kind === 'card' && !line.card)) return { ok: false, error: 'Nothing to send.' };
    const list = this._pending.get(id) || [];
    this._pending.set(id, [...list, { ...line, state: 'sending' }]);
    game.nightcity?.eventBus?.emit?.(EVENTS.CONVERSATION_PENDING, { id });
    return this._deliver(line);
  }

  async _deliver(line) {
    const { id, lineId } = line;
    if (!isGM() && game.nightcity?.networkService?.isDeadZone) { this._setPending(id, lineId, { state: 'queued', reason: 'No signal here. It sends when you have signal.' }); return { ok: true, queued: true }; }
    const res = await this._request('send', line);
    if (res.ok) { this._setPending(id, lineId, null); return res; }
    if (res.offline) { this._setPending(id, lineId, { state: 'queued', reason: 'No GM is online. It sends when one connects.' }); return { ok: true, queued: true }; }
    this._setPending(id, lineId, { state: 'failed', reason: res.error || 'It did not send.' });
    return res;
  }

  /** Try again: the same id, so a line that did land can't post twice. */
  retry(id, lineId) { const p = this.pendingFor(id).find((x) => x.lineId === lineId); if (!p) return null; this._setPending(id, lineId, { state: 'sending', reason: '' }); return this._deliver(p); }
  discard(id, lineId) { this._setPending(id, lineId, null); }

  async flushPending() {
    if (!this.enabled || this._flushing || (!isGM() && !game.users?.activeGM) || (!isGM() && game.nightcity?.networkService?.isDeadZone)) return;
    this._flushing = true;
    try {
      for (const list of [...this._pending.values()]) for (const p of list) if (p.state === 'queued') { this._setPending(p.id, p.lineId, { state: 'sending' }); await this._deliver(p); }
    } finally { this._flushing = false; }
  }

  // ─── notifications ───

  /** A line reached this client. One toast per conversation, one sound until it is read, and never for your own line. */
  _noticeLine(conv, line) {
    if (line.kind === 'system' || line.kind === 'gone') return;
    if (game.user.isGM) return this._noticeGm(conv, line);
    const me = this._myActors();
    const mine = conv.members.filter((m) => me.some((a) => this.isMine(m, a.id)));
    if (!mine.some((m) => isIn(m) && canSee(m, line.seq))) return;
    const own = mine.some((m) => m.key === line.fromKey);
    const plan = notifyPlan(this._notes.get(conv.id), { own, open: this._openIds.has(conv.id), muted: this.isMuted(conv.id) });
    this._notes.set(conv.id, plan.state);
    if (!plan.toast) return;
    if (plan.sound) { try { game.nightcity?.soundService?.play?.('receive'); } catch { /* sound is never worth failing a line */ } }
    const keys = new Set(mine.map((m) => m.key));
    game.nightcity?.notificationService?.upsertToast?.(`conv:${conv.id}`, {
      type: 'message', icon: 'fas fa-comments', title: titleFor(conv, keys), detail: `${plan.state.n} new · ${line.fromName}`, duration: 6000,
      actionLabel: 'Open', onAction: () => game.nightcity?.openConversation?.(conv.id, me.find((a) => mine.some((m) => this.isMine(m, a.id)))?.id),
    });
  }

  gmWatches(conv) {
    let map = {};
    try { map = game.settings.get(MODULE_ID, 'conversationGmBell') || {}; } catch { /* the default */ }
    return map[conv.id] ?? conv.members.some((m) => isIn(m) && this.isNpc(m));
  }
  async setGmWatch(id, on) {
    const map = { ...(game.settings.get(MODULE_ID, 'conversationGmBell') || {}), [id]: !!on };
    await game.settings.set(MODULE_ID, 'conversationGmBell', map);
  }

  /** What an NPC in this conversation is being waited on for. */
  waiting(conv) { return waitingOn(this.lines(conv.id, { pages: 2 }), new Set(conv.members.filter((m) => this.isNpc(m)).map((m) => m.key))); }

  /** The GM gets one toast for everything an NPC is being waited on for. */
  _noticeGm(conv, line) {
    let on = true;
    try { on = game.settings.get(MODULE_ID, 'notifyGmConversations') !== false; } catch { /* the default */ }
    if (!on || !this.gmWatches(conv) || this._openIds.has(conv.id)) return;
    const from = conv.members.find((m) => m.key === line.fromKey);
    if (from && this.isNpc(from)) return;   // that was the GM speaking
    const waiting = this.all().filter((c) => this.gmWatches(c) && c.members.some((m) => isIn(m) && this.isNpc(m)) && this.waiting(c).n > 0).length;
    const plan = notifyPlan(this._notes.get('gm'), {});
    this._notes.set('gm', plan.state);
    if (plan.sound) { try { game.nightcity?.soundService?.play?.('receive'); } catch { /* sound is never worth failing a line */ } }
    game.nightcity?.notificationService?.upsertToast?.('conv:gm', {
      type: 'message', icon: 'fas fa-masks-theater', title: 'NPC conversations', detail: `${waiting || 1} waiting · ${line.fromName}: ${previewOf(line).slice(0, 60)}`, duration: 7000,
      actionLabel: 'Open', onAction: () => { this._notes.delete('gm'); game.nightcity?.openAdminTab?.('messages', { select: `conv:${conv.id}` }); },
    });
  }

  /** The Journal hooks: lines arriving, and the chat changing. */
  wire() {
    const bus = () => game.nightcity?.eventBus;
    const seen = (page, lines) => {
      const j = page.parent;
      if (!this._isConv(j) || !lines) return;
      const list = Object.values(lines).filter((l) => l && l.seq);
      if (!list.length) return;
      const conv = this._view(j);
      // a newly drawn line, not a replaced one
      for (const line of sortLines(list)) { this._dropSent(conv.id, line.lineId); if (line.kind !== 'gone') this._noticeLine(conv, line); }
      bus()?.emit?.(EVENTS.CONVERSATION_LINE, { id: conv.id, lines: sortLines(list) });
      game.nightcity?.notificationService?.refreshBadge?.();
    };
    Hooks.on('createJournalEntryPage', (page) => seen(page, page.getFlag?.(MODULE_ID, 'lines')));
    Hooks.on('updateJournalEntryPage', (page, changes) => seen(page, changes?.flags?.[MODULE_ID]?.lines));
    const changed = (j) => { if (this._isConv(j)) bus()?.emit?.(EVENTS.CONVERSATION_UPDATED, { id: j.getFlag(MODULE_ID, 'conversationId') }); };
    Hooks.on('createJournalEntry', changed);
    Hooks.on('updateJournalEntry', (j, c) => { const f = c?.flags?.[MODULE_ID]; if (f && ('members' in f || 'title' in f || 'starterKey' in f)) changed(j); });
    Hooks.on('deleteJournalEntry', changed);
    Hooks.on('userConnected', (u, on) => { if (on && u.isGM) this.flushPending(); });
    bus()?.on?.(EVENTS.NETWORK_CONNECTED, () => this.flushPending());
    window.addEventListener?.('beforeunload', () => { if (this._reads.size) this.flushReads(); });
  }

  _dropSent(id, lineId) { if (this.pendingFor(id).some((p) => p.lineId === lineId)) this._setPending(id, lineId, null); }
}

// One conversation's tap log is written one line at a time (audit INT-05). `_tap` reads the log, appends and writes it
// back, and it is fired without waiting — two lines close together both found no log page and made two, or one
// overwrote the other's line.
serializeMethods(ConversationService.prototype, ['_tap'], (args) => (args[0]?.id ? `convtap:${args[0].id}` : null));

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
