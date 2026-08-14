/**
 * ResidentConsole — "a planted program just triggered; what now?"
 * @file scripts/ui/content/ResidentConsole.js
 * @module cyberpunkred-messenger
 * @description A framework-free promise modal (the SecurityConsole / OperatorSelect
 *   / BankHeist pattern — NOT an Application): a themed `.ncm-rescon` panel appended
 *   into `opts.host` (an open viewer of that terminal, so it inherits that machine's
 *   --ncm-* preset; falls back to document.body = brand defaults). This replaced a
 *   raw Foundry `Dialog` with inline styles — the one modal in the upload arc that
 *   never got the treatment.
 *
 *   WHY IT PAUSES AT ALL (this was invisible and needed saying out loud): a plant
 *   firing is the moment a table may want to actually run the NET. NCM never
 *   pretends to BE netrunning (design §5) — it hands the table the pause, then
 *   applies whatever they decide. The panel says so, names the netrun-equivalent
 *   verb, and points at the setting for tables that don't play it that way.
 *
 *   GM-only. Resolves 'fire' | 'defuse' | 'later'.
 */

import { log } from '../../utils/helpers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The NET-action each resident effect is an abstraction OF (design §5's `netAction`
 * vocabulary). Naming it is the whole point of the pause: the GM sees "this is a
 * Backdoor-class action" and can run it as one.
 */
const NET_VERB = {
  plant: 'Control / Data forgery — the file appears on the host',
  forgeAccount: 'Backdoor — a hidden account on the host',
  keylog: 'Eye-Dee / Scanner — passive capture',
  logicBomb: 'Virus — destructive payload',
  deployICE: 'Black ICE — hostile program left behind',
  wipe: 'Virus — purge host entries',
  adjudicate: 'GM-adjudicated program',
};

/** A forge quality → how obvious the forgery is to a scan. */
function _forgeTell(q) {
  const n = Number(q);
  if (!n && n !== 0) return null;
  if (n >= 75) return { label: 'CLEAN', tone: 'ok' };
  if (n >= 45) return { label: 'PASSABLE', tone: 'warn' };
  return { label: 'SLOPPY — A SCAN WILL FLAG IT', tone: 'fail' };
}

/**
 * Show the trigger prompt.
 * @param {object} o
 * @param {string} o.label  the resident's noun phrase from _residentLabel, e.g.
 *   "planted file" — the lead renders "A {label} just triggered", so do NOT prefix
 *   it with "planted" at the call site (that read "A planted planted file").
 *   NB: keep backticks out of this builder's template literal — one in an HTML
 *   comment terminated the string and the whole modal silently failed to render.
 * @param {object} o.resident     the resident record
 * @param {string} o.hostName     the terminal's name
 * @param {string} o.who          who tripped it ("V" / "the system clock")
 * @param {string} [o.mailbox]    target account display name
 * @param {HTMLElement} [o.host]  element to append into (theme source)
 * @returns {Promise<'fire'|'defuse'|'later'>}
 */
export function runResidentConsole({ label, resident = {}, hostName = 'the terminal', who = 'someone', mailbox = '', host = null } = {}) {
  return new Promise((resolve) => {
    const mount = host || document.body;
    const isPlant = (resident.effectType || 'plant') === 'plant';
    const tell = _forgeTell(resident.provenance?.forgeQuality);
    const planter = resident.provenance?.plantedBy ? (game.actors?.get(resident.provenance.plantedBy)?.name || 'an operator') : null;
    const netVerb = NET_VERB[resident.effectType] || NET_VERB.adjudicate;

    const el = document.createElement('div');
    el.className = 'ncm-rescon-backdrop';
    el.innerHTML = `
      <div class="ncm-rescon" data-ct-color="${isPlant ? 'purple' : 'red'}" role="dialog" aria-modal="true">
        <span class="ncm-rescon__br ncm-rescon__br--tl"></span><span class="ncm-rescon__br ncm-rescon__br--tr"></span>
        <span class="ncm-rescon__br ncm-rescon__br--bl"></span><span class="ncm-rescon__br ncm-rescon__br--br"></span>
        <div class="ncm-rescon__top">
          <i class="fas ${isPlant ? 'fa-syringe' : 'fa-bolt'}"></i>
          <span class="ncm-rescon__title">RESIDENT TRIGGERED</span>
          <span class="ncm-rescon__host">${esc(hostName)}</span>
        </div>

        <div class="ncm-rescon__body">
          <div class="ncm-rescon__lead">
            A <b>${esc(label)}</b> just triggered — <b>${esc(who)}</b> on <b>${esc(hostName)}</b>.
          </div>

          <div class="ncm-rescon__facts">
            ${mailbox ? `<div class="ncm-rescon__fact"><span class="k">Lands in</span><span class="v">${esc(mailbox)}</span></div>` : ''}
            ${planter ? `<div class="ncm-rescon__fact"><span class="k">Planted by</span><span class="v">${esc(planter)}</span></div>` : ''}
            <div class="ncm-rescon__fact"><span class="k">Trigger</span><span class="v">${esc(resident.trigger?.kind || 'manual')}</span></div>
            ${tell ? `<div class="ncm-rescon__fact"><span class="k">Forgery</span><span class="v is-${tell.tone}">${esc(tell.label)}</span></div>` : ''}
          </div>

          <div class="ncm-rescon__net">
            <div class="ncm-rescon__net-hd"><i class="fas fa-network-wired"></i> THIS IS THE NETRUN PAUSE</div>
            <p>If your table resolves this as a NET action, run it now — then Fire or Defuse below.
               NCM isn't rolling for it; it only applies what you decide.</p>
            <p class="ncm-rescon__net-verb">Closest NET action: <b>${esc(netVerb)}</b></p>
            <p class="ncm-rescon__net-cfg">Don't play it this way? <b>Settings → Planted Programs — When They Fire</b> can fire these automatically.</p>
          </div>
        </div>

        <div class="ncm-rescon__foot">
          <button type="button" class="ncm-rescon__btn" data-act="later">Leave armed</button>
          <span class="ncm-rescon__grow"></span>
          <button type="button" class="ncm-rescon__btn ncm-rescon__btn--defuse" data-act="defuse"><i class="fas fa-shield-halved"></i> Defuse</button>
          <button type="button" class="ncm-rescon__btn ncm-rescon__btn--fire" data-act="fire"><i class="fas fa-bolt"></i> Fire it</button>
        </div>
      </div>`;

    let done = false;
    const finish = (choice) => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      el.classList.add('is-closing');
      setTimeout(() => el.remove(), reduced() ? 0 : 160);
      resolve(choice);
    };
    // ESC / backdrop = "later" (never destructive — the resident stays armed).
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish('later'); } };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (ev) => {
      if (ev.target === el) return finish('later');
      const act = ev.target.closest('[data-act]')?.dataset?.act;
      if (act) finish(act);
    });

    mount.appendChild(el);
    if (!reduced()) requestAnimationFrame(() => el.classList.add('is-in'));
    else el.classList.add('is-in');
    // 'receive-urgent' — a real SOUND_PATHS id. (An unknown id fails silently, so
    // never guess one: the ids are the frozen SOUND_PATHS map in constants.js.)
    try { game.nightcity?.soundService?.play?.('receive-urgent'); } catch { /* sound is optional */ }
    log.debug(`ResidentConsole: prompting for "${label}" on ${hostName}`);
    wait(0);
  });
}
