/**
 * OperatorSelect — the immersive "who am I jacked in as" picker.
 * @file scripts/ui/content/OperatorSelect.js
 * @module night-city-messenger
 * @description A framework-free promise modal (the SecurityConsole / BankHeist
 *   pattern — NOT an Application): a themed `.ncm-opsel` panel appended into
 *   `opts.host` (the viewer element, so it inherits that viewer's --ncm-*
 *   preset; falls back to document.body = brand defaults).
 *
 *   Diegetically this is a BIOMETRIC HANDOFF: the deck re-reads whoever is
 *   holding it. Pick a card → the panel runs an identity-verification beat
 *   (scan sweep → CONFIRMED) → resolves. Reduced-motion collapses to instant.
 *
 *   The OPERATOR is the character every roll, siphon, eddies claim, and
 *   skill/stat read acts as (`resolveOperator()` in helpers.js) — this modal
 *   only *chooses* it; `setOperatorActor` persists the pick.
 */

import { log } from '../../utils/helpers.js';

/** Minimal HTML escaper. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The CPR role item is the closest thing to a "job title" on the card. */
function _roleOf(actor) {
  try {
    const role = actor.items?.find(i => i.type === 'role');
    return role?.name || (actor.type === 'character' ? 'Operator' : 'Unit');
  } catch { return 'Operator'; }
}

/** A couple of vitals for the card readout — flavor, read live off the sheet. */
function _vitalsOf(actor) {
  const s = actor.system?.stats ?? {};
  const val = (k) => {
    const v = s[k];
    const n = v?.value ?? (typeof v === 'number' ? v : null);
    return n == null ? '—' : String(n);
  };
  return [
    { k: 'INT', v: val('int') },
    { k: 'REF', v: val('ref') },
    { k: 'TECH', v: val('tech') },
    { k: 'COOL', v: val('cool') },
  ];
}

/**
 * Open the operator select. Resolves with the chosen actor id, or null on
 * cancel / no change.
 * @param {object} opts
 * @param {Actor[]} opts.actors      the actors this user may act as
 * @param {string}  [opts.currentId] the operator right now
 * @param {HTMLElement} [opts.host]  viewer element (theme source)
 * @returns {Promise<string|null>}
 */
export function runOperatorSelect({ actors = [], currentId = '', host = null } = {}) {
  return new Promise((resolve) => {
    if (!actors.length) { resolve(null); return; }

    let reduced = false;
    try { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no */ }

    const mount = host || document.body;
    const wrap = document.createElement('div');
    wrap.className = 'ncm-opsel-backdrop';

    const cards = actors.map((a, i) => {
      const isCur = a.id === currentId;
      const vitals = _vitalsOf(a).map(v => `<span class="ncm-opsel__vit"><b>${esc(v.k)}</b>${esc(v.v)}</span>`).join('');
      const portrait = a.img
        ? `<img src="${esc(a.img)}" alt="">`
        : `<i class="fas fa-user"></i>`;
      return `
        <button type="button" class="ncm-opsel__card${isCur ? ' is-current' : ''}" data-op-id="${esc(a.id)}" style="--i:${i}">
          <span class="ncm-opsel__ck ncm-opsel__ck--tl"></span><span class="ncm-opsel__ck ncm-opsel__ck--br"></span>
          <span class="ncm-opsel__port">${portrait}<span class="ncm-opsel__scan"></span></span>
          <span class="ncm-opsel__id">
            <span class="ncm-opsel__nm">${esc(a.name)}</span>
            <span class="ncm-opsel__role">${esc(_roleOf(a))}</span>
            <span class="ncm-opsel__vits">${vitals}</span>
          </span>
          ${isCur ? '<span class="ncm-opsel__cur">ACTIVE</span>' : '<span class="ncm-opsel__sel">SELECT</span>'}
        </button>`;
    }).join('');

    wrap.innerHTML = `
      <div class="ncm-opsel" role="dialog" aria-modal="true">
        <div class="ncm-opsel__bar"></div>
        <div class="ncm-opsel__hd">
          <span class="ncm-opsel__tag"><i class="fas fa-fingerprint"></i> BIOMETRIC HANDOFF</span>
          <span class="ncm-opsel__sub">the deck re-reads whoever's holding it</span>
        </div>
        <div class="ncm-opsel__note">Rolls, siphoned eddies, claimed funds and skill checks all run as this operator.</div>
        <div class="ncm-opsel__grid">${cards}</div>
        <div class="ncm-opsel__verify">
          <span class="ncm-opsel__vline"></span>
          <span class="ncm-opsel__vtx">VERIFYING IDENTITY…</span>
        </div>
        <div class="ncm-opsel__ft">
          <button type="button" class="ncm-opsel__cancel">CANCEL</button>
        </div>
      </div>`;

    const cleanup = (val) => {
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    };

    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) { cleanup(null); return; }                    // backdrop
      if (e.target.closest('.ncm-opsel__cancel')) { cleanup(null); return; }
      const card = e.target.closest('.ncm-opsel__card');
      if (!card) return;
      const id = card.dataset.opId;
      if (id === currentId) { cleanup(null); return; }                     // already them

      // Verification beat — the panel confirms the handoff, then resolves.
      const panel = wrap.querySelector('.ncm-opsel');
      panel.querySelectorAll('.ncm-opsel__card').forEach(c => c.classList.toggle('is-picked', c === card));
      panel.classList.add('is-verifying');
      // Keep the picked card in view — with a long roster it can sit well above
      // the fold, and the verify bar reads as "nothing happened" from up there.
      try { card.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' }); } catch { /* older DOM */ }
      if (reduced) { cleanup(id); return; }
      const tx = panel.querySelector('.ncm-opsel__vtx');
      const name = actors.find(a => a.id === id)?.name || 'OPERATOR';
      setTimeout(() => {
        panel.classList.add('is-confirmed');
        if (tx) tx.textContent = `IDENTITY CONFIRMED — ${String(name).toUpperCase()}`;
        try { game.nightcity?.soundService?.play('login-success'); } catch { /* no sound */ }
      }, 900);
      setTimeout(() => cleanup(id), 1650);
    });

    document.addEventListener('keydown', onKey, true);
    mount.appendChild(wrap);
    try { game.nightcity?.soundService?.play('click'); } catch { /* no sound */ }
    log.debug(`OperatorSelect: ${actors.length} candidate(s), current=${currentId || 'none'}.`);
  });
}
