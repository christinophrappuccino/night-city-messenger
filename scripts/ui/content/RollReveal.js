/**
 * ROLL REVEAL — the shared climax for a skill check that has no animation of
 * its own (network bypass, terminal logins, message network bypass, anonymous
 * trace). Dev-approved mock: dev/mockups/roll-reveal-mock.html.
 *
 * The roll is ALREADY computed when this runs; the reveal plays it back:
 * the stat and skill tiles light, the d10 spins and lands (a 10 / a 1 flashes
 * and rolls the second die — CPR's crit / fumble), the total counts into a bar
 * against the DV line, the verdict lands, and only then does `onChat` fire —
 * so the chat card never spoils a result the player is still watching.
 *
 * Built like the boot splash: ONE deterministic `paint(p)` (p = 0..1) fed by
 * rAF, so reduced motion is "paint(1) and stop" and a wall clock can finish a
 * run whose frame loop stalled (a hidden tab stops rAF). Framework-free, mounted
 * into the window that asked for the roll, so it wears that window's palette.
 * Click skips to the result; a second click after it lands dismisses.
 *
 * Called by SkillService.performCheck({ reveal }) — never by hand from a viewer.
 */

const BASE_MS = 2600;      // a plain roll
const SECOND_MS = 3500;    // a crit or fumble rolls a second die
const HOLD_MS = 900;       // the verdict stays readable this long
const FADE_MS = 200;       // matches .ncm-rr-scrim.is-out in roll-reveal.css

const clamp = (x) => Math.min(1, Math.max(0, x));
const local = (p, [a, b]) => (b <= a ? (p >= a ? 1 : 0) : clamp((p - a) / (b - a)));
const easeOut = (u) => 1 - Math.pow(1 - u, 3);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Beat windows as fractions of the run. Exported for the sim. */
export function revealStages(second) {
  return second ? {
    open: [0, .07], stat: [.07, .15], skill: [.13, .21], luck: [.19, .25],
    die: [.24, .52], flag: [.52, .58], die2: [.58, .78], count: [.78, .86], verdict: [.86, .93], chat: [.95, 1],
  } : {
    open: [0, .09], stat: [.09, .19], skill: [.16, .26], luck: [.23, .31],
    die: [.30, .70], flag: [1, 1], die2: [1, 1], count: [.70, .82], verdict: [.82, .91], chat: [.94, 1],
  };
}

/** A slot-machine digit that decelerates and lands on `final`. */
function spinDigit(u, final, seed) {
  if (u >= 1) return final;
  const ticks = Math.floor(easeOut(u) * 22);
  const x = Math.sin((ticks + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return 1 + Math.floor((x - Math.floor(x)) * 10);
}

/** Should the reveal skip its motion? OS reduced motion or the module's animation pref. Can only VETO. */
function motionVetoed() {
  try { if (game.nightcity?.themeService?.getAnimationLevel?.() === 'off') return true; } catch { /* no theme service */ }
  try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/**
 * Play the reveal.
 * @param {object} o
 * @param {HTMLElement} [o.host] the window that asked for the roll (body when absent)
 * @param {object} o.result a SkillService.performCheck result
 * @param {string} o.skillName
 * @param {string} [o.title] what the roll is for ("Bypassing CorpNet")
 * @param {string} [o.ctx] the record line ("Network bypass · CorpNet")
 * @param {string} [o.who] the operator's name
 * @param {string} [o.ok] verdict on success
 * @param {string} [o.no] verdict on failure
 * @param {boolean} [o.sound=true] spin + verdict sounds
 * @param {boolean} [o.verdictSound=true] false when the caller plays its own
 *   outcome sound right after (a terminal login's sound set)
 * @param {boolean} [o.hideDV] countermeasure visibility: the DV line carries no
 *   number ("DV ??") until the verdict lands, then the DV appears (the chat card,
 *   posted at the verdict, shows it too). You learn how hard it was by trying.
 * @param {() => any} [o.onChat] fired once, when the verdict has landed
 * @returns {Promise<void>} resolves once the reveal is gone
 */
export function playRollReveal(o = {}) {
  return new Promise((resolve) => {
    const r = o.result || {};
    const onChat = typeof o.onChat === 'function' ? o.onChat : () => {};
    let chatFired = false;
    const fireChat = () => { if (chatFired) return; chatFired = true; try { onChat(); } catch (e) { console.warn('NCM | roll reveal chat failed', e); } };

    const host = o.host && o.host.isConnected ? o.host : document.body;
    if (!host) { fireChat(); resolve(); return; }

    const sound = o.sound !== false ? game.nightcity?.soundService : null;
    const isCrit = !!r.isCritical, isFumble = !!r.isFumble, second = isCrit || isFumble;
    const raw = Number(r.rollValue) || 0;
    const dieTotal = Number(r.processedRoll ?? raw) || 0;
    const die2 = isCrit ? dieTotal - 10 : isFumble ? 1 - dieTotal : 0;
    const statShown = r.statName && r.statName !== 'none';
    const statVal = Number(r.statValue) || 0, skillVal = Number(r.skillLevel) || 0;
    const luck = Number(r.luckSpent) || 0, mod = Number(r.modifier) || 0;
    const total = Number(r.total) || 0, dv = Number(r.dc) || 0;
    const success = !!r.success, margin = Number(r.margin ?? total - dv) || 0;
    const S = revealStages(second);
    const duration = second ? SECOND_MS : BASE_MS;

    // ── markup ──
    const tile = (k, val, label, extra = '') => `<div class="ncm-rr__tile ${extra}" data-k="${k}"><span class="ncm-rr__val">${esc(val)}</span><span class="ncm-rr__lbl" title="${esc(label)}">${esc(label)}</span></div>`;
    const op = (k, sym) => `<span class="ncm-rr__op" data-k="${k}">${sym}</span>`;
    const parts = [];
    if (statShown) parts.push(tile('stat', statVal, String(r.statName).toUpperCase()), op('op1', '+'));
    parts.push(tile('skill', skillVal, o.skillName || 'Skill'));
    if (luck) parts.push(op('op3', '+'), tile('luck', luck, 'Luck'));
    if (mod) parts.push(op('op4', mod > 0 ? '+' : '−'), tile('mod', Math.abs(mod), 'Bonus'));
    parts.push(op('op2', '+'),
      `<div class="ncm-rr__tile ncm-rr__tile--die" data-k="die"><span class="ncm-rr__flag"></span><span class="ncm-rr__die2"></span><span class="ncm-rr__val ncm-rr__dieval">–</span><span class="ncm-rr__lbl">1d10</span></div>`,
      op('eq', '='),
      `<div class="ncm-rr__tile ncm-rr__tile--total" data-k="total"><span class="ncm-rr__val ncm-rr__totval">–</span><span class="ncm-rr__lbl">Total</span></div>`);

    const scrim = document.createElement('div');
    scrim.className = 'ncm-rr-scrim' + (host === document.body ? ' ncm-rr-scrim--fixed' : '');
    scrim.innerHTML = `
      <div class="ncm-rr" data-tone="cyan" role="status" aria-live="polite">
        <span class="ncm-rr__brk ncm-rr__brk--tl"></span><span class="ncm-rr__brk ncm-rr__brk--tr"></span>
        <span class="ncm-rr__brk ncm-rr__brk--bl"></span><span class="ncm-rr__brk ncm-rr__brk--br"></span>
        <div class="ncm-rr__top"><span class="ncm-rr__kind">Skill check</span><span class="ncm-rr__ctx">${esc(o.ctx || '')}</span><span class="ncm-rr__who">${esc(o.who || '')}</span></div>
        <div class="ncm-rr__title">${esc(o.title || `${o.skillName || 'Skill'} check`)}</div>
        <div class="ncm-rr__eq">${parts.join('')}</div>
        <div class="ncm-rr__meter"><div class="ncm-rr__track"><div class="ncm-rr__fill"></div><div class="ncm-rr__dv"></div></div><span class="ncm-rr__dvtag">DV ${o.hideDV ? '??' : esc(dv)}</span></div>
        <div class="ncm-rr__verdict"><span class="ncm-rr__vtxt"></span><span class="ncm-rr__margin"></span></div>
        <div class="ncm-rr__foot"><span class="ncm-rr__status">Rolling…</span><span class="ncm-rr__skip">click to skip</span><span class="ncm-rr__chat"><i class="fas fa-check"></i> Posted to chat</span></div>
      </div>`;
    host.appendChild(scrim);
    const rr = scrim.querySelector('.ncm-rr');
    const q = (k) => rr.querySelector(`[data-k="${k}"]`);
    const els = {
      die: q('die'), dieVal: rr.querySelector('.ncm-rr__dieval'), totVal: rr.querySelector('.ncm-rr__totval'),
      flag: rr.querySelector('.ncm-rr__flag'), die2: rr.querySelector('.ncm-rr__die2'),
      dvtag: rr.querySelector('.ncm-rr__dvtag'),
      vtxt: rr.querySelector('.ncm-rr__vtxt'), vmargin: rr.querySelector('.ncm-rr__margin'), status: rr.querySelector('.ncm-rr__status'),
    };
    const scale = Math.max(dv + 6, total + 3, 20);
    rr.style.setProperty('--dvx', (clamp(dv / scale)).toFixed(4));

    const fired = new Set();
    const once = (k, fn) => { if (!fired.has(k)) { fired.add(k); fn(); } };
    const show = (k, u) => q(k)?.style.setProperty('--o', easeOut(u).toFixed(3));

    function paint(p) {
      rr.style.setProperty('--rr-open', easeOut(local(p, S.open)).toFixed(3));
      const uStat = local(p, S.stat), uSkill = local(p, S.skill), uLuck = local(p, S.luck);
      show('stat', uStat); show('op1', uSkill); show('skill', uSkill);
      show('op3', uLuck); show('luck', uLuck); show('op4', uLuck); show('mod', uLuck);
      q('stat')?.classList.toggle('is-lit', uStat >= 1);
      q('skill')?.classList.toggle('is-lit', uSkill >= 1);
      let running = (statShown ? statVal * easeOut(uStat) : 0) + skillVal * easeOut(uSkill) + (luck + mod) * easeOut(uLuck);

      const uDie = local(p, S.die), uFlag = local(p, S.flag), uDie2 = local(p, S.die2);
      show('op2', Math.min(1, uDie * 4)); show('die', Math.min(1, uDie * 4));
      const spinning = (uDie > 0 && uDie < 1) || (second && uDie2 > 0 && uDie2 < 1);
      if (uDie > 0) once('spin', () => sound?.play?.('hack-progress'));
      els.die.classList.toggle('is-spinning', uDie > 0 && uDie < 1);
      els.die.style.setProperty('--blur', (uDie > 0 && uDie < 1) ? `${(1 - easeOut(uDie)) * 2.2}px` : '0px');
      els.die.style.setProperty('--scanO', spinning ? '1' : '0');
      els.die.style.setProperty('--scan', `${100 - ((second && uDie >= 1 ? uDie2 : uDie) * 600) % 100}%`);
      els.dieVal.textContent = uDie <= 0 ? '–' : String(spinDigit(uDie, raw, 1));

      let tone = 'cyan';
      if (second && uDie >= 1) {
        tone = isCrit ? 'crit' : 'fumble';
        els.flag.textContent = isCrit ? 'Critical · roll again' : 'Fumble · roll again';
        els.flag.style.setProperty('--fo', '1');
        els.flag.style.setProperty('--fs', (0.6 + 0.4 * easeOut(uFlag)).toFixed(3));
        once('second', () => rr.classList.add(isCrit ? 'is-crit' : 'is-glitch'));
        if (uDie2 > 0) {
          els.die2.textContent = (isCrit ? '+' : '−') + (uDie2 >= 1 ? die2 : spinDigit(uDie2, die2, 7));
          els.die2.style.setProperty('--o2', '1');
        }
        if (uDie2 >= 1) els.dieVal.textContent = String(dieTotal);
      }
      if (uDie >= 1) running += (second && uDie2 < 1) ? raw : dieTotal;

      const uCount = local(p, S.count);
      show('eq', uCount); show('total', uCount);
      els.totVal.textContent = uCount > 0 ? String(uCount >= 1 ? total : Math.round(running)) : '–';
      rr.style.setProperty('--fill', clamp((uCount >= 1 ? total : running) / scale).toFixed(4));

      const uV = local(p, S.verdict);
      if (uV > 0) {
        tone = success ? (isCrit ? 'crit' : 'ok') : 'fail';
        const word = (w, d) => (typeof w === 'function' ? w(r) : w) || d;   // a verdict may depend on the margin (a scan: identified vs detected)
        els.vtxt.textContent = success ? word(o.ok, 'Success') : word(o.no, 'Failed');
        els.vmargin.textContent = margin === 0 ? 'exactly DV' : (margin > 0 ? `+${margin} over DV` : `${margin} under DV`);
        once('verdict', () => {
          if (o.hideDV && els.dvtag) els.dvtag.textContent = `DV ${dv}`;
          if (!success) rr.classList.add('is-shake');
          if (o.verdictSound !== false) sound?.play?.(success ? 'hack-success' : 'hack-fail');
        });
      }
      rr.style.setProperty('--vo', easeOut(uV).toFixed(3));
      rr.dataset.tone = tone;

      const uChat = local(p, S.chat);
      if (uChat > 0) fireChat();
      rr.style.setProperty('--co', easeOut(uChat).toFixed(3));
      els.status.textContent = uV >= 1
        ? (isCrit && success ? 'Critical success.' : isFumble ? 'Fumbled.' : 'Check resolved.')
        : spinning ? 'Rolling 1d10…' : uCount > 0 ? 'Tallying…' : 'Reading stats…';
    }

    // ── driver ──
    let start = null, raf = 0, done = false, landed = false, holdTimer = 0, capTimer = 0;
    const finish = () => {
      if (done) return; done = true;
      cancelAnimationFrame(raf); clearTimeout(holdTimer); clearTimeout(capTimer);
      paint(1); fireChat();
      scrim.classList.add('is-out');
      setTimeout(() => { scrim.remove(); resolve(); }, FADE_MS);
    };
    const land = () => {
      if (landed) return; landed = true;
      cancelAnimationFrame(raf); paint(1);
      holdTimer = setTimeout(finish, HOLD_MS);
    };
    const frame = (ts) => {
      if (done || landed) return;
      if (start === null) start = ts;
      const p = clamp((ts - start) / duration);
      paint(p);
      if (p >= 1) land(); else raf = requestAnimationFrame(frame);
    };
    scrim.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (landed) finish(); else land(); });

    // No motion: straight to the verdict — the spin sound would only stack on the verdict's.
    if (motionVetoed()) { fired.add('spin'); land(); return; }
    paint(0);
    raf = requestAnimationFrame(frame);
    // rAF stops in a hidden tab; the wall clock still finishes the run.
    capTimer = setTimeout(land, duration + 400);
  });
}
