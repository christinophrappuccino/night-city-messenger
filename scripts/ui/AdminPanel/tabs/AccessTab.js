/**
 * Admin → Access points (WORLD group) — every way players can open a terminal, shard, inbox or message.
 * @file scripts/ui/AdminPanel/tabs/AccessTab.js
 *
 * Gathers the world into plain arrays (pins on every scene, NCM hotbar macros, @NCM journal links, posted
 * chat cards, every terminal + shard) and hands them to the pure rules in accessModel.js. Two views of the
 * same data (dev-approved mock dev/mockups/access-points-v2-mock.html): MAP = scene-folder shelves with
 * mini-maps → a scene's big map + its points; BY THING = every thing with chips saying where players reach it.
 * Context key `acc2`, built only while this tab is on screen.
 */

import { BaseTab } from '../BaseTab.js';
import { MODULE_ID } from '../../../utils/constants.js';
import { log } from '../../../utils/helpers.js';
import { folderPathOf, showNamePicker } from '../../../utils/namePicker.js';
import { themedConfirm } from '../../../utils/adminTheme.js';
import { dialogBodyHtml } from '../../../utils/dialogBody.js';
import { findAccessLinks, ACCESS_KINDS } from '../../../utils/accessPoints.js';
import { describeAccess, openAccess, showAccessMenu, refForItem, openPlaceDialog } from '../../../integrations/AccessPoints.js';
import {
  ACCESS_SHOW, ACCESS_GROUPS, ACCESS_SORTS, ACCESS_STATS, ACCESS_KIND_INFO,
  accessStats, mapShelves, sceneDesk, thingGroups, thingDesk,
} from './accessModel.js';

const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (!Number.isFinite(m) || m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export class AccessTab extends BaseTab {
  get key() { return 'access'; }

  constructor(app) {
    super(app);
    this._view = 'map';
    this._q = '';
    this._show = 'all';
    this._group = 'kind';
    this._sort = { map: 'folder', thing: 'az' };
    this._stat = 'all';
    this._scene = null;
    this._thing = null;
    this._shut = new Set();
    this._open = new Set();
    this._hooks = null;
  }

  // ═══════════════════════════════ gather ═══════════════════════════════

  /** Every terminal / shard in the world and in anyone's gear. */
  _things() {
    const out = [];
    const add = (item) => {
      const isT = !!item.getFlag(MODULE_ID, 'isTerminal');
      const isS = !isT && !!item.getFlag(MODULE_ID, 'isDataShard');
      if (!isT && !isS) return;
      if (item.getFlag(MODULE_ID, 'shardArchive')) return; // reference copies are not a second thing
      const kind = isT ? 'terminal' : 'shard';
      let name = item.name, subline = '';
      try {
        if (isT) {
          const cfg = game.nightcity?.terminalService?.getConfig(item) || {};
          name = cfg.terminalName || item.name;
          subline = [cfg.metadata?.org, cfg.metadata?.location].filter(Boolean).join(' · ');
        } else {
          const cfg = game.nightcity?.dataShardService?.getConfig(item) || {};
          name = cfg.shardName || item.name;
          subline = cfg.encrypted ? 'locked' : '';
        }
      } catch { /* a broken config still lists */ }
      const holder = item.parent?.name || '';
      out.push({ key: `${kind}:${item.uuid}`, kind, name, subline, img: item.img, holder, playerHeld: !!item.parent?.hasPlayerOwner, found: true, itemUuid: item.uuid });
    };
    for (const it of game.items ?? []) add(it);
    for (const a of game.actors ?? []) for (const it of a.items ?? []) add(it);
    // network nodes (dev/design/NETWORK-NODES.md) — a physical thing on a map, so it belongs on this list too
    const ns = game.nightcity?.networkService;
    for (const n of ns?.getNodes?.() ?? []) {
      const net = ns.getNetwork?.(n.networkId);
      out.push({ key: `node:${n.id}`, kind: 'node', name: n.name, subline: [net?.name, game.scenes?.get(n.sceneId)?.name].filter(Boolean).join(' · '),
        img: `modules/${MODULE_ID}/assets/icons/nodes/${n.kind}.svg`, holder: '', playerHeld: false, found: true, ref: { kind: 'node', id: n.id } });
    }
    return out;
  }

  _scenes() {
    const viewed = game.user?.viewedScene;
    return (game.scenes?.contents ?? []).map((s, i) => {
      let d = null; try { d = s.dimensions; } catch { /* no grid yet */ }
      const w = d?.sceneWidth || s.width || 1, h = d?.sceneHeight || s.height || 1;
      return { id: s.id, name: s.name, folderKey: s.folder?.id || '_none', folderPath: folderPathOf(s), thumb: s.thumb || '', aspect: Math.max(0.4, Math.min(3, w / h)),
        grid: Number(s.grid?.size) || 100, viewed: s.id === viewed, navOrder: s.navigation ? (s.navOrder ?? i) : 100000 + i, dims: { x: d?.sceneX ?? 0, y: d?.sceneY ?? 0, w, h } };
    });
  }

  _points(scenes, things) {
    const pts = [];
    const thingKeys = new Set(things.map(t => t.key));
    const keyOf = (ref) => `${ref.kind}:${ref.id}`;
    // pins (terminal pins since 2026-07; any kind + hidden since step 3) and step-on areas (Regions)
    const byId = new Map(scenes.map(s => [s.id, s]));
    const pct = (sc, x, y) => ({ x: Math.max(2, Math.min(98, ((x - sc.dims.x) / sc.dims.w) * 100)), y: Math.max(2, Math.min(98, ((y - sc.dims.y) / sc.dims.h) * 100)) });
    for (const scene of game.scenes ?? []) {
      const sc = byId.get(scene.id);
      for (const n of scene.notes ?? []) {
        const nodeId = n.getFlag(MODULE_ID, 'accessNode');
        if (nodeId) {
          const ref = { kind: 'node', id: nodeId };
          const range = Number(n.getFlag(MODULE_ID, 'accessRange')) || 0;
          pts.push({ id: `pin:${scene.id}:${n.id}`, how: 'pin', key: keyOf(ref), kind: 'node', ref, sceneId: scene.id, ...pct(sc, n.x, n.y), reach: range,
            ring: range ? Math.min(160, ((range + 0.5) * 2 * sc.grid) / sc.dims.w * 100) : 0, where: scene.name,
            detail: range ? `in reach within ${range} square${range === 1 ? '' : 's'}` : 'anywhere on the scene', hidden: !!n.getFlag(MODULE_ID, 'accessHidden'),
            broken: !describeAccess(ref).found, docUuid: n.uuid, label: n.text || '' });
          continue;
        }
        const termId = n.getFlag(MODULE_ID, 'terminalItemId');
        const uuid = n.getFlag(MODULE_ID, 'accessUuid') || n.getFlag(MODULE_ID, 'terminalItemUuid');
        if (!termId && !uuid) continue;
        const kind = n.getFlag(MODULE_ID, 'accessKind') || 'terminal';
        let item = null; try { item = uuid ? fromUuidSync(uuid) : null; } catch { item = null; }
        if (!item && termId) item = game.items.get(termId);
        const ok = !!(item?.getFlag?.(MODULE_ID, kind === 'shard' ? 'isDataShard' : 'isTerminal'));
        const key = ok ? `${kind}:${item.uuid}` : `${kind}:${uuid || termId}`;
        const own = n.getFlag(MODULE_ID, 'accessRange');
        const range = (own !== undefined && own !== null) ? Number(own) || 0
          : (ok && kind === 'terminal' ? Number(game.nightcity?.terminalService?.getConfig(item)?.scenePin?.range) || 0 : 0);
        const hidden = !!n.getFlag(MODULE_ID, 'accessHidden');
        pts.push({ id: `pin:${scene.id}:${n.id}`, how: 'pin', key, kind, sceneId: scene.id, ...pct(sc, n.x, n.y), reach: range, ring: range ? Math.min(160, ((range + 0.5) * 2 * sc.grid) / sc.dims.w * 100) : 0,
          where: scene.name, detail: range ? `in reach within ${range} square${range === 1 ? '' : 's'}` : 'anywhere on the scene', hidden, broken: !ok, docUuid: n.uuid, label: n.text || item?.name || '' });
      }
      for (const r of scene.regions ?? []) {
        const ref = r.getFlag(MODULE_ID, 'access'); if (!ref?.kind) continue;
        const shp = r.shapes?.[0];
        const bx = shp ? (shp.type === 'rectangle' ? { x: shp.x, y: shp.y, w: shp.width, h: shp.height } : { x: (shp.x ?? 0) - (shp.radius ?? 50), y: (shp.y ?? 0) - (shp.radius ?? 50), w: (shp.radius ?? 50) * 2, h: (shp.radius ?? 50) * 2 }) : null;
        const d = describeAccess(ref);
        const sq = bx ? Math.max(1, Math.round(bx.w / sc.grid)) : 0;
        const c = bx ? pct(sc, bx.x + bx.w / 2, bx.y + bx.h / 2) : { x: 50, y: 50 };
        pts.push({ id: `area:${scene.id}:${r.id}`, how: 'area', key: keyOf(ref), kind: ref.kind, ref, sceneId: scene.id, ...c,
          aw: bx ? Math.max(3, (bx.w / sc.dims.w) * 100) : 6, ah: bx ? Math.max(3, (bx.h / sc.dims.h) * 100) : 6,
          where: scene.name, detail: `a token walks in${sq ? ` · about ${sq} × ${sq} squares` : ''}`, hidden: !!r.getFlag(MODULE_ID, 'accessHidden'),
          broken: !d.found, docUuid: r.uuid, label: r.name });
      }
    }
    // hotbar macros
    const slots = new Map();
    for (const u of game.users ?? []) for (const [slot, id] of Object.entries(u.hotbar ?? {})) {
      if (!id) continue; if (!slots.has(id)) slots.set(id, []); slots.get(id).push(`${u.name} ${slot}`);
    }
    for (const m of game.macros ?? []) {
      const ref = m.getFlag(MODULE_ID, 'access'); if (!ref?.kind) continue;
      const d = describeAccess(ref);
      const on = slots.get(m.id) || [];
      pts.push({ id: `macro:${m.id}`, how: 'hotbar', key: keyOf(ref), kind: ref.kind, ref, where: on.length ? 'Hotbar' : 'Macro', label: m.name,
        detail: on.length ? `on the hotbar: ${on.join(', ')}` : 'not on anyone\'s hotbar yet', broken: !d.found, docUuid: m.uuid });
    }
    // journal links
    for (const j of game.journal ?? []) for (const pg of j.pages ?? []) {
      if (pg.type !== 'text') continue;
      for (const { ref, label } of findAccessLinks(pg.text?.content)) {
        const d = describeAccess(ref);
        pts.push({ id: `link:${pg.uuid}:${ref.kind}:${ref.id}`, how: 'journal', key: keyOf(ref), kind: ref.kind, ref, where: `${j.name} › ${pg.name}`,
          detail: label ? `"${label}"` : 'a link', broken: !d.found, docUuid: pg.uuid });
      }
    }
    // chat cards
    for (const msg of game.messages ?? []) {
      const ref = msg.getFlag(MODULE_ID, 'access'); if (!ref?.kind) continue;
      const d = describeAccess(ref);
      const to = msg.whisper?.length ? msg.whisper.map(id => game.users.get(id)).filter(u => u && !u.isGM).map(u => u.name) : [];
      pts.push({ id: `chat:${msg.id}`, how: 'chat', key: keyOf(ref), kind: ref.kind, ref, where: 'Chat card',
        detail: `${to.length ? `to ${to.join(', ')}` : msg.whisper?.length ? 'GMs only' : 'to everyone'} · ${ago(msg.timestamp)}`, broken: !d.found, docUuid: msg.uuid });
    }
    // anything a point names that is not a terminal/shard on the list (an inbox, a message, a deleted thing)
    for (const p of pts) {
      if (thingKeys.has(p.key)) continue;
      thingKeys.add(p.key);
      const d = p.ref ? describeAccess(p.ref) : { found: false, name: p.label || 'Deleted terminal' };
      things.push({ key: p.key, kind: p.kind, name: d.found ? d.name : `${p.label || d.name || 'Something'} (gone)`, subline: d.sub || '', img: d.img, holder: '', playerHeld: false, found: !!d.found, ref: p.ref });
    }
    return pts;
  }

  // ═══════════════════════════════ context ═══════════════════════════════

  prepareContext() {
    if (this.app._activeTab !== 'access') return { acc2: null };
    try {
      const things = this._things();
      const scenes = this._scenes();
      const points = this._points(scenes, things);
      if (!this._scene || !scenes.some(s => s.id === this._scene)) this._scene = (scenes.find(s => s.viewed) || scenes.find(s => points.some(p => p.sceneId === s.id)))?.id ?? null;
      if (!this._thing || !things.some(t => t.key === this._thing)) this._thing = things[0]?.key ?? null;
      const state = { view: this._view, q: this._q, show: this._show, group: this._group, sort: this._sort[this._view], stat: this._stat, scene: this._scene, shut: this._shut, open: this._open };
      const stats = accessStats(points, things);
      const opt = (list, cur) => list.map(([k, l]) => ({ k, l, on: k === cur }));
      const map = this._view === 'map' ? mapShelves({ points, scenes, things, state }) : null;
      const desk = this._view === 'map' ? sceneDesk({ points, scenes, things, sceneId: this._scene }) : null;
      if (desk) desk.viewedHere = desk.viewed;
      const byThing = this._view === 'thing' ? thingGroups({ points, things, state }) : null;
      const tdesk = this._view === 'thing' ? thingDesk({ points, things, key: this._thing }) : null;
      if (byThing) for (const g of byThing.groups) for (const r of g.rows) r.on = r.key === this._thing;
      if (map) for (const f of map.shelves) for (const s of f.scenes) s.on = s.id === this._scene;
      if (tdesk) tdesk.canMake = !!tdesk.itemUuid;
      return {
        acc2: {
          isMap: this._view === 'map', isThing: this._view === 'thing', isPopout: this.isPopout, q: this._q,
          showOpts: opt(ACCESS_SHOW, this._show), groupOpts: this._view === 'map' ? opt(ACCESS_GROUPS.map, 'folder') : opt(ACCESS_GROUPS.thing, this._group), sortOpts: opt(ACCESS_SORTS[this._view], this._sort[this._view]),
          stats: ACCESS_STATS.map(([k, l, tone, tip]) => ({ k, l, tone, tip, n: stats[k], on: this._stat === k })),
          map, desk, byThing, tdesk, kinds: ACCESS_KIND_INFO,
          narrowed: !!(this._q || this._show !== 'all' || this._stat !== 'all'),
        },
      };
    } catch (err) {
      log.error(`AccessTab: ${err.message}`);
      return { acc2: { error: err.message } };
    }
  }

  openTo(select) {
    if (!select) return;
    if (String(select).startsWith('scene:')) { this._view = 'map'; this._scene = select.slice(6); }
    else { this._view = 'thing'; this._thing = String(select); }
  }

  // ═══════════════════════════════ render ═══════════════════════════════

  onRender() {
    const root = this.element?.querySelector('.ncm-acc2');
    if (!root) return;
    // search (DOM-debounced re-render)
    const q = root.querySelector('[data-acc-q]');
    q?.addEventListener('input', () => {
      clearTimeout(this._qT);
      this._qT = setTimeout(() => { this._q = q.value; this.app.render(); }, 220);
    });
    // selects (a <select> data-action fires on click, not change)
    root.querySelectorAll('select[data-acc-sel]').forEach(sel => sel.addEventListener('change', () => {
      const k = sel.dataset.accSel;
      if (k === 'show') this._show = sel.value;
      else if (k === 'group') this._group = sel.value;
      else if (k === 'sort') this._sort[this._view] = sel.value;
      this.app.render();
    }));
    // hover a row ↔ light its dot
    root.addEventListener('mouseover', (e) => {
      const id = e.target.closest?.('[data-pt-id]')?.dataset.ptId;
      root.querySelectorAll('.is-lit').forEach(x => x.classList.remove('is-lit'));
      if (id) root.querySelectorAll(`[data-pt-id="${CSS.escape(id)}"]`).forEach(x => x.classList.add('is-lit'));
    });
    // live: anything that adds or removes a way in
    if (!this._hooks) {
      const re = () => { if (this.app._activeTab === 'access') (this.app._debouncedRender ? this.app._debouncedRender() : this.app.render()); };
      const names = ['createNote', 'updateNote', 'deleteNote', 'createRegion', 'updateRegion', 'deleteRegion', 'updateRegionBehavior', 'createMacro', 'updateMacro', 'deleteMacro', 'updateUser', 'createChatMessage', 'deleteChatMessage', 'updateJournalEntryPage', 'createJournalEntryPage', 'deleteJournalEntryPage'];
      this._hooks = names.map(n => [n, Hooks.on(n, re)]);
    }
  }

  onClose() {
    for (const [n, id] of this._hooks ?? []) Hooks.off(n, id);
    this._hooks = null;
    clearTimeout(this._qT);
  }

  // ═══════════════════════════════ actions ═══════════════════════════════

  async onAct(op, event, target) {
    const d = target.dataset;
    switch (op) {
      case 'view': this._view = d.view === 'thing' ? 'thing' : 'map'; return this.app.render();
      case 'stat': this._stat = this._stat === d.stat ? 'all' : d.stat; if (this._stat === 'none') this._view = 'thing'; return this.app.render();
      case 'clearQ': this._q = ''; return this.app.render();
      case 'clearAll': this._q = ''; this._show = 'all'; this._stat = 'all'; return this.app.render();
      case 'scene': this._scene = d.sceneId; return this.app.render();
      case 'thing': this._thing = d.key; return this.app.render();
      case 'fold': {
        const k = d.key, shut = d.shut === '1';
        if (shut) { this._shut.delete(k); this._open.add(k); } else { this._open.delete(k); this._shut.add(k); }
        return this.app.render();
      }
      case 'viewScene': { const s = game.scenes.get(d.sceneId); await s?.view(); return this.app.render(); }
      case 'place': return this._place(d.sceneId);
      case 'new': return this._new(target);
      case 'make': { const it = d.uuid ? fromUuidSync(d.uuid) : null; return it && showAccessMenu(it, target); }
      case 'openThing': return this._openThing(d.key);
      case 'ptGo': return this._goTo(d.ptId);
      case 'ptOpen': return this._openPoint(d.ptId, d.docUuid);
      case 'ptEdit': return this._editPoint(d.ptId, d.docUuid);
      case 'ptRemove': return this._removePoint(d.ptId, d.docUuid);
      case 'ptHide': return this._setHidden(d.docUuid, d.hidden !== '1');
    }
  }

  _kindOf(ptId) { return String(ptId).split(':')[0]; }

  async _goTo(ptId) {
    const [kind, sceneId, docId] = String(ptId).split(':');
    const scene = game.scenes.get(sceneId); if (!scene) return;
    if (canvas?.scene?.id !== sceneId) await scene.view();
    let at = null;
    if (kind === 'area') {
      const shp = scene.regions?.get(docId)?.shapes?.[0];
      if (shp) at = shp.type === 'rectangle' ? { x: shp.x + shp.width / 2, y: shp.y + shp.height / 2 } : { x: shp.x, y: shp.y };
    } else {
      const n = scene.notes.get(docId); if (n) at = { x: n.x, y: n.y };
    }
    if (at && canvas?.animatePan) canvas.animatePan({ ...at, scale: Math.max(canvas.stage?.scale?.x ?? 1, 1) });
  }

  /** Hide / reveal a pin or an area (TerminalScenePins.setHidden). */
  async _setHidden(uuid, hidden) {
    const doc = uuid ? await fromUuid(uuid) : null;
    if (!doc) return ui.notifications.warn('That access point is gone.');
    await game.nightcity?.terminalScenePins?.setHidden(doc, hidden);
  }

  async _openPoint(ptId, uuid) {
    const kind = this._kindOf(ptId);
    const doc = uuid ? await fromUuid(uuid) : null;
    if (kind === 'macro') return doc?.execute?.();
    if (kind === 'link') return doc?.parent?.sheet?.render(true, { pageId: doc.id });
    if (kind === 'chat') { ui.sidebar?.activateTab?.('chat'); return; }
    if (kind === 'area') { const ref = doc?.getFlag(MODULE_ID, 'access'); return ref && openAccess(ref); }
    if (kind === 'pin' && doc?.getFlag(MODULE_ID, 'accessNode')) return game.nightcity?.openNode?.(doc.getFlag(MODULE_ID, 'accessNode'));
    if (kind === 'pin') {
      const item = doc ? (fromUuidSync(doc.getFlag(MODULE_ID, 'terminalItemUuid') || '') ?? game.items.get(doc.getFlag(MODULE_ID, 'terminalItemId'))) : null;
      return item && game.nightcity?.openTerminal?.(item);
    }
  }

  async _editPoint(ptId, uuid) {
    const doc = uuid ? await fromUuid(uuid) : null;
    if (!doc) return ui.notifications.warn('That access point is gone.');
    if (this._kindOf(ptId) === 'link') return doc.parent?.sheet?.render(true, { pageId: doc.id });
    doc.sheet?.render(true);
  }

  async _removePoint(ptId, uuid) {
    const kind = this._kindOf(ptId);
    const doc = uuid ? await fromUuid(uuid) : null;
    if (!doc) return ui.notifications.warn('That access point is already gone.');
    if (kind === 'pin') return game.nightcity?.terminalScenePins?._confirmRemovePin?.(doc, game.nightcity?.terminalScenePins?._resolveItem?.(doc) ?? null);
    if (kind === 'link') {
      ui.notifications.info('Journal links live in the page text — edit the page to remove it.');
      return doc.parent?.sheet?.render(true, { pageId: doc.id });
    }
    const what = kind === 'macro' ? { title: 'Delete macro', kind: 'Hotbar macro', icon: 'fas fa-bolt', goes: ['The macro (and its hotbar slots)'] }
      : kind === 'area' ? { title: 'Remove step-on area', kind: 'Step-on area', icon: 'fas fa-draw-polygon', goes: ['This area on this scene (a Region)'] }
      : { title: 'Delete chat card', kind: 'Chat card', icon: 'fas fa-comment', goes: ['The card in the chat log'] };
    const ok = await themedConfirm({
      title: what.title, yes: 'Delete', yesIcon: 'fas fa-trash', no: 'Keep it', bad: true,
      content: dialogBodyHtml({ tone: 'bad', icon: what.icon, title: doc.name || what.kind, kind: what.kind, lead: 'Delete this way in?', goes: what.goes, stays: ['The terminal / shard it opened', 'Every other way in'] }),
    });
    if (ok) await doc.delete();
  }

  _openThing(key) {
    const [kind, ...rest] = String(key).split(':');
    openAccess({ kind, id: rest.join(':') });
  }

  /** Every terminal / shard as picker entries. */
  _pickEntries(kinds = ['terminal', 'shard']) {
    return this._things().filter(t => kinds.includes(t.kind)).map(t => ({
      id: t.itemUuid, name: t.name, img: t.img, sub: [ACCESS_KINDS[t.kind]?.label, t.holder ? `carried by ${t.holder}` : 'world item', t.subline].filter(Boolean).join(' · '),
      group: ACCESS_KIND_INFO[t.kind]?.many,
    }));
  }

  /** Place… — pick a terminal or shard, then the placement dialog, preset to the scene the desk shows. */
  async _place(sceneId) {
    const pick = await showNamePicker({ title: 'Place on this scene', hint: 'Pick the terminal or shard players should reach here.', entries: this._pickEntries(), placeholder: 'find a terminal or shard…' });
    const item = pick?.id ? fromUuidSync(pick.id) : null;
    if (item) await openPlaceDialog(item, { sceneId });
  }

  /** New ▾ — pick a terminal or shard, then its Access menu (hotbar / chat / link / place). */
  async _new(target) {
    const pick = await showNamePicker({ title: 'Make a way in', hint: 'Pick the terminal or shard players should reach.', entries: this._pickEntries(), placeholder: 'find a terminal or shard…' });
    const item = pick?.id ? fromUuidSync(pick.id) : null;
    if (item && refForItem(item)) showAccessMenu(item, target);
  }
}
