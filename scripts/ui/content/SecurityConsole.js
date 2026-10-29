/**
 * SecurityConsole — immersive action modal (design: content-action foundation)
 * @file scripts/ui/content/SecurityConsole.js
 * @module night-city-messenger
 * @description The shared "security-roll → styled dialog → outcome animation"
 *   engine that replaces vanilla `Dialog` for content actions (siphon / claim /
 *   crack / deploy / exfil). One promise-based, framework-free modal:
 *
 *     · themed to the host (inherits the viewer's --ncm-* preset when appended
 *       inside it, brand defaults on document.body),
 *     · an optional amount input,
 *     · an optional skill-check GATE — shows the skill + DV, rolls via
 *       SkillService.performCheck on ATTEMPT, and plays an inline pass/fail
 *       animation (progress sweep → ACCESS GRANTED / TRACE DETECTED),
 *     · resolves `{ ok, amount, total, cancelled }`.
 *
 *   `gate.require === false` (or no gate) → a styled confirm, no roll — this is
 *   the "optional per-action, default off" contract callers read from config.
 *   Reduced-motion collapses the animation to an instant verdict.
 */

import { log, resolveHackResolution } from '../../utils/helpers.js';
import { requestNetAdjudication, postNetActionCard, netadjDock } from './NetResolve.js';

const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Show the security console and resolve the player's choice/outcome.
 * @param {object} opts
 * @param {string}  opts.title                header title
 * @param {string} [opts.icon]                FA glyph (no `fa-` needed prefix ok)
 * @param {string} [opts.accent='cyan']       ct-color key for the accent bar/glow
 * @param {string} [opts.intro]               framing line (plain text, escaped)
 * @param {HTMLElement} [opts.host]           element to append into (theme source); default body
 * @param {{max:number, unit?:string, label?:string, value?:number}} [opts.amount]  numeric input
 * @param {{require:boolean, skill?:string, dv?:number, actor?:Actor, context?:string, flavor?:string, net?:object}} [opts.gate]
 *   `gate.net = { verb, action, hostItem?, hostName?, choices? }` opts the gate
 *   into the netrunning resolution tiers (design §5, `hackResolution`): 'auto'
 *   rolls as ever; 'flagged' rolls then whispers the GM a NET-action card naming
 *   `verb`; 'gm' does NOT roll — the console shows AWAITING GM while the table
 *   adjudicates (NetResolve round-trip; the GM's verdict synthesizes {ok,total}
 *   so callers are unchanged). `choices` customizes the GM's verdict rungs
 *   (the upload forge ladder). No `net` = plain Tier A behavior, always.
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {string} [opts.successLabel='ACCESS GRANTED']
 * @param {string} [opts.failLabel='TRACE DETECTED']
 * @param {(o:{ok:boolean,total:number|null,dv:number}) => {label:string, tone?:'ok'|'warn'|'fail'}} [opts.verdictFor]
 *   Optional: derive the verdict from the ROLL rather than pass/fail. A binary
 *   ok/fail can't express an outcome LADDER — the upload's FORGE check has three
 *   bands (clean / sloppy-but-it-lands / rejected), and "sloppy" is neither a
 *   success nor a plain failure. Return a label + tone; omit for pass/fail.
 * @returns {Promise<{ok:boolean, amount:number|null, total:number|null, cancelled:boolean}>}
 */
export async function runSecurityConsole(opts = {}) {
  const {
    title = 'Confirm', icon = 'fas fa-shield-halved', accent = 'cyan', intro = '',
    host = null, amount = null, gate = null,
    confirmLabel = 'Confirm', cancelLabel = 'Cancel',
    successLabel = 'ACCESS GRANTED', failLabel = 'TRACE DETECTED',
    verdictFor = null,
  } = opts;

  const gated = !!(gate && gate.require && gate.actor);
  const skillSvc = game.nightcity?.skillService;
  const sound = game.nightcity?.soundService;
  const mount = host || document.body;

  const iconClass = icon.includes('fa-') ? icon : `fas fa-${icon}`;
  const amtHtml = amount ? `
    <div class="ncm-seccon__amt">
      <label>${esc(amount.label || 'Amount')}</label>
      <div class="ncm-seccon__amtrow">
        <input type="number" name="amt" min="1" max="${Number(amount.max) || 0}" value="${Number(amount.value ?? amount.max) || 0}" step="1">
        ${amount.unit ? `<span class="ncm-seccon__unit">${esc(amount.unit)}</span>` : ''}
      </div>
      <div class="ncm-seccon__amtmax">max ${(Number(amount.max) || 0).toLocaleString()}${amount.unit ? ' ' + esc(amount.unit) : ''}</div>
    </div>` : '';
  const gateHtml = gated ? `
    <div class="ncm-seccon__gate">
      <i class="fas fa-dice-d20"></i>
      <span>Security check — <b>${esc(gate.skill || 'Interface')}</b> vs <b>DV ${Number(gate.dv) || 15}</b></span>
      <span class="ncm-seccon__gate-warn">fail trips a trace</span>
    </div>` : '';
  const primaryLabel = gated ? 'ATTEMPT' : confirmLabel;
  const primaryIcon = gated ? 'fas fa-fingerprint' : 'fas fa-check';

  const el = document.createElement('div');
  el.className = 'ncm-seccon-backdrop';
  el.innerHTML = `
    <div class="ncm-seccon" data-ct-color="${esc(accent)}" role="dialog" aria-modal="true">
      <div class="ncm-seccon__bar"></div>
      <div class="ncm-seccon__hd"><span class="ncm-seccon__ico"><i class="${esc(iconClass)}"></i></span><span class="ncm-seccon__ttl">${esc(title)}</span></div>
      ${intro ? `<div class="ncm-seccon__intro">${esc(intro)}</div>` : ''}
      ${amtHtml}
      ${gateHtml}
      <div class="ncm-seccon__stage" aria-hidden="true">
        <div class="ncm-seccon__track"><i></i></div>
        <div class="ncm-seccon__verdict"></div>
      </div>
      <div class="ncm-seccon__actions">
        <button type="button" class="ncm-seccon__btn ncm-seccon__btn--ghost" data-sc="cancel"><i class="fas fa-xmark"></i> ${esc(cancelLabel)}</button>
        <button type="button" class="ncm-seccon__btn ncm-seccon__btn--go" data-sc="go"><i class="${primaryIcon}"></i> ${esc(primaryLabel)}</button>
      </div>
    </div>`;
  mount.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-open'));

  const amtInput = el.querySelector('input[name="amt"]');
  amtInput?.focus();
  amtInput?.select?.();

  return new Promise((resolve) => {
    let settled = false;
    let withdrawFn = null;              // Tier C: cancel while AWAITING GM must also withdraw the request
    const finish = (result) => {
      if (settled) return; settled = true;
      el.classList.remove('is-open'); el.classList.add('is-closing');
      setTimeout(() => el.remove(), 220);
      document.removeEventListener('keydown', onKey, true);
      resolve(result);
    };
    const cancel = () => {
      try { withdrawFn?.(); } catch { /* already resolved */ }
      finish({ ok: false, amount: null, total: null, cancelled: true });
    };

    const readAmount = () => {
      if (!amount) return null;
      const v = Math.floor(Number(amtInput?.value) || 0);
      return Math.max(1, Math.min(Number(amount.max) || 0, v));
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
      if (e.target === el) return cancel();                 // backdrop click
      const act = e.target.closest?.('[data-sc]')?.dataset.sc;
      if (act === 'cancel') cancel();
      else if (act === 'go') go();
    });

    async function go() {
      if (settled) return;
      const amt = readAmount();

      if (!gated) return finish({ ok: true, amount: amt, total: null, cancelled: false });

      // ── Gated: lock the controls, resolve (roll or GM verdict), animate ──
      const net = gate.net || null;
      const mode = net ? resolveHackResolution(net.hostItem || null) : 'auto';
      const dvNum = Number(gate.dv) || 15;

      const buttons = el.querySelectorAll('.ncm-seccon__btn');
      buttons.forEach(b => {
        // Tier C: the CANCEL button stays live — the player can withdraw while
        // the table adjudicates (cancel() also fires the socket withdraw).
        if (mode === 'gm' && b.dataset.sc === 'cancel') return;
        b.disabled = true; b.classList.add('is-disabled');
      });
      amtInput && (amtInput.disabled = true);
      const stage = el.querySelector('.ncm-seccon__stage');
      const fill = el.querySelector('.ncm-seccon__track i');
      const verdict = el.querySelector('.ncm-seccon__verdict');
      stage.classList.add('is-active');

      let ok, total, verdictOverride = null, rolled = null;
      if (mode === 'gm') {
        // ── Tier C — no roll; the table runs the NET and the GM calls it ──
        stage.classList.add('is-await');
        if (verdict) verdict.innerHTML = `<i class="fas fa-satellite-dish"></i> AWAITING GM — RUN IT AT THE TABLE`;
        sound?.play?.('hack-start');

        // The operator is AT the table for this run — the console must not hold
        // their screen hostage while the GM adjudicates (moving their token IS
        // the netrun). STEP AWAY docks the console to a corner chip (the GM
        // prompt's RUN-THE-NET twin); the verdict's arrival snaps it back so
        // the outcome animation is never missed. ESC is suppressed while docked
        // so a stray keypress can't silently withdraw a run in progress.
        //
        // It ALSO docks automatically when the GM minimizes their adjudicator
        // ("RUN THE NET") — the dev's ask: the player shouldn't have to guess
        // that the run started. A GM-driven dock shows a distinct NETRUN IN
        // PROGRESS chip; a self-dock (STEP AWAY) shows AWAITING GM.
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
            ? `<i class="fas fa-wifi"></i><span class="t">NETRUN IN PROGRESS<b>${esc(title)}</b></span><span class="h">GM is running it</span>`
            : `<i class="fas fa-satellite-dish"></i><span class="t">AWAITING GM<b>${esc(title)}</b></span><span class="h">return</span>`;
          awaitChip.addEventListener('click', undock);
          netadjDock().appendChild(awaitChip);
        };
        const stepAway = document.createElement('button');
        stepAway.type = 'button';
        stepAway.className = 'ncm-seccon__stepaway';
        stepAway.innerHTML = '<i class="fas fa-window-minimize"></i> STEP AWAY — RUN IT AT THE TABLE';
        stepAway.addEventListener('click', () => dock(false));
        stage.appendChild(stepAway);

        const handle = requestNetAdjudication({
          actor: gate.actor, verb: net.verb, action: net.action, title,
          skill: gate.skill || 'Interface', dv: dvNum,
          hostName: net.hostName || net.hostItem?.name || '', choices: net.choices,
          // GM minimized/restored their prompt → mirror it here.
          onRemoteState: (min) => { if (min) dock(true); else undock(); },
        });
        withdrawFn = handle.withdraw;
        const adj = await handle.promise;
        withdrawFn = null;
        undock();
        stepAway.remove();
        if (settled) return;                          // player withdrew via CANCEL
        stage.classList.remove('is-await');
        if (adj.cancelled) return finish({ ok: false, amount: null, total: null, cancelled: true });
        ok = adj.ok; total = adj.total ?? null;
        verdictOverride = { label: adj.label, tone: adj.tone };
      } else {
        sound?.play?.('hack-progress');
        let roll = null;
        try {
          roll = await skillSvc?.performCheck(gate.actor, gate.skill || 'Interface', {
            dc: dvNum, showChat: true,
            deferChat: true,   // posted when the verdict lands, below
            context: gate.context || title, flavor: gate.flavor || `${title} // DV ${dvNum}`,
          });
        } catch (err) { log.error(`SecurityConsole roll failed: ${err.message}`); }
        rolled = roll;
        ok = !!roll?.success;
        total = roll?.total ?? null;
        // Tier B — same roll, but announce the NET-action shape to the GM.
        if (mode === 'flagged') postNetActionCard({
          verb: net.verb, action: net.action, title, actorName: gate.actor?.name,
          hostName: net.hostName || net.hostItem?.name || '', skill: gate.skill || 'Interface',
          dv: dvNum, total, ok,
        });
      }

      const fillMs = reduced() ? 0 : 850;
      if (fill) { fill.style.transition = `width ${fillMs}ms ease`; requestAnimationFrame(() => { fill.style.width = '100%'; }); }
      await wait(fillMs);

      const v = verdictOverride || verdictFor?.({ ok, total, dv: dvNum }) || null;
      const tone = v?.tone || (ok ? 'ok' : 'fail');
      const label = v?.label ?? (ok ? successLabel : failLabel);
      const glyph = tone === 'ok' ? 'fa-circle-check' : tone === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-xmark';
      stage.classList.add(`is-${tone}`);
      // Tier C totals are SYNTHESIZED from the GM's verdict (so downstream band
      // math works) — never display one as if it were rolled.
      const displayTotal = mode === 'gm' ? null : total;
      if (verdict) verdict.innerHTML = `<i class="fas ${glyph}"></i> ${esc(label)}${displayTotal != null ? ` <span class="ncm-seccon__rolled">(${displayTotal} vs ${dvNum})</span>` : ''}`;
      sound?.play?.(tone === 'ok' ? 'hack-success' : 'hack-fail');
      // The verdict is on screen — now the chat card.
      await rolled?.postChat?.();
      await wait(reduced() ? 250 : 1150);
      finish({ ok, amount: amt, total, cancelled: false });
    }
  });
}
