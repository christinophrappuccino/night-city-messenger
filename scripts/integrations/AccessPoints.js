/**
 * Access points — the runtime (Foundry side). Rules live in scripts/utils/accessPoints.js.
 * @file scripts/integrations/AccessPoints.js
 *
 * ONE door: `game.nightcity.openAccess(ref)` opens a terminal / shard / inbox / message. Every trigger
 * carries a ref and comes through it:
 *   - a hotbar macro          (createMacro, or drag a converted item / an admin row onto the hotbar)
 *   - a chat card             (postCard — themed, the Open button carries data-ncm-access)
 *   - a journal link          (@NCM[kind:id]{label} → a themed chip, via CONFIG.TextEditor.enrichers)
 *   - a map pin               (TerminalScenePins, unchanged)
 * Handout colours: world setting `accessHandoutStyle` { mode: match|default|custom, custom:{…} }.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM, buildTerminalThemePrefs, buildShardThemePrefs } from '../utils/helpers.js';
import { adminDialog, playerDialog } from '../utils/adminTheme.js';
import { THEMED_DIALOG_CLASSES } from '../utils/dialogBody.js';
import { showNamePicker, documentEntries } from '../utils/namePicker.js';
import {
  ACCESS_KINDS, HANDOUT_STYLES, ACCESS_LINK_PATTERN, accessRef, isAccessRef, parseAccessLink, accessLinkText,
  accessMacroCommand, accessMacroSnippet, sanitizeHandoutStyle, postDialogHtml, placementDialogHtml, placementHint, sanitizePlacement, handoutPalette, paletteStyle, accessCardHtml, accessChipHtml, escHtml,
} from '../utils/accessPoints.js';

const MACRO_FOLDER = 'NCM — Access points';

/** The stored handout style. */
export function getHandoutStyle() {
  try { return sanitizeHandoutStyle(game.settings.get(MODULE_ID, 'accessHandoutStyle')); } catch { return sanitizeHandoutStyle({}); }
}

/** The ref for a converted item (terminal / shard), else null. */
export function refForItem(item) {
  if (!item) return null;
  if (item.getFlag?.(MODULE_ID, 'isTerminal')) return accessRef('terminal', item.uuid);
  if (item.getFlag?.(MODULE_ID, 'isDataShard')) return accessRef('shard', item.uuid);
  return null;
}

function _item(id) {
  try { return fromUuidSync(id) ?? game.items.get(id) ?? null; } catch { return game.items.get(id) ?? null; }
}

/**
 * What a ref points at, for handouts and lists.
 * @returns {{ found:boolean, name:string, sub:string, tags:string[], img:string, source:object|null }}
 */
export function describeAccess(ref) {
  const out = { found: false, name: ACCESS_KINDS[ref?.kind]?.label || 'Access', sub: '', tags: [], img: 'icons/svg/door-steel.svg', source: null };
  if (!isAccessRef(ref)) return out;
  try {
    if (ref.kind === 'terminal') {
      const item = _item(ref.id); if (!item) return out;
      const cfg = game.nightcity?.terminalService?.getConfig(item) || {};
      const md = cfg.metadata || {};
      const n = (cfg.accounts || []).filter(a => !a.hidden).length;
      Object.assign(out, { found: true, name: cfg.terminalName || item.name, img: item.img, sub: [md.org, md.location].filter(Boolean).join(' · '),
        tags: [n ? `${n} account${n === 1 ? '' : 's'}` : '', md.classification || ''], source: buildTerminalThemePrefs(cfg.theme || {}, cfg.theme?.preset || '').colors });
    } else if (ref.kind === 'node') {
      const ns = game.nightcity?.networkService;
      const node = ns?.getNode?.(ref.id); if (!node) return out;
      const net = ns.getNetwork(node.networkId);
      const scene = node.sceneId ? game.scenes.get(node.sceneId) : null;
      const c = net?.theme?.color || '#19f3f7';
      Object.assign(out, { found: true, name: node.name, img: `modules/${MODULE_ID}/assets/icons/nodes/${node.kind}.svg`,
        sub: [net?.name, scene?.name].filter(Boolean).join(' · '), tags: [node.hidden ? 'hidden' : ''],
        source: { primary: c, accent: c, bgDeep: '#07070c', textPrimary: '#e6ecf5' } });
    } else if (ref.kind === 'shard') {
      const item = _item(ref.id); if (!item) return out;
      const cfg = game.nightcity?.dataShardService?.getConfig(item) || {};
      Object.assign(out, { found: true, name: cfg.shardName || item.name, img: item.img, sub: item.parent?.name ? `carried by ${item.parent.name}` : '',
        tags: [cfg.encrypted ? 'locked' : ''], source: buildShardThemePrefs(cfg.theme, cfg.preset || '').colors });
    } else {
      const [owner] = ref.id.split('|');
      const actor = game.actors.get(owner);
      const contact = actor ? null : game.nightcity?.masterContactService?.getContact?.(owner);
      if (!actor && !contact) return out;
      const name = actor?.name || contact?.name;
      const email = actor?.getFlag?.(MODULE_ID, 'email') || contact?.email || '';
      Object.assign(out, { found: true, name: ref.kind === 'inbox' ? `${name}'s inbox` : `A message for ${name}`, img: actor?.img || contact?.portrait || out.img, sub: email });
    }
  } catch (err) { log.debug(`describeAccess: ${err.message}`); }
  out.tags = out.tags.filter(Boolean);
  return out;
}

/** The palette a handout for this ref wears right now. */
export function paletteFor(ref, style = getHandoutStyle()) {
  return handoutPalette(style, describeAccess(ref).source);
}

/** Open whatever the ref points at. */
export function openAccess(ref) {
  if (!isAccessRef(ref)) return void ui.notifications.warn('Night City Messenger: that access point is broken.');
  const ns = game.nightcity;
  switch (ref.kind) {
    case 'terminal': return ns?.openTerminal?.(ref.id);
    case 'shard': return ns?.openDataShard?.(ref.id);
    case 'node': return ns?.openNode?.(ref.id);
    case 'inbox':
    case 'message': {
      const [owner, messageId] = ref.id.split('|');
      const actor = game.actors.get(owner);
      if (!isGM() && !actor?.isOwner) return void ui.notifications.warn('That inbox is not yours to open.');
      return ns?.openInbox?.(owner, ref.kind === 'message' ? messageId : undefined);
    }
  }
}

async function _macroFolder() {
  if (!isGM()) return null;
  return game.folders.find(f => f.type === 'Macro' && f.name === MACRO_FOLDER)
    ?? await Folder.create({ name: MACRO_FOLDER, type: 'Macro', color: '#19f3f7' });
}

/**
 * A hotbar macro that opens the ref (reuses one this user already has for it), put on the hotbar.
 * @param {object} ref
 * @param {{slot?:number, assign?:boolean}} [opts]
 */
export async function createAccessMacro(ref, { slot, assign = true } = {}) {
  if (!isAccessRef(ref)) return null;
  try {
    const d = describeAccess(ref);
    let macro = game.macros.find(m => m.isOwner && m.getFlag(MODULE_ID, 'access')?.kind === ref.kind && m.getFlag(MODULE_ID, 'access')?.id === ref.id);
    if (!macro) {
      const folder = await _macroFolder();
      macro = await Macro.create({ name: d.name, type: 'script', img: d.img, command: accessMacroSnippet(ref, d.name), folder: folder?.id ?? null,
        flags: { [MODULE_ID]: { access: { kind: ref.kind, id: ref.id } } } });
    }
    if (macro && assign) await game.user.assignHotbarMacro(macro, slot ?? null);
    if (macro && assign) ui.notifications.info(`"${macro.name}" is on your hotbar.`);
    else if (macro) ui.notifications.info(`Macro "${macro.name}" is in the "${MACRO_FOLDER}" folder — pick it in any tool that runs a macro (set it to run as the triggering player).`);
    return macro;
  } catch (err) {
    log.error(`createAccessMacro: ${err.message}`);
    ui.notifications.warn(`Could not make the macro — ${err.message}`);
    return null;
  }
}

/**
 * Copy the macro code for the ref — paste it wherever a script goes. If the clipboard is blocked (an http world),
 * show it in a dialog to copy by hand.
 */
export async function copyAccessMacro(ref) {
  const code = accessMacroSnippet(ref, describeAccess(ref).name);
  try {
    await navigator.clipboard.writeText(code);
    ui.notifications.info('Macro code copied — paste it into any tool that runs a script. Set it to run as the triggering player.');
  } catch {
    adminDialog({
      title: 'Macro code', default: 'ok',
      content: `<p style="margin:0 0 8px">Copy this and paste it wherever a script goes:</p><textarea readonly style="width:100%;height:150px;font-family:var(--ncm-font-mono, monospace);font-size:12px">${escHtml(code)}</textarea>`,
      buttons: { ok: { icon: '<i class="fas fa-check"></i>', label: 'Done' } },
      render: (html) => { const t = (html[0] ?? html).querySelector('textarea'); t?.focus(); t?.select(); },
    }, { width: 520, classes: ['dialog', 'ncm-themed-dialog'] }).render(true);
  }
  return code;
}

/** Copy the journal-link text for the ref. */
export async function copyAccessLink(ref) {
  const text = accessLinkText(ref, describeAccess(ref).name);
  try { await navigator.clipboard.writeText(text); ui.notifications.info('Link copied — paste it into any journal page.'); }
  catch { ui.notifications.info(`Paste this into a journal page: ${text}`); }
  return text;
}

/**
 * Post a themed card to chat. Opens a small dialog (who sees it + the colours) unless `quiet`.
 * @param {object} ref
 * @param {{whisper?:string[]|null, style?:object, quiet?:boolean}} [opts]
 */
export async function postAccessCard(ref, opts = {}) {
  if (!isAccessRef(ref)) return null;
  let choice = { whisper: opts.whisper ?? null, style: opts.style ?? getHandoutStyle() };
  if (!opts.quiet) { choice = await _postDialog(ref, choice.style); if (!choice) return null; }
  const d = describeAccess(ref);
  const content = accessCardHtml(ref, { name: d.name, sub: d.sub, tags: d.tags }, handoutPalette(choice.style, d.source));
  const gms = game.users.filter(u => u.isGM).map(u => u.id);
  const whisper = choice.whisper?.length ? [...new Set([...choice.whisper, ...gms])] : [];
  return ChatMessage.create({ content, whisper, speaker: { alias: 'Night City Messenger' }, flags: { [MODULE_ID]: { access: { kind: ref.kind, id: ref.id } } } });
}

/** The post dialog: who sees it, which colours (saved as the new default). Resolves null on cancel. */
function _postDialog(ref, style) {
  const d = describeAccess(ref);
  const players = game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: u.name }));
  const content = postDialogHtml({ ref, info: d, style, players, source: d.source });
  return new Promise((resolve) => {
    let result = null;
    const read = (root) => {
      const mode = root.querySelector('.ncm-ap-dlg__opt.is-on')?.dataset.style || 'match';
      const custom = {}; for (const k of ['primary', 'accent', 'bg', 'text']) custom[k] = root.querySelector(`[name="${k}"]`)?.value;
      return sanitizeHandoutStyle({ mode, custom });
    };
    const dlg = (isGM() ? adminDialog : playerDialog)({
      title: 'Post to chat', content,
      buttons: {
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
        post: { icon: '<i class="fas fa-paper-plane"></i>', label: 'Post to chat', callback: (html) => {
          const root = html[0] ?? html; const st = read(root);
          const who = root.querySelector('.ncm-ap-dlg__segb.is-on')?.dataset.who || 'all';
          const one = root.querySelector('[name="whoOne"]')?.value;
          const whisper = who === 'gm' ? game.users.filter(u => u.isGM).map(u => u.id) : (who === 'one' && one) ? [one] : null;
          try { game.settings.set(MODULE_ID, 'accessHandoutStyle', st); } catch { /* not GM */ }
          result = { whisper, style: st };
        } },
      },
      default: 'post',
      render: (html) => {
        const root = html[0] ?? html;
        // Re-fit + re-centre when the content grows (the custom pickers, a player list) — Foundry
        // placed the window for its first height and it would otherwise grow off the bottom.
        const refit = () => requestAnimationFrame(() => {
          const h = root.closest('.app')?.offsetHeight || 0;
          dlg.setPosition({ height: 'auto', top: Math.max(10, Math.round((window.innerHeight - h) / 2)) });
        });
        const paint = () => {
          const st = read(root);
          root.querySelector('.ncm-ap-dlg__custom').hidden = st.mode !== 'custom';
          const sw = root.querySelector('.ncm-ap-dlg__opt[data-style="custom"] .ncm-ap-dlg__sw');
          if (sw) sw.setAttribute('style', paletteStyle(handoutPalette({ mode: 'custom', custom: st.custom })));
          root.querySelector('.ncm-ap-dlg__prev').innerHTML = accessCardHtml(ref, { name: d.name, sub: d.sub, tags: d.tags }, handoutPalette(st, d.source));
        };
        root.querySelectorAll('.ncm-ap-dlg__opt').forEach(b => b.addEventListener('click', () => {
          root.querySelectorAll('.ncm-ap-dlg__opt').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
          paint(); refit();
        }));
        root.querySelectorAll('.ncm-ap-dlg__segb').forEach(b => b.addEventListener('click', () => {
          root.querySelectorAll('.ncm-ap-dlg__segb').forEach(x => x.classList.toggle('is-on', x === b));
          const one = root.querySelector('.ncm-ap-dlg__one'); if (one) one.hidden = b.dataset.who !== 'one';
          refit();
        }));
        root.querySelectorAll('input[type=color]').forEach(i => i.addEventListener('input', paint));
        refit();
      },
      close: () => resolve(result),
    }, { width: 470, classes: [...THEMED_DIALOG_CLASSES, 'ncm-ap-dialog'] });
    dlg.render(true);
  });
}

/**
 * The placement dialog (step 3): which scene, where, pin / step-on area / both, reach or area size, visible or
 * hidden → TerminalScenePins.placeAccess. Remembers the last choices for the session.
 * @param {Item} item — a terminal or a shard
 * @param {{sceneId?:string}} [opts]
 */
let _lastPlace = { how: 'pin', where: 'view', range: null, size: 2, hidden: false };
export async function openPlaceDialog(item, { sceneId } = {}) {
  const ref = refForItem(item);
  if (!ref) return ui.notifications.warn('Only a terminal or a shard can be placed on a scene.');
  const d = describeAccess(ref);
  const cfgRange = ref.kind === 'terminal' ? Number(game.nightcity?.terminalService?.getConfig(item)?.scenePin?.range) || 0 : 0;
  let scene = game.scenes.get(sceneId) || canvas?.scene || game.scenes.find(s => s.active) || null;
  const place = sanitizePlacement({ ..._lastPlace, range: _lastPlace.range ?? cfgRange, sceneId: scene?.id });
  const content = placementDialogHtml({ ref, info: d, place, sceneName: scene?.name || '' });
  return new Promise((resolve) => {
    let result = null;
    const read = (root) => sanitizePlacement({
      how: root.querySelector('[data-plc-seg="how"] .is-on')?.dataset.v,
      where: root.querySelector('[data-plc-seg="where"] .is-on')?.dataset.v,
      hidden: root.querySelector('[data-plc-seg="hidden"] .is-on')?.dataset.v === '1',
      range: root.querySelector('[name="range"]')?.value,
      size: root.querySelector('[name="size"]')?.value,
      sceneId: root.querySelector('[name="sceneId"]')?.value,
    });
    const dlg = adminDialog({
      title: 'Place on a scene', content,
      buttons: {
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
        place: { icon: '<i class="fas fa-map-pin"></i>', label: 'Place', callback: (html) => { result = read(html[0] ?? html); } },
      },
      default: 'place',
      render: (html) => {
        const root = html[0] ?? html;
        const plc = root.querySelector('.ncm-plc');
        const paint = () => {
          const p = read(root);
          plc.dataset.how = p.how;
          root.querySelector('[data-plc-hint]').textContent = placementHint(p);
          requestAnimationFrame(() => dlg.setPosition({ height: 'auto' }));
        };
        root.querySelectorAll('.ncm-plc__seg').forEach(seg => seg.addEventListener('click', (e) => {
          const b = e.target.closest('.ncm-plc__segb'); if (!b) return;
          seg.querySelectorAll('.ncm-plc__segb').forEach(x => x.classList.toggle('is-on', x === b)); paint();
        }));
        root.querySelectorAll('[name="range"], [name="size"]').forEach(i => i.addEventListener('input', paint));
        root.querySelector('[data-plc-pick-scene]')?.addEventListener('click', async () => {
          const pick = await showNamePicker({ title: 'Which scene?', entries: documentEntries(game.scenes.contents, { fallbackImg: 'icons/svg/village.svg' }), selected: scene?.id, placeholder: 'find a scene…' });
          const s2 = pick?.id ? game.scenes.get(pick.id) : null;
          if (!s2) return;
          scene = s2;
          root.querySelector('[name="sceneId"]').value = s2.id;
          root.querySelector('[data-plc-scene-name]').textContent = s2.name;
        });
        paint();
      },
      close: () => resolve(result),
    }, { width: 500, classes: [...THEMED_DIALOG_CLASSES, 'ncm-plc-dialog'] });
    dlg.render(true);
  }).then(async (p) => {
    if (!p) return null;
    _lastPlace = { how: p.how, where: p.where, range: p.range, size: p.size, hidden: p.hidden };
    return game.nightcity?.terminalScenePins?.placeAccess(item, p);
  });
}

/** The ACCESS section of the Night City menu for a converted item (shared by the directory + sheets). */
export function accessMenuEntries(item) {
  const ref = refForItem(item); if (!ref) return [];
  const out = [{ head: 'Access' }];
  if (isGM()) out.push({ label: 'Place on a scene…', icon: 'fas fa-map-pin', fn: () => openPlaceDialog(item) });
  out.push({ label: 'Add to hotbar', icon: 'fas fa-bolt', fn: () => createAccessMacro(ref) });
  if (isGM()) {
    out.push({ label: 'Post to chat…', icon: 'fas fa-comment', fn: () => postAccessCard(ref) });
    out.push({ label: 'Copy journal link', icon: 'fas fa-link', fn: () => copyAccessLink(ref) });
    out.push({ label: 'Copy macro code', icon: 'fas fa-code', fn: () => copyAccessMacro(ref) });
    out.push({ label: 'Make a macro', icon: 'fas fa-scroll', fn: () => createAccessMacro(ref, { assign: false }) });
  }
  return out;
}

/**
 * The ACCESS entries for a network node (the admin Nodes row, the node pin menu). Same choices as an item's.
 * @param {string} nodeId
 */
export function nodeAccessEntries(nodeId) {
  const ref = accessRef('node', nodeId); if (!ref) return [];
  const out = [{ head: 'Access' }];
  if (isGM()) out.push({ label: 'Place on its scene…', icon: 'fas fa-map-pin', fn: () => openNodePlaceDialog(nodeId) });
  out.push({ label: 'Add to hotbar', icon: 'fas fa-bolt', fn: () => createAccessMacro(ref) });
  if (isGM()) {
    out.push({ label: 'Post to chat…', icon: 'fas fa-comment', fn: () => postAccessCard(ref) });
    out.push({ label: 'Copy journal link', icon: 'fas fa-link', fn: () => copyAccessLink(ref) });
    out.push({ label: 'Copy macro code', icon: 'fas fa-code', fn: () => copyAccessMacro(ref) });
    out.push({ label: 'Make a macro', icon: 'fas fa-scroll', fn: () => createAccessMacro(ref, { assign: false }) });
  }
  return out;
}

/**
 * Place a node on its scene as a pin / step-on area (the item placement dialog, the node's own scene preselected).
 * Picking another scene MOVES the node there (a node stands where it is placed).
 */
export async function openNodePlaceDialog(nodeId) {
  const ns = game.nightcity?.networkService;
  const node = ns?.getNode?.(nodeId);
  if (!node) return ui.notifications.warn('That node no longer exists.');
  const ref = accessRef('node', nodeId);
  const d = describeAccess(ref);
  let scene = game.scenes.get(node.sceneId) || canvas?.scene || null;
  const place = sanitizePlacement({ ..._lastPlace, range: _lastPlace.range ?? 1, sceneId: scene?.id, hidden: node.hidden });
  const content = placementDialogHtml({ ref, info: d, place, sceneName: scene?.name || '' });
  const p = await new Promise((resolve) => {
    let result = null;
    const read = (root) => sanitizePlacement({
      how: root.querySelector('[data-plc-seg="how"] .is-on')?.dataset.v,
      where: root.querySelector('[data-plc-seg="where"] .is-on')?.dataset.v,
      hidden: root.querySelector('[data-plc-seg="hidden"] .is-on')?.dataset.v === '1',
      range: root.querySelector('[name="range"]')?.value,
      size: root.querySelector('[name="size"]')?.value,
      sceneId: root.querySelector('[name="sceneId"]')?.value,
    });
    const dlg = adminDialog({
      title: 'Place a node', content,
      buttons: {
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
        place: { icon: '<i class="fas fa-map-pin"></i>', label: 'Place', callback: (html) => { result = read(html[0] ?? html); } },
      },
      default: 'place',
      render: (html) => {
        const root = html[0] ?? html;
        const plc = root.querySelector('.ncm-plc');
        const paint = () => { const q = read(root); plc.dataset.how = q.how; root.querySelector('[data-plc-hint]').textContent = placementHint(q); requestAnimationFrame(() => dlg.setPosition({ height: 'auto' })); };
        root.querySelectorAll('.ncm-plc__seg').forEach(seg => seg.addEventListener('click', (e) => {
          const b = e.target.closest('.ncm-plc__segb'); if (!b) return;
          seg.querySelectorAll('.ncm-plc__segb').forEach(x => x.classList.toggle('is-on', x === b)); paint();
        }));
        root.querySelectorAll('[name="range"], [name="size"]').forEach(i => i.addEventListener('input', paint));
        root.querySelector('[data-plc-pick-scene]')?.addEventListener('click', async () => {
          const pick = await showNamePicker({ title: 'Which scene?', entries: documentEntries(game.scenes.contents, { fallbackImg: 'icons/svg/village.svg' }), selected: scene?.id, placeholder: 'find a scene…' });
          const s2 = pick?.id ? game.scenes.get(pick.id) : null;
          if (!s2) return;
          scene = s2;
          root.querySelector('[name="sceneId"]').value = s2.id;
          root.querySelector('[data-plc-scene-name]').textContent = s2.name;
        });
        paint();
      },
      close: () => resolve(result),
    }, { width: 500, classes: [...THEMED_DIALOG_CLASSES, 'ncm-plc-dialog'] });
    dlg.render(true);
  });
  if (!p) return null;
  _lastPlace = { how: p.how, where: p.where, range: p.range, size: p.size, hidden: p.hidden };
  // a node stands where it is placed; its own Hidden switch follows the placement's
  if (p.sceneId !== node.sceneId || p.hidden !== node.hidden) await ns.saveNode({ ...node, sceneId: p.sceneId, hidden: p.hidden });
  return game.nightcity?.terminalScenePins?.placeNode(nodeId, p);
}

/** A small grouped menu of entries anchored under a button (generic — showAccessMenu builds an item's). */
export function showEntriesMenu(entries, anchor) {
  document.querySelectorAll('.ncm-ctx-menu').forEach(m => m.remove());
  if (!entries?.length) return;
  const menu = document.createElement('div');
  menu.className = 'ncm-ctx-menu ncm-app';
  const theme = anchor?.closest?.('[data-ncm-admin-theme]')?.dataset.ncmAdminTheme;
  if (theme) menu.dataset.ncmAdminTheme = theme;
  for (const e of entries) {
    const el = document.createElement('div');
    if (e.sep) { el.className = 'ncm-ctx-menu__sep'; menu.appendChild(el); continue; }
    if (e.head) { el.className = 'ncm-ctx-menu__head'; el.textContent = e.head; menu.appendChild(el); continue; }
    if (!e.label || typeof e.fn !== 'function') continue;   // never draw a blank 'undefined' row
    el.className = 'ncm-ctx-menu__item' + (e.bad ? ' is-bad' : '');
    el.innerHTML = `<i class="${e.icon}"></i>`;
    el.append(document.createTextNode(e.label));
    el.addEventListener('click', (ev) => { ev.stopPropagation(); close(); e.fn(); });
    menu.appendChild(el);
  }
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${r.left}px`; menu.style.top = `${r.bottom + 3}px`;
  document.body.appendChild(menu);
  const b = menu.getBoundingClientRect();
  if (b.right > window.innerWidth - 4) menu.style.left = `${Math.max(4, r.right - b.width)}px`;
  if (b.bottom > window.innerHeight - 4) menu.style.top = `${Math.max(4, r.top - b.height - 3)}px`;
  const out = (ev) => { if (!menu.contains(ev.target)) close(); };
  const key = (ev) => { if (ev.key === 'Escape') close(); };
  function close() { menu.remove(); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', key, true); }
  requestAnimationFrame(() => { document.addEventListener('pointerdown', out, true); document.addEventListener('keydown', key, true); });
}

/** Wire everything that needs `ready`: the click door, the hotbar drop, the API. */
export function registerAccessPoints() {
  const ns = (game.nightcity ??= {});
  Object.assign(ns, { openAccess, describeAccess, createAccessMacro, postAccessCard, copyAccessLink, copyAccessMacro, accessRefForItem: refForItem, placeAccess: openPlaceDialog });

  // One click door for chat cards + journal chips (anywhere in the document).
  document.addEventListener('click', (ev) => {
    const el = ev.target.closest?.('[data-ncm-access]'); if (!el) return;
    ev.preventDefault(); ev.stopPropagation();
    let ref = null; try { ref = JSON.parse(el.dataset.ncmAccess); } catch { /* broken */ }
    if (el.classList.contains('is-missing')) return void ui.notifications.warn('That access point no longer exists.');
    openAccess(ref);
  }, true);

  // Drag onto the hotbar: an admin row ({type:'NCMAccess', ref}) or a converted item.
  Hooks.on('hotbarDrop', (bar, data, slot) => {
    let ref = null;
    if (data?.type === 'NCMAccess') ref = accessRef(data.ref?.kind ?? data.kind, data.ref?.id ?? data.id);
    else if (data?.type === 'Item' && data.uuid) { try { ref = refForItem(fromUuidSync(data.uuid)); } catch { ref = null; } }
    if (!ref) return;
    createAccessMacro(ref, { slot });
    return false;
  });
  log.info('Access points registered (openAccess, hotbar drop, chat/journal door)');
}

/** The @NCM[kind:id]{label} enricher — registered at init (CONFIG.TextEditor). */
export function registerAccessEnricher() {
  CONFIG.TextEditor.enrichers.push({
    pattern: new RegExp(ACCESS_LINK_PATTERN.source, 'g'),
    enricher: async (match) => {
      const p = parseAccessLink(match);
      const wrap = document.createElement('span');
      if (!p) { wrap.textContent = match[0]; return wrap; }
      const d = describeAccess(p.ref);
      wrap.innerHTML = accessChipHtml(p.ref, p.label || d.name, paletteFor(p.ref), !d.found);
      return wrap.firstElementChild;
    },
  });
}

export { paletteStyle };

/**
 * A small grouped menu of the ACCESS entries, anchored under a button (the admin Terminals / Shards
 * detail). Wears the opener window's admin preset; outside click or Esc closes it.
 */
export function showAccessMenu(item, anchor) {
  return showEntriesMenu(accessMenuEntries(item), anchor);
}


/** Make rows draggable onto the hotbar: each `[data-item-id]` row matching `selector` under `root`. */
export function wireAccessDrag(root, selector, findItem) {
  root?.querySelectorAll(selector).forEach((row) => {
    if (row._ncmAccessDrag) return;
    const item = findItem(row.dataset.itemId); const ref = refForItem(item); if (!ref) return;
    row._ncmAccessDrag = true;
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (ev) => {
      ev.dataTransfer?.setData('text/plain', JSON.stringify({ type: 'NCMAccess', ref }));
    });
  });
}
