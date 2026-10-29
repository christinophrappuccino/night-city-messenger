/**
 * Terminal Scene Pins — clickable terminals on the game canvas
 * @file scripts/integrations/TerminalScenePins.js
 * @module night-city-messenger
 * @description Drag a Terminal item onto a scene and it becomes a map-note
 *   "access point" (icon = the item's art, hover = the terminal name) that
 *   players DOUBLE-CLICK to open the TerminalViewer.
 *
 *   Design decisions (2026-07-11, dev-approved):
 *   - Representation = a Note document linked to the terminal's message journal
 *     (already created OBSERVER, so players can see + activate the pin). No
 *     tiles, no dummy actors, no libWrapper.
 *   - Drop interception must be DETERMINISTIC vs other drop-handling modules
 *     (Item Piles turns dropped items into loot piles). Core binds the canvas
 *     drop as an `ondrop` property on #board, and every module (incl. Item
 *     Piles) rides the `dropCanvasData` hook fired inside it — so a CAPTURE
 *     listener on `document` runs first no matter the module load order.
 *     We claim the event ONLY for NCM terminal items and stopPropagation();
 *     everything else (including data shards, which arguably SHOULD become
 *     loot piles) falls through untouched. A `dropCanvasData` hook returning
 *     false is kept as belt-and-braces.
 *   - Opening rides the core `activateNote` hook (returning false suppresses
 *     the default journal sheet). Caveat: Hooks.call stops at the FIRST false,
 *     so a journal-takeover module (e.g. Monk's Enhanced Journal) registered
 *     earlier could swallow our pins — no clean fix; documented.
 *   - Map notes are invisible until the client's core "notesDisplayToggle" is
 *     on (defaults OFF) — `terminalPinsAutoShow` (world, default on) flips it
 *     at ready so pins just work.
 *   - Optional proximity gate: config.scenePin.range (grid squares, 0 = off) —
 *     a player needs an owned token within range of the pin to log in from the
 *     scene. GMs bypass. Opening from the item itself is deliberately ungated.
 */

import { MODULE_ID } from '../utils/constants.js';
import { log, isGM } from '../utils/helpers.js';
import { themedConfirm } from '../utils/adminTheme.js';
import { dialogBodyHtml } from '../utils/dialogBody.js';
import { sanitizePlacement, accessRegionScript, areaRect } from '../utils/accessPoints.js';

/** Is this note an NCM access pin? (terminal pins since 2026-07; any kind since 2026-10-29) */
export function isAccessPin(doc) {
  return !!(doc?.getFlag?.(MODULE_ID, 'terminalItemId') || doc?.getFlag?.(MODULE_ID, 'accessUuid') || doc?.getFlag?.(MODULE_ID, 'accessNode'));
}

/** The network-node id a pin opens, else null. */
export function nodePinOf(doc) {
  return doc?.getFlag?.(MODULE_ID, 'accessNode') || null;
}
const HIDDEN_TINT = '#7a7a8c';

export class TerminalScenePins {
  constructor() {
    /** Bound capture handler so close/teardown could remove it if ever needed. */
    this._boundDrop = this._onDocumentDrop.bind(this);
    this._wired = false;
  }

  /** Wire all hooks + the capture drop listener. Called once at ready. */
  init() {
    if (this._wired) return;
    this._wired = true;

    // Capture-phase drop interception (see file header for why document-level).
    document.addEventListener('drop', this._boundDrop, true);

    // Belt-and-braces: if some other capture handler re-dispatches into core,
    // still claim terminal items before Item Piles / core placement logic.
    Hooks.on('dropCanvasData', (_canvas, data) => {
      if (data?.type !== 'Item' || !data.uuid) return;
      const item = fromUuidSync(data.uuid);
      if (!item?.getFlag?.(MODULE_ID, 'isTerminal')) return;
      this._handleTerminalDrop(item, { x: data.x, y: data.y });
      return false;
    });

    // Pin activation — double-click opens the terminal instead of the journal.
    Hooks.on('activateNote', (note) => this._onActivateNote(note));

    // Right-click a terminal pin → the NCM menu. Foundry's own right-click on the note is left
    // ALONE (an earlier build wrapped Note#_onClickRight and skipped Foundry's handling, which left
    // the note's right-drag unfinished — the map and the menu then followed the mouse). Instead the
    // browser's contextmenu event on the board, which fires AFTER the button is released, is checked
    // against the terminal pins under the cursor. Works after a reload with no re-binding.
    document.addEventListener('pointerdown', (e) => {
      if (e.button === 2 && e.target?.closest?.('#board')) this._rightDown = { x: e.clientX, y: e.clientY };
    }, true);
    document.addEventListener('contextmenu', (e) => this._onBoardContextMenu(e), true);

    // Cleanup — deleting or unconverting a terminal removes its pins everywhere.
    Hooks.on('deleteItem', (item) => {
      if (!this._isActiveGM()) return;
      this.removePinsFor(item);
    });
    Hooks.on('updateItem', (item, changes) => {
      if (!this._isActiveGM()) return;
      const flags = changes?.flags;
      if (!flags) return;
      const wiped = Object.prototype.hasOwnProperty.call(flags, `-=${MODULE_ID}`) ||
        (flags[MODULE_ID] && (Object.prototype.hasOwnProperty.call(flags[MODULE_ID], '-=isTerminal') || Object.prototype.hasOwnProperty.call(flags[MODULE_ID], '-=isDataShard')));
      if (wiped) this.removePinsFor(item);
    });

    // Auto-show map notes so pins are visible/clickable without the player
    // hunting for the core "Toggle Display of Map Notes" control.
    this._autoShowMapNotes();

    log.info('TerminalScenePins wired (drag a terminal onto a scene to place an access point)');
  }

  // ═══════════════════════════════════════════════════════════
  //  Drop interception
  // ═══════════════════════════════════════════════════════════

  /**
   * Document-level capture drop handler. Claims the event ONLY when a terminal
   * item is dropped on the game canvas; all other drops pass through untouched.
   * @private
   */
  _onDocumentDrop(event) {
    try {
      if (event.target?.id !== 'board') return;
      let data;
      try { data = JSON.parse(event.dataTransfer?.getData('text/plain') || ''); }
      catch { return; }
      if (data?.type !== 'Item' || !data.uuid) return;
      const item = fromUuidSync(data.uuid);
      if (!item?.getFlag?.(MODULE_ID, 'isTerminal')) return;

      // Ours — stop core's #board ondrop (and therefore every dropCanvasData
      // consumer, Item Piles included) from ever seeing it.
      event.preventDefault();
      event.stopImmediatePropagation();
      this._handleTerminalDrop(item, this._eventToCanvas(event));
    } catch (err) {
      log.error(`TerminalScenePins drop handling failed: ${err.message}`);
    }
  }

  /** Client → canvas coordinates (the same math as core Canvas#_onDrop). @private */
  _eventToCanvas(event) {
    const t = canvas.stage.worldTransform;
    return {
      x: (event.clientX - t.tx) / canvas.stage.scale.x,
      y: (event.clientY - t.ty) / canvas.stage.scale.y,
    };
  }

  /** Route a claimed terminal drop — GM places a pin, players get a hint. @private */
  _handleTerminalDrop(item, coords) {
    if (!isGM()) {
      ui.notifications.warn('Only the GM can place a terminal on the scene.');
      return;
    }
    this.placePin(item, coords);
  }

  // ═══════════════════════════════════════════════════════════
  //  Pin placement
  // ═══════════════════════════════════════════════════════════

  /**
   * Drop a terminal pin at canvas coordinates (GM) — the drag-onto-the-map path. Reach comes from the
   * terminal's own Network tab setting (no per-pin override).
   */
  async placePin(item, coords) {
    if (!canvas?.scene) return ui.notifications.warn('No active scene to place it on.');
    await this._createPin(canvas.scene, item, coords, { hidden: false, range: null });
    ui.notifications.info(`Access point placed: ${this._nameOf(item)}. Players double-click it to open it.`);
  }

  /** Place a pin at the center of the GM's current view. */
  placeAtViewCenter(item) {
    if (!canvas?.scene) return ui.notifications.warn('No active scene to place it on.');
    return this.placePin(item, { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y });
  }

  /**
   * The placement dialog's result → a pin, an area, or both, on a scene (GM).
   * @param {Item} item — a terminal or a shard
   * @param {object} place — sanitizePlacement shape
   */
  async placeAccess(item, place) {
    const p = sanitizePlacement(place);
    const kind = this._kindOf(item);
    if (!kind) return ui.notifications.warn('Only a terminal or a shard can be placed.');
    const scene = game.scenes.get(p.sceneId) || canvas?.scene;
    if (!scene) return ui.notifications.warn('Pick a scene first.');
    if (canvas?.scene?.id !== scene.id) await scene.view();
    const at = p.where === 'click' ? await this._pickPoint(this._nameOf(item)) : { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
    if (!at) return null;
    const made = [];
    if (p.how !== 'area') made.push(await this._createPin(scene, item, at, { hidden: p.hidden, range: p.range }));
    if (p.how !== 'pin') made.push(await this._createArea(scene, item, at, { hidden: p.hidden, size: p.size }));
    const what = p.how === 'both' ? 'A pin and a step-on area' : p.how === 'area' ? 'A step-on area' : 'A pin';
    ui.notifications.info(`${what} for ${this._nameOf(item)} placed on ${scene.name}${p.hidden ? ' — hidden until you reveal it' : ''}.`);
    return made;
  }

  /**
   * A network node as a pin / step-on area on its scene (GM). Same placement shape as placeAccess.
   * @param {string} nodeId
   * @param {object} place — sanitizePlacement shape
   */
  async placeNode(nodeId, place) {
    const p = sanitizePlacement(place);
    const node = game.nightcity?.networkService?.getNode?.(nodeId);
    if (!node) return ui.notifications.warn('That node no longer exists.');
    const scene = game.scenes.get(p.sceneId) || canvas?.scene;
    if (!scene) return ui.notifications.warn('Pick a scene first.');
    if (canvas?.scene?.id !== scene.id) await scene.view();
    const at = p.where === 'click' ? await this._pickPoint(node.name) : { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
    if (!at) return null;
    const made = [];
    const ref = { kind: 'node', id: nodeId };
    if (p.how !== 'area') {
      const entryId = p.hidden ? (await this._hiddenJournal())?.id : (await this._nodesJournal())?.id;
      const flags = { accessKind: 'node', accessNode: nodeId, accessHidden: !!p.hidden, accessRange: Number(p.range) || 0 };
      const [doc] = await scene.createEmbeddedDocuments('Note', [{
        entryId, x: Math.round(at.x), y: Math.round(at.y),
        texture: { src: `modules/${MODULE_ID}/assets/icons/nodes/${node.kind}.svg`, ...(p.hidden ? { tint: HIDDEN_TINT } : {}) },
        iconSize: 56, text: node.name, fontSize: 20, textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
        flags: { [MODULE_ID]: flags },
      }]);
      made.push(doc);
    }
    if (p.how !== 'pin') {
      const rect = areaRect(at, p.size, scene.grid?.size);
      const [doc] = await scene.createEmbeddedDocuments('Region', [{
        name: `${node.name} — node`, color: '#5c9bff',
        shapes: [{ type: 'rectangle', ...rect, rotation: 0, hole: false }],
        visibility: CONST.REGION_VISIBILITY?.LAYER ?? 0,
        flags: { [MODULE_ID]: { access: ref, accessHidden: !!p.hidden } },
        behaviors: [{ type: 'executeScript', name: `Open ${node.name}`, disabled: !!p.hidden,
          system: { events: ['tokenEnter'], source: accessRegionScript(ref, node.name) } }],
      }]);
      made.push(doc);
    }
    const what = p.how === 'both' ? 'A pin and a step-on area' : p.how === 'area' ? 'A step-on area' : 'A pin';
    ui.notifications.info(`${what} for ${node.name} placed on ${scene.name}${p.hidden ? ' — hidden until you reveal it' : ''}.`);
    return made;
  }

  /** The journal a VISIBLE node pin points at — players need OBSERVER on it to see the pin. */
  async _nodesJournal() {
    let j = game.journal.find(e => e.getFlag(MODULE_ID, 'networkNodesJournal'));
    if (!j) {
      j = await JournalEntry.create({ name: 'NCM — Network nodes', ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2 },
        flags: { [MODULE_ID]: { networkNodesJournal: true } } });
    }
    return j;
  }

  /** Hide or reveal every pin / area of a node (its Hidden switch). GM. */
  async setNodeHidden(nodeId, hidden) {
    for (const scene of game.scenes) {
      for (const n of scene.notes.filter(d => nodePinOf(d) === nodeId)) await this.setHidden(n, hidden);
      for (const r of (scene.regions ?? []).filter(d => d.getFlag(MODULE_ID, 'access')?.kind === 'node' && d.getFlag(MODULE_ID, 'access')?.id === nodeId)) await this.setHidden(r, hidden);
    }
  }

  /** Delete every pin AND area of a node across all scenes (GM). */
  async removePinsForNode(nodeId) {
    try {
      for (const scene of game.scenes) {
        const notes = scene.notes.filter(n => nodePinOf(n) === nodeId).map(n => n.id);
        if (notes.length) await scene.deleteEmbeddedDocuments('Note', notes);
        const regions = (scene.regions ?? []).filter(r => r.getFlag(MODULE_ID, 'access')?.kind === 'node' && r.getFlag(MODULE_ID, 'access')?.id === nodeId).map(r => r.id);
        if (regions.length) await scene.deleteEmbeddedDocuments('Region', regions);
      }
    } catch (err) { log.error(`node pin cleanup failed: ${err.message}`); }
  }

  /** 'terminal' | 'shard' | null */
  _kindOf(item) {
    if (item?.getFlag?.(MODULE_ID, 'isTerminal')) return 'terminal';
    if (item?.getFlag?.(MODULE_ID, 'isDataShard')) return 'shard';
    return null;
  }

  _nameOf(item) {
    try {
      if (this._kindOf(item) === 'terminal') return game.nightcity?.terminalService?.getConfig?.(item)?.terminalName || item.name;
      return game.nightcity?.dataShardService?.getConfig?.(item)?.shardName || item.name;
    } catch { return item?.name || 'it'; }
  }

  /** The journal a VISIBLE pin points at (players need OBSERVER on it to see the pin). */
  _journalOf(item) {
    const id = item.getFlag(MODULE_ID, 'journalId');
    return id ? game.journal.get(id) : null;
  }

  /**
   * A HIDDEN pin points at this GM-only journal instead: Foundry hides a map note from anyone who can't see
   * its journal, so the pin is simply not on a player's map (nothing to find in the DOM either).
   */
  async _hiddenJournal() {
    let j = game.journal.find(e => e.getFlag(MODULE_ID, 'hiddenAccessPoints'));
    if (!j) {
      j = await JournalEntry.create({ name: 'NCM — Hidden access points', ownership: { default: 0 },
        flags: { [MODULE_ID]: { hiddenAccessPoints: true } } });
    }
    return j;
  }

  async _createPin(scene, item, coords, { hidden = false, range = null } = {}) {
    const kind = this._kindOf(item);
    const journal = this._journalOf(item);
    const entryId = hidden ? (await this._hiddenJournal())?.id : (journal?.id ?? null);
    const flags = { accessKind: kind, accessUuid: item.uuid, accessHidden: !!hidden };
    if (kind === 'terminal') Object.assign(flags, { terminalItemId: item.id, terminalItemUuid: item.uuid });
    if (range !== null && range !== undefined) flags.accessRange = Number(range) || 0;
    const [doc] = await scene.createEmbeddedDocuments('Note', [{
      entryId,
      x: Math.round(coords.x), y: Math.round(coords.y),
      texture: { src: item.img || 'icons/svg/frozen.svg', ...(hidden ? { tint: HIDDEN_TINT } : {}) },
      iconSize: 64, text: this._nameOf(item), fontSize: 22,
      textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
      flags: { [MODULE_ID]: flags },
    }]);
    return doc;
  }

  async _createArea(scene, item, center, { hidden = false, size = 2 } = {}) {
    const kind = this._kindOf(item);
    const name = this._nameOf(item);
    const ref = { kind, id: item.uuid };
    const rect = areaRect(center, size, scene.grid?.size);
    const [doc] = await scene.createEmbeddedDocuments('Region', [{
      name: `${name} — access`,
      color: kind === 'terminal' ? '#19f3f7' : '#c084fc',
      shapes: [{ type: 'rectangle', ...rect, rotation: 0, hole: false }],
      visibility: CONST.REGION_VISIBILITY?.LAYER ?? 0,
      flags: { [MODULE_ID]: { access: ref, accessHidden: !!hidden } },
      behaviors: [{ type: 'executeScript', name: `Open ${name}`, disabled: !!hidden,
        system: { events: ['tokenEnter'], source: accessRegionScript(ref, name) } }],
    }]);
    return doc;
  }

  /**
   * Wait for ONE left click on the map → canvas coordinates; Esc or a right-click cancels. The click is
   * swallowed (capture phase) so it never selects or moves anything.
   */
  _pickPoint(name = '') {
    return new Promise((resolve) => {
      ui.notifications.info(`Click the map where ${name || 'it'} goes — Esc cancels.`);
      document.body.classList.add('ncm-picking-point');
      const done = (v) => {
        document.removeEventListener('pointerdown', down, true);
        document.removeEventListener('keydown', key, true);
        document.body.classList.remove('ncm-picking-point');
        resolve(v);
      };
      const down = (e) => {
        if (!e.target?.closest?.('#board')) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (e.button !== 0) return done(null);
        done(canvas.canvasCoordinatesFromClient({ x: e.clientX, y: e.clientY }));
      };
      const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
      document.addEventListener('pointerdown', down, true);
      document.addEventListener('keydown', key, true);
    });
  }

  /** Hide or reveal a pin (Note) or an area (Region) (GM). */
  async setHidden(doc, hidden) {
    if (!doc) return;
    if (doc.documentName === 'Region') {
      const ids = doc.behaviors?.contents?.map(b => ({ _id: b.id, disabled: !!hidden })) ?? [];
      if (ids.length) await doc.updateEmbeddedDocuments('RegionBehavior', ids);
      await doc.setFlag(MODULE_ID, 'accessHidden', !!hidden);
      return;
    }
    const item = nodePinOf(doc) ? null : this._resolveItem(doc);
    const entryId = hidden ? (await this._hiddenJournal())?.id
      : nodePinOf(doc) ? (await this._nodesJournal())?.id
        : (item ? this._journalOf(item)?.id ?? null : doc.entryId);
    await doc.update({ entryId, 'texture.tint': hidden ? HIDDEN_TINT : null, [`flags.${MODULE_ID}.accessHidden`]: !!hidden });
  }

  /** Delete every pin AND area for this item across all scenes (GM). */
  async removePinsFor(item) {
    try {
      for (const scene of game.scenes) {
        const notes = scene.notes.filter(n => n.getFlag(MODULE_ID, 'terminalItemId') === item.id || n.getFlag(MODULE_ID, 'accessUuid') === item.uuid).map(n => n.id);
        if (notes.length) await scene.deleteEmbeddedDocuments('Note', notes);
        const regions = (scene.regions ?? []).filter(r => r.getFlag(MODULE_ID, 'access')?.id === item.uuid).map(r => r.id);
        if (regions.length) await scene.deleteEmbeddedDocuments('Region', regions);
      }
    } catch (err) {
      log.error(`TerminalScenePins cleanup failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Pin activation
  // ═══════════════════════════════════════════════════════════

  /**
   * activateNote hook — open the TerminalViewer instead of the journal sheet.
   * Returns false (suppress default) for our pins; undefined otherwise so
   * normal map notes are untouched.
   * @private
   */
  _onActivateNote(note) {
    const doc = note?.document;
    if (!isAccessPin(doc)) return; // not an NCM pin

    const nodeId = nodePinOf(doc);
    if (nodeId) {
      if (!game.nightcity?.networkService?.getNode?.(nodeId)) { ui.notifications.warn('This access point is dead — the node is gone.'); return false; }
      if (!isGM()) {
        const block = this._reachBlock(doc, Number(doc.getFlag(MODULE_ID, 'accessRange')) || 0, 'the node');
        if (block) { game.nightcity?.soundService?.play('error'); ui.notifications.warn(block); return false; }
      }
      game.nightcity?.openNode?.(nodeId);
      return false;
    }

    const item = this._resolveItem(doc);
    if (!item || !this._kindOf(item)) {
      ui.notifications.warn('This access point is dead — what it opened is gone.');
      if (isGM()) ui.notifications.info('GM: delete the stale pin via the Journal Notes layer.');
      return false;
    }

    if (!isGM()) {
      const block = this._rangeBlock(item, doc);
      if (block) {
        game.nightcity?.soundService?.play('error');
        ui.notifications.warn(block);
        return false;
      }
    }

    if (this._kindOf(item) === 'shard') game.nightcity?.openDataShard?.(item);
    else game.nightcity?.openTerminal?.(item);
    return false;
  }

  /** The board's contextmenu: a terminal pin under a right-click that did not travel (a pan) opens its menu. @private */
  _onBoardContextMenu(e) {
    if (!e.target?.closest?.('#board')) return;
    const down = this._rightDown; this._rightDown = null;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const note = this._pinAt(e.clientX, e.clientY);
    if (!note) return;
    e.preventDefault();
    try { this._openPinMenu(note, e.clientX, e.clientY); } catch (err) { log.error(`pin menu: ${err.message}`); }
  }

  /** The visible terminal pin under a screen point, else null. @private */
  _pinAt(x, y) {
    if (!canvas?.ready || !canvas.notes) return null;
    const pt = canvas.canvasCoordinatesFromClient?.({ x, y });
    if (!pt) return null;
    let best = null, bestD = Infinity;
    for (const n of canvas.notes.placeables ?? []) {
      const doc = n.document;
      if (!isAccessPin(doc) || n.visible === false) continue;
      const r = (Number(doc.iconSize) || 40) / 2 + 6;
      const d = Math.hypot(pt.x - doc.x, pt.y - doc.y);
      if (d <= r && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  /** The pin's menu at a screen point. @private */
  _openPinMenu(note, x, y) {
    const ov = game.nightcity?._shardSheetOverride;
    if (!ov) return;
    const doc = note.document;
    const pos = { clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} };
    const nodeId = nodePinOf(doc);
    const item = nodeId ? null : this._resolveItem(doc);
    const entries = [];
    const kind = this._kindOf(item);
    const node = nodeId ? game.nightcity?.networkService?.getNode?.(nodeId) : null;
    if (node) {
      entries.push({ label: 'Open the node', icon: 'fas fa-tower-broadcast', fn: () => this._onActivateNote(note) });
      if (isGM()) {
        const up = game.nightcity.networkService.getNode(nodeId)?.state === 'on';
        entries.push({ label: up ? 'Switch it off' : 'Switch it on', icon: 'fas fa-power-off', fn: () => game.nightcity.networkService.setNodeState(nodeId, up ? 'off' : 'on', { who: 'GM' }) });
        entries.push({ label: 'Inspect (GM)', icon: 'fas fa-magnifying-glass', fn: () => game.nightcity?.inspectNode?.(nodeId) });
        entries.push({ label: 'Open in Admin → Networks', icon: 'fas fa-sitemap', fn: () => game.nightcity?.openAdminTab?.('networks', { select: `show:${node.networkId}` }) });
      }
    } else if (kind) {
      const noun = kind === 'terminal' ? 'terminal' : 'shard';
      const icon = kind === 'terminal' ? 'fas fa-terminal' : 'fas fa-microchip';
      entries.push({ label: `Open ${noun}`, icon, fn: () => this._onActivateNote(note) });
      if (isGM()) entries.push({ label: `Configure ${noun}`, icon: 'fas fa-sliders', fn: () => ov._configure(item) });
      const more = ov._nightCityEntries(item, null).filter(e => !/^Place on/.test(e.label || ''));
      if (more.length) entries.push({ label: `${kind === 'terminal' ? 'Terminal' : 'Shard'} options`, icon: 'fas fa-ellipsis', more: true, fn: (p) => ov._showContextMenu(p, more, { title: item.name, icon }) });
    } else {
      entries.push({ label: 'What it opened is gone', icon: 'fas fa-link-slash', fn: () => ui.notifications.warn('This access point is dead — what it opened is gone.') });
    }
    if (isGM()) {
      const hidden = !!doc.getFlag(MODULE_ID, 'accessHidden');
      entries.push({ head: 'This pin' },
        hidden ? { label: 'Reveal to players', icon: 'fas fa-eye', fn: () => this.setHidden(doc, false) }
          : { label: 'Hide from players', icon: 'fas fa-eye-slash', fn: () => this.setHidden(doc, true) },
        { label: 'Edit pin…', icon: 'fas fa-map-pin', fn: () => doc.sheet?.render(true) },
        { label: 'Remove this pin', icon: 'fas fa-trash', bad: true, fn: () => this._confirmRemovePin(doc, item) });
    }
    // Next tick: this contextmenu event is still dispatching and the menu's own closer listens for it.
    setTimeout(() => ov._showContextMenu(pos, entries, { title: node?.name || item?.name || doc.text || 'Access point', icon: 'fas fa-map-pin' }), 0);
  }

  /** Delete one pin after a themed confirm. @private */
  async _confirmRemovePin(doc, item) {
    const ok = await themedConfirm({
      title: 'Remove pin', yes: 'Remove pin', yesIcon: 'fas fa-trash', no: 'Keep it', bad: true,
      content: dialogBodyHtml({
        tone: 'bad', icon: 'fas fa-map-pin', img: item?.img, title: item?.name || doc.text || 'Access point', sub: canvas.scene?.name || '', kind: 'Map pin',
        lead: 'Take this pin off the map?',
        goes: ['This pin on this scene'],
        stays: ['What it opens, and everything on it', 'Its other pins, areas, hotbar macros and links'],
      }),
    });
    if (ok) await doc.delete();
  }

  /** Resolve the pinned item — uuid first (covers actor-owned), id fallback. @private */
  _resolveItem(noteDoc) {
    const uuid = noteDoc.getFlag(MODULE_ID, 'accessUuid') || noteDoc.getFlag(MODULE_ID, 'terminalItemUuid');
    let item = uuid ? fromUuidSync(uuid) : null;
    if (!item) item = game.items.get(noteDoc.getFlag(MODULE_ID, 'terminalItemId'));
    return item;
  }

  /**
   * Proximity gate — config.scenePin.range in grid squares (0/absent = open).
   * A half-square grace means "adjacent" counts at range 1 regardless of where
   * icon/token centers land inside their squares.
   * @returns {string|null} a player-facing block reason, or null to allow
   * @private
   */
  _reachBlock(noteDoc, range, what = 'the access point') {
    if (!(range > 0)) return null;
    const tokens = (canvas.tokens?.placeables || []).filter(t => t.actor?.isOwner && !t.document.hidden);
    if (!tokens.length) return `No presence on this scene — you need a token near ${what}.`;
    const gs = canvas.scene?.grid?.size || 100;
    const minSquares = Math.min(...tokens.map(t => Math.hypot(t.center.x - noteDoc.x, t.center.y - noteDoc.y))) / gs;
    return minSquares <= range + 0.5 ? null : 'OUT OF RANGE — move closer.';
  }

  _rangeBlock(item, noteDoc) {
    // the pin's own reach (set in the placement dialog) wins; else a terminal's Network-tab setting
    const own = noteDoc.getFlag(MODULE_ID, 'accessRange');
    const cfg = this._kindOf(item) === 'terminal' ? (game.nightcity?.terminalService?.getConfig?.(item) || {}) : {};
    const range = (own !== undefined && own !== null) ? (Number(own) || 0) : (Number(cfg.scenePin?.range) || 0);
    if (range <= 0) return null;

    const tokens = (canvas.tokens?.placeables || [])
      .filter(t => t.actor?.isOwner && !t.document.hidden);
    if (!tokens.length) return 'No presence on this scene — you need a token near the terminal.';

    const gs = canvas.scene?.grid?.size || 100;
    const minSquares = Math.min(...tokens.map(t =>
      Math.hypot(t.center.x - noteDoc.x, t.center.y - noteDoc.y))) / gs;
    if (minSquares <= range + 0.5) return null;
    return 'OUT OF RANGE — move closer to the access point.';
  }

  // ═══════════════════════════════════════════════════════════
  //  Helpers
  // ═══════════════════════════════════════════════════════════

  /** Multi-GM guard so cleanup writes happen exactly once. @private */
  _isActiveGM() {
    return game.users?.activeGM?.id === game.user.id;
  }

  /**
   * Flip the core "Display Map Notes" client toggle on (it defaults OFF, which
   * hides + de-interactivates every pin). World-gated by `terminalPinsAutoShow`
   * so a GM can opt out and leave the core toggle alone.
   * @private
   */
  _autoShowMapNotes() {
    try {
      if (!game.settings.get(MODULE_ID, 'terminalPinsAutoShow')) return;
      if (!game.settings.get('core', 'notesDisplayToggle')) {
        game.settings.set('core', 'notesDisplayToggle', true);
      }
    } catch (err) {
      log.debug(`terminalPinsAutoShow skipped: ${err.message}`);
    }
  }
}
