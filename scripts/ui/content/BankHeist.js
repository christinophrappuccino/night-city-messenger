/**
 * BankHeist — the bespoke siphon FUI (design: "a hacker pulling funds from a bank")
 * @file scripts/ui/content/BankHeist.js
 * @module night-city-messenger
 * @description Replaces the generic SecurityConsole for the banking SIPHON: one
 *   cohesive cyberpunk heist sequence — pick the transfer amount, JACK IN (rolls
 *   the security check via SkillService.performCheck, posts the chat card), then
 *   the DRAIN animation (source account ticks down, the operator's wallet ticks
 *   up, a packet stream flows, progress fills) → TRANSFER COMPLETE / TRACE LOCKED.
 *
 *   Framework-free promise modal (NOT an Application), appended into `host` (the
 *   viewer element → inherits its --ncm-* preset; falls back to document.body).
 *   Resolves `{ ok, amount, total, cancelled }` — the same shape runSiphon read
 *   from the old console. Reduced-motion collapses to an instant verdict.
 */

import { log, resolveHackResolution } from '../../utils/helpers.js';
import { requestNetAdjudication, postNetActionCard, netadjDock } from './NetResolve.js';

const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/** Animate a numeric readout from → to over ms (rAF timestamps; no Date.now). */
function animateCount(node, from, to, ms, fmt) {
  return new Promise((res) => {
    if (!node || reduced() || ms <= 0) { if (node) node.textContent = fmt(to); return res(); }
    let t0 = null;
    const step = (t) => {
      if (t0 == null) t0 = t;
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = fmt(Math.round(from + (to - from) * eased));
      if (p < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}

/**
 * Run the siphon heist. Returns the player's outcome.
 * @param {object} opts
 * @param {HTMLElement} [opts.host]     viewer element (theme source)
 * @param {string} opts.bankName        letterhead name for the header
 * @param {string} opts.accountLabel    the account being drained
 * @param {string} [opts.currency='€$']
 * @param {number} opts.max             max siphonable amount
 * @param {number} opts.fromBalance     the account's current balance
 * @param {string} opts.skill           security-check skill
 * @param {number} opts.dv              base security DV
 * @param {boolean}[opts.dvScale]       DV scales with the transfer amount
 * @param {number} [opts.dvPer]         eddies per +1 DV (when dvScale)
 * @param {Actor}  opts.actor           the operator (roller)
 * @param {boolean}[opts.force]         GM force-transfer (no roll)
 * @param {Item}   [opts.hostItem]      the host terminal (per-box hackResolution override)
 * @returns {Promise<{ok:boolean, amount:number|null, total:number|null, dv:number|null, cancelled:boolean}>}
 */
export async function runBankHeist(opts = {}) {
  const {
    host = null, bankName = '', accountLabel = 'account', currency = '€$',
    max = 0, fromBalance = 0, skill = 'Interface', dv = 15, actor = null, force = false,
    dvScale = false, dvPer = 50000, hostItem = null,
  } = opts;
  const mount = host || document.body;
  const skillSvc = game.nightcity?.skillService;
  const sound = game.nightcity?.soundService;
  const cur = esc(currency);
  const fmtCur = (v) => v.toLocaleString();
  // Effective DV grows with greed: base + 1 per `dvPer` eddies transferred.
  const effDV = (amt) => (dvScale && dvPer > 0) ? (Number(dv) || 0) + Math.floor((Number(amt) || 0) / dvPer) : (Number(dv) || 0);

  const el = document.createElement('div');
  el.className = 'ncm-heist-backdrop';
  el.innerHTML = `
    <div class="ncm-heist" role="dialog" aria-modal="true">
      <span class="ncm-heist__corner tl"></span><span class="ncm-heist__corner tr"></span>
      <span class="ncm-heist__corner bl"></span><span class="ncm-heist__corner br"></span>
      <div class="ncm-heist__hex" aria-hidden="true"></div>
      <div class="ncm-heist__hd">SIPHON // ${esc(bankName || accountLabel)}<small data-sub>SECURE CHANNEL · SELECT TRANSFER AMOUNT</small></div>
      <div class="ncm-heist__body">
        <div class="ncm-heist__node ncm-heist__node--src">
          <div class="ncm-heist__ring"><i class="fas fa-building-columns"></i></div>
          <div class="ncm-heist__nlbl">SOURCE</div>
          <div class="ncm-heist__namt" data-src>${fmtCur(fromBalance)}</div>
        </div>
        <div class="ncm-heist__stream"><b></b><b></b><b></b><b></b><b></b></div>
        <div class="ncm-heist__node ncm-heist__node--dst">
          <div class="ncm-heist__ring"><i class="fas fa-wallet"></i></div>
          <div class="ncm-heist__nlbl">YOUR WALLET</div>
          <div class="ncm-heist__namt" data-dst>+0</div>
        </div>
      </div>
      <div class="ncm-heist__ctl" data-ctl>
        <label>Transfer amount</label>
        <div class="ncm-heist__ctlrow">
          <input type="range" min="1" max="${Number(max) || 1}" value="${Number(max) || 1}" step="1" data-range>
          <div class="ncm-heist__amtbox"><input type="number" min="1" max="${Number(max) || 1}" value="${Number(max) || 1}" step="1" data-num><span>${cur}</span></div>
        </div>
        <div class="ncm-heist__max">available ${fmtCur(Number(max) || 0)} ${cur}</div>
      </div>
      <div class="ncm-heist__bar" data-bar hidden><i></i></div>
      <div class="ncm-heist__verdict" data-verdict hidden></div>
      <div class="ncm-heist__status"><span data-status>${force ? 'GM OVERRIDE — NO ROLL' : `SECURITY: ${esc(skill)} vs DV <b data-dv>${effDV(Number(max) || 1)}</b>${dvScale ? ' · scales with amount' : ''} · a miss trips a TRACE`}</span></div>
      <div class="ncm-heist__actions" data-actions>
        <button type="button" class="ncm-heist__btn ncm-heist__btn--ghost" data-h="cancel"><i class="fas fa-plug-circle-xmark"></i> DISCONNECT</button>
        <button type="button" class="ncm-heist__btn ncm-heist__btn--go" data-h="go"><i class="fas fa-bolt"></i> ${force ? 'FORCE TRANSFER' : 'JACK IN'}</button>
      </div>
    </div>`;
  mount.appendChild(el);
  // Hex noise decoration.
  const hex = el.querySelector('.ncm-heist__hex');
  if (hex) hex.textContent = Array.from({ length: 6 }, () => Array.from({ length: 8 }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, '0')).join(' ')).join('\n');
  requestAnimationFrame(() => el.classList.add('is-open'));

  const range = el.querySelector('[data-range]');
  const num = el.querySelector('[data-num]');
  const dvNode = el.querySelector('[data-dv]');
  const clamp = (v) => Math.max(1, Math.min(Number(max) || 1, Math.floor(Number(v) || 0)));
  const paintDV = () => { if (dvNode && !force) dvNode.textContent = effDV(clamp(num?.value ?? max)); };
  range?.addEventListener('input', () => { if (num) num.value = range.value; paintDV(); });
  num?.addEventListener('input', () => { const v = clamp(num.value); if (range) range.value = v; paintDV(); });
  num?.focus(); num?.select?.();

  return new Promise((resolve) => {
    let settled = false;
    let withdrawFn = null;              // Tier C: an ESC while AWAITING GM must also withdraw the request
    const finish = (r) => {
      if (settled) return; settled = true;
      el.classList.remove('is-open'); el.classList.add('is-closing');
      setTimeout(() => el.remove(), 240);
      document.removeEventListener('keydown', onKey, true);
      resolve(r);
    };
    const cancel = () => {
      try { withdrawFn?.(); } catch { /* already resolved */ }
      finish({ ok: false, amount: null, total: null, cancelled: true });
    };

    const onKey = (e) => {
      if (settled) return;
      if (el.classList.contains('is-docked')) return;   // docked = the chip is the only way back in
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter' && document.activeElement?.tagName !== 'BUTTON') { e.preventDefault(); go(); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => {
      if (settled) return;
      if (e.target === el) return cancel();
      const a = e.target.closest?.('[data-h]')?.dataset.h;
      if (a === 'cancel') cancel();
      else if (a === 'go') go();
    });

    async function go() {
      if (settled) return;
      const amount = clamp(num?.value ?? max);
      const useDV = effDV(amount);
      // ── Lock the controls, run the sequence ──
      el.querySelector('[data-ctl]')?.setAttribute('hidden', '');
      el.querySelector('[data-actions]')?.setAttribute('hidden', '');
      const bar = el.querySelector('[data-bar]'); bar?.removeAttribute('hidden');
      const barFill = bar?.querySelector('i');
      const sub = el.querySelector('[data-sub]');
      const status = el.querySelector('[data-status]');
      const srcEl = el.querySelector('[data-src]');
      const dstEl = el.querySelector('[data-dst]');
      const verdict = el.querySelector('[data-verdict]');
      el.querySelector('.ncm-heist')?.classList.add('is-live');

      // Phase 1 — connect / crack (brief).
      if (sub) sub.textContent = 'ROUTING THROUGH RELAY · CRACKING VAULT…';
      sound?.play?.('hack-start');
      const connMs = reduced() ? 0 : 900;
      if (barFill) { barFill.style.transition = `width ${connMs}ms linear`; requestAnimationFrame(() => { barFill.style.width = '55%'; }); }
      sound?.play?.('hack-progress');
      await wait(connMs);

      // Phase 2 — the roll, the GM's call (Tier C), or force.
      let ok = true, total = null;
      const mode = force ? 'auto' : resolveHackResolution(hostItem);
      if (!force && mode === 'gm') {
        // hackResolution: 'gm' — no roll; the table runs the NET and the GM calls it.
        if (sub) sub.textContent = 'TABLE ADJUDICATION · RUN THE NET';
        if (status) status.textContent = 'AWAITING GM — RUN IT AT THE TABLE (ESC withdraws)';

        // STEP AWAY — the operator is at the table for this run; dock the heist
        // to a corner chip so their screen is free, snap back when the GM calls
        // it. Also auto-docks when the GM minimizes their adjudicator (a NETRUN
        // IN PROGRESS chip). The SecurityConsole awaiting-dock twin.
        let awaitChip = null;
        const undock = () => {
          if (!el.classList.contains('is-docked')) return;
          el.classList.remove('is-docked');
          awaitChip?.remove(); awaitChip = null;
          const dock = document.getElementById('ncm-netadj-dock');
          if (dock && !dock.childElementCount) dock.remove();
        };
        const dock = (remote) => {
          if (settled || el.classList.contains('is-docked')) return;
          el.classList.add('is-docked');
          awaitChip = document.createElement('button');
          awaitChip.type = 'button';
          awaitChip.className = 'ncm-netadj-chip ncm-netadj-chip--wait' + (remote ? ' ncm-netadj-chip--run' : '');
          awaitChip.innerHTML = remote
            ? `<i class="fas fa-wifi"></i><span class="t">NETRUN IN PROGRESS<b>Siphon: ${esc(accountLabel)}</b></span><span class="h">GM is running it</span>`
            : `<i class="fas fa-satellite-dish"></i><span class="t">AWAITING GM<b>Siphon: ${esc(accountLabel)}</b></span><span class="h">return</span>`;
          awaitChip.addEventListener('click', undock);
          netadjDock().appendChild(awaitChip);
        };
        const stepAway = document.createElement('button');
        stepAway.type = 'button';
        stepAway.className = 'ncm-heist__stepaway';
        stepAway.innerHTML = '<i class="fas fa-window-minimize"></i> STEP AWAY — RUN IT AT THE TABLE';
        stepAway.addEventListener('click', () => dock(false));
        status?.parentElement?.appendChild(stepAway);

        const handle = requestNetAdjudication({
          actor, verb: 'Control', action: 'siphon', title: `Siphon: ${accountLabel}`,
          skill: skill || 'Interface', dv: useDV, hostName: bankName || accountLabel,
          onRemoteState: (min) => { if (min) dock(true); else undock(); },
        });
        withdrawFn = handle.withdraw;
        const adj = await handle.promise;
        withdrawFn = null;
        undock();
        stepAway.remove();
        if (settled) return;                          // player withdrew via ESC
        if (adj.cancelled) return finish({ ok: false, amount: null, total: null, cancelled: true });
        ok = adj.ok;
      } else if (!force) {
        try {
          const roll = await skillSvc?.performCheck(actor, skill || 'Interface', {
            dc: useDV, showChat: true,
            context: `Siphon: ${accountLabel}`, flavor: `Account Siphon // DV ${useDV}`,
          });
          ok = !!roll?.success; total = roll?.total ?? null;
        } catch (err) { log.error(`BankHeist roll failed: ${err.message}`); ok = false; }
        // Tier B — same roll, but announce the NET-action shape to the GM.
        if (mode === 'flagged') postNetActionCard({
          verb: 'Control', action: 'siphon', title: `Siphon: ${accountLabel}`,
          actorName: actor?.name, hostName: bankName || accountLabel,
          skill: skill || 'Interface', dv: useDV, total, ok,
        });
      }

      if (ok) {
        // Phase 3 — DRAIN: source ticks down, wallet ticks up, stream flows.
        if (sub) sub.textContent = 'AUTHORIZATION SPOOFED · TRANSFERRING';
        if (status) status.textContent = `TRANSFERRING ${amount.toLocaleString()} ${currency} · TRACE: CLEAR`;
        el.querySelector('.ncm-heist')?.classList.add('is-flowing');
        const drainMs = reduced() ? 0 : 1600;
        if (barFill) { barFill.style.transition = `width ${drainMs}ms ease-out`; requestAnimationFrame(() => { barFill.style.width = '100%'; }); }
        await Promise.all([
          animateCount(srcEl, fromBalance, Math.max(0, fromBalance - amount), drainMs, (v) => v.toLocaleString()),
          animateCount(dstEl, 0, amount, drainMs, (v) => `+${v.toLocaleString()}`),
        ]);
        el.querySelector('.ncm-heist')?.classList.add('is-ok');
        if (verdict) { verdict.removeAttribute('hidden'); verdict.innerHTML = `<i class="fas fa-circle-check"></i> TRANSFER COMPLETE <span>${amount.toLocaleString()} ${cur} SECURED</span>`; }
        sound?.play?.('hack-success');
        await wait(reduced() ? 300 : 1300);
        finish({ ok: true, amount, total, dv: useDV, cancelled: false });
      } else {
        // Trace fired — sever the connection.
        if (sub) sub.textContent = 'INTRUSION DETECTED';
        if (status) status.textContent = 'TRACE LOCKED · CONNECTION SEVERED';
        el.querySelector('.ncm-heist')?.classList.add('is-fail');
        if (barFill) barFill.style.width = '100%';
        if (verdict) { verdict.removeAttribute('hidden'); verdict.innerHTML = `<i class="fas fa-triangle-exclamation"></i> TRACE FIRED${total != null ? ` <span>rolled ${total} vs DV ${useDV}</span>` : ''}`; }
        sound?.play?.('hack-fail');
        sound?.play?.('trace-fire');
        await wait(reduced() ? 300 : 1300);
        finish({ ok: false, amount, total, dv: useDV, cancelled: false });
      }
    }
  });
}
