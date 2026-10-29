/**
 * Utility Helpers
 * @file scripts/utils/helpers.js
 * @module night-city-messenger
 * @description Shared utility functions used across the module
 */

import { MODULE_ID, MODULE_SHORT, TERMINAL_PRESETS, SHARD_PRESETS, TERMINAL_SOUND_SETS, COLOR_VAR_MAP, DEFAULTS, NET_ACTION_VERBS, CONTRAST_SPREAD } from './constants.js';
import { resolveShardEditing } from '../ui/content/EncoderModel.js';
import { identityRole } from './identities.js';

/** Month names for the written-out date styles (dateMonthStyle setting). */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG  = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Module-prefixed console logger
 */
export const log = {
  info: (...args) => console.log(`${MODULE_SHORT} |`, ...args),
  warn: (...args) => console.warn(`${MODULE_SHORT} |`, ...args),
  error: (...args) => console.error(`${MODULE_SHORT} |`, ...args),
  debug: (...args) => {
    try {
      if (game.settings?.get(MODULE_ID, 'debugMode')) {
        console.debug(`${MODULE_SHORT} |`, ...args);
      }
    } catch {
      // Setting not yet registered — silently skip
    }
  },
};

/**
 * Generate a unique ID using Foundry's utility
 * @returns {string}
 */
export function generateId() {
  return foundry.utils.randomID();
}

/**
 * Deep merge objects (non-mutating)
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export function deepMerge(target, source) {
  return foundry.utils.mergeObject(target, source, { inplace: false });
}

/**
 * Localize a string key.
 *
 * NOTE: nothing calls this — NCM is not localized, and copy lives inline in the
 * JS/templates. `languages/en.json` holds only the handful of keys Foundry
 * resolves for us (scene controls, the Contacts window title). Kept as the entry
 * point if real i18n is ever wanted; a key absent from en.json comes back as the
 * key text itself, so run `node dev/tools/audit-i18n.cjs` if you start using it.
 *
 * @param {string} key - Dot-notation i18n key (e.g., 'NCM.SceneControls.OpenInbox')
 * @param {object} [data] - Interpolation data
 * @returns {string}
 */
export function localize(key, data = {}) {
  return game.i18n.format(key, data);
}

/**
 * Check if the current user is a GM
 * @returns {boolean}
 */
export function isGM() {
  return game.user?.isGM ?? false;
}

/**
 * Get the primary owned actor for the current user
 * @returns {Actor|null}
 */
export function getPlayerActor() {
  return game.user?.character ?? null;
}

/**
 * Every player character the GM can address — the ONE enumeration for the
 * admin share dialog, "Known by" pips, mass broadcast and the View Inbox list.
 *
 * Each non-GM user's ASSIGNED character comes first, then any other actor a
 * player OWNS (`hasPlayerOwner`) that nobody has assigned. The old per-surface
 * loops only walked `user.character`, so a player whose character was owned but
 * never assigned on the user sheet was invisible to every one of those tools
 * (2026-09 tester: "share with every player but Known by doesn't change",
 * "broadcast doesn't work", "can't open the player's inbox from the panel").
 * Non-person actor types (Black ICE, demons, containers) are skipped.
 *
 * @returns {Array<{actorId: string, actorName: string, playerName: string, actor: Actor, assigned: boolean}>}
 */
export function getPlayerCharacters() {
  const out = [];
  const seen = new Set();
  const NON_PERSON = new Set(['blackIce', 'black-ice', 'demon', 'container']);
  for (const user of game.users ?? []) {
    if (user.isGM || !user.character) continue;
    const actor = user.character;
    if (seen.has(actor.id)) continue;
    seen.add(actor.id);
    out.push({ actorId: actor.id, actorName: actor.name, playerName: user.name, actor, assigned: true });
  }
  for (const actor of game.actors ?? []) {
    if (seen.has(actor.id) || !actor.hasPlayerOwner) continue;
    if (NON_PERSON.has(actor.type)) continue;
    const owner = (game.users ?? []).find(u => !u.isGM && actor.testUserPermission?.(u, 'OWNER'));
    seen.add(actor.id);
    out.push({ actorId: actor.id, actorName: actor.name, playerName: owner?.name || 'Player', actor, assigned: false });
  }
  return out;
}

/**
 * Format a timestamp in cyberpunk style: 2045.03.15 // 14:30
 * @param {string|number|Date} timestamp
 * @returns {string}
 */
/**
 * Format timestamp in cyberpunk style. Respects module's date format and 12h/24h settings.
 * @param {string|number|Date} timestamp
 * @param {object} [options]
 * @param {boolean} [options.seconds=false] - Include seconds in time portion
 * @param {boolean} [options.dateOnly=false] - Return only the date portion (no time)
 * @returns {string}
 */
export function formatCyberDate(timestamp, options = {}) {
  const d = new Date(timestamp);
  // Always read UTC — all stored timestamps use ISO Z (UTC)
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const sec = String(d.getUTCSeconds()).padStart(2, '0');

  // Date format setting — default YMD
  let dateFmt = 'YMD';
  try {
    dateFmt = game.settings?.get(MODULE_ID, 'dateFormat') || 'YMD';
  } catch { /* settings not registered yet */ }

  // Month style — number (03), short (Mar), or long (March)
  let monthStyle = 'number';
  try {
    monthStyle = game.settings?.get(MODULE_ID, 'dateMonthStyle') || 'number';
  } catch { /* settings not registered yet */ }

  let dateStr;
  if (monthStyle === 'number') {
    switch (dateFmt) {
      case 'DMY': dateStr = `${day}.${month}.${year}`; break;
      case 'MDY': dateStr = `${month}.${day}.${year}`; break;
      default:    dateStr = `${year}.${month}.${day}`; break;
    }
  } else {
    const mon = (monthStyle === 'long' ? MONTHS_LONG : MONTHS_SHORT)[d.getUTCMonth()];
    const dayU = d.getUTCDate();   // unpadded reads better with a written month
    switch (dateFmt) {
      case 'DMY': dateStr = `${dayU} ${mon} ${year}`; break;
      case 'MDY': dateStr = `${mon} ${dayU}, ${year}`; break;
      default:    dateStr = `${year} ${mon} ${dayU}`; break;
    }
  }

  if (options.dateOnly) return dateStr;

  // Time format setting — default 24h
  let use12h = false;
  try {
    use12h = game.settings?.get(MODULE_ID, 'timeFormat') === '12h';
  } catch { /* settings not registered yet */ }

  if (use12h) {
    let hr = d.getUTCHours();
    const ampm = hr >= 12 ? 'PM' : 'AM';
    hr = hr % 12 || 12;
    const timeStr = options.seconds ? `${hr}:${min}:${sec} ${ampm}` : `${hr}:${min} ${ampm}`;
    if (options.timeOnly) return timeStr;
    return `${dateStr} // ${timeStr}`;
  }

  const hr = String(d.getUTCHours()).padStart(2, '0');
  const timeStr = options.seconds ? `${hr}:${min}:${sec}` : `${hr}:${min}`;
  if (options.timeOnly) return timeStr;
  return `${dateStr} // ${timeStr}`;
}

/**
 * Debounce a function
 * @param {Function} fn
 * @param {number} delay - ms
 * @returns {Function}
 */
export function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Truncate text with ellipsis
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
export function truncate(str, maxLen = 50) {
  if (!str || str.length <= maxLen) return str ?? '';
  return str.substring(0, maxLen - 3) + '...';
}

/* ─────────────────────────────────────────────────────────────
   Color tone-mapping (OKLCH) — used by the readability contrast
   control to spread palette lightness in perceptual space instead
   of applying a CSS contrast() filter (which distorts images and
   drifts saturation). Pure functions, no Foundry globals.
   OKLab matrices from Björn Ottosson (bottosson.github.io/posts/oklab).
   ───────────────────────────────────────────────────────────── */

function _srgbToLinear(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function _linearToSrgb(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }

/**
 * Parse a `#rrggbb` (or `#rgb`) hex string into OKLCH { L, C, H }.
 * Returns null if the string isn't a hex color.
 * @param {string} hex
 * @returns {{L:number,C:number,H:number}|null}
 */
export function hexToOklch(hex) {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  let r = _srgbToLinear(parseInt(h.substr(0, 2), 16) / 255);
  let g = _srgbToLinear(parseInt(h.substr(2, 2), 16) / 255);
  let b = _srgbToLinear(parseInt(h.substr(4, 2), 16) / 255);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}

/**
 * Convert OKLCH { L, C, H } back to a `#rrggbb` hex string (clamped to gamut).
 * @param {{L:number,C:number,H:number}} oklch
 * @returns {string}
 */
export function oklchToHex({ L, C, H }) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = L - 0.0894841775 * A - 1.2914855480 * B;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;
  const toByte = c => Math.round(Math.max(0, Math.min(1, _linearToSrgb(c))) * 255)
    .toString(16).padStart(2, '0');
  return '#' + toByte(r) + toByte(g) + toByte(b);
}

/**
 * Spread a color's lightness around a pivot — the core of the readability
 * contrast control. `factor` > 1 pushes colors away from the pivot (darker
 * darks, lighter lights); < 1 pulls them toward it. Hue and chroma are
 * preserved, so neon stays neon. Returns the original string unchanged if it
 * isn't a parseable hex or if factor is 1.
 * @param {string} hex - base color (`#rrggbb`)
 * @param {number} factor - contrast multiplier (e.g. 0.8–1.4)
 * @param {number} [pivot=0.5] - OKLCH lightness the spread pivots around
 * @returns {string}
 */
export function adjustLightness(hex, factor, pivot = 0.5) {
  if (factor === 1) return hex;
  const c = hexToOklch(hex);
  if (!c) return hex;
  c.L = Math.max(0, Math.min(1, pivot + (c.L - pivot) * factor));
  return oklchToHex(c);
}

/**
 * Normalise a computed CSS colour string to 6-digit hex. Accepts #rgb / #rrggbb
 * / #rrggbbaa (alpha dropped) and rgb()/rgba() (as getComputedStyle hands back
 * a resolved custom property). Anything else (color-mix, gradients, empty) →
 * null, so callers can skip rather than corrupt a token.
 * @param {string} str
 * @returns {string|null}
 */
export function cssColorToHex(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.slice(0, 6).toLowerCase();
  }
  m = s.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
  if (m) {
    return '#' + [m[1], m[2], m[3]].map(v => Math.max(0, Math.min(255, parseInt(v, 10))).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

/**
 * Element-scoped readability contrast — the Theme Customizer's OKLCH tone-map
 * (see ThemeService.applyTheme + CONTRAST_SPREAD) applied to ONE surface on top
 * of whatever the player already has. For each bg/text/border token the base
 * colour is read from `baseFrom` (default :root — i.e. the player's own,
 * already-contrast-adjusted palette), pushed away from the pivot by the factor,
 * and written inline on `el`, where descendant var() lookups (and the shard
 * viewer's `--sp-*` aliases, which read `--ncm-*` on the same element) pick it
 * up. Accents are excluded, images untouched — same rules as the player slider.
 *
 * ALWAYS reads the base from `baseFrom`, never from `el` itself, so repeated
 * calls (a slider drag, a re-render) can't compound. 100% clears the inline
 * overrides instead of writing them, so an untouched surface keeps following
 * the player theme live.
 * @param {HTMLElement} el - the surface root (e.g. `.ncm-item-inbox`)
 * @param {number} contrastPct - 70–140 (%)
 * @param {{ baseFrom?: Element }} [opts]
 */
export function applyContrastToElement(el, contrastPct, { baseFrom } = {}) {
  if (!el?.style) return;
  const factor = (Number(contrastPct) || 100) / 100;
  const src = baseFrom || (typeof document !== 'undefined' ? document.documentElement : null);
  const computed = (src && typeof getComputedStyle === 'function') ? getComputedStyle(src) : null;
  for (const { cssVar, base } of CONTRAST_SPREAD.vars) {
    if (factor === 1) { el.style.removeProperty(cssVar); continue; }
    const live = computed ? cssColorToHex(computed.getPropertyValue(cssVar)) : null;
    el.style.setProperty(cssVar, adjustLightness(live || base, factor, CONTRAST_SPREAD.pivot));
  }
}

/**
 * Build the ThemeService.applyTheme prefs object for a TERMINAL theme —
 * shared by the viewer (renders the saved theme) and the config sheet (live
 * preview of the draft). Effective value per key = the GM's saved/draft
 * override, else the TERMINAL_PRESETS palette, else nothing (the key is
 * omitted so the viewer's preset-attribute CSS / base palette shows through).
 * `preset: null` stops applyTheme from merging the *player* THEME_PRESETS in.
 * @param {object} theme - flat terminal theme ({ preset, primary, …, fontDisplay, textScale, contrast })
 * @param {string} presetKey - active TERMINAL_PRESETS key ('classic' = no entry, pure fallthrough)
 * @returns {object} prefs for ThemeService.applyTheme
 */
export function buildTerminalThemePrefs(theme = {}, presetKey = '') {
  const tp = TERMINAL_PRESETS[presetKey]?.theme || {};
  const colors = {};
  for (const key of Object.keys(COLOR_VAR_MAP)) {
    const value = theme[key] || tp[key];
    if (value) colors[key] = value;
  }
  return {
    preset: null,
    colors,
    fonts: {
      display: theme.fontDisplay || tp.fontDisplay || 'rajdhani',
      mono: theme.fontMono || tp.fontMono || 'sharetechmono',
      title: theme.fontTitle || tp.fontTitle || 'orbitron',
    },
    textScale: theme.textScale ?? 100,
    contrast: theme.contrast ?? 100,
    // Per-terminal wallpaper (image behind the login + mailbox, dimmed by the
    // strength slider — --ncm-wallpaper-strength, default 25%).
    wallpaper: theme.wallpaper || null,
    wallpaperStrength: theme.wallpaperStrength,
    // Terminal glitch stored as 0–100 (slider); applyTheme wants 0–1 and only
    // writes the var when defined (element-scoped calls skip the 0.5 default).
    glitchIntensity: theme.glitch !== undefined ? (theme.glitch / 100) : undefined,
  };
}

/**
 * Build the `ThemeService.applyTheme` prefs for a DATA SHARD — the twin of
 * `buildTerminalThemePrefs`, shared by the viewer (renders the saved theme) and
 * the config sheet (live preview of the draft).
 *
 * Effective value per key = the GM's saved/draft override, else the preset's
 * `palette`, else nothing — the key is omitted so the player's own `:root` shows
 * through. That is what makes the `blank` preset (which deliberately has NO
 * palette) follow the player's Agent theme, the way it always should have.
 *
 * Until 2026-09-22 these palettes lived in `styles/themes/shard-presets.css` as
 * twenty hardcoded `--sp-*` values per preset. That is why the per-shard
 * CONTRAST slider did nothing on eight of the nine presets: contrast writes
 * `--ncm-*`, and a preset's `--sp-*` literals never read them. The palette is
 * now data, the `--sp-*` tokens derive from `--ncm-*` in one place, and every
 * knob composes.
 *
 * `preset: null` stops `applyTheme` from merging the *player* THEME_PRESETS in.
 *
 * @param {object|string} theme - `config.theme`. Tolerates the two legacy shapes:
 *   the dead `'classic'` string, and the preset CHROME block the Encoder writes
 *   (`accent`/`headerBg`/`watermarkIcon`/…) — the palette lives under `colors`,
 *   which neither of those has, so they coexist with no migration.
 * @param {string} presetKey - active SHARD_PRESETS key
 * @param {object} [opts]
 * @param {number} [opts.textScale] percent to publish (the caller composes the
 *   player's scale with the shard's; see ItemInboxApp._applyShardTheme)
 * @param {number} [opts.contrast] percent — pass 100 when a separate
 *   `applyContrastToElement` owns the tone-map (the viewer does, so it can read
 *   its base from the themed ancestor rather than from brand constants)
 * @returns {object} prefs for ThemeService.applyTheme
 */
export function buildShardThemePrefs(theme, presetKey = '', { textScale, contrast } = {}) {
  const t = (theme && typeof theme === 'object') ? theme : {};
  const pal = SHARD_PRESETS[presetKey]?.palette || {};
  const colors = {};
  for (const key of Object.keys(COLOR_VAR_MAP)) {
    const value = t.colors?.[key] || pal[key];
    if (value) colors[key] = value;
  }
  return {
    preset: null,
    colors,
    fonts: {
      display: t.fonts?.display || t.fontDisplay || 'rajdhani',
      mono: t.fonts?.mono || t.fontMono || 'sharetechmono',
      title: t.fonts?.title || t.fontTitle || 'orbitron',
    },
    textScale: textScale ?? 100,
    contrast: contrast ?? 100,
    wallpaper: t.wallpaper || null,
    wallpaperStrength: t.wallpaperStrength,
  };
}

/**
 * Resolve a terminal sound id through the terminal's sound set
 * (config.soundSet → TERMINAL_SOUND_SETS). Returns the possibly-remapped id
 * plus rate/volume shaping for SoundService.playStyled. Unknown set keys and
 * unmapped ids resolve to the untouched original, so legacy configs and the
 * 'default' set behave exactly as before.
 *
 * @param {string} setKey - A TERMINAL_SOUND_SETS key ('' / unknown = default)
 * @param {string} soundId - The original SOUND_PATHS id the code plays
 * @returns {{ id: string, rate: number, volume: number }}
 */
export function resolveTerminalSound(setKey, soundId) {
  const m = TERMINAL_SOUND_SETS[setKey]?.map?.[soundId];
  return { id: m?.id || soundId, rate: m?.rate ?? 1, volume: m?.volume ?? 1 };
}

// ─── Media Embeds (AV Log) ───

const _MEDIA_VIDEO_EXT = ['mp4', 'webm', 'ogv', 'mov', 'm4v'];
const _MEDIA_AUDIO_EXT = ['mp3', 'ogg', 'oga', 'wav', 'flac', 'm4a', 'aac'];

/**
 * Resolve an AV Log media source into a renderable embed descriptor.
 *
 * Detects YouTube/Vimeo links (→ iframe embed), otherwise treats the value as
 * a direct media file/URL (→ native <video>/<audio>). Anything with a scheme
 * other than http(s) (e.g. `javascript:`, `data:`) is rejected to `none` so a
 * player-authored shard can't inject a hostile src. `isVideo` is inferred from
 * the file extension when recognizable, else from `mediaType`.
 *
 * @param {string} rawUrl - File path, direct media URL, or YouTube/Vimeo link
 * @param {string} [mediaType='video'] - 'audio' | 'video' | 'braindance'
 * @returns {{ kind: 'none'|'native'|'embed', src: string, isVideo: boolean }}
 */
export function resolveMediaEmbed(rawUrl, mediaType = 'video') {
  const url = (rawUrl || '').trim();
  // Default: braindance/video → video player, audio → audio player
  let isVideo = mediaType !== 'audio';
  if (!url) return { kind: 'none', src: '', isVideo };

  // YouTube — watch / youtu.be / embed / shorts
  const yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (yt) return { kind: 'embed', src: `https://www.youtube.com/embed/${yt[1]}`, isVideo: true };

  // Vimeo — vimeo.com/ID or player.vimeo.com/video/ID
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { kind: 'embed', src: `https://player.vimeo.com/video/${vm[1]}`, isVideo: true };

  // Reject non-http(s) absolute schemes (javascript:, data:, etc.)
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
  if (hasScheme && !/^https?:\/\//i.test(url)) {
    return { kind: 'none', src: '', isVideo };
  }

  // Native file/direct URL — infer kind from extension when possible
  const ext = url.split(/[?#]/)[0].split('.').pop().toLowerCase();
  if (_MEDIA_VIDEO_EXT.includes(ext)) isVideo = true;
  else if (_MEDIA_AUDIO_EXT.includes(ext)) isVideo = false;

  return { kind: 'native', src: url, isVideo };
}

// ─── Anonymous Send ───────────────────────────────────────────
// Shared constants + resolver for the GM "Send Anonymously" feature. The real
// sender is stripped from the recipient-facing copy (truly hidden); these
// helpers drive the masked display for non-GM readers.

// ═══════════════════════════════════════════════════════════
//  Display-name resolution (sender / recipient of a message)
// ═══════════════════════════════════════════════════════════

/**
 * Resolve the DISPLAY name for one side of a message (sender or recipient).
 *
 * The GM's Master Contact Directory is the curated identity, so it beats the
 * raw actor name: an actor may be labeled "Rogue-Fixer" for GM bookkeeping
 * while the directory entry the players know is just "Rogue". Order:
 *   1. master contact by `contactId`
 *   2. master contact linked to `actorId`
 *   3. master contact by `email`
 *   4. the name stored on the message (`storedName`)
 *   5. the actor's name
 *   6. the email's local part, else `fallback`
 * Callers that also know the viewing player's OWN contact list should check
 * that first — a player's private label wins over the directory.
 *
 * @param {object} ids
 * @param {string} [ids.contactId]  — master contact id
 * @param {string} [ids.actorId]    — linked actor id
 * @param {string} [ids.email]      — address
 * @param {string} [ids.storedName] — name persisted on the message, if any
 * @param {string} [fallback='Unknown']
 * @returns {string}
 */
export function resolveDisplayName({ contactId, actorId, email, storedName } = {}, fallback = 'Unknown') {
  const master = globalThis.game?.nightcity?.masterContactService;
  const mc = (contactId && master?.getContact?.(contactId))
    || (actorId && master?.getByActorId?.(actorId))
    || (email && master?.getByEmail?.(email))
    || null;
  if (mc?.name) return mc.name;
  if (storedName) return storedName;
  const actor = actorId ? globalThis.game?.actors?.get?.(actorId) : null;
  if (actor?.name) return actor.name;
  const handle = typeof email === 'string' ? email.split('@')[0] : '';
  return handle || fallback;
}

/**
 * Portrait counterpart of {@link resolveDisplayName}: the master contact's
 * portrait, else the linked actor's art (never the mystery-man placeholder).
 * @param {{contactId?: string, actorId?: string, email?: string}} ids
 * @returns {string} image path or ''
 */
export function resolveDisplayPortrait({ contactId, actorId, email } = {}) {
  const master = globalThis.game?.nightcity?.masterContactService;
  const mc = (contactId && master?.getContact?.(contactId))
    || (actorId && master?.getByActorId?.(actorId))
    || (email && master?.getByEmail?.(email))
    || null;
  if (mc?.portrait) return mc.portrait;
  // An ALIAS never borrows its character's face — a burner identity that showed
  // Lucky Lin's portrait would give the game away (utils/identities.js).
  if (mc && identityRole(master?.getAll?.() || [], mc)?.isAlias) return '';
  const actor = (actorId || mc?.actorId) ? globalThis.game?.actors?.get?.(actorId || mc.actorId) : null;
  const img = actor?.img || '';
  return img && !img.includes('mystery-man') ? img : '';
}

/** Valid avatar mask styles. */
export const ANON_STYLES = Object.freeze(['filtered', 'scrambled', 'ghost', 'monolith']);

/** Fallback alias when the GM doesn't type one. */
export const ANON_DEFAULT_ALIAS = 'UNKNOWN';

/** Masked email shown in place of the real address. */
export const ANON_MASKED_EMAIL = '▓▓▓▓▓@darknet.relay';

/**
 * Normalize a mask style to a known value (defaults to 'scrambled').
 * @param {string} style
 * @returns {string}
 */
export function normalizeAnonStyle(style) {
  return ANON_STYLES.includes(style) ? style : 'scrambled';
}

/**
 * Resolve how an anonymous message's sender should be displayed.
 * Returns null when the message isn't anonymous (caller uses normal resolution).
 * GMs see through the mask when the real identity is still present on the copy
 * they're reading (the GM-owned sent copy retains it); the player-facing copy is
 * scrubbed, so non-GM readers always get the masked view.
 *
 * @param {object} message — a message object (from MessageRepository._pageToMessage)
 * @param {object} [opts]
 * @param {boolean} [opts.isGM] — defaults to the current user
 * @returns {null | {reveal: boolean, style: string, alias: string, name?: string, email?: string}}
 */
export function resolveAnonSender(message, opts = {}) {
  const a = message?.anonymous;
  // role 'recipient' masks the TO side (anon-reply sent copy), not the sender.
  // `traced` = a recipient successfully traced the sender — unmask for everyone.
  if (!a?.enabled || a.role === 'recipient' || a.traced) return null;
  const isGM = opts.isGM ?? !!game.user?.isGM;
  const style = normalizeAnonStyle(a.style);
  const alias = a.alias || ANON_DEFAULT_ALIAS;

  // GM can see through only when the real identity rode along on this copy.
  if (isGM && (message.fromActorId || message.fromContactId)) {
    return { reveal: true, style, alias };
  }

  return {
    reveal: false,
    style,
    alias,
    name: alias,
    email: a.maskedEmail || ANON_MASKED_EMAIL,
  };
}

/**
 * Resolve the masked-recipient display for an anonymous-reply sent copy (the
 * replier must not see who the anonymous party really was). Returns null unless
 * the message's anonymous block has role 'recipient'.
 * @param {object} message
 * @returns {null | {style: string, name: string, email: string}}
 */
export function resolveAnonRecipient(message) {
  const a = message?.anonymous;
  if (!a?.enabled || a.role !== 'recipient') return null;
  return {
    style: normalizeAnonStyle(a.style),
    name: a.alias || ANON_DEFAULT_ALIAS,
    email: a.maskedEmail || ANON_MASKED_EMAIL,
  };
}

// ═══════════════════════════════════════════════════════════
//  OPERATOR — the character a client ACTS AS (terminals / shards)
// ═══════════════════════════════════════════════════════════

/**
 * Every actor this user may act as. A player: the actors they OWN. A GM "owns"
 * everything, so listing that would be the whole world — instead we scope the GM
 * to the meaningful set: the PLAYER CHARACTERS (so the GM can test/operate as any
 * PC), plus their own assigned character if it isn't already a PC. That keeps the
 * operator picker useful for the GM (the "stuck on my one character" bug) without
 * dumping every NPC into it.
 * @returns {Actor[]}
 */
export function getOperatorActors() {
  const all = (game.actors?.contents ?? []).filter(a => a.type !== 'blackIce');
  if (game.user?.isGM) {
    const pcs = all.filter(a => a.hasPlayerOwner);
    const assigned = game.user.character;
    if (assigned && !pcs.includes(assigned)) pcs.unshift(assigned);
    return pcs;
  }
  return all.filter(a => a.isOwner);
}

/**
 * The character this client is acting as in the terminal / shard viewers —
 * the actor every roll, siphon, claim, and skill/stat read must use.
 * Resolution: remembered pick (still owned) → assigned character → the sole
 * owned actor → null. Reading `game.user.character` directly is the bug that
 * paid siphoned eddies to the wrong character.
 * @returns {Actor|null}
 */
export function resolveOperator() {
  try {
    const id = game.settings?.get(MODULE_ID, 'operatorActorId');
    if (id) {
      const a = game.actors?.get(id);
      if (a?.isOwner) return a;
    }
  } catch { /* setting not registered yet */ }
  const assigned = game.user?.character ?? null;
  if (assigned) return assigned;
  const owned = getOperatorActors();
  return owned.length === 1 ? owned[0] : null;
}

/**
 * HOW a gated hack/upload action resolves (design §5's `hackResolution`):
 * 'auto' (roll it — current behavior) · 'flagged' (roll + a GM card naming the
 * NET-action shape) · 'gm' (no roll — the table runs the NET, the GM calls it).
 * Global world setting with a per-terminal override (`terminalConfig
 * .hackResolution`, 'inherit' = follow the world). Sibling of `canOperate` —
 * that's WHO can act, this is HOW it resolves.
 * @param {Item|null} [item] the host terminal, when the action has one
 * @returns {'auto'|'flagged'|'gm'}
 */
export function resolveHackResolution(item = null) {
  const valid = ['auto', 'flagged', 'gm'];
  try {
    const o = item?.getFlag?.(MODULE_ID, 'terminalConfig')?.hackResolution;
    if (valid.includes(o)) return o;                       // 'inherit'/absent falls through
  } catch { /* not a flagged item */ }
  try {
    const g = game.settings?.get(MODULE_ID, 'hackResolution');
    if (valid.includes(g)) return g;
  } catch { /* setting not registered yet */ }
  return 'auto';
}

/**
 * The RED NET-action a module action abstracts (§5's `netAction.verb`), from the
 * same `action` strings the flows pass to fireTrace/logSuccess. Null when the
 * action has no netrunning shape (don't invent one).
 * @param {string} action @returns {string|null}
 */
export function netVerbFor(action) {
  if (!action) return null;
  return NET_ACTION_VERBS[String(action)] ?? null;
}

/**
 * A styled, LEGIBLE chat whisper card — the shared wrapper for every NCM
 * security whisper (heat changes, trace countdowns, lockouts, escalations).
 * The bare `<b>NCM trace:</b> …` whispers rendered at Foundry's default chat
 * size and were flagged as hard to read; this gives them the module's card
 * look at a readable size (styles: `.ncm-wcard` in styles/chat/chat-cards.css,
 * hard fallbacks — chat log has no --ncm-* ancestor).
 * @param {object} o
 * @param {string} [o.tone]  'info' | 'warn' | 'danger' | 'ok' | 'purple'
 * @param {string} [o.icon]  FA glyph class ('fa-fire')
 * @param {string} [o.title] header line (small caps)
 * @param {string[]} [o.lines] body lines — RAW HTML; escape user text with
 *   Handlebars.escapeExpression before interpolating.
 * @returns {string} HTML
 */
export function whisperCardHtml({ tone = 'info', icon = 'fa-shield-halved', title = 'NCM', lines = [] } = {}) {
  // The Esper-readout family (styles/chat/chat-cards.css): a record line, a
  // "// GM only" strip, then the lines. Tones map onto the family's colours.
  const mod = { warn: 'ncm-cc--gm', danger: 'ncm-cc--fail', ok: 'ncm-cc--ok', purple: 'ncm-cc--mal' }[tone] || '';
  const body = lines.filter(Boolean).map(l => `<div class="ncm-cc__line">${l}</div>`).join('');
  return `<div class="ncm-cc ${mod}">`
    + `<div class="ncm-cc__rec"><span class="ncm-cc__kind"><i class="fas ${icon}"></i> ${title}</span><span class="ncm-cc__time">${chatCardTime()}</span></div>`
    + `<div class="ncm-cc__whisper">GM only</div>`
    + body
    + `</div>`;
}

/**
 * The game-time stamp every chat card prints in its record line, in the GM's
 * configured date/time format (never raw Date.now()).
 * @param {string|number|Date} [iso]  a specific moment; defaults to the time provider's now
 * @returns {string}
 */
export function chatCardTime(iso) {
  try {
    const t = iso ?? globalThis.game?.nightcity?.timeService?.getCurrentTime?.() ?? new Date().toISOString();
    return formatCyberDate(t) || '';
  } catch { return ''; }
}

/**
 * Capability gate — can this actor use the OPERATOR tools (upload / hacking)?
 * (design §5b). Netrunning isn't for everyone: a GM can require a CPR role, a
 * skill rank, and/or a piece of gear, combined any-of or all-of, with an explicit
 * actor allowlist + GM escape. Reads the world `operatorGate` policy; an optional
 * `override` (a per-terminal gate) merges over it, so a hard box can demand more.
 * Default policy is 'anyone', so nothing is gated until a GM opts in.
 *
 * Reusable by design — today it gates the OPERATOR menu (upload/sweep), but the
 * same predicate can gate any future action so we never retrofit capability into
 * each site.
 * @param {Actor|null} actor
 * @param {object} [override] per-target gate override merged over the world policy
 * @returns {{ ok: boolean, reason?: string }}
 */
/**
 * The skill requirements of a gate as `[{name, min}]`: the `skills` list,
 * else the legacy single `skill` (gates saved before 2026-10-27), else none.
 * @param {object} gate
 * @returns {{name: string, min: number}[]}
 */
export function gateSkillsOf(gate) {
  const clean = (s) => ({ name: String(s?.name || '').trim(), min: Math.max(0, Math.round(Number(s?.min) || 0)) });
  const list = Array.isArray(gate?.skills) ? gate.skills.map(clean).filter(s => s.name) : [];
  if (list.length) return list;
  const one = clean(gate?.skill);
  return one.name ? [one] : [];
}

export function canOperate(actor, override = null, { standalone = false, label = 'Operator tools require' } = {}) {
  let gate;
  if (standalone) {
    // The caller owns the WHOLE gate (e.g. the Shard Encoder's `encoderConfig.gate`).
    // Merging the operatorGate world setting in here would silently import the
    // terminal rule for every field the caller's gate happens to omit — two gates
    // that look independent in the UI but are not.
    gate = { ...DEFAULTS.OPERATOR_GATE, ...(override || {}) };
  } else {
    try { gate = game.settings?.get(MODULE_ID, 'operatorGate') ?? {}; } catch { gate = {}; }
    gate = { ...DEFAULTS.OPERATOR_GATE, ...gate, ...(override || {}) };
  }

  if (gate.mode !== 'gated') return { ok: true };                 // ungated
  if (gate.allowGM && game.user?.isGM) return { ok: true };       // GM escape
  if (!actor) return { ok: false, reason: 'No operator assigned.' };
  if (Array.isArray(gate.actors) && gate.actors.includes(actor.id)) return { ok: true }; // allowlist

  // Evaluate ONLY the qualifiers the GM actually set (empty = not required).
  const checks = [];
  const owned = (actor.items ?? []).map(i => String(i.name).toLowerCase());
  const nameOf = (x) => (typeof x === 'string' ? x : (x?.name || ''));
  const carries = (name) => { const w = String(name).toLowerCase(); return w && owned.some(o => o.includes(w)); };

  if (Array.isArray(gate.roles) && gate.roles.length) {
    const roleItems = (actor.items ?? []).filter(i => i.type === 'role').map(i => String(i.name).toLowerCase());
    const wants = gate.roles.map(r => String(r).toLowerCase());
    const hasRole = (w) => roleItems.some(rn => rn.includes(w));
    const ok = gate.roleLogic === 'all' ? wants.every(hasRole) : wants.some(hasRole);
    checks.push({ label: gate.roles.join(gate.roleLogic === 'all' ? ' + ' : '/'), ok });
  }
  // Skills: ANY one listed skill at its own minimum rank (Interface 4+ OR
  // Electronics/Security Tech 6+). A gate saved before the list existed
  // carries one `skill`, read as a list of one.
  const skillReqs = gateSkillsOf(gate);
  if (skillReqs.length) {
    const svc = game.nightcity?.skillService;
    const ok = skillReqs.some(s => (svc?.getSkillData?.(actor, s.name)?.skillLevel ?? 0) >= s.min);
    checks.push({ label: skillReqs.map(s => `${s.name} ${s.min}+`).join(' or '), ok });
  }
  // Gear: OR-of-AND groups — satisfied if a character carries EVERY item in ANY
  // one group. Legacy flat `items` array is treated as a single group.
  const groups = (Array.isArray(gate.itemGroups) && gate.itemGroups.length
    ? gate.itemGroups
    : (Array.isArray(gate.items) && gate.items.length ? [gate.items] : []))
    .map(g => (Array.isArray(g) ? g.map(nameOf).filter(Boolean) : [])).filter(g => g.length);
  if (groups.length) {
    const ok = groups.some(g => g.every(carries));
    checks.push({ label: groups.map(g => g.join('+')).join(' or '), ok });
  }

  if (!checks.length) return { ok: true }; // gated but nothing configured → inert (no accidental lockout)
  const ok = gate.logic === 'all' ? checks.every(c => c.ok) : checks.some(c => c.ok);
  if (ok) return { ok: true };
  const need = checks.map(c => c.label).join(gate.logic === 'all' ? ' + ' : ' or ');
  return { ok: false, reason: `${label} ${need}.` };
}

/**
 * May this character encode a data shard? The ONE answer every authoring door reads
 * — the Agent's Encode pill, the item right-click, the Program Deck's blank cartridge,
 * the Encoder window itself and the unconvert affordance — so a character can never
 * be offered a door that the window behind it then refuses.
 *
 * Two independent conditions, reported separately because the fixes differ: the GM
 * has not switched player authoring on at all (a world setting), versus this
 * particular character not qualifying (a gate the GM wrote).
 *
 * @param {Actor|null} actor the operating character
 * @param {object} [opts]
 * @param {boolean} [opts.requireActor] false → judge only the world-level switch,
 *   for a door that has not resolved an operator yet
 * @returns {{ ok: boolean, reason?: string, off?: boolean }} `off` = authoring is
 *   switched off world-wide, as opposed to this character not qualifying.
 */
export function canEncode(actor, { requireActor = true } = {}) {
  if (game.user?.isGM) return { ok: true };   // the GM authors through the config sheet regardless

  let cfg;
  try { cfg = game.settings?.get(MODULE_ID, 'encoderConfig') ?? {}; } catch { cfg = {}; }
  if (!cfg?.enabled) return { ok: false, off: true, reason: 'Your GM has not switched on player shard authoring.' };

  const gate = cfg.gate;
  if (!gate || gate.mode !== 'gated') return { ok: true };
  if (!requireActor && !actor) return { ok: true };  // the door shows; the window asks for an operator

  return canOperate(actor, gate, { standalone: true, label: 'Encoding a shard requires' });
}

/**
 * May this character REWRITE an existing shard — add a file to it, or re-encode
 * it? The one answer every edit door reads (the viewer's Add Entry, the item
 * right-click, the Encoder's "re-encode" source list and the Encoder itself).
 * Three gates, reported with the reason that applies:
 *   · the shard's own `playerEditing` rule (see resolveShardEditing — a GM-made
 *     shard is locked unless the GM opened it; a player-made one is its maker's)
 *   · the world-wide encoder switch + gate (`canEncode`)
 *   · the GM's "rewrite a sloppy shard" setting (`encoderConfig.reencode.allowed`)
 * The GM always may — they author through the config sheet and the composer.
 * @param {Item|null} item the shard
 * @param {Actor|null} actor the operating character
 * @returns {{ ok: boolean, reason?: string, locked?: boolean, mode?: string }}
 */
export function canEditShard(item, actor) {
  if (!item?.getFlag?.(MODULE_ID, 'isDataShard')) return { ok: false, reason: 'That is not a data shard.' };
  if (game.user?.isGM) return { ok: true, mode: 'gm' };
  const config = item.getFlag(MODULE_ID, 'config') || {};
  const mode = resolveShardEditing(config);
  if (mode === 'locked') return { ok: false, locked: true, mode, reason: 'This shard is read-only — its contents are locked.' };
  if (mode === 'maker' && (!actor || config.playerMade?.actorId !== actor.id)) {
    return { ok: false, locked: true, mode, reason: `Only ${config.playerMade?.actorName || 'the character who encoded it'} can rewrite this shard.` };
  }
  const enc = canEncode(actor);
  if (!enc.ok) return { ...enc, mode };
  let cfg;
  try { cfg = game.settings?.get(MODULE_ID, 'encoderConfig') ?? {}; } catch { cfg = {}; }
  if (cfg?.reencode?.allowed === false) return { ok: false, mode, reason: 'Your GM does not allow rewriting a shard once it is encoded.' };
  return { ok: true, mode };
}

/** Remember the acting character for this client. */
export async function setOperatorActor(actorId) {
  try {
    await game.settings.set(MODULE_ID, 'operatorActorId', actorId || '');
  } catch (err) {
    log.warn(`setOperatorActor failed: ${err.message}`);
  }
}

/**
 * Operator switcher — the immersive BIOMETRIC HANDOFF picker (OperatorSelect,
 * a framework-free FUI modal; host-scoped so it inherits the viewer's preset).
 * Lazy-imported to keep helpers.js dependency-free at module load.
 * @param {HTMLElement} [host] the viewer element (theme source)
 * @returns {Promise<boolean>} true = the operator changed (caller re-renders)
 */
export async function openOperatorPicker(host = null) {
  const owned = getOperatorActors();
  if (owned.length <= 1) {
    ui.notifications.info(owned.length
      ? `NCM | You only control one character (${owned[0].name}).`
      : 'NCM | You have no characters assigned.');
    return false;
  }
  const current = resolveOperator()?.id || '';
  const { runOperatorSelect } = await import('../ui/content/OperatorSelect.js');
  const picked = await runOperatorSelect({ actors: owned, currentId: current, host });
  if (!picked || picked === current) return false;
  await setOperatorActor(picked);
  ui.notifications.info(`NCM | Now operating as ${game.actors.get(picked)?.name}.`);
  return true;
}

/**
 * Second layer against the browser password manager (the first is
 * autocomplete="new-password" + the extension opt-outs on the field): every
 * secret field and login handle under `root` is READ-ONLY until the player
 * touches it. No browser autofills a readonly field, and the guard lifts on the
 * first pointerdown / keydown — before the key's default action, so the typed
 * character still lands. Focus alone does NOT lift it (an autofocused field
 * would lift it at render and defeat the point). Idempotent per element.
 * @param {HTMLElement|null} root
 * @returns {number} how many fields were guarded
 */
export function guardSecretInputs(root) {
  const fields = root?.querySelectorAll?.('input[data-ncm-secret], input[type="password"], input[autocomplete="new-password"], input[data-ncm-login]');
  // Third layer, the one managers cannot see (dev, 2026-10-21: Chrome's manager AND
  // NordPass still offered the Forge login after the attributes, the readonly guard
  // AND a CSS-masked text field — Chromium's form parser treats a text field with
  // -webkit-text-security as a password field, and NordPass keys on the label).
  // So a secret field is a PLAIN text input whose DISPLAYED value is bullets painted
  // here; the real text lives in script and is served through the element's own
  // `value` property, so every reader (`input.value`) and writer (the keypad's
  // `input.value = …`) works unchanged. Nothing on the element says "password".
  let n = 0;
  for (const el of fields ?? []) {
    if (el.dataset.ncmGuarded) continue;
    el.dataset.ncmGuarded = '1';
    // The templates emit a TEXT field from the start (data-ncm-secret) — a browser
    // classifies a field the moment it enters the page, so a type="password" that
    // script later flips to text has already summoned the manager.
    if (el.dataset.ncmSecret || el.type === 'password') shadowSecretInput(el);
    // The NAME field stops being an <input> entirely (dev, 2026-10-21: NordPass still
    // attached to a plain text field however it was labelled or named).
    if (el.dataset.ncmLogin) { shadowLoginInput(el); continue; }
    el.readOnly = true;
    el.classList.add('ncm-autofill-guard');
    const lift = () => { el.readOnly = false; el.classList.remove('ncm-autofill-guard'); };
    el.addEventListener('pointerdown', lift, { once: true });
    el.addEventListener('keydown', lift, { once: true });
    n++;
  }
  return n;
}

/**
 * Replace a secret <input> with an editable element that shows BULLETS while the
 * real text lives in script and is served through the (now hidden) input's own
 * `value` property — every reader (`input.value`) and writer (the keypad's
 * `input.value = …`) works unchanged, and `keydown` Enter is forwarded to the
 * input so the login screens' own Enter listeners still fire. Managers attach to
 * inputs; they do not attach to editable text (dev, 2026-10-21: NordPass went
 * for the shadowed text input as soon as the name field stopped being one).
 * `el.ncmSetMasked(false)` reveals (the auth dialog's eye); `el.ncmFocus()`
 * focuses the editable. Idempotent.
 * @param {HTMLInputElement} el
 */
export function shadowSecretInput(el) {
  if (!el || el.dataset.ncmShadow) return;
  const doc = el.ownerDocument;
  const Proto = globalThis.HTMLInputElement?.prototype;
  const desc = Proto && Object.getOwnPropertyDescriptor(Proto, 'value');
  if (!doc?.createElement || !el.insertAdjacentElement || !desc?.set || !desc?.get || !(el instanceof globalThis.HTMLInputElement)) return;
  el.dataset.ncmShadow = '1';
  let real = String(desc.get.call(el) || '');
  let masked = true;
  const ce = doc.createElement('div');
  ce.className = `${el.className || ''} ncm-login-ce ncm-secret-ce`.trim();
  ce.setAttribute('contenteditable', 'true');
  ce.setAttribute('role', 'textbox');
  ce.setAttribute('spellcheck', 'false');
  ce.setAttribute('tabindex', el.tabIndex < 0 ? '-1' : '0');
  ce.setAttribute('data-placeholder', el.getAttribute?.('placeholder') || '');
  try {
    const cs = globalThis.getComputedStyle?.(el);
    if (cs) for (const p of ['font', 'color', 'backgroundColor', 'border', 'borderRadius', 'padding', 'width', 'height', 'lineHeight', 'letterSpacing', 'flex', 'boxSizing', 'textAlign']) ce.style[p] = cs[p];
  } catch { /* no layout (sim) */ }
  el.insertAdjacentElement('beforebegin', ce);
  el.type = 'hidden';
  const paint = () => {
    ce.textContent = masked ? '\u2022'.repeat(real.length) : real;
    desc.set.call(el, real);
    // keep the caret at the end of the repainted text while the editable has focus
    try {
      const sel = doc.getSelection?.();
      if (sel && doc.activeElement === ce && doc.createRange) { const r = doc.createRange(); r.selectNodeContents(ce); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    } catch { /* unfocused */ }
  };
  Object.defineProperty(el, 'value', { configurable: true, get: () => real, set: (v) => { real = String(v ?? ''); paint(); } });
  el.ncmSetMasked = (on) => { masked = !!on; paint(); };
  el.ncmFocus = () => ce.focus?.();
  ce.addEventListener('beforeinput', (ev) => {
    const t = ev.inputType || '';
    ev.preventDefault();
    if (t === 'insertText' || t === 'insertCompositionText') real += ev.data ?? '';
    else if (t === 'insertFromPaste' || t === 'insertFromDrop') real += (ev.dataTransfer?.getData?.('text') ?? ev.data ?? '').replace(/[\r\n]+/g, '');
    else if (t === 'deleteWordBackward') real = real.replace(/\S*\s*$/, '');
    else if (t === 'deleteContentBackward' || t === 'deleteContentForward' || t === 'deleteByCut') real = real.slice(0, -1);
    else if (t.startsWith('delete')) real = '';
    // anything exotic (history, formatting, line breaks) is dropped rather than corrupting the secret
    paint();
  });
  ce.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const KE = globalThis.KeyboardEvent;
    if (KE) el.dispatchEvent(new KE('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  });
  if (el.autofocus) ce.focus?.();
  paint();
}

/**
 * Replace a login-name <input> with an editable text element that LOOKS like it
 * and mirrors into the original, now hidden, input — so every reader that queries
 * `[name="…"]` still gets the value. Password managers attach to inputs; they do
 * not attach to contenteditable text. Enter moves focus to the secret field.
 * @param {HTMLInputElement} el
 * @returns {HTMLElement|null} the editable element
 */
export function shadowLoginInput(el) {
  if (!el || el.dataset.ncmCe) return null;
  const doc = el.ownerDocument;
  if (!doc?.createElement || !el.insertAdjacentElement) return null;
  el.dataset.ncmCe = '1';
  const ce = doc.createElement('div');
  ce.className = `${el.className || ''} ncm-login-ce`.trim();
  ce.setAttribute('contenteditable', 'true');
  ce.setAttribute('role', 'textbox');
  ce.setAttribute('spellcheck', 'false');
  ce.setAttribute('tabindex', '0');
  ce.setAttribute('data-placeholder', el.getAttribute?.('placeholder') || '');
  ce.textContent = el.value || '';
  // dress it exactly like the input it replaces, whatever the host styled that input as
  try {
    const cs = globalThis.getComputedStyle?.(el);
    if (cs) for (const p of ['font', 'color', 'backgroundColor', 'border', 'borderRadius', 'padding', 'width', 'height', 'lineHeight', 'letterSpacing', 'flex', 'boxSizing', 'textAlign', 'textTransform']) ce.style[p] = cs[p];
  } catch { /* no layout (sim) */ }
  el.insertAdjacentElement('beforebegin', ce);
  el.type = 'hidden';
  const sync = () => { el.value = String(ce.textContent || '').replace(/[\r\n]+/g, '').trim(); };
  ce.addEventListener('input', sync);
  ce.addEventListener('blur', sync);
  ce.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    sync();
    const scope = el.closest?.('form, .ncm-sec-login-form, .ncm-term__manual, .ncm-term__login, .window-content') || doc;
    const nxt = scope.querySelector?.('input[data-ncm-secret]');
    if (nxt?.ncmFocus) nxt.ncmFocus(); else nxt?.focus?.();
  });
  ce.addEventListener('paste', (ev) => {
    ev.preventDefault();
    const text = (ev.clipboardData?.getData?.('text') || '').replace(/[\r\n]+/g, '');
    try { doc.execCommand('insertText', false, text); } catch { ce.textContent += text; }
    sync();
  });
  if (el.autofocus) ce.focus?.();
  return ce;
}
