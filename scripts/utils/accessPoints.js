/**
 * Access points — the pure rules (no Foundry globals, sim-tested in dev/tools/sims/test-access-points.mjs).
 * @file scripts/utils/accessPoints.js
 *
 * An ACCESS POINT is one way a player can open something NCM owns: a terminal, a shard, an inbox,
 * or one message. The thing is a REF — `{ kind, id }` (a UUID for items, an owner id for an inbox,
 * `<ownerId>|<messageId>` for a message). The triggers (hotbar macro, chat card, journal link; map
 * pin / step-on area / tile next) all carry that same ref and all open it through ONE runtime call,
 * `game.nightcity.openAccess(ref)` (scripts/integrations/AccessPoints.js).
 *
 * Handouts (the chat card, the journal chip, the hotbar icon) are themed by `handoutPalette`:
 *   match   — the source's own colours (a terminal's / shard's theme, built by the caller)
 *   default — the module's brand palette
 *   custom  — the GM's own four colours (primary, accent, background, text)
 * (dev-approved mock dev/mockups/access-points-v2-mock.html, 2026-10-29)
 */

export const ACCESS_KINDS = Object.freeze({
  terminal: { label: 'Terminal', icon: 'fa-terminal', open: 'Log in' },
  shard: { label: 'Shard', icon: 'fa-microchip', open: 'Open the shard' },
  inbox: { label: 'Inbox', icon: 'fa-inbox', open: 'Open the inbox' },
  message: { label: 'Message', icon: 'fa-envelope', open: 'Read it' },
  node: { label: 'Network node', icon: 'fa-tower-broadcast', open: 'Open the node' },
});

export const HANDOUT_STYLES = Object.freeze([['match', 'Match the source'], ['default', 'Module default'], ['custom', 'My colours']]);

/** The module's brand palette (variables.css defaults) — the "Module default" handout. */
export const HANDOUT_DEFAULT = Object.freeze({ p: '#19f3f7', a: '#f7c948', bg: '#0b0b12', tx: '#e6ecf5', tx2: '#9aa4b8' });

const HEX = /^#[0-9a-f]{6}$/i;

/** A ref is valid when its kind is known and it has an id. */
export function isAccessRef(ref) {
  return !!ref && typeof ref === 'object' && !!ACCESS_KINDS[ref.kind] && typeof ref.id === 'string' && ref.id.length > 0;
}

/** Normalise anything ref-shaped (or null). */
export function accessRef(kind, id) {
  const ref = { kind: String(kind || ''), id: String(id || '').trim() };
  return isAccessRef(ref) ? ref : null;
}

/** The text a journal page uses: @NCM[terminal:Item.abc]{WS-7F-12}. Braces/brackets in a label are dropped. */
export function accessLinkText(ref, label = '') {
  if (!isAccessRef(ref)) return '';
  const l = String(label || '').replace(/[{}\[\]]/g, '').trim();
  return `@NCM[${ref.kind}:${ref.id}]${l ? `{${l}}` : ''}`;
}

/** The pattern TextEditor's enricher matches (global, for String.replace / matchAll). */
export const ACCESS_LINK_PATTERN = /@NCM\[(terminal|shard|inbox|message|node):([^\]]+)\](?:\{([^}]*)\})?/g;

/** Parse one match of ACCESS_LINK_PATTERN → { ref, label }. */
export function parseAccessLink(match) {
  if (!match) return null;
  const ref = accessRef(match[1], match[2]);
  return ref ? { ref, label: (match[3] || '').trim() } : null;
}

/** Every link in a block of text (journal page HTML), for the Access points list. */
export function findAccessLinks(text) {
  const out = [];
  for (const m of String(text || '').matchAll(ACCESS_LINK_PATTERN)) { const p = parseAccessLink(m); if (p) out.push(p); }
  return out;
}

/**
 * The macro command for a ref. Double-quoted strings only (the gen-macros rule), guarded so a macro
 * run with the module off says so instead of throwing.
 */
export function accessMacroCommand(ref) {
  if (!isAccessRef(ref)) return '';
  const r = JSON.stringify({ kind: ref.kind, id: ref.id });
  return `const NCM = game.nightcity;\nif (!NCM || !NCM.openAccess) { ui.notifications.warn("Night City Messenger is not active."); return; }\nNCM.openAccess(${r});`;
}

/**
 * The macro body WITH a header that says what it opens and how to use it elsewhere — what "Copy macro code" hands
 * the GM to paste into any tool that runs a script (Monk's Active Tiles, Item Piles, a Region, Stream Deck…), and
 * what a made macro carries. The warning matters: many trigger modules run a macro on the GM's client by default,
 * so the terminal would open for the GM instead of the player.
 */
export function accessMacroSnippet(ref, name = '') {
  if (!isAccessRef(ref)) return '';
  const label = String(name || ACCESS_KINDS[ref.kind].label).replace(/[\r\n]+/g, ' ').slice(0, 80);
  return [
    `// Night City Messenger — opens ${label} (${ACCESS_KINDS[ref.kind].label.toLowerCase()}).`,
    '// It opens for whoever RUNS this. In a tile / trigger module, set it to run as the player who triggered it',
    '// (in Monk\'s Active Tiles, pick the triggering player in the Run Macro action), or it opens on the GM\'s screen instead.',
    accessMacroCommand(ref),
  ].join('\n');
}

/** A hex colour or the fallback. */
const hexOr = (v, f) => (HEX.test(String(v || '')) ? String(v) : f);

/** Mix two hex colours (t of b into a). Used for the muted text when only four colours are given. */
export function mixHex(a, b, t) {
  const pa = hexOr(a, '#000000'), pb = hexOr(b, '#000000');
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map(i => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t).toString(16).padStart(2, '0'));
  return `#${c.join('')}`;
}

/** Sanitise the stored style setting: { mode, custom: {primary, accent, bg, text} }. */
export function sanitizeHandoutStyle(raw = {}) {
  const mode = HANDOUT_STYLES.some(([k]) => k === raw?.mode) ? raw.mode : 'match';
  const c = raw?.custom || {};
  return { mode, custom: { primary: hexOr(c.primary, '#c084fc'), accent: hexOr(c.accent, '#34d399'), bg: hexOr(c.bg, '#0d0a14'), text: hexOr(c.text, '#efe9ff') } };
}

/**
 * The palette a handout wears.
 * @param {{mode:string, custom?:object}} style — sanitizeHandoutStyle output
 * @param {object|null} source — the source's colours as theme keys (primary, accent, bgDeep, textPrimary, textSecondary); null = none
 * @returns {{p:string, a:string, bg:string, tx:string, tx2:string}}
 */
export function handoutPalette(style, source = null) {
  const s = sanitizeHandoutStyle(style);
  if (s.mode === 'custom') {
    const c = s.custom;
    return { p: c.primary, a: c.accent, bg: c.bg, tx: c.text, tx2: mixHex(c.text, c.bg, 0.35) };
  }
  if (s.mode === 'match' && source) {
    const d = HANDOUT_DEFAULT;
    const bg = hexOr(source.bgDeep || source.bgBase, d.bg);
    const tx = hexOr(source.textPrimary, d.tx);
    return { p: hexOr(source.primary, d.p), a: hexOr(source.accent || source.secondary, d.a), bg, tx, tx2: hexOr(source.textSecondary, mixHex(tx, bg, 0.35)) };
  }
  return { ...HANDOUT_DEFAULT };
}

/** The palette as inline CSS custom properties (the handout markup reads --h-*). */
export function paletteStyle(p) {
  return `--h-p:${p.p};--h-a:${p.a};--h-bg:${p.bg};--h-tx:${p.tx};--h-tx2:${p.tx2}`;
}

/** Escape text for HTML. */
export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * The chat card markup (inline-styled through custom properties, so it themes in the chat log with no
 * ancestor). `info` = { name, sub, tags[], kicker }. The Open button carries the ref as data-ncm-access.
 */
export function accessCardHtml(ref, info = {}, palette = HANDOUT_DEFAULT) {
  if (!isAccessRef(ref)) return '';
  const k = ACCESS_KINDS[ref.kind];
  const tags = (info.tags || []).filter(Boolean).map(t => `<span class="ncm-ap-card__tag">${escHtml(t)}</span>`).join('');
  return `<div class="ncm-ap-card" style="${paletteStyle(palette)}">
  <div class="ncm-ap-card__k">// ${escHtml(k.label.toLowerCase())}<span>${escHtml(info.kicker || 'access point')}</span></div>
  <div class="ncm-ap-card__t"><span class="ncm-ap-card__ico"><i class="fas ${k.icon}"></i></span>${escHtml(info.name || k.label)}</div>
  ${info.sub ? `<div class="ncm-ap-card__s">${escHtml(info.sub)}</div>` : ''}
  ${tags ? `<div class="ncm-ap-card__tags">${tags}</div>` : ''}
  <button type="button" class="ncm-ap-card__open" data-ncm-access='${escHtml(JSON.stringify(ref))}'><i class="fas fa-door-open"></i>${escHtml(info.open || k.open)}</button>
</div>`;
}

/** The inline chip a journal link becomes. */
export function accessChipHtml(ref, label, palette = HANDOUT_DEFAULT, missing = false) {
  if (!isAccessRef(ref)) return '';
  const k = ACCESS_KINDS[ref.kind];
  return `<a class="ncm-ap-chip${missing ? ' is-missing' : ''}" style="${paletteStyle(palette)}" data-ncm-access='${escHtml(JSON.stringify(ref))}' title="${missing ? 'Not found — it was deleted or renamed' : `Open ${escHtml(label || k.label)}`}"><i class="fas ${missing ? 'fa-link-slash' : k.icon}"></i>${escHtml(label || k.label)}</a>`;
}

/**
 * The Post to chat dialog body (admin vocabulary: a header naming the thing, banded sections, a segmented
 * "who sees it", three colour cards with their swatches, the custom pickers, a framed preview).
 * @param {object} o
 * @param {object} o.ref
 * @param {{name:string, sub:string}} o.info
 * @param {object} o.style — sanitizeHandoutStyle output
 * @param {{id:string, name:string}[]} o.players
 * @param {object|null} o.source — the source's theme colours (for the "match" swatch)
 */
export function postDialogHtml({ ref, info = {}, style = {}, players = [], source = null }) {
  const previewHtml = accessCardHtml(ref, info, handoutPalette(style, source));
  const k = ACCESS_KINDS[ref?.kind] || ACCESS_KINDS.terminal;
  const s = sanitizeHandoutStyle(style);
  const src = handoutPalette({ mode: 'match' }, source);
  const sw = (p) => `<span class="ncm-ap-dlg__sw" style="${paletteStyle(p)}"><i></i><i></i><i></i></span>`;
  const pals = { match: src, default: handoutPalette({ mode: 'default' }), custom: handoutPalette(s) };
  const hints = { match: source ? 'the terminal\'s own theme' : 'nothing to match — uses the default', default: 'NCM cyan and amber', custom: 'pick four colours' };
  const cards = HANDOUT_STYLES.map(([key, l]) => `<button type="button" class="ncm-ap-dlg__opt${key === s.mode ? ' is-on' : ''}" data-style="${key}" aria-pressed="${key === s.mode}">${sw(pals[key])}<span class="ncm-ap-dlg__ol">${escHtml(l)}</span><span class="ncm-ap-dlg__oh">${escHtml(hints[key])}</span></button>`).join('');
  const pick = (key, l) => `<label class="ncm-ap-dlg__pick"><input type="color" name="${key}" value="${s.custom[key]}"><span>${l}</span></label>`;
  const opts = players.map(u => `<option value="${escHtml(u.id)}">${escHtml(u.name)}</option>`).join('');
  return `<div class="ncm-ap-dlg">
  <div class="ncm-ap-dlg__thing" style="${paletteStyle(src)}">
    <span class="ncm-ap-dlg__ico"><i class="fas ${k.icon}"></i></span>
    <span class="ncm-ap-dlg__nm"><b>${escHtml(info.name || k.label)}</b>${info.sub ? `<small>${escHtml(info.sub)}</small>` : ''}</span>
    <span class="ncm-ap-dlg__kind">${escHtml(k.label)}</span>
  </div>
  <section class="ncm-ap-dlg__sec">
    <div class="ncm-ap-dlg__k"><i class="fas fa-eye"></i>Who sees it</div>
    <div class="ncm-ap-dlg__seg" role="radiogroup">
      <button type="button" class="ncm-ap-dlg__segb is-on" data-who="all"><i class="fas fa-users"></i>Everyone</button>
      <button type="button" class="ncm-ap-dlg__segb" data-who="gm"><i class="fas fa-user-secret"></i>Only GMs</button>
      ${players.length ? `<button type="button" class="ncm-ap-dlg__segb" data-who="one"><i class="fas fa-user"></i>One player</button>` : ''}
    </div>
    ${players.length ? `<div class="ncm-ap-dlg__one" hidden><select name="whoOne">${opts}</select><span class="ncm-ap-dlg__note">GMs always see it too.</span></div>` : ''}
  </section>
  <section class="ncm-ap-dlg__sec">
    <div class="ncm-ap-dlg__k"><i class="fas fa-palette"></i>Colours <span class="ncm-ap-dlg__kh">remembered for next time</span></div>
    <div class="ncm-ap-dlg__opts">${cards}</div>
    <div class="ncm-ap-dlg__custom"${s.mode === 'custom' ? '' : ' hidden'}>${pick('primary', 'Main')}${pick('accent', 'Accent')}${pick('bg', 'Background')}${pick('text', 'Text')}</div>
  </section>
  <section class="ncm-ap-dlg__sec ncm-ap-dlg__sec--prev">
    <div class="ncm-ap-dlg__k"><i class="fas fa-comment"></i>Preview <span class="ncm-ap-dlg__kh">as it lands in chat</span></div>
    <div class="ncm-ap-dlg__prev">${previewHtml}</div>
  </section>
</div>`;
}

// ═══════════════════════════════════════════════════════════
//  Step 3 — placing on a scene (2026-10-29): pins, step-on areas, hidden / revealed
// ═══════════════════════════════════════════════════════════

/** How players get in. */
export const PLACE_HOW = Object.freeze([['pin', 'A pin', 'fa-map-pin'], ['area', 'A step-on area', 'fa-draw-polygon'], ['both', 'Both', 'fa-layer-group']]);
/** Where on the map it lands. */
export const PLACE_WHERE = Object.freeze([['view', 'Middle of my view', 'fa-crosshairs'], ['click', 'Click on the map', 'fa-hand-pointer']]);
/** Area sizes in grid squares. */
export const AREA_SIZES = Object.freeze([1, 2, 3, 4]);

/** Sanitise a placement request. */
export function sanitizePlacement(o = {}) {
  const how = PLACE_HOW.some(([k]) => k === o.how) ? o.how : 'pin';
  const where = PLACE_WHERE.some(([k]) => k === o.where) ? o.where : 'view';
  const range = Math.max(0, Math.min(30, Math.round(Number(o.range) || 0)));
  const size = AREA_SIZES.includes(Number(o.size)) ? Number(o.size) : 2;
  return { how, where, range, size, hidden: !!o.hidden, sceneId: String(o.sceneId || '') };
}

/**
 * The script a step-on area runs. Region events reach EVERY client, so it acts only on the client of the user
 * who moved the token, never for the GM (moving NPCs around must not pop terminals), and only for a token that
 * user owns. Double-quoted strings, no backticks.
 */
export function accessRegionScript(ref, name = '') {
  if (!isAccessRef(ref)) return '';
  const r = JSON.stringify({ kind: ref.kind, id: ref.id });
  const label = String(name || '').replace(/[\r\n*/]/g, ' ').slice(0, 60);
  return [
    `// Night City Messenger access point${label ? ` — ${label}` : ''}. Opens it for the player whose token walks in.`,
    'if (!event.user?.isSelf || game.user.isGM) return;',
    'const tok = event.data?.token;',
    'if (tok && !tok.actor?.isOwner) return;',
    'const NCM = game.nightcity;',
    'if (!NCM?.openAccess) return;',
    `NCM.openAccess(${r});`,
  ].join('\n');
}

/** A centred square area in canvas pixels. */
export function areaRect(center, sizeSquares, gridSize) {
  const w = Math.max(1, Number(sizeSquares) || 1) * (Number(gridSize) || 100);
  return { x: Math.round(center.x - w / 2), y: Math.round(center.y - w / 2), width: w, height: w };
}

/** The placement dialog body (themed: header, segmented rows, the reach / size field shown for the chosen way in). */
export function placementDialogHtml({ ref, info = {}, place = {}, sceneName = '' }) {
  const k = ACCESS_KINDS[ref?.kind] || ACCESS_KINDS.terminal;
  const p = sanitizePlacement(place);
  const seg = (name, rows, cur) => `<div class="ncm-plc__seg" data-plc-seg="${name}">${rows.map(([key, label, icon]) =>
    `<button type="button" class="ncm-plc__segb${key === cur ? ' is-on' : ''}" data-v="${key}"><i class="fas ${icon}"></i>${escHtml(label)}</button>`).join('')}</div>`;
  const sizes = AREA_SIZES.map(n => `<option value="${n}"${n === p.size ? ' selected' : ''}>${n} × ${n} squares</option>`).join('');
  return `<div class="ncm-plc" data-how="${p.how}">
  <div class="ncm-dlgb__hd">
    <span class="ncm-dlgb__ico">${info.img ? `<img src="${escHtml(info.img)}" alt="">` : `<i class="fas ${k.icon}"></i>`}</span>
    <span class="ncm-dlgb__nm"><b>${escHtml(info.name || k.label)}</b>${info.sub ? `<small>${escHtml(info.sub)}</small>` : ''}</span>
    <span class="ncm-dlgb__kind">${escHtml(k.label)}</span>
  </div>
  <div class="ncm-plc__bd">
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-map"></i>Scene</span>
      <span class="ncm-plc__scene"><b data-plc-scene-name>${escHtml(sceneName || 'Pick a scene')}</b><button type="button" class="ncm-plc__link" data-plc-pick-scene><i class="fas fa-repeat"></i>Change</button></span>
      <input type="hidden" name="sceneId" value="${escHtml(p.sceneId)}"></div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-location-dot"></i>Where</span>${seg('where', PLACE_WHERE, p.where)}</div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-door-open"></i>Way in</span>${seg('how', PLACE_HOW, p.how)}</div>
    <div class="ncm-plc__row ncm-plc__only-pin"><span class="ncm-plc__k"><i class="fas fa-bullseye"></i>Pin reach</span>
      <span class="ncm-plc__num"><input type="number" name="range" min="0" max="30" step="1" value="${p.range}"><span>squares from a token they own · 0 = anywhere on the scene</span></span></div>
    <div class="ncm-plc__row ncm-plc__only-area"><span class="ncm-plc__k"><i class="fas fa-vector-square"></i>Area</span>
      <span class="ncm-plc__num"><select name="size">${sizes}</select><span>centred where it lands · reshape it later on the Regions layer</span></span></div>
    <div class="ncm-plc__row"><span class="ncm-plc__k"><i class="fas fa-eye"></i>Players see it</span>${seg('hidden', [['0', 'Right away', 'fa-eye'], ['1', 'Hidden until I reveal it', 'fa-eye-slash']], p.hidden ? '1' : '0')}</div>
    <p class="ncm-plc__hint" data-plc-hint></p>
  </div>
</div>`;
}

/** The one-line hint under the form, for the current choices. */
export function placementHint(place) {
  const p = sanitizePlacement(place);
  const parts = [];
  if (p.where === 'click') parts.push('After you press Place, click the map where it goes (Esc cancels).');
  if (p.how !== 'pin') parts.push('A player opens it by moving a token they own into the area — moving tokens as the GM never triggers it.');
  if (p.how !== 'area') parts.push(p.range ? `Players double-click the pin with a token within ${p.range} square${p.range === 1 ? '' : 's'}.` : 'Players double-click the pin from anywhere on the scene.');
  if (p.hidden) parts.push('Hidden: players can\'t see or use it until you reveal it (right-click it, or Admin → Access points).');
  return parts.join(' ');
}
