/**
 * Shard Icon Builder — design the chip, then bake it into an image.
 * @file scripts/ui/ShardEncoder/ShardIconBuilder.js
 * @module night-city-messenger
 * @description A player-made shard is a physical object in an inventory, so it deserves
 *   to look like something they chose. This is a small framework-free promise modal (the
 *   SecurityConsole / OperatorSelect family — appended into `host`, so it inherits that
 *   window's `--ncm-*` palette) that composes an icon from four things:
 *
 *     · a BASE      — the chip plate, a disc, or nothing
 *     · a MARK      — a Font Awesome symbol, or any image the player picks
 *     · a COLOUR    — the module's own authorable palette (CT_COLORS)
 *     · a TREATMENT — a glow, and a label strip
 *
 *   `runIconBuilder()` resolves a **PNG data URI**, not a file path. That is deliberate:
 *   writing a real file needs upload permission a player usually does not have, while a
 *   data URI is just a string on an item they already own — no permission, no server
 *   round-trip, and it travels with the item if it is handed to someone else.
 *
 *   THE FONT AWESOME TRICK: a glyph cannot be drawn from its class name, because the
 *   character lives in the stylesheet's `::before { content }`. So a hidden element is
 *   mounted, `getComputedStyle(el, '::before').content` is read back, and THAT character
 *   is drawn with the Font Awesome family. It is the only way to rasterize an icon font
 *   without shipping a glyph table, and it needs the font to be loaded — which it is,
 *   because the rest of the window is full of them.
 */

import { TERMINAL_ICON_LIBRARY } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { CT_COLORS, ACCENT_HEX } from '../content/ContentRenderers.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The canvas is square and generous — Foundry scales it down everywhere it shows. */
const SIZE = 128;

/**
 * The flat near-black every Foundry item tile sits on. A transparent PNG would
 * show the sheet's own backdrop through the chip and read as a hole in the row,
 * so the icon is baked ONTO this instead of left cut out.
 */
const TILE_BG = '#1b1f21';

/** Plate styles. `draw` paints the backdrop; the mark is drawn on top of it. */
const BASES = {
  chip:  { label: 'Chip', hint: 'a data chip with contacts' },
  disc:  { label: 'Disc', hint: 'a plain round token' },
  plate: { label: 'Plate', hint: 'a soft rounded square' },
  none:  { label: 'None', hint: 'the mark on its own' },
};

/**
 * A readable hex per palette name. `ACCENT_HEX` is the shared source, but it only
 * carries the names the content renderers need — the authorable palette has three
 * more (amber, blue, pink), so they are filled in here rather than by widening a
 * constant other surfaces already render from.
 */
const SWATCH = Object.freeze({ ...ACCENT_HEX, amber: '#ffab00', blue: '#3b82f6', pink: '#ec4899' });

/**
 * Resolve a colour. The state holds either a palette NAME or a literal hex from
 * the picker, so both paths go through here and the rest of the file never has
 * to care which one the player used.
 */
function hexFor(name) {
  if (typeof name === 'string' && /^#[0-9a-f]{3,8}$/i.test(name.trim())) return name.trim();
  return SWATCH[name] || SWATCH.cyan || '#19f3f7';
}

/** Mix a hex toward black — used for the plate's body so the mark still reads. */
function darken(hex, amount = 0.72) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return '#0a0f14';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - amount));
  const g = Math.round(((n >> 8) & 255) * (1 - amount));
  const b = Math.round((n & 255) * (1 - amount));
  return `rgb(${r},${g},${b})`;
}

/**
 * Read the actual character behind a Font Awesome class. Returns '' when the
 * glyph cannot be resolved, and the caller draws nothing rather than a tofu box.
 */
function glyphFor(cssClass) {
  if (typeof document === 'undefined') return '';
  const probe = document.createElement('i');
  probe.className = cssClass;
  probe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;font-size:32px;';
  document.body.appendChild(probe);
  let ch = '';
  try {
    const raw = getComputedStyle(probe, '::before').content || '';
    const cleaned = raw.replace(/^["']|["']$/g, '');
    if (cleaned && cleaned !== 'none' && cleaned !== 'normal') ch = cleaned;
  } catch (err) { log.debug('IconBuilder: could not read the glyph', err); }
  probe.remove();
  return ch;
}

/** The font stack Font Awesome 6 Free ships its solid weight in. */
const FA_FONT = '900 __SIZE__px "Font Awesome 6 Free", "Font Awesome 6 Pro", "FontAwesome"';

/**
 * Paint the icon. Shared by the live preview and the final bake, so what the
 * player approves is exactly the pixels that land on the item.
 * @param {HTMLCanvasElement} cv
 * @param {object} state { base, colour, mark:'icon'|'image', iconClass, imageEl, glow, label }
 */
export function paintIcon(cv, state) {
  const ctx = cv.getContext('2d');
  const S = cv.width;
  const accent = hexFor(state.colour);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = TILE_BG;
  ctx.fillRect(0, 0, S, S);

  const pad = S * 0.08;
  const box = S - pad * 2;

  // ── the backdrop ──
  if (state.base === 'chip') {
    // The SAME silhouette as the Encoder's own core — a square with the
    // top-left and bottom-right corners cut in (the workshop's
    // `clip-path: polygon(15px 0, 100% 0, 100% calc(100% - 15px), …)`), so the
    // icon on the item is recognisably the thing the player watched compile.
    const cut = box * 0.19;
    const x0 = pad, y0 = pad, x1 = pad + box, y1 = pad + box;
    const chip = (inset) => {
      const a = x0 + inset, b = y0 + inset, c = x1 - inset, d = y1 - inset;
      const k = cut - inset * 0.35;
      ctx.beginPath();
      ctx.moveTo(a + k, b);
      ctx.lineTo(c, b);
      ctx.lineTo(c, d - k);
      ctx.lineTo(c - k, d);
      ctx.lineTo(a, d);
      ctx.lineTo(a, b + k);
      ctx.closePath();
    };

    // outer body, in the accent
    ctx.fillStyle = accent;
    chip(0);
    ctx.fill();

    // inner face, dark with a lit corner — the core's 150deg gradient
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, darken(accent, 0.62));
    g.addColorStop(1, darken(accent, 0.9));
    ctx.fillStyle = g;
    chip(Math.max(2.5, S * 0.028));
    ctx.fill();

    // contacts along the top and right, the detail that says "chip" at 28px
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.9;
    const pinW = box * 0.055, pinH = box * 0.05;
    for (let i = 0; i < 3; i++) {
      const px = x0 + cut + box * 0.22 + i * (pinW * 2.6);
      if (px + pinW < x1 - pinW) ctx.fillRect(px, y0 - pinH * 0.45, pinW, pinH);
    }
    for (let i = 0; i < 3; i++) {
      const py = y0 + box * 0.24 + i * (pinW * 2.6);
      if (py + pinW < y1 - cut) ctx.fillRect(x1 - pinH * 0.55, py, pinH, pinW);
    }
    ctx.globalAlpha = 1;
  } else if (state.base === 'disc') {
    ctx.fillStyle = darken(accent, 0.8);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, S * 0.022);
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, box / 2, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  } else if (state.base === 'plate') {
    ctx.fillStyle = darken(accent, 0.82);
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, S * 0.018);
    ctx.beginPath();
    ctx.roundRect(pad, pad, box, box, S * 0.16);
    ctx.fill(); ctx.stroke();
  }

  // ── the mark ──
  ctx.save();
  if (state.glow) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = S * 0.14;
  }
  if (state.mark === 'image' && state.imageEl?.complete && state.imageEl.naturalWidth) {
    const im = state.imageEl;
    const fit = state.base === 'chip' ? 0.62 : state.base === 'none' ? 0.92 : 0.72;
    const scale = Math.min((box * fit) / im.naturalWidth, (box * fit) / im.naturalHeight);
    const w = im.naturalWidth * scale, h = im.naturalHeight * scale;
    try { ctx.drawImage(im, (S - w) / 2, (S - h) / 2, w, h); }
    catch (err) { log.debug('IconBuilder: the image could not be drawn (tainted or unloaded)', err); }
  } else if (state.glyph) {
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = FA_FONT.replace('__SIZE__', String(Math.round(S * (state.base === 'none' ? 0.62 : 0.42))));
    ctx.fillText(state.glyph, S / 2, S / 2);
  }
  ctx.restore();
  return cv;
}

/**
 * Open the builder.
 * @param {object} o
 * @param {HTMLElement} [o.host]    where to mount (inherits its palette)
 * @param {string} [o.image]        an image to start from
 * @param {string} [o.colour]       a palette name to start from
 * @returns {Promise<string|null>}  a PNG data URI, or null if cancelled
 */
export function runIconBuilder({ host, image = '', colour = 'cyan' } = {}) {
  return new Promise((resolve) => {
    const mount = host || document.body;
    const root = document.createElement('div');
    root.className = 'ncm-iconb-backdrop';

    const S = {
      base: 'chip',
      colour: CT_COLORS.includes(colour) ? colour : 'cyan',
      mark: image ? 'image' : 'icon',
      iconClass: 'fas fa-microchip',
      glyph: '',
      imageEl: null,
      glow: true,
      search: '',
    };
    if (image) {
      const im = new Image();
      im.onload = () => paint();
      im.src = image;
      S.imageEl = im;
    }

    const icons = TERMINAL_ICON_LIBRARY.slice();

    root.innerHTML = `
      <div class="ncm-iconb">
        <div class="ncm-iconb__hd"><i class="fas fa-palette"></i> <b>Design the chip</b>
          <span class="ncm-iconb__hint">it becomes the item's picture</span></div>
        <div class="ncm-iconb__body">
          <div class="ncm-iconb__stage">
            <canvas class="ncm-iconb__cv" width="${SIZE}" height="${SIZE}"></canvas>
            <div class="ncm-iconb__sizes">
              <canvas class="ncm-iconb__mini" width="${SIZE}" height="${SIZE}" data-mini="48"></canvas>
              <canvas class="ncm-iconb__mini" width="${SIZE}" height="${SIZE}" data-mini="28"></canvas>
              <span class="ncm-iconb__sizelbl">how it looks in a list</span>
            </div>
          </div>
          <div class="ncm-iconb__ctl">
            <div class="ncm-iconb__lbl">Shape</div>
            <div class="ncm-iconb__row" data-ib-bases>
              ${Object.entries(BASES).map(([k, v]) => `
                <span class="ncm-iconb__chip ${k === S.base ? 'on' : ''}" data-ib-base="${k}" data-tooltip="${esc(v.hint)}">${esc(v.label)}</span>`).join('')}
            </div>

            <div class="ncm-iconb__lbl">Colour</div>
            <div class="ncm-iconb__row" data-ib-colours>
              ${CT_COLORS.map((c) => `
                <span class="ncm-iconb__sw ${c === S.colour ? 'on' : ''}" data-ib-colour="${c}"
                      style="--sw:${hexFor(c)}" data-tooltip="${esc(c)}"></span>`).join('')}
              <label class="ncm-iconb__custom ${String(S.colour).startsWith('#') ? 'on' : ''}" data-tooltip="Any colour you like">
                <input type="color" data-ib-hex value="${hexFor(S.colour)}">
                <i class="fas fa-eye-dropper"></i>
              </label>
            </div>

            <div class="ncm-iconb__lbl">Mark</div>
            <div class="ncm-iconb__row">
              <span class="ncm-iconb__chip ${S.mark === 'icon' ? 'on' : ''}" data-ib-mark="icon">Symbol</span>
              <span class="ncm-iconb__chip ${S.mark === 'image' ? 'on' : ''}" data-ib-mark="image">My image</span>
              <span class="ncm-iconb__chip" data-ib-browse><i class="fas fa-folder-open"></i> Browse…</span>
              <span class="ncm-iconb__chip ${S.glow ? 'on' : ''}" data-ib-glow><i class="fas fa-lightbulb"></i> Glow</span>
            </div>

            <div class="ncm-iconb__picker" data-ib-picker>
              <div class="ncm-iconb__search">
                <i class="fas fa-magnifying-glass"></i>
                <input type="text" data-ib-search placeholder="search symbols…">
              </div>
              <div class="ncm-iconb__grid" data-ib-grid></div>
            </div>
          </div>
        </div>
        <div class="ncm-iconb__foot">
          <span class="ncm-iconb__note">Saved onto the item itself — no files, no permissions.</span>
          <span style="flex:1"></span>
          <button type="button" class="ncm-iconb__btn" data-ib-cancel>Cancel</button>
          <button type="button" class="ncm-iconb__btn ncm-iconb__btn--go" data-ib-use><i class="fas fa-check"></i> Use this</button>
        </div>
      </div>`;

    mount.appendChild(root);
    const $ = (sel) => root.querySelector(sel);
    const cv = $('.ncm-iconb__cv');

    const paint = () => {
      S.glyph = S.mark === 'icon' ? glyphFor(S.iconClass) : '';
      paintIcon(cv, S);
      root.querySelectorAll('.ncm-iconb__mini').forEach((m) => paintIcon(m, S));
    };

    const renderGrid = () => {
      const q = S.search.trim().toLowerCase();
      const list = q ? icons.filter((i) => i.c.includes(q) || i.k.includes(q)) : icons;
      $('[data-ib-grid]').innerHTML = list.slice(0, 120).map((i) => `
        <span class="ncm-iconb__ic ${i.c === S.iconClass ? 'on' : ''}" data-ib-icon="${esc(i.c)}" data-tooltip="${esc(i.c)}">
          <i class="${esc(i.c)}"></i></span>`).join('')
        || '<span class="ncm-iconb__none">nothing matches that</span>';
    };

    const syncChips = () => {
      root.querySelectorAll('[data-ib-base]').forEach((el) => el.classList.toggle('on', el.dataset.ibBase === S.base));
      const custom = String(S.colour).startsWith('#');
      root.querySelectorAll('[data-ib-colour]').forEach((el) => el.classList.toggle('on', !custom && el.dataset.ibColour === S.colour));
      const cw = root.querySelector('.ncm-iconb__custom');
      if (cw) {
        cw.classList.toggle('on', custom);
        const inp = cw.querySelector('input');
        if (inp && !custom) inp.value = hexFor(S.colour);   // keep it in step with the picked swatch
      }
      root.querySelectorAll('[data-ib-mark]').forEach((el) => el.classList.toggle('on', el.dataset.ibMark === S.mark));
      $('[data-ib-glow]').classList.toggle('on', S.glow);
      $('[data-ib-picker]').style.display = S.mark === 'icon' ? '' : 'none';
    };

    const close = (value) => {
      root.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
    };
    document.addEventListener('keydown', onKey, true);

    root.addEventListener('click', (e) => {
      if (e.target === root) return close(null);
      const t = e.target.closest('[data-ib-base],[data-ib-colour],[data-ib-mark],[data-ib-icon],[data-ib-glow],[data-ib-browse],[data-ib-cancel],[data-ib-use]');
      if (!t) return;
      if (t.dataset.ibBase) S.base = t.dataset.ibBase;
      else if (t.dataset.ibColour) S.colour = t.dataset.ibColour;
      else if (t.dataset.ibMark) S.mark = t.dataset.ibMark;
      else if (t.dataset.ibIcon) { S.iconClass = t.dataset.ibIcon; S.mark = 'icon'; renderGrid(); }
      else if (t.hasAttribute('data-ib-glow')) S.glow = !S.glow;
      else if (t.hasAttribute('data-ib-browse')) {
        try {
          new FilePicker({
            type: 'image',
            callback: (p) => {
              const im = new Image();
              im.onload = () => { S.imageEl = im; S.mark = 'image'; syncChips(); paint(); };
              im.onerror = () => ui.notifications?.warn('NCM | That image could not be loaded.');
              im.src = p;
            },
          }).render(true);
        } catch (err) { log.warn('IconBuilder: no file picker', err); }
        return;
      } else if (t.hasAttribute('data-ib-cancel')) return close(null);
      else if (t.hasAttribute('data-ib-use')) {
        try { return close(cv.toDataURL('image/png')); }
        catch (err) {
          // A cross-origin image taints the canvas and export throws. Say so
          // instead of handing back a broken icon.
          log.warn('IconBuilder: the canvas could not be exported', err);
          ui.notifications?.warn('NCM | That image cannot be baked in — pick a symbol, or an image from your world.');
          return;
        }
      }
      syncChips(); paint();
    });

    root.addEventListener('input', (e) => {
      const hx = e.target.closest('[data-ib-hex]');
      if (hx) {
        // Dragging a native colour picker fires continuously; repaint the canvas
        // every time but only re-stamp the swatch row when the mode changes.
        const wasCustom = String(S.colour).startsWith('#');
        S.colour = hx.value;
        if (!wasCustom) syncChips();
        else root.querySelector('.ncm-iconb__custom')?.classList.add('on');
        paint();
        return;
      }
      const sr = e.target.closest('[data-ib-search]');
      if (!sr) return;
      S.search = sr.value;
      renderGrid();
    });

    renderGrid();
    syncChips();
    paint();
    // Font Awesome may still be settling on the first open; repaint once it has.
    if (document.fonts?.ready) document.fonts.ready.then(() => paint()).catch(() => {});
    setTimeout(() => $('[data-ib-search]')?.focus(), 40);
  });
}
