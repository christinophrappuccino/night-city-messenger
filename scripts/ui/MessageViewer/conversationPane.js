/**
 * Conversations: the chat pane, for a player's Agent and for the GM in Admin → Messages.
 * @file scripts/ui/MessageViewer/conversationPane.js
 * @module night-city-messenger
 * @description Built as strings and patched in place, because a chat updates far more often than the inbox should redraw: a new line
 *   appends, and what you are typing, where you have scrolled and the "new" marker all stay. The window can still redraw around it, and
 *   mount() puts everything back. Design dev/design/CONVERSATIONS.md, mock dev/mockups/conversations-mock.html.
 */

import { MODULE_ID, CHAT_EMOJI } from '../../utils/constants.js';
import { formatCyberDate, getPlayerCharacters, isHiddenCharacter, isPersonActor } from '../../utils/helpers.js';
import { identityRole } from '../../utils/identities.js';
import { parseNumber, fullForm } from '../../utils/phoneNumbering.js';
import { isIn, canSee, visibleLines, LINE_MAX, titleFor, previewOf, pushRecentNpc, npcKey } from '../../utils/conversations.js';
import { showNamePicker } from '../../utils/namePicker.js';
import { themedConfirm, themedPrompt } from '../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../utils/dialogBody.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HUES = ['#19f3f7', '#ff5fa2', '#5ad1ff', '#b4e05a', '#ffb347', '#c9a0ff', '#7fd8be', '#f7a1c4'];
const hueOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return HUES[h % HUES.length]; };
const svc = () => game.nightcity?.conversationService;
const btn = (label, icon, attrs = '', cls = '') => `<button type="button" class="ncm-conv__btn ${cls}" ${attrs}>${icon ? `<i class="fas ${icon}"></i>` : ''}${label ? ` ${esc(label)}` : ''}</button>`;
const ic = (icon, tip, attrs = '', cls = '') => `<button type="button" class="ncm-conv__icon ${cls}" aria-label="${esc(tip)}" data-tooltip="${esc(tip)}" ${attrs}><i class="fas ${icon}"></i></button>`;
const dayOf = (at) => { try { return formatCyberDate(at, { dateOnly: true }); } catch { return ''; } };
const timeOf = (at) => { try { return formatCyberDate(at, { timeOnly: true }); } catch { return ''; } };

export function avatar(person) {
  const name = person?.name || '?';
  return person?.img ? `<div class="ncm-conv__av has-img" style="--c:${hueOf(name)};background-image:url('${esc(person.img)}')" role="img" aria-label="${esc(name)}"></div>` : `<div class="ncm-conv__av" style="--c:${hueOf(name)}">${esc(name[0].toUpperCase())}</div>`;
}

/** Who a character can write to: their own contacts, minus locked and one-way. The GM: the directory and the players' characters. */
function contactChoices(actorId, { gm = false } = {}) {
  const mcs = game.nightcity?.masterContactService;
  const out = [];
  if (gm) {
    for (const p of getPlayerCharacters()) out.push({ id: `a:${p.actorId}`, name: p.actorName, group: 'Player characters', sub: p.playerName || '', raw: { actorId: p.actorId, name: p.actorName }, source: { name: p.actorName, actorId: p.actorId, email: p.actor?.getFlag?.(MODULE_ID, 'email') || '', portrait: p.actor?.img && !/mystery-man/.test(p.actor.img) ? p.actor.img : '' } });
    for (const c of mcs?.getAll?.() || []) if (!c.sendOnly && !mcs?.isSendOnly?.(c.email)) out.push({ id: `c:${c.id}`, name: c.name, group: identityRole(mcs.getAll(), c)?.isAlias ? 'Aliases' : 'Directory', sub: c.email || '', img: c.portrait || undefined, raw: { contactId: c.id, name: c.name, email: c.email }, source: c });
    return out;
  }
  const list = game.actors?.get(actorId)?.getFlag?.(MODULE_ID, 'contacts') || [];
  for (const c of list) {
    if (c.encrypted || c.sendOnly || (c.email && mcs?.isSendOnly?.(c.email))) continue;
    if (c.actorId && isHiddenCharacter(c.actorId)) continue;
    out.push({ id: `p:${c.id}`, name: c.name, group: 'Your contacts', sub: c.email || c.phone || '', img: c.portrait || undefined, raw: { contactId: c.masterContactId || null, actorId: c.masterContactId ? null : c.actorId || null, email: c.email, name: c.name }, source: c });
  }
  return out;
}

/** The picker over them, with contact groups. Resolves to raw members. */
async function pickPeople(actorId, { gm = false, title = 'Who?', taken = [] } = {}) {
  const base = contactChoices(actorId, { gm });
  const groupSvc = game.nightcity?.contactGroupService;
  const groups = (groupSvc?.groupsFor?.({ actorId, isGM: gm }) || []).map((g) => ({ id: `g:${g.id}`, name: g.name, group: 'Groups', sub: `${g.members?.length || 0} people`, group_: g }));
  const entries = [...groups, ...base].map((e) => ({ id: e.id, name: e.name, group: e.group, sub: e.sub, img: e.img }));
  const picks = await showNamePicker({ admin: !!gm, multi: true, title, placeholder: 'search names and addresses…', entries, taken, doneLabel: 'Add' });
  if (!Array.isArray(picks)) return null;
  const out = [];
  for (const p of picks) {
    const id = p?.id ?? p;
    const g = groups.find((x) => x.id === id);
    if (g) { out.push(...(groupSvc.recipientsFor(g.group_).recipients || [])); continue; }
    const hit = base.find((x) => x.id === id);
    if (hit) out.push(hit.raw);
  }
  return out;
}

const RECENT_KEY = 'ncm.conv.gmRecentNpcs';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const saveRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* a convenience, nothing depends on it */ } };

/** The NPCs recently spoken as, on this GM's client. Someone deleted since drops out. */
function recentNpcs() {
  return readRecent().filter((r) => (r.contactId ? svc().directory.some((c) => c.id === r.contactId) : !!game.actors?.get(r.actorId)));
}

/** One click, one NPC: the directory (aliases included) and any NPC actor with no entry there. */
async function pickNpc(title) {
  const dir = svc().directory;
  const mcs = game.nightcity?.masterContactService;
  const entries = [], raws = new Map();
  for (const c of dir) {
    if (c.sendOnly || mcs?.isSendOnly?.(c.email)) continue;
    const actor = c.actorId ? game.actors?.get(c.actorId) : null;
    if (actor?.hasPlayerOwner && !identityRole(dir, c)?.isAlias) continue;
    const id = `c:${c.id}`;
    entries.push({ id, name: c.name, group: identityRole(dir, c)?.isAlias ? 'Aliases' : (c.role || 'NPCs'), sub: c.email || '', img: c.portrait || undefined });
    raws.set(id, { contactId: c.id, actorId: actor?.id || null, email: c.email, name: c.name });
  }
  for (const a of game.actors || []) {
    if (a.hasPlayerOwner || !isPersonActor(a) || dir.some((c) => c.actorId === a.id)) continue;
    const id = `a:${a.id}`;
    entries.push({ id, name: a.name, group: 'NPC actors', img: a.img || undefined });
    raws.set(id, { actorId: a.id, name: a.name });
  }
  const pick = await showNamePicker({ title, placeholder: 'search names and addresses…', entries });
  return pick?.id ? raws.get(pick.id) || null : null;
}

/** The GM may hand out any number, so this reads the real lines rather than what a contact card carries. */
function gmNumberOf(src) {
  const cs = game.nightcity?.callService;
  if (!cs || !src) return '';
  if (src.phone) return cs.numberForContact?.(src) || '';
  const own = src.id ? Object.values(cs.lines?.() || {}).find((l) => l?.owner?.contactId === src.id) : null;
  if (own) return own.number || '';
  const main = src.actorId ? svc().directory.find((c) => c.actorId === src.actorId && !identityRole(svc().directory, c)?.isAlias) : null;
  return src.actorId && (!src.id || main?.id === src.id) ? cs.numberOf?.(src.actorId) || '' : '';
}

export class ConversationPane {
  /** @param {{admin?: boolean, actorId?: () => string}} opts */
  constructor({ admin = false, actorId = () => null } = {}) {
    this.admin = admin; this._actorId = actorId;
    this.id = null; this.host = null;
    this.drafts = new Map(); this.scrolls = new Map(); this.seen = new Map(); this.pages = new Map();
    this.panel = false; this.plus = false; this.asKey = new Map();
    this._hadFocus = false; this._fresh = new Set();
  }

  get conv() { return this.id ? svc()?.get(this.id) : null; }
  get actorId() { return this._actorId(); }
  /** A GM in their own inbox gets the same powers as in the admin panel. */
  get gm() { return this.admin || !!game.user?.isGM; }
  /** Who the GM can speak as here: this inbox's own names first, whoever they belong to, then the chat's NPCs. */
  _speakers(c) {
    const own = this.admin ? [] : svc().membersOf(c, this.actorId).filter(isIn);
    return [...own, ...this._npcs(c).filter((m) => !own.includes(m))];
  }
  /** Who is speaking here. For a player it is fixed, who they are in this conversation. For the GM, the name picked; else the inbox's own; else the NPC who spoke last. */
  get me() {
    const c = this.conv;
    if (!c) return null;
    if (!this.gm) return svc().meIn(c, this.actorId);
    const picked = this._speakers(c).find((m) => m.key === this.asKey.get(c.id));
    if (picked) return picked;
    const own = this.admin ? null : svc().membersOf(c, this.actorId).find(isIn);
    return own || this._npcs(c)[this._lastNpcIndex(c)] || null;
  }
  get _mine() { const c = this.conv; return c && !this.admin ? new Set(svc().membersOf(c, this.actorId).map((m) => m.key)) : new Set(); }

  _npcs(c) { return c.members.filter((m) => isIn(m) && svc().isNpc(m)); }
  /** Default to whoever last spoke, so a GM with several NPCs is less likely to answer as the wrong one. */
  _lastNpcIndex(c) {
    const npcs = this._npcs(c);
    const lines = svc().lines(c.id, { pages: 1 });
    for (let i = lines.length - 1; i >= 0; i--) { const at = npcs.findIndex((m) => m.key === lines[i].fromKey); if (at >= 0) return at; }
    return 0;
  }

  // ─── mounting ───

  /** Before the window redraws: remember what would be lost with the old DOM. */
  snapshot() {
    if (!this.host?.isConnected) return;
    const sc = this.host.querySelector('[data-scroll]');
    if (sc && this.id) this.scrolls.set(this.id, sc.scrollTop);
    this._hadFocus = this.host.contains(document.activeElement) && document.activeElement?.matches?.('textarea');
    const box = this.host.querySelector('.ncm-conv__input');
    this._caret = box?.selectionStart ?? null;
  }

  mount(host, id) {
    if (this.id && this.id !== id) this.leave();
    const changed = this.id !== id;
    this.host = host; this.id = id;
    svc()?.setOpen(id, true);
    if (changed) { this.panel = false; this.plus = false; this.seen.delete(id); }
    this.paint();
  }

  /** Closed or moved away. */
  leave() {
    if (this.id) { this.scrolls.delete(this.id); svc()?.setOpen(this.id, false); }
    this.id = null; this.host = null;
    if (!this.admin) svc()?.flushReads?.();
  }

  // ─── drawing ───

  paint() {
    const c = this.conv;
    if (!this.host) return;
    if (!c) { this.host.innerHTML = '<div class="ncm-conv__blank">This conversation is gone.</div>'; return; }
    const me = this.me;
    if (!this.seen.has(c.id)) this.seen.set(c.id, this.admin ? c.lastSeq : svc().readSeq(c.id, me?.key || ''));
    this.host.innerHTML = `<div class="ncm-conv"><div class="ncm-conv__main">${this._head(c, me)}
      <div class="ncm-conv__scroll ncm-scrollbar" data-scroll>${this._earlier(c)}<div class="ncm-conv__lines" data-lines>${this._linesHtml(c)}</div><div class="ncm-conv__lines" data-pending></div></div>
      ${this._bar(c, me)}</div>${this.panel ? this._panel(c, me) : ''}</div><div data-conv-dlg></div>`;
    this._wire();
    this._dedupeDays();
    this._paintPending();
    this._settle(c);
    this._read(c);
    const box = this.host.querySelector('.ncm-conv__input');
    if (box) { box.value = this.drafts.get(c.id) || ''; this._grow(box); if (this._hadFocus) { box.focus({ preventScroll: true }); if (this._caret !== null) box.setSelectionRange(this._caret, this._caret); } }
    this._hadFocus = false;
  }

  _settle(c) {
    const sc = this.host.querySelector('[data-scroll]');
    if (!sc) return;
    if (this.scrolls.has(c.id)) { sc.scrollTop = this.scrolls.get(c.id); return; }
    const mark = sc.querySelector('[data-fresh]');
    sc.scrollTop = mark ? mark.offsetTop - sc.offsetTop - 6 : sc.scrollHeight;
  }

  _read(c) {
    if (this.admin) return;
    const me = svc().meIn(c, this.actorId);
    if (me && isIn(me)) svc().markRead(c.id, me.key, c.lastSeq);
  }

  _head(c, me) {
    const mine = this._mine;
    const inNow = c.members.filter(isIn);
    const names = inNow.map((m) => (mine.has(m.key) ? `You${this._isAlias(m) ? ` (${m.name})` : ''}` : svc()._displayOf(m).name)).join(', ');
    const faces = inNow.slice(0, 8).map((m) => avatar(svc()._displayOf(m))).join('');
    const title = esc(titleFor(c, mine));
    if (this.admin) {
      const bell = svc().gmWatches(c);
      const tap = this._tapText(c);
      return `<div class="ncm-conv__head"><div class="ncm-conv__titles"><div class="ncm-conv__title">${title}</div><div class="ncm-conv__sub"><div class="ncm-conv__faces">${faces}</div><span>${esc(names)}</span></div></div>
        ${tap ? `<span class="ncm-tagp is-attn" data-tooltip="${esc(tap)}"><i class="fas fa-ear-listen"></i> Tapped</span>` : ''}<span class="ncm-tagp is-secret" data-tooltip="Nobody is told you are reading, and their read state does not change"><i class="fas fa-eye"></i> Watching</span>
        ${ic(bell ? 'fa-bell' : 'fa-bell-slash', bell ? 'On: this one counts in your NPC conversations toast. Click to stop' : 'Off: this one never tells you anything. Click to count it in your toast', 'data-cv="bell"', bell ? 'is-on' : '')}
        ${btn('Members', 'fa-users', 'data-cv="panel"', this.panel ? 'is-on' : '')}</div>`;
    }
    const left = me && !isIn(me);
    const muted = svc().isMuted(c.id);
    return `<div class="ncm-conv__head"><div class="ncm-conv__titles"><div class="ncm-conv__title">${title}</div><div class="ncm-conv__sub"><div class="ncm-conv__faces">${faces}</div><span>${esc(names)}${muted ? ' · muted' : ''}</span></div></div>
      ${left ? '' : `${ic(muted ? 'fa-bell-slash' : 'fa-bell', muted ? 'Muted: no toast, no sound, no badge. Click to unmute' : 'Mute this conversation: no toast, no sound, no badge', 'data-cv="mute"', muted ? 'is-on' : '')}${btn('Members', 'fa-users', 'data-cv="panel"', this.panel ? 'is-on' : '')}`}</div>`;
  }

  _tapText(c) {
    const nodes = game.nightcity?.networkService?.getNodes?.() || [];
    const names = [];
    for (const n of nodes) for (const t of n.taps || []) if (!c.members.some((m) => m.actorId === t.actorId)) names.push(`${t.actorName} has a tap on ${n.name}`);
    return names.length ? `${names.slice(0, 3).join('. ')}. It logs lines sent from that node's scene` : '';
  }

  _earlier(c) {
    const shown = this.pages.get(c.id) ?? 2;
    return svc().lines(c.id, { pages: shown }).hasEarlier ? `<button type="button" class="ncm-conv__link" data-cv="earlier"><i class="fas fa-chevron-up"></i>Show earlier</button>` : '';
  }

  _linesFor(c) {
    const lines = svc().lines(c.id, { pages: this.pages.get(c.id) ?? 2 });
    if (this.admin) return lines;
    const mine = svc().membersOf(c, this.actorId);
    return lines.filter((l) => mine.some((m) => canSee(m, l.seq)));
  }

  _linesHtml(c) {
    const lines = this._linesFor(c);
    const seen = this.seen.get(c.id) ?? 0;
    const mine = this._mine;
    let prev = null, out = '', marked = false;
    for (const l of lines) {
      if (!this.admin && !marked && l.seq > seen && seen > 0 && !mine.has(l.fromKey)) { out += `<div class="ncm-conv__rule ncm-conv__rule--new" data-fresh>New</div>`; marked = true; prev = { ...prev, _break: true }; }
      out += this._lineHtml(l, prev, c);
      prev = l;
    }
    return out || '<div class="ncm-conv__rule">Nothing here yet. Say something.</div>';
  }

  /** One date per day, however a line reached the screen. */
  _dedupeDays() {
    const seen = new Set();
    this.host?.querySelectorAll('[data-lines] [data-day]').forEach((el) => { if (seen.has(el.dataset.day)) el.remove(); else seen.add(el.dataset.day); });
  }

  _lineHtml(l, prev, c, { noDay = false } = {}) {
    const day = dayOf(l.at);
    const dayLine = !noDay && day && day !== (prev ? dayOf(prev.at) : '') ? `<div class="ncm-conv__rule" data-day="${esc(day)}">${esc(day)}</div>` : '';
    if (l.kind === 'system') return `${dayLine}<div class="ncm-conv__rule ncm-conv__rule--sys" data-line="${esc(l.lineId)}">${esc(l.text)}</div>`;
    if (l.kind === 'gone') return `${dayLine}<div class="ncm-conv__rule ncm-conv__rule--sys" data-line="${esc(l.lineId)}"><i class="fas fa-eraser"></i> Line removed by the GM</div>`;
    const mine = this._mine.has(l.fromKey);
    const cont = !dayLine && prev && !prev._break && prev.fromKey === l.fromKey && !['system', 'gone'].includes(prev.kind);
    const who = svc()._displayOf({ contactId: l.fromContactId, actorId: l.fromActorId, name: l.fromName });
    const member = c.members.find((m) => m.key === l.fromKey);
    const npc = this.gm && member && svc().isNpc(member);
    const aliasNote = this.gm && member && this._isAlias(member) ? `alias of ${this._ownerName(member)}` : (mine && member && this._isAlias(member) ? `as ${member.name}` : '');
    const head = cont ? '' : `<div class="ncm-conv__who"><span class="ncm-conv__name">${mine ? 'You' : esc(who.name)}</span>${aliasNote ? `<span class="ncm-conv__alias${this.gm ? ' is-secret' : ''}">${esc(aliasNote)}</span>` : ''}${npc ? '<span class="ncm-conv__npc">NPC</span>' : ''}<span class="ncm-conv__time">${esc(timeOf(l.at))}</span></div>`;
    const body = l.kind === 'card' ? this._card(l, mine) : l.kind === 'image' ? `<img class="ncm-conv__pic" src="${esc(l.img)}" alt="A shared picture">` : `<div class="ncm-conv__bubble">${esc(l.text)}</div>`;
    const rm = this.gm ? ic('fa-eraser', 'Remove this line for everyone. A marker stays in its place', `data-cv="rmline" data-id="${esc(l.lineId)}"`, 'ncm-conv__rm') : '';
    return `${dayLine}<article class="ncm-conv__m${mine ? ' is-mine' : ''}${cont ? ' is-cont' : ''}" data-line="${esc(l.lineId)}">${mine ? '' : (cont ? '<div></div>' : avatar(who))}<div style="min-width:0">${head}${body}</div>${rm}</article>`;
  }

  _isAlias(m) { const dir = svc().directory; const c = m.contactId ? dir.find((x) => x.id === m.contactId) : null; return !!(c && identityRole(dir, c)?.isAlias); }
  _ownerName(m) { return svc()._actorOf(m)?.name || 'someone'; }

  /** A shared contact: the Data Drop, small enough to live in the line. Plays once, when it arrives while the chat is open. */
  _card(l, mine) {
    const c = l.card || {};
    const color = hueOf(c.name);
    const from = mine ? 'You' : (l.fromName || 'Someone');
    const parts = [c.email ? `<span class="ncm-conv__dropv"><i class="fas fa-envelope"></i>${esc(c.email)}</span>` : '', c.phone ? `<span class="ncm-conv__dropv"><i class="fas fa-phone"></i>${esc(c.phone)}</span>` : ''].join('');
    const saved = this._hasCard(c);
    const sendOnly = c.email && game.nightcity?.masterContactService?.isSendOnly?.(c.email);
    const foot = mine ? '<span class="ncm-conv__dropdone"><i class="fas fa-check"></i> Shared with everyone here</span>'
      : (this.admin || !game.actors?.get(this.actorId)) ? ''
      : saved ? '<span class="ncm-conv__dropdone is-saved"><i class="fas fa-circle-check"></i> In your contacts</span>'
      : sendOnly ? '' : btn('Save contact', 'fa-user-plus', `data-cv="savecard" data-id="${esc(l.lineId)}" data-tooltip="Adds them to your contacts. If you already have them, this only adds what you were missing"`, 'ncm-conv__btn--go');
    return `<div class="ncm-conv__drop${this._fresh.has(l.lineId) ? ' is-fresh' : ''}" style="--c:${color}"><div class="ncm-conv__droptop"><i class="fas fa-share-nodes"></i> Data Drop<span class="ncm-conv__droproute"><span class="dot">${esc(from)}</span><span class="wire"><span class="fill"></span></span><span class="dot">Everyone here</span></span></div>
      <div class="ncm-conv__dropbody"><span class="ncm-conv__sweep"></span>${avatar({ name: c.name, img: c.portrait })}<div class="ncm-conv__dropinfo"><span class="ncm-conv__dropname">${esc(c.name)}</span>${c.role ? `<span class="ncm-conv__droprole">${esc(c.role)}</span>` : ''}${parts}</div></div>
      ${foot ? `<div class="ncm-conv__dropfoot">${foot}</div>` : ''}</div>`;
  }

  /** Do they already have everything this card carries? */
  _hasCard(c) {
    const list = game.actors?.get(this.actorId)?.getFlag?.(MODULE_ID, 'contacts') || [];
    const mail = String(c.email || '').toLowerCase();
    const home = game.nightcity?.callService?.homeCode;
    const num = (n) => { try { return parseNumber(n, home).key || n; } catch { return n; } };
    const had = list.find((x) => (c.contactId && x.masterContactId === c.contactId) || (mail && String(x.email || '').toLowerCase() === mail) || (c.phone && x.phone && num(x.phone) === num(c.phone)));
    return !!had && (!c.email || !!had.email) && (!c.phone || !!had.phone);
  }

  _bar(c, me) {
    if (!this.gm && me && !isIn(me)) {
      const out = svc().lines(c.id).filter((l) => l.kind === 'system' && canSee(me, l.seq)).at(-1);
      return `<div class="ncm-conv__gone"><i class="fas fa-user-minus"></i> You are no longer in this conversation. You can still read what you had, but nothing new will reach you.${out ? '' : ''}</div>`;
    }
    if (this.gm && !me) return `<div class="ncm-conv__obs"><i class="fas fa-eye"></i><span><b>You're only watching.</b> Players can't tell, and nothing is marked read.</span>${btn('Join as an NPC…', 'fa-user-plus', 'data-cv="join" data-tooltip="Adds an NPC to the conversation. Everyone sees a line saying they joined"')}</div>`;
    const net = game.nightcity?.networkService;
    const offline = !this.admin && !game.users?.activeGM ? 'No GM is online. Your lines wait here and send when one connects.' : !this.admin && net?.isDeadZone ? 'No signal here. Your lines wait and send when you have signal.' : '';
    let top = '';
    if (this.gm) {
      const chips = this._speakers(c).map((m, i) => { const on = m.key === me.key; return `<button type="button" class="ncm-conv__aspick${on ? ' is-on' : ''}" data-cv="as" data-id="${esc(m.key)}" aria-pressed="${on}"${i < 9 ? ` data-tooltip="Alt+${i + 1}"` : ''}>${avatar(svc()._displayOf(m))}${esc(m.name)}</button>`; }).join('');
      top = `<div class="ncm-conv__as"><span class="ncm-conv__aslabel">Speaking as</span><span class="ncm-conv__asrow">${chips}${ic('fa-user-plus', 'Bring in another NPC. Everyone sees a line saying they joined', 'data-cv="join"')}</span></div>`;
    } else if (this._isAlias(me)) top = `<div class="ncm-conv__as"><i class="fas fa-mask"></i><span>You are in this as <b class="ncm-conv__asb">${esc(me.name)}</b>. Everyone here only ever sees ${esc(me.name)}.</span></div>`;
    const place = this.gm ? `Write as ${me.name}…  Enter sends` : offline ? 'Write a line, it sends when it can…' : 'Write a line…  Enter sends';
    return `<div class="ncm-conv__bar">${offline ? `<div class="ncm-conv__alert"><i class="fas fa-triangle-exclamation"></i> ${esc(offline)}</div>` : ''}${top}
      <div class="ncm-conv__write"><div class="ncm-conv__field"><textarea class="ncm-conv__input" rows="1" maxlength="${LINE_MAX}" placeholder="${esc(place)}" aria-label="Write a line"></textarea>
        <button type="button" class="ncm-conv__emojibtn" data-cv="emoji" aria-label="Add an emoji" data-tooltip="Add an emoji"><i class="far fa-face-smile"></i></button>
        <div class="ncm-conv__emojipop" data-emoji-pop hidden>${Object.entries(CHAT_EMOJI).map(([group, list]) => `<div class="ncm-conv__emojihd">${esc(group)}</div><div class="ncm-conv__emojigrid">${list.map((e) => `<button type="button" data-cv="emojipick" data-e="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`).join('')}</div></div>
        <span class="ncm-conv__plus">${ic('fa-plus', 'Add a picture, a number or a contact', 'data-cv="plus"')}${this.plus ? this._plusMenu(me) : ''}</span>
        ${this.admin ? '' : btn('Send as mail', 'fa-envelope', 'data-cv="asmail" data-tooltip="For encryption, self-destruct, eddies or a shard: opens the composer addressed to everyone here"')}
        ${btn(offline ? 'Queue' : 'Send', offline ? 'fa-clock' : 'fa-paper-plane', 'data-cv="send"', 'ncm-conv__btn--go')}</div></div>`;
  }

  _myNumber(me) {
    const cs = game.nightcity?.callService;
    const actor = svc()._actorOf(me);
    if (cs && !actor && me?.contactId) { const c = svc().directory.find((x) => x.id === me.contactId); return c ? gmNumberOf(c) : ''; }
    if (!cs || !actor) return '';
    const lines = cs.linesFor(actor.id);
    const line = this._isAlias(me) ? lines.find((l) => l.contactId === me.contactId) : lines.find((l) => l.main);
    return line?.number || '';
  }

  _plusMenu(me) {
    const num = this._myNumber(me);
    return `<span class="ncm-conv__plusmenu"><button type="button" class="ncm-conv__rowbtn" data-cv="img"><i class="fas fa-image"></i> Picture</button>
      <button type="button" class="ncm-conv__rowbtn" data-cv="mynum"${num ? '' : ' disabled data-tooltip="You have no number for this name"'}><i class="fas fa-phone"></i> My number${num ? ` <small>${esc(num)}</small>` : ''}</button>
      <button type="button" class="ncm-conv__rowbtn" data-cv="pick"><i class="fas fa-address-card"></i> A contact…</button></span>`;
  }

  _panel(c, me) {
    const starter = this.gm || (me && c.starterKey === me.key);
    const mine = this._mine;
    const rows = c.members.filter(isIn).map((m) => {
      const you = mine.has(m.key);
      const who = svc()._displayOf(m);
      const detail = this.gm ? (svc().isNpc(m) ? (this._isAlias(m) ? `NPC · alias of ${this._ownerName(m)}` : 'NPC') : `Played by ${this._playerOf(m)}`) : (m.email || '');
      const read = this.gm ? `<span class="ncm-conv__maddr">${esc(this._readWord(c, m))}</span>` : '';
      return `<div class="ncm-conv__member">${avatar(who)}<div><span class="ncm-conv__mname">${you ? 'You' : esc(who.name)}${m.key === c.starterKey ? ' · started it' : ''}</span><span class="ncm-conv__maddr">${esc(detail)}</span>${read}</div>${!you && starter ? ic('fa-user-minus', `Remove ${who.name}. They keep what they had on screen and get nothing new`, `data-cv="remove" data-id="${esc(m.key)}"`) : ''}</div>`;
    }).join('');
    return `<aside class="ncm-conv__panel"><div class="ncm-conv__panelhd"><span>Members · ${c.members.filter(isIn).length}</span>${ic('fa-xmark', 'Close members', 'data-cv="panel"')}</div>
      <div class="ncm-conv__panelbody">${rows}</div>
      <div class="ncm-conv__panelfoot">${btn('Add someone', 'fa-user-plus', 'data-cv="add"')}${starter ? btn('Rename', 'fa-pen', 'data-cv="rename"') : ''}
      ${this.gm ? btn('Delete conversation', 'fa-trash', 'data-cv="delete"', 'ncm-conv__btn--bad') : btn('Leave', 'fa-right-from-bracket', 'data-cv="leave"', 'ncm-conv__btn--bad')}</div></aside>`;
  }

  _playerOf(m) { const a = svc()._actorOf(m); const u = a ? game.users?.find?.((x) => !x.isGM && a.testUserPermission(x, 'OWNER')) : null; return u?.name || 'nobody online'; }

  /** How far they have read, from the users who play them. An NPC has read everything up to when it last spoke. */
  _readWord(c, m) {
    if (svc().isNpc(m)) { const w = svc().waiting(c); return w.n ? `${w.n} waiting on an answer` : 'Up to date'; }
    const a = svc()._actorOf(m);
    let best = 0;
    for (const u of game.users || []) if (!u.isGM && a?.testUserPermission(u, 'OWNER')) best = Math.max(best, Number(u.getFlag?.(MODULE_ID, 'conversationState')?.[c.id]?.read?.[m.key]) || 0);
    return best >= c.lastSeq ? 'Read to the end' : best ? `${c.lastSeq - best} unread` : 'Not opened yet';
  }

  _paintPending() {
    const box = this.host?.querySelector('[data-pending]');
    if (!box || !this.id) return;
    box.innerHTML = svc().pendingFor(this.id).map((p) => {
      const word = p.state === 'queued' ? ['fa-clock', 'Queued'] : p.state === 'failed' ? ['fa-triangle-exclamation', 'Not sent'] : ['fa-circle-notch fa-spin', 'Sending'];
      const body = p.kind === 'card' ? `<div class="ncm-conv__bubble">[${esc(p.card?.name || 'contact')}]</div>` : p.kind === 'image' ? '<div class="ncm-conv__bubble">[picture]</div>' : `<div class="ncm-conv__bubble">${esc(p.text)}</div>`;
      return `<article class="ncm-conv__m is-mine is-pending" data-pend="${esc(p.lineId)}"><div style="min-width:0">${body}<div class="ncm-conv__state${p.state === 'failed' ? ' is-bad' : ''}"><i class="fas ${word[0]}"></i>${word[1]}${p.reason ? ` · ${esc(p.reason)}` : ''}${p.state === 'failed' ? ` <button type="button" class="ncm-conv__link" data-cv="retry" data-id="${esc(p.lineId)}">Try again</button> <button type="button" class="ncm-conv__link" data-cv="discard" data-id="${esc(p.lineId)}">Discard</button>` : ''}</div></div></article>`;
    }).join('');
  }

  // ─── live updates ───

  /** New lines reached this client. They append; nothing else moves. */
  onLines(lines) {
    const c = this.conv;
    if (!c || !this.host?.isConnected) return;
    const box = this.host.querySelector('[data-lines]'), sc = this.host.querySelector('[data-scroll]');
    if (!box || !sc) return;
    const stick = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 40;
    const mine = this.admin ? null : svc().membersOf(c, this.actorId);
    const all = this._linesFor(c);
    for (const line of lines) {
      if (mine && !mine.some((m) => canSee(m, line.seq))) continue;
      const at = all.findIndex((l) => l.lineId === line.lineId);
      const had = box.querySelector(`[data-line="${CSS.escape(line.lineId)}"]`);
      if (had) { const tmp = document.createElement('div'); tmp.innerHTML = this._lineHtml(line, at > 0 ? all[at - 1] : null, c, { noDay: true }); had.replaceWith(...tmp.children); continue; }
      if (line.kind === 'card') this._fresh.add(line.lineId);
      box.querySelector('.ncm-conv__rule:only-child')?.remove();
      box.insertAdjacentHTML('beforeend', this._lineHtml(line, at > 0 ? all[at - 1] : null, c));
      this._fresh.delete(line.lineId);
    }
    this._dedupeDays();
    this._paintPending();
    if (stick) sc.scrollTop = sc.scrollHeight;
    this._read(c);
  }

  // ─── what you can do ───

  _wire() {
    const h = this.host;
    h.querySelector('[data-scroll]')?.addEventListener('scroll', (e) => { if (this.id) this.scrolls.set(this.id, e.target.scrollTop); }, { passive: true });
    if (h === this._wiredHost) return;
    this._wiredHost = h;
    h.addEventListener('click', (e) => {
      const t = e.target.closest('[data-cv]');
      if (!e.target.closest('[data-emoji-pop], [data-cv="emoji"]')) this._emojiPop(false);
      if (t && !t.disabled) this._act(t.dataset.cv, t, e); else if (this.plus && !e.target.closest('.ncm-conv__plus')) { this.plus = false; this.paint(); }
    });
    h.addEventListener('input', (e) => { if (e.target.matches('.ncm-conv__input')) { this.drafts.set(this.id, e.target.value); this._grow(e.target); } });
    h.addEventListener('keydown', (e) => {
      if (!e.target.matches('.ncm-conv__input')) return;
      if (e.key === 'Escape') this._emojiPop(false);
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
      if (this.gm && e.altKey && /^[1-9]$/.test(e.key)) { const m = this._speakers(this.conv)[Number(e.key) - 1]; if (m) { e.preventDefault(); this._speakAs(m.key); } }
    });
  }

  /** Swap who the GM is speaking as. What was typed stays, and the box keeps focus so the next line can follow at once. */
  _speakAs(key) {
    this.asKey.set(this.id, key);
    this._hadFocus = true; this._caret = this.host?.querySelector('.ncm-conv__input')?.selectionStart ?? null;
    const sc = this.host?.querySelector('[data-scroll]');
    if (sc) this.scrolls.set(this.id, sc.scrollTop);
    this.paint();
  }

  _emojiPop(open) { const pop = this.host?.querySelector('[data-emoji-pop]'); if (pop) pop.hidden = open === undefined ? !pop.hidden : !open; }

  /** At the caret, over any selection, up to the line's limit. The palette stays open for a second one. */
  _insertEmoji(e) {
    const box = this.host?.querySelector('.ncm-conv__input');
    if (!box || box.value.length + e.length > LINE_MAX) return;
    box.focus({ preventScroll: true });
    box.setRangeText(e, box.selectionStart, box.selectionEnd, 'end');
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  _grow(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; }

  async _send() {
    const box = this.host?.querySelector('.ncm-conv__input');
    const text = box?.value.trim();
    const me = this.me;
    if (!text || !me) return;
    box.value = ''; this.drafts.delete(this.id); this._grow(box);
    const sc = this.host.querySelector('[data-scroll]');
    const send = svc().send(this.id, { asKey: me.key, kind: 'text', text });
    this._paintPending();
    if (sc) sc.scrollTop = sc.scrollHeight;
    await send;
  }

  async _act(a, t) {
    const c = this.conv;
    if (!c) return;
    const me = this.me;
    const gm = this.admin || !!game.user?.isGM;
    switch (a) {
      case 'send': return this._send();
      case 'panel': this.panel = !this.panel; return this.paint();
      case 'plus': this.plus = !this.plus; return this.paint();
      case 'emoji': return this._emojiPop();
      case 'emojipick': return this._insertEmoji(t.dataset.e);
      case 'as': return this._speakAs(t.dataset.id);
      case 'mute': await svc().setMuted(c.id, !svc().isMuted(c.id)); return this.paint();
      case 'bell': await svc().setGmWatch(c.id, !svc().gmWatches(c)); return this.paint();
      case 'earlier': { const sc = this.host.querySelector('[data-scroll]'); const from = sc.scrollHeight - sc.scrollTop; this.pages.set(c.id, (this.pages.get(c.id) ?? 2) + 2); this.scrolls.delete(c.id); this.paint(); sc?.isConnected; const s2 = this.host.querySelector('[data-scroll]'); s2.scrollTop = s2.scrollHeight - from; return undefined; }
      case 'retry': await svc().retry(c.id, t.dataset.id); return this._paintPending();
      case 'discard': svc().discard(c.id, t.dataset.id); return this._paintPending();
      case 'asmail': return this._asMail(c, me);
      case 'img': this.plus = false; this.paint(); return this._pickImage(c, me);
      case 'mynum': this.plus = false; this.paint(); return this._shareMine(c, me);
      case 'pick': this.plus = false; this.paint(); return this._shareContact(c, me);
      case 'savecard': return this._saveCard(c, t.dataset.id);
      case 'add': { const raws = await pickPeople(this.actorId, { gm, title: 'Add who?' }); for (const raw of raws || []) { const r = await svc().add(c.id, me?.key || null, raw); if (!r.ok) ui.notifications?.warn(`NCM | ${r.error}`); } return this.paint(); }
      case 'join': {
        const raw = await pickNpc('Join as which NPC?');
        if (!raw) return undefined;
        const r = await svc().add(c.id, null, raw);
        if (!r.ok) { ui.notifications?.warn(`NCM | ${r.error}`); return this.paint(); }
        saveRecent(pushRecentNpc(readRecent(), raw));
        const joined = svc().get(c.id)?.members.find((m) => isIn(m) && ((raw.contactId && m.contactId === raw.contactId) || (raw.actorId && m.actorId === raw.actorId)));
        if (joined) this.asKey.set(c.id, joined.key);
        return this.paint();
      }
      case 'remove': {
        const target = c.members.find((m) => m.key === t.dataset.id);
        const ok = await themedConfirm({ title: 'Remove from this conversation', yes: 'Remove', yesIcon: 'fas fa-user-minus', bad: true, content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-user-minus', title: target?.name || 'Them', kind: 'Conversation', lead: '**They keep what they had on screen and get nothing new.** Everyone sees a line saying so.' }) });
        if (ok) { const r = await svc().remove(c.id, me?.key || null, t.dataset.id); if (!r.ok) ui.notifications?.warn(`NCM | ${r.error}`); }
        return this.paint();
      }
      case 'leave': {
        const ok = await themedConfirm({ title: 'Leave this conversation', yes: 'Leave', yesIcon: 'fas fa-right-from-bracket', bad: true, content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-right-from-bracket', title: titleFor(c, this._mine), kind: 'Conversation', lead: '**You keep what you can see now and get nothing new.** Everyone sees a line saying you left.' }) });
        if (ok) { const r = await svc().leave(c.id, me.key); if (!r.ok) ui.notifications?.warn(`NCM | ${r.error}`); this.panel = false; }
        return this.paint();
      }
      case 'rename': {
        const v = await themedPrompt({ title: 'Name this conversation', label: 'Save', content: dialogBodyHtml({ icon: 'fas fa-pen', title: titleFor(c, this._mine), kind: 'Conversation', field: { name: 'ncmConvTitle', label: 'Name', value: c.title, placeholder: 'Blank shows the names' } }), read: (root) => root.querySelector('input')?.value ?? '' });
        if (v !== null && v !== undefined) { const r = await svc().rename(c.id, me?.key || null, v); if (!r.ok) ui.notifications?.warn(`NCM | ${r.error}`); }
        return this.paint();
      }
      case 'rmline': { const r = await svc().removeLine(c.id, t.dataset.id); if (!r.ok) ui.notifications?.warn(`NCM | ${r.error}`); return undefined; }
      case 'delete': {
        const ok = await themedConfirm({ title: 'Delete this conversation', yes: 'Delete', yesIcon: 'fas fa-trash', bad: true, content: dialogBodyHtml({ tone: 'bad', icon: 'fas fa-trash', title: titleFor(c), kind: 'Conversation', lead: '**Every line goes, for everyone.** This can\'t be undone.' }) });
        if (ok) await svc().destroy(c.id);
        return undefined;
      }
      default: return undefined;
    }
  }

  /** Send as mail: the composer, addressed to everyone here, as the name you are in this chat under. It leaves no line behind. */
  _asMail(c, me) {
    const others = c.members.filter((m) => isIn(m) && m.key !== me?.key);
    const box = this.host.querySelector('.ncm-conv__input');
    const body = box?.value.trim() || '';
    const actor = me ? svc()._actorOf(me) : null;
    game.nightcity?.composeMessage?.({ fromActorId: actor?.id, fromContactId: me?.contactId || undefined, recipients: others.map((m) => ({ actorId: m.actorId, contactId: m.contactId, email: m.email, name: m.name })), body });
    if (box) { box.value = ''; this.drafts.delete(this.id); this._grow(box); }
  }

  async _pickImage(c, me) {
    const send = (img) => svc().send(c.id, { asKey: me.key, kind: 'image', img }).then(() => this._paintPending());
    if (game.user?.can?.('FILES_BROWSE') && typeof FilePicker !== 'undefined') { new FilePicker({ type: 'image', callback: (path) => send(path) }).render(true); return; }
    const v = await themedPrompt({ title: 'Share a picture', label: 'Send', content: dialogBodyHtml({ icon: 'fas fa-image', title: 'A picture', kind: 'Conversation', field: { name: 'ncmConvPic', label: 'Picture', placeholder: 'Path or web address' } }), read: (root) => root.querySelector('input')?.value ?? '' });
    if (v) await send(v);
  }

  _fullNumber(n) {
    const home = game.nightcity?.callService?.homeCode;
    try { const p = parseNumber(n, home); return p?.done ? fullForm(p) || n : n; } catch { return n; }
  }

  async _shareMine(c, me) {
    const number = this._myNumber(me);
    if (!number) return;
    const who = svc()._displayOf(me);
    await svc().send(c.id, { asKey: me.key, kind: 'card', card: { name: who.name, phone: this._fullNumber(number), portrait: who.img, contactId: me.contactId } });
    this._paintPending();
  }

  async _shareContact(c, me) {
    const gm = this.admin || !!game.user?.isGM;
    const list = contactChoices(this.actorId, { gm });
    const pick = await showNamePicker({ admin: gm, title: 'Share which contact?', hint: 'A contact locked with ICE can\'t be shared.', placeholder: 'search names and addresses…', entries: list.map((e) => ({ id: e.id, name: e.name, group: e.group, sub: e.sub, img: e.img })) });
    const hit = list.find((e) => e.id === pick?.id);
    if (!hit) return;
    const src = hit.source || {};
    const phone = gm ? gmNumberOf(src) : (game.nightcity?.callService?.numberForContact?.(src) || src.phone || '');
    const email = src.email || '';
    if (!email && !phone) { ui.notifications?.warn(`NCM | ${hit.name} has no address or number to share.`); return; }
    let what = 'both';
    if (email && phone) {
      what = await themedPrompt({ title: 'What to share', label: 'Share', icon: 'fas fa-share-nodes', content: dialogBodyHtml({ icon: 'fas fa-share-nodes', title: hit.name, kind: 'Share', lead: 'Everyone here can save what you share.', extraHtml: `<label class="ncm-dlgb__field"><span class="ncm-dlgb__fk">Share</span><select><option value="both">Address and number</option><option value="email">Address only</option><option value="number">Number only</option></select></label>` }), read: (root) => root.querySelector('select')?.value });
      if (!what) return;
    }
    const card = { name: hit.name, role: src.role || '', portrait: src.portrait || '', contactId: src.masterContactId || (gm ? src.id : '') || '', email: what === 'number' ? '' : email, phone: what === 'email' ? '' : this._fullNumber(phone) };
    const sent = await svc().send(c.id, { asKey: me.key, kind: 'card', card });
    if (sent && !sent.ok && sent.error) ui.notifications?.warn(`NCM | ${sent.error}`);
    this._paintPending();
  }

  /** Nothing goes into anyone's contacts by itself. If they have them already, this only adds what was missing. */
  async _saveCard(c, lineId) {
    const line = svc().lines(c.id).find((l) => l.lineId === lineId);
    const card = line?.card;
    const actorId = this.actorId;
    if (!card || !actorId) return;
    const contact = { name: card.name, email: card.email || '', phone: card.phone || '', portrait: card.portrait || '', role: card.role || '', masterContactId: card.contactId || null };
    const merged = await game.nightcity?.contactShareService?._mergeExisting?.(actorId, contact);
    if (!merged) {
      const res = await game.nightcity?.contactRepository?.addContact?.(actorId, contact);
      if (res && res.success === false) { ui.notifications?.warn(`NCM | ${res.error}`); return; }
    }
    const row = this.host?.querySelector(`[data-line="${CSS.escape(lineId)}"]`);
    if (row) { const tmp = document.createElement('div'); tmp.innerHTML = this._lineHtml(line, null, c); const next = tmp.querySelector('article'); next?.classList.add('is-cont'); if (next) { next.querySelector('.ncm-conv__drop')?.classList.add('is-savednow'); row.querySelector('.ncm-conv__drop')?.replaceWith(next.querySelector('.ncm-conv__drop')); } }
  }
}

/**
 * Start a conversation: who is in it, an optional name, and who you are in it. That name is fixed, or everyone would see two names are one person.
 * The GM joins as an NPC: the recent ones are one click, anyone else one search. It starts on the NPC whose inbox is open.
 * @param {{host: HTMLElement, actorId?: string, gm?: boolean}} o
 * @returns {Promise<string|null>} the new conversation's id
 */
export function startConversationDialog({ host, actorId = null, gm = false }) {
  return new Promise((resolve) => {
    const s = svc();
    const choices = gm ? [] : s.joinChoices(actorId);
    const recent = gm ? recentNpcs() : [];
    const openNpc = gm && actorId ? game.actors?.get(actorId) : null;
    const openIsNpc = gm && actorId && (openNpc ? !openNpc.hasPlayerOwner : s.directory.some((c) => c.id === actorId));
    const startAs = openIsNpc ? (s.joinChoices(actorId).find((c) => !c.alias) || null) : null;
    const st = { people: [], as: gm ? (startAs || recent[0] || null) : choices[0] };
    const scrim = document.createElement('div');
    scrim.className = 'ncm-conv__scrim';
    const close = (v) => { scrim.remove(); resolve(v); };
    /** The picked NPC first if they aren't a recent one, so the choice always shows. */
    const asChips = () => {
      const list = st.as && !recent.some((r) => npcKey(r) === npcKey(st.as)) ? [st.as, ...recent] : recent;
      return list.map((r) => { const on = npcKey(r) === npcKey(st.as); return `<button type="button" class="ncm-conv__aspick${on ? ' is-on' : ''}" data-as-key="${esc(npcKey(r))}" aria-pressed="${on}">${avatar(s._displayOf(r))}${esc(r.name || s._displayOf(r).name)}</button>`; }).join('');
    };
    const paint = () => {
      const canJoin = gm || choices.length > 1;
      scrim.innerHTML = `<div class="ncm-conv__dlg" role="dialog" aria-label="New conversation"><div class="ncm-conv__dlghd">New conversation</div><div class="ncm-conv__dlgbody">
        <div class="ncm-conv__fl">Who's in it<div class="ncm-conv__chips" style="margin-top:4px">${st.people.map((p, i) => `<span class="ncm-conv__chip" style="--c:${hueOf(p.name)}">${esc(p.name)} <button type="button" class="ncm-conv__chipx" data-x="${i}" aria-label="Take ${esc(p.name)} out"><i class="fas fa-xmark"></i></button></span>`).join('')}${btn('Add people…', 'fa-user-plus', 'data-do="add"')}</div></div>
        <label class="ncm-conv__fl">Name (optional)<input type="text" data-title maxlength="60" placeholder="Blank shows the names" value="${esc(st.title || '')}"></label>
        ${canJoin ? `<div class="ncm-conv__fl" data-tooltip="Everyone in this conversation sees this name. It can't change later, or they would see the two names are one person">Join as${gm ? `<div class="ncm-conv__chips" style="margin-top:4px">${asChips()}${btn(st.as ? 'Someone else…' : 'Pick an NPC…', 'fa-masks-theater', 'data-do="asnpc"')}</div>` : `<select class="ncm-conv__dlgsel" data-as>${choices.map((c, i) => `<option value="${i}"${c === st.as ? ' selected' : ''}>${esc(c.name)}${c.email ? ` · ${esc(c.email)}` : ''}</option>`).join('')}</select>`}</div>` : ''}
        ${st.err ? `<div class="ncm-conv__alert"><i class="fas fa-triangle-exclamation"></i> ${esc(st.err)}</div>` : ''}
      </div><div class="ncm-conv__dlgft">${btn('Cancel', '', 'data-do="cancel"')}${btn('Start', 'fa-comments', 'data-do="go"', 'ncm-conv__btn--go')}</div></div>`;
    };
    scrim.addEventListener('input', (e) => { if (e.target.matches('[data-title]')) st.title = e.target.value; });
    scrim.addEventListener('change', (e) => { if (e.target.matches('[data-as]')) st.as = choices[Number(e.target.value)]; });
    scrim.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-x]');
      if (x) { st.people.splice(Number(x.dataset.x), 1); paint(); return; }
      const chip = e.target.closest('[data-as-key]');
      if (chip) { st.as = [st.as, ...recent].find((r) => r && npcKey(r) === chip.dataset.asKey) || st.as; st.err = ''; paint(); return; }
      const d = e.target.closest('[data-do]')?.dataset.do;
      if (d === 'cancel') close(null);
      if (d === 'add') {
        const raws = await pickPeople(actorId, { gm, title: 'Who is in it?' });
        for (const r of raws || []) if (!st.people.some((p) => (p.contactId && p.contactId === r.contactId) || (p.email && p.email === r.email) || (p.actorId && p.actorId === r.actorId))) st.people.push(r);
        paint();
      }
      if (d === 'asnpc') { const raw = await pickNpc('Join as which NPC?'); if (raw) { st.as = raw; st.err = ''; } paint(); }
      if (d === 'go') {
        if (!st.as) { st.err = 'Pick who you are in it.'; return paint(); }
        if (!st.people.length) { st.err = 'Add someone to talk to.'; return paint(); }
        const others = st.people.filter((p) => !(npcKey(p) && npcKey(p) === npcKey(st.as)));
        if (!others.length) { st.err = 'Add someone to talk to.'; return paint(); }
        const res = await s.start({ as: st.as, members: others, title: st.title });
        if (!res.ok) { st.err = res.error || 'That did not work.'; return paint(); }
        if (res.refused?.length) ui.notifications?.warn(`NCM | ${res.refused.join(' ')}`);
        if (gm) saveRecent(pushRecentNpc(readRecent(), st.as));
        close(res.id);
      }
      return undefined;
    });
    paint();
    host.appendChild(scrim);
  });
}

export { visibleLines, previewOf };
