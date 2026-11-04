/**
 * The payphone booth's drawing — pure markup, no Foundry globals (the booth, the admin preview and the sims all use it).
 * @file scripts/ui/Calls/boothMarkup.js
 * @module night-city-messenger
 * @description The approved mock dev/mockups/payphone-booth-mock.html, rounds 1–3. Every SVG id carries the booth's own
 *   `uid` (gradients, masks and clip paths are global to the page, so two booths on one screen — the admin preview and a
 *   live booth — must never share one). Styles: styles/components/payphone-booth.css (ncm-pb-*).
 */

import { tipText } from '../../utils/notify.js';
import { sanitizeLook, gritTier, wireTier, lookVars } from '../../utils/payphones.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HOLE_M = 'M26 30 L40 22 L58 28 L74 24 L86 38 L82 60 L88 76 L70 86 L50 82 L32 88 L24 72 L28 54 Z';
const HOLE_L = 'M14 18 L30 8 L44 14 L62 6 L80 12 L98 8 L112 22 L108 44 L116 62 L104 80 L110 96 L84 92 L66 100 L44 94 L26 98 L12 84 L18 62 L8 44 Z';
const W = { red: '#d8322a', yel: '#e9c23a', blu: '#2f86d4', grn: '#4bb85e', wht: '#e4e4dc', blk: '#2a2a2a' };

/** One wire = a dark outline, its colour and a highlight, so it reads as round cable. */
const wire = (id, col) => `<use href="#${id}" stroke="#000" stroke-opacity=".6" stroke-width="4.4"/><use href="#${id}" stroke="${col}" stroke-width="3"/><use href="#${id}" stroke="#fff" stroke-opacity=".38" stroke-width=".9" transform="translate(-.7 -.7)"/>`;
/** A cut end: copper and three frayed strands. */
const end = (x, y, a) => `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="-1.4" y="0" width="2.8" height="4" fill="#d98a3a"/><path d="M0 4 l-1.6 3 M0 4 l0 3.6 M0 4 l1.7 2.8" stroke="#e8a35a" stroke-width=".6"/></g>`;

function gutsSvg(u) {
  const deep = (clip) => `<g clip-path="url(#${clip})"><use href="#pbDeep${u}" class="deep-dim"/><use href="#pbDeep${u}" mask="url(#pbTorch${u})"/>
      <circle class="led" cx="106" cy="16" r="1.6" fill="#5dff7a"/><rect x="0" y="0" width="132" height="110" fill="url(#pbSpill${u})"/></g>`;
  return `<svg class="ncm-pb__guts" viewBox="0 0 132 196" aria-hidden="true">
    <defs>
      <radialGradient id="pbCav${u}" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#050505"/><stop offset=".75" stop-color="#121212"/><stop offset="1" stop-color="#262624"/></radialGradient>
      <linearGradient id="pbFlap${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color: color-mix(in oklab, var(--pb-case) 80%, #fff)"/><stop offset=".55" style="stop-color: var(--pb-case)"/><stop offset="1" style="stop-color: color-mix(in oklab, var(--pb-case) 45%, #000)"/></linearGradient>
      <filter id="pbSoot${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
      <clipPath id="pbClipM${u}"><path d="${HOLE_M}"/></clipPath>
      <clipPath id="pbClipL${u}"><path d="${HOLE_L}"/></clipPath>
      <radialGradient id="pbTorchG${u}"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".75"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <mask id="pbTorch${u}" maskUnits="userSpaceOnUse" x="0" y="0" width="132" height="196"><circle data-pb-torch cx="-99" cy="-99" r="0" fill="url(#pbTorchG${u})"/></mask>
      <linearGradient id="pbSpill${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <g id="pbDeep${u}">
        <rect x="4" y="4" width="120" height="100" fill="#14171a"/>
        <g fill="#2a2e31"><circle cx="12" cy="12" r="2"/><circle cx="116" cy="12" r="2"/><circle cx="12" cy="96" r="2"/><circle cx="116" cy="96" r="2"/></g>
        <text x="14" y="100" font-family="monospace" font-size="4.2" fill="#5d6468" letter-spacing=".5">PCM-14 · REV C · 2045</text>
        <rect x="70" y="10" width="44" height="30" rx="1.5" fill="#1d2a5a" stroke="#0e1530"/>
        <g stroke="#b9a052" stroke-width=".5" fill="none"><path d="M73 14 h16 v6 h20"/><path d="M73 22 h8 v10 h26"/><path d="M95 14 v8"/><path d="M73 36 h36"/></g>
        <rect x="86" y="24" width="12" height="9" fill="#0b0b0b"/><text x="87" y="30.5" font-family="monospace" font-size="3.4" fill="#8a8f94">KR-7</text>
        <g fill="#cfcfc6"><rect x="74" y="27" width="5" height="3"/><rect x="104" y="27" width="5" height="3"/></g>
        <g fill="#3d4246"><rect x="86" y="54" width="26" height="4"/><rect x="86" y="60" width="26" height="4"/><rect x="86" y="66" width="26" height="4"/><rect x="86" y="72" width="26" height="4"/><rect x="86" y="78" width="26" height="4"/></g>
        <rect x="84" y="52" width="3" height="32" fill="#55595d"/>
        <path d="M10 64 C 30 60, 44 78, 66 86" fill="none" stroke="#7d8287" stroke-width="7"/>
        <path d="M10 64 C 30 60, 44 78, 66 86" fill="none" stroke="#4b5054" stroke-width="7" stroke-dasharray=".8 1.2"/>
        <rect x="62" y="82" width="10" height="7" rx="1" fill="#e9e6da" transform="rotate(18 67 85)"/>
        <path d="M8 30 C 18 34, 16 46, 6 52" fill="none" stroke="#5a3f22" stroke-width="2.4"/>
        <path d="M112 44 C 104 48, 104 52, 114 56" fill="none" stroke="#2f5a3a" stroke-width="2"/>
        <g fill="#b38a3c"><circle cx="40" cy="62" r="1.2"/><circle cx="46" cy="66" r="1.2"/><circle cx="52" cy="62" r="1.2"/></g>
      </g>
      <path id="pwR${u}" fill="none" d="M52 58 C 50 88, 46 110, 40 130 C 36 146, 30 160, 22 176"/>
      <path id="pwY${u}" fill="none" d="M58 60 C 58 92, 60 112, 62 132 C 64 150, 70 162, 76 180"/>
      <path id="pwB${u}" fill="none" d="M64 56 C 70 88, 66 110, 56 128 C 50 140, 52 156, 48 170"/>
      <path id="pwG${u}" fill="none" d="M72 62 C 80 92, 86 112, 94 126 C 100 136, 98 150, 102 162"/>
      <path id="pwW${u}" fill="none" d="M46 64 C 38 92, 30 104, 18 112 C 10 118, 6 130, 8 144"/>
      <path id="pwK${u}" fill="none" d="M57 64 C 57 96, 55 122, 60 154"/>
      <path id="pmR${u}" fill="none" d="M44 52 C 44 70, 40 86, 34 104"/>
      <path id="pmY${u}" fill="none" d="M52 52 C 54 72, 58 88, 60 108"/>
      <path id="pmB${u}" fill="none" d="M60 50 C 66 66, 64 80, 70 96"/>
    </defs>
    <path class="torch-hit hit-m" d="${HOLE_M}"/><path class="torch-hit hit-l" d="${HOLE_L}"/>
    <g class="gm">
      <path d="${HOLE_M}" fill="#000" class="soot" filter="url(#pbSoot${u})"/>
      <path d="${HOLE_M}" fill="url(#pbCav${u})"/>
      ${deep(`pbClipM${u}`)}
      <path d="${HOLE_M}" fill="none" class="rim" stroke-width="2" stroke-linejoin="miter"/>
      <path d="M26 30 L40 22 L58 28 L74 24 L86 38" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="1"/>
      <g class="dirty"><rect x="34" y="32" width="40" height="22" rx="1.5" fill="#1f5a32" transform="rotate(-4 54 43)"/>
        <g stroke="#c8a24a" stroke-width=".7" fill="none" transform="rotate(-4 54 43)"><path d="M37 36 h14 v6 h12"/><path d="M37 46 h8 v4 h24"/></g>
        <rect x="56" y="34" width="10" height="8" fill="#151515" transform="rotate(-4 54 43)"/></g>
      <g fill="none" stroke-linecap="round" class="dusty">${wire(`pmR${u}`, W.red)}${wire(`pmY${u}`, W.yel)}${wire(`pmB${u}`, W.blu)}</g>
      ${end(34, 104, 18)}${end(60, 108, -6)}${end(70, 96, -22)}
    </g>
    <g class="gl">
      <path d="${HOLE_L}" fill="#000" class="soot" filter="url(#pbSoot${u})"/>
      <path d="${HOLE_L}" fill="url(#pbCav${u})"/>
      ${deep(`pbClipL${u}`)}
      <path d="${HOLE_L}" fill="none" class="rim" stroke-width="2.2" stroke-linejoin="miter"/>
      <path d="M14 18 L30 8 L44 14 L62 6 L80 12 L98 8 L112 22" fill="none" stroke="#000" stroke-opacity=".75" stroke-width="1.2"/>
      <g transform="rotate(-5 60 40)" class="dirty">
        <rect x="22" y="22" width="62" height="34" rx="2" fill="#1f5a32" stroke="#123a20"/>
        <g stroke="#c8a24a" stroke-width=".7" fill="none"><path d="M25 27 h20 v8 h18"/><path d="M25 41 h12 v6 h40"/><path d="M58 27 v10 h20"/><path d="M30 52 h44"/></g>
        <rect x="44" y="29" width="14" height="10" fill="#141414"/><g fill="#9a9a9a"><rect x="45" y="27.5" width="1" height="1.5"/><rect x="48" y="27.5" width="1" height="1.5"/><rect x="51" y="27.5" width="1" height="1.5"/><rect x="54" y="27.5" width="1" height="1.5"/></g>
        <rect x="66" y="36" width="12" height="12" rx="1" fill="#8d9296"/><rect x="66" y="36" width="12" height="3" fill="#b9bdc0"/>
        <rect x="28" y="44" width="7" height="10" rx="1" fill="#2a5fa8"/><ellipse cx="31.5" cy="44" rx="3.5" ry="1.3" fill="#7fa9e0"/>
      </g>
      <g class="sway dusty" fill="none" stroke-linecap="round">
        ${wire(`pwW${u}`, W.wht)}${wire(`pwR${u}`, W.red)}${wire(`pwK${u}`, W.blk)}${wire(`pwB${u}`, W.blu)}${wire(`pwY${u}`, W.yel)}${wire(`pwG${u}`, W.grn)}
        <rect x="44" y="98" width="28" height="5" rx="2" fill="#151515" stroke="#000" stroke-width=".6" transform="rotate(4 58 100)"/>
        <rect x="70" y="97" width="5" height="7" rx="1" fill="#151515" transform="rotate(4 58 100)"/>
        ${end(22, 176, 22)}${end(76, 180, -16)}${end(48, 170, 8)}${end(102, 162, -10)}${end(8, 144, 4)}${end(60, 154, 0)}
        <g class="spark"><circle cx="9" cy="152" r="5" fill="#fff6c8" opacity=".55"/><path d="M9 151 l-7 -4 M9 151 l-5 6 M9 151 l6 -6 M9 151 l8 3 M9 151 l1 8" stroke="#fff3b0" stroke-width="1"/></g>
        <g class="spark b"><circle cx="77" cy="188" r="4" fill="#bfe8ff" opacity=".55"/><path d="M77 187 l-6 -3 M77 187 l5 -5 M77 187 l6 4 M77 187 l-2 7" stroke="#e4f6ff" stroke-width="1"/></g>
      </g>
      <g class="dirty"><path d="M84 92 L110 96 L126 132 L98 126 Z" fill="url(#pbFlap${u})" stroke="#000" stroke-opacity=".6"/></g>
      <g class="rusty"><circle cx="104" cy="104" r="5" fill="#7a3412"/><circle cx="116" cy="124" r="4" fill="#8a3c14"/><circle cx="96" cy="118" r="3" fill="#6d2e10"/><path d="M110 96 L113 104 L109 112" stroke="#6d2e10" stroke-width="2.5" fill="none"/></g>
      <path d="M84 92 L110 96 L104 102 L88 99 Z" fill="#000" opacity=".45"/>
      <path d="M98 126 L126 132" stroke="#d3d6d8" stroke-width="1.6"/>
      <circle cx="110" cy="120" r="2.2" fill="#0a0a0a" stroke="#999" stroke-width=".6"/>
    </g>
  </svg>`;
}

function handsetSvg(u) {
  return `<svg viewBox="0 0 78 380" aria-hidden="true">
    <defs><linearGradient id="pbHg${u}" x1="0" x2="1"><stop offset="0" style="stop-color: color-mix(in oklab, var(--pb-handset) 55%, #000)"/><stop offset=".45" style="stop-color: var(--pb-handset)"/><stop offset="1" style="stop-color: color-mix(in oklab, var(--pb-handset) 60%, #000)"/></linearGradient></defs>
    <path d="M10 18 Q10 2 26 2 L58 2 Q74 2 74 20 L74 92 Q74 108 58 110 L52 112 L52 270 L58 272 Q74 274 74 292 L74 362 Q74 378 58 378 L26 378 Q10 378 10 362 Z" fill="url(#pbHg${u})" stroke="#000" stroke-opacity=".6" stroke-width="1.5"/>
    <circle cx="40" cy="48" r="17" fill="#c9ccc9" stroke="#000" stroke-opacity=".5"/><circle cx="40" cy="48" r="10" fill="#8e928f"/>
    <g fill="#222"><circle cx="35" cy="44" r="1.6"/><circle cx="45" cy="44" r="1.6"/><circle cx="35" cy="52" r="1.6"/><circle cx="45" cy="52" r="1.6"/><circle cx="40" cy="48" r="1.6"/></g>
    <rect x="20" y="118" width="22" height="58" rx="2" fill="#c9ccc9" opacity=".85"/><path d="M24 130 h10 v6 h6 v14 h-4" fill="none" stroke="#b33" stroke-width="2"/>
    <g class="ncm-pb__hwire">
      <path d="M50 150 L60 152 L58 238 L50 244 Z" fill="#0b0b0b" stroke="#bfc2c3" stroke-width="1" stroke-dasharray="2 2"/>
      <rect x="53" y="160" width="4" height="18" fill="#1d4d2a"/>
      <path d="M55 182 C 64 194, 50 204, 57 218 C 62 228, 52 232, 56 240" fill="none" stroke="#d63a2a" stroke-width="2"/>
      <path d="M54 184 C 47 198, 62 206, 54 222" fill="none" stroke="#e8c33a" stroke-width="1.6"/>
      <path d="M57 200 C 72 206, 74 214, 66 224" fill="none" stroke="#3a8fd6" stroke-width="1.6"/>
      <path d="M36 96 L44 104 M40 98 L33 108" stroke="#cfd2d3" stroke-width="1"/>
    </g>
    <g fill="#222"><circle cx="32" cy="196" r="3"/><circle cx="40" cy="196" r="3"/><circle cx="32" cy="206" r="3"/><circle cx="40" cy="206" r="3"/></g>
    <circle data-pb-cordend cx="40" cy="376" r=".5" fill="none"/>
    <g fill="#000" opacity=".5"><circle cx="34" cy="334" r="1.8"/><circle cx="42" cy="334" r="1.8"/><circle cx="50" cy="334" r="1.8"/><circle cx="38" cy="342" r="1.8"/><circle cx="46" cy="342" r="1.8"/></g>
  </svg>`;
}

/**
 * The whole booth.
 * @param {object} o
 * @param {object} o.look — sanitizeLook shape
 * @param {string} o.uid — unique per booth on the page
 * @param {string} [o.place] — the plate's place line
 * @param {string} [o.number]
 * @param {'working'|'out'} [o.condition]
 * @param {boolean} [o.helpKey] @param {string} [o.helpLabel]
 * @param {boolean} [o.preview] — the admin preview (no close button, no bystander strip)
 */
export function boothHtml({ look, uid = 'x', place = '', number = '', condition = 'working', helpKey = false, helpLabel = 'Help', preview = false } = {}) {
  const l = sanitizeLook(look);
  const u = String(uid).replace(/[^\w-]/g, '');
  const tags = l.tags.map(([t, c], i) => `<span class="ncm-pb__tag t${i + 1}" style="--tc:${c};filter:url(#ncm-pb-spray${u})"${t.trim() ? '' : ' hidden'}>${esc(t)}</span>`).join('');
  return `<div class="ncm-pb" data-pb-uid="${u}" data-pb-style="${l.style}" data-state="${condition === 'out' ? 'out' : 'working'}" data-at="idle" data-grit-tier="${gritTier(l.grit)}" data-wire-tier="${wireTier(l.wire)}" style="${lookVars(l)}">
  <div class="ncm-pb__case">
    <div class="ncm-pb__cap">
      <div class="ncm-pb__slot" data-pb="slot" data-tooltip="Credchip slot. Nothing is charged."><i></i><i></i><span class="ncm-pb__chip"></span></div>
      <div class="ncm-pb__picto"><span><i class="far fa-credit-card"></i>CHIP</span><span><i class="fas fa-phone-volume"></i>CALL</span><span><i class="fas fa-plug"></i>WIRED</span></div>
      <div class="ncm-pb__gauge" data-tooltip="Hook"><i></i></div>
    </div>
    <div class="ncm-pb__body">
      <div class="ncm-pb__recess">
        <span class="ncm-pb__latch"></span>
        <svg class="ncm-pb__cord" viewBox="0 0 112 520" aria-hidden="true"><path data-pb-cord fill="none" stroke="#151515" stroke-width="6" stroke-linecap="round" stroke-dasharray="1.2 4.5" d="M 54 384 C 44 450, 40 500, 56 516"/></svg>
        <button type="button" class="ncm-pb__handset" data-pb="handset" aria-label="Lift the handset">${handsetSvg(u)}</button>
        <div class="ncm-pb__label" data-pb-hint>Lift</div>
      </div>
      <div class="ncm-pb__brand">${esc(l.brand)}</div>
      <div class="ncm-pb__display">
        <div class="ncm-pb__l1" data-pb-l1>${esc(l.idle)}</div>
        <div class="ncm-pb__l2" data-pb-l2></div>
        <div class="ncm-pb__tick"><span>${esc(l.tick.join('   ///   '))}</span></div>
        <svg class="ncm-pb__crack" viewBox="0 0 300 96" preserveAspectRatio="none" aria-hidden="true"><path d="M220 0 L204 26 L232 42 L196 66 L212 96 M204 26 L166 34 L132 20 M232 42 L270 52 L300 46 M196 66 L156 72" fill="none" stroke="rgba(230,240,255,.55)" stroke-width="1.3"/></svg>
      </div>
      <div class="ncm-pb__screws"><i class="ncm-pb__screw"></i><i class="ncm-pb__screw"></i></div>
      <div class="ncm-pb__ctl">
        <i class="ncm-pb__rivet a"></i><i class="ncm-pb__rivet b"></i><i class="ncm-pb__rivet c"></i><i class="ncm-pb__rivet d"></i>
        <div class="ncm-pb__speed" data-pb-speed>${[1, 2, 3, 4].map((i) => `<button type="button" class="ncm-pb__sq is-empty" tabindex="-1"><b>${i}</b><em>—</em></button>`).join('')}</div>
        <div class="ncm-pb__fns">
          <button type="button" class="ncm-pb__sq" data-fn="redial" data-tooltip="Call the last number again"><b>Redial</b></button>
          <button type="button" class="ncm-pb__sq" data-fn="book" data-tooltip="Your Agent's phone contacts, on the screen"><b>Book</b></button>
          <button type="button" class="ncm-pb__sq" data-fn="spk" data-tooltip="Speaker: everyone at the booth can follow the call"><b>Spkr</b></button>
          ${helpKey ? `<button type="button" class="ncm-pb__sq is-red" data-fn="sos" data-tooltip="${tipText(helpLabel)}"><b>${esc(helpLabel)}</b></button>` : ''}
        </div>
        <div class="ncm-pb__touch">
          <div class="ncm-pb__tnum" data-pb-tnum></div>
          <div class="ncm-pb__tsub" data-pb-tsub></div>
          <div data-pb-tbody>${keypadHtml({ wrecked: gritTier(l.grit) === 4 })}</div>
        </div>
        <div class="ncm-pb__side">
          <button type="button" class="ncm-pb__round" data-fn="eject" aria-label="Eject chip"></button><small>EJECT</small>
          <button type="button" class="ncm-pb__round" data-fn="vol" aria-label="Volume"></button><small>VOL</small>
          ${l.stickers ? '<span class="ncm-pb__stk"><i class="fas fa-skull"></i></span><span class="ncm-pb__stk b"><i class="fas fa-bolt"></i></span>' : ''}
        </div>
      </div>
      <div class="ncm-pb__grille"></div>
      <div class="ncm-pb__plate"><span>${esc(place)}</span><span>${esc(number)}</span></div>
    </div>
    <div class="ncm-pb__grime"></div><div class="ncm-pb__chips"></div><div class="ncm-pb__rust"></div>
    ${gutsSvg(u)}
    ${tags}
    <svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="ncm-pb-spray${u}"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="3"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter></svg>
    <div class="ncm-pb__sign">Out of order</div>
  </div>
  ${preview ? '' : `<div class="ncm-pb__by" data-pb-by></div>
  <div class="ncm-pb__foot"><button type="button" class="ncm-pb__walk" data-pb="close"><i class="fas fa-person-walking"></i> Walk away</button></div>`}
</div>`;
}

/** The touchscreen keypad (the wrecked booth's 7 is gone). */
export function keypadHtml({ wrecked = false } = {}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '<', '0', 'OK'];
  return `<div class="ncm-pb__tpad">${keys.map((k) => `<button type="button" class="ncm-pb__tk${k === 'OK' ? ' is-ok' : ''}${wrecked && k === '7' ? ' is-gone' : ''}" data-k="${k}" aria-label="${k === '<' ? 'Delete' : k}">${k === '<' ? '‹' : k}</button>`).join('')}</div>`;
}

/** The Book on the touchscreen: the character's phone contacts. */
export function bookHtml(book = []) {
  if (!book.length) return '<div class="ncm-pb__bkempty">No numbers in your Agent.</div>';
  return `<div class="ncm-pb__book">${book.map((b) => `<button type="button" class="ncm-pb__bk" data-dial="${esc(b.number)}">${esc(b.name)}<span>${esc(b.number)}</span></button>`).join('')}</div>`;
}

/** The four speed-dial keys. */
export function speedHtml(book = []) {
  return [0, 1, 2, 3].map((i) => {
    const b = book[i];
    return b ? `<button type="button" class="ncm-pb__sq" data-dial="${esc(b.number)}" data-tooltip="${tipText(b.name)} · ${tipText(b.number)}"><b>${i + 1}</b><em>${esc(b.name)}</em></button>`
      : `<button type="button" class="ncm-pb__sq is-empty" tabindex="-1"><b>${i + 1}</b><em>—</em></button>`;
  }).join('');
}

/** The strip under a booth someone else is on. Lines are read-only. */
export function byHtml({ who = 'Someone', speaker = false, lines = [] } = {}) {
  const ini = String(who).split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const feed = speaker ? `<div class="ncm-pb__feed">${lines.slice(-6).map((l) => `<p><b${l.mine ? ' class="v"' : ''}>${esc(l.who)}:</b> ${esc(l.text)}</p>`).join('') || '<p class="ro">Nothing said yet.</p>'}
    <span class="ro"><i class="fas fa-ear-listen"></i> On speaker — you can hear it, you can't speak on it.</span></div>` : '';
  return `<div class="who"><span class="av">${esc(ini)}</span><div>${esc(who)} is on this phone<small>${speaker ? 'On speaker — you can follow the call.' : "Holding the handset — you can't hear the call."}</small></div><span class="tag ${speaker ? 'spk' : 'priv'}">${speaker ? 'Speaker' : 'Private'}</span></div>${feed}`;
}
