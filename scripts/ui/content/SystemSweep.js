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
 * Model (approved mock `dev/mockups/system-sweep-mock.html`):
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
 * @module night-city-messenger
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
function gmName(term, item, resident) {
  const p = resident.params || {};
  switch (resident.effectType) {
    case 'plant': {
      const acct = p.accountId ? term?.getAccount?.(item, p.accountId) : null;
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
 * @param {object}  [opts.source] what to sweep instead of a terminal's residents (network nodes use it):
 *   { name, sub?, list: () => [{ id, stealthDV, icon, gmTitle, gmType, quality?, by?, hint }], defuse: async (id) => void }
 * @returns {Promise<{swept:boolean, found?:number, defused?:number}>}
 */
export function runSystemSweep({ item, actor = null, host = null, skill = null, dv = null, source = null } = {}) {
  return new Promise((resolve) => {
    const term = game.nightcity?.terminalService;
    const src = source || terminalSource(term, item);
    if (!src) { try { ui.notifications?.warn('NCM | You can only sweep a terminal you are logged into.'); } catch { /* */ } resolve({ swept: false }); return; }

    const sweepSkill = skill || DEFAULT_SWEEP_SKILL;
    const sweepDV = Number(dv) || DEFAULT_SWEEP_DV;
    const gm = isGM();
    const forceReveal = gm && !actor;     // a GM with no character sees everything, no roll

    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* */ }

    const mount = host || document.body;
    const wrap = document.createElement('div');
    wrap.className = 'ncm-sweep-backdrop';
    wrap.innerHTML = panelHtml(forceReveal, src.sub);
    const panel = () => wrap.querySelector('.ncm-sweep');

    let defusedCount = 0, foundCount = 0, scanning = false;

    const cleanup = () => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve({ swept: true, found: foundCount, defused: defusedCount });
    };
    const onKey = (e) => { if (e.key === 'Escape' && !scanning) { e.preventDefault(); cleanup(); } };

    // Reveal the residents whose stealthDV <= total (force = all).
    const reveal = (total) => {
      const armed = src.list() || [];
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
      p.querySelector('.ncm-sweep__hits').innerHTML = found.map(r => hitHtml(r, gm)).join('');
    };

    // The RUN SWEEP roll → radar beat → reveal.
    const runScan = async () => {
      if (scanning) return;
      scanning = true;
      const p = panel();
      p.classList.add('is-scanning');
      const big = p.querySelector('.big'); const sm = p.querySelector('.sm'); const logEl = p.querySelector('.ncm-sweep__log');
      if (big) big.textContent = 'SWEEPING';

      let total = Infinity, rolled = null;
      if (!forceReveal) {
        const svc = game.nightcity?.skillService;
        if (!svc || !actor) { ui.notifications?.warn('NCM | No operator to roll the sweep.'); scanning = false; return cleanup(); }
        try {
          // The number and the chat card wait for the sweep to finish.
          rolled = await svc.performCheck(actor, sweepSkill, { dc: sweepDV, deferChat: true, context: 'System Sweep', flavor: `SWEEP // ${src.name}` });
          total = Number(rolled?.total) || 0;
        } catch (err) { log.error(`Sweep roll failed: ${err.message}`); total = 0; }
      }

      const finish = () => {
        p.classList.remove('is-scanning'); if (logEl) logEl.textContent = ''; scanning = false;
        if (sm && rolled) sm.textContent = `rolled ${total}`;
        reveal(total);
        rolled?.postChat?.();
      };
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
        await src.defuse(residentId, actor);
        game.nightcity?.soundService?.play('shard-decrypt');
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
    log.debug(`SystemSweep opened on ${src.name} (${forceReveal ? 'force' : 'roll'}).`);
  });
}

/**
 * The terminal source: its ARMED residents (the original behaviour), defused GM-side or relayed.
 * @returns {object|null}
 */
function terminalSource(term, item) {
  if (!term?.isTerminal?.(item)) return null;
  const gm = isGM();
  return {
    name: item.name,
    list: () => (term.getResidents(item) || []).filter(r => r.state === 'armed').map((r) => {
      const by = r.provenance?.plantedBy ? (game.actors?.get(r.provenance.plantedBy)?.name || r.provenance.sourceLabel || 'unknown') : (r.provenance?.sourceLabel || 'unknown');
      return { id: r.id, stealthDV: Number(r.stealthDV) || 0, icon: ICON[r.effectType] || 'fa-bug', gmTitle: gmName(term, item, r), gmType: GM_TYPE[r.effectType] || 'PROGRAM',
        quality: Number(r.provenance?.forgeQuality), by, hint: PLAYER_HINT[r.effectType] || 'an unknown process is running' };
    }),
    defuse: async (residentId, actor) => {
      if (gm) await term.updateResident(item, residentId, { state: 'defused' });
      else game.nightcity?.socketManager?.emit(SOCKET_OPS.TERMINAL_RESIDENT_REQUEST, { op: 'defuse', itemUuid: item.uuid, residentId, userId: game.user.id });
      game.nightcity?.traceService?.logSuccess?.({ actor, action: 'sweep-defuse', source: 'resident', hostItem: item, severity: 'minor' });
    },
  };
}

/** The modal shell. */
function panelHtml(forceReveal, sub = '') {
  return `
  <div class="ncm-sweep" data-ct-color="cyan" role="dialog" aria-modal="true">
    <div class="ncm-sweep__bar"></div>
    <span class="ncm-sweep__ck ncm-sweep__ck--tl"></span><span class="ncm-sweep__ck ncm-sweep__ck--tr"></span>
    <span class="ncm-sweep__ck ncm-sweep__ck--bl"></span><span class="ncm-sweep__ck ncm-sweep__ck--br"></span>
    <div class="ncm-sweep__hd">
      <span class="ncm-sweep__tag"><i class="fas fa-satellite-dish"></i> SYSTEM SWEEP</span>
      <span class="ncm-sweep__sub">${esc(sub || 'deep-scan this host for installed programs')}</span>
    </div>
    <div class="ncm-sweep__ctx">
      <span class="ncm-sweep__chip"><i class="fas fa-microchip"></i> INTERFACE</span>
      <span class="ncm-sweep__chip"><i class="fas fa-dice-d20"></i> ROLL <b>vs</b> each hidden process</span>
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

/** One detected card from a source view — role-aware (GM = full intel, player = vague). */
function hitHtml(r, gm) {
  const q = Number(r.quality);
  const tell = Number.isFinite(q)
    ? (q < SLOPPY_QUALITY
      ? '<span class="ncm-sweep__pill ncm-sweep__pill--sloppy">FORGED — SLOPPY</span>'
      : '<span class="ncm-sweep__pill ncm-sweep__pill--clean">WELL-MADE</span>')
    : '';
  if (gm) {
    return `<div class="ncm-sweep__hit" data-id="${esc(r.id)}">
      <span class="ncm-sweep__hit-ico"><i class="fas ${esc(r.icon || 'fa-bug')}"></i></span>
      <span class="ncm-sweep__hit-nm">
        <span class="ncm-sweep__hit-t">${esc(r.gmTitle)}
          <span class="ncm-sweep__pill ncm-sweep__pill--type">${esc(r.gmType || 'PROGRAM')}</span>${tell}</span>
        <span class="ncm-sweep__hit-meta"><span>PLANTED BY ${esc(r.by || 'unknown')}</span><span>STEALTH DV ${Number(r.stealthDV) || 0}</span></span>
      </span>
      <button type="button" class="ncm-sweep__defuse"><i class="fas fa-eraser"></i> DEFUSE</button>
    </div>`;
  }
  return `<div class="ncm-sweep__hit" data-id="${esc(r.id)}">
    <span class="ncm-sweep__hit-ico"><i class="fas fa-triangle-exclamation"></i></span>
    <span class="ncm-sweep__hit-nm">
      <span class="ncm-sweep__hit-t">UNKNOWN PROCESS</span>
      <span class="ncm-sweep__hit-d">${esc(r.hint || 'an unknown process is running')}</span>
    </span>
    <button type="button" class="ncm-sweep__defuse"><i class="fas fa-eraser"></i> DEFUSE</button>
  </div>`;
}
