/**
 * TerminalsTab — Admin Panel tab for Terminal management.
 * @file scripts/ui/AdminPanel/tabs/TerminalsTab.js
 * @module night-city-messenger
 *
 * 2026-10-27 redesign (dev-approved mock `dev/mockups/admin-terminals-redesign-mock.html`),
 * built for a campaign with dozens of terminals:
 *   - filter chips with counts (All / Logged in / Needs you / Secured / This scene / Not pinned)
 *     plus a scope picker over the scenes terminals are pinned on;
 *   - ONE scrolling list GROUPED under sticky, foldable headers (location /
 *     pinned scene / organization / folder / preset / none) — no paging;
 *   - 2026-10-28 (mock admin-terminals-rack-modules-mock.html, Version A): each
 *     list row is a RACK UNIT (icon tile, four lights, heat bar, trace timer) and
 *     the detail is information-first modules — header + one status line, RIGHT
 *     NOW (one row per live thing with its button), the ACCOUNTS table (row click
 *     expands its facts), RECENT LOGINS (character (player) → account, result),
 *     Setup. See _buildDetail();
 *   - Open / Configure / Reset up top, the rest in a ⋯ menu;
 *   - Select mode: tick rows → Reset / Export / Remove in one go.
 *
 * Every button is `data-action="tabAct" data-owner="terminals" data-op="…"` →
 * onAct(op). The old static delegators on AdminPanelApp (terminalOpen,
 * terminalRelock, …) still work and forward to the same on* methods.
 * Context lives under ONE key, `term2`, because AdminPanelApp spreads every
 * tab's context into a single object.
 */

import { showAccessMenu } from '../../../integrations/AccessPoints.js';
import { BaseTab } from '../BaseTab.js';
import { MODULE_ID, TERMINAL_PRESETS, TERMINAL_LOGIN_STYLES, TERMINAL_MAILBOX_STYLES, TERMINAL_SOUND_SETS } from '../../../utils/constants.js';
import { adminConfirm } from '../../../utils/adminTheme.js';
import { showNamePicker, documentEntries } from '../../../utils/namePicker.js';
import { ScopePicker } from '../../../utils/scopePicker.js';
import { bypassRowsOf } from '../../../utils/bypassSkills.js';
import { formatCyberDate, getPlayerCharacters, log } from '../../../utils/helpers.js';
import { rackFoldMemory, rackFoldState, rackHeadSummary } from './terminalsRack.js';
import { triesFromLog, partyRowState, lockInWords, fmtCountdown, STATE_ORDER, LOGIN_ACTIONS, CLEAR_ACTION, rowIsForAccount } from '../../../utils/accountStatus.js';

/** Group-by modes: label, header icon, key-of-row. */
const GROUPS = {
  location: { label: 'Location', icon: 'fa-location-dot', of: (t) => t.location || 'No location' },
  scene: { label: 'Pinned on', icon: 'fa-map-pin', of: (t) => t.pinNames[0] || 'Not pinned' },
  org: { label: 'Organization', icon: 'fa-building', of: (t) => t.org || 'No organization' },
  folder: { label: 'Folder', icon: 'fa-folder', of: (t) => t.folder || '(no folder)' },
  preset: { label: 'Preset', icon: 'fa-palette', of: (t) => t.presetLabel },
  none: { label: 'None', icon: 'fa-list', of: () => 'All terminals' },
};

/** Filter chips: key, label, test. */
const FILTERS = [
  ['all', 'All', () => true],
  ['online', 'Logged in', (t) => t.loginCount > 0],
  ['attention', 'Needs you', (t) => t.attention],
  ['locked', 'Secured', (t) => t.locked],
  ['here', 'This scene', (t, here) => !!here && t.pinSceneIds.includes(here)],
  ['unplaced', 'Not pinned', (t) => !t.pinSceneIds.length],
];

const SORTS = [
  ['name', 'Name', 'fa-arrow-down-a-z'], ['accounts', 'Most accounts', 'fa-users'], ['online', 'Logged in first', 'fa-circle-user'], ['attention', 'Needs you first', 'fa-triangle-exclamation'],
];

const EXFIL_LABELS = { agent: 'To Agent', shard: 'Burn', forward: 'Forward', leak: 'Leak', sell: 'Sell', wipe: 'Wipe' };

const esc = (s) => (typeof Handlebars !== 'undefined' ? Handlebars.escapeExpression(String(s ?? '')) : String(s ?? ''));
const slug = (s) => String(s || 'terminal').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'terminal';
/** Long skill names, shortened for the accounts table (the tooltip keeps the full name). */
const SKILL_SHORT = { 'electronics/security tech': 'Security Tech', 'electronics/securitytech': 'Security Tech' };
const shortSkill = (n) => SKILL_SHORT[String(n || '').toLowerCase()] || n;
/** Program effect → what the GM calls it (the registry lives in ContentRenderers; this tab only needs a word). */
const PLANT_LABELS = { plant: 'Planted file', keylog: 'Keylogger', forgeAccount: 'Backdoor', deployICE: 'Black ICE', logicBomb: 'Logic bomb', wipe: 'Wipe', corrupt: 'Corrupt', adjudicate: 'Program' };
/** Heat → its tone word. */
const heatTone = (v) => (v >= 80 ? 'burned' : v >= 50 ? 'hot' : v >= 25 ? 'warm' : 'cold');
const HEAT_WORD = { cold: 'Cold', warm: 'Warm', hot: 'Hot', burned: 'Burned' };
const bars = (n, of) => Array.from({ length: n }, (_, i) => ({ on: i < of }));
const initialsOf = (n) => String(n || '?').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export class TerminalsTab extends BaseTab {

  _search = '';
  _sort = 'name';
  _filter = 'all';
  _group = 'location';
  _selectedId = null;
  _openNow = new Map();     // groupKey → {open, forced} from the last render (what a head click flips)
  _acctOpen = new Map();    // "itemId:accountId" → true (expanded) / false; unset = folded
  _bulk = false;
  _picked = new Set();
  _menuOpen = false;
  _viewOpen = false;        // the View menu (Group by · Sort) — a body-mounted portal, see _mountViewMenu()
  _scrollMemo = null;
  _scrollToSel = false;
  _refocusSearch = false;

  get key() { return 'terminals'; }
  /** The GM's fold choices for this window + grouping — kept for the session (terminalsRack.js). */
  get _fold() { return rackFoldMemory(this.app?.id, this._group); }
  get terminalService() { return game.nightcity?.terminalService; }

  // ═══════════════════════════════════════════════════════════
  //  Data gathering
  // ═══════════════════════════════════════════════════════════

  /** Scene pins: itemId → [{sceneId, sceneName}] (one pass over every scene's notes). */
  _pinIndex() {
    const out = new Map();
    for (const scene of game.scenes ?? []) {
      for (const n of scene.notes ?? []) {
        const id = n.getFlag?.(MODULE_ID, 'terminalItemId') ?? n.flags?.[MODULE_ID]?.terminalItemId;
        if (!id) continue;
        if (!out.has(id)) out.set(id, []);
        if (!out.get(id).some((p) => p.sceneId === scene.id)) out.get(id).push({ sceneId: scene.id, sceneName: scene.name });
      }
    }
    return out;
  }

  /**
   * Active SecurityService lockouts on this terminal's accounts: the GM's own
   * client state plus what players' clients reported (SECURITY_REPORT).
   */
  _lockouts(item, accounts) {
    const sec = game.nightcity?.securityService;
    if (!sec?._states?.values) return [];
    const out = [];
    const prefix = `${item.id}::`;
    const seen = new Set();
    for (const s of [...sec._states.values(), ...(sec._remote?.values?.() ?? [])]) {
      const tid = String(s?.targetId || '');
      if (!tid.startsWith(prefix) || !s.lockoutUntil) continue;
      if (seen.has(`${s.actorId}::${tid}`)) continue;
      seen.add(`${s.actorId}::${tid}`);
      const known = sec.getKnownState?.(s.actorId, tid);
      const remaining = known ? known.lockoutRemaining : (sec.getLockoutRemaining?.(s.actorId, tid) || 0);
      if (remaining <= 0) continue;
      const acctId = tid.slice(prefix.length);
      out.push({
        actorId: s.actorId,
        accountId: acctId,
        actor: game.actors?.get(s.actorId)?.name || 'Someone',
        account: accounts.find((a) => a.id === acctId)?.username || acctId,
        minutes: Math.max(1, Math.ceil(remaining / 60000)),
        until: this._nowMs() + remaining,
      });
    }
    return out;
  }

  /** Heat rows on this machine (decayed), warm and up. */
  _heat(item) {
    const trace = game.nightcity?.traceService;
    const per = trace?.getHeatMap?.()?.[item.id];
    if (!per) return [];
    const out = [];
    for (const actorId of Object.keys(per)) {
      const v = Math.round(trace.getHeat(item.id, actorId) || 0);
      if (v < 25) continue;
      const tier = trace.constructor?.tierOf?.(v) || (v >= 80 ? 'burned' : v >= 50 ? 'hot' : 'warm');
      out.push({ actorId, actor: game.actors?.get(actorId)?.name || (actorId === 'unknown' ? 'Unknown' : actorId), value: v, tier: String(tier).toUpperCase() });
    }
    return out.sort((a, b) => b.value - a.value);
  }

  _countdowns(item) {
    const trace = game.nightcity?.traceService;
    const list = trace?.getCountdowns?.() || [];
    const now = this._nowMs();
    return list.filter((c) => c?.objectId === item.id).map((c) => ({
      id: c.id,
      actorId: c.actorId,
      actor: game.actors?.get(c.actorId)?.name || c.actorName || 'Someone',
      source: (c.source || '').trim() || 'A trace',
      remaining: Math.max(0, (Number(c.expiresAt) || now) - now),
      until: Number(c.expiresAt) || null,
    })).sort((a, b) => a.remaining - b.remaining);
  }

  /** The hottest operator's (decayed) heat on this machine, 0 when cold. */
  _maxHeat(item) {
    const trace = game.nightcity?.traceService;
    const per = trace?.getHeatMap?.()?.[item.id];
    if (!per) return 0;
    let max = 0;
    for (const actorId of Object.keys(per)) max = Math.max(max, Math.round(trace.getHeat(item.id, actorId) || 0));
    return max;
  }

  /** "24m" / "3h" / "2d" / "now" against the game clock — for the tight columns. */
  _agoShort(ts) {
    const t = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return '';
    const m = Math.floor((this._nowMs() - t) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  /** "18m" / "1h" / "1h 20m" — time LEFT on a lockout or a trace. */
  _left(ms) {
    const m = Math.max(0, Math.ceil((Number(ms) || 0) / 60000));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  _nowMs() {
    try { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); }
  }

  /** "12 min ago" against the GAME clock (footprints are stamped with it). */
  _ago(ts) {
    if (!ts) return '';
    const t = Date.parse(ts);
    if (!Number.isFinite(t)) return '';
    const mins = Math.floor((this._nowMs() - t) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  _fullDate(ts) {
    try { return ts ? formatCyberDate(ts) : ''; } catch { return String(ts || ''); }
  }

  _portrait(acct) {
    const ps = game.nightcity?.portraitService;
    if (!ps) return acct.portrait || null;
    if (acct.masterContactId) {
      const c = game.nightcity?.masterContactService?.getContact?.(acct.masterContactId);
      if (c) { const p = ps.resolvePortrait(c); if (p) return p; }
    }
    return ps.resolvePortrait({ portrait: acct.portrait, actorId: acct.actorId }) || null;
  }

  _netName(id) {
    return game.nightcity?.networkService?.getNetwork?.(id)?.name || id;
  }

  /** One account → its row: who it is → how you get in → when. */
  _accountRow(item, a, sessions) {
    const sec = a.security || {};
    const requires = !!sec.requiresAuth;
    const how = [];
    if (requires) {
      if (sec.allowPassword ?? sec.password) how.push({ icon: 'fa-key', label: 'Password' });
      if (sec.allowSkillCheck) for (const r of bypassRowsOf(sec)) how.push({ icon: 'fa-dice-d20', label: `${r.name} DV ${r.dv}` });
      if (sec.allowKeyItem) how.push({ icon: 'fa-id-badge', label: sec.keyItemName || 'Key item' });
      if (how.length > 1 && sec.authLogic === 'all') how.unshift({ icon: 'fa-layer-group', label: 'All of', cls: 'gate' });
    }
    const linked = !!(a.masterContactId || a.actorId);
    const portrait = this._portrait(a);
    const onlineBy = Object.entries(sessions)
      .filter(([, s]) => s?.activeAccountId === a.id)
      .map(([actorId]) => game.actors?.get(actorId)?.name || actorId);
    const last = this.terminalService?.getLastLogin?.(item, a.id) || null;
    const nets = a.network?.restricted ? (a.network.allowedNetworks || []).map((n) => this._netName(n)) : [];
    const words = lockInWords(sec, sec.allowSkillCheck ? bypassRowsOf(sec) : []);
    return {
      id: a.id,
      itemId: item.id,
      lockWords: words.text,
      lockParts: words.parts,
      party: [],
      lockedOutCount: 0,
      lastLine: '',
      username: a.username || a.id,
      displayName: a.displayName || a.username || a.id,
      role: a.role || '',
      link: a.masterContactId ? 'contact' : (a.actorId ? 'character' : ''),
      portrait,
      initials: (!portrait && linked) ? initialsOf(a.displayName || a.username) : '',
      machineIcon: (!portrait && !linked) ? (a.isAdmin ? 'fa-server' : 'fa-user') : '',
      // The accounts table leads with a face: the portrait, else initials in the name hue.
      avText: portrait ? '' : initialsOf(a.displayName || a.username || a.id),
      isAdmin: !!a.isAdmin,
      hidden: !!a.hidden,
      privateFromAdmin: !!a.privateFromAdmin,
      isOpen: !requires,
      how,
      netGated: !!a.network?.restricted,
      netLabel: nets.length ? nets.join(', ') : (a.network?.restricted ? 'gated' : ''),
      onlineBy: onlineBy.join(', '),
      isOnline: onlineBy.length > 0,
      lastAgo: last?.ts ? this._ago(last.ts) : '',
      lastFull: last?.ts ? `${this._fullDate(last.ts)}${last.operatorName ? ` · ${last.operatorName}` : ''}` : '',
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  The selected terminal's detail (mock admin-terminals-rack-modules-mock.html,
  //  Version A): Right now · Accounts table (+ expanded facts) · Recent logins.
  //  Only the SELECTED terminal pays for any of this.
  // ═══════════════════════════════════════════════════════════

  /** The lock in words: {open, sealed, parts:[{t, dv, conj}], tip}. Full = every bypass skill. */
  _lockParts(sec = {}, full = false) {
    if (!sec.requiresAuth) return { open: true, parts: [], tip: 'Open — no login' };
    const rows = sec.allowSkillCheck ? bypassRowsOf(sec) : [];
    const logic = sec.authLogic === 'all' ? '+' : 'or';
    const parts = [];
    if (sec.allowPassword ?? sec.password) parts.push({ t: 'password', g: 'pw' });
    if (sec.allowKeyItem) parts.push({ t: sec.keyItemName || 'a key item', g: 'key' });
    if (rows.length) {
      if (!full) parts.push({ t: shortSkill(rows[0].name), dv: rows[0].dv, g: 'sk' });
      else if (rows.every((r) => r.dv === rows[0].dv)) parts.push({ t: rows.map((r) => shortSkill(r.name)).join(' or '), dv: rows[0].dv, g: 'sk' });
      else rows.forEach((r) => parts.push({ t: shortSkill(r.name), dv: r.dv, g: 'sk' }));
    }
    if (!parts.length) return { sealed: true, parts: [{ t: 'sealed — no way in', conj: '' }], tip: 'No way in is switched on' };
    // Two bypass skills are always alternatives, whatever the logic between the methods.
    parts.forEach((p, i) => { const n = parts[i + 1]; p.conj = !n ? '' : (p.g === 'sk' && n.g === 'sk' ? 'or' : logic); });
    const tip = [
      (sec.allowPassword ?? sec.password) ? 'Password' : '',
      sec.allowKeyItem ? `Key item: ${sec.keyItemName || 'any'}` : '',
      rows.length ? `Skill: ${rows.map((r) => `${r.name} DV ${r.dv}`).join(' or ')}` : '',
    ].filter(Boolean).join(sec.authLogic === 'all' ? ' + ' : ' or ');
    return { parts, tip };
  }

  /**
   * Every login attempt on this machine, newest first: the footprints (logged in)
   * + the Security log's misses (failed), replayed per character + account so the
   * miss that hit the try limit reads "locked out". Never a method — it isn't recorded.
   */
  _attempts(item, accounts, log, logins, playerOf) {
    const ev = [];
    const nameOf = (id, fallback) => game.actors?.get(id)?.name || fallback || 'Someone';
    const userOf = (a) => accounts.find((x) => x.id === a);
    for (const l of logins) {
      const t = Date.parse(l?.ts);
      if (!Number.isFinite(t)) continue;
      ev.push({ t, ts: l.ts, kind: 'ok', actorId: l.operatorId || '', name: l.operatorName || nameOf(l.operatorId), accountId: l.accountId, account: l.username || userOf(l.accountId)?.username || l.accountId });
    }
    for (const r of log) {
      if (!r) continue;
      const t = Date.parse(r.ts);
      if (!Number.isFinite(t)) continue;
      const clear = r.action === CLEAR_ACTION;
      if (!clear && !LOGIN_ACTIONS.has(r.action)) continue;
      const a = accounts.find((x) => (clear ? r.targetNetworkId === `${item.id}::${x.id}`
        : rowIsForAccount(r, { itemId: item.id, accountId: x.id, accountNames: [x.displayName, x.username, 'account'] })));
      if (!a) continue;
      if (!clear && r.outcome === 'success') continue; // the footprint already says it
      ev.push({ t, ts: r.ts, kind: clear ? 'clear' : 'fail', actorId: r.actorId || '', name: nameOf(r.actorId, r.actorName), accountId: a.id, account: a.username || a.id });
    }
    ev.sort((x, y) => x.t - y.t);
    const used = new Map();
    for (const e of ev) {
      const k = `${e.actorId}::${e.accountId}`;
      if (e.kind !== 'fail') { used.set(k, 0); continue; }
      const max = Math.max(1, Number(userOf(e.accountId)?.security?.maxAttempts) || 3);
      const n = (used.get(k) || 0) + 1;
      if (n >= max) { e.lockedOut = true; used.set(k, 0); } else used.set(k, n);
    }
    return ev.filter((e) => e.kind !== 'clear').reverse().map((e) => ({
      actorId: e.actorId, name: e.name, player: playerOf.get(e.actorId) || '', accountId: e.accountId, account: e.account,
      ok: e.kind === 'ok', result: e.kind === 'ok' ? 'logged in' : (e.lockedOut ? 'locked out' : 'failed'),
      when: this._agoShort(e.ts), full: this._fullDate(e.ts), initials: initialsOf(e.name),
    }));
  }

  /** Build the selected terminal's Right now / status line / accounts table / recent logins. */
  _buildDetail(t) {
    const svc = this.terminalService;
    const item = (svc?.collectTerminals?.() ?? []).find((it) => it.id === t.id);
    if (!item) return;
    const cfg = svc.getConfig(item);
    const state = svc.getState(item) || {};
    const sessions = state.sessions || {};
    const logins = svc.getLoginLog?.(item) || [];
    const log = game.nightcity?.traceService?.getLog?.() || [];
    const sec = game.nightcity?.securityService;
    const now = this._nowMs();
    const party = getPlayerCharacters();
    const playerOf = new Map(party.map((p) => [p.actorId, p.playerName]));
    const accounts = cfg.accounts || [];
    const attempts = this._attempts(item, accounts, log, logins, playerOf);
    const liveLocks = this._lockouts(item, accounts);

    const now_ = [];
    const btn = (op, label, attrs, cls = '') => ({ op, label, cls, attrs: { 'item-id': item.id, ...attrs } });

    // ── per account: the party's state, then the table row ──
    for (const row of t.accounts) {
      const a = accounts.find((x) => x.id === row.id);
      if (!a) continue;
      const s = a.security || {};
      const max = Math.max(1, Number(s.maxAttempts) || 3);
      const lockoutMs = Number(s.lockoutDuration ?? 3600000);
      const key = `${item.id}::${a.id}`;
      const names = [a.displayName, a.username, 'account'].filter(Boolean);
      const pr = party.map(({ actor, actorName }) => ({
        actorId: actor.id, name: actorName || actor.name,
        ...partyRowState({
          loggedIn: sessions[actor.id]?.activeAccountId === a.id,
          known: sec?.getKnownState?.(actor.id, key) || null,
          derived: s.requiresAuth ? triesFromLog({ log, logins, itemId: item.id, accountId: a.id, accountNames: names, actorId: actor.id, maxAttempts: max, lockoutMs, now }) : { used: 0, lockUntil: null },
          blocked: '',
          maxAttempts: max,
          now,
        }),
      })).sort((x, y) => (STATE_ORDER[x.state] - STATE_ORDER[y.state]) || x.name.localeCompare(y.name));
      // A lockout on a character that isn't in the party (an NPC operator) still counts.
      for (const l of liveLocks) {
        if (l.accountId !== a.id || pr.some((p) => p.actorId === l.actorId)) continue;
        pr.unshift({ actorId: l.actorId, name: l.actor, state: 'locked', lockUntil: l.until, remaining: l.until - now });
      }
      const ins = Object.entries(sessions).filter(([, v]) => v?.activeAccountId === a.id)
        .map(([actorId]) => ({ actorId, name: game.actors?.get(actorId)?.name || actorId }));
      const locked = pr.filter((p) => p.state === 'locked');
      const tried = pr.filter((p) => p.state === 'tried');

      // Status cell — one state in words.
      let status;
      if (ins.length) status = { cls: 'good', icon: 'fa-circle', text: `${ins.map((x) => x.name).join(', ')} in` };
      else if (locked.length) {
        const first = locked.reduce((m, p) => (p.lockUntil > m.lockUntil ? p : m), locked[0]);
        status = { cls: 'bad', icon: 'fa-ban', text: `${locked.map((p) => p.name).join(', ')} out`, left: this._left(first.lockUntil - now), lockUntil: first.lockUntil };
      } else if (tried.length) {
        const worst = tried.reduce((m, p) => (p.left < m.left ? p : m), tried[0]);
        status = { cls: 'attn', tries: `${worst.left}/${max}`, text: 'tries', tip: tried.map((p) => `${p.name}: ${p.left} of ${max} left`).join(' · ') };
      } else status = { cls: 'quiet', text: 'quiet' };

      // Who it belongs to.
      const mc = a.masterContactId ? game.nightcity?.masterContactService?.getContact?.(a.masterContactId) : null;
      const act = a.actorId ? game.actors?.get(a.actorId) : null;
      const owner = mc ? { name: mc.name || a.displayName || a.username, address: mc.email || a.email || '' }
        : act ? { name: act.name, address: a.email || act.getFlag?.(MODULE_ID, 'email') || '' } : null;

      // Mailbox counts (GM read: no gates, this login's own volume).
      let msgs = [];
      try { msgs = (svc.getAccountMessages?.(item, a.id, { enforceGates: false, includeShared: false }) || []).filter((m) => !m?.status?.deleted); } catch { msgs = []; }
      const files = msgs.filter((m) => m.envelope === 'file').length;
      const mail = msgs.filter((m) => m.envelope !== 'file');

      const usedMax = Math.max(0, ...pr.map((p) => (p.state === 'locked' ? max : (p.used || 0))));
      const resetIds = pr.filter((p) => p.state === 'tried' || p.state === 'locked').map((p) => p.actorId);
      const last = svc.getLastLogin?.(item, a.id) || null;
      const short = this._lockParts(s, false);
      const fullLock = this._lockParts(s, true);
      const foldKey = `${item.id}:${a.id}`;
      Object.assign(row, {
        foldKey,
        owner,
        lock: short,
        lockFull: fullLock,
        status,
        lastWho: last?.ts ? (last.operatorName || 'someone') : '',
        lastWhen: last?.ts ? this._agoShort(last.ts) : '',
        mail: { count: mail.length, unread: mail.filter((m) => !m.status?.read && !m.status?.sent).length, files },
        rule: s.requiresAuth ? { max, lockout: this._left(lockoutMs), used: usedMax } : null,
        logins: attempts.filter((e) => e.accountId === a.id).slice(0, 3),
        resetIds: resetIds.join(','),
        hasActivity: !!(ins.length || locked.length || tried.length),
      });

      // Right now: sessions + lockouts on this account.
      for (const x of ins) {
        let since = '';
        for (let i = logins.length - 1; i >= 0; i--) {
          if (logins[i]?.operatorId === x.actorId && logins[i]?.accountId === a.id) { since = this._agoShort(logins[i].ts); break; }
        }
        now_.push({ kind: 'in', icon: 'fa-circle-user', tone: 'good', main: x.name, pre: 'in on', acct: a.username || a.id,
          time: since === 'now' ? 'now' : since, unit: since && since !== 'now' ? 'in' : '',
          btns: [btn('acctLogout', 'Log out', { 'actor-id': x.actorId, 'account-id': a.id })] });
      }
      for (const p of locked) {
        now_.push({ kind: 'lock', icon: 'fa-ban', tone: 'bad', main: p.name, pre: 'locked out of', acct: a.username || a.id,
          time: this._left(p.lockUntil - now), unit: 'left', lockUntil: p.lockUntil,
          btns: [btn('acctClear', 'Clear', { 'actor-id': p.actorId, 'account-id': a.id })] });
      }
    }
    // Every account starts folded; only rows the GM opened stay open (dev, 2026-10-28).
    for (const r of t.accounts) r.open = !!this._acctOpen.get(r.foldKey);

    // Armed plants.
    for (const r of (svc.getResidents?.(item) || []).filter((x) => x?.state === 'armed')) {
      const accountId = r.trigger?.accountId || r.params?.accountId || '';
      const acct = accounts.find((x) => x.id === accountId);
      const by = r.provenance?.plantedBy ? (game.actors?.get(r.provenance.plantedBy)?.name || 'someone') : 'GM';
      const k = r.trigger?.kind;
      const fires = k === 'onLogin' ? 'fires next login' : k === 'onDate' ? `fires ${this._fullDate(new Date(r.trigger.atMs || 0).toISOString())}`
        : k === 'onAction' ? `fires on ${r.trigger.action || 'an action'}` : k === 'onHeat' ? `fires at heat ${r.trigger.atLeast ?? '?'}` : 'waits for you';
      now_.push({ kind: 'plant', icon: 'fa-bug', tone: 'attn', main: r.params?.name || PLANT_LABELS[r.effectType] || r.effectType || 'Program',
        pre: acct ? 'on' : '', acct: acct ? (acct.username || acct.id) : '', post: `by ${by}`, l2: fires,
        btns: [btn('defuse', 'Defuse', { 'resident-id': r.id }, 'danger')] });
    }
    // Trace countdowns.
    for (const c of this._countdowns(item)) {
      now_.push({ kind: 'trace', icon: 'fa-satellite-dish', tone: 'bad', main: 'Trace', post: `${c.source} closing in on ${c.actor}`,
        time: this._left(c.remaining), unit: 'left',
        btns: [btn('callOff', 'Call off', { 'countdown-id': c.id })] });
    }
    // Heat ≥ 25.
    for (const h of this._heat(item)) {
      const tone = heatTone(h.value);
      now_.push({ kind: 'heat', icon: 'fa-temperature-half', tone, heatTone: tone, main: 'Heat', num: h.value, meter: bars(10, Math.round(h.value / 10)),
        post: `${HEAT_WORD[tone]} · ${h.actor}`,
        btns: [
          btn('heatClear', 'Clear', { 'object-id': item.id, 'actor-id': h.actorId }),
          btn('escalate', 'Escalate', { 'object-id': item.id, 'actor-id': h.actorId, 'object-name': t.name, 'actor-name': h.actor }),
        ] });
    }
    if (t.gmBypassed) {
      now_.push({ kind: 'unl', icon: 'fa-lock-open', tone: 'attn', main: 'GM unlock on', post: 'every login is skipped',
        btns: [btn('reset', 'Relock', {})] });
    }
    t.nowRows = now_;
    t.nowCount = now_.filter((r) => r.kind !== 'heat').length;

    // The header's one status line, in words.
    const nIn = now_.filter((r) => r.kind === 'in').length;
    const nLock = now_.filter((r) => r.kind === 'lock').length;
    const nPlant = now_.filter((r) => r.kind === 'plant').length;
    const trace = now_.find((r) => r.kind === 'trace');
    const parts = [];
    if (nIn) parts.push({ cls: 'good', text: `${nIn} in` });
    if (nLock) parts.push({ cls: 'bad', text: `${nLock} locked out` });
    if (nPlant) parts.push({ cls: 'attn', text: nPlant > 1 ? `${nPlant} plants armed` : 'plant armed' });
    if (trace) parts.push({ cls: 'bad', text: `trace ${trace.time}` });
    if (t.maxHeat >= 25) parts.push({ cls: `heat-${heatTone(t.maxHeat)}`, text: `heat ${t.maxHeat}` });
    if (t.gmBypassed) parts.push({ cls: 'attn', text: 'GM-unlocked' });
    t.statusParts = parts;

    t.recent = attempts.slice(0, 6);
    t.recentTotal = attempts.length;
    t.recentHint = attempts.length > 6 ? `last 6 of ${attempts.length}` : 'character (player) → account';
  }


  /** Every terminal as a row with its full detail. */
  _gather() {
    const svc = this.terminalService;
    const pins = this._pinIndex();
    return (svc?.collectTerminals?.() ?? []).map((item) => {
      const cfg = svc.getConfig(item);
      const state = svc.getState(item);
      const accounts = cfg.accounts || [];
      const sessions = state.sessions || {};
      const logins = Object.entries(sessions)
        .filter(([, s]) => s && s.activeAccountId)
        .map(([actorId, s]) => ({
          actor: game.actors?.get(actorId)?.name || actorId,
          account: accounts.find((a) => a.id === s.activeAccountId)?.username || s.activeAccountId,
        }));
      const secured = accounts.some((a) => a.security?.requiresAuth);
      let uplinkName = null;
      try { uplinkName = svc.getUplink(item)?.network?.name || null; } catch { /* older items */ }
      const residents = (svc.getResidents?.(item) || []).filter((r) => r?.state === 'armed');
      const lockouts = this._lockouts(item, accounts);
      const heat = this._heat(item);
      const countdowns = this._countdowns(item);
      const gmBypassed = !!state.gmBypassed;
      const pinList = pins.get(item.id) || [];
      const presetKey = cfg.theme?.preset || 'classic';
      const loginStyle = cfg.loginStyle || 'cards';
      const mailboxStyle = cfg.mailboxStyle || 'classic';
      const soundSet = cfg.soundSet || 'default';
      let exfil = 'Read-only';
      try {
        const pol = svc.getExfilPolicy?.(item);
        if (pol?.master) {
          const on = Object.keys(EXFIL_LABELS).filter((k) => pol[k]?.allow);
          exfil = on.length ? on.map((k) => EXFIL_LABELS[k] + (pol[k].require ? ` (DV ${pol[k].dv})` : '')).join(', ') : 'Read-only';
        }
      } catch { exfil = cfg.allowExfil !== false ? 'Enabled' : 'Read-only'; }

      const now = [];
      for (const l of logins) now.push({ cls: 'on', icon: 'fa-circle', label: `${l.actor} → ${l.account}` });
      for (const l of lockouts) now.push({ cls: 'lock', icon: 'fa-lock', label: `${l.actor} locked out of ${l.account} · ${l.minutes} min` });
      if (residents.length) now.push({ cls: 'plant', icon: 'fa-syringe', label: `${residents.length} armed plant${residents.length === 1 ? '' : 's'}` });
      for (const h of heat) now.push({ cls: 'hot', icon: 'fa-fire', label: `${h.actor} ${h.value} ${h.tier}` });
      for (const c of countdowns) now.push({ cls: 'lock', icon: 'fa-stopwatch', label: `${c.source} closing in on ${c.actor}` });
      if (gmBypassed) now.push({ cls: 'unl', icon: 'fa-unlock', label: 'GM-unlocked — every login skipped' });

      const owner = item.parent ? item.parent.name : '';
      // The rack unit: icon tile (the item's own art, else the preset's glyph), four lights, heat, a trace timer.
      const maxHeat = this._maxHeat(item);
      const allSecured = accounts.length > 0 && accounts.every((a) => a.security?.requiresAuth) && !gmBypassed;
      const hasImg = !!item.img && !/icons\/svg\/|mystery-man/i.test(item.img);
      const nextTrace = countdowns[0] || null;
      return {
        id: item.id,
        icon: TERMINAL_PRESETS[presetKey]?.icon || cfg.boot?.faIcon || 'fas fa-terminal',
        hasImg,
        hueKey: cfg.metadata?.org || cfg.metadata?.location || cfg.terminalName || item.name,
        maxHeat,
        heatTone: heatTone(maxHeat),
        heatBars: bars(8, Math.round(maxHeat / 12.5)),
        allSecured,
        traceTag: nextTrace ? fmtCountdown(nextTrace.remaining).replace(/^0(?=\d:)/, '') : '',
        traceTip: nextTrace ? `${nextTrace.source} closing in on ${nextTrace.actor}` : '',
        leds: [
          logins.length ? { cls: 'good', tip: `Logged in: ${logins.map((l) => `${l.actor} → ${l.account}`).join(', ')}` } : { cls: '', tip: 'Nobody logged in' },
          lockouts.length ? { cls: 'bad', tip: `Locked out: ${lockouts.map((l) => `${l.actor} (${l.account})`).join(', ')}` } : { cls: '', tip: 'No lockouts' },
          residents.length ? { cls: 'attn', tip: `${residents.length} armed plant${residents.length === 1 ? '' : 's'}` } : { cls: '', tip: 'Nothing planted' },
          allSecured ? { cls: 'secret', tip: 'Every account needs a login' } : { cls: '', tip: gmBypassed ? 'GM-unlocked' : (accounts.length ? 'Has an open account' : 'No accounts') },
        ],
        uuid: item.uuid,
        name: cfg.terminalName || item.name,
        img: item.img,
        owner: cfg.metadata?.owner || '',
        org: cfg.metadata?.org || '',
        location: cfg.metadata?.location || '',
        classification: cfg.metadata?.classification || '',
        // A classification is a severity, not a category: the secret-sounding words go red,
        // the guarded ones amber, anything else takes the hue of its own name.
        classTone: /secret|black|eyes|omega|classified/i.test(cfg.metadata?.classification || '') ? 'is-bad'
          : /restrict|confiden|internal|sensitive|private/i.test(cfg.metadata?.classification || '') ? 'is-attn' : '',
        where: [
          cfg.metadata?.owner && { icon: 'fas fa-user', text: cfg.metadata.owner },
          cfg.metadata?.org && { icon: 'fas fa-building', text: cfg.metadata.org },
          cfg.metadata?.location && { icon: 'fas fa-location-dot', text: cfg.metadata.location },
          owner && { icon: 'fas fa-hand', text: `Carried by ${owner}` },
        ].filter(Boolean),
        scope: owner || 'World',
        carriedBy: owner,
        whereText: [cfg.metadata?.location, cfg.metadata?.org].filter(Boolean).join(' · '),
        whereLine: [cfg.metadata?.owner, cfg.metadata?.org, cfg.metadata?.location, owner ? `Carried by ${owner}` : ''].filter(Boolean).join(' · ') || 'No location set',
        folder: item.parent ? `Carried by ${owner}` : (item.folder?.name || ''),
        accountCount: accounts.length,
        hiddenCount: accounts.filter((a) => a.hidden).length,
        accounts: accounts.map((a) => this._accountRow(item, a, sessions)),
        logins,
        loginCount: logins.length,
        // Login footprints (terminalState.loginLog) — newest first.
        recentLogins: (svc.getLoginLog?.(item) || []).slice(-12).reverse().map((e) => ({
          when: e.ts ? this._ago(e.ts) : '',
          full: this._fullDate(e.ts),
          account: e.username || e.accountId,
          operator: e.operatorName || '',
        })),
        networkBinding: cfg.network?.required ? this._netName((cfg.network.allowedNetworks || [])[0] || '') || 'any network' : null,
        uplinkName,
        allowExfil: cfg.allowExfil !== false,
        exfil,
        gmBypassed,
        locked: secured && !gmBypassed,
        armedCount: residents.length,
        lockoutCount: lockouts.length + countdowns.length,
        now,
        attention: !!(lockouts.length || residents.length || heat.length || countdowns.length || gmBypassed),
        pinSceneIds: pinList.map((p) => p.sceneId),
        pinNames: pinList.map((p) => p.sceneName),
        pinLabel: pinList.map((p) => p.sceneName).join(', '),
        preset: presetKey,
        presetLabel: TERMINAL_PRESETS[presetKey]?.label || (presetKey === 'classic' ? 'Classic' : presetKey),
        loginStyle,
        loginLabel: TERMINAL_LOGIN_STYLES.find((s) => s.key === loginStyle)?.label || loginStyle,
        mailboxStyle: cfg.mailboxStyle || 'classic',
        mailboxLabel: TERMINAL_MAILBOX_STYLES.find((s) => s.key === mailboxStyle)?.label || mailboxStyle,
        soundSet,
        soundLabel: TERMINAL_SOUND_SETS[soundSet]?.label || soundSet,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    // The old DOM is still mounted here — remember the two scrollers.
    try {
      const el = this.app.element;
      const list = el?.querySelector?.('.ncm-term2-list');
      const det = el?.querySelector?.('.ncm-term2-det');
      if (list || det) this._scrollMemo = { list: list?.scrollTop || 0, det: det?.scrollTop || 0, sel: det?.dataset?.sel || null };
    } catch { /* not rendered yet */ }

    const all = this._gather();
    const here = game.scenes?.viewed?.id || globalThis.canvas?.scene?.id || null;

    // Scene scope picker: every scene a terminal is pinned on (count = terminals).
    const pid = this.scopeId('scenes');
    ScopePicker.on(pid, () => this.app.render(false));
    const sceneCounts = new Map();
    for (const t of all) t.pinSceneIds.forEach((sid, i) => {
      const cur = sceneCounts.get(sid) || { id: sid, name: t.pinNames[i], count: 0 };
      cur.count += 1; sceneCounts.set(sid, cur);
    });
    const sceneItems = [...sceneCounts.values()].map((s) => {
      const scene = game.scenes?.get?.(s.id);
      return { id: s.id, name: s.name, count: s.count, icon: 'fa-map', group: scene?.folder?.name || '', meta: s.id === here ? 'viewing now' : '' };
    });
    const pickedScenes = (ScopePicker.value(pid) || []).filter((id) => sceneCounts.has(id));

    const q = this._search.trim().toLowerCase();
    const filterFn = (FILTERS.find((f) => f[0] === this._filter) || FILTERS[0])[2];
    let list = all.filter((t) => filterFn(t, here));
    if (pickedScenes.length) list = list.filter((t) => t.pinSceneIds.some((id) => pickedScenes.includes(id)));
    if (q) {
      list = list.filter((t) => `${t.name} ${t.owner} ${t.org} ${t.location} ${t.presetLabel} ${t.scope} ${t.pinLabel} ${t.accounts.map((a) => `${a.username} ${a.displayName}`).join(' ')}`
        .toLowerCase().includes(q));
    }
    const by = {
      name: (a, b) => a.name.localeCompare(b.name),
      accounts: (a, b) => b.accountCount - a.accountCount || a.name.localeCompare(b.name),
      online: (a, b) => b.loginCount - a.loginCount || a.name.localeCompare(b.name),
      attention: (a, b) => (b.attention - a.attention) || a.name.localeCompare(b.name),
    };
    list = [...list].sort(by[this._sort] || by.name);

    // Group (the "No …" / "Not …" / "(…)" buckets sink to the bottom).
    const g = GROUPS[this._group] || GROUPS.location;
    const buckets = new Map();
    for (const t of list) { const k = g.of(t); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(t); }
    const sink = (k) => (/^(No |Not |\(|Carried by )/.test(k) ? 1 : 0);
    const keys = [...buckets.keys()].sort((a, b) => sink(a) - sink(b) || a.localeCompare(b));
    // Selection: keep it while it is in the filtered list, else the first unit of the first group.
    if (!list.some((t) => t.id === this._selectedId)) this._selectedId = buckets.get(keys[0])?.[0]?.id ?? null;
    const selKey = keys.find((k) => buckets.get(k).some((t) => t.id === this._selectedId)) ?? null;
    // Default folds: first group open, the rest closed; a new selection opens its group once;
    // a search / non-All filter / scene pick opens everything; the GM's own choices win otherwise.
    // A NEW selection opens its group once (recorded as an open choice); after that the GM's own fold wins,
    // so the group holding the selection can be folded (2026-10-28 — the same rule as Contacts and Shards;
    // it used to be forced open with a dead head click). The marker lives in the same per-window,
    // per-grouping memory, under a key no group can have.
    // While a search / filter opens everything, a selection it auto-picks is not a "new pick" — otherwise
    // clearing the filter would leave that group open instead of restoring the GM's folds.
    const fold = this._fold;
    const openAll = !!q || this._filter !== 'all' || pickedScenes.length > 0;
    if (!openAll && selKey != null && fold.get('\u0000sel') !== this._selectedId) { fold.set('\u0000sel', this._selectedId); fold.set(selKey, true); }
    this._openNow = rackFoldState(keys, { choices: fold, selectedKey: null, openAll });
    const groups = keys.map((k) => ({
      key: k, label: k, icon: g.icon, count: buckets.get(k).length,
      shut: !this._openNow.get(k)?.open,
      forced: this._openNow.get(k)?.forced || '',
      head: this._openNow.get(k)?.open ? null : rackHeadSummary(buckets.get(k)),
      rows: !this._openNow.get(k)?.open ? [] : buckets.get(k).map((t) => ({
        id: t.id, name: t.name, img: t.img, icon: t.icon, hasImg: t.hasImg, hueKey: t.hueKey, presetLabel: t.presetLabel,
        place: t.location || t.org || t.carriedBy && `Carried by ${t.carriedBy}` || 'No location',
        // A real place wears its name hue as a tag pill; "No location" stays a dim word.
        placeReal: !!(t.location || t.org || t.carriedBy),
        placeIcon: t.location ? 'fa-location-dot' : (t.org ? 'fa-building' : (t.carriedBy ? 'fa-hand-holding' : 'fa-location-dot')),
        acctLabel: `${t.accountCount} account${t.accountCount === 1 ? '' : 's'}`,
        leds: t.leds, heatBars: t.heatBars, heatTone: t.heatTone, maxHeat: t.maxHeat, traceTag: t.traceTag, traceTip: t.traceTip,
        loginCount: t.loginCount, attention: t.attention, gmBypassed: t.gmBypassed, locked: t.locked,
        accountCount: t.accountCount,
        // Row edge: red when someone is locked out / a trace is closing in, amber for anything else that needs the GM.
        tone: t.lockoutCount ? 'bad' : (t.attention ? 'attn' : ''),
        isSelected: t.id === this._selectedId, picked: this._picked.has(t.id),
      })),
    }));

    for (const gr of groups) for (const r of gr.rows) r.isSelected = r.id === this._selectedId;
    const selected = all.find((t) => t.id === this._selectedId) || null;
    if (selected) this._buildDetail(selected);
    // Drop picks that are no longer terminals.
    for (const id of [...this._picked]) if (!all.some((t) => t.id === id)) this._picked.delete(id);

    const counts = Object.fromEntries(FILTERS.map(([k, , f]) => [k, all.filter((t) => f(t, here)).length]));
    // The legend above the rack: how many machines each light is on for.
    const legend = {
      in: all.filter((t) => t.loginCount).length,
      out: all.filter((t) => t.leds[1].cls).length,
      armed: all.filter((t) => t.armedCount).length,
      sealed: all.filter((t) => t.allSecured).length,
    };
    return {
      term2: {
        total: all.length,
        shown: list.length,
        accounts: all.reduce((n, t) => n + t.accountCount, 0),
        logins: all.reduce((n, t) => n + t.loginCount, 0),
        attention: counts.attention,
        locked: counts.locked,
        search: this._search,
        filters: FILTERS.map(([k, label]) => ({ key: k, label, count: counts[k], on: k === this._filter, warn: k === 'attention', hot: k === 'attention' && counts[k] > 0 })),
        groupOptions: Object.entries(GROUPS).map(([k, v]) => ({ value: k, label: v.label, icon: v.icon, selected: k === this._group })),
        sortOptions: SORTS.map(([k, label, icon]) => ({ value: k, label, icon, selected: k === this._sort })),
        // The View button summarises both picks: "By location · Name".
        viewLabel: `${this._group === 'none' ? 'No groups' : `By ${(GROUPS[this._group] || GROUPS.location).label.toLowerCase()}`} · ${(SORTS.find((x) => x[0] === this._sort) || SORTS[0])[1]}`,
        viewOpen: this._viewOpen && !this._bulk,
        groups,
        legend,
        scenePicker: sceneItems.length ? ScopePicker.html(pid, { noun: 'scene', nouns: 'scenes', icon: 'fa-map', multi: true, items: sceneItems, countLabel: 'terminals', allLabel: 'Any scene', label: 'Pinned on' }) : '',
        sel: selected ? { ...selected, menuOpen: this._menuOpen } : null,
        menuOpen: this._menuOpen && !!selected,
        bulk: this._bulk,
        pickedCount: this._picked.size,
        isPopout: this.isPopout,
        hereName: here ? (game.scenes?.get?.(here)?.name || '') : '',
      },
    };
  }

  onRender() {
    const el = this.app.element;
    const root = el?.querySelector?.('.ncm-term2');
    if (!root) return;
    this._wireNewMenu(root);
    this._growOpened(root);
    // Accounts table: a row click expands its facts in place (DOM-only — a re-render would
    // lose nothing, but it would also kill the scroll position); kept per account.
    root.querySelectorAll('[data-acct-row]').forEach((rowEl) => {
      if (rowEl.dataset.wired) return;
      rowEl.dataset.wired = '1';
      const toggle = () => {
        const key = rowEl.dataset.acctRow;
        const open = !rowEl.classList.contains('is-open');
        rowEl.classList.toggle('is-open', open);
        rowEl.closest('.ncm-term2-acc')?.classList.toggle('is-open', open);
        rowEl.setAttribute('aria-expanded', open ? 'true' : 'false');
        const facts = root.querySelector(`[data-acct-facts="${CSS.escape(key)}"]`);
        if (facts) facts.hidden = !open;
        this._acctOpen.set(key, open);
      };
      rowEl.addEventListener('click', (ev) => { if (!ev.target.closest('a, button, [data-action]')) toggle(); });
      rowEl.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === rowEl) { ev.preventDefault(); toggle(); } });
    });
    const search = root.querySelector('[data-term2-search]');
    if (search && !search.dataset.wired) {
      search.dataset.wired = '1';
      search.addEventListener('input', foundry.utils.debounce((e) => {
        this._search = e.target.value;
        // The render replaces the input — put the caret back where it was.
        this._refocusSearch = document.activeElement === e.target ? (e.target.selectionStart ?? e.target.value.length) : false;
        this.app.render(false);
      }, 200));
      if (this._refocusSearch !== false && this._refocusSearch != null) {
        const n = this._refocusSearch === true ? search.value.length : Math.min(this._refocusSearch, search.value.length);
        this._refocusSearch = false;
        search.focus();
        try { search.setSelectionRange(n, n); } catch { /* */ }
      }
    }
    this._mountViewMenu(root);
    // Restore the two scrollers; bring a newly-opened row into view.
    const list = root.querySelector('.ncm-term2-list');
    const det = root.querySelector('.ncm-term2-det');
    const m = this._scrollMemo;
    if (m) {
      if (list) list.scrollTop = m.list;
      if (det && m.sel === det.dataset.sel) det.scrollTop = m.det;
    }
    if (this._scrollToSel && list) {
      this._scrollToSel = false;
      list.querySelector('.ncm-term2-ru.is-sel')?.scrollIntoView?.({ block: 'center' });
    }
    if (this._menuOpen) this._armMenuListener();
    try { ScopePicker.after(); } catch { /* picker absent */ }
    this._armLiveClock(root);
    if (!this._reportHook && globalThis.Hooks?.on) {
      // A player's client reported a miss / an earned lockout — repaint the open tab.
      this._reportHook = Hooks.on('ncmSecurityReport', () => {
        if (this.app?._activeTab !== 'terminals' || !this.app?.rendered) return;
        clearTimeout(this._reportTimer);
        this._reportTimer = setTimeout(() => this.app.render(false), 250);
      });
    }
  }

  onClose() {
    this._closeView(false);
    this._closeMenu(false);
    this._stopLiveClock();
    if (this._newCloser) { document.removeEventListener('pointerdown', this._newCloser, true); document.removeEventListener('keydown', this._newCloser); this._newCloser = null; }
    if (this._reportHook != null) { try { Hooks.off('ncmSecurityReport', this._reportHook); } catch { /* */ } this._reportHook = null; }
    clearTimeout(this._reportTimer);
  }

  /**
   * One 1s interval while a lockout countdown is on screen AND this tab is the
   * active one; it stops itself the moment either stops being true. When a
   * countdown reaches zero the tab re-renders once (the row becomes "tried"/"fresh").
   */
  _armLiveClock(root) {
    if (!root?.querySelector?.('[data-lock-until]')) { this._stopLiveClock(); return; }
    if (this._liveClock) return;
    this._liveClock = setInterval(() => {
      const el = this.app?.element?.querySelector?.('.ncm-term2');
      const clocks = el?.querySelectorAll?.('[data-lock-until]') || [];
      if (this.app?._activeTab !== 'terminals' || !el || !clocks.length) { this._stopLiveClock(); return; }
      const now = this._nowMs();
      let expired = false;
      for (const c of clocks) {
        const left = Number(c.dataset.lockUntil) - now;
        if (left <= 0) expired = true;
        c.textContent = this._left(left);
      }
      if (expired) { this._stopLiveClock(); this.app.render(false); }
    }, 1000);
  }

  _stopLiveClock() {
    if (this._liveClock) clearInterval(this._liveClock);
    this._liveClock = null;
  }

  /** The ⋯ menu closes on any pointer-down outside it. */
  _armMenuListener() {
    if (this._menuListener) return;
    this._menuListener = (ev) => {
      if (ev.target?.closest?.('.ncm-term2-more, [data-op="more"]')) return;
      this._closeMenu();
    };
    document.addEventListener('pointerdown', this._menuListener, true);
  }

  _closeMenu(render = true) {
    if (this._menuListener) document.removeEventListener('pointerdown', this._menuListener, true);
    this._menuListener = null;
    if (!this._menuOpen) return;
    this._menuOpen = false;
    const menu = this.app.element?.querySelector?.('.ncm-term2-more');
    if (menu) menu.classList.remove('is-open');
    else if (render) this.app.render(false);
  }

  // ── The View menu (Group by · Sort) ──
  // The template renders the menu inside the tab; onRender moves it to document.body
  // (a portal — the panel's overflow and zoom never clip it) and places it under its
  // button. One live node per window (keyed by the app id, so a pop-out keeps its own).
  // An outside pointer-down or Esc closes it; a pick re-renders with the new grouping.

  _viewKey() { return String(this.app?.id || 'ncm-admin'); }

  _toggleView() {
    this._viewOpen = !this._viewOpen;
    this._menuOpen = false;
    this.app.render(false);
  }

  _closeView(render = true) {
    if (this._viewListener) {
      document.removeEventListener('pointerdown', this._viewListener, true);
      document.removeEventListener('keydown', this._viewListener, true);
    }
    this._viewListener = null;
    document.querySelectorAll?.(`.ncm-term2-viewpop[data-view-owner="${CSS.escape(this._viewKey())}"]`)?.forEach((n) => n.remove());
    if (!this._viewOpen) return;
    this._viewOpen = false;
    const btn = this.app.element?.querySelector?.('[data-term2-viewbtn]');
    if (btn) { btn.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); }
    else if (render) this.app.render(false);
  }

  /** Pick a grouping or an order from the menu. */
  _pickView(kind, value) {
    if (kind === 'group' && GROUPS[value]) this._group = value;   // each grouping keeps its own fold memory
    else if (kind === 'sort' && SORTS.some((x) => x[0] === value)) this._sort = value;
    else return;
    this._viewOpen = false;
    this.app.render(false);
  }

  _mountViewMenu(root) {
    // The node from the previous render (already on body) is stale — drop it.
    document.querySelectorAll?.(`.ncm-term2-viewpop[data-view-owner="${CSS.escape(this._viewKey())}"]`)?.forEach((n) => { if (!root.contains(n)) n.remove(); });
    const pop = root.querySelector('[data-term2-viewpop]');
    const btn = root.querySelector('[data-term2-viewbtn]');
    if (!pop) return;
    if (!this._viewOpen || !btn) {
      pop.remove();
      if (this._viewListener) { document.removeEventListener('pointerdown', this._viewListener, true); document.removeEventListener('keydown', this._viewListener, true); this._viewListener = null; }
      return;
    }
    pop.dataset.viewOwner = this._viewKey();
    pop.classList.add('ncm-app', 'is-portal');
    const theme = this.app.element?.closest?.('[data-ncm-admin-theme]')?.dataset?.ncmAdminTheme
      || this.app.element?.dataset?.ncmAdminTheme || 'clean-dark';
    pop.dataset.ncmAdminTheme = theme;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth || 240;
    pop.style.top = `${Math.round(r.bottom + 4)}px`;
    pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
    pop.querySelectorAll('[data-view-kind]').forEach((b) => b.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      this._pickView(b.dataset.viewKind, b.dataset.viewValue);
    }));
    if (!this._viewListener) {
      this._viewListener = (ev) => {
        if (ev.type === 'keydown') { if (ev.key === 'Escape') { ev.stopPropagation(); this._closeView(); } return; }
        if (ev.target?.closest?.('.ncm-term2-viewpop, [data-term2-viewbtn]')) return;
        this._closeView();
      };
      document.addEventListener('pointerdown', this._viewListener, true);
      document.addEventListener('keydown', this._viewListener, true);
    }
    pop.querySelector('.is-on')?.focus?.({ preventScroll: true });
  }

  /** Open on one terminal (game.nightcity.openAdminTab('terminals', {select: itemId}) / Pop out). */
  openTo(select) {
    if (!select) return;
    const id = String(select).split('.').pop();
    this._selectedId = id;
    this._filter = 'all';
    this._search = '';
    this._scrollToSel = true;   // a new selection opens its group once; other folds keep the GM's choices
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — one generic entry (data-op)
  // ═══════════════════════════════════════════════════════════

  onAct(op, event, target) {
    switch (op) {
      case 'select': return this.onSelect(event, target);
      case 'filter': return this.onFilter(event, target);
      case 'group': return this._toggleGroup(target);
      case 'clearSearch': this._search = ''; this._refocusSearch = true; return this.app.render(false);
      case 'more': return this._toggleMenu();
      case 'view': return this._toggleView();
      case 'bulk': return this._toggleBulk();
      case 'pickAll': return this._pickAllShown();
      case 'open': this._closeMenu(false); return this.onOpen(event, target);
      case 'configure': this._closeMenu(false); return this.onConfigure(event, target);
      case 'access': { this._closeMenu(false); const it = this.app.constructor._findItem(target.dataset.itemId); return it && showAccessMenu(it, target); }
      case 'unlock': this._closeMenu(false); return this.onForceUnlock(event, target);
      case 'reset': this._closeMenu(false); return this.onRelock(event, target);
      case 'export': this._closeMenu(false); return this.onExport(event, target);
      case 'place': this._closeMenu(false); return this.onPlace(event, target);
      case 'remove': this._closeMenu(false); return this.onRemove(event, target);
      case 'import': this._closeNew(); return this.onImport(event, target);
      case 'newBlank': this._closeNew(); return this.onNewBlank();
      case 'importJson': this._closeNew(); return this.onImportJson();
      case 'bulkReset': return this.onBulkReset();
      case 'bulkExport': return this.onBulkExport();
      case 'bulkRemove': return this.onBulkRemove();
      case 'security': return this._goSecurity();
      case 'acctLogout': return this.onAcctLogout(event, target);
      case 'acctClear': return this.onAcctClear(event, target);
      case 'acctReset': return this.onAcctClear(event, target);
      case 'editLock': return this.onEditLock(event, target);
      case 'acctResetAll': return this.onAcctResetAll(event, target);
      case 'defuse': return this.onDefuse(event, target);
      // Heat and trace live on the Security tab — reuse its handlers (same data attributes).
      case 'heatClear': return this.app.tabs?.security?.onHeatClear?.(event, target);
      case 'escalate': return this.app.tabs?.security?.onEscalate?.(event, target);
      case 'callOff': return this.app.tabs?.security?.onCountdownCancel?.(event, target);
      default: return undefined;
    }
  }

  _resolve(target) {
    const id = target?.dataset?.itemId || target?.closest?.('[data-item-id]')?.dataset.itemId || this._selectedId;
    if (!id) return null;
    return (this.terminalService?.collectTerminals?.() ?? []).find((it) => it.id === id) || null;
  }

  _items(ids) {
    const all = this.terminalService?.collectTerminals?.() ?? [];
    return [...ids].map((id) => all.find((it) => it.id === id)).filter(Boolean);
  }

  onSelect(event, target) {
    const id = target?.closest?.('[data-item-id]')?.dataset.itemId;
    if (!id) return;
    if (this._bulk) {
      if (this._picked.has(id)) this._picked.delete(id); else this._picked.add(id);
      return this.app.render(false);
    }
    if (id === this._selectedId) return;
    this._selectedId = id;
    this._menuOpen = false;
    this.app.render(false);
  }

  onFilter(event, target) {
    const f = target?.closest?.('[data-filter]')?.dataset.filter;
    if (!f || f === this._filter || !FILTERS.some((x) => x[0] === f)) return;
    this._filter = f;
    this.app.render(false);
  }

  /** Legacy pager action (terminalPageAdmin) — the list no longer pages. */
  onPage() { this.app.render(false); }

  async _toggleGroup(target) {
    const head = target?.closest?.('[data-group-key]');
    const k = head?.dataset.groupKey;
    if (k == null) return;
    const now = this._openNow.get(k) || { open: false, forced: '' };
    // A forced-open group (a search or filter is on) cannot close; its head says why.
    if (now.forced) return;
    // The rack is only in the DOM while open, so the fold animates on the LIVE node:
    // closing shrinks it before the re-render; opening grows the new one after it (onRender).
    const rack = head.nextElementSibling?.classList.contains('ncm-term2-rack') ? head.nextElementSibling : null;
    if (now.open && rack && !TerminalsTab._reducedMotion()) {
      head.classList.add('is-shut');
      await rack.animate([{ height: `${rack.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0, marginTop: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px' }],
        { duration: 180, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }).finished.catch(() => {});
    }
    if (!now.open) this._growKey = k;
    this._fold.set(k, !now.open);
    this.app.render(false);
  }

  /** @private Grow a just-opened rack from nothing (the fold's other half). */
  _growOpened(root) {
    const k = this._growKey;
    this._growKey = null;
    if (k == null || TerminalsTab._reducedMotion()) return;
    const head = [...root.querySelectorAll('[data-group-key]')].find(h => h.dataset.groupKey === k);
    const rack = head?.nextElementSibling?.classList.contains('ncm-term2-rack') ? head.nextElementSibling : null;
    if (!rack) return;
    const h = rack.offsetHeight;
    rack.animate([{ height: '0px', opacity: 0, overflow: 'hidden' }, { height: `${h}px`, opacity: 1, overflow: 'hidden' }], { duration: 200, easing: 'cubic-bezier(.22,1,.36,1)' });
  }

  static _reducedMotion() {
    try { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true; } catch { /* */ }
    try { return game.nightcity?.themeService?.getAnimationLevel?.() === 'none'; } catch { return false; }
  }

  _toggleMenu() {
    this._menuOpen = !this._menuOpen;
    const menu = this.app.element?.querySelector?.('.ncm-term2-more');
    if (menu) {
      menu.classList.toggle('is-open', this._menuOpen);
      if (this._menuOpen) this._armMenuListener();
      if (!this._menuOpen) this._closeMenu(false);
    } else this.app.render(false);
  }

  _toggleBulk() {
    this._bulk = !this._bulk;
    this._viewOpen = false;
    if (!this._bulk) this._picked.clear();
    this._menuOpen = false;
    this.app.render(false);
  }

  /** Tick every terminal the filters currently show. */
  _pickAllShown() {
    const rows = this.app.element?.querySelectorAll?.('.ncm-term2-ru[data-item-id]') || [];
    const ids = [...rows].map((r) => r.dataset.itemId);
    const allOn = ids.length && ids.every((id) => this._picked.has(id));
    for (const id of ids) { if (allOn) this._picked.delete(id); else this._picked.add(id); }
    this.app.render(false);
  }

  _goSecurity() {
    if (this.isPopout) return game.nightcity?.openAdminTab?.('security');
    this.app._activeTab = 'security';
    this.app.render(true);
  }

  onOpen(event, target) {
    const item = this._resolve(target);
    if (item) game.nightcity?.openTerminal?.(item);
  }

  async onConfigure(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
  }

  async onForceUnlock(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    await this.terminalService.forceUnlock(item);
    this.app.render(false);
  }

  /** Reset = relock: log everyone out, clear lockouts + GM bypass, uplink → default. */
  async onRelock(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const ok = await adminConfirm({
      title: 'Reset Terminal',
      content: `<p>Reset <strong>${esc(item.name)}</strong>? Everyone is logged out; lockouts, GM bypass, and the machine's uplink return to defaults. Config, accounts, and messages are untouched.</p>`,
    });
    if (!ok) return;
    await this.terminalService.relock(item);
    ui.notifications.info(`"${item.name}" reset — all sessions cleared.`);
    this.app.render(false);
  }

  _download(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Export the terminal's full config as JSON (the config-sheet envelope). */
  onExport(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const cfg = this.terminalService.getConfig(item);
    const payload = { ncmTerminal: 1, name: item.name, exportedAt: new Date().toISOString(), config: cfg };
    this._download(payload, `ncm-terminal-${slug(item.name)}.json`);
    ui.notifications.info(`Exported "${item.name}" config.`);
  }

  /** Drop an access pin for this terminal at the centre of the GM's view. */
  async onPlace(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const pins = game.nightcity?.terminalScenePins;
    if (!pins?.placeAtViewCenter) return ui.notifications.warn('Scene pins are not available.');
    await pins.placeAtViewCenter(item);
    this.app.render(false);
  }

  async onRemove(event, target) {
    const item = this._resolve(target);
    if (!item) return;
    const ok = await adminConfirm({ title: 'Remove Terminal Data', content: `<p>Revert <strong>${esc(item.name)}</strong> to a plain item? Accounts/config are lost (the message journal is kept).</p>` });
    if (!ok) return;
    await this.terminalService.removeTerminal(item);
    this.app.render(false);
  }

  // ── Account status in play ──

  /** {item, account, actorId, key} from a party row's button. */
  _partyTarget(target) {
    const el = target?.closest?.('[data-actor-id]') || target;
    const actorId = el?.dataset?.actorId;
    const accountId = el?.dataset?.accountId || target?.closest?.('[data-account-id]')?.dataset?.accountId;
    const item = this._resolve(target);
    if (!item || !actorId || !accountId) return null;
    const account = (this.terminalService.getConfig(item).accounts || []).find((a) => a.id === accountId) || null;
    return { item, account, accountId, actorId, key: `${item.id}::${accountId}`, actor: game.actors?.get(actorId) || null };
  }

  /** Log a character out of one account: end the stored session, bounce their open viewer. */
  async onAcctLogout(event, target) {
    const t = this._partyTarget(target);
    if (!t) return;
    try { await this.terminalService.logout(t.item, t.actorId, true); } catch (e) { console.error('NCM | admin logout', e); }
    game.nightcity?.securityService?.kickSession?.(t.actorId, [t.key], 'LOGGED OUT BY THE SYSTEM ADMINISTRATOR.');
    ui.notifications.info(`${t.actor?.name || 'They'} logged out of ${t.account?.username || 'the account'}.`);
    this.app.render(false);
  }

  /**
   * Clear lockout / Reset tries: clears this character's tries and lockout on the
   * account here AND on their client (SECURITY_CLEAR), and writes a
   * 'lockout-clear' row so the Security log's count starts again from here.
   */
  async onAcctClear(event, target) {
    const t = this._partyTarget(target);
    if (!t) return;
    await this._clearOne(t);
    ui.notifications.info(`${t.actor?.name || 'They'} can try ${t.account?.username || 'the account'} again.`);
    this.app.render(false);
  }

  /** "Reset tries" on an account row: clears every character who used tries or is locked out there. */
  async onAcctResetAll(event, target) {
    const el = target?.closest?.('[data-actor-ids]') || target;
    const ids = String(el?.dataset?.actorIds || '').split(',').filter(Boolean);
    const accountId = el?.dataset?.accountId || target?.closest?.('[data-account-id]')?.dataset?.accountId;
    const item = this._resolve(target);
    if (!item || !accountId || !ids.length) return;
    const account = (this.terminalService.getConfig(item).accounts || []).find((a) => a.id === accountId) || null;
    for (const actorId of ids) await this._clearOne({ item, account, accountId, actorId, key: `${item.id}::${accountId}`, actor: game.actors?.get(actorId) || null });
    ui.notifications.info(`Tries reset on ${account?.username || 'the account'}.`);
    this.app.render(false);
  }

  /** Defuse an armed plant (the Security tab's write, but it also reaches a carried terminal). */
  async onDefuse(event, target) {
    const item = this._resolve(target);
    const residentId = target?.closest?.('[data-resident-id]')?.dataset?.residentId;
    if (!item || !residentId) return;
    await this.terminalService?.updateResident?.(item, residentId, { state: 'defused' });
    this.app.render(false);
  }

  async _clearOne(t) {
    game.nightcity?.securityService?.clearFor?.(t.actorId, [t.key]);
    const trace = game.nightcity?.traceService;
    const name = this.terminalService.getConfig(t.item).terminalName || t.item.name;
    try {
      const payload = trace?._payload?.({ actor: t.actor, action: 'lockout-clear', objectId: t.item.id, objectName: `${name} · ${t.account?.displayName || t.account?.username || 'account'}`, targetNetworkId: t.key, source: 'GM cleared tries', severity: 'minor', outcome: 'success' });
      if (payload) await trace.recordTrace(payload);
    } catch (e) { console.error('NCM | clear log', e); }
  }

  /** "edit the lock" → Configure Terminal, open on that account's editor. */
  async onEditLock(event, target) {
    const item = this._resolve(target);
    const accountId = target?.closest?.('[data-account-id]')?.dataset?.accountId;
    if (!item) return;
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    const cfgApp = new TerminalConfigApp({ item });
    if (accountId) { cfgApp._editingAccountId = accountId; cfgApp._activeTab = 'accounts'; cfgApp._scrollReset = true; }
    cfgApp.render(true);
  }

  // ── Select mode ──

  async onBulkReset() {
    const items = this._items(this._picked);
    if (!items.length) return ui.notifications.warn('Tick some terminals first.');
    const ok = await adminConfirm({ title: 'Reset Terminals', content: `<p>Reset <strong>${items.length}</strong> terminal${items.length === 1 ? '' : 's'}? Everyone is logged out; lockouts, GM bypass and uplinks return to defaults. Config, accounts and messages are untouched.</p>` });
    if (!ok) return;
    for (const it of items) { try { await this.terminalService.relock(it); } catch (e) { console.error('NCM | bulk reset', e); } }
    ui.notifications.info(`Reset ${items.length} terminal${items.length === 1 ? '' : 's'}.`);
    this.app.render(false);
  }

  onBulkExport() {
    const items = this._items(this._picked);
    if (!items.length) return ui.notifications.warn('Tick some terminals first.');
    const payload = {
      ncmTerminals: 1, exportedAt: new Date().toISOString(),
      terminals: items.map((it) => ({ ncmTerminal: 1, name: it.name, config: this.terminalService.getConfig(it) })),
    };
    this._download(payload, `ncm-terminals-${items.length}.json`);
    ui.notifications.info(`Exported ${items.length} terminal${items.length === 1 ? '' : 's'}.`);
  }

  async onBulkRemove() {
    const items = this._items(this._picked);
    if (!items.length) return ui.notifications.warn('Tick some terminals first.');
    const ok = await adminConfirm({ title: 'Remove Terminal Data', content: `<p>Revert <strong>${items.length}</strong> terminal${items.length === 1 ? '' : 's'} to plain items? Their accounts and config are lost (message journals are kept).</p><p>${items.map((i) => esc(i.name)).join(', ')}</p>` });
    if (!ok) return;
    for (const it of items) { try { await this.terminalService.removeTerminal(it); } catch (e) { console.error('NCM | bulk remove', e); } }
    this._picked.clear();
    this.app.render(false);
  }

  /** Import Item → Terminal: pick a non-converted item, convert, open config. */
  async onImport() {
    const svc = this.terminalService;
    const candidates = game.items.filter(i =>
      !i.getFlag(MODULE_ID, 'isTerminal') && !i.getFlag(MODULE_ID, 'isDataShard'));
    if (!candidates.length) return ui.notifications.warn('No eligible world items to convert.');
    const pick = await showNamePicker({
      title: 'Import Item → Terminal',
      hint: 'Convert which world item into a Terminal?',
      entries: documentEntries(candidates, { note: (i) => i.type }),
      placeholder: 'search items or folders…',
    });
    if (!pick?.id) return;
    const item = game.items.get(pick.id);
    if (!item) return;
    const res = await svc.convertToTerminal(item);
    if (!res?.success) return ui.notifications.error(res?.error || 'Conversion failed.');
    ui.notifications.info(`"${item.name}" is now a Terminal.`);
    this._selectedId = item.id;
    this._filter = 'all';
    this._scrollToSel = true;
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
    this.app.render(false);
  }

  // ── + New ▾ (the Shards tab's New menu, for terminals: no presets) ──

  _closeNew() {
    const box = this.app.element?.querySelector('[data-term2-new]');
    box?.classList.remove('is-open');
    box?.querySelector('[data-term2-newbtn]')?.setAttribute('aria-expanded', 'false');
  }

  /** Wire the New ▾ button: click toggles, an outside click or Esc closes (DOM-only). */
  _wireNewMenu(root) {
    const box = root.querySelector('[data-term2-new]');
    const btn = box?.querySelector('[data-term2-newbtn]');
    if (!btn) return;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      const open = !box.classList.contains('is-open');
      box.classList.toggle('is-open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (!this._newCloser) {
      this._newCloser = (ev) => {
        const b = this.app.element?.querySelector('[data-term2-new].is-open');
        if (!b) return;
        if (ev.type === 'keydown' ? ev.key === 'Escape' : !b.contains(ev.target)) this._closeNew();
      };
      document.addEventListener('pointerdown', this._newCloser, true);
      document.addEventListener('keydown', this._newCloser);
    }
  }

  /** A fresh world item, converted, its config opened — the Shards tab's "Blank shard". */
  async onNewBlank() {
    const types = (game.documentTypes?.Item || game.system?.documentTypes?.Item || []).filter(t => t !== 'base');
    const type = types.includes('gear') ? 'gear' : (types[0] || 'gear');
    const existing = (game.items?.contents ?? []).filter(i => /^New Terminal/.test(i.name)).length;
    const name = existing ? `New Terminal ${existing + 1}` : 'New Terminal';
    let item = null;
    try { item = await Item.create({ name, type, img: 'icons/svg/computer.svg' }); }
    catch (err) { log.warn(`Blank terminal: Item.create failed — ${err?.message || err}`); }
    if (!item) return ui.notifications.error('NCM | Could not create the item.');
    const res = await this.terminalService.convertToTerminal(item);
    if (!res?.success) return ui.notifications.error(res?.error || 'Conversion failed.');
    ui.notifications.info(`NCM | Created "${item.name}" — configure it now.`);
    this._selectedId = item.id; this._filter = 'all'; this._scrollToSel = true;
    const { TerminalConfigApp } = await import('../../Terminal/TerminalConfigApp.js');
    new TerminalConfigApp({ item }).render(true);
    this.app.render(false);
  }

  /** What Export writes — one terminal ({ncmTerminal}) or several ({ncmTerminals}) — back into new world items. */
  static parseTerminalImport(text) {
    let data;
    try { data = JSON.parse(text); } catch { return { error: 'That file is not JSON.' }; }
    const list = Array.isArray(data?.terminals) ? data.terminals : (Array.isArray(data) ? data : [data]);
    const terminals = list.filter(t => t && typeof t === 'object' && t.config && typeof t.config === 'object')
      .map(t => ({ name: String(t.name || t.config?.metadata?.name || 'Imported terminal').slice(0, 120), config: t.config }));
    if (!terminals.length) return { error: 'No terminals in that file — it should come from Terminals → Export.' };
    return { terminals };
  }

  async onImportJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const { terminals, error } = TerminalsTab.parseTerminalImport(await file.text());
      if (error) return ui.notifications.warn(`NCM | ${error}`);
      const ok = await adminConfirm({ title: 'Import Terminals', content: `<p>Create <strong>${terminals.length}</strong> new terminal${terminals.length > 1 ? 's' : ''} from that file? Nothing existing is changed; sessions and lockouts start fresh.</p>` });
      if (!ok) return;
      const types = (game.documentTypes?.Item || game.system?.documentTypes?.Item || []).filter(t => t !== 'base');
      const type = types.includes('gear') ? 'gear' : (types[0] || 'gear');
      let created = 0, failed = 0, last = null;
      for (const t of terminals) {
        try {
          const item = await Item.create({ name: t.name, type, img: 'icons/svg/computer.svg' });
          const res = item ? await this.terminalService.convertToTerminal(item, foundry.utils.deepClone(t.config)) : null;
          if (res?.success) { created++; last = item.id; } else failed++;
        } catch (err) { failed++; log.warn(`Terminal import failed: ${err?.message || err}`); }
      }
      ui.notifications.info(`NCM | Imported ${created} terminal${created !== 1 ? 's' : ''}${failed ? ` · ${failed} failed` : ''}.`);
      if (last) { this._selectedId = last; this._filter = 'all'; this._scrollToSel = true; }
      ui.items?.render();
      this.app.render(false);
    });
    input.click();
  }
}
