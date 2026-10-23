/**
 * NCM boot splash — the Monogram Etch.
 * @file scripts/ui/BootSplash.js
 * @module night-city-messenger
 * @description The mark that plays on the first inbox open of a page load. A small
 *   panel opens from a scanline sliver, the three letters are ETCHED as strokes
 *   inside it, a scan sweeps down and leaves them solid, then a rule draws outward
 *   and the full name unfolds beneath it.
 *
 *   It is a WINDOW, not a takeover: a boot flourish that blacks out the whole
 *   screen reads as an error state, and the header carries the status and the
 *   progress so the mark itself never has to.
 *
 *   It lives in its own module, rather than inside `registerMessagingSystem`, so a
 *   preview can import the REAL thing (`dev/mockups/boot-splash-preview.html`)
 *   instead of a hand-copied lookalike that drifts.
 *
 *   The whole animation is ONE deterministic `paint(p)` with p = 0..1 fed by rAF.
 *   That buys three things worth keeping:
 *     · reduced motion is "paint(1) and stop", not a second code path,
 *     · any frame can be frozen for review,
 *     · and the pace is one number (`DURATION_MS`) rather than a pile of delays
 *       that have to be kept in step with each other.
 */

/** How long the etch takes, start to settled. The ONE pacing knob. */
export const DURATION_MS = 1850;
/** How long the finished mark holds before it goes. */
export const HOLD_MS = 320;
/** The fade. Must match the CSS transition on `.ncm-boot-splash.fade-out`. */
export const FADE_MS = 220;
/** Reduced motion still gets a beat to read the name — it just never moves. */
export const STILL_MS = 700;

/** Stage windows, as fractions of DURATION_MS. Overlapping on purpose: each beat
 *  starts before the one before it has finished, so the splash reads as one move. */
const STAGE = {
  panel:   [0.00, 0.09],   // the window opens from a scanline sliver
  draw:    [0.08, 0.50],   // each letter is drawn, staggered
  stagger: 0.09,           // per-letter offset within the draw window
  fill:    [0.46, 0.76],   // the scan sweeps down and the strokes close up
  rule:    [0.70, 0.88],   // the rule draws outward from the centre
  name:    [0.76, 0.97],   // NIGHT CITY MESSENGER unfolds
};

/** Segments in the header meter. The only place progress is a quantity. */
const METER_SEGMENTS = 14;

/** Letterforms as open paths — they have to be drawable before they are filled. */
const GLYPHS = [
  'M18 112 L18 20 L86 112 L86 20',
  'M178 34 C158 14 120 18 120 66 C120 114 158 118 178 98',
  'M214 112 L214 20 L258 76 L302 20 L302 112',
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
/** How far through the window [a,b] is p. */
const win = (p, [a, b]) => clamp01((p - a) / (b - a));

/**
 * Is motion off for this client? The module preference and the OS setting can
 * each veto; neither can turn motion back ON.
 * @param {{animationsEnabled?: boolean}} [opts]
 * @returns {boolean}
 */
export function splashReduced({ animationsEnabled = true } = {}) {
  const osReduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return osReduced || !animationsEnabled;
}

/**
 * An SVG clipPath is addressed by a DOCUMENT-WIDE id, so two splashes on one page
 * would both resolve to the first one's clip and the second would never fill in.
 * Every call gets its own id rather than trusting that there is only ever one.
 */
let clipSeq = 0;

/** The markup. Kept in one place so the preview and the module can't disagree. */
export function splashMarkup({ version = '' } = {}) {
  const clipId = `ncm-boot-fill-${++clipSeq}`;
  return `
    <div class="ncm-boot-splash__panel" data-el="panel">
      <span class="ncm-boot-splash__brk ncm-boot-splash__brk--tl"></span>
      <span class="ncm-boot-splash__brk ncm-boot-splash__brk--tr"></span>
      <span class="ncm-boot-splash__brk ncm-boot-splash__brk--bl"></span>
      <span class="ncm-boot-splash__brk ncm-boot-splash__brk--br"></span>

      <div class="ncm-boot-splash__head">
        <i class="ncm-boot-splash__head-ic fas fa-microchip"></i>
        <span class="ncm-boot-splash__head-label">Agent Link</span>
        <span class="ncm-boot-splash__meter" data-el="meter">${'<b></b>'.repeat(METER_SEGMENTS)}</span>
        <span class="ncm-boot-splash__state" data-el="state">Etching</span>
        <i class="ncm-boot-splash__hair" data-el="hair"></i>
      </div>

      <div class="ncm-boot-splash__body">
        <div class="ncm-boot-splash__mark">
          <svg class="ncm-boot-splash__svg" viewBox="0 0 340 132" aria-label="NCM">
            <defs>
              <clipPath id="${clipId}"><rect x="0" y="0" width="340" height="0" data-el="clip"/></clipPath>
            </defs>
            <g class="ncm-boot-splash__etch" data-el="etch">
              ${GLYPHS.map((d) => `<path d="${d}"/>`).join('')}
            </g>
            <g class="ncm-boot-splash__solid" clip-path="url(#${clipId})">
              ${GLYPHS.map((d) => `<path d="${d}"/>`).join('')}
            </g>
          </svg>
          <span class="ncm-boot-splash__scan" data-el="scan"></span>
          <div class="ncm-boot-splash__rule" data-el="rule"></div>
          <div class="ncm-boot-splash__name" data-el="name">Night City Messenger</div>
        </div>
      </div>

      <div class="ncm-boot-splash__foot">
        <span>${version ? `agent ${escapeText(version)}` : 'agent'}</span>
        <span class="ncm-boot-splash__ready" data-el="ready">&nbsp;</span>
      </div>
    </div>  `;
}

/** The version string is world data; it is written as TEXT, never as markup. */
function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Build the painter for a mounted splash element.
 * Exported so the preview can scrub it frame by frame.
 * @param {HTMLElement} root
 * @returns {(p: number) => void}
 */
export function splashPainter(root) {
  const q = (k) => root.querySelector(`[data-el="${k}"]`);
  const etch = q('etch');
  const paths = etch ? [...etch.children] : [];
  // getTotalLength only works once the node is in the document, which is why the
  // painter is built AFTER the mount rather than alongside the markup.
  const lens = paths.map((p) => (p.getTotalLength ? p.getTotalLength() : 0));
  paths.forEach((p, i) => { p.style.strokeDasharray = String(lens[i]); });

  const panel = q('panel');
  const meter = q('meter');
  const segs = meter ? [...meter.children] : [];
  const clip = q('clip');
  const scan = q('scan');
  const rule = q('rule');
  const name = q('name');
  const hair = q('hair');
  const state = q('state');
  const ready = q('ready');

  return function paint(p) {
    const t = clamp01(p);

    // 0 · the window opens from a horizontal sliver, the way the terminal's
    // credential keycard does. It must land on clip-path NONE rather than a
    // persisted inset(0), or the finished panel clips its own outer glow.
    if (panel) {
      const open = win(t, STAGE.panel);
      const inset = (1 - open) * 50;
      panel.style.clipPath = open >= 1 ? 'none' : `inset(${inset}% 0 ${inset}% 0)`;
      panel.style.opacity = String(Math.min(1, 0.25 + open));
    }

    // 1 · each letter draws itself, one after the other
    paths.forEach((path, i) => {
      const a = STAGE.draw[0] + i * STAGE.stagger;
      const d = win(t, [a, a + (STAGE.draw[1] - STAGE.draw[0])]);
      path.style.strokeDashoffset = String(lens[i] * (1 - d));
    });

    // 2 · a scan sweeps down; behind it the hairline becomes the letterform
    const fill = win(t, STAGE.fill);
    if (clip) clip.setAttribute('height', String(132 * fill));
    if (scan) {
      scan.style.opacity = fill > 0 && fill < 1 ? '1' : '0';
      scan.style.top = `${fill * 100}%`;
    }
    // The etched outline fades as the solid form takes over, but never all the
    // way — a trace of the construction is the point of the concept.
    if (etch) etch.style.opacity = String(1 - fill * 0.72);

    // 3 · the rule draws outward, and the name unfolds on it
    if (rule) rule.style.transform = `scaleX(${win(t, STAGE.rule)})`;
    if (name) {
      const n = win(t, STAGE.name);
      name.style.opacity = String(n);
      // Letter-spacing closing up reads as the words settling into place.
      name.style.letterSpacing = `${0.5 - (1 - n) * 0.18}em`;
      name.style.textIndent = name.style.letterSpacing;
    }

    if (hair) hair.style.width = `${clamp01(t / 0.95) * 100}%`;
    // The meter lights in whole segments, so it reads as a count rather than a
    // smooth bar the eye cannot measure.
    const lit = Math.round(clamp01(t / 0.95) * segs.length);
    segs.forEach((b, i) => b.classList.toggle('on', i < lit));
    const done = t >= STAGE.fill[1];
    if (state) state.textContent = done ? 'Set' : 'Etching';
    if (ready) ready.textContent = t >= STAGE.name[1] ? 'Ready' : ' ';
    root.classList.toggle('is-set', done);
  };
}

/**
 * Play the splash. Resolves once it has faded and been removed, so the caller can
 * simply `await` it before opening the next window.
 *
 * @param {object}      [opts]
 * @param {HTMLElement} [opts.host]     where to mount (default document.body)
 * @param {boolean}     [opts.reduced]  skip the motion, show the finished mark
 * @param {string}      [opts.version]  shown in the bottom bar
 * @param {number}      [opts.duration] override the pace, for previews
 * @returns {Promise<void>}
 */
export function playBootSplash(opts = {}) {
  const {
    host = document.body,
    reduced = false,
    version = '',
    duration = DURATION_MS,
  } = opts;

  return new Promise((resolve) => {
    if (!host) { resolve(); return; }

    const root = document.createElement('div');
    root.className = 'ncm-boot-splash';
    root.setAttribute('role', 'presentation');
    root.innerHTML = splashMarkup({ version });
    host.appendChild(root);
    root.offsetHeight; // settle the initial state before anything animates

    const paint = splashPainter(root);

    // One exit for every path, so a splash can never be left on screen.
    let finished = false;
    let cap = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(cap);
      root.classList.add('fade-out');
      setTimeout(() => { root.remove(); resolve(); }, FADE_MS);
    };

    // THE SAFETY NET. requestAnimationFrame stops in a hidden tab and can be
    // throttled to nothing by the browser, and the caller AWAITS this promise
    // before opening the inbox — so a stalled frame loop would leave a splash on
    // screen and no Agent behind it. A wall clock finishes it either way;
    // whichever lands first wins, since finish() only runs once.
    const capAfter = (ms) => { cap = setTimeout(() => { paint(1); finish(); }, ms); };

    if (reduced) {
      paint(1);
      capAfter(STILL_MS);
      return;
    }

    capAfter(duration + HOLD_MS + 500);
    const t0 = performance.now();
    const step = (now) => {
      if (finished) return;
      const p = Math.min(1, (now - t0) / duration);
      paint(p);
      if (p < 1) requestAnimationFrame(step);
      else { clearTimeout(cap); capAfter(HOLD_MS); }
    };
    requestAnimationFrame(step);
  });
}
