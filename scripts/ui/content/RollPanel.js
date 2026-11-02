/**
 * Roll panel — what you are about to roll, your chance, and Luck / a modifier, before the die moves.
 * @file scripts/ui/content/RollPanel.js
 * @module night-city-messenger
 *
 * Two forms of one thing:
 *   rollControlsHtml() + wireRollControls() — the block, for a window that already has an Attempt button (SecurityConsole).
 *   askRoll()                               — the block in its own small modal (SkillService.performCheck({ ask })).
 * The numbers come from the same SkillService read the roll uses, so the panel and the roll cannot disagree. A hidden DV
 * (countermeasure visibility) stays hidden: no DV and no chance are written into the DOM.
 * Framework-free, mounted into the asking window so it wears that window's palette.
 */

import { MODULE_ID } from '../../utils/constants.js';
import { d10Odds, oddsWord, rollParts } from '../../utils/rolls.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const MOD_RANGE = 10;

/** The data the panel shows, from the actor's sheet. */
export function rollPanelData(actor, skill, dv, { hideDV = false, modifier = 0 } = {}) {
  const svc = game.nightcity?.skillService;
  const d = svc?.getSkillData?.(actor, skill) || {};
  return {
    skill, dv: Number(dv) || 0, hideDV: !!hideDV,
    statName: d.statName, statValue: Number(d.statValue) || 0, skillLevel: Number(d.skillLevel) || 0,
    luckMax: Math.max(0, Number(svc?.getAvailableLuck?.(actor)) || 0),
    baseModifier: Number(modifier) || 0,
  };
}

/** The block's inner state → what is shown. Pure. */
export function rollPanelView(data, luck = 0, modifier = 0) {
  const base = data.statValue + data.skillLevel + data.baseModifier + luck + modifier;
  const odds = data.dv > 0 ? d10Odds(base, data.dv) : { pct: 100, need: 0 };
  const tone = odds.pct >= 65 ? 'good' : odds.pct >= 35 ? 'attn' : 'bad';
  const parts = rollParts({ statName: data.statName, statValue: data.statValue, skillName: data.skill, skillLevel: data.skillLevel, luck, modifier: data.baseModifier + modifier });
  return { base, parts, pct: odds.pct, need: odds.need, tone, word: oddsWord(odds.pct) };
}

const partsHtml = (parts) => parts.map((p) => `<span class="ncm-rollp__part"><small>${esc(p.label)}</small><b>${p.value > 0 && p.label === 'Modifier' ? '+' : ''}${p.value}</b></span><span class="ncm-rollp__plus">+</span>`).join('');

/** The block's HTML. */
export function rollControlsHtml(data) {
  const v = rollPanelView(data);
  return `<div class="ncm-rollp" data-rollp>
    <div class="ncm-rollp__sum" data-rollp-parts>${partsHtml(v.parts)}<span class="ncm-rollp__part ncm-rollp__part--die"><small>Die</small><b>d10</b></span></div>
    ${data.hideDV ? `<div class="ncm-rollp__chance is-hidden"><i class="fas fa-eye-slash"></i> You can't tell how hard this is.</div>` : `<div class="ncm-rollp__chance" data-tone="${v.tone}" data-rollp-chance>
      <span class="ncm-rollp__dv">beat <b>DV ${data.dv}</b></span>
      <span class="ncm-rollp__meter"><i data-rollp-fill style="width:${v.pct}%"></i></span>
      <span class="ncm-rollp__pct" data-rollp-pct>${v.pct}%</span>
      <span class="ncm-rollp__word" data-rollp-word>${esc(v.word)}</span>
    </div>`}
    <div class="ncm-rollp__knobs">
      <div class="ncm-rollp__knob${data.luckMax ? '' : ' is-off'}">
        <span class="ncm-rollp__klbl"><i class="fas fa-clover"></i> Luck <small data-rollp-luckleft>${data.luckMax} left</small></span>
        <span class="ncm-rollp__step"><button type="button" data-rollp-step="luck" data-d="-1" aria-label="Less Luck"><i class="fas fa-minus"></i></button><b data-rollp-val="luck">0</b><button type="button" data-rollp-step="luck" data-d="1" aria-label="More Luck"><i class="fas fa-plus"></i></button></span>
      </div>
      <div class="ncm-rollp__knob">
        <span class="ncm-rollp__klbl"><i class="fas fa-sliders"></i> Modifier</span>
        <span class="ncm-rollp__step"><button type="button" data-rollp-step="mod" data-d="-1" aria-label="Lower modifier"><i class="fas fa-minus"></i></button><b data-rollp-val="mod">0</b><button type="button" data-rollp-step="mod" data-d="1" aria-label="Raise modifier"><i class="fas fa-plus"></i></button></span>
      </div>
    </div>
  </div>`;
}

/** Wire the block. @returns {() => {luck:number, modifier:number}} read the choice */
export function wireRollControls(root, data) {
  let luck = 0, mod = 0;
  const box = root.querySelector('[data-rollp]');
  if (!box) return () => ({ luck: 0, modifier: 0 });
  const paint = () => {
    const v = rollPanelView(data, luck, mod);
    box.querySelector('[data-rollp-val="luck"]').textContent = luck;
    box.querySelector('[data-rollp-val="mod"]').textContent = mod > 0 ? `+${mod}` : mod;
    box.querySelector('[data-rollp-luckleft]').textContent = `${data.luckMax - luck} left`;
    box.querySelector('[data-rollp-parts]').innerHTML = `${partsHtml(v.parts)}<span class="ncm-rollp__part ncm-rollp__part--die"><small>Die</small><b>d10</b></span>`;
    const c = box.querySelector('[data-rollp-chance]');
    if (c) {
      c.dataset.tone = v.tone;
      c.querySelector('[data-rollp-fill]').style.width = `${v.pct}%`;
      c.querySelector('[data-rollp-pct]').textContent = `${v.pct}%`;
      c.querySelector('[data-rollp-word]').textContent = v.word;
    }
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rollp-step]'); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const d = Number(b.dataset.d) || 0;
    if (b.dataset.rollpStep === 'luck') luck = clamp(luck + d, 0, data.luckMax);
    else mod = clamp(mod + d, -MOD_RANGE, MOD_RANGE);
    paint();
  });
  return () => ({ luck, modifier: mod });
}

/** May this client be asked? Client setting `askBeforeRoll` (default on). */
export function shouldAskRoll() {
  try { return game.settings.get(MODULE_ID, 'askBeforeRoll') !== false; } catch { return true; }
}

/**
 * The block in its own modal.
 * @param {object} o { actor, skill, dv, title, sub, host, hideDV, modifier, goLabel }
 * @returns {Promise<{luck:number, modifier:number}|null>} null = cancelled
 */
export function askRoll({ actor, skill, dv, title = 'Skill check', sub = '', host = null, hideDV = false, modifier = 0, goLabel = 'Roll' } = {}) {
  if (!actor || !shouldAskRoll()) return Promise.resolve({ luck: 0, modifier: 0 });
  const data = rollPanelData(actor, skill, dv, { hideDV, modifier });
  const mount = host || document.body;
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `ncm-rollp-back${host ? '' : ' ncm-rollp-back--fixed'}`;
    el.innerHTML = `<div class="ncm-rollp-win" role="dialog" aria-modal="true">
      <div class="ncm-rollp-win__hd"><i class="fas fa-dice-d20"></i><span><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span><em>${esc(actor.name)}</em></div>
      ${rollControlsHtml(data)}
      <div class="ncm-rollp-win__ft"><button type="button" data-rp="cancel"><i class="fas fa-xmark"></i> Cancel</button><button type="button" class="is-go" data-rp="go"><i class="fas fa-dice"></i> ${esc(goLabel)}</button></div>
    </div>`;
    mount.appendChild(el);
    const read = wireRollControls(el, data);
    const finish = (v) => { document.removeEventListener('keydown', onKey, true); el.remove(); resolve(v); };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(read()); }
    };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => {
      if (e.target === el) return finish(null);
      const a = e.target.closest('[data-rp]')?.dataset.rp;
      if (a === 'cancel') finish(null);
      else if (a === 'go') finish(read());
    });
    el.querySelector('[data-rp="go"]')?.focus();
  });
}
