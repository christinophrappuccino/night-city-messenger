/**
 * MessagesTab — Admin → Messages, reorganised by the job (2026-10-27 redesign).
 * @file scripts/ui/AdminPanel/tabs/MessagesTab.js
 * @module night-city-messenger
 *
 * Mock: dev/mockups/admin-messages-redesign-mock.html. Four sub-tabs:
 *   NEEDS A REPLY  player mail waiting on an NPC, one row per NPC inbox × the
 *                  alias it was written to; the conversation + an inline reply
 *   ALL MAIL       the activity feed as list + reading pane, grouped by day,
 *                  fan-out collapsed, flag chips, "Who" scope picker, dates
 *   OUTBOX         didn't arrive (failure log) · waiting to deliver (held mail)
 *                  · scheduled · timers (self-destruct)
 *   INBOXES        every mailbox: counts, open, ⋯ mark read / export / purge / delete
 * Header: Send as (scope picker), Broadcast (inline), New.
 *
 * The rules live in ./messagesModel.js (pure). New buttons go through
 * `data-action="tabAct" data-owner="messages" data-op="…"` → onAct. The older
 * static actions (openMsgInInbox, hardDeleteMessage, cancelScheduled…) are
 * still registered and still used where they fit.
 *
 * Template context lives under ONE key, `msg2` (AdminPanelApp spreads every
 * tab's context into one object).
 */

import { domainOf } from '../../../utils/junkSenders.js';
import { MODULE_ID, SOCKET_OPS, EVENTS } from '../../../utils/constants.js';
import {
  log, formatCyberDate, getPlayerCharacters, isPersonActor, resolveDisplayPortrait, resolveDisplayName,
  ANON_DEFAULT_ALIAS, ANON_MASKED_EMAIL, normalizeAnonStyle,
} from '../../../utils/helpers.js';
import { getInitials, getRoleIcon } from '../../../utils/designHelpers.js';
import { MessageRepository } from '../../../data/MessageRepository.js';
import { DateRangePicker } from '../../components/DateRangePicker.js';
import { BaseTab } from '../BaseTab.js';
import { adminDialog, adminConfirm } from '../../../utils/adminTheme.js';
import { identityRole, identitiesOfContact, identitiesOf, voiceInfo } from '../../../utils/identities.js';
import { ScopePicker } from '../../../utils/scopePicker.js';
import { BUILT_IN_ROLES } from '../../../utils/contactVocab.js';
import { showNamePicker } from '../../../utils/namePicker.js';
import { cleanHtml } from '../../../utils/richText.js';
import {
  baseIdOf, convKey, senderKeys, targetKeys, isAnswered, pruneAnswered, convPasses, sortConversations,
  DESK_FILTERS, deskQueue, deskDefaultKey, deskThread, identityOrder, deskVoice, deskSentLine,
  MAIL_FLAGS, journeyTrack, journeySegs, journeyPeople, journeyStatus, INBOX_VIEWS, INBOX_GROUPS, INBOX_SORTS, QUIET_DAYS, BUSY_DAYS, slotMetric, postmarkCode, inboxTraffic, inboxPasses, inboxViewCounts, groupInboxes, applyMailFilters, flagCounts, foldShut, inboxGroupDefaultOpen, recordFold, purgeable, deliveryLine, groupDeliveryLine,
  calendarCounts, yearTiles, monthCells, weekStrip, calRange, inRange, calStateFor, calStep, calUp, calCrumbs, daySplit, orderBands, calHome, isoWeek, dow, WEEKDAYS_SHORT, WEEKDAYS_LONG, MONTHS_LONG,
} from './messagesModel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The Desk's folds (queue / persona), per window for the session: app id → { q, p } (null = default).
const DESK_FOLDS = new Map();
const imgOk = (src) => (src && !String(src).includes('mystery-man') ? src : '');
const isPlayerActor = (id) => !!(id && game.actors?.get(id)?.hasPlayerOwner);

/** Flag pills on a mail row / in the reading pane: [key, label, icon, tone]. */
const FLAG_LOOK = {
  anon: ['Anonymous', 'fa-user-secret', 'muted'], group: ['Group', 'fa-users', 'sec'], via: ['via', 'fa-terminal', 'sec'],
  typed: ['typed by', 'fa-user-ninja', 'danger'], eb: ['eb', 'fa-coins', 'accent'], sd: ['Self-destruct', 'fa-hourglass-half', 'danger'],
  enc: ['Encrypted', 'fa-lock', 'danger'], att: ['Attachment', 'fa-paperclip', 'accent'], alias: ['alias', 'fa-masks-theater', 'muted'],
  spam: ['In Spam', 'fa-filter', 'muted'], junk: ['Junk sender', 'fa-ban', 'danger'], prio: ['', 'fa-triangle-exclamation', 'danger'], sent: ['Sent copy', 'fa-paper-plane', 'muted'],
  deleted: ['Deleted', 'fa-trash', 'muted'], held: ['Held', 'fa-hourglass-half', 'accent'], failed: ['Not delivered', 'fa-triangle-exclamation', 'danger'], dated: ['Backdated', 'fa-clock-rotate-left', 'muted'], net: ['', 'fa-wifi', 'muted'],
};
const flag = (k, extra = '') => { const [l, icon, tone] = FLAG_LOOK[k]; return { label: [l, extra].filter(Boolean).join(' '), icon, tone }; };

export class MessagesTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** Sub-tab: reply | all | outbox | inboxes */
  _view = 'reply';

  // ── All mail (the activity feed) ──
  /** @type {string} Direction filter kept for scripts/sims: 'all' | 'received' | 'sent' | 'unread' */
  _filter = 'all';
  _search = '';
  /** Legacy single actor filter (macros/older callers); the "Who" picker is the UI now. */
  _actorFilter = '';
  _expandedId = null;
  _dateFrom = '';
  _dateTo = '';
  _limit = 40;
  _oldest = false;          // All mail order: false = newest first
  // ── The CALENDAR NAVIGATOR (the left column, 2026-10-28 — messagesModel.calendarCounts & co.) ──
  _calLevel = 'year';       // year | month | week | day
  _calYear = 0;             // 0 = not placed yet → calHome(now) on the first render
  _calMonth = 0;            // 0..11
  _calWeek = 0;             // Monday start (ms) of the week in view (week / day levels)
  _calDay = 0;              // UTC day start (ms) of the day in view
  _calViaWeek = false;      // the day was opened from a week → Esc goes back to the week
  _calLimit = 50;           // the level's list is paged 50 at a time
  _calAnim = '';            // the entrance the next render plays once: grow | fold | step-next | step-prev | up
  _calFollow = false;       // openTo(message): land on the day holding it
  _calAuto = false;         // a search / filter changed: an empty view jumps to the newest hit
  _calGridH = 0;            // month level: the grid's height after the GM dragged the grip (0 = natural), this session
  /** The open message's Reply-as identities and inboxes (one button each; a picker when there are several). */
  _acts = null;
  /** Selected feed row (message id or fanout:<base>). */
  _sel = null;
  /** Everything / From players / From NPCs */
  _box = 'all';
  /** Lit flag chips. */
  _af = new Set();
  /** Delivery lines the GM opened (message ids) — kept across re-renders. */
  _dlOpen = new Set();
  _jrShut = true;           // "Where it went" folded (starts folded, dev 2026-10-28) — one choice for every message, remembered this session
  _jrFilter = new Map();    // messageId → the group filter chip picked (problem | unread | read | all)
  /** Copies nudged this session, as messageId|actorId (fan-out copies share an id). */
  _dlNudged = new Set();

  // ── Needs a reply ──
  _deskQuiet = false;      // the Desk: show the count of NPC inboxes nobody wrote to
  _rFilt = 'all';           // the Desk's queue chip: all | waiting | answered
  _deskSent = null;         // { key, as, to } — the conversation just answered, for the "Sent as …" line
  /** "Include mail I sent" — also list mail the GM sent TO NPCs. */
  _npcInboxIncludeGm = false;
  _npcInboxUnreadOnly = false;   // legacy (old NPC Inbox chip)
  _npcInboxSort = 'recent';      // legacy
  _npcInboxExpanded = new Set(); // legacy
  _convSel = null;
  _rpasFor = null;
  _replyAnon = false;
  /** Unsent reply text per conversation key — survives re-renders. */
  _drafts = new Map();

  // ── Inboxes ──
  _ibSearch = '';
  _ibView = 'all';          // Inboxes: view chip (messagesModel.INBOX_VIEWS)
  _ibGroup = 'kind';        // Inboxes: kind | role | org
  _ibSort = 'recent';       // Inboxes: messagesModel.INBOX_SORTS key
  _ibSel = null;            // Inboxes: the mailbox open on the desk (owner id); null = Needs a look
  _ibShut = new Set();      // Inboxes: groups the GM folded
  _ibOpen = new Set();      // Inboxes: groups the GM opened (default: only Players open)

  // ── Header: broadcast ──
  _bcOpen = false;
  _bc = { subject: '', body: '', from: '', priority: 'normal', later: false, when: '' };

  // ── Legacy NPC quick-send grid (kept for scripts that call _gatherNPCActors) ──
  _npcSearch = '';
  _npcPage = 0;
  _npcPerPage = 8;

  _schedInterval = null;
  _searchHandler = null;
  _ibSearchHandler = null;

  get key() { return 'messages'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  /** Open on one thing: 'npc:<ownerId>|<aliasId>' (Needs a reply) or a message id / 'fanout:<base>' (All mail). */
  openTo(select) {
    const s = String(select || '');
    if (!s) return;
    if (s.startsWith('view:')) {                 // 'view:all' | 'view:reply' | 'view:outbox' | 'view:inboxes' — just the sub-tab
      const v = s.slice(5);
      if (['reply', 'all', 'outbox', 'inboxes'].includes(v)) this._view = v;
      return;
    }
    if (s.startsWith('npc:')) {
      this._view = 'reply';
      this._convSel = s.slice(4);
      this._rFilt = 'all';
      return;
    }
    this._view = 'all';
    this._sel = s.replace(/^msg:/, '');
    this._search = ''; this._af.clear(); this._box = 'all'; this._filter = 'all'; this._actorFilter = '';
    this._dateFrom = ''; this._dateTo = '';
    this._calFollow = true;      // the navigator lands on the day that holds it
    ScopePicker.set(this.scopeId('who'), []);
  }

  prepareContext(stats) {
    if (this.app._activeTab !== 'messages') return { msg2: null };
    try {
      return { msg2: this._buildContext(stats) };
    } catch (err) {
      console.error(`${MODULE_ID} | MessagesTab.prepareContext:`, err);
      return { msg2: null };
    }
  }

  _buildContext(stats) {
    const scan = this._scanInboxes();
    const answered = this._answeredMap();
    const convs = this._buildConversations(scan, answered);
    const failures = this.messageService?.getDeliveryFailures?.() || [];
    const queue = this.messageService?.getQueue?.() || [];
    const scheduled = this.schedulingService?.getPending?.() || [];
    const timers = this._gatherTimers(scan);
    const waiting = convs.reduce((n, c) => n + (c.waiting > 0 ? 1 : 0), 0);
    const mailTotal = scan.inboxes.reduce((n, b) => n + b.msgs.filter(m => !m.isSent && !m.deleted).length, 0);
    const outboxN = failures.length + queue.length + scheduled.length + timers.length;

    const ctx = {
      view: this._view,
      isReply: this._view === 'reply', isAll: this._view === 'all', isOutbox: this._view === 'outbox', isInboxes: this._view === 'inboxes',
      isPopout: this.isPopout,
      nav: [
        { key: 'reply', icon: 'fa-reply', label: 'Needs a reply', count: waiting, tone: waiting ? 'hot' : '' },
        { key: 'all', icon: 'fa-envelopes-bulk', label: 'All mail', count: mailTotal, tone: '' },
        { key: 'outbox', icon: 'fa-paper-plane', label: 'Outbox', count: outboxN, tone: failures.length ? 'bad' : '' },
        { key: 'inboxes', icon: 'fa-inbox', label: 'Inboxes', count: scan.inboxes.length, tone: '' },
      ].map(n => ({ ...n, on: n.key === this._view })),
      sendAsPicker: this._sendAsPicker(),
      bcOpen: this._bcOpen,
      bc: this._bcOpen ? this._broadcastContext() : null,
      head: {
        reply: ['Needs a reply', 'Player mail to your NPCs that nobody has answered yet — pick a line to read it and reply as that NPC.', 'fa-reply'],
        all: ['All mail', 'Every message in the world on a calendar you open — a year, a month, a week, a day — with anything unusual (junk, anonymous, failed) flagged.', 'fa-envelopes-bulk'],
        outbox: ['Outbox', 'Mail that didn’t arrive, mail still waiting to deliver, scheduled mail, and messages set to erase themselves.', 'fa-paper-plane'],
        inboxes: ['Inboxes', 'Every mailbox in the world with its size and unread count, to open, export or clean up.', 'fa-inbox'],
      }[this._view],
    };
    ctx.headTitle = ctx.head[0]; ctx.headText = ctx.head[1]; ctx.headIcon = ctx.head[2];
    if (ctx.isReply) ctx.reply = this._replyContext(convs, scan);
    if (ctx.isAll) ctx.all = this._allContext(failures);
    if (ctx.isOutbox) ctx.outbox = this._outboxContext({ failures, queue, scheduled, timers });
    if (ctx.isInboxes) ctx.inboxes = this._inboxesContext(scan);
    return ctx;
  }

  onRender(context, options) {
    const root = this.element;
    if (!root) return;
    ScopePicker.after();

    // All mail: the calendar navigator answers the keyboard — Esc / Backspace one level up,
    // ← → a sibling (next day / week / month / year) — when the focus is not in a field.
    // One document listener with a containment guard (element listeners are unreliable here).
    if (!this._calKeys) {
      this._calKeys = (ev) => {
        const root2 = this.element;
        if (!root2 || this.app._activeTab !== 'messages' || this._view !== 'all') return;
        if (!root2.querySelector('.ncm-msg2-cal')) return;
        const t = ev.target;
        if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        if (!root2.contains(t) && t !== document.body) return;
        if (ev.key === 'Escape' || ev.key === 'Backspace') {
          if (this._calLevel === 'year') return;
          ev.preventDefault(); this.onAct('calUp', ev, null);
        } else if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && t?.closest?.('.ncm-msg2-cal')) {
          ev.preventDefault(); this.onAct('calStep', ev, { dataset: { dir: ev.key === 'ArrowLeft' ? '-1' : '1' } });
        }
      };
      document.addEventListener('keydown', this._calKeys);
    }
    root.querySelectorAll('.ncm-msg2-cal [role="button"][data-action]').forEach((el) => {
      el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); el.click(); } });
    });
    // The grip under the month grid: drag resizes the list in place (the grid scrolls when squeezed),
    // double-click resets, ↑ ↓ nudge. DOM-only; the height is remembered on the tab for the session.
    const grip = root.querySelector('[data-cal-grip]');
    const top = root.querySelector('[data-cal-top]');
    if (grip && top) {
      const natural = () => { const was = top.style.getPropertyValue('--cal-grid-h'); top.style.removeProperty('--cal-grid-h'); const h = top.scrollHeight; if (was) top.style.setProperty('--cal-grid-h', was); return h; };
      const apply = (h) => {
        const max = natural();
        h = h ? Math.max(56, Math.min(max, Math.round(h))) : 0;
        this._calGridH = h >= max ? 0 : h;
        if (this._calGridH) top.style.setProperty('--cal-grid-h', `${this._calGridH}px`); else top.style.removeProperty('--cal-grid-h');
        grip.classList.toggle('is-set', !!this._calGridH);
      };
      grip.classList.toggle('is-set', !!this._calGridH);
      grip.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const y0 = ev.clientY, h0 = top.getBoundingClientRect().height;
        grip.setPointerCapture?.(ev.pointerId);
        grip.classList.add('is-dragging');
        const move = (e) => apply(h0 + (e.clientY - y0));
        const up = () => { grip.classList.remove('is-dragging'); grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); };
        grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      });
      grip.addEventListener('dblclick', () => apply(0));
      grip.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); apply((this._calGridH || top.getBoundingClientRect().height) + (ev.key === 'ArrowUp' ? -24 : 24)); }
        else if (ev.key === 'Home' || ev.key === 'Enter') { ev.preventDefault(); apply(0); }
      });
    }
    // All mail: the Junk ▾ menu opens toward whichever side of the reading pane has room
    // (a menu that ran past the pane's edge was clipped under the list column).
    root.querySelectorAll('details.ncm-msg2-junkbtn').forEach((det) => {
      det.addEventListener('toggle', () => {
        const menu = det.querySelector('.ncm-msg2-junkbtn__menu');
        if (!det.open || !menu) return;
        menu.style.left = '0'; menu.style.right = 'auto';
        const pane = det.closest('.ncm-msg2-det') || root;
        const pr = pane.getBoundingClientRect(), mr = menu.getBoundingClientRect();
        if (mr.right > pr.right - 6) { menu.style.left = 'auto'; menu.style.right = '0'; }
      });
    });
    // Close an open Junk menu when the click lands elsewhere.
    if (!this._junkCloser) {
      this._junkCloser = (ev) => {
        for (const det of this.element?.querySelectorAll?.('details.ncm-msg2-junkbtn[open], details.ncm-msg2-dd[open]') || []) if (!det.contains(ev.target)) det.open = false;
      };
      document.addEventListener('pointerdown', this._junkCloser, true);
    }
    // "Where it went", big group: a name search narrows the rows in place.
    root.querySelectorAll('[data-jr-search]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const q = inp.value.trim().toLowerCase();
        const box = inp.closest('.ncm-msg2-jr');
        box?.classList.toggle('is-searching', !!q);
        let shown = 0;
        box?.querySelectorAll('.ncm-msg2-jr__p').forEach((row) => { const hit = !q || (row.dataset.name || '').includes(q); row.style.display = hit ? '' : 'none'; if (hit) shown++; });
        box?.classList.toggle('is-empty', !!q && !shown);
      });
    });
    // Inboxes: a group's header row folds its tbody in place, same rule.
    root.querySelectorAll('[data-msg2-ibfold]').forEach((head) => {
      head.addEventListener('click', (ev) => {
        if (ev.target.closest('button, [data-action]')) return;
        const key = head.dataset.msg2Ibfold;
        const body = head.closest('[data-ib-group]');
        const shut = !body?.classList.contains('is-shut');
        recordFold(key, shut, this._ibShut, this._ibOpen);
        body?.classList.toggle('is-shut', shut);
        head.setAttribute('aria-expanded', shut ? 'false' : 'true');
      });
      head.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); head.click(); } });
    });

    // ── Inboxes (list + desk): the Show / Sort selects, "/" to search, Esc back to Needs a look.
    const ib = root.querySelector('[data-ib-root]');
    if (ib) this._wireInboxes(ib);

    // ── Scroll memo: every click re-renders the part, so each scroller keeps its
    // place (a reading pane / thread resets only when its message changes; a
    // newly opened conversation lands on its first waiting message, else the end).
    this._scrollMemo ||= {};
    for (const el of root.querySelectorAll('[data-msg2-scroll]')) {
      const k = el.dataset.msg2Scroll;
      const ident = el.dataset.conv ?? el.dataset.sel ?? '';
      const memo = this._scrollMemo[k];
      if (memo && memo.id === ident) el.scrollTop = memo.top;
      else if (k === 'thread') {
        const first = el.querySelector('.ncm-msg2-desk__b.is-waiting');
        el.scrollTop = first ? Math.max(0, first.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8) : el.scrollHeight;
      } else el.scrollTop = 0;
      this._scrollMemo[k] = { id: ident, top: el.scrollTop };
      el.addEventListener('scroll', () => { this._scrollMemo[k] = { id: ident, top: el.scrollTop }; }, { passive: true });
    }

    const wireSearch = (sel, key, handlerKey, after) => {
      const input = root.querySelector(sel);
      if (!input) return;
      if (this[key] && document.activeElement !== input) {
        input.focus();
        input.setSelectionRange(this[key].length, this[key].length);
      }
      const h = this[handlerKey] || (this[handlerKey] = foundry.utils.debounce((e) => {
        this[key] = e.target.value; after?.(); this.render(true);
      }, 300));
      input.removeEventListener('input', h);
      input.addEventListener('input', h);
    };
    wireSearch('[data-msg2-search]', '_search', '_searchHandler', () => { this._limit = 40; this._calLimit = 50; this._calAuto = true; });
    wireSearch('[data-msg2-ibsearch]', '_ibSearch', '_ibSearchHandler');

    // ── The Desk: a queue row answers Enter/Space like a button (every other control is a real button).
    root.querySelectorAll('.ncm-msg2-desk__qr[data-action]').forEach((row) => {
      row.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); row.click(); } });
    });

    // ── Inline reply draft (kept per conversation; Ctrl+Enter sends) ──
    const draft = root.querySelector('[data-msg2-draft]');
    if (draft) {
      draft.addEventListener('input', () => this._drafts.set(draft.dataset.key, draft.value));
      draft.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this._onReplySend(); }
      });
    }

    // ── Broadcast fields (state, so a re-render never loses what was typed) ──
    for (const el of root.querySelectorAll('[data-msg2-bc]')) {
      el.addEventListener('input', () => { this._bc[el.dataset.msg2Bc] = el.value; });
    }

    // ── Scheduled countdowns tick (game time where the entry asks for it) ──
    if (this._schedInterval) { clearInterval(this._schedInterval); this._schedInterval = null; }
    if (root.querySelector('[data-delivery-time]')) {
      const ts = game.nightcity?.timeService;
      this._schedInterval = setInterval(() => {
        const els = this.element?.querySelectorAll('[data-delivery-time]');
        if (!els?.length || this.app._activeTab !== 'messages') { clearInterval(this._schedInterval); this._schedInterval = null; return; }
        for (const el of els) {
          const nowMs = el.dataset.useGameTime === 'true' ? (ts?.getCurrentTimeMs?.() ?? Date.now()) : Date.now();
          const diff = Math.max(0, new Date(el.dataset.deliveryTime).getTime() - nowMs);
          el.textContent = MessagesTab.countdown(diff);
          el.classList.toggle('is-soon', diff < 5 * 60 * 1000);
        }
      }, 1000);
    }
  }

  onClose() {
    if (this._schedInterval) { clearInterval(this._schedInterval); this._schedInterval = null; }
    // The two document listeners live as long as the window (they used to be dropped on the render that added them).
    if (this._junkCloser) { document.removeEventListener('pointerdown', this._junkCloser, true); this._junkCloser = null; }
    if (this._calKeys) { document.removeEventListener('keydown', this._calKeys); this._calKeys = null; }
    if (this._ibKeys) { document.removeEventListener('keydown', this._ibKeys); this._ibKeys = null; }
  }

  static countdown(diffMs) {
    const s = Math.floor(Math.max(0, diffMs) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  _nowMs() { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); }

  /** "12m" / "3h" / "2d" from a timestamp, on the game clock. */
  _age(ms) {
    if (!ms) return '';
    const d = Math.max(0, this._nowMs() - ms), m = Math.floor(d / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  // ═══════════════════════════════════════════════════════════
  //  Public — formatScheduledEntry (called from AdminPanelApp._prepareContext)
  // ═══════════════════════════════════════════════════════════

  formatScheduledEntry(entry) {
    const d = entry.messageData || {};
    const fromName = resolveDisplayName({ contactId: d.fromContactId, actorId: d.fromActorId, email: d.from }, d.fromName || d.from || 'Unknown');
    const recips = Array.isArray(d.recipients) ? d.recipients : null;
    const toName = recips?.length > 1
      ? `${recips.length} recipients`
      : resolveDisplayName({ contactId: d.toContactId, actorId: d.toActorId, email: d.to }, d.toName || d.to || 'Unknown');
    const now = entry.useGameTime ? this._nowMs() : Date.now();
    const diffMs = Math.max(0, new Date(entry.deliveryTime).getTime() - now);
    const priority = d.priority || 'normal';
    return {
      ...entry,
      fromName,
      toName,
      subject: d.subject ?? '(no subject)',
      countdown: MessagesTab.countdown(diffMs),
      isSoon: diffMs < 5 * 60 * 1000,
      deliveryDate: entry.deliveryTime ? formatCyberDate(entry.deliveryTime) : '',
      priority,
      fromColor: game.actors?.get(d.fromActorId)?.hasPlayerOwner ? 'var(--ncm-secondary)' : (priority === 'critical' ? 'var(--ncm-danger)' : 'var(--ncm-accent)'),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  One pass over every inbox
  // ═══════════════════════════════════════════════════════════

  /**
   * { inboxes: [{journal, ownerId, isContact, isPlayer, orphan, name, actor, contact, msgs}], viaByBase, anonRealByBase }
   * Each msg is a light record read straight off the page flags.
   */
  _scanInboxes() {
    const mcs = this.masterContactService;
    const inboxes = [];
    const viaByBase = new Map();
    const anonRealByBase = new Map();
    for (const journal of game.journal ?? []) {
      const who = MessageRepository.identifyInbox(journal);
      if (!who) continue;
      const actor = who.isContact ? null : game.actors?.get(who.ownerId);
      const contact = who.isContact ? mcs?.getContact?.(who.ownerId) : null;
      const linked = contact?.actorId ? game.actors?.get(contact.actorId) : null;
      const isPlayer = !!(actor?.hasPlayerOwner || linked?.hasPlayerOwner);
      const orphan = who.isContact ? !contact : !actor;
      const msgs = [];
      for (const page of journal.pages ?? []) {
        const f = page.flags?.[MODULE_ID];
        if (!f?.messageId) continue;
        const id = String(f.messageId);
        const isSent = id.endsWith('-sent') || !!f.status?.sent;
        const rec = {
          page, pageId: page.id, journalId: journal.id, ownerId: who.ownerId,
          messageId: id, base: baseIdOf(id), isSent,
          read: !!f.status?.read, deleted: !!f.status?.deleted, spam: !!f.status?.spam, saved: !!f.status?.saved,
          status: f.status || {},
          timestamp: f.timestamp || '', _ts: f.timestamp ? new Date(f.timestamp).getTime() : 0,
          fromActorId: f.fromActorId || '', fromContactId: f.fromContactId || '', from: f.from || '',
          toActorId: f.toActorId || '', toContactId: f.toContactId || '', to: f.to || '',
          participants: f.participants || [], subject: f.subject || page.name || '(no subject)',
          body: f.body || page.text?.content || '', selfDestruct: f.selfDestruct || null,
          anonymous: f.anonymous || null, sentVia: f.sentVia || null, eddies: Number(f.eddies) || 0,
          network: f.network || '', encryption: f.encryption || null,
        };
        msgs.push(rec);
        if (isSent && f.sentVia) viaByBase.set(rec.base, { machine: f.sentVia.machine || 'a terminal', typist: f.sentVia.operatorName || 'someone', impersonated: f.sentVia.impersonated !== false });
        if (isSent && f.anonymous?.enabled && f.anonymous.role !== 'recipient') {
          anonRealByBase.set(rec.base, resolveDisplayName({ contactId: rec.fromContactId, actorId: rec.fromActorId, email: rec.from }, rec.from || 'Unknown'));
        }
      }
      const name = actor?.name || contact?.name || journal.name || 'Unknown';
      inboxes.push({ journal, ownerId: who.ownerId, isContact: who.isContact, isPlayer, orphan, name, actor, contact, msgs });
    }
    return { inboxes, viaByBase, anonRealByBase };
  }

  _answeredMap() {
    try { return game.settings.get(MODULE_ID, 'npcMailAnswered') || {}; } catch { return {}; }
  }

  async _markAnswered(baseIds) {
    if (!baseIds?.length) return;
    const now = new Date().toISOString();
    const map = { ...this._answeredMap() };
    for (const id of baseIds) map[baseIdOf(id)] = now;
    await game.settings.set(MODULE_ID, 'npcMailAnswered', pruneAnswered(map));
  }

  /** Mark pages read (the Overview counts unread player mail as waiting too). */
  async _markPagesRead(recs) {
    const byJournal = new Map();
    for (const r of recs) {
      if (r.read || r.isSent) continue;
      if (!byJournal.has(r.journalId)) byJournal.set(r.journalId, []);
      byJournal.get(r.journalId).push({ _id: r.pageId, [`flags.${MODULE_ID}.status.read`]: true, [`flags.${MODULE_ID}.status.readAt`]: MessageRepository.readStamp(), [`flags.${MODULE_ID}.readAt`]: new Date().toISOString() });
    }
    for (const [jid, updates] of byJournal) {
      try { await game.journal.get(jid)?.updateEmbeddedDocuments('JournalEntryPage', updates); } catch (err) { log.warn(`mark read failed in ${jid}: ${err?.message}`); }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  NEEDS A REPLY
  // ═══════════════════════════════════════════════════════════

  /**
   * Player mail received by NPC inboxes, one conversation per NPC inbox × the
   * alias it was addressed to (the Overview's NEEDS YOU key). Each holds the
   * player messages, the NPC's replies to those players (sent copies in the same
   * inbox), and how many are still waiting.
   */
  _buildConversations(scan, answered) {
    const all = this.masterContactService?.getAll?.() || [];
    const aliasOf = (cid) => { const c = cid ? all.find(x => x.id === cid) : null; return c && identityRole(all, c)?.isAlias ? c : null; };
    const groups = new Map();
    for (const box of scan.inboxes) {
      if (box.isPlayer || box.orphan) continue;
      const sent = box.msgs.filter(m => m.isSent && !m.deleted);
      for (const m of box.msgs) {
        if (m.isSent || m.deleted || m.spam) continue;
        const via = scan.viaByBase.get(m.base) || null;
        const fromPlayer = isPlayerActor(m.fromActorId) || !!via?.impersonated;
        if (!fromPlayer && !this._npcInboxIncludeGm) continue;
        const alias = aliasOf(m.toContactId);
        const key = convKey(box.ownerId, alias?.id);
        let g = groups.get(key);
        if (!g) {
          g = { key, ownerId: box.ownerId, isContact: box.isContact, box, alias, ownerName: box.name, msgs: [], sent, waiting: 0, latestTs: 0, senders: new Map() };
          groups.set(key, g);
        }
        m._via = via;
        m._fromPlayer = fromPlayer;
        m._answered = fromPlayer ? isAnswered(m, sent, answered) : true;
        g.msgs.push(m);
        if (!m._answered) g.waiting++;
        g.latestTs = Math.max(g.latestTs, m._ts);
        const sk = m.fromActorId || m.fromContactId || m.from;
        if (sk && !g.senders.has(sk)) g.senders.set(sk, m);
      }
    }
    // The NPC's own replies to those players: a sent copy from this identity
    // (the alias for an alias row; anything but another alias for the main row).
    for (const g of groups.values()) {
      const keys = new Set(); for (const m of g.msgs) for (const k of senderKeys(m)) keys.add(k);
      const otherAliases = new Set([...groups.values()].filter(x => x.ownerId === g.ownerId && x.alias && x !== g).map(x => x.alias.id));
      g.replies = g.sent.filter(sc => [...targetKeys(sc)].some(k => keys.has(k))
        && (g.alias ? sc.fromContactId === g.alias.id : !otherAliases.has(sc.fromContactId)));
      for (const r of g.replies) g.latestTs = Math.max(g.latestTs, r._ts);
    }
    return sortConversations([...groups.values()]);
  }

  _senderLabel(m) {
    return resolveDisplayName({ contactId: m.fromContactId, actorId: m.fromActorId, email: m.from }, m.from || 'Unknown');
  }

  _face(name, { contactId, actorId, email } = {}) {
    const img = imgOk(resolveDisplayPortrait({ contactId, actorId, email }));
    return { name, img, initials: getInitials(name || '?') };
  }

  _convFace(g) {
    const name = g.alias?.name || g.ownerName;
    return this._face(name, g.alias ? { contactId: g.alias.id } : (g.isContact ? { contactId: g.ownerId } : { actorId: g.ownerId }));
  }

  /**
   * Needs a reply as THE DESK (Version B of dev/mockups/admin-needs-reply-rethink-mock.html,
   * 2026-10-28): a queue of conversations on the left (the longest wait on top,
   * answered ones below, dim), the picked conversation as a chat thread in the
   * middle with the compose box pinned under it, and on the right the PERSONA of
   * the identity being answered as (portrait, role / org, how they talk = the
   * contact's Voice, the identities to answer from, what they last said).
   * Rules: messagesModel.deskQueue / deskThread / deskVoice / identityOrder.
   */
  _replyContext(convs, scan = null) {
    this._convCache = new Map(convs.map(c => [c.key, c]));
    if (this._convSel && !this._convCache.has(this._convSel)) this._convSel = null;
    const now = this._nowMs();

    const rows = convs.map(c => {
      const waitingMsgs = c.msgs.filter(m => !m._answered).sort((a, b) => b._ts - a._ts);
      const newestWait = waitingMsgs[0] || null;
      const oldestWait = waitingMsgs[waitingMsgs.length - 1] || null;
      const who = new Map();
      for (const m of waitingMsgs) { const k = m.fromActorId || m.fromContactId || m.from; if (k && !who.has(k)) who.set(k, m); }
      const people = who.size ? [...who.values()] : [...c.senders.values()];
      const lastReply = [...(c.replies || [])].sort((a, b) => b._ts - a._ts)[0] || null;
      const names = [...new Set(people.map(m => this._senderLabel(m)))];
      return {
        key: c.key, name: c.ownerName, aliasName: c.alias?.name || '', contactOnly: !!c.isContact,
        waiting: c.waiting, oldestWaitTs: oldestWait?._ts || 0, newestWaitTs: newestWait?._ts || 0, latestTs: c.latestTs || 0,
        whoNames: names.join(', '), playersN: who.size, messages: waitingMsgs.length,
        faces: people.slice(0, 3).map(m => this._face(this._senderLabel(m), { contactId: m.fromContactId, actorId: m.fromActorId, email: m.from })),
        npc: this._convFace(c),
        subline: newestWait ? (newestWait.subject || this._plain(newestWait.body, 60) || '(no subject)')
          : (lastReply ? `answered ${this._age(lastReply._ts)} ago` : 'marked answered'),
        age: newestWait ? this._age(newestWait._ts) : '',
        waitAge: oldestWait ? this._age(oldestWait._ts) : '',
        typed: waitingMsgs.some(m => m._via?.impersonated),
      };
    });
    let queue = deskQueue(rows, { filter: this._rFilt, selKey: this._convSel, nowMs: now });
    // Nothing picked yet: the desk opens on the longest wait (else the latest answered line).
    if (!this._convSel) {
      this._convSel = deskDefaultKey(deskQueue(rows, { filter: 'all', nowMs: now }));
      if (this._convSel) queue = deskQueue(rows, { filter: this._rFilt, selKey: this._convSel, nowMs: now });
    }
    const sel = this._convSel ? this._convCache.get(this._convSel) : null;

    const withConv = new Set(convs.map(c => c.ownerId));
    const quietN = (scan?.inboxes || []).filter(b => !b.isPlayer && !b.orphan && !withConv.has(b.ownerId)).length;
    const playersWaiting = rows.reduce((n, r) => n + (r.waiting ? r.playersN : 0), 0);

    const folds = this._deskFolds();
    const filtLabel = (DESK_FILTERS.find(([k]) => k === this._rFilt) || DESK_FILTERS[0])[1];
    return {
      filt: this._rFilt, filtLabel, filtCount: queue.counts[this._rFilt] ?? 0, includeGm: this._npcInboxIncludeGm,
      chips: DESK_FILTERS.map(([key, label]) => ({ key, label, count: queue.counts[key], on: key === this._rFilt })),
      playersWaiting, linesWaiting: queue.counts.waiting, quietN, showQuiet: this._deskQuiet && quietN > 0, quietOn: this._deskQuiet,
      qShut: folds.q, pShut: folds.p,
      queue, hasQueue: queue.shown > 0,
      emptyText: this._rFilt === 'waiting' ? 'Nothing waiting. Nice.' : (rows.length ? 'No lines here.' : 'No NPC has mail yet.'),
      desk: sel ? this._deskDetail(sel) : null,
    };
  }

  _plain(html, n = 160) {
    const t = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  }

  _roleLabel(role) {
    const key = String(role || '').toLowerCase().trim();
    if (!key) return '';
    const lc = (s) => String(s || '').toLowerCase().trim();
    const custom = (this.masterContactService?.getCustomRoles?.() || []).find((r) => lc(r.id) === key || lc(r.label) === key);
    return BUILT_IN_ROLES[key]?.label || custom?.label || (key.charAt(0).toUpperCase() + key.slice(1));
  }

  /**
   * The identities the GM can answer as: that NPC's group (or the alias's), the
   * identity the latest mail reached FIRST, then the rest (main next).
   */
  _replyIdentities(g) {
    const all = this.masterContactService?.getAll?.() || [];
    let ids = [];
    if (g.isContact) {
      const own = all.find(c => c.id === g.ownerId);
      ids = own ? identitiesOfContact(all, own) : [];
    } else {
      ids = identitiesOf(all, g.ownerId);
    }
    if (g.alias && !ids.some(c => c.id === g.alias.id)) ids = [g.alias, ...ids];
    let items = ids.map((c, i) => ({
      id: `c:${c.id}`, name: c.name, icon: identityRole(all, c)?.isAlias ? 'fa-masks-theater' : 'fa-user-tie',
      isAlias: !!identityRole(all, c)?.isAlias,
      meta: identityRole(all, c)?.isAlias ? `alias of ${identityRole(all, c).primary.name}` : (i === 0 ? 'main' : ''),
      img: imgOk(resolveDisplayPortrait({ contactId: c.id })) || undefined,
      addr: c.email || '',
    }));
    if (!g.isContact && !items.length) {
      const a = game.actors?.get(g.ownerId);
      if (a) items.push({ id: `a:${a.id}`, name: a.name, icon: 'fa-user-tie', isAlias: false, meta: 'character', img: imgOk(a.img) || undefined, addr: a.getFlag?.(MODULE_ID, 'email') || '' });
    }
    // Default: the identity they wrote to (latest waiting message), else the alias row, else the main.
    const latest = [...g.msgs].filter(m => !m._answered).sort((a, b) => b._ts - a._ts)[0] || [...g.msgs].sort((a, b) => b._ts - a._ts)[0];
    const wrote = latest?.toContactId && items.find(i => i.id === `c:${latest.toContactId}`);
    const def = wrote?.id || (g.alias ? `c:${g.alias.id}` : (g.isContact ? `c:${g.ownerId}` : items[0]?.id)) || '';
    items = identityOrder(items, wrote?.id || null);
    return { items, def: items.some(i => i.id === def) ? def : (items[0]?.id || ''), wroteTo: wrote || null };
  }

  /** The desk for one conversation: head, thread, compose box, persona. */
  _deskDetail(g) {
    const all = this.masterContactService?.getAll?.() || [];
    const pid = this.scopeId('rpas');
    const { items, def, wroteTo } = this._replyIdentities(g);
    if (this._rpasFor !== g.key) { ScopePicker.set(pid, def ? [def] : []); this._rpasFor = g.key; this._replyAnon = false; }
    const pick = ScopePicker.value(pid)[0] || def;
    const picked = items.find(i => i.id === pick) || items[0] || null;
    const pickedContact = picked?.id?.startsWith('c:') ? (all.find(c => c.id === picked.id.slice(2)) || null) : null;
    const pickedActor = picked?.id?.startsWith('a:') ? game.actors?.get(picked.id.slice(2)) : (pickedContact?.actorId ? game.actors?.get(pickedContact.actorId) : null);
    const fromAddr = pickedContact?.email || pickedActor?.getFlag?.(MODULE_ID, 'email') || '';

    const senderNames = [...new Set(g.msgs.filter(m => m._fromPlayer).map(m => this._senderLabel(m)))];
    const waitingMsgs = g.msgs.filter(m => !m._answered).sort((a, b) => b._ts - a._ts);
    const waitingNames = [...new Set(waitingMsgs.map(m => this._senderLabel(m)))];
    const toNames = waitingNames.length ? waitingNames : senderNames;
    const typedNotes = [];
    for (const m of g.msgs) {
      if (!m._via?.impersonated) continue;
      typedNotes.push({ typist: m._via.typist, machine: m._via.machine, asName: this._senderLabel(m) });
    }

    // The thread: player mail on the left, the NPC's replies on the right, a day line when the day changes.
    const seenAddr = new Set();
    const items2 = [...g.msgs, ...(g.replies || [])].map(m => {
      const who = this._senderLabel(m);
      const addr = m.from && !seenAddr.has(`${who}|${m.from}`) ? m.from : '';
      if (m.from) seenAddr.add(`${who}|${m.from}`);
      return {
        ts: m._ts, ...this._face(who, { contactId: m.fromContactId, actorId: m.fromActorId, email: m.from }), addr,
        subject: m.subject || '', bodyHtml: cleanHtml(m.body || '', { mode: 'mail' }),
        time: m.timestamp ? formatCyberDate(m.timestamp, { timeOnly: true }) : '', when: m.timestamp ? formatCyberDate(m.timestamp) : '', age: this._age(m._ts),
        mine: m.isSent, waiting: !m.isSent && !m._answered, messageId: m.messageId, ownerId: m.ownerId,
        typist: m._via?.impersonated ? m._via.typist : '',
      };
    });
    const entries = deskThread(items2, { labelDay: (ts) => formatCyberDate(new Date(ts).toISOString(), { dateOnly: true }) });
    const msgCount = items2.length;
    const newest = [...g.msgs, ...(g.replies || [])].sort((a, b) => b._ts - a._ts)[0] || null;
    const subject = (waitingMsgs[0] || newest)?.subject || '(no subject)';

    // The persona: who you are answering as — the picked identity (an alias inherits its main's voice).
    const role = pickedContact ? identityRole(all, pickedContact) : null;
    const main = role?.isAlias ? role.primary : pickedContact;
    const roleKey = pickedContact?.role || main?.role || '';
    const org = pickedContact?.organization || main?.organization || '';
    const voice = deskVoice(pickedContact ? voiceInfo(all, pickedContact) : { text: '' });
    const face = picked ? { name: picked.name, img: picked.img || '', initials: getInitials(picked.name || '?') } : this._convFace(g);
    const saidFrom = (g.replies || []).filter(r => !pickedContact || !r.fromContactId || r.fromContactId === pickedContact.id).sort((a, b) => b._ts - a._ts);
    const said = (saidFrom.length ? saidFrom : [...(g.replies || [])].sort((a, b) => b._ts - a._ts)).slice(0, 3)
      .map(r => ({ text: this._plain(r.body || '', 90) || r.subject || '(no body)', when: r.timestamp ? formatCyberDate(r.timestamp) : '' }));
    const persona = {
      ...face, addr: fromAddr,
      isAlias: !!role?.isAlias, mainName: role?.isAlias ? (role.primary?.name || '') : '',
      role: roleKey ? { label: this._roleLabel(roleKey), icon: getRoleIcon(roleKey), hue: `role:${roleKey}` } : null,
      org,
      voice, contactId: pickedContact?.id || '', actorId: pickedActor?.id || '', hasVoiceTarget: !!(pickedContact || pickedActor),
      identities: items.map(i => ({ ...i, on: i.id === picked?.id })), manyIds: items.length > 1,
      wroteToName: wroteTo?.name || '', wroteToIsPicked: !!wroteTo && wroteTo.id === picked?.id,
      said, hasSaid: said.length > 0,
      inboxOwnerId: g.ownerId,
    };

    const anonOk = this._anonEnabled();
    return {
      key: g.key, ownerId: g.ownerId,
      npcName: g.ownerName, aliasName: g.alias?.name || '',
      head: {
        players: senderNames.join(', ') || 'nobody yet',
        faces: g.msgs.filter(m => m._fromPlayer).filter((m, i, arr) => arr.findIndex(x => this._senderLabel(x) === this._senderLabel(m)) === i).slice(0, 3)
          .map(m => this._face(this._senderLabel(m), { contactId: m.fromContactId, actorId: m.fromActorId, email: m.from })),
        subject, msgCount, waiting: g.waiting,
        subline: `${g.alias ? `Alias of ${g.ownerName} · ` : ''}with ${senderNames.join(' & ') || 'nobody yet'}`,
      },
      entries, msgCount,
      typedNotes: typedNotes.slice(0, 3), hasTyped: typedNotes.length > 0,
      compose: {
        replyAsName: picked?.name || g.alias?.name || g.ownerName, fromAddr,
        toLine: toNames.length > 1 ? `all ${toNames.length} who wrote (one fan-out)` : (toNames[0] || 'nobody'),
        toMany: toNames.length > 1, toCount: toNames.length,
        canReply: items.length > 0 && senderNames.length > 0,
        waiting: g.waiting,
        draft: this._drafts.get(g.key) || '',
        anonOk, anon: anonOk && this._replyAnon,
        identities: items.map(i => ({ ...i, on: i.id === picked?.id, wrote: !!wroteTo && wroteTo.id === i.id })), manyIds: items.length > 1, idCount: items.length,
        sentLine: deskSentLine(this._deskSent?.key === g.key ? this._deskSent : null),
      },
      persona,
    };
  }

  /**
   * The Desk's two folds for this window. The GM's own choice wins for the session;
   * by default the queue is open and the persona is open only when there is room
   * (a pop-out, or a panel widened past ~960px).
   */
  _deskFolds() {
    const mem = DESK_FOLDS.get(this.app?.id) || {};
    const w = this.app?.position?.width || 0;
    return { q: mem.q ?? false, p: mem.p ?? !(this.isPopout || w >= 960) };
  }

  _setDeskFold(which) {
    const id = this.app?.id;
    const cur = this._deskFolds();
    DESK_FOLDS.set(id, { ...(DESK_FOLDS.get(id) || {}), [which]: !cur[which] });
  }

  /**
   * Mark one copy read (or back to unread) — written straight onto its page in the owner's inbox
   * (a contact inbox has no actor, so this does not go through the actor-keyed service), then the
   * same status sync the inbox's own button sends.
   */
  async _setRead(ownerId, messageId, read) {
    if (!ownerId || !messageId) return;
    for (const journal of game.journal ?? []) {
      const who = MessageRepository.identifyInbox(journal);
      if (!who || who.ownerId !== ownerId) continue;
      const page = journal.pages.find(p => String(p.flags?.[MODULE_ID]?.messageId) === String(messageId));
      if (!page) continue;
      await page.update(read
        ? { [`flags.${MODULE_ID}.status.read`]: true, [`flags.${MODULE_ID}.status.readAt`]: MessageRepository.readStamp(), [`flags.${MODULE_ID}.readAt`]: new Date().toISOString() }
        : { [`flags.${MODULE_ID}.status.read`]: false, [`flags.${MODULE_ID}.status.readAt`]: null, [`flags.${MODULE_ID}.readAt`]: null });
      this.messageRepository?.clearCache?.();
      game.nightcity?.eventBus?.emit?.(EVENTS.MESSAGE_READ, { messageId, actorId: ownerId, unread: !read });
      game.nightcity?.socketManager?.emit?.(SOCKET_OPS.MESSAGE_STATUS_UPDATE, { actorId: ownerId, messageId, update: read ? 'read' : 'unread' });
      return this.render(true);
    }
    ui.notifications.warn('NCM | That message is no longer in its inbox.');
  }

  _anonEnabled() {
    try { return !!game.settings.get(MODULE_ID, 'anonSendEnabled'); } catch { return false; }
  }

  /** Full message objects for a conversation's records (what buildReply / the composer want). */
  _toMessage(rec) {
    return this.messageRepository?._pageToMessage?.(rec.page) || { ...rec.page?.flags?.[MODULE_ID] };
  }

  /** What an inline reply / "Open in composer" answers, and as whom. */
  _replyPlan() {
    const g = this._convCache?.get(this._convSel);
    if (!g) return null;
    const players = g.msgs.filter(m => m._fromPlayer).sort((a, b) => b._ts - a._ts);
    const waiting = players.filter(m => !m._answered);
    const target = waiting[0] || players[0];
    if (!target) return null;
    const pick = ScopePicker.value(this.scopeId('rpas'))[0] || this._replyIdentities(g).def;
    const all = this.masterContactService?.getAll?.() || [];
    let fromActorId = null, fromContactId = null, fromEmail = null;
    if (pick?.startsWith('c:')) {
      const c = all.find(x => x.id === pick.slice(2));
      fromContactId = c?.id || null; fromActorId = c?.actorId || null; fromEmail = c?.email || null;
    } else if (pick?.startsWith('a:')) {
      fromActorId = pick.slice(2);
    }
    // Everyone still waiting (once each) — several players in one conversation get one fan-out.
    const seen = new Set(); const to = [];
    for (const m of (waiting.length ? waiting : [target])) {
      const k = m.fromActorId || m.fromContactId || m.from;
      if (seen.has(k)) continue; seen.add(k);
      to.push({ actorId: m.fromActorId || null, contactId: m.fromContactId || null, email: m.from || '', name: this._senderLabel(m) });
    }
    return { g, target, waiting, fromActorId, fromContactId, fromEmail, to };
  }

  async _onReplySend() {
    const plan = this._replyPlan();
    if (!plan) return ui.notifications.warn('NCM | Pick a conversation first.');
    const body = (this._drafts.get(plan.g.key) || this.element?.querySelector('[data-msg2-draft]')?.value || '').trim();
    if (!body) return ui.notifications.warn('NCM | Write a reply first.');
    const svc = this.messageService;
    const original = this._toMessage(plan.target);
    const reply = svc.buildReply(original, plan.fromActorId, body.replace(/\n/g, '<br>'), { fromContactId: plan.fromContactId });
    if (plan.fromContactId) { reply.fromContactId = plan.fromContactId; if (plan.fromEmail) reply.from = plan.fromEmail; }
    if (!plan.fromActorId) delete reply.fromActorId;
    if (plan.to.length > 1 && !reply.anonReply) {
      delete reply.toActorId; delete reply.toContactId; delete reply.to;
      reply.recipients = plan.to;
    }
    if (this._replyAnon && this._anonEnabled()) reply.anonymous = this._anonBlock(original);
    const result = await svc.sendMessage(reply);
    if (!result?.success) {
      ui.notifications.error(`NCM | Reply not sent — ${result?.error || 'unknown error'}`);
      return;
    }
    if (result.failed?.length) ui.notifications.warn(`NCM | Not delivered to ${result.failed.map(x => `${x.name}: ${x.error || 'unknown error'}`).join(' · ')}`);
    else ui.notifications.info(`NCM | Replied to ${plan.to.map(t => t.name).join(', ')}.`);
    await this._markAnswered(plan.waiting.map(m => m.messageId));
    await this._markPagesRead(plan.waiting);
    this._drafts.delete(plan.g.key);
    // The desk keeps the conversation open with a "Sent as …" line until another one is picked.
    const asName = (this._replyIdentities(plan.g).items.find(i => i.id === (ScopePicker.value(this.scopeId('rpas'))[0] || ''))?.name) || plan.g.alias?.name || plan.g.ownerName;
    this._deskSent = { key: plan.g.key, as: asName, to: plan.to.map(t => t.name).join(', ') };
    this.render(true);
  }

  /** The anonymous block for an inline reply — the thread's own config when it was anonymous, else the world defaults. */
  _anonBlock(original) {
    const g = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
    const prior = this.messageService?.getThreadAnonConfig?.(original) || null;
    return {
      enabled: true,
      style: normalizeAnonStyle(prior?.style || g('anonDefaultStyle', 'scrambled')),
      alias: (prior?.alias || '').trim() || ANON_DEFAULT_ALIAS,
      maskedEmail: ANON_MASKED_EMAIL,
      allowReplies: prior?.allowReplies ?? !!g('anonAllowRepliesDefault', true),
      traceable: !!g('anonTraceEnabled', true),
      traceDV: Number(prior?.traceDV || g('anonTraceDV', 15)) || 15,
      traced: false,
    };
  }

  _onReplyComposer() {
    const plan = this._replyPlan();
    if (!plan) return;
    // The draft rides along as the composer's body (its editor is HTML, so line breaks become <br>).
    const opts = { mode: 'reply', originalMessage: this._toMessage(plan.target), body: (this._drafts.get(plan.g.key) || '').replace(/\n/g, '<br>') };
    if (plan.fromContactId) opts.fromContactId = plan.fromContactId;
    else if (plan.fromActorId) opts.fromActorId = plan.fromActorId;
    if (plan.to.length > 1) opts.replyAll = true;
    game.nightcity?.openComposer?.(opts);
  }

  async _onMarkAnswered() {
    const g = this._convCache?.get(this._convSel);
    if (!g) return;
    const waiting = g.msgs.filter(m => !m._answered);
    if (!waiting.length) return ui.notifications.info('NCM | Nothing waiting in this conversation.');
    await this._markAnswered(waiting.map(m => m.messageId));
    await this._markPagesRead(waiting);
    ui.notifications.info(`NCM | Marked ${waiting.length} message${waiting.length !== 1 ? 's' : ''} answered.`);
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  ALL MAIL
  // ═══════════════════════════════════════════════════════════

  /** The "Who" picker: characters, NPCs & aliases, groups. Ids: a:<actor>, c:<contact>, g:<group>. */
  _whoItems(counts) {
    const all = this.masterContactService?.getAll?.() || [];
    const items = [];
    const seen = new Set();
    for (const pc of getPlayerCharacters()) {
      if (seen.has(pc.actorId)) continue; seen.add(pc.actorId);
      items.push({ id: `a:${pc.actorId}`, name: pc.actorName, group: 'Players’ characters', icon: 'fa-user', img: imgOk(pc.actor?.img) || undefined, meta: pc.playerName || '', count: counts.get(`a:${pc.actorId}`) || 0 });
    }
    for (const c of all) {
      if (c.actorId && game.actors?.get(c.actorId)?.hasPlayerOwner) continue;
      const role = identityRole(all, c);
      items.push({ id: `c:${c.id}`, name: c.name, group: 'NPCs & aliases', icon: role?.isAlias ? 'fa-masks-theater' : 'fa-user-tie', meta: role?.isAlias ? `alias of ${role.primary.name}` : (c.email || ''), img: imgOk(resolveDisplayPortrait({ contactId: c.id })) || undefined, count: counts.get(`c:${c.id}`) || 0 });
      if (c.actorId) seen.add(c.actorId);
    }
    for (const a of game.actors ?? []) {
      if (a.hasPlayerOwner || seen.has(a.id) || !isPersonActor(a) || !a.getFlag?.(MODULE_ID, 'email')) continue;
      items.push({ id: `a:${a.id}`, name: a.name, group: 'NPCs & aliases', icon: 'fa-user-tie', meta: a.getFlag(MODULE_ID, 'email'), img: imgOk(a.img) || undefined, count: counts.get(`a:${a.id}`) || 0 });
    }
    for (const gr of game.nightcity?.contactGroupService?.getMasterGroups?.() || []) {
      items.push({ id: `g:${gr.id}`, name: gr.name, group: 'Groups', icon: 'fa-users', img: gr.img || undefined, color: gr.color || undefined, meta: `${gr.members.length} member${gr.members.length !== 1 ? 's' : ''}`, count: 0 });
    }
    return items;
  }

  /** Ids a Who pick matches: a character → every identity; a contact → itself (and its inbox); a group → its members. */
  _whoMatchIds(picks) {
    const all = this.masterContactService?.getAll?.() || [];
    const out = new Set();
    const addActor = (id) => { out.add(id); for (const c of identitiesOf(all, id)) out.add(c.id); };
    for (const p of picks) {
      const id = p.slice(2);
      if (p.startsWith('a:')) addActor(id);
      else if (p.startsWith('c:')) {
        out.add(id);
        const c = all.find(x => x.id === id);
        // A contact-only NPC's aliases share its inbox; the main identity covers them.
        if (c && !c.actorId && identityRole(all, c)?.isPrimary) for (const x of identitiesOfContact(all, c)) out.add(x.id);
      } else if (p.startsWith('g:')) {
        const gr = game.nightcity?.contactGroupService?.getMasterGroup?.(id) || (game.nightcity?.contactGroupService?.getMasterGroups?.() || []).find(x => x.id === id);
        for (const m of gr?.members || []) {
          if (m.hint?.actorId) out.add(m.hint.actorId);
          if (m.hint?.contactId) out.add(m.hint.contactId);
          if (m.email) out.add(String(m.email).toLowerCase());
        }
      }
    }
    return out;
  }

  _gatherActivity() {
    const junkOf = game.nightcity?.spamService?.junkMatcher?.() || null;
    const entries = [];
    const nowMs = this._nowMs?.() ?? Date.now();

    try {
      // Scan all NCM inbox journals (flag-based identity, legacy-name fallback)
      for (const journal of game.journal ?? []) {
        const inbox = MessageRepository.identifyInbox(journal);
        if (!inbox) continue;
        const isContactInbox = inbox.isContact;
        const ownerId = inbox.ownerId;
        const ownerActor = isContactInbox ? null : game.actors?.get(ownerId);
        const ownerContact = isContactInbox ? this.masterContactService?.getContact?.(ownerId) : null;
        const ownerIsPlayer = !!(ownerActor?.hasPlayerOwner || (ownerContact?.actorId && game.actors?.get(ownerContact.actorId)?.hasPlayerOwner));

        for (const page of journal.pages ?? []) {
          const flags = page.flags?.['night-city-messenger'];
          if (!flags) continue;

          const msgId = flags.messageId || page.id;
          const isSentCopy = msgId.endsWith('-sent');
          const fromActorId = flags.fromActorId || '';
          const toActorId = flags.toActorId || '';
          const fromContactId = flags.fromContactId || '';
          const toContactId = flags.toContactId || '';
          const anon = flags.anonymous?.enabled && !flags.anonymous.traced ? flags.anonymous : null;
          const from = anon && anon.role !== 'recipient' && !isSentCopy
            ? (anon.alias || ANON_DEFAULT_ALIAS)
            : resolveDisplayName({ contactId: fromContactId, actorId: fromActorId, email: flags.from, storedName: flags.senderName }, flags.senderName || flags.from || 'Unknown');
          const to = resolveDisplayName({ contactId: toContactId, actorId: toActorId, email: flags.to, storedName: flags.recipientName }, flags.recipientName || flags.to || 'Unknown');
          const subject = flags.subject || page.name || '(no subject)';
          const body = flags.body || page.text?.content || '';
          const timestamp = flags.timestamp || '';
          const rawTimestamp = timestamp ? new Date(timestamp).getTime() : 0;
          const isRead = flags.status?.read ?? false;
          const isDeleted = flags.status?.deleted ?? false;
          const network = flags.metadata?.networkTrace || flags.network || 'CITINET';
          const signal = flags.metadata?.signalStrength ?? null;
          const encrypted = flags.status?.encrypted ?? false;
          const attachments = (flags.attachments || []).map(a => ({
            name: typeof a === 'string' ? a : (a.name || a.filename || 'attachment'),
            icon: a?.isMedia ? 'fa-film' : (a?.itemId || a?.itemUuid ? 'fa-microchip' : 'fa-paperclip'),
          }));

          // Direction
          let dirClass = 'in';
          let dirIcon = 'arrow-down';
          if (isSentCopy) { dirClass = 'out'; dirIcon = 'arrow-up'; }
          if (flags.isBroadcast || flags.type === 'broadcast') { dirClass = 'system'; dirIcon = 'tower-broadcast'; }

          // Status
          let statusClass = 'delivered';
          let statusIcon = 'check';
          let statusLabel = 'Delivered';
          if (isDeleted) { statusClass = 'deleted'; statusIcon = 'trash'; statusLabel = 'Deleted'; }
          else if (isSentCopy) { statusClass = 'sent'; statusIcon = 'paper-plane'; statusLabel = 'Sent'; }
          else if (isRead) { statusClass = 'read'; statusIcon = 'check-double'; statusLabel = 'Read'; }
          else { statusClass = 'unread'; statusIcon = 'envelope'; statusLabel = 'Unread'; }

          const relativeTime = this.app._relativeTime(timestamp);
          const fullTimestamp = timestamp ? formatCyberDate(timestamp) : '';
          const shortDate = timestamp ? formatCyberDate(timestamp, { dateOnly: true }) : '';
          const sameDay = rawTimestamp && new Date(rawTimestamp).toISOString().slice(0, 10) === new Date(nowMs).toISOString().slice(0, 10);
          const whenShort = timestamp ? (sameDay ? formatCyberDate(timestamp, { timeOnly: true }) : shortDate) : '';

          let bodyPreview = body.replace(/<[^>]+>/g, '');
          if (bodyPreview.length > 300) bodyPreview = bodyPreview.slice(0, 300) + '...';

          const _ns = game.nightcity?.networkService;
          const _netData = _ns?.getNetwork?.(network.toUpperCase()) || _ns?.getNetwork?.(network) || null;
          const networkColor = _netData?.theme?.color || '#8888a0';
          const networkIcon = _netData?.theme?.icon || 'fa-wifi';
          const participants = Array.isArray(flags.participants) ? flags.participants : [];

          entries.push({
            messageId: msgId,
            inboxOwnerId: ownerId,
            ownerIsPlayer,
            pageId: page.id,
            journalId: journal.id,
            fromName: from,
            toName: to,
            fromEmail: anon && !isSentCopy ? (anon.maskedEmail || ANON_MASKED_EMAIL) : (flags.from || ''),
            toEmail: flags.to || '',
            // IDENTITIES — the alias a message went out from / came in on.
            fromAlias: this._aliasNote(fromContactId),
            // SEND AS A TERMINAL ACCOUNT — the machine and who was really typing (sent copies only).
            sentVia: flags.sentVia ? {
              machine: flags.sentVia.machine || 'a terminal',
              typist: flags.sentVia.operatorName || 'someone',
              impersonated: flags.sentVia.impersonated !== false,
            } : null,
            toAlias: this._aliasNote(toContactId),
            fromActorId,
            toActorId,
            fromContactId,
            toContactId,
            subject,
            bodyPreview,
            bodyRaw: body,
            dirClass,
            dirIcon,
            statusClass,
            statusIcon,
            statusLabel,
            networkLabel: _netData?.name || network.toUpperCase(),
            networkName: _netData?.name || network,
            networkColor,
            networkIcon,
            signalStrength: signal,
            encrypted,
            attachments,
            relativeTime,
            fullTimestamp,
            shortDate,
            whenShort,
            isRecent: rawTimestamp > 0 && (this._nowMs() - rawTimestamp) < 600000,   // game clock, like the stamp
            unread: !isRead && !isSentCopy && !isDeleted,
            isSent: isSentCopy,
            isDeleted,
            rawTimestamp,
            isExpanded: this._expandedId === msgId,
            // What the redesign flags.
            isAnon: !!anon,
            anonymous: flags.anonymous || null,
            isSpam: !!flags.status?.spam,
            // Junk = the SENDER is spam (generator, template address, GM list), even when
            // the mail sits in someone's inbox. Never for anonymous or sent copies.
            junk: (!anon && !isSentCopy) ? (junkOf?.(flags.from, flags.metadata) || null) : null,
            eddies: Number(flags.eddies) || 0,
            eddiesClaimed: !!flags.status?.eddiesClaimed,
            selfDestruct: flags.selfDestruct || null,
            priority: flags.priority || 'normal',
            participants,
            isGroup: participants.filter(p => p?.role !== 'from').length > 1,
            fromPlayer: isPlayerActor(fromActorId),
            // The delivery line: what this answers, and WHEN it was read (game clock; old mail has none).
            inReplyTo: flags.inReplyTo || '',
            readAt: flags.status?.readAt || '',
          });
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | MessagesTab._gatherActivity:`, error);
    }

    // SEND AS A TERMINAL ACCOUNT: `sentVia` (machine + real typist) is stored on
    // the SENDER's sent copy only, so the recipient's page never reveals it. The
    // GM's feed lends it to the matching RECEIVED row (same base message id) —
    // display only, in the admin panel.
    const viaByBase = new Map();
    for (const e of entries) if (e.sentVia && e.messageId.endsWith('-sent')) viaByBase.set(e.messageId.slice(0, -5), e.sentVia);
    for (const e of entries) if (!e.sentVia && viaByBase.has(e.messageId)) e.sentVia = viaByBase.get(e.messageId);
    // A player typed it from a terminal: player mail, even though it reads as the NPC's.
    for (const e of entries) if (e.sentVia?.impersonated) e.fromPlayer = true;
    // ANONYMOUS: the recipient's copy is scrubbed; the real sender is on the
    // sender's sent copy. Shown to the GM only (this panel is GM-only).
    const realByBase = new Map();
    for (const e of entries) if (e.isSent && e.anonymous?.enabled && e.anonymous.role !== 'recipient') realByBase.set(baseIdOf(e.messageId), resolveDisplayName({ contactId: e.fromContactId, actorId: e.fromActorId, email: e.fromEmail }, e.fromEmail || 'Unknown'));
    for (const e of entries) if (e.isAnon && !e.isSent) e.anonReal = realByBase.get(e.messageId) || '';
    // HELD on a player's Agent / NOT DELIVERED at all: no page anywhere, so they get a
    // row of their own — the delivery line is the only place that can say what happened.
    for (const p of this._pendingEntries(entries)) entries.push(p);

    entries.sort((a, b) => b.rawTimestamp - a.rawTimestamp);

    let filtered = entries;

    // Direction filter (kept for scripts) + the Unread chip (before the collapse,
    // so a group send narrows to its unread copies).
    if (this._filter === 'received') filtered = filtered.filter(e => e.dirClass === 'in');
    else if (this._filter === 'sent') filtered = filtered.filter(e => e.dirClass === 'out');
    else if (this._filter === 'unread') filtered = filtered.filter(e => e.unread);
    if (this._af?.has?.('unread')) filtered = filtered.filter(e => e.unread);

    // Actor / Contact filter — cross-resolve linked IDs (legacy single filter)
    if (this._actorFilter) {
      const actId = this._actorFilter;
      const matchIds = new Set([actId]);
      // The character behind the filter, and EVERY contact linked to it (its
      // identities — utils/identities.js), so an alias's mail shows too.
      const all = this.masterContactService?.getAll() ?? [];
      const self = all.find(c => c.id === actId);
      const group = self ? identitiesOfContact(all, self) : identitiesOf(all, actId);
      for (const c of group) { matchIds.add(c.id); if (c.actorId) matchIds.add(c.actorId); }
      filtered = filtered.filter(e =>
        matchIds.has(e.fromActorId) || matchIds.has(e.toActorId) ||
        matchIds.has(e.fromContactId) || matchIds.has(e.toContactId) ||
        matchIds.has(e.inboxOwnerId)
      );
    }

    // The "Who" scope picker (several people at once).
    const picks = this.app?.id ? ScopePicker.value(this.scopeId('who')) : [];
    if (picks.length) {
      const ids = this._whoMatchIds(picks);
      filtered = filtered.filter(e => ids.has(e.fromActorId) || ids.has(e.toActorId) || ids.has(e.fromContactId)
        || ids.has(e.toContactId) || ids.has(e.inboxOwnerId) || ids.has(String(e.fromEmail).toLowerCase()) || ids.has(String(e.toEmail).toLowerCase()));
    }

    // Search filter
    if (this._search) {
      const q = this._search.toLowerCase();
      filtered = filtered.filter(e =>
        (e.fromAlias?.name || '').toLowerCase().includes(q) || (e.toAlias?.name || '').toLowerCase().includes(q) ||
        e.fromName.toLowerCase().includes(q) ||
        e.toName.toLowerCase().includes(q) ||
        String(e.fromEmail || '').toLowerCase().includes(q) || String(e.toEmail || '').toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        e.bodyPreview.toLowerCase().includes(q)
      );
    }

    // Date range filter
    if (this._dateFrom) {
      const fromMs = new Date(this._dateFrom + 'T00:00:00').getTime();
      if (!isNaN(fromMs)) filtered = filtered.filter(e => e.rawTimestamp >= fromMs);
    }
    if (this._dateTo) {
      const toMs = new Date(this._dateTo + 'T23:59:59').getTime();
      if (!isNaN(toMs)) filtered = filtered.filter(e => e.rawTimestamp <= toMs);
    }

    // A fan-out (one send, N recipients) is N inbox pages sharing a base
    // messageId — collapse them into one row per send, expandable to the
    // per-recipient read state, so a group message doesn't eat the feed.
    filtered = this._collapseFanout(filtered);
    // A sent copy and its received twin are one message; show it once (the
    // received row carries the read state) unless the Sent direction asks for copies.
    if (this._filter !== 'sent') filtered = this._mergeSentTwins(filtered);

    // Spam AND junk senders are out of All mail unless the Spam filter is picked (dev,
    // 2026-10-27): junk is decided by the sender, so it stays out even after a player
    // drags it back into their inbox.
    const isJunky = (e) => e.isSpam || !!e.junk || (e.isGroupRow && (e.recipients || []).every(r => r.isSpam || r.junk));
    const spamCount = filtered.filter(isJunky).length;
    if (!this._af?.has('spam')) filtered = filtered.filter(e => !isJunky(e));
    const counts = { ...flagCounts(filtered), spam: spamCount };
    filtered = applyMailFilters(filtered, { box: this._box || 'all', flags: [...(this._af || [])].filter(k => k !== 'unread') });

    // Oldest first is decided BEFORE the page cut, so "Load more" walks forward in time.
    if (this._oldest) filtered = [...filtered].reverse();

    // A selection beyond the page grows the page so the row is visible.
    if (this._sel) {
      const at = filtered.findIndex(e => e.messageId === this._sel);
      if (at >= this._limit) this._limit = at + 1;
    }
    // Track total before limiting (for "Load More" button)
    const totalFiltered = filtered.length;
    return { entries: filtered.slice(0, this._limit), totalFiltered, counts, filtered, everything: entries };
  }

  /**
   * Merge received copies that share a base messageId (a multi-recipient send)
   * into one synthetic group row. Sent copies and lone messages pass through
   * untouched; order (newest first) is kept by the newest member's position.
   * @param {Array<Object>} entries  sorted newest → oldest
   * @returns {Array<Object>}
   */
  _collapseFanout(entries) {
    const byBase = new Map();
    for (const e of entries) {
      if (e.isSent || e.isGroupRow) continue;
      const base = String(e.messageId || '').replace(/-sent$/, '');
      if (!base) continue;
      if (!byBase.has(base)) byBase.set(base, []);
      byBase.get(base).push(e);
    }
    const out = [];
    const done = new Set();
    for (const e of entries) {
      const base = String(e.messageId || '').replace(/-sent$/, '');
      const members = (!e.isSent && byBase.get(base)) || null;
      if (!members || members.length < 2) { out.push(e); continue; }
      if (done.has(base)) continue;
      done.add(base);
      const key = `fanout:${base}`;
      const unreadCount = members.filter(m => m.unread).length;
      out.push({
        ...members[0],
        isGroupRow: true,
        isGroup: true,
        messageId: key,
        inboxOwnerId: '',
        toName: `${members.length} recipients`,
        recipientCount: members.length,
        unreadCount,
        unread: unreadCount > 0,
        statusClass: unreadCount > 0 ? 'unread' : 'read',
        statusIcon: unreadCount > 0 ? 'envelope' : 'check-double',
        statusLabel: unreadCount > 0 ? `${unreadCount} / ${members.length} unread` : `${members.length} read`,
        isExpanded: this._expandedId === key,
        recipients: members.map(m => ({
          messageId: m.messageId, inboxOwnerId: m.inboxOwnerId, toName: m.toName, toActorId: m.toActorId, toContactId: m.toContactId,
          unread: m.unread, isDeleted: m.isDeleted, statusLabel: m.statusLabel, statusClass: m.statusClass, statusIcon: m.statusIcon,
          eddiesClaimed: m.eddiesClaimed, readAt: m.readAt || '', toEmail: m.toEmail || '',
        })),
      });
    }
    return out;
  }

  /** Drop a sent copy whose received twin (or fan-out row) is in the list; the twin remembers it. */
  _mergeSentTwins(entries) {
    const received = new Map();
    for (const e of entries) {
      if (e.isSent) continue;
      received.set(e.isGroupRow ? e.messageId.slice(7) : e.messageId, e);
    }
    const out = [];
    for (const e of entries) {
      if (e.isSent) {
        const twin = received.get(baseIdOf(e.messageId));
        if (twin) { twin.sentCopyId = e.messageId; twin.sentOwnerId = e.inboxOwnerId; if (!twin.sentVia && e.sentVia) twin.sentVia = e.sentVia; continue; }
      }
      out.push(e);
    }
    return out;
  }

  _rowFlags(e) {
    const out = [];
    if (e.isAnon) out.push(flag('anon'));
    if (e.isGroupRow) out.push(flag('group', `×${e.recipientCount}`));
    else if (e.isGroup) out.push(flag('group'));
    if (e.sentVia) out.push(flag('via', e.sentVia.machine));
    if (e.sentVia?.impersonated) out.push(flag('typed', e.sentVia.typist));
    if (e.eddies > 0) out.push(flag('eb', `${e.eddies.toLocaleString()}${e.isGroupRow ? ` ×${e.recipientCount}` : ''}`));
    if (e.selfDestruct) out.push(flag('sd', e.selfDestruct.mode === 'after_read' ? 'on read' : (e.selfDestruct.mode || '')));
    if (e.encrypted) out.push(flag('enc'));
    if (e.attachments?.length) out.push(flag('att', e.attachments.length > 1 ? `×${e.attachments.length}` : ''));
    if (e.fromAlias) out.push(flag('alias', `of ${e.fromAlias.of}`));
    if (e.junk) out.push({ ...flag('junk'), tip: e.junk.label });
    if (e.isSpam) out.push(flag('spam'));
    if (e.priority && e.priority !== 'normal') out.push({ ...flag('prio'), label: e.priority });
    if (e.isSent) out.push(flag('sent'));
    if (e.isDeleted) out.push(flag('deleted'));
    if (e.held) out.push(flag('held'));
    else if (e.isPending) out.push(flag('failed'));
    return out;
  }

  _allContext(failures) {
    const res = this._gatherActivity();
    const nowMs = this._nowMs();
    // Who picker counts: messages per id over the whole (unfiltered by who) feed is
    // expensive to compute twice; count over what the list holds right now.
    const counts = new Map();
    for (const e of res.filtered) {
      for (const id of [e.fromActorId && `a:${e.fromActorId}`, e.toActorId && `a:${e.toActorId}`, e.fromContactId && `c:${e.fromContactId}`, e.toContactId && `c:${e.toContactId}`]) {
        if (id) counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    // One Filter picker in place of the From and flag chip rows (dev: "can be consolidated").
    // A ScopePicker callback fires on every change, opening included — compare before acting.
    const filtId = this.scopeId('mailfilter');
    const filtWas = [...(this._box === 'pc' ? ['box:pc'] : this._box === 'npc' ? ['box:npc'] : []), ...(this._af || [])];
    ScopePicker.set(filtId, filtWas);
    const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
    ScopePicker.on(filtId, (v) => {
      if (same(v, filtWas)) return;
      const pc = v.includes('box:pc'), npc = v.includes('box:npc');
      this._box = pc && !npc ? 'pc' : npc && !pc ? 'npc' : 'all';
      this._af = new Set(v.filter(k => !k.startsWith('box:')));
      this._limit = 40; this._calLimit = 50; this._calAuto = true; this.render(true);
    });
    const whoId = this.scopeId('who');
    const whoWas = this.app?.id ? ScopePicker.value(whoId) : [];
    ScopePicker.on(whoId, (v) => { if (same(v, whoWas)) return; this._limit = 40; this._calLimit = 50; this._calAuto = true; this.render(true); });

    // ── The calendar navigator: counts from ONE pass over the filtered feed, then the
    //    level's own list, paged. Every filter above already narrowed `res.filtered`,
    //    so every tile / cell / badge is honest about what the GM would see.
    const all = res.filtered;
    const cal = this._calendar(all, nowMs);
    const rows = cal.page.map(e => ({
      ...e,
      ...this._face(e.isAnon && !e.isSent ? 'Anonymous' : e.fromName, e.isAnon && !e.isSent ? {} : { contactId: e.fromContactId, actorId: e.fromActorId, email: e.fromEmail }),
      isAnonRow: e.isAnon && !e.isSent,
      fromLabel: e.isAnon && !e.isSent ? 'Anonymous' : e.fromName,
      flags: this._rowFlags(e),
      sel: e.messageId === this._sel,
      // Day level: the time; week / month: "11 · 20:40" (the day of the month, then the time).
      calWhen: e.rawTimestamp ? (cal.level === 'day' ? formatCyberDate(e.rawTimestamp, { timeOnly: true }) : `${new Date(e.rawTimestamp).getUTCDate()} · ${formatCyberDate(e.rawTimestamp, { timeOnly: true })}`) : '',
    }));
    if (!this._sel || !rows.some(r => r.sel)) { if (rows[0]) { rows[0].sel = true; this._sel = rows[0].messageId; } }
    if (cal.level === 'day') cal.bands = orderBands(daySplit(rows), this._oldest).map(b => ({ key: b.key, label: b.label, rows: b.rows }));
    else cal.rows = rows;
    const selEntry = res.filtered.find(e => e.messageId === this._sel) || null;
    const hasDates = !!(this._dateFrom || this._dateTo);
    return {
      search: this._search,
      whoPicker: ScopePicker.html(whoId, { noun: 'person', nouns: 'people', icon: 'fa-user', label: 'Who', multi: true, allLabel: 'Anyone', items: this._whoItems(counts), countLabel: 'messages', activeLabel: 'Has mail' }),
      hasDates,
      dateLabel: hasDates ? `${this._dateFrom || '…'} → ${this._dateTo || '…'}` : 'Any time',
      filterPicker: ScopePicker.html(filtId, {
        noun: 'filter', nouns: 'filters', icon: 'fa-filter', label: 'Filter', multi: true, allLabel: 'Everything', countLabel: 'messages',
        items: [
          { id: 'box:pc', name: 'From players', group: 'From', icon: 'fa-user', count: res.filtered.filter(e => e.fromPlayer).length },
          { id: 'box:npc', name: 'From NPCs', group: 'From', icon: 'fa-user-tie', count: res.filtered.filter(e => !e.fromPlayer).length },
          ...MAIL_FLAGS.filter(([k]) => k !== 'spam').map(([k, l, icon]) => ({ id: k, name: l, group: 'Kind', icon, count: k === 'unread' ? res.filtered.filter(e => e.unread).length : (res.counts[k] || 0) })),
          { id: 'spam', name: 'Spam & junk senders', group: 'Spam', icon: 'fa-filter', meta: 'hidden unless picked', count: res.counts.spam || 0 },
        ],
      }),
      activeFilters: [
        ...(this._box === 'pc' ? [{ key: 'box:pc', label: 'From players', icon: 'fa-user' }] : this._box === 'npc' ? [{ key: 'box:npc', label: 'From NPCs', icon: 'fa-user-tie' }] : []),
        ...MAIL_FLAGS.filter(([k]) => this._af.has(k)).map(([k, l, icon]) => ({ key: k, label: l, icon })),
        // A legacy date range (macros / the old picker) is shown so it can be let go of.
        ...(hasDates ? [{ key: 'dates', label: `${this._dateFrom || '…'} → ${this._dateTo || '…'}`, icon: 'fa-calendar' }] : []),
      ],
      boxChips: [['all', 'Everything'], ['pc', 'From players'], ['npc', 'From NPCs']].map(([k, l]) => ({ key: k, label: l, on: this._box === k })),
      flagChips: MAIL_FLAGS.map(([k, l, icon]) => ({ key: k, label: l, icon, on: this._af.has(k), count: k === 'unread' ? res.filtered.filter(e => e.unread).length : (res.counts[k] || 0) })),
      anyFlag: this._af.size > 0 || this._box !== 'all',
      oldest: this._oldest,
      cal,

      hasRows: rows.length > 0,
      shown: rows.length, total: cal.total, grand: all.length, hasMore: cal.total > rows.length,
      sel: selEntry ? this._mailDetail(selEntry, failures, res.everything) : null,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  THE CALENDAR NAVIGATOR (All mail's left column, 2026-10-28)
  //  Version A of dev/mockups/admin-mail-navigator-mock.html. Rules in messagesModel.js.
  // ═══════════════════════════════════════════════════════════

  _calState() { return { level: this._calLevel, year: this._calYear, month: this._calMonth, week: this._calWeek, day: this._calDay, viaWeek: this._calViaWeek }; }

  /** Move the navigator; `anim` names the entrance the next render plays once. */
  _calSet(s, anim = '') {
    this._calLevel = s.level; this._calYear = s.year; this._calMonth = s.month; this._calWeek = s.week || 0; this._calDay = s.day || 0;
    this._calViaWeek = !!s.viaWeek;
    this._calLimit = 50;
    if (anim) this._calAnim = anim;
  }

  /**
   * The level's view-model + its paged list. `all` = the filtered feed (newest first,
   * or oldest first when the GM flipped it). One pass for the counts, one filter for
   * the range, one slice for the page.
   */
  _calendar(all, nowMs) {
    if (!this._calYear) this._calSet(calHome(nowMs));
    // openTo(message): land on the day that holds it.
    if (this._calFollow) {
      this._calFollow = false;
      // A base id that became a fan-out row opens that row.
      const e = all.find(x => x.messageId === this._sel) || all.find(x => x.isGroupRow && x.messageId === `fanout:${this._sel}`);
      if (e) { this._sel = e.messageId; if (e.rawTimestamp) this._calSet(calStateFor('day', e.rawTimestamp)); }
    }
    const counts = calendarCounts(all);
    let s = this._calState(), range = calRange(s);
    let list = all.filter(e => e.rawTimestamp && inRange(e.rawTimestamp, range));
    // A new search / filter whose hits all sit elsewhere: jump to the newest hit
    // (same level for a year; week / day views widen to the month that holds it).
    if (this._calAuto) {
      this._calAuto = false;
      if (!list.length && all.length) {
        let newest = 0;
        for (const e of all) if (e.rawTimestamp > newest) newest = e.rawTimestamp;
        if (newest) {
          this._calSet(calStateFor(s.level === 'year' ? 'year' : 'month', newest));
          s = this._calState(); range = calRange(s);
          list = all.filter(e => e.rawTimestamp && inRange(e.rawTimestamp, range));
        }
      }
    }
    // A selection beyond the page grows the page so the row is visible.
    if (this._sel) { const at = list.findIndex(e => e.messageId === this._sel); if (at >= this._calLimit) this._calLimit = at + 1; }
    const page = list.slice(0, this._calLimit);
    const reduce = (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
      || game.nightcity?.themeService?.getAnimationLevel?.() === 'off';
    const anim = this._calAnim; this._calAnim = '';
    const n = (c) => c?.n || 0;
    const nOrDash = (c) => (c?.n ? String(c.n) : '—');
    const fmtDay = (ms) => formatCyberDate(new Date(ms).toISOString(), { dateOnly: true });
    const cal = {
      level: s.level, isYear: s.level === 'year', isMonth: s.level === 'month', isWeek: s.level === 'week', isDay: s.level === 'day', isStrip: s.level === 'week' || s.level === 'day',
      key: `${s.level}:${range.from}`, crumbs: calCrumbs(s), fresh: !!anim && !reduce, anim,
      page, total: list.length, undated: counts.undated, canUp: s.level !== 'year',
      quick: [
        { to: 'today', label: 'Today', icon: 'fa-calendar-day', on: s.level === 'day' && s.day === calStateFor('day', nowMs).day },
        { to: 'week', label: 'This week', icon: 'fa-calendar-week', on: s.level === 'week' && s.week === calStateFor('week', nowMs).week },
        { to: 'month', label: 'This month', icon: 'fa-calendar', on: s.level === 'month' && s.year === calStateFor('month', nowMs).year && s.month === calStateFor('month', nowMs).month },
      ],
    };
    if (s.level === 'year') {
      const y = yearTiles(counts, s.year, nowMs);
      cal.tiles = y.tiles;
      cal.head = { title: String(s.year), subline: `${y.year.n} ${y.year.n === 1 ? 'message' : 'messages'}${y.year.unread ? ` · ${y.year.unread} unread` : ''}` };
      cal.prev = { label: String(y.prev.year), n: nOrDash(y.prev) }; cal.next = { label: String(y.next.year), n: nOrDash(y.next) };
      cal.hint = 'click a month';
    } else if (s.level === 'month') {
      const m = monthCells(counts, s.year, s.month, nowMs);
      cal.cells = m.cells; cal.weeks = m.weeks; cal.dowLabels = WEEKDAYS_SHORT.map(w => w[0]);
      cal.head = { title: `${MONTHS_LONG[s.month]} ${s.year}`, subline: `${m.month.n} ${m.month.n === 1 ? 'message' : 'messages'}${m.month.unread ? ` · ${m.month.unread} unread` : ''}` };
      cal.prev = { label: MONTHS_LONG[m.prev.month], n: nOrDash(m.prev) }; cal.next = { label: MONTHS_LONG[m.next.month], n: nOrDash(m.next) };
      cal.hint = 'click a day or a week';
      cal.listLabel = `or the month's mail, ${this._oldest ? 'oldest' : 'newest'} first`;
      cal.gridH = this._calGridH || 0;
    } else {
      cal.strip = weekStrip(counts, s.week, nowMs, { selDay: s.level === 'day' ? s.day : null });
      if (s.level === 'week') {
        const c = counts.weeks.get(s.week);
        cal.head = { title: `Week ${isoWeek(s.week)}`, subline: `${fmtDay(s.week)} – ${fmtDay(s.week + 6 * 86400000)} · ${n(c)} ${n(c) === 1 ? 'message' : 'messages'}`, unread: c?.unread || 0 };
        const p = counts.weeks.get(s.week - 7 * 86400000), nx = counts.weeks.get(s.week + 7 * 86400000);
        cal.prev = { label: `Week ${isoWeek(s.week - 7 * 86400000)}`, n: nOrDash(p) }; cal.next = { label: `Week ${isoWeek(s.week + 7 * 86400000)}`, n: nOrDash(nx) };
        cal.hint = 'click a day';
      } else {
        const c = counts.days.get(s.day);
        cal.head = { title: `${WEEKDAYS_LONG[dow(s.day)]} · ${fmtDay(s.day)}`, subline: `${n(c)} ${n(c) === 1 ? 'message' : 'messages'}`, unread: c?.unread || 0 };
        const lab = (ms) => `${WEEKDAYS_SHORT[dow(ms)]} ${new Date(ms).getUTCDate()}`;
        cal.prev = { label: lab(s.day - 86400000), n: nOrDash(counts.days.get(s.day - 86400000)) }; cal.next = { label: lab(s.day + 86400000), n: nOrDash(counts.days.get(s.day + 86400000)) };
        cal.hint = '';
      }
    }
    return cal;
  }

  /** The navigator's ops (from onAct). */
  _onCalAct(op, d) {
    const s = this._calState();
    const nowMs = this._nowMs();
    switch (op) {
      case 'calLevel': {                       // a breadcrumb: back to that level
        if (d.level === 'year') this._calSet({ ...s, level: 'year' }, 'up');
        else if (d.level === 'month') this._calSet({ ...s, level: 'month', viaWeek: false }, 'up');
        else if (d.level === 'week') this._calSet({ ...s, level: 'week' }, 'up');
        break;
      }
      case 'calMonth': this._calSet(calStateFor('month', Date.UTC(Number(d.year ?? s.year), Number(d.month), 1)), 'grow'); break;
      case 'calWeek': this._calSet({ ...calStateFor('week', Number(d.start)), viaWeek: false }, 'fold'); break;
      case 'calDay': this._calSet({ ...calStateFor('day', Number(d.ms)), viaWeek: s.level === 'week' || (s.level === 'day' && s.viaWeek) }, s.level === 'month' ? 'fold' : 'step-next'); break;
      case 'calStep': { const dir = Number(d.dir) < 0 ? -1 : 1; this._calSet(calStep(s, dir), dir < 0 ? 'step-prev' : 'step-next'); break; }
      case 'calUp': if (s.level !== 'year') this._calSet(calUp(s), 'up'); break;
      case 'calJump': {
        if (d.to === 'today') this._calSet(calStateFor('day', nowMs), 'fold');
        else if (d.to === 'week') this._calSet(calStateFor('week', nowMs), 'fold');
        else this._calSet(calStateFor('month', nowMs), 'grow');
        break;
      }
      case 'calMore': this._calLimit += 50; break;
      default: return false;
    }
    // The selection is kept: when it sits in the new view it stays open, else the
    // view's first row opens (the _allContext rule).
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  //  THE DELIVERY LINE — under From / To / When in the reading pane
  // ═══════════════════════════════════════════════════════════
  //
  // Built for the OPEN message only (never per row). The rules + copy live in
  // messagesModel.js (deliveryLine / groupDeliveryLine); this gathers the facts:
  //   delivered / read   — the inbox pages (status.read, status.readAt)
  //   replied            — a later message whose inReplyTo is this one, written
  //                        by the recipient (cheap: the feed is already gathered)
  //   answered           — the GM's ✓ (npcMailAnswered)
  //   held               — the queue a player's Agent reports (MESSAGE_QUEUE_SYNC)
  //   not delivered      — the deliveryFailures log (recordDeliveryFailure)

  /**
   * Mail with no inbox page: held on a player's Agent, or a send that failed
   * outright. They get a row in All mail so the delivery line can say so.
   * @param {Array<Object>} existing  the page-backed entries
   */
  _pendingEntries(existing) {
    const have = new Set(existing.map(e => baseIdOf(e.messageId)));
    const out = [];
    const svc = this.messageService;
    const raw = [];
    for (const d of svc?._messageQueue || []) raw.push({ d, userName: game.user?.name || '' });
    for (const [userId, rep] of svc?._remoteQueues || []) for (const d of rep.entries || []) raw.push({ d, userId, userName: rep.userName || 'a player' });
    for (const { d, userId, userName } of raw) {
      const id = baseIdOf(d.messageId || d.id || '');
      if (!id || have.has(id)) continue;
      have.add(id);
      const by = (d.fromActorId && game.actors?.get(d.fromActorId)?.name) || d.fromName || userName || 'the sender';
      const placeScene = d._queueReason === 'dead_zone' ? (game.users?.get?.(userId)?.viewedScene && game.scenes?.get?.(game.users.get(userId).viewedScene)?.name) || '' : '';
      out.push(this._pendingEntry(d, id, {
        held: { reason: d._queueReason || 'dead_zone', by, place: placeScene, ago: d._queuedAt ? this._ageReal(Date.now() - new Date(d._queuedAt).getTime()) : '' },
        fromPlayer: !!userId || isPlayerActor(d.fromActorId),
      }));
    }
    for (const f of this.messageService?.getDeliveryFailures?.() || []) {
      if (!f.baseId || have.has(f.baseId)) continue;
      have.add(f.baseId);
      const d = { ...this._retryTarget(f.retry), messageId: f.baseId, subject: f.subject || f.retry?.subject, fromName: f.fromName, timestamp: f.gameAt || f.at };
      if (Array.isArray(d.recipients) && d.recipients.length > 1) d._fanout = d.recipients.map(r => ({ toActorId: r.actorId, toContactId: r.contactId, to: r.email, toName: r.name }));
      else if (!d.toActorId && !d.toContactId && !d.to) d.toName = f.toName;
      out.push(this._pendingEntry(d, f.baseId, { failureId: f.id, fromPlayer: f.source === 'relay' || isPlayerActor(d.fromActorId) }));
    }
    return out;
  }

  /** A retry payload with ONE failed recipient read as a plain To (the fan-out list is for two or more). */
  _retryTarget(retry) {
    const d = { ...(retry || {}) };
    const one = Array.isArray(d.recipients) && d.recipients.length === 1 ? d.recipients[0] : null;
    if (one && !d.toActorId && !d.toContactId && !d.to) Object.assign(d, { toActorId: one.actorId || '', toContactId: one.contactId || '', to: one.email || '', toName: one.name || '' });
    return d;
  }

  /** A feed entry for mail that has no page (held / failed). Same shape as a page row. */
  _pendingEntry(d, id, { held = null, failureId = '', fromPlayer = false } = {}) {
    const ts = d.timestamp || '';
    const raw = ts ? new Date(ts).getTime() || 0 : 0;
    const fan = Array.isArray(d._fanout) && d._fanout.length > 1 ? d._fanout : null;
    const name = (o) => resolveDisplayName({ contactId: o.toContactId, actorId: o.toActorId, email: o.to, storedName: o.toName }, o.toName || o.to || 'Unknown');
    const body = d.body || '';
    return {
      messageId: id, inboxOwnerId: '', ownerIsPlayer: false, pageId: '', journalId: '',
      fromName: resolveDisplayName({ contactId: d.fromContactId, actorId: d.fromActorId, email: d.from, storedName: d.fromName }, d.fromName || d.from || 'Unknown'),
      toName: fan ? `${fan.length} recipients` : name(d),
      fromEmail: d.from || '', toEmail: d.to || '',
      fromAlias: this._aliasNote(d.fromContactId || ''), toAlias: this._aliasNote(d.toContactId || ''), sentVia: null,
      fromActorId: d.fromActorId || '', toActorId: d.toActorId || '', fromContactId: d.fromContactId || '', toContactId: d.toContactId || '',
      subject: d.subject || '(no subject)', bodyPreview: body.replace(/<[^>]+>/g, '').slice(0, 300), bodyRaw: body,
      dirClass: 'out', dirIcon: 'arrow-up',
      statusClass: held ? 'held' : 'failed', statusIcon: held ? 'hourglass-half' : 'triangle-exclamation', statusLabel: held ? 'Held' : 'Not delivered',
      networkLabel: '', networkName: '', networkColor: '', networkIcon: '', signalStrength: null, encrypted: false, attachments: [],
      relativeTime: this.app._relativeTime(ts), fullTimestamp: ts ? formatCyberDate(ts) : '',
      shortDate: ts ? formatCyberDate(ts, { dateOnly: true }) : '', whenShort: ts ? formatCyberDate(ts, { timeOnly: true }) : '',
      isRecent: false, unread: false, isSent: false, isDeleted: false, rawTimestamp: raw, isExpanded: false,
      isAnon: false, anonymous: null, isSpam: false, junk: null, eddies: Number(d.eddies) || 0, eddiesClaimed: false, selfDestruct: null,
      priority: d.priority || 'normal', participants: [], isGroup: !!fan, fromPlayer,
      inReplyTo: '', readAt: '',
      isPending: true, held, failureId,
      pendingCopies: fan ? fan.map(c => ({ toName: name(c), toActorId: c.toActorId || '', toContactId: c.toContactId || '', toEmail: c.to || '' })) : null,
    };
  }

  /** A time for a step: the clock alone on the day it was sent, else date + time. */
  _dlTime(iso, refIso) {
    if (!iso) return '';
    const day = (x) => { const t = new Date(x).getTime(); return t ? new Date(t).toISOString().slice(0, 10) : ''; };
    return day(iso) && day(iso) === day(refIso || iso) ? formatCyberDate(iso, { timeOnly: true }) : formatCyberDate(iso);
  }

  /** The players behind a character: names + whether any is connected. */
  _playersOf(actorId) {
    const actor = actorId ? game.actors?.get(actorId) : null;
    if (!actor?.hasPlayerOwner) return { isPlayer: false, names: '', online: false, userIds: [] };
    const users = (game.users || []).filter(u => !u.isGM && (u.character?.id === actorId || Number(actor.ownership?.[u.id]) >= 3));
    return { isPlayer: true, names: users.map(u => u.name).join(', '), online: users.some(u => u.active), userIds: users.map(u => u.id) };
  }

  /** The recipient's answer to a message (earliest), if any: a message replying to it that they wrote. */
  _replyTo(base, rcp, everything) {
    const email = String(rcp.toEmail || '').toLowerCase();
    let best = null;
    for (const x of everything) {
      if (!x.inReplyTo || baseIdOf(x.inReplyTo) !== base || x.isPending) continue;
      const mine = (rcp.toActorId && x.fromActorId === rcp.toActorId) || (rcp.toContactId && x.fromContactId === rcp.toContactId)
        || (email && String(x.fromEmail || '').toLowerCase() === email);
      if (!mine) continue;
      if (!best || x.rawTimestamp < best.rawTimestamp || (x.rawTimestamp === best.rawTimestamp && !x.isSent)) best = x;
    }
    return best;
  }

  /** Does this failure read as a send-only refusal? */
  _isSendOnlyFailure(row, toEmail) {
    if (/send-only|send only|transmission refused|SEND_ONLY|system address/i.test(String(row?.why || ''))) return true;
    try { return !!(toEmail && this.masterContactService?.isSendOnly?.(toEmail)); } catch { return false; }
  }

  /** The directory contact a failed message was written to. */
  _failureContact(d) {
    const mcs = this.masterContactService;
    if (d?.toContactId && mcs?.getContact?.(d.toContactId)) return mcs.getContact(d.toContactId);
    if (d?.to && mcs?.getByEmail?.(d.to)) return mcs.getByEmail(d.to);
    if (d?.toActorId) return mcs?.getByActorId?.(d.toActorId) || null;
    return null;
  }

  /** The delivery line for the open message. */
  /** The delivery line drawn as "Where it went": a track of stops, or a row of segments per person. */
  _journey(dl, e, from, to) {
    if (!dl) return dl;
    const route = `<b>${esc(from?.name || e.fromName || '')}</b><span class="arr">→</span><b>${esc(to?.name || e.toName || '')}</b>`;
    const shut = this._jrShut;
    if (dl.group) {
      const g = journeyPeople((dl.rcp || []).map(r => ({ ...r, segs: journeySegs(r.state), nameKey: String(r.name || '').toLowerCase() })));
      const filter = this._jrFilter.get(e.messageId) || g.defaultFilter;
      const c = g.counts;
      const status = { tone: c.problem ? 'bad' : c.unread ? 'wait' : 'good', word: c.problem ? `${c.problem} problem${c.problem > 1 ? 's' : ''}` : c.unread ? `${c.unread} not read` : 'all read' };   // the one thing that matters most; the full count is in the route + chips
      return { ...dl, ...g, rcp: g.people, filter, chips: g.chips.map(ch => ({ ...ch, on: ch.k === filter, id: e.messageId })), route: `<b>${esc(from?.name || e.fromName || '')}</b><span class="arr">→</span><b>${g.total} people</b>`, status, shut };
    }
    const track = journeyTrack(dl.steps, { netName: e.networkLabel || '', netSignal: e.signalStrength != null ? `signal ${e.signalStrength}%` : '' });
    // The strip says it in words; a quiet, finished message (read, answered, nothing to do) needs no strip.
    const strip = dl.tone !== 'good' || (dl.fixes || []).length > 0;
    // One button leads (filled); the rest are quiet. A fix list with no lead promotes its first.
    const fixes = (dl.fixes || []).map((f, i, all) => ({ ...f, quiet: all.some(x => !x.quiet) ? !!f.quiet : i > 0 }));
    return { ...dl, fixes, route, track, strip, hasMore: (dl.grid || []).length > 0, status: journeyStatus(track), shut };
  }

  _deliveryFor(e, everything = [], failures = []) {
    const base = baseIdOf(e.isGroupRow ? e.messageId.slice(7) : e.messageId);
    const fails = failures.filter(f => f.baseId && f.baseId === base);
    const answered = this._answeredMap();
    const open = this._dlOpen.has(e.messageId);
    const sentRef = e.rawTimestamp ? new Date(e.rawTimestamp).toISOString() : '';
    const sentAt = sentRef ? this._dlTime(sentRef, sentRef) : '';

    const isGroup = e.isGroupRow || (e.pendingCopies?.length > 1);
    if (isGroup) {
      const rcp = [];
      const copies = e.isGroupRow ? e.recipients : [];
      for (const c of copies) {
        const p = this._playersOf(c.toActorId);
        const reply = this._replyTo(base, c, everything);
        const read = !c.unread;
        const r = { name: c.toName, addr: c.toEmail || '', actorId: c.toActorId || '', toIsPlayer: p.isPlayer, fix: null };
        if (reply) {
          r.state = 'ans'; r.time = this._dlTime(new Date(reply.rawTimestamp).toISOString(), sentRef);
          const snip = this._plain(reply.bodyRaw || reply.bodyPreview || '', 70);
          if (snip) r.why = `replied: “${esc(snip)}”`;
          if (reply.inboxOwnerId) r.fix = { action: 'openMsgInInbox', label: 'Open it', icon: 'fa-reply', quiet: true, data: { 'inbox-owner': reply.inboxOwnerId, 'message-id': reply.messageId } };
        } else if (c.isDeleted && !read) {
          r.state = 'gone'; r.why = 'deleted it without opening it.';
        } else if (read) {
          r.state = 'read'; r.time = c.readAt ? this._dlTime(c.readAt, sentRef) : '';
          if (c.isDeleted) r.why = 'read it, then deleted it.';
        } else {
          r.state = 'got'; r.time = sentAt;
          if (!p.isPlayer) {
            r.why = `delivered, not opened — ${esc(c.toName)} is an NPC; it’s in their inbox for you.`;
            if (c.inboxOwnerId) r.fix = { action: 'openMsgInInbox', label: 'Open their inbox', icon: 'fa-inbox', quiet: true, data: { 'inbox-owner': c.inboxOwnerId, 'message-id': c.messageId } };
          } else if (this._dlNudged.has(`${c.messageId}|${c.toActorId}`)) {
            r.why = 'delivered, not opened — you nudged them.'; r.nudged = true;
          } else {
            r.why = `delivered, not opened yet. ${p.names ? `${esc(c.toName)}’s player (${esc(p.names)}) is ${p.online ? 'online' : 'offline'}.` : ''}`.trim();
            if (c.toActorId) r.fix = { op: 'dlNudge', label: 'Nudge', icon: 'fa-bell', quiet: true, data: { id: c.messageId, actor: c.toActorId } };
          }
        }
        rcp.push(r);
      }
      if (e.held && e.pendingCopies) {
        for (const c of e.pendingCopies) {
          const p = this._playersOf(c.toActorId);
          rcp.push({ name: c.toName, addr: c.toEmail, actorId: c.toActorId, toIsPlayer: p.isPlayer, state: 'held', fix: null,
            why: e.held.reason === 'gm_offline' ? `held on ${esc(e.held.by)}’s Agent — no GM was online.` : `held on ${esc(e.held.by)}’s Agent — ${e.held.place ? `<b>${esc(e.held.place)}</b> is` : 'they are in'} a dead zone.` });
        }
      }
      // Who it didn't reach (the failure log): each failed recipient of each row for this send.
      for (const f of fails) {
        const list = f.retry?.recipients?.length ? f.retry.recipients
          : e.pendingCopies?.length ? e.pendingCopies.map(c => ({ actorId: c.toActorId, contactId: c.toContactId, email: c.toEmail, name: c.toName }))
            : String(f.toName || '').split(', ').filter(Boolean).map(name => ({ name }));
        const whyOf = (n) => (String(f.why || '').split(' · ').find(s => s.startsWith(`${n}: `)) || '').slice(String(n).length + 2) || f.why || 'unknown error';
        for (const x of list) {
          const name = x.name || x.email || 'someone';
          if (rcp.some(r => r.state === 'fail' && r.name === name)) continue;
          const r = { name, addr: x.email || '', actorId: x.actorId || '', toIsPlayer: false, state: 'fail', fix: null };
          if (x.actorId && !game.actors?.get(x.actorId)) {
            r.why = 'no inbox — the character was deleted. Nothing was written for them.';
            const g = (game.nightcity?.contactGroupService?.getMasterGroups?.() || []).find(gg => (gg.members || []).some(m => m?.hint?.actorId === x.actorId));
            if (g) r.fix = { op: 'dlRemoveMember', label: `Remove from ${g.name}`, icon: 'fa-user-minus', quiet: true, data: { group: g.id, actor: x.actorId } };
          } else {
            r.why = esc(whyOf(name));
            r.fix = { op: 'failRetry', label: 'Retry', icon: 'fa-rotate-right', quiet: true, data: { id: f.id } };
          }
          rcp.push(r);
        }
      }
      for (const r of rcp) Object.assign(r, this._face(r.name, { actorId: r.actorId, email: r.addr }));
      return { ...groupDeliveryLine({ rcp, alias: e.fromAlias || null, fromName: e.fromName, held: !!e.held, messageId: e.isGroupRow ? e.messageId : base }), id: e.messageId, open };
    }

    // ── One recipient ──
    let r = e;
    let gone = false;
    if (e.isSent) {
      r = everything.find(x => !x.isSent && !x.isPending && x.messageId === base) || null;
      if (!r) { r = e; gone = !fails.length; }
    }
    const p = this._playersOf(r.toActorId);
    const toName = r.toAlias?.name || r.toName;
    const facts = {
      toName, fromName: e.fromName, subject: e.subject, sentAt,
      readAt: r.readAt ? this._dlTime(r.readAt, sentRef) : '',
      toIsPlayer: p.isPlayer, playerName: p.names, playerOnline: p.online,
      read: !gone && !e.isPending && !r.unread && !r.isSent, deleted: !!r.isDeleted && !r.isSent,
      answered: !!answered[base], gone, held: e.held || null, nudged: this._dlNudged.has(`${r.messageId}|${r.toActorId}`),
      messageId: e.isPending ? base : r.messageId, inboxOwnerId: r.isSent ? '' : (r.inboxOwnerId || ''), toActorId: r.toActorId || '',
      reply: null, failure: null,
    };
    if (!gone && !e.isPending) {
      const reply = this._replyTo(base, r, everything);
      if (reply) facts.reply = { at: this._dlTime(new Date(reply.rawTimestamp).toISOString(), sentRef), snippet: this._plain(reply.bodyRaw || reply.bodyPreview || '', 90), owner: reply.inboxOwnerId, id: reply.messageId };
    }
    if (e.isPending && !e.held && fails[0]) {
      const f = fails[0];
      const d = this._retryTarget(f.retry);
      const sendOnly = this._isSendOnlyFailure(f, d.to);
      const c = this._failureContact(d);
      facts.failure = {
        id: f.id, why: f.why, source: f.source, sendOnly,
        unlocked: sendOnly && !!c && !c.sendOnly,
        contactId: c?.id || '', addr: d.to || c?.email || '',
        sender: game.actors?.get(d.fromActorId)?.name || f.fromName || 'the sender',
        senderActorId: d.fromActorId || '',
      };
    }
    return { ...deliveryLine(facts), id: e.messageId, open };
  }

  /** Nudge one recipient: a "new message" toast on their client now, or a whisper waiting for them in chat. */
  async _nudge(messageId, actorId, entry) {
    const p = this._playersOf(actorId);
    const actor = game.actors?.get(actorId);
    if (!actor || !p.isPlayer) return false;
    if (p.online) {
      // The same socket op a delivery uses; the recipient's NotificationService
      // shows the toast + sound (it dedups by messageId for ~4s only).
      (this.messageService?.socketManager || game.nightcity?.socketManager)?.emit?.(SOCKET_OPS.MESSAGE_NOTIFY, {
        messageId, toActorId: actorId,
        fromActorId: entry?.isAnon ? '' : (entry?.fromActorId || ''), fromContactId: entry?.isAnon ? '' : (entry?.fromContactId || ''),
        from: entry?.fromEmail || '', fromName: entry?.fromName || '', subject: entry?.subject || '',
        priority: entry?.priority || 'normal', preview: String(entry?.bodyPreview || '').slice(0, 100),
        anonymous: entry?.isAnon ? (entry.anonymous || null) : null,
      });
    } else if (p.userIds.length && typeof ChatMessage !== 'undefined') {
      // Offline: a whisper is waiting in their chat log when they log in.
      const content = `<div class="ncm-cc"><div class="ncm-cc__rec"><span class="ncm-cc__kind"><i class="fas fa-envelope"></i> Unread mail</span></div>`
        + `<div class="ncm-cc__line">${esc(actor.name)} has unread mail on their Agent: “${esc(entry?.subject || '(no subject)')}”${entry?.fromName ? ` from ${esc(entry.fromName)}` : ''}.</div></div>`;
      await ChatMessage.create({ content, whisper: p.userIds, speaker: { alias: 'Night City Messenger' } });
    } else return false;
    this._dlNudged.add(`${messageId}|${actorId}`);
    return true;
  }

  /** The feed entry for a message id (pages, pending rows, fan-out rows). */
  _dlEntry(id) {
    const res = this._gatherActivity();
    return res.everything.find(e => e.messageId === id) || res.filtered.find(e => e.messageId === id) || null;
  }

  async _onDlAct(op, d, target) {
    const ns = game.nightcity;
    switch (op) {
      case 'dlToggle': {
        // DOM-only — the open state lives in a Set so a re-render keeps it.
        const id = d.id;
        if (this._dlOpen.has(id)) this._dlOpen.delete(id); else this._dlOpen.add(id);
        const box = target?.closest?.('.ncm-msg2-dl');
        if (box) { box.classList.toggle('is-open', this._dlOpen.has(id)); target.setAttribute?.('aria-expanded', this._dlOpen.has(id) ? 'true' : 'false'); }
        else this.render(true);
        return;
      }
      case 'dlDeliver': {
        const r = await this.messageService?.forceDeliver?.(d.id);
        if (r?.success) ui.notifications.info('NCM | Delivered — you sent it on as GM.');
        else ui.notifications.warn(`NCM | Could not deliver it — ${r?.error || 'unknown error'}`);
        return this.render(true);
      }
      case 'dlNetworks': return ns?.openAdminTab?.('networks', { select: 'view:scene' });
      case 'dlContact': return ns?.openAdminTab?.('contacts', { select: d.contact });
      case 'dlUnlock': case 'dlRelock': {
        const r = await this.masterContactService?.updateContact?.(d.contact, { sendOnly: op === 'dlRelock' });
        if (r?.success === false) ui.notifications.warn(`NCM | Could not change it — ${r.error || 'unknown error'}`);
        else ui.notifications.info(op === 'dlUnlock' ? 'NCM | Players can write to it now.' : 'NCM | It is send-only again.');
        return this.render(true);
      }
      case 'dlAnswerAs': {
        const c = this.masterContactService?.getContact?.(d.contact);
        ns?.composeMessage?.({ fromContactId: d.contact, fromActorId: c?.actorId || undefined, toActorId: d.actor, subject: d.subject ? `RE: ${d.subject}` : '' });
        return;
      }
      case 'dlNudge': {
        const entry = this._dlEntry(this._sel) || {};
        const ok = await this._nudge(d.id, d.actor, entry);
        ui.notifications[ok ? 'info' : 'warn'](ok ? 'NCM | Nudged — they get a toast now, or a whisper waiting when they log in.' : 'NCM | Nobody to nudge — no player has that character.');
        return this.render(true);
      }
      case 'dlNudgeAll': {
        const entry = this._dlEntry(d.id);
        let n = 0;
        for (const c of entry?.recipients || []) {
          if (!c.unread || c.isDeleted || !c.toActorId || this._dlNudged.has(`${c.messageId}|${c.toActorId}`)) continue;
          if (await this._nudge(c.messageId, c.toActorId, entry)) n++;
        }
        ui.notifications.info(`NCM | Nudged ${n} ${n === 1 ? 'person' : 'people'}.`);
        return this.render(true);
      }
      case 'dlRemoveMember': {
        const gs = ns?.contactGroupService;
        const g = gs?.getMasterGroup?.(d.group);
        if (!g) return ui.notifications.warn('NCM | That group is gone.');
        await gs.saveMasterGroup({ ...g, members: (g.members || []).filter(m => m?.hint?.actorId !== d.actor) });
        ui.notifications.info(`NCM | Removed from ${g.name}.`);
        return this.render(true);
      }
    }
  }

  _mailDetail(e, failures = [], everything = []) {
    const isGroupRow = !!e.isGroupRow;
    const pending = !!e.isPending;
    const anonView = e.isAnon && !e.isSent;
    const from = anonView
      ? { name: e.fromName, img: '', initials: '?', addr: e.fromEmail, real: e.anonReal || 'unknown — its sent copy is gone' }
      : { ...this._face(e.fromName, { contactId: e.fromContactId, actorId: e.fromActorId, email: e.fromEmail }), addr: e.fromEmail };
    const to = isGroupRow ? { name: e.toName, group: true } : { ...this._face(e.toName, { contactId: e.toContactId, actorId: e.toActorId, email: e.toEmail }), addr: e.toEmail };
    const failedRows = failures.filter(f => f.baseId && f.baseId === baseIdOf(isGroupRow ? e.messageId.slice(7) : e.messageId));
    const firstCopy = isGroupRow ? e.recipients[0] : e;
    const owner = isGroupRow ? null : (e.ownerIsPlayer ? null : e.inboxOwnerId);
    // ONE "Reply as" and ONE "Inbox" button (dev 2026-10-28): the identities the NPC could answer as
    // (the one the mail reached first, then its other identities) and every copy's mailbox. A single
    // choice acts at once; several open the shared picker (_onActPick).
    const replyAs = [];
    if (owner && !e.isSent && !e.isDeleted) {
      const all = this.masterContactService?.getAll?.() ?? [];
      const reached = e.toContactId ? all.find(c => c.id === e.toContactId) : null;
      const ownerIsActor = !!game.actors?.get(owner);
      let group = [];
      try { group = reached ? identitiesOfContact(all, reached) : ownerIsActor ? identitiesOf(all, owner) : identitiesOfContact(all, all.find(c => c.id === owner) || { id: owner }); } catch { group = []; }
      const seen = new Set();
      const push = (label, contactId, actorId, sub) => { const k = contactId || `a:${actorId}`; if (seen.has(k)) return; seen.add(k); replyAs.push({ label, sub: sub || '', contactId: contactId || '', actorId: actorId || '', inboxOwner: owner, messageId: e.messageId }); };
      if (reached) push(reached.name, reached.id, reached.actorId, reached.email);
      else if (ownerIsActor && !group.length) push(e.toName, '', owner, e.toEmail);   // a character with no directory identity
      else if (!ownerIsActor && !group.length) push(e.toName, owner, '', e.toEmail);
      for (const c of group || []) if (c?.id) push(c.name, c.id, c.actorId, c.email);
    }
    const inboxes = [];
    if (!isGroupRow && !e.isSent && !pending) inboxes.push({ owner: e.inboxOwnerId, id: e.messageId, label: `${e.toAlias?.name || e.toName || 'the recipient'}’s inbox`, sub: 'the copy they received' });
    if (e.isSent || e.sentCopyId) inboxes.push({ owner: e.isSent ? e.inboxOwnerId : e.sentOwnerId, id: e.isSent ? e.messageId : e.sentCopyId, label: `${e.isAnon ? 'the real sender' : (e.fromAlias?.name || e.fromName || 'the sender')}’s sent copy`, sub: 'the copy they sent' });
    if (!inboxes.length && !isGroupRow && !pending && firstCopy?.inboxOwnerId) inboxes.push({ owner: firstCopy.inboxOwnerId, id: firstCopy.messageId, label: 'Open in inbox', sub: '' });
    this._acts = { messageId: e.messageId, replyAs, inboxes };
    return {
      replyAs, replyAsMany: replyAs.length > 1,
      replyAsTip: replyAs.length > 1 ? `Reply as ${replyAs.map(r => r.label).join(' / ')}` : (replyAs[0] ? `Reply as ${replyAs[0].label}` : ''),
      inboxes, inboxMany: inboxes.length > 1,
      inboxTip: inboxes.length > 1 ? `Open ${inboxes.map(i => i.label).join(' or ')}` : (inboxes[0] ? `Opens ${inboxes[0].label}${inboxes[0].sub ? ` (${inboxes[0].sub})` : ''}` : ''),
      messageId: e.messageId, isGroupRow, subject: e.subject,
      from, anonView, to, when: e.fullTimestamp,
      // The delivery line (built for this open message only).
      dl: this._journey(this._deliveryFor(e, everything, failures), e, from, to),
      net: [e.networkLabel, e.signalStrength != null ? `signal ${e.signalStrength}%` : ''].filter(Boolean).join(' · '),
      // The network as its own colour, the signal by band (the Networks tab's tiers).
      netName: e.networkLabel || '', netColor: e.networkColor || 'var(--ncm-text-label)',
      netSignal: e.signalStrength != null ? `signal ${e.signalStrength}%` : '',
      netTier: e.signalStrength == null ? '' : (e.signalStrength >= 80 ? 'good' : e.signalStrength >= 50 ? 'mid' : e.signalStrength >= 25 ? 'low' : 'dead'),
      // The alias it went out from is shown beside the From line, not again in the facts.
      fromAlias: e.fromAlias,
      flags: this._rowFlags(e).filter(f => f.icon !== FLAG_LOOK.alias[1]),
      via: e.sentVia ? { machine: e.sentVia.machine, typist: e.sentVia.typist, impersonated: e.sentVia.impersonated, asName: e.fromName, toName: e.toName } : null,
      bodyHtml: e.encrypted ? '<p><i>Encrypted — the recipient sees ciphertext until they decrypt it.</i></p>' + cleanHtml(e.bodyRaw || '', { mode: 'mail' }) : cleanHtml(e.bodyRaw || '', { mode: 'mail' }),
      attachments: e.attachments,
      recipients: isGroupRow ? e.recipients.map(r => ({
        ...r, ...this._face(r.toName, { contactId: r.toContactId, actorId: r.toActorId }),
        state: r.isDeleted ? 'deleted' : (r.unread ? 'unread' : 'read'), claimed: e.eddies > 0 && r.eddiesClaimed,
      })) : [],
      // The delivery line lists who it didn't reach; the old box stays for a lone page row.
      notDelivered: (isGroupRow || pending) ? [] : failedRows.map(f => ({ names: f.toName, why: f.why })),
      openOwner: pending ? '' : (firstCopy?.inboxOwnerId || ''), openId: pending ? '' : (firstCopy?.messageId || ''),
      // Two named doors so it is obvious which copy opens (dev: "I go into the sender's inbox and vice versa").
      openRecv: (!isGroupRow && !e.isSent && !pending) ? { owner: e.inboxOwnerId, id: e.messageId, name: e.toAlias?.name || e.toName || 'the recipient' } : null,
      openSent: (e.isSent || e.sentCopyId) ? { owner: e.isSent ? e.inboxOwnerId : e.sentOwnerId, id: e.isSent ? e.messageId : e.sentCopyId, name: e.isAnon ? 'the real sender' : (e.fromAlias?.name || e.fromName || 'the sender') } : null,
      // Reply as the NPC that received it (player → NPC mail).
      canReplyAs: !!owner && !e.isSent && !e.isDeleted,
      replyAsName: e.toAlias?.name || e.toName,
      canDelete: !isGroupRow && !pending,
      // Read / unread for the copy on screen (tester, 2026-10-29: "no way to mark the last one unread").
      readToggle: (!isGroupRow && !pending && !e.isSent && !e.isDeleted && e.inboxOwnerId) ? { owner: e.inboxOwnerId, id: e.messageId, unread: !!e.unread } : null,
      // Junk management: why this sender is junk, and the one switch the GM owns.
      junk: e.junk || null,
      junkAddr: (!anonView && !e.isSent && e.fromEmail) ? String(e.fromEmail).toLowerCase() : '',
      junkDomain: (!anonView && !e.isSent && e.fromEmail && !e.fromActorId && !e.fromContactId) ? domainOf(e.fromEmail) : '',
      canMarkJunk: !anonView && !e.isSent && !!e.fromEmail && !e.junk && !e.fromPlayer,
      junkMenu: (!anonView && !e.isSent && !!e.fromEmail && !e.junk && !e.fromPlayer) || e.junk?.reason === 'listed',   // the Junk ▾ button shows when it has something to offer
      inboxOwnerId: e.inboxOwnerId,
      sentCopyId: e.sentCopyId || '',
    };
  }

  /** The one Reply-as / Inbox button: act when there is one choice, pick when there are several. */
  async _onActPick(kind, messageId) {
    const acts = this._acts?.messageId === messageId ? this._acts : null;
    const list = acts?.[kind === 'reply' ? 'replyAs' : 'inboxes'] || [];
    if (!list.length) return;
    let pick = list[0];
    if (list.length > 1) {
      const res = await showNamePicker({
        title: kind === 'reply' ? 'Reply as' : 'Open which copy?',
        hint: kind === 'reply' ? 'The identity the answer goes out as.' : 'Each copy lives in its own mailbox.',
        entries: list.map((x, i) => ({ id: String(i), name: x.label, sub: x.sub || '', img: kind === 'reply' ? resolveDisplayPortrait({ contactId: x.contactId, actorId: x.actorId }, '') : '' })),
        placeholder: 'search…',
      });
      if (!res?.id) return;
      pick = list[Number(res.id)];
    }
    if (!pick) return;
    if (kind === 'reply') {
      const original = await this.messageService?.getMessage(pick.inboxOwner, pick.messageId);
      if (!original) return ui.notifications.warn('NCM | Message not found.');
      const opts = { mode: 'reply', originalMessage: original };
      if (pick.contactId) opts.fromContactId = pick.contactId;
      else if (pick.actorId) opts.fromActorId = pick.actorId;
      game.nightcity?.openComposer?.(opts);
    } else {
      this.onOpenInInbox(null, { dataset: { inboxOwner: pick.owner, messageId: pick.id }, closest: () => null });
    }
  }

  /** Reply as the inbox owner (the NPC who received it), in the composer. */
  async _onReplyAsMsg(target) {
    const ownerId = target.dataset.inboxOwner;
    const messageId = target.dataset.messageId;
    if (!ownerId || !messageId) return;
    const original = await this.messageService?.getMessage(ownerId, messageId);
    if (!original) return ui.notifications.warn('NCM | Message not found.');
    const opts = { mode: 'reply', originalMessage: original };
    if (original.toContactId) opts.fromContactId = original.toContactId;
    else if (game.actors?.get(ownerId)) opts.fromActorId = ownerId;
    else opts.fromContactId = ownerId;
    game.nightcity?.openComposer?.(opts);
  }

  _findPage(messageId) {
    for (const journal of game.journal ?? []) {
      if (!MessageRepository.identifyInbox(journal)) continue;
      const page = journal.pages?.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
      if (page) return page;
    }
    return null;
  }

  /** Copy a message onto a terminal account (the Agent viewer's GM door, here too). */
  async _onCopyToTerminal(messageId) {
    const page = this._findPage(messageId);
    const svc = game.nightcity?.terminalService;
    if (!page || !svc) return ui.notifications.warn('NCM | Message or terminals unavailable.');
    const msg = this.messageRepository?._pageToMessage?.(page) || { ...page.flags[MODULE_ID] };
    const targets = new Map();
    const entries = [];
    for (const item of svc.collectTerminals?.() || []) {
      const term = svc.getConfig(item).terminalName || item.name;
      for (const acct of svc.getConfig(item).accounts || []) {
        const id = `${item.uuid}|${acct.id}`;
        targets.set(id, { item, acct });
        entries.push({ id, name: acct.displayName || acct.username || acct.id, img: acct.portrait || item.img || 'icons/svg/terminal.svg', sub: `${term}${acct.username ? ` · ${acct.username}` : ''}`, group: term });
      }
    }
    if (!entries.length) return ui.notifications.warn('There are no terminal accounts to copy to.');
    const pick = await showNamePicker({
      title: 'Copy to Terminal',
      hint: `Copy "${msg.subject || '(no subject)'}" onto which account? Sent mail lands in the account's Sent folder; money is not copied.`,
      entries, placeholder: 'search accounts or terminals…',
    });
    const t = pick?.id ? targets.get(pick.id) : null;
    if (!t) return;
    const res = await svc.copyMessagesToAccount(t.item, t.acct.id, [msg]);
    if (!res.success) return ui.notifications.error(res.error || 'Copy failed.');
    const who = t.acct.displayName || t.acct.username;
    ui.notifications.info(res.copied ? `Copied to ${who}.` : `${who} already has this message.`);
  }

  // ═══════════════════════════════════════════════════════════
  //  OUTBOX
  // ═══════════════════════════════════════════════════════════

  /** Self-destructing mail still on someone's screen. */
  _gatherTimers(scan) {
    const out = [];
    const now = this._nowMs();
    for (const box of scan.inboxes) {
      for (const m of box.msgs) {
        if (m.isSent || m.deleted || !m.selfDestruct?.mode) continue;
        const after = m.selfDestruct.mode === 'after_read';
        const exp = m.selfDestruct.expiresAt ? new Date(m.selfDestruct.expiresAt).getTime() : 0;
        out.push({
          messageId: m.messageId, ownerId: box.ownerId, journalId: m.journalId, pageId: m.pageId,
          fromName: m.anonymous?.enabled ? '?' : this._senderLabel(m), toName: box.name, subject: m.subject,
          when: after ? 'on read' : (exp ? `in ${MessagesTab.countdown(exp - now).replace(/^00:/, '')}` : '—'),
          note: after ? `Erased when ${box.name} leaves it` : `Erased whether or not ${box.name} reads it`,
          sortAt: after ? Number.MAX_SAFE_INTEGER : exp,
        });
      }
    }
    return out.sort((a, b) => a.sortAt - b.sortAt);
  }

  _outboxContext({ failures, queue, scheduled, timers }) {
    const now = Date.now();
    return {
      failures: failures.map(f => ({
        ...f, whenLabel: f.gameAt ? formatCyberDate(f.gameAt, { timeOnly: true }) : '',
        ago: this.app._relativeTime(f.at, { real: true }), retried: f.retriedAt ? 'retried · still failing' : '',
        eddiesNote: f.hadEddies ? 'Retry sends it without the eddies (the sender was refunded).' : '',
      })),
      queue: queue.map(q => ({ ...q, from: q.from || 'Unknown', to: q.to || 'unknown recipient', subject: q.subject || '(no subject)', ago: q.queuedAt ? this._ageReal(now - new Date(q.queuedAt).getTime()) : '', who: q.remote ? `held by ${q.userName}` : 'held here' })),
      scheduled: scheduled.map(s => this.formatScheduledEntry(s)),
      timers,
      counts: { failures: failures.length, queue: queue.length, scheduled: scheduled.length, timers: timers.length },
      empty: !failures.length && !queue.length && !scheduled.length && !timers.length,
    };
  }

  _ageReal(ms) {
    const m = Math.floor(Math.max(0, ms) / 60000);
    return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
  }

  async _onSchedSendNow(scheduleId) {
    const svc = this.schedulingService;
    const entry = svc?.getScheduled?.(scheduleId);
    if (!entry) return ui.notifications.warn('NCM | Scheduled entry not found.');
    const r = await svc._deliverScheduled(entry);
    if (r?.success) { await svc._persistScheduled?.(); ui.notifications.info('NCM | Sent.'); }
    else ui.notifications.error('NCM | Could not send it now — see the console.');
    this.render(true);
  }

  async _onStopTimer(target) {
    const j = game.journal?.get(target.dataset.journalId);
    const page = j?.pages?.get(target.dataset.pageId);
    if (!page) return;
    await page.update({ [`flags.${MODULE_ID}.selfDestruct`]: null });
    ui.notifications.info('NCM | Self-destruct stopped. The message stays.');
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  INBOXES
  // ═══════════════════════════════════════════════════════════

  /**
   * Inboxes' live parts: the Show / Sort selects (a <select>'s data-action fires on click, so they listen for
   * change), "/" focuses the search, Esc closes the desk back to Needs a look. Removed in onClose.
   */
  _wireInboxes(ib) {
    ib.querySelectorAll('select[data-msg2-ibsel]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const v = sel.value;
        if (sel.dataset.msg2Ibsel === 'show' && INBOX_VIEWS.some(([k]) => k === v)) this._ibView = v;
        if (sel.dataset.msg2Ibsel === 'sort' && INBOX_SORTS.some(([k]) => k === v)) this._ibSort = v;
        if (sel.dataset.msg2Ibsel === 'group' && INBOX_GROUPS.some(([k]) => k === v)) { this._ibGroup = v; this._ibShut.clear(); this._ibOpen.clear(); }
        this.render(true);
      });
    });
    if (this._ibKeys) document.removeEventListener('keydown', this._ibKeys);
    this._ibKeys = (ev) => {
      const host = this.app.element;
      const live = host?.querySelector?.('[data-ib-root]');
      if (!live || !host.isConnected) return;
      const inField = ev.target.closest?.('input, textarea, select, [contenteditable="true"]');
      if (ev.key === '/' && !inField && (host.contains(document.activeElement) || document.activeElement === document.body)) {
        ev.preventDefault(); live.querySelector('[data-msg2-ibsearch]')?.focus(); return;
      }
      if (ev.key === 'Escape' && this._ibSel && !inField && host.contains(ev.target)) { ev.preventDefault(); this._ibSel = null; this.render(true); }
    };
    document.addEventListener('keydown', this._ibKeys);
  }

  /**
   * Inboxes = LIST + DESK (dev-picked 2026-10-29, `dev/mockups/admin-inboxes-rethink-mock.html` A; it replaced the
   * Mailroom wall the same day — "a bit messy to see and navigate"). One toolbar row (search · Show · Sort · ⋯),
   * the mailboxes as a grouped list on the left (face · name · the line the sort uses · unread / quiet / gone),
   * and on the right either NEEDS A LOOK (most unread, gone quiet, owner gone) or the picked mailbox: Open inbox
   * first, then Latest mail, Last 14 days, the networks it gets mail over, who it talks to, Housekeeping.
   * Rules: messagesModel (INBOX_VIEWS / INBOX_SORTS / sortInboxes / slotMetric / inboxTraffic / postmarkCode).
   */
  _inboxesContext(scan) {
    const all = this.masterContactService?.getAll?.() || [];
    const q = (this._ibSearch || '').toLowerCase();
    const now = this._nowMs();
    const DAY = 86400000;
    const netCache = new Map();
    const net = (id) => {
      if (!netCache.has(id)) {
        const n = id ? this.networkService?.getNetwork?.(id) : null;
        const name = n?.name || (id ? String(id).replace(/_/g, ' ') : 'unknown network');
        netCache.set(id, { id: id || '', name, code: postmarkCode(name), color: n?.theme?.color || '#8888a0' });
      }
      return netCache.get(id);
    };

    const rowFor = (box) => {
      const live = box.msgs.filter(m => !m.deleted).sort((a, b) => b._ts - a._ts);
      const got = live.filter(m => !m.isSent);
      const last = live[0]?._ts || 0;
      const unreadMsgs = got.filter(m => !m.read);
      let sub = '';
      let aliases = 0;
      if (box.isPlayer) {
        const email = box.actor?.getFlag?.(MODULE_ID, 'email') || '';
        const owner = getPlayerCharacters().find(p => p.actorId === box.ownerId)?.playerName || '';
        sub = [email || 'no address yet', owner].filter(Boolean).join(' · ');
      } else {
        const ids = box.isContact ? identitiesOfContact(all, box.contact) : identitiesOf(all, box.ownerId);
        aliases = Math.max(0, ids.length - 1);
        sub = box.contact?.email || box.actor?.getFlag?.(MODULE_ID, 'email') || ids[0]?.email || '';
      }
      return {
        ownerId: box.ownerId, journalId: box.journal.id, name: box.orphan ? box.journal.name : box.name, subText: box.orphan ? 'its owner was deleted' : sub,
        ...this._face(box.name, box.isContact ? { contactId: box.ownerId } : { actorId: box.ownerId }),
        total: live.length, unread: unreadMsgs.length, inN: got.length, sentN: live.length - got.length, aliases,
        lastTs: last, orphan: box.orphan, isPlayer: box.isPlayer, isContact: box.isContact,
        busy: live.filter(m => now - m._ts <= BUSY_DAYS * DAY).length,
        quietDays: last ? Math.floor((now - last) / DAY) : 0,
        oldestUnreadTs: unreadMsgs.length ? unreadMsgs[unreadMsgs.length - 1]._ts : 0,
        _live: live,
        ...this._ibRoleOrg(box, all),
      };
    };
    const hay = (r) => `${r.name} ${r.subText} ${r.roleLabel || ''} ${r.org || ''}`.toLowerCase();
    const allRows = scan.inboxes.map(rowFor);
    // Player characters with no inbox yet still get a row.
    for (const pc of getPlayerCharacters()) {
      if (scan.inboxes.some(b => b.ownerId === pc.actorId)) continue;
      allRows.push({ ownerId: pc.actorId, journalId: '', name: pc.actorName, subText: [pc.actor?.getFlag?.(MODULE_ID, 'email') || 'no address yet', pc.playerName].filter(Boolean).join(' · '),
        ...this._face(pc.actorName, { actorId: pc.actorId }), total: 0, unread: 0, inN: 0, sentN: 0, lastTs: 0, busy: 0, quietDays: 0, isPlayer: true, noInbox: true, _live: [] });
    }
    if (this._ibSel && !allRows.some(r => r.ownerId === this._ibSel)) this._ibSel = null;
    const isQuiet = (r) => !r.orphan && r.total > 0 && r.quietDays >= QUIET_DAYS;
    const rows = allRows.filter(r => !q || hay(r).includes(q));
    const counts = inboxViewCounts(rows);
    if (!counts[this._ibView] && this._ibView !== 'all') this._ibView = 'all';   // a filter that emptied lets go
    const shown = rows.filter(r => inboxPasses(this._ibView, r));
    const forced = !!q || this._ibView !== 'all';
    const age = (ts) => this._age(ts);

    const row = (r) => ({
      ownerId: r.ownerId, name: r.name, img: r.img, initials: r.initials, unread: r.unread, aliases: r.aliases || 0,
      orphan: !!r.orphan, noInbox: !!r.noInbox, quiet: isQuiet(r), sel: this._ibSel === r.ownerId,
      line: slotMetric(r, this._ibSort, age),
    });
    const groups = groupInboxes(shown, { by: this._ibGroup, sort: this._ibSort }).map(g => {
      const holds = g.rows.some(r => r.ownerId === this._ibSel);
      return { key: g.key, label: g.label, kind: g.kind, count: g.count, unread: g.unread, rows: g.rows.map(row),
        shut: foldShut(g.key, { defaultOpen: inboxGroupDefaultOpen(g.key), shut: this._ibShut, open: this._ibOpen, forced, holds }) };
    });

    const sel = allRows.find(r => r.ownerId === this._ibSel) || null;
    const lookRow = (r, note) => ({ ownerId: r.ownerId, name: r.name, img: r.img, initials: r.initials, orphan: !!r.orphan, unread: r.unread, note });
    const most = allRows.filter(r => r.unread).sort((a, b) => b.unread - a.unread || (a.oldestUnreadTs || 0) - (b.oldestUnreadTs || 0)).slice(0, 6);
    const quiet = allRows.filter(isQuiet).sort((a, b) => b.quietDays - a.quietDays).slice(0, 6);
    const gone = allRows.filter(r => r.orphan);
    const look = sel ? null : {
      unreadTotal: allRows.reduce((n, r) => n + r.unread, 0), unreadBoxes: allRows.filter(r => r.unread).length,
      quietN: allRows.filter(isQuiet).length, goneN: gone.length,
      most: most.map(r => lookRow(r, `waiting ${age(r.oldestUnreadTs)}`)),
      quiet: quiet.map(r => lookRow(r, `nothing for ${r.quietDays}d`)),
      gone: gone.map(r => lookRow(r, `${r.total} mail left behind`)),
    };

    return {
      search: this._ibSearch, groups, hasRows: groups.length > 0,
      shows: INBOX_VIEWS.map(([k, l]) => ({ key: k, label: l, count: counts[k] || 0, on: this._ibView === k })),
      sorts: INBOX_SORTS.map(([k, l, hint]) => ({ key: k, label: l, hint, on: this._ibSort === k })),
      groupBy: INBOX_GROUPS.map(([k, l]) => ({ key: k, label: l, on: this._ibGroup === k })),
      shown: shown.length, total: allRows.length, narrowed: shown.length !== allRows.length,
      look, detail: sel ? this._ibDetail(sel, net) : null,
    };
  }

  /** The desk for one mailbox: latest mail, 14-day traffic, the networks it gets mail over, who it talks to. */
  _ibDetail(r, net) {
    const live = r._live;
    const latest = live.slice(0, 6).map(m => {
      const who = m.isSent ? `to ${resolveDisplayName({ contactId: m.toContactId, actorId: m.toActorId, email: m.to }, m.to || 'someone')}` : this._senderLabel(m);
      const n = net(m.network || '');
      return { messageId: m.messageId, ownerId: m.ownerId, sent: m.isSent, unread: !m.isSent && !m.read, who, subject: m.subject || '(no subject)', age: this._age(m._ts),
        ...this._face(who, m.isSent ? {} : { contactId: m.fromContactId, actorId: m.fromActorId, email: m.from }), pm: { ...n, time: m.timestamp ? formatCyberDate(m.timestamp, { timeOnly: true }) : '' } };
    });
    const nets = new Map();
    for (const m of live) nets.set(m.network || '', (nets.get(m.network || '') || 0) + 1);
    const who = new Map();
    for (const m of live) {
      const key = m.isSent ? (m.toActorId || m.toContactId || m.to) : (m.fromActorId || m.fromContactId || m.from);
      if (!key) continue;
      const name = m.isSent ? resolveDisplayName({ contactId: m.toContactId, actorId: m.toActorId, email: m.to }, m.to || 'Unknown') : this._senderLabel(m);
      const w = who.get(key) || { n: 0, ...this._face(name, m.isSent ? { contactId: m.toContactId, actorId: m.toActorId, email: m.to } : { contactId: m.fromContactId, actorId: m.fromActorId, email: m.from }) };
      w.n++; who.set(key, w);
    }
    const days = inboxTraffic(live, this._nowMs());
    const max = Math.max(1, ...days.map(d => d.n));
    return {
      ownerId: r.ownerId, journalId: r.journalId, name: r.name, img: r.img, initials: r.initials, subText: r.subText,
      orphan: !!r.orphan, noInbox: !!r.noInbox, isPlayer: !!r.isPlayer, isContact: !!r.isContact, aliases: r.aliases || 0,
      quiet: !r.orphan && r.total > 0 && r.quietDays >= QUIET_DAYS ? r.quietDays : 0,
      total: r.total, inN: r.inN, sentN: r.sentN, unread: r.unread,
      latest, hasLatest: latest.length > 0,
      spark: days.map((d, i) => ({ h: d.n ? Math.max(10, Math.round(d.n / max * 100)) : 4, n: d.n, unread: d.unread, zero: !d.n, ago: BUSY_DAYS - 1 - i })),
      nets: [...nets].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ ...net(id), n })),
      who: [...who.values()].sort((a, b) => b.n - a.n).slice(0, 5),
      writeLabel: r.isPlayer ? 'Write to' : 'Write as',
    };
  }

  /** An NPC inbox's role + organization, from its contact (or the character's main identity). */
  _ibRoleOrg(box, all) {
    if (box.isPlayer) return { role: '', roleLabel: '', org: '' };
    const c = box.contact || (box.ownerId && identitiesOf(all, box.ownerId)[0]) || null;
    const role = String(c?.role || '').toLowerCase();
    const custom = (this.masterContactService?.getCustomRoles?.() || []).find(r => r.id === role);
    const roleLabel = role ? (BUILT_IN_ROLES[role]?.label || custom?.label || role.charAt(0).toUpperCase() + role.slice(1)) : '';
    return { role, roleLabel: roleLabel && !/s$/i.test(roleLabel) ? `${roleLabel}s` : roleLabel, org: c?.organization || '' };
  }

  async _ibMarkRead(journalIds) {
    let n = 0;
    for (const id of journalIds) {
      const journal = game.journal?.get(id);
      if (!journal) continue;
      const readAt = new Date().toISOString();
      const updates = journal.pages.contents.filter(p => { const f = p.flags?.[MODULE_ID]; return f?.messageId && !f.status?.read && !f.status?.sent && !f.status?.deleted; })
        .map(p => ({ _id: p.id, [`flags.${MODULE_ID}.status.read`]: true, [`flags.${MODULE_ID}.status.readAt`]: MessageRepository.readStamp(), [`flags.${MODULE_ID}.readAt`]: readAt }));
      if (updates.length) { await journal.updateEmbeddedDocuments('JournalEntryPage', updates); n += updates.length; }
    }
    return n;
  }

  _ibExport(journalIds, filename) {
    const out = [];
    for (const id of journalIds) {
      const journal = game.journal?.get(id);
      if (!journal) continue;
      const who = MessageRepository.identifyInbox(journal);
      const messages = journal.pages.contents.filter(p => p.flags?.[MODULE_ID]?.messageId)
        .map(p => this.messageRepository?._pageToMessage?.(p) || { ...p.flags[MODULE_ID] });
      out.push({ inbox: journal.name, ownerId: who?.ownerId || null, isContact: !!who?.isContact, messages });
    }
    const blob = new Blob([JSON.stringify({ ncmInboxExport: 1, exportedAt: new Date().toISOString(), inboxes: out }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return out.reduce((n, x) => n + x.messages.length, 0);
  }

  /** Ask how many days, then delete read, unsaved mail older than that (game time). */
  async _ibPurge(journalIds, label) {
    let days = null;
    await new Promise((resolve) => {
      adminDialog({
        title: 'Purge Old Mail',
        content: `<p>Delete <b>read</b> mail older than how many days from ${esc(label)}? Saved mail is kept.</p>
          <p><input type="number" min="1" step="1" value="30" data-msg2-days style="width:90px"> days (game time)</p>`,
        buttons: {
          purge: { icon: '<i class="fas fa-broom"></i>', label: 'Purge', callback: (html) => { days = Number((html[0] ?? html).querySelector('[data-msg2-days]')?.value) || null; } },
          cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
        },
        default: 'cancel',
        close: () => resolve(),
      }).render(true);
    });
    if (!days) return;
    const cutoff = this._nowMs() - days * 86400000;
    let n = 0;
    for (const id of journalIds) {
      const journal = game.journal?.get(id);
      if (!journal) continue;
      const ids = journal.pages.contents.filter(p => {
        const f = p.flags?.[MODULE_ID];
        return f?.messageId && purgeable({ status: f.status, timestamp: f.timestamp }, cutoff);
      }).map(p => p.id);
      if (ids.length) { await journal.deleteEmbeddedDocuments('JournalEntryPage', ids); n += ids.length; }
    }
    this.messageRepository?.clearCache?.();
    ui.notifications.info(`NCM | Purged ${n} old message${n !== 1 ? 's' : ''}.`);
    this.render(true);
  }

  _allInboxJournalIds() {
    return (game.journal?.contents || [...(game.journal ?? [])]).filter(j => MessageRepository.identifyInbox(j)).map(j => j.id);
  }

  async _onInboxMenu(target) {
    const journalId = target.dataset.journalId;
    const name = target.dataset.name || 'this inbox';
    if (!journalId) return;
    let choice = null;
    await new Promise((resolve) => {
      adminDialog({
        title: name,
        content: `<p>What should happen to <b>${esc(name)}</b>?</p>`,
        buttons: {
          read: { icon: '<i class="fas fa-envelope-open"></i>', label: 'Mark all read', callback: () => { choice = 'read'; } },
          exp: { icon: '<i class="fas fa-file-export"></i>', label: 'Export', callback: () => { choice = 'export'; } },
          purge: { icon: '<i class="fas fa-broom"></i>', label: 'Purge older than…', callback: () => { choice = 'purge'; } },
          del: { icon: '<i class="fas fa-trash"></i>', label: 'Delete inbox', callback: () => { choice = 'delete'; } },
        },
        default: 'read',
        close: () => resolve(),
      }).render(true);
    });
    if (choice === 'read') {
      const n = await this._ibMarkRead([journalId]);
      ui.notifications.info(`NCM | Marked ${n} message${n !== 1 ? 's' : ''} read.`);
      this.render(true);
    } else if (choice === 'export') {
      this._ibExport([journalId], `ncm-inbox-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`);
    } else if (choice === 'purge') {
      await this._ibPurge([journalId], name);
    } else if (choice === 'delete') {
      const ok = await adminConfirm({ title: 'Delete Inbox', content: `<p>Delete <b>${esc(name)}</b> and every message in it? This cannot be undone.</p>` });
      if (!ok) return;
      await game.journal?.get(journalId)?.delete();
      this.messageRepository?.clearCache?.();
      ui.notifications.info('NCM | Inbox deleted.');
      this.render(true);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  HEADER — Send as · Broadcast
  // ═══════════════════════════════════════════════════════════

  /** Every identity the GM can write as: NPC contacts (each alias its own row), NPC actors with an address, system addresses. */
  _sendAsItems() {
    const all = this.masterContactService?.getAll?.() || [];
    const sendOnly = (e) => { try { return !!this.masterContactService?.isSendOnly?.(e); } catch { return false; } };
    return this._gatherNPCActors({ all: true }).entries.map(n => {
      const c = n.contactId ? all.find(x => x.id === n.contactId) : null;
      const role = c ? identityRole(all, c) : null;
      const sys = !!c?.sendOnly || sendOnly(n.email);
      return {
        id: `${n.id}|${n.contactId || ''}`, name: n.name,
        group: sys ? 'System addresses' : 'NPCs & aliases',
        icon: role?.isAlias ? 'fa-masks-theater' : (sys ? 'fa-tower-broadcast' : 'fa-user-tie'),
        meta: role?.isAlias ? `alias of ${role.primary.name}` : (sys ? `system · ${n.email}` : (n.email || '')),
        img: n.portrait || undefined,
      };
    });
  }

  _sendAsPicker() {
    const id = this.scopeId('sendas');
    ScopePicker.on(id, (v) => {
      if (v?.length) {
        const [npcId, contactId] = v[0].split('|');
        ScopePicker.set(id, []);
        ScopePicker.close(id);
        MessagesTab.prototype.onNpcQuickSend.call(this, null, { closest: () => ({ dataset: { npcId, contactId } }) });
      }
      this.render(true);
    });
    return ScopePicker.html(id, { noun: 'identity', nouns: 'identities', icon: 'fa-paper-plane', label: 'Send as', allLabel: 'an NPC…', items: this._sendAsItems() });
  }

  _broadcastContext() {
    const toId = this.scopeId('bcto');
    const fromId = this.scopeId('bcfrom');
    ScopePicker.on(toId, () => this.render(true));
    ScopePicker.on(fromId, () => this.render(true));
    const pcs = getPlayerCharacters();
    const groups = game.nightcity?.contactGroupService?.getMasterGroups?.() || [];
    const toItems = [
      ...pcs.map(p => ({ id: `a:${p.actorId}`, name: p.actorName, group: 'Players’ characters', icon: 'fa-user', img: imgOk(p.actor?.img) || undefined, meta: p.playerName || '' })),
      ...groups.map(g => ({ id: `g:${g.id}`, name: g.name, group: 'Groups', icon: 'fa-users', img: g.img || undefined, color: g.color || undefined, meta: `${g.members.length} member${g.members.length !== 1 ? 's' : ''}` })),
    ];
    const n = this._bcRecipients().length;
    return {
      toPicker: ScopePicker.html(toId, { noun: 'recipient', nouns: 'recipients', icon: 'fa-users', label: 'To', multi: true, allLabel: 'Every player character', items: toItems, pinned: [{ id: 'online', name: 'Everyone online', icon: 'fa-signal', meta: 'players logged in right now' }] }),
      fromPicker: ScopePicker.html(fromId, { noun: 'sender', nouns: 'senders', icon: 'fa-tower-broadcast', label: 'From', allLabel: 'a name…', items: this._sendAsItems() }),
      fromPicked: ScopePicker.value(fromId).length > 0,
      ...this._bc,
      prios: ['normal', 'urgent', 'critical'].map(p => ({ key: p, label: p, on: this._bc.priority === p })),
      sendLabel: this._bc.later ? `Schedule for ${n}` : `Send to ${n}`,
    };
  }

  /** Who a broadcast goes to: the picks (characters, groups, everyone online), else every player character. Deduped. */
  _bcRecipients() {
    const picks = ScopePicker.value(this.scopeId('bcto'));
    const out = [];
    const seen = new Set();
    const push = (r) => { const k = r.actorId || r.contactId || String(r.email || '').toLowerCase(); if (!k || seen.has(k)) return; seen.add(k); out.push(r); };
    const pcs = getPlayerCharacters();
    if (!picks.length) pcs.forEach(p => push({ actorId: p.actorId, name: p.actorName }));
    for (const p of picks) {
      if (p === 'online') {
        for (const u of game.users ?? []) {
          if (u.isGM || !u.active) continue;
          const a = u.character || pcs.find(x => x.actor?.ownership?.[u.id] >= 3)?.actor;
          if (a) push({ actorId: a.id, name: a.name });
        }
      } else if (p.startsWith('a:')) {
        const a = game.actors?.get(p.slice(2));
        if (a) push({ actorId: a.id, name: a.name });
      } else if (p.startsWith('g:')) {
        const svc = game.nightcity?.contactGroupService;
        const g = (svc?.getMasterGroups?.() || []).find(x => x.id === p.slice(2));
        if (g) for (const r of svc.recipientsFor(g).recipients) push(r);
      }
    }
    return out;
  }

  async _onBroadcastSend() {
    const subject = (this._bc.subject || '').trim() || 'Broadcast';
    const body = (this._bc.body || '').trim();
    if (!body) return ui.notifications.warn('NCM | Write the broadcast first.');
    const recipients = this._bcRecipients();
    if (!recipients.length) return ui.notifications.warn('NCM | Nobody to send it to.');
    const data = { subject, body: body.replace(/\n/g, '<br>'), priority: this._bc.priority || 'normal', isBroadcast: true, recipients };
    const fromPick = ScopePicker.value(this.scopeId('bcfrom'))[0];
    if (fromPick) {
      const [npcId, contactId] = fromPick.split('|');
      if (contactId) data.fromContactId = contactId;
      const c = contactId ? this.masterContactService?.getContact?.(contactId) : null;
      if (c?.actorId) data.fromActorId = c.actorId;
      else if (!contactId && game.actors?.get(npcId)) data.fromActorId = npcId;
    } else {
      data.from = (this._bc.from || '').trim() || 'System';
    }
    if (this._bc.later) {
      const when = this._bc.when ? new Date(`${this._bc.when}:00Z`) : null;
      if (!when || isNaN(when.getTime())) return ui.notifications.warn('NCM | Pick when it should go out.');
      if (!data.fromActorId) return ui.notifications.warn('NCM | Send later needs an NPC with a character sheet as the sender — or send it now.');
      data.toActorId = recipients.find(r => r.actorId)?.actorId || null;
      if (!data.toActorId) return ui.notifications.warn('NCM | Send later needs at least one character among the recipients.');
      const r = await this.schedulingService?.scheduleMessage(data, when.toISOString(), { useGameTime: true });
      if (r?.success) { ui.notifications.info(`NCM | Broadcast scheduled for ${formatCyberDate(when.toISOString())}.`); this._bcReset(); }
      else ui.notifications.error(`NCM | Not scheduled — ${r?.error || 'unknown error'}`);
      this.render(true);
      return;
    }
    try {
      const result = await this.messageService?.sendMessage(data);
      const delivered = result?.delivered ?? (result?.success ? recipients.length : 0);
      const failed = result?.failed || [];
      if (delivered > 0) ui.notifications.info(`NCM | Broadcast delivered to ${delivered} of ${recipients.length}.`);
      if (failed.length) ui.notifications.warn(`NCM | Not delivered to ${failed.length} — listed in Outbox → Didn't arrive.`);
      else if (!result?.success) ui.notifications.warn(`NCM | Broadcast failed: ${result?.error || 'unknown error'}`);
      if (result?.success) this._bcReset();
    } catch (err) {
      ui.notifications.warn(`NCM | Broadcast failed: ${err?.message || 'unknown error'}`);
    }
    this.render(true);
  }

  _bcReset() {
    this._bc = { subject: '', body: '', from: '', priority: 'normal', later: false, when: '' };
    this._bcOpen = false;
    ScopePicker.set(this.scopeId('bcto'), []);
    ScopePicker.set(this.scopeId('bcfrom'), []);
  }

  // ═══════════════════════════════════════════════════════════
  //  onAct — every new button (data-action="tabAct" data-owner="messages")
  // ═══════════════════════════════════════════════════════════

  async onAct(op, event, target) {
    const d = target?.dataset || {};
    switch (op) {
      case 'view': this._view = d.view || 'reply'; this.app._saveScroll?.(); return this.render(true);
      // Needs a reply
      case 'rFilt': this._rFilt = ['all', 'waiting', 'answered'].includes(d.f) ? d.f : 'all'; return this.render(true);
      case 'includeGm': this._npcInboxIncludeGm = !this._npcInboxIncludeGm; return this.render(true);
      case 'convSel': if (this._convSel === d.key) return; this._convSel = d.key; this._deskSent = null; this.app._saveScroll?.(); return this.render(true);
      case 'deskIdent': { const pid = this.scopeId('rpas'); if (!d.id || ScopePicker.value(pid)[0] === d.id) return; ScopePicker.set(pid, [d.id]); return this.render(true); }
      case 'deskContact': {
        // The persona's pencil / Open: the contact in Admin → Contacts (an actor with no entry gets one made from it).
        const sel = d.contactId ? d.contactId : (d.actorId ? { create: 'actor', actorId: d.actorId } : null);
        if (sel) game.nightcity?.openAdminTab?.('contacts', { select: sel });
        return;
      }
      case 'replySend': return this._onReplySend();
      case 'replyComposer': return this._onReplyComposer();
      case 'replyAnon': this._replyAnon = !this._replyAnon; return this.render(true);
      case 'deskQuiet': this._deskQuiet = !this._deskQuiet; return this.render(true);
      case 'deskFoldQ': this._setDeskFold('q'); return this.render(true);
      case 'deskFoldP': this._setDeskFold('p'); return this.render(true);
      case 'markAnswered': return this._onMarkAnswered();
      case 'openConversation':
        this.openTo(`npc:${d.key}`);
        this.app._activeTab = 'messages';
        return this.render(true);
      // All mail
      case 'mailSel': this._sel = d.id; return this.render(true);
      case 'box': this._box = d.box || 'all'; this._limit = 40; return this.render(true);
      case 'ibView': if (INBOX_VIEWS.some(([k]) => k === d.view)) this._ibView = d.view; return this.render(true);
      case 'ibGroup': if (INBOX_GROUPS.some(([k]) => k === d.group)) { this._ibGroup = d.group; this._ibShut.clear(); this._ibOpen.clear(); } return this.render(true);
      case 'ibSort': if (INBOX_SORTS.some(([k]) => k === d.sort)) this._ibSort = d.sort; return this.render(true);
      case 'ibFoldAll': {
        const heads = [...(target.closest('.ncm-admin-panel')?.querySelectorAll('[data-msg2-ibfold]') || [])];
        const anyOpen = heads.some(el => !el.closest('[data-ib-group]')?.classList.contains('is-shut'));
        heads.forEach(el => recordFold(el.dataset.msg2Ibfold, anyOpen, this._ibShut, this._ibOpen));
        return this.render(true);
      }
      case 'jrFold': {
        this._jrShut = !this._jrShut;
        const box = target?.closest?.('.ncm-msg2-jr');
        if (box) { box.classList.toggle('is-shut', this._jrShut); target.setAttribute?.('aria-expanded', this._jrShut ? 'false' : 'true'); }
        else this.render(true);
        return;
      }
      case 'jrFilter': {
        const box = target?.closest?.('.ncm-msg2-jr');
        this._jrFilter.set(d.id, d.f);
        if (!box) return this.render(true);
        box.dataset.jrF = d.f;
        box.querySelectorAll('[data-op="jrFilter"]').forEach(el => el.classList.toggle('is-on', el.dataset.f === d.f));
        return;
      }
      case 'mailOrder': this._oldest = !this._oldest; this._limit = 40; this._calLimit = 50; return this.render(true);
      // The calendar navigator
      case 'calLevel': case 'calMonth': case 'calWeek': case 'calDay': case 'calStep': case 'calUp': case 'calJump': case 'calMore':
        this._onCalAct(op, d); this.app._saveScroll?.(); return this.render(true);
      case 'flag': if (this._af.has(d.flag)) this._af.delete(d.flag); else this._af.add(d.flag); this._limit = 40; this._calLimit = 50; this._calAuto = true; return this.render(true);
      case 'clearFlags': this._af.clear(); this._box = 'all'; this._dateFrom = ''; this._dateTo = ''; this._calAuto = true; return this.render(true);
      case 'unfilter': {
        const k = d.k || '';
        if (k === 'dates') { this._dateFrom = ''; this._dateTo = ''; }
        else if (k.startsWith('box:')) this._box = 'all'; else this._af.delete(k);
        this._limit = 40; this._calLimit = 50; this._calAuto = true; return this.render(true);
      }
      case 'replyAs': return this._onReplyAsMsg(target);
      case 'actReply': return this._onActPick('reply', d.messageId);
      case 'actInbox': return this._onActPick('inbox', d.messageId);
      // The delivery line (reading pane)
      case 'dlToggle': case 'dlDeliver': case 'dlNetworks': case 'dlContact': case 'dlUnlock': case 'dlRelock':
      case 'dlAnswerAs': case 'dlNudge': case 'dlNudgeAll': case 'dlRemoveMember':
        return this._onDlAct(op, d, target);
      case 'copyToTerminal': return this._onCopyToTerminal(d.messageId);
      case 'junkOn': case 'junkOff': {
        const svc = game.nightcity?.spamService;
        await svc?.setJunkSender?.(d.entry, op === 'junkOn');
        ui.notifications.info(op === 'junkOn'
          ? `${d.entry} is junk now — its mail is hidden here and new mail from it goes to Spam.`
          : `${d.entry} is no longer marked as junk.`);
        return this.render(true);
      }
      // Outbox
      case 'failRetry': {
        const r = await this.messageService?.retryDeliveryFailure?.(d.id);
        if (r?.success && !r.failed?.length) ui.notifications.info('NCM | Delivered.');
        else ui.notifications.warn(`NCM | Still not delivered — ${r?.error || r?.failed?.map(x => `${x.name}: ${x.error}`).join(' · ') || 'unknown error'}`);
        return this.render(true);
      }
      case 'failDismiss': await this.messageService?.dismissDeliveryFailure?.(d.id); return this.render(true);
      case 'failDismissAll': {
        const ok = await adminConfirm({ title: 'Clear the list', content: '<p>Remove every entry from Didn’t arrive? Nothing is re-sent.</p>' });
        if (ok) await this.messageService?.dismissDeliveryFailure?.(null);
        return this.render(true);
      }
      case 'schedSendNow': return this._onSchedSendNow(d.scheduleId);
      case 'stopTimer': return this._onStopTimer(target);
      // Inboxes
      case 'ibMenu': return this._onInboxMenu(target);
      case 'ibSel': this._ibSel = this._ibSel === d.ownerId ? null : (d.ownerId || null); this.app._saveScroll?.(); return this.render(true);
      case 'ibClose': this._ibSel = null; return this.render(true);
      case 'mailReadToggle': return this._setRead(d.ownerId, d.messageId, d.unread === '1');
      case 'ibDelete': {
        const name = d.name || 'this inbox';
        const ok = await adminConfirm({ title: 'Delete Inbox', content: `<p>Delete <b>${esc(name)}</b> and every message in it? This cannot be undone.</p>` });
        if (!ok) return;
        await game.journal?.get(d.journalId)?.delete();
        this.messageRepository?.clearCache?.();
        this._ibSel = null;
        ui.notifications.info('NCM | Inbox deleted.');
        return this.render(true);
      }
      case 'ibWrite': {
        const opts = d.player === '1' ? { toActorId: d.ownerId } : (d.contact === '1' ? { fromContactId: d.ownerId } : { fromActorId: d.ownerId });
        return game.nightcity?.openComposer?.(opts);
      }
      case 'ibRead': {
        const n = await this._ibMarkRead([d.journalId]);
        ui.notifications.info(`NCM | Marked ${n} message${n !== 1 ? 's' : ''} read.`);
        return this.render(true);
      }
      case 'ibExport': return this._ibExport([d.journalId], `ncm-inbox-${String(d.name || 'inbox').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`);
      case 'ibPurge': return this._ibPurge([d.journalId], d.name || 'this inbox');
      case 'ibMarkAllRead': {
        const n = await this._ibMarkRead(this._allInboxJournalIds());
        ui.notifications.info(`NCM | Marked ${n} message${n !== 1 ? 's' : ''} read.`);
        return this.render(true);
      }
      case 'ibPurgeAll': return this._ibPurge(this._allInboxJournalIds(), 'every inbox');
      // Header
      case 'bcToggle': this._bcOpen = !this._bcOpen; return this.render(true);
      case 'bcPrio': this._bc.priority = d.p || 'normal'; return this.render(true);
      case 'bcLater': this._bc.later = !this._bc.later; if (this._bc.later && !this._bc.when) this._bc.when = new Date(this._nowMs() + 3600000).toISOString().slice(0, 16); return this.render(true);
      case 'bcSend': return this._onBroadcastSend();
      default: log.warn(`MessagesTab: unknown op ${op}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Legacy gatherers + action handlers (still registered; several are
  //  reused by the new template, others by macros/older callers)
  // ═══════════════════════════════════════════════════════════

  _gatherNPCActors({ all: everything = false } = {}) {
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
      ripperdoc: '#e06888', gang: '#cc4444', government: '#5a7fa5', ai: '#ff44cc',
    };

    const all = [];
    const seenIds = new Set();

    // ── Pass 1: Master contacts (non-player) ──
    const contacts = this.masterContactService?.getAll() ?? [];
    for (const c of contacts) {
      if (!c.email) continue;
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        if (actor?.hasPlayerOwner) continue;
      }
      // One chip per CONTACT: an NPC with an alias gets a chip for each
      // identity (it used to show only whichever came first in the directory).
      const primaryId = c.actorId || c.id;
      if (seenIds.has(c.id)) continue;
      if (c.actorId) seenIds.add(c.actorId);
      seenIds.add(c.id);
      const isAlias = !!this.masterContactService?.identityRoleOf?.(c)?.isAlias;
      const roleLower = (c.role || '').toLowerCase();
      all.push({
        id: primaryId,
        contactId: c.id,
        name: c.name,
        email: c.email,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        // Own portrait, else the character's for the MAIN identity; an alias never
        // borrows its character's face.
        portrait: resolveDisplayPortrait({ contactId: c.id }) || null,
        role: isAlias ? 'alias' : (c.role || ''),
        isContact: true,
      });
    }

    // ── Pass 2: NPC actors with emails NOT already in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner || !isPersonActor(actor)) continue;
      if (seenIds.has(actor.id)) continue;
      const email = actor.getFlag(MODULE_ID, 'email');
      if (!email) continue;
      seenIds.add(actor.id);
      all.push({
        id: actor.id, contactId: null, name: actor.name, email,
        initial: (actor.name || '?').charAt(0).toUpperCase(), color: '#F65261',
        portrait: actor.img && !actor.img.includes('mystery-man') ? actor.img : null,
        role: '', isContact: false,
      });
    }

    all.sort((a, b) => a.name.localeCompare(b.name));
    if (everything) return { entries: all, totalCount: all.length };

    let filtered = all;
    if (this._npcSearch) {
      const q = this._npcSearch.toLowerCase();
      filtered = filtered.filter(n => n.name.toLowerCase().includes(q) || n.email.toLowerCase().includes(q) || n.role.toLowerCase().includes(q));
    }
    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / this._npcPerPage));
    if (this._npcPage >= totalPages) this._npcPage = totalPages - 1;
    if (this._npcPage < 0) this._npcPage = 0;
    const startIdx = this._npcPage * this._npcPerPage;
    return {
      entries: filtered.slice(startIdx, startIdx + this._npcPerPage),
      totalCount, page: this._npcPage, totalPages,
      hasPrev: this._npcPage > 0, hasNext: this._npcPage < totalPages - 1, search: this._npcSearch,
    };
  }

  /**
   * SEND AS A TERMINAL ACCOUNT — base message id → { machine, typist, impersonated }
   * from every sent copy that carries `sentVia` (stored on the sender's copy only).
   */
  _sentViaIndex() {
    const out = new Map();
    for (const journal of game.journal ?? []) {
      if (!MessageRepository.identifyInbox(journal)) continue;
      for (const page of journal.pages ?? []) {
        const f = page.flags?.['night-city-messenger'];
        const id = f?.messageId || '';
        if (!f?.sentVia || !id.endsWith('-sent')) continue;
        out.set(id.slice(0, -5), { machine: f.sentVia.machine || 'a terminal', typist: f.sentVia.operatorName || 'someone', impersonated: f.sentVia.impersonated !== false });
      }
    }
    return out;
  }

  /**
   * IDENTITIES: { name, of } when this contact is an ALIAS of a character
   * (another contact linked to the same character is its main identity), else null.
   */
  _aliasNote(contactId) {
    if (!contactId) return null;
    const all = this.masterContactService?.getAll?.() ?? [];
    const c = all.find(x => x.id === contactId);
    const role = identityRole(all, c);
    return role?.isAlias ? { name: c.name, of: role.primary.name } : null;
  }

  /**
   * The old NPC Inbox triage, kept as a data source for scripts. Needs a reply
   * (_buildConversations) is what the tab renders now. Impersonations (a player
   * writing AS someone from a terminal) count as player mail.
   */
  _gatherNpcInbox() {
    const groups = new Map();
    const viaByBase = this._sentViaIndex();
    for (const journal of game.journal ?? []) {
      const inbox = MessageRepository.identifyInbox(journal);
      if (!inbox) continue;
      const ownerActor = inbox.isContact ? null : game.actors?.get(inbox.ownerId);
      if (ownerActor?.hasPlayerOwner) continue;
      const contact = inbox.isContact ? this.masterContactService?.getContact(inbox.ownerId) : null;
      if (contact?.actorId && game.actors?.get(contact.actorId)?.hasPlayerOwner) continue;
      for (const page of journal.pages ?? []) {
        const flags = page.flags?.['night-city-messenger'];
        if (!flags) continue;
        const msgId = flags.messageId || page.id;
        if (msgId.endsWith('-sent') || flags.status?.deleted) continue;
        const fromActor = flags.fromActorId ? game.actors?.get(flags.fromActorId) : null;
        const via = viaByBase.get(msgId) || null;
        const fromPlayer = !!fromActor?.hasPlayerOwner || !!via?.impersonated;
        if (!fromPlayer && !this._npcInboxIncludeGm) continue;
        let g = groups.get(inbox.ownerId);
        if (!g) { g = { npcId: inbox.ownerId, npcName: ownerActor?.name || contact?.name || 'NPC', unreadCount: 0, totalCount: 0, messages: [] }; groups.set(inbox.ownerId, g); }
        g.totalCount++;
        if (!flags.status?.read) g.unreadCount++;
        g.messages.push({
          messageId: msgId, inboxOwnerId: inbox.ownerId, senderName: fromActor?.name || flags.from || 'Unknown',
          sentVia: via, senderAlias: this._aliasNote(flags.fromContactId), toAlias: this._aliasNote(flags.toContactId),
          subject: flags.subject || page.name || '(no subject)', unread: !flags.status?.read,
        });
      }
    }
    const list = [...groups.values()];
    return { npcInboxGroups: list, npcInboxNpcCount: list.length, npcInboxTotalUnread: list.reduce((n, g) => n + g.unreadCount, 0) };
  }

  async onQuickSend(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
    log.info(`Admin: Quick-send as ${actor.name}`);
  }

  onNpcQuickSend(event, target) {
    const el = target.closest('[data-npc-id]');
    const npcId = el?.dataset.npcId;
    const contactId = el?.dataset.contactId;
    if (!npcId) return;

    // A row that names a directory contact of this character sends AS that
    // contact (identity name + address), not as the bare actor.
    const rowContact = contactId ? game.nightcity?.masterContactService?.getContact(contactId) : null;
    if (rowContact?.actorId && rowContact.actorId === npcId) {
      game.nightcity?.composeMessage?.({ fromContactId: rowContact.id });
      return;
    }

    // Try as actor first
    const actor = game.actors?.get(npcId);
    if (actor) {
      game.nightcity?.openComposer?.({ fromActorId: npcId, fromName: actor.name });
      log.info(`Admin: Quick-send as actor ${actor.name}`);
      return;
    }

    // Try as contact
    const contact = contactId
      ? game.nightcity?.masterContactService?.getContact(contactId)
      : game.nightcity?.masterContactService?.getContact(npcId);
    if (contact) {
      if (contact.actorId) {
        game.nightcity?.composeMessage?.({ fromContactId: contact.id });
      } else {
        game.nightcity?.openComposer?.({
          fromContact: { id: contact.id, name: contact.name, email: contact.email, portrait: contact.portrait || null },
        });
      }
      log.info(`Admin: Quick-send as contact ${contact.name}`);
    }
  }

  onNpcPagePrev() { if (this._npcPage > 0) this._npcPage--; this.render(true); }
  onNpcPageNext() { this._npcPage++; this.render(true); }

  /** Legacy NPC Inbox actions → Needs a reply. */
  onToggleNpcInbox(event, target) {
    const npcId = target.closest('[data-npc-id]')?.dataset.npcId;
    if (!npcId) return;
    this.openTo(`npc:${npcId}|`);
    this.render(true);
  }

  onNpcInboxFilter(event, target) {
    const mode = target.dataset.mode || target.closest('[data-mode]')?.dataset.mode || 'unread';
    if (mode === 'gm') this._npcInboxIncludeGm = !this._npcInboxIncludeGm;
    else this._rFilt = mode === 'unread' ? 'waiting' : 'all';
    this._view = 'reply';
    this.render(true);
  }

  /** Reply to a player as the NPC whose inbox the message landed in (composer). */
  async onNpcInboxReply(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const ownerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!ownerId || !messageId) return;
    return this._onReplyAsMsg({ dataset: { inboxOwner: ownerId, messageId } });
  }

  /** The searchable "open any inbox" dialog (kept: Overview + older callers). */
  onOpenViewInboxDialog(event, target) {
    const entries = [];
    for (const journal of game.journal ?? []) {
      const inbox = MessageRepository.identifyInbox(journal);
      if (!inbox) continue;
      const contact = inbox.isContact ? this.masterContactService?.getContact(inbox.ownerId) : null;
      const actor = inbox.isContact ? null : game.actors?.get(inbox.ownerId);
      let total = 0, unread = 0;
      for (const page of journal.pages ?? []) {
        const f = page.flags?.[MODULE_ID];
        if (!f?.messageId) continue;
        total++;
        if (!f.status?.read && !String(f.messageId).endsWith('-sent') && !f.status?.deleted) unread++;
      }
      const name = actor?.name || contact?.name || journal.name;
      entries.push({ id: inbox.ownerId, name, img: imgOk(actor?.img || contact?.portrait) || 'icons/svg/mystery-man.svg', sub: `${total} message${total !== 1 ? 's' : ''}${unread ? ` · ${unread} unread` : ''}`, group: actor?.hasPlayerOwner ? 'Players’ characters' : 'NPCs & contacts' });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    showNamePicker({ title: 'View Inbox', hint: 'Open any mailbox.', entries, placeholder: 'search inboxes…' }).then((pick) => {
      if (!pick?.id) return;
      if (!this._warnIfOrphanInbox(pick.id)) return;
      game.nightcity?.openInbox?.(pick.id);
    });
  }

  onOpenComposer(event, target) {
    game.nightcity?.openComposer?.();
  }

  async onCancelScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;
    const confirmed = await adminConfirm({ title: 'Cancel Scheduled Message', content: '<p>Cancel this scheduled message? It will not be delivered.</p>' });
    if (!confirmed) return;
    const result = await this.schedulingService?.cancelScheduled(scheduleId);
    if (result?.success) { ui.notifications.info('Scheduled message cancelled.'); this.render(true); }
    else ui.notifications.error(result?.error || 'Failed to cancel.');
  }

  async onEditScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;
    const entry = this.schedulingService?.getScheduled?.(scheduleId);
    if (!entry) { ui.notifications.warn('NCM | Scheduled entry not found.'); return; }

    const data = entry.messageData || {};
    const cur = entry.deliveryTime ? new Date(entry.deliveryTime) : new Date();
    const dateVal = cur.toISOString().slice(0, 10);
    const timeVal = cur.toISOString().slice(11, 16);
    const content = `
      <div class="ncm-msg2-dlg">
        <div class="ncm-msg2-dlg__box">
          <div class="ncm-msg2-dlg__k">Message</div>
          <div><b>${esc(data.fromName || data.from || 'Unknown')}</b> → <b>${esc(data.toName || data.to || 'Unknown')}</b></div>
          <div class="ncm-msg2-dlg__s">“${esc(data.subject || '(no subject)')}”</div>
        </div>
        <div class="ncm-msg2-dlg__box">
          <div class="ncm-msg2-dlg__k">Deliver at (game time)</div>
          <div class="ncm-msg2-dlg__row">
            <input type="date" id="ncm-sched-edit-date" value="${dateVal}">
            <input type="time" id="ncm-sched-edit-time" value="${timeVal}">
          </div>
        </div>
      </div>`;

    adminDialog({
      title: 'Edit Scheduled Message',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Reschedule',
          callback: async (html) => {
            const date = html.find('#ncm-sched-edit-date').val();
            const time = html.find('#ncm-sched-edit-time').val();
            if (!date || !time) return;
            const newDelivery = new Date(`${date}T${time}:00Z`).toISOString();
            await this.schedulingService?.editScheduled(scheduleId, { deliveryTime: newDelivery });
            ui.notifications.info('NCM | Scheduled message rescheduled.');
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Close' },
      },
      default: 'save',
    }, { width: 400, height: 'auto', classes: ['ncm-time-config-dialog'] }).render(true);
  }

  onFilter(event, target) {
    const filter = target.dataset.filter || target.closest('[data-filter]')?.dataset.filter || 'all';
    if (filter === 'unread') { this._af.add('unread'); this._filter = 'all'; }
    else this._filter = filter;
    this._view = 'all';
    this._limit = 40;
    this.render(true);
  }

  onLoadMore() {
    this._limit += 40;
    this.render(true);
  }

  onOpenDateRangePicker(event, target) {
    if (event?.target?.closest?.('[data-action="clearFeedDates"]')) return;
    DateRangePicker.open({
      from: this._dateFrom,
      to: this._dateTo,
      title: 'Filter Messages by Date',
      onApply: (from, to) => { this._dateFrom = from; this._dateTo = to; this._limit = 40; this.render(true); },
      onClear: () => { this._dateFrom = ''; this._dateTo = ''; this._limit = 40; this.render(true); },
    });
  }

  onClearFeedDates(event, target) {
    event?.stopPropagation?.();
    this._dateFrom = '';
    this._dateTo = '';
    this._limit = 40;
    this.render(true);
  }

  onToggleExpand(event, target) {
    const msgId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!msgId) return;
    this._sel = msgId;
    this._expandedId = (this._expandedId === msgId) ? null : msgId;
    this.render(true);
  }

  /** Legacy actor-filter dropdown → the Who picker now; opening it opens the picker. */
  onToggleActorFilter() {
    this._view = 'all';
    ScopePicker.open(this.scopeId('who'));
    this.render(true);
  }

  onSetActorFilter(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this._actorFilter = target.closest('[data-actor-id]')?.dataset.actorId ?? '';
    this._view = 'all';
    this._limit = 40;
    this.render(true);
  }

  onOpenInInbox(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner || target.dataset.inboxOwner;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || target.dataset.messageId;
    if (!inboxOwnerId) return;
    if (!this._warnIfOrphanInbox(inboxOwnerId)) return;
    game.nightcity?.openInbox?.(inboxOwnerId, messageId || undefined);
  }

  /**
   * An inbox journal whose owner (actor or master contact) no longer exists
   * can't be opened — `openInbox` needs the owner to resolve the viewer, and
   * the only feedback used to be a generic "Actor or contact not found". Say
   * what happened and where the cleanup lives.
   * @param {string} ownerId
   * @returns {boolean} true when the owner exists
   */
  _warnIfOrphanInbox(ownerId) {
    if (game.actors?.get(ownerId)) return true;
    if (this.masterContactService?.getContact(ownerId)) return true;
    ui.notifications.warn(
      'NCM | This inbox belongs to an actor or contact that no longer exists. '
      + 'Tools → Orphan Audit lists it and can remove it.'
    );
    return false;
  }

  /** Legacy "reply as" — now opens the composer in reply mode as the recipient. */
  onReplyAs(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const inboxOwner = target.closest('[data-inbox-owner]')?.dataset.inboxOwner || target.dataset.inboxOwner;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || target.dataset.messageId;
    if (inboxOwner && messageId) return this._onReplyAsMsg({ dataset: { inboxOwner, messageId } });
    const actor = inboxOwner ? game.actors?.get(inboxOwner) : null;
    game.nightcity?.openComposer?.(actor ? { fromActorId: actor.id, fromName: actor.name } : undefined);
  }

  async onShareToChat(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || target.dataset.messageId;
    if (!messageId) return;

    // Find the journal page for this message
    let foundPage = null;
    for (const journal of game.journal ?? []) {
      if (!MessageRepository.identifyInbox(journal)) continue;
      for (const page of journal.pages ?? []) {
        const flags = page.flags?.['night-city-messenger'];
        if (flags?.messageId === messageId) { foundPage = { page, flags }; break; }
      }
      if (foundPage) break;
    }
    if (!foundPage) { ui.notifications.warn('NCM | Message not found.'); return; }

    // The same card the player's inbox posts, labelled "via GM" — it used to post
    // a private-looking "GM Intercept" card to a PUBLIC chat message, truncated at
    // 200 characters with the HTML escaped into visible tags.
    const message = this.messageRepository?._pageToMessage?.(foundPage.page) || { ...foundPage.flags };
    await this.messageService?.shareToChat?.(message, null, { sharedBy: 'GM' });
    ui.notifications.info('NCM | Message shared to chat.');
  }

  async onForceDeliver(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || target.dataset.messageId;
    if (!messageId) return;
    const result = await this.messageService?.forceDeliver?.(messageId);
    if (result?.success) ui.notifications.info('NCM | Message delivered.');
    else ui.notifications.warn(`NCM | Could not deliver it — ${result?.error || 'unknown error'}`);
    this.render(true);
  }

  async onCancelQueued(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId || target.dataset.messageId;
    if (!messageId) return;
    const held = (this.messageService?.getQueue?.() || []).find(q => q.messageId === messageId);
    const ok = await adminConfirm({ title: 'Cancel Held Message', content: `<p>Cancel this message? It will never be delivered.${held?.eddies ? ` <b>The ${held.eddies} eb it carries are not refunded.</b>` : ''}</p>` });
    if (!ok) return;
    const result = await this.messageService?.cancelQueued?.(messageId);
    if (result?.success) ui.notifications.info('NCM | Held message cancelled.');
    else ui.notifications.warn(`NCM | Cancel failed — ${result?.error || 'unknown error'}`);
    this.render(true);
  }

  async onFlushQueue(event, target) {
    event?.preventDefault?.();
    const queue = this.messageService?.getQueue?.() ?? [];
    if (!queue.length) { ui.notifications.info('NCM | Nothing is waiting.'); return; }
    const confirmed = await adminConfirm({
      title: 'Deliver All',
      content: `<p>Deliver <strong>${queue.length}</strong> held message${queue.length > 1 ? 's' : ''} now? This skips the dead zone / offline wait.</p>`,
    });
    if (!confirmed) return;
    let delivered = 0;
    for (const entry of queue) {
      const result = await this.messageService?.forceDeliver?.(entry.messageId || entry.id);
      if (result?.success) delivered++;
    }
    ui.notifications.info(`NCM | Delivered ${delivered} message${delivered !== 1 ? 's' : ''}.`);
    this.render(true);
  }

  async onMarkAllRead(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    const journalIds = (game.journal?.contents || []).filter(j => MessageRepository.identifyInbox(j)?.ownerId === actorId).map(j => j.id);
    const n = await this._ibMarkRead(journalIds);
    ui.notifications.info(n ? `NCM | Marked ${n} message${n !== 1 ? 's' : ''} as read.` : 'NCM | No unread messages.');
    this.render(true);
  }

  async onPurgeOld(event, target) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    const journalIds = (game.journal?.contents || []).filter(j => MessageRepository.identifyInbox(j)?.ownerId === actorId).map(j => j.id);
    return this._ibPurge(journalIds, game.actors?.get(actorId)?.name || 'this inbox');
  }

  /** The old Mass Broadcast dialog (msgBroadcast action) — the inline Broadcast panel is the tab's door now. */
  async onBroadcast(event, target) {
    const playerActors = getPlayerCharacters().map(pa => ({ id: pa.actorId, name: pa.actorName }));
    if (!playerActors.length) {
      ui.notifications.warn('NCM | No player-owned characters found.');
      return;
    }
    // Targets: every player character, or one of the GM's contact groups. Both
    // go through the service's fan-out (one call, per-recipient results), not a
    // hand-rolled loop — so a refused recipient is NAMED, not just counted.
    const groupSvc = game.nightcity?.contactGroupService;
    const groups = groupSvc?.getMasterGroups?.() || [];
    const targetOptions = [
      `<option value="__all__">All player characters (${playerActors.length})</option>`,
      ...groups.map(g => `<option value="${g.id}">${esc(g.name)} — ${g.members.length} member${g.members.length !== 1 ? 's' : ''}</option>`),
    ].join('');

    adminDialog({
      title: 'Mass Broadcast',
      content: `
        <form class="ncm-msg2-dlg">
          <label>Send to</label>
          <select name="target">${targetOptions}</select>
          <label>From (NPC / Sender name)</label>
          <input type="text" name="from" placeholder="e.g. NCPD, System, Rogue…">
          <label>Subject</label>
          <input type="text" name="subject" placeholder="Message subject…">
          <label>Message Body</label>
          <textarea name="body" rows="4" placeholder="Message content…"></textarea>
        </form>`,
      buttons: {
        send: {
          icon: '<i class="fas fa-tower-broadcast"></i>',
          label: 'Send Broadcast',
          callback: async (html) => {
            const from = html.find('[name="from"]').val()?.trim() || 'System';
            const subject = html.find('[name="subject"]').val()?.trim() || 'Broadcast';
            const body = html.find('[name="body"]').val()?.trim();
            if (!body) return;
            const targetId = html.find('[name="target"]').val() || '__all__';
            const group = groups.find(g => g.id === targetId) || null;
            const recipients = group
              ? groupSvc.recipientsFor(group).recipients
              : playerActors.map(pa => ({ actorId: pa.id, name: pa.name }));
            const label = group ? `"${group.name}"` : 'all player characters';
            if (!recipients.length) { ui.notifications.warn(`NCM | Nobody reachable in ${label}.`); return; }
            try {
              const result = await this.messageService?.sendMessage({ from, subject, body, isBroadcast: true, recipients });
              const delivered = result?.delivered ?? (result?.success ? recipients.length : 0);
              const failed = result?.failed || [];
              if (delivered > 0) ui.notifications.info(`NCM | Broadcast to ${label}: delivered to ${delivered} of ${recipients.length}.`);
              if (failed.length) ui.notifications.warn(`NCM | Not delivered to ${failed.length}: ${failed.map(x => `${x.name}: ${x.error || 'unknown error'}`).join(' · ')}`, { permanent: true });
              else if (!result?.success) ui.notifications.warn(`NCM | Broadcast failed: ${result?.error || 'unknown error'}`);
            } catch (err) {
              ui.notifications.warn(`NCM | Broadcast failed: ${err?.message || 'unknown error'}`);
            }
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'send',
    }).render(true);
  }

  async onHardDelete(event, target) {
    event?.stopPropagation?.();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner;
    if (!messageId) return;

    const confirmed = await adminConfirm({
      title: 'Hard Delete Message',
      content: '<p>Permanently delete this message? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    try {
      // The repository path resolves the inbox by OWNER (actor / master
      // contact). It returns {success:false} — without throwing — when that
      // owner no longer exists (orphaned inbox) or the page isn't found, and
      // the old code toasted "permanently deleted" regardless (2026-09 tester:
      // "click Yes, but message not deleted"). Check the result and fall back
      // to a direct journal scan keyed on the page flag.
      let deleted = false;
      let reason = null;
      if (inboxOwnerId) {
        const result = await this.messageRepository?.hardDeleteMessage(inboxOwnerId, messageId);
        deleted = !!result?.success;
        reason = result?.error || null;
        if (!deleted) log.warn(`Hard delete via owner ${inboxOwnerId} failed (${reason}) — scanning journals`);
      }
      if (!deleted) {
        for (const journal of game.journal ?? []) {
          if (!MessageRepository.identifyInbox(journal)) continue;
          const page = journal.pages?.find(p => p.flags?.[MODULE_ID]?.messageId === messageId);
          if (page) {
            await journal.deleteEmbeddedDocuments('JournalEntryPage', [page.id]);
            deleted = true;
            break;
          }
        }
      }
      if (!deleted) {
        ui.notifications.error(`NCM | Message not deleted — ${reason || 'no inbox page carries that message id'}.`);
        this.render(true);
        return;
      }
      this.messageRepository?.clearCache?.();
      if (this._sel === messageId) this._sel = null;
      ui.notifications.info('NCM | Message permanently deleted.');
      this.render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Hard delete failed:`, err);
      ui.notifications.error(`NCM | Failed to delete message: ${err?.message || err}`);
    }
  }
}
