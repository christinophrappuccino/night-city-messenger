/**
 * SystemSweep — the host-scan counterplay (design §3a, thread #6). The defensive
 * sibling of UploadConsole: log into a terminal, deep-scan it for installed
 * programs (residents), and defuse what you find.
 *
 * A framework-free promise modal (the OperatorSelect / UploadConsole pattern —
 * NOT an Application): a cyan `.ncm-sweep` panel appended into `opts.host` (the
 * viewer element, so it inherits that machine's --ncm-* preset; falls back to
 * document.body = brand defaults).
 *
 * Model (approved mock `docs/mockups/system-sweep-mock.html`):
 *   · ONE sweep roll (the operator's skill) → reveal every ARMED resident whose
 *     `stealthDV <= roll total`. A well-hidden plant survives a mediocre sweep;
 *     the verdict never says how many you MISSED (honest ambiguity).
 *   · Information split: the GM sees the real type + provenance + stealthDV + a
 *     forgery tell; a player sees only "UNKNOWN PROCESS" + a vague per-type hint.
 *   · Per-resident DEFUSE → state:'defused' (GM writes directly; a player relays
 *     via SOCKET_OPS.TERMINAL_RESIDENT_REQUEST {op:'defuse'}).
 *   · No trace / no heat — sweeping is recon, not an attack.
 *
 * @file scripts/ui/content/SystemSweep.js
 * @module cyberpunkred-messenger
 */

import { SOCKET_OPS } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';

const DEFAULT_SWEEP_SKILL = 'Interface';
const DEFAULT_SWEEP_DV = 15;
const SLOPPY_QUALITY = 45; // below this forgeQuality, ANALYZE/SWEEP flags it as sloppy

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  plant: 'fa-file-circle-exclamation', keylog: 'fa-keyboard',
  deployICE: 'fa-skull-crossbones', forgeAccount: 'fa-user-secret', logicBomb: 'fa-bomb',
};
const GM_TYPE = {
  plant: 'PLANTED FILE', keylog: 'KEYLOGGER', deployICE: 'BLACK ICE',
  forgeAccount: 'BACKDOOR ACCOUNT', logicBomb: 'LOGIC BOMB',
};
const PLAYER_HINT = {
  plant: 'a foreign file is in a mailbox', keylog: 'something is listening',
  deployICE: 'a trap is primed', forgeAccount: 'an account that should not exist',
  logicBomb: 'a timer is counting down',
};
const SECTORS = ['0x1A · boot', '0x2C · mail', '0x3F · net', '0x44 · svc', '0x5E · sess', '0x6B · logs', '0x7D · shadow'];

/** GM-facing one-line name for a detected resident (what/where). */
function gmName(term, resident) {
  const p = resident.params || {};
  switch (resident.effectType) {
    case 'plant': {
      const acct = p.accountId ? term?.getAccount?.(term._sweepItem, p.accountId) : null;
      return `${p.entry?.subject || p.name || 'file'}${acct ? ` → ${acct.displayName || acct.username}` : ''}`;
    }
    case 'keylog': return 'captures the next login';
    case 'deployICE': return `${p.name || 'Black ICE'} — bites the next intruder`;
    case 'forgeAccount': return `hidden login ${p.username || p.name || '—'}`;
    case 'logicBomb': return `armed → ${p.inner?.effectType || 'payload'}`;
    default: return p.name || 'installed program';
  }
}

/**
 * Open the SYSTEM SWEEP modal for a terminal. Resolves { swept:true, found, defused }
 * when closed (or { swept:false } if there was nothing to do / no service).
 * @param {object} opts
 * @param {Item}    opts.item   the terminal being swept
 * @param {Actor}   [opts.actor] the operator (rolls the sweep). GM without an actor force-reveals.
 * @param {HTMLElement} [opts.host] viewer element (theme source)
 * @param {string}  [opts.skill] sweep skill (default Interface)
 * @param {number}  [opts.dv]    sweep card DV (flavor; detection is per-resident stealthDV)
 * @returns {Promise<{swept:boolean, found?:number, defused?:number}>}
 */
export function runSystemSweep({ item, actor = null, host = null, skill = null, dv = null } = {}) {
  return new Promise((resolve) => {
    const term = game.nightcity?.terminalService;
    if (!term?.isTerminal?.(item)) { try { ui.notifications?.warn('NCM | You can only sweep a terminal you are logged into.'); } catch { /* */ } resolve({ swept: false }); return; }
    term._sweepItem = item; // for gmName's account lookup

    const sweepSkill = skill || DEFAULT_SWEEP_SKILL;
    const sweepDV = Number(dv) || DEFAULT_SWEEP_DV;
    const gm = isGM();
    const forceReveal = gm && !actor;     // a GM with no character sees everything, no roll

    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }

    const mount = host || document.body;
    const wrap = document.createElement('div');
    wrap.className = 'ncm-sweep-backdrop';
    wrap.innerHTML = panelHtml(forceReveal);
    const panel = () => wrap.querySelector('.ncm-sweep');

    let defusedCount = 0, foundCount = 0, scanning = false;

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      delete term._sweepItem;
      resolve({ swept: true, found: foundCount, defused: defusedCount });
    };
    const onKey = (e) => { if (e.key === 'Escape' && !scanning) { e.preventDefault(); cleanup(); } };

    // Reveal the residents whose stealthDV <= total (force = all).
    const reveal = (total) => {
      const armed = (term.getResidents(item) || []).filter(r => r.state === 'armed');
      const found = forceReveal ? armed : armed.filter(r => (Number(r.stealthDV) || 0) <= total);
      foundCount = found.length;
      const p = panel();
      if (!found.length) {
        p.classList.add('is-clean', 'is-done');
        p.querySelector('.ncm-sweep__verdict .v').textContent = 'SWEEP CLEAN';
        p.querySelector('.ncm-sweep__verdict .vs').textContent = 'no anomalies beat the scan';
        return;
      }
      p.classList.add('is-hits', 'is-done');
      p.querySelector('.ncm-sweep__verdict .v').textContent = `${found.length} FOUND`;
      p.querySelector('.ncm-sweep__verdict .vs').textContent = gm ? 'installed programs detected' : 'anomalies detected — defuse them';
      p.querySelector('.ncm-sweep__hits').innerHTML = found.map(r => hitHtml(term, r, gm)).join('');
    };

    // The RUN SWEEP roll → radar beat → reveal.
    const runScan = async () => {
      if (scanning) return;
      scanning = true;
      const p = panel();
      p.classList.add('is-scanning');
      const big = p.querySelector('.big'); const sm = p.querySelector('.sm'); const logEl = p.querySelector('.ncm-sweep__log');
      if (big) big.textContent = 'SWEEPING';

      let total = Infinity;
      if (!forceReveal) {
        const svc = game.nightcity?.skillService;
        if (!svc || !actor) { ui.notifications?.warn('NCM | No operator to roll the sweep.'); scanning = false; return cleanup(); }
        try {
          const res = await svc.performCheck(actor, sweepSkill, { dc: sweepDV, context: 'System Sweep', flavor: `SWEEP // ${item.name}` });
          total = Number(res?.total) || 0;
          if (sm) sm.textContent = `rolled ${total}`;
        } catch (err) { log.error(`Sweep roll failed: ${err.message}`); total = 0; }
      }

      const finish = () => { p.classList.remove('is-scanning'); if (logEl) logEl.textContent = ''; scanning = false; reveal(total); };
      if (reduced) { finish(); return; }
      // Cosmetic sector stream during the sweep.
      let i = 0;
      const iv = setInterval(() => {
        if (logEl) logEl.textContent = SECTORS.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (++i > SECTORS.length) { clearInterval(iv); finish(); }
      }, 130);
      try { game.nightcity?.soundService?.play('hack-progress'); } catch { /* */ }
    };

    // Defuse a detected resident (GM direct / player relay).
    const doDefuse = async (residentId, hitEl) => {
      hitEl.classList.add('is-defused');
      const ic = hitEl.querySelector('.ncm-sweep__hit-ico i'); if (ic) ic.className = 'fas fa-shield-halved';
      const btn = hitEl.querySelector('.ncm-sweep__defuse'); if (btn) btn.innerHTML = '<i class="fas fa-check"></i> NEUTRALIZED';
      defusedCount++;
      try {
        if (gm) await term.updateResident(item, residentId, { state: 'defused' });
        else game.nightcity?.socketManager?.emit(SOCKET_OPS.TERMINAL_RESIDENT_REQUEST, { op: 'defuse', itemUuid: item.uuid, residentId, userId: game.user.id });
        game.nightcity?.soundService?.play('shard-decrypt');
        game.nightcity?.traceService?.logSuccess?.({ actor, action: 'sweep-defuse', source: 'resident', hostItem: item, severity: 'minor' });
      } catch (err) { log.error(`Defuse failed: ${err.message}`); }
    };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('.ncm-sweep__cancel') || e.target.closest('.ncm-sweep__done')) { if (!scanning) cleanup(); return; }
      if (e.target.closest('.ncm-sweep__go')) { runScan(); return; }
      const defBtn = e.target.closest('.ncm-sweep__defuse');
      if (defBtn) {
        const hit = defBtn.closest('.ncm-sweep__hit');
        if (hit && !hit.classList.contains('is-defused')) doDefuse(hit.dataset.id, hit);
      }
    });

    document.addEventListener('keydown', onKey, true);
    mount.appendChild(wrap);
    try { game.nightcity?.soundService?.play('click'); } catch { /* */ }
    // Force-reveal (GM no actor) skips the roll — sweep immediately.
    if (forceReveal) runScan();
    log.debug(`SystemSweep opened on ${item.name} (${forceReveal ? 'force' : 'roll'}).`);
  });
}

/** The modal shell. */
function panelHtml(forceReveal) {
  return `
  <div class="ncm-sweep" data-ct-color="cyan" role="dialog" aria-modal="true">
    <div class="ncm-sweep__bar"></div>
    <span class="ncm-sweep__ck ncm-sweep__ck--tl"></span><span class="ncm-sweep__ck ncm-sweep__ck--tr"></span>
    <span class="ncm-sweep__ck ncm-sweep__ck--bl"></span><span class="ncm-sweep__ck ncm-sweep__ck--br"></span>
    <div class="ncm-sweep__hd">
      <span class="ncm-sweep__tag"><i class="fas fa-satellite-dish"></i> SYSTEM SWEEP</span>
      <span class="ncm-sweep__sub">deep-scan this host for installed programs</span>
    </div>
    <div class="ncm-sweep__ctx">
      <span class="ncm-sweep__chip"><i class="fas fa-microchip"></i> INTERFACE</span>
      <span class="ncm-sweep__chip"><i class="fas fa-dice-d10"></i> ROLL <b>vs</b> each hidden process</span>
    </div>
    <div class="ncm-sweep__radar">
      <div class="ncm-sweep__grid"></div>
      <div class="ncm-sweep__wedge"></div>
      <div class="ncm-sweep__radartx"><div class="big">READY</div><div class="sm">${forceReveal ? 'GM force-reveal' : 'roll to detect'}</div></div>
      <div class="ncm-sweep__verdict"><div class="v"></div><div class="vs"></div></div>
      <div class="ncm-sweep__log"></div>
    </div>
    <div class="ncm-sweep__hits"></div>
    <div class="ncm-sweep__ft">
      <button type="button" class="ncm-sweep__cancel">CLOSE</button>
      <button type="button" class="ncm-sweep__go"><i class="fas fa-satellite-dish"></i> RUN SWEEP</button>
      <button type="button" class="ncm-sweep__done"><i class="fas fa-check"></i> DONE</button>
    </div>
  </div>`;
}

/** One detected-resident card — role-aware (GM = full intel, player = vague). */
function hitHtml(term, r, gm) {
  const q = Number(r.provenance?.forgeQuality);
  const tell = Number.isFinite(q)
    ? (q < SLOPPY_QUALITY
      ? '<span class="ncm-sweep__pill ncm-sweep__pill--sloppy">FORGED — SLOPPY</span>'
      : '<span class="ncm-sweep__pill ncm-sweep__pill--clean">WELL-MADE</span>')
    : '';
  if (gm) {
    const by = r.provenance?.plantedBy ? (game.actors?.get(r.provenance.plantedBy)?.name || r.provenance.sourceLabel || 'unknown') : (r.provenance?.sourceLabel || 'unknown');
    return `<div class="ncm-sweep__hit" data-id="${esc(r.id)}">
      <span class="ncm-sweep__hit-ico"><i class="fas ${ICON[r.effectType] || 'fa-bug'}"></i></span>
      <span class="ncm-sweep__hit-nm">
        <span class="ncm-sweep__hit-t">${esc(gmName(term, r))}
          <span class="ncm-sweep__pill ncm-sweep__pill--type">${esc(GM_TYPE[r.effectType] || 'PROGRAM')}</span>${tell}</span>
        <span class="ncm-sweep__hit-meta"><span>PLANTED BY ${esc(by)}</span><span>STEALTH DV ${Number(r.stealthDV) || 0}</span></span>
      </span>
      <button type="button" class="ncm-sweep__defuse"><i class="fas fa-eraser"></i> DEFUSE</button>
    </div>`;
  }
  return `<div class="ncm-sweep__hit" data-id="${esc(r.id)}">
    <span class="ncm-sweep__hit-ico"><i class="fas fa-triangle-exclamation"></i></span>
    <span class="ncm-sweep__hit-nm">
      <span class="ncm-sweep__hit-t">UNKNOWN PROCESS</span>
      <span class="ncm-sweep__hit-d">${esc(PLAYER_HINT[r.effectType] || 'an unknown process is running')}</span>
    </span>
    <button type="button" class="ncm-sweep__defuse"><i class="fas fa-eraser"></i> DEFUSE</button>
  </div>`;
}
