/**
 * Account status in play — what is true RIGHT NOW for each player character on
 * one terminal account (Admin → Terminals → detail → Accounts; dev-approved mock
 * dev/mockups/admin-guides-v4-mock.html, slot "acc").
 *
 * PURE: no Foundry globals. TerminalsTab gathers the facts (sessions, the login
 * footprint log, the Security log, SecurityService's known state, the network
 * visibility rules) and this module decides the one state per row:
 *
 *   in      — logged in now (since when)                     → Log out
 *   locked  — locked out, live countdown + the reason        → Clear lockout
 *   cant    — can't see this account, and why                → (none)
 *   tried   — missed at least once, tries left as squares    → Reset tries
 *   fresh   — hasn't tried                                   → (none)
 */

/** Security-log actions that are a login attempt on a terminal account. */
export const LOGIN_ACTIONS = new Set(['net-auth', 'net-hack', 'terminal-login']);
/** The GM's "Clear lockout / Reset tries" writes this row. */
export const CLEAR_ACTION = 'lockout-clear';

const tsOf = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
};

/**
 * Does this Security-log row concern this account? The method-card auth dialog
 * stamps the lockout key (`termId::acctId`) as `targetNetworkId`; the terminal's
 * quick-entry console writes `objectId` = the terminal + "<terminal> · <account>".
 */
export function rowIsForAccount(row, { itemId, accountId, accountNames = [] }) {
  if (!row) return false;
  const key = `${itemId}::${accountId}`;
  if (row.targetNetworkId === key) return true;
  if (row.action === 'terminal-login' && row.objectId === itemId) {
    const name = String(row.objectName || '');
    return accountNames.filter(Boolean).some((n) => name.endsWith(`· ${n}`));
  }
  return false;
}

/**
 * Failed tries since the last success / GM clear, replaying the lockout the way
 * SecurityService does: the max-th miss locks for `lockoutMs`; once that passes
 * the counter is back to zero. This is the GM's view after a reload (the live
 * state is client-local and gone), so it only ever ADDS to what is known.
 * @param {object} o
 * @param {Array} o.log Security log rows (TraceService traceLog)
 * @param {Array} o.logins login footprints [{ts, accountId, operatorId}]
 * @returns {{ used: number, lockUntil: number|null, lastFail: number|null }}
 */
export function triesFromLog({ log = [], logins = [], itemId, accountId, accountNames = [], actorId, maxAttempts = 3, lockoutMs = 3600000, now = Date.now() }) {
  const key = `${itemId}::${accountId}`;
  const ev = [];
  for (const r of log) {
    if (!r || r.actorId !== actorId) continue;
    const t = tsOf(r.ts);
    if (!Number.isFinite(t)) continue;
    if (r.action === CLEAR_ACTION && r.targetNetworkId === key) { ev.push({ t, k: 'reset' }); continue; }
    if (!LOGIN_ACTIONS.has(r.action) || !rowIsForAccount(r, { itemId, accountId, accountNames })) continue;
    ev.push({ t, k: r.outcome === 'success' ? 'reset' : 'fail' });
  }
  for (const l of logins) {
    if (l?.operatorId !== actorId || l?.accountId !== accountId) continue;
    const t = tsOf(l.ts);
    if (Number.isFinite(t)) ev.push({ t, k: 'reset' });
  }
  // Stable sort by time: log rows keep their append order (a paused game clock
  // stamps everything with the same time), and a login at the same instant as
  // misses lands after them — you miss, then you get in.
  ev.sort((a, b) => a.t - b.t);
  const max = Math.max(1, Number(maxAttempts) || 3);
  let used = 0;
  let lockUntil = null;
  let lastFail = null;
  for (const e of ev) {
    if (lockUntil != null && e.t >= lockUntil) { used = 0; lockUntil = null; }
    if (e.k === 'reset') { used = 0; lockUntil = null; continue; }
    if (lockUntil != null) continue; // a try while locked never reached the box
    used += 1;
    lastFail = e.t;
    if (used >= max) lockUntil = e.t + Math.max(0, Number(lockoutMs) || 0);
  }
  if (lockUntil != null && now >= lockUntil) { used = 0; lockUntil = null; }
  return { used, lockUntil, lastFail };
}

/** "42:07" / "1:02:07" — a countdown from ms. */
export function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * The one state for a character on an account.
 * @param {object} f
 * @param {boolean} f.loggedIn          an active session on this account
 * @param {string}  [f.since]           "21:04" for the logged-in line
 * @param {object|null} f.known         SecurityService.getKnownState(...)
 * @param {{used:number, lockUntil:number|null}} f.derived  triesFromLog(...)
 * @param {string}  [f.blocked]         why they can't see the account ('' = they can)
 * @param {number}  f.maxAttempts
 * @param {number}  f.now               game-clock ms
 */
export function partyRowState(f) {
  const max = Math.max(1, Number(f.maxAttempts) || 3);
  const now = Number(f.now) || 0;
  if (f.loggedIn) return { state: 'in', since: f.since || '', action: 'acctLogout', actionLabel: 'Log out' };

  const known = f.known || null;
  const derived = f.derived || { used: 0, lockUntil: null };
  let lockUntil = known?.lockoutUntil || null;
  let forced = !!known?.forced;
  let reason = known?.reason || '';
  if (!lockUntil && derived.lockUntil && derived.lockUntil > now) { lockUntil = derived.lockUntil; forced = false; reason = ''; }
  if (lockUntil && lockUntil > now) {
    const why = forced ? (reason ? `forced — ${reason}` : 'forced by a trace') : `${max} failed tr${max === 1 ? 'y' : 'ies'}`;
    return { state: 'locked', lockUntil, remaining: lockUntil - now, clock: fmtCountdown(lockUntil - now), why, action: 'acctClear', actionLabel: 'Clear lockout' };
  }
  if (f.blocked) return { state: 'cant', why: f.blocked };

  const used = Math.min(max, Math.max(Number(known?.attempts) || 0, Number(derived.used) || 0));
  if (used > 0) {
    const left = max - used;
    return {
      state: 'tried', used, left, max,
      squares: Array.from({ length: max }, (_, i) => ({ gone: i >= left })),
      action: 'acctReset', actionLabel: 'Reset tries',
    };
  }
  return { state: 'fresh' };
}

/** Rows that need the GM sort first: locked, in, tried, can't, fresh. */
export const STATE_ORDER = { locked: 0, in: 1, tried: 2, cant: 3, fresh: 4 };

/**
 * "password or Interface DV 18" — the lock in a few words: { text, parts:[{t, conj}] }.
 * @param {object} sec SECURITY_BLOCK
 * @param {{name:string, dv:number}[]} rows bypassRowsOf(sec)
 */
export function lockInWords(sec = {}, rows = []) {
  if (!sec.requiresAuth) return { text: 'open — no login', parts: [{ t: 'open — no login' }] };
  const parts = [];
  if (sec.allowPassword ?? sec.password) parts.push('password');
  if (sec.allowSkillCheck) for (const r of rows) parts.push(`${r.name} DV ${r.dv}`);
  if (sec.allowKeyItem) parts.push(sec.keyItemName ? `the ${sec.keyItemName}` : 'a key item');
  if (!parts.length) return { text: 'sealed — no way in', parts: [{ t: 'sealed — no way in' }] };
  const join = sec.authLogic === 'all' ? ' and ' : ' or ';
  return { text: parts.join(join), parts: parts.map((t, i) => ({ t, conj: i < parts.length - 1 ? join.trim() : '' })) };
}
