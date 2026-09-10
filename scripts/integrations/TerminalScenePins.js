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
        (flags[MODULE_ID] && Object.prototype.hasOwnProperty.call(flags[MODULE_ID], '-=isTerminal'));
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
   * Create the access-point Note at the given canvas coordinates (GM).
   * Multiple pins of the same terminal are allowed (several workstations, one box).
   * @param {Item} item
   * @param {{x: number, y: number}} coords
   */
  async placePin(item, coords) {
    if (!canvas?.scene) return ui.notifications.warn('No active scene to place the terminal on.');
    const journalId = item.getFlag(MODULE_ID, 'journalId');
    const journal = journalId ? game.journal.get(journalId) : null;
    if (!journal) return ui.notifications.warn('This terminal has no message journal — re-convert it first.');

    const cfg = game.nightcity?.terminalService?.getConfig?.(item) || {};
    const name = cfg.terminalName || item.name;

    await canvas.scene.createEmbeddedDocuments('Note', [{
      entryId: journal.id,
      x: Math.round(coords.x),
      y: Math.round(coords.y),
      texture: { src: item.img || 'icons/svg/frozen.svg' },
      iconSize: 64,
      text: name,
      fontSize: 22,
      textAnchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
      flags: { [MODULE_ID]: { terminalItemId: item.id, terminalItemUuid: item.uuid } },
    }]);
    ui.notifications.info(`Access point placed: ${name}. Players double-click it to log in.`);
  }

  /** Place a pin at the center of the GM's current view (context-menu fallback). */
  placeAtViewCenter(item) {
    if (!canvas?.scene) return ui.notifications.warn('No active scene to place the terminal on.');
    return this.placePin(item, { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y });
  }

  /** Delete every pin for this terminal across all scenes (GM). */
  async removePinsFor(item) {
    try {
      for (const scene of game.scenes) {
        const ids = scene.notes
          .filter(n => n.getFlag(MODULE_ID, 'terminalItemId') === item.id)
          .map(n => n.id);
        if (ids.length) await scene.deleteEmbeddedDocuments('Note', ids);
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
    if (!doc?.getFlag(MODULE_ID, 'terminalItemId')) return; // not an NCM pin

    const item = this._resolveItem(doc);
    if (!item || !item.getFlag(MODULE_ID, 'isTerminal')) {
      ui.notifications.warn('This access point is dead — the terminal item is gone.');
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

    game.nightcity?.openTerminal?.(item);
    return false;
  }

  /** Resolve the pinned item — uuid first (covers actor-owned), id fallback. @private */
  _resolveItem(noteDoc) {
    const uuid = noteDoc.getFlag(MODULE_ID, 'terminalItemUuid');
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
  _rangeBlock(item, noteDoc) {
    const cfg = game.nightcity?.terminalService?.getConfig?.(item) || {};
    const range = Number(cfg.scenePin?.range) || 0;
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
