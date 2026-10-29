/**
 * NetworksTab — Admin → Networks, with the Network Manager folded in (2026-10-27).
 * @file scripts/ui/AdminPanel/tabs/NetworksTab.js
 * @module night-city-messenger
 *
 * Dev-approved mock: dev/mockups/admin-networks-redesign-mock.html. Four views,
 * picked from the sub-tab row:
 *   scene   THIS SCENE — the command centre: the scene (scope picker), its dead
 *           zone + "players start on", Broadcast (everyone / this scene / one
 *           network), then ONLY the networks reachable here: signal slider, who
 *           is on it, on/off. Players on a network this scene can't reach, last.
 *   all     ALL NETWORKS — grouped list + detail. Edit turns the detail pane
 *           into the six-step editor (NetworksEditor.js); New network opens the
 *           same editor with "Start from" presets.
 *   scenes  SCENES — THE ATLAS (2026-10-29): scene cards on shelves that are the
 *           GM's own folders, the nav bar pinned on top; a transmitter strip to
 *           PAINT a network onto scenes; a Grid switch (scenes × networks) for
 *           bulk; pack scenes can be pre-wired (applied on import).
 *   log     ACTIVITY LOG — the network access log: scope-picker network filter,
 *           kind chips, an inline "Add a note" row, ⋯ = import/export/clear/
 *           reset lockouts; a network name on a row filters to it.
 *
 * Every button is `data-action="tabAct" data-op="…"` (owner = the root's
 * data-owner) → onAct. Selects/inputs/sliders are wired in onRender.
 * Context keys live under `net2`; `networks`, `sceneStrip` and `netStats` stay
 * at the top level because AdminPanelApp and the footer read them.
 *
 * Edit state survives a re-render: prepareContext runs while the OLD DOM is
 * still mounted, so it reads the open editor back into `_draft` first.
 */

import { MODULE_ID, NETWORK_TYPES } from '../../../utils/constants.js';
import { log, chatCardTime } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';
import { bypassDCFor, bypassRowsHtml, wireBypassRows } from '../../../utils/bypassSkills.js';
import { adminDialog, adminConfirm, themedConfirm, themedPrompt } from '../../../utils/adminTheme.js';
import { showNamePicker, documentEntries, isCarrier } from '../../../utils/namePicker.js';
import { ScopePicker } from '../../../utils/scopePicker.js';
import { tagHue } from '../../../utils/tagHue.js';
import { cmvOverrideContext, wireCmvOverride, readCmvOverride } from '../../../utils/countermeasureView.js';
import { NODE_KINDS, NODE_STATES, NODE_EFFECTS, NODE_PROGRAMS, nodeStateAt, stateLabel, sceneVerdict, nodeHex, activeEffects, familyNodes } from '../../../utils/networkNodes.js';
import { editNodeDialog } from '../../NetworkNodes/NodeDialogs.js';
import { dialogBodyHtml } from '../../../utils/dialogBody.js';
import {
  NET2_STEPS, NET2_PRESETS, draftFrom, applyPreset, readEditorForm, wherePatches, editorContext,
} from './NetworksEditor.js';
import { buildDial, accessWords, signalQuality, litCount, crowdBottom, pctAtPointer, stepSignal } from './networksDial.js';
import {
  SCENE_SHOW, SCENE_SORTS, SHELF_LIMIT, scenePasses, sceneMatches, showCounts, shelfShut, shelfSummary, buildShelves, navShelf,
  ancestorKeys, subtreeKeys, shelfPaint, coverage, rangeIds, sanitizePrewire, togglePrewire, sourceUuidOf,
  PAINT_DOCK_AT, paintDock,
} from '../../../utils/scenesAtlas.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typeLabel = (t) => { const s = String(t || 'custom').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };
const sigTier = (s) => (s >= 80 ? 'good' : s >= 50 ? 'mid' : s >= 25 ? 'low' : 'dead');
const isIceActor = (a) => a.type === 'blackIce' || a.type === 'black-ice' || a.getFlag?.(MODULE_ID, 'isBlackICE') || a.name?.toLowerCase().includes('black ice');

/** Log kind chips — value → which entry types it shows. */
const LOG_KINDS = [
  { value: 'all', label: 'All' },
  { value: 'connect', label: 'Connections', types: ['connect', 'disconnect', 'network_switch'] },
  { value: 'auth', label: 'Logins', types: ['auth_success', 'auth_failure', 'auth_fail'] },
  { value: 'hack', label: 'Hacks', types: ['hack', 'malware'] },
  { value: 'lockout', label: 'Lockouts', types: ['lockout'] },
  { value: 'node', label: 'Nodes', types: ['node'] },
  { value: 'scene', label: 'Scene moves', types: ['scene_move'] },
  { value: 'trace', label: 'Traces', types: ['trace', 'message_trace', 'shard_trace'] },
  { value: 'manual', label: 'Notes' },
];

const VIEWS = {
  scene: { icon: 'fa-location-crosshairs', label: 'This scene', h: 'This scene', p: 'The scene you’re running: its signal, its networks, and who’s on them.' },
  all: { icon: 'fa-network-wired', label: 'All networks', h: 'All networks', p: 'Every network in the world, where it exists, and how you get in.' },
  scenes: { icon: 'fa-map', label: 'Scenes', h: 'Scenes', p: 'Which networks each scene carries, where players start, and which are dead zones.' },
  log: { icon: 'fa-scroll', label: 'Activity log', h: 'Activity log', p: 'Connections, logins, hacks, lockouts and broadcasts, newest first.' },
};

export class NetworksTab extends BaseTab {

  /** @type {'scene'|'all'|'scenes'|'log'} */
  _view = 'scene';
  _sceneId = null;          // the scene "This scene" shows (null = the viewed scene)
  _dialSel = null;          // the radio dial's picked network (null = players' start, else the first)
  _bcastFocus = false;      // "Broadcast" in the dial readout → focus the broadcast box after the render
  _selId = null;            // All networks: selected network
  _filter = 'all';
  _search = '';
  // All networks: folded group headings (per client, survives reloads).
  _netShut = (() => { try { return new Set(JSON.parse(localStorage.getItem('ncm.net2.shut') || '[]')); } catch { return new Set(); } })();
  _saveNetShut() { try { localStorage.setItem('ncm.net2.shut', JSON.stringify([...this._netShut])); } catch { /* private mode */ } }
  _groupBy = 'type';
  _menu = '';               // '' | 'net' | 'log' — the open ⋯ menu

  // editor
  _edit = false;
  _isNew = false;
  _draft = null;
  _step = 'identity';
  _presetKey = 'blank';
  _editSession = 0;

  // scenes — the Atlas (utils/scenesAtlas.js)
  _sceneSearch = '';
  // Show EVERY scene by default, like Foundry's Scenes tab (dev 2026-10-29: "it's not pulling in the scenes tab") —
  // hiding unwired compendium imports is opt-in (the eye), or a world built from compendium maps looks empty.
  _sceneHideImported = false;
  _scMode = 'atlas';        // 'atlas' | 'grid'
  _scPaint = null;          // the network being painted (Paint mode), or null
  _scPaintRecent = [];      // networks painted recently, most recent first (the Paint dock, this session)
  _scSel = null;            // the picked scene id, or a pack scene uuid (the inspector)
  _scShow = 'all';
  _scSort = 'folder';
  _scFolder = null;         // the Folder picker: a folder id (its subtree), or null = all
  _scShut = new Set();      // the GM's own folds this session (scenesAtlas.shelfShut)
  _scOpen = new Set();
  _scMore = new Set();      // shelves showing every card past SHELF_LIMIT
  _scLast = null;           // the Grid's last clicked cell { id, net } (shift-click range)
  _packLoading = new Set(); // compendium indexes asked for once

  // log
  _logKind = 'all';
  _logSearch = '';
  _noteOpen = false;
  _note = { actor: '', type: 'manual', message: '' };

  // carried across a re-render
  _bcastText = '';
  _scroll = {};
  _focus = null;            // { key, start }

  get key() { return 'networks'; }

  // ═══════════════════════════════════════════════════════════
  //  openTo — from openAdminTab({ select }) / a Pop out's data-select
  // ═══════════════════════════════════════════════════════════

  /**
   * 'new' → New network · 'view:scene|all|scenes|log' → that view ·
   * 'show:<id>' → All networks on that network · 'log:<id>' → the log for it ·
   * '<id>' → All networks, editing that network.
   */
  openTo(select) {
    const s = String(select || '');
    if (!s) return;
    this._menu = '';
    if (s === 'new') return this._startNew();
    if (s.startsWith('view:')) { const v = s.slice(5); if (VIEWS[v]) { this._view = v; this._edit = false; } return; }
    if (s.startsWith('show:')) { this._view = 'all'; this._selId = s.slice(5); this._edit = false; return; }
    if (s.startsWith('log:')) { this._view = 'log'; ScopePicker.set(this.scopeId('netlog'), [s.slice(4)]); return; }
    this._startEdit(s);
  }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const ns = this.networkService;
    const nets = ns?.getAllNetworks?.() ?? [];
    const scenes = game.scenes?.contents ?? [];
    const viewed = game.scenes?.viewed ?? canvas?.scene ?? null;
    const deadZones = scenes.filter(s => s.getFlag?.(MODULE_ID, 'deadZone')).length;
    const base = {
      networks: nets,
      sceneStrip: scenes.map(s => ({ id: s.id, name: s.name, isCurrent: s.id === viewed?.id, deadZone: !!s.getFlag?.(MODULE_ID, 'deadZone') })),
      netStats: {
        total: nets.length,
        active: ns?.getAvailableNetworks?.()?.length ?? 0,
        deadZones,
        secured: nets.filter(n => n.security?.requiresAuth).length,
        connected: game.users?.filter(u => u.active && !u.isGM)?.length ?? 0,
      },
    };
    if (this.app._activeTab !== 'networks') return base;

    try {
      this._captureDom();
      this._wirePickers();
      return { ...base, net2: this._buildContext(nets, scenes, viewed) };
    } catch (err) {
      console.error(`${MODULE_ID} | NetworksTab.prepareContext:`, err);
      return { ...base, net2: { error: err.message, nav: [] } };
    }
  }

  /** Read anything the GM was typing out of the still-mounted DOM. */
  /**
   * readEditorForm + the countermeasure override (Access step). The override is the
   * shared partial (countermeasure-override.hbs), so it reads through its own helper;
   * a form without the block keeps whatever the draft already had.
   */
  _readForm(form) {
    const data = readEditorForm(form, { recipients: ScopePicker.value(this.scopeId('recip')) });
    const cmv = readCmvOverride(form) ?? this._draft?.security?.countermeasures;
    if (cmv) data.security = { ...(data.security || {}), countermeasures: cmv };
    return data;
  }

  _captureDom() {
    const el = this.element;
    if (!el) return;
    if (this._edit) {
      const form = el.querySelector(`.ncm-net2-form[data-edit-session="${this._editSession}"]`);
      if (form) {
        const prev = this._draft || {};
        this._draft = { ...this._readForm(form), id: prev.id, isCore: prev.isCore };
      }
    }
    const bc = el.querySelector('[data-net2-bcast]');
    if (bc) this._bcastText = bc.value;
    const note = el.querySelector('[data-net2-note]');
    if (note) {
      this._note = {
        actor: note.querySelector('[name="noteActor"]')?.value ?? '',
        type: note.querySelector('[name="noteType"]')?.value ?? 'manual',
        message: note.querySelector('[name="noteMessage"]')?.value ?? '',
      };
    }
    el.querySelectorAll('[data-net2-scroll]').forEach(s => { this._scroll[s.dataset.net2Scroll] = s.scrollTop; });
    const f = typeof document !== 'undefined' ? document.activeElement : null;
    this._focus = (f && el.contains(f) && f.dataset?.net2Search) ? { key: f.dataset.net2Search, start: f.selectionStart } : null;
  }

  /** Scope-picker change callbacks (idempotent — re-registered each render). */
  _wirePickers() {
    const re = () => this.app.render();
    ScopePicker.on(this.scopeId('scene'), (v) => { this._sceneId = v[0] || null; re(); });
    ScopePicker.on(this.scopeId('bcast'), re);
    ScopePicker.on(this.scopeId('netlog'), re);
    ScopePicker.on(this.scopeId('notenet'), re);
    ScopePicker.on(this.scopeId('recip'), re);
    // Paint → "All networks": picking one starts painting with it (the callback also fires when the list opens —
    // only act on a real change)
    ScopePicker.on(this.scopeId('paint'), (v) => {
      const id = v[0] || null;
      if (!id || id === this._scPaint) return;
      const n = this.networkService?.getNetwork?.(id);
      if (!n || n.availability?.global) return;
      this._scPaint = id; this._scSel = null;
      this._scPaintRecent = [id, ...this._scPaintRecent.filter((x) => x !== id)].slice(0, 8);
      ScopePicker.close?.(this.scopeId('paint'));
      re();
    });
    ScopePicker.on(this.scopeId('here'), async (v) => {
      if (ScopePicker.isOpen(this.scopeId('here'))) return re(); // apply on Done/close, not per click
      const scene = this._scene();
      if (scene) await this._setSceneNets(scene, v);
      re();
    });
  }

  _scene() {
    return (this._sceneId && game.scenes?.get(this._sceneId)) || game.scenes?.viewed || canvas?.scene || null;
  }

  // ─── shared helpers ───

  _ic(n) {
    const t = n?.theme || {};
    return { color: t.color || '#19f3f7', icon: t.icon || 'fa-network-wired', img: t.iconMode === 'image' && t.customImage ? t.customImage : '' };
  }

  _access(n) {
    const sec = n?.security || {};
    if (!sec.requiresAuth) return { cls: 'open', label: 'Open', icon: 'fa-lock-open' };
    if (sec.failureMode === 'damage') return { cls: 'ice', label: 'Black ICE', icon: 'fa-skull' };
    return { cls: 'sec', label: 'Secured', icon: 'fa-lock' };
  }

  /** Is network `n` listed on this scene's availability map (any value)? → undefined | true | false */
  _sceneState(scene, n) {
    const avail = scene?.getFlag?.(MODULE_ID, 'networkAvailability') ?? {};
    if (avail[n.id] === true || (n.name && avail[n.name] === true)) return true;
    if ((n.availability?.scenes || []).includes(scene?.id)) return true;
    if (n.id in avail || (n.name && n.name in avail)) return false;
    return undefined;
  }

  _scenesFor(n, scenes) {
    if (n.availability?.global) return null;
    return scenes.filter(s => this._sceneState(s, n) === true).map(s => ({ id: s.id, name: s.name }));
  }

  /** Online players and the network each last reported (NetworkService 'hello'/'switch'). */
  _players() {
    const map = game.nightcity?.playerNetworks;
    return (game.users?.filter(u => !u.isGM && u.active) ?? []).map(u => {
      const actor = u.character || null;
      const img = actor?.img && !actor.img.includes('mystery-man') ? actor.img : '';
      return {
        userId: u.id, name: actor?.name || u.name, img, color: u.color?.css || u.color || '#5c86b8',
        initial: (actor?.name || u.name || '?').charAt(0).toUpperCase(),
        networkId: map?.get?.(u.id)?.networkId || null,
        viewing: u.viewedScene || null,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  View models
  // ═══════════════════════════════════════════════════════════

  _buildContext(nets, scenes, viewed) {
    const players = this._players();
    const scene = this._scene();
    const here = scene ? nets.filter(n => n.availability?.global || this._sceneState(scene, n) !== undefined) : nets.filter(n => n.availability?.global);
    const logCount = this.accessLogService?.entryCount ?? 0;
    const nav = Object.entries(VIEWS).map(([k, v]) => ({
      key: k, icon: v.icon, label: v.label, on: this._view === k,
      count: { scene: here.length, all: nets.length, scenes: scenes.length, log: logCount }[k],
    }));
    const ctx = {
      view: this._view, nav, head: VIEWS[this._view],
      isScene: this._view === 'scene', isAll: this._view === 'all', isScenes: this._view === 'scenes', isLog: this._view === 'log',
      isPopout: this.isPopout,
    };
    if (ctx.isScene) ctx.scene = this._sceneContext(nets, scenes, scene, viewed, here, players);
    if (ctx.isAll) ctx.all = this._allContext(nets, scenes, scene, players);
    if (ctx.isScenes) ctx.scenes = this._scenesContext(nets, scenes, viewed, players);
    if (ctx.isLog) ctx.log = this._logContext(nets);
    return ctx;
  }

  _netPickItems(nets, { prefix = '', counts = null } = {}) {
    return nets.map(n => ({
      id: n.id, name: prefix + n.name, group: typeLabel(n.type), color: this._ic(n).color, icon: this._ic(n).icon,
      meta: n.availability?.global ? 'Everywhere' : this._access(n).label, count: counts ? (counts[n.id] || 0) : undefined,
    }));
  }

  _sceneContext(nets, scenes, scene, viewed, here, players) {
    const jam = !!scene?.getFlag?.(MODULE_ID, 'deadZone');
    const def = scene?.getFlag?.(MODULE_ID, 'defaultNetwork') ?? '';
    // Scene picker (single): the viewed scene pinned on top.
    const sid = this.scopeId('scene');
    ScopePicker.set(sid, scene ? [scene.id] : []);
    const folderOf = (s) => s.folder?.name || 'No folder';
    const scenePicker = ScopePicker.html(sid, {
      noun: 'scene', nouns: 'scenes', icon: 'fa-map', allLabel: scene?.name || 'No scene',
      pinned: viewed ? [{ id: viewed.id, name: viewed.name, icon: 'fa-location-crosshairs', meta: 'The scene you are viewing' }] : [],
      items: scenes.filter(s => s.id !== viewed?.id).map(s => ({ id: s.id, name: s.name, group: folderOf(s), icon: 'fa-map',
        meta: s.getFlag?.(MODULE_ID, 'deadZone') ? 'Dead zone' : '' })),
    });

    const onHere = here.filter(n => n.availability?.global || this._sceneState(scene, n) === true);
    const bcastPicker = ScopePicker.html(this.scopeId('bcast'), {
      noun: 'network', nouns: 'networks', icon: 'fa-users', label: 'To', allLabel: 'Everyone online',
      pinned: [
        { id: 'all', name: 'Everyone online', icon: 'fa-users', meta: 'Every player client' },
        { id: 'scene', name: 'Everyone on this scene', icon: 'fa-location-crosshairs', meta: `Players viewing ${scene?.name || 'this scene'}` },
      ],
      items: this._netPickItems(nets, { prefix: 'On ' }),
    });

    const hereId = this.scopeId('here');
    if (!ScopePicker.isOpen(hereId)) ScopePicker.set(hereId, nets.filter(n => !n.availability?.global && this._sceneState(scene, n) === true).map(n => n.id));
    const herePicker = ScopePicker.html(hereId, {
      noun: 'network', nouns: 'networks', icon: 'fa-pen-to-square', multi: true, fixedLabel: 'Change which networks reach this scene',
      items: this._netPickItems(nets.filter(n => !n.availability?.global)),
    });

    const rows = here.map(n => {
      const on = !!n.availability?.global || this._sceneState(scene, n) === true;
      const sig = jam ? 0 : (n.signalStrength ?? 0);
      return {
        id: n.id, name: n.name, ic: this._ic(n), access: this._access(n), isGlobal: !!n.availability?.global,
        isDefault: def && (def === n.id || def === n.name), on, live: on && !jam,
        traced: !!n.effects?.traced, signal: sig, tier: sigTier(sig),
        players: players.filter(p => p.networkId === n.id),
        // the radio dial: the network's own level survives a dead zone (it comes back as it was)
        level: Number(n.signalStrength ?? 0) || 0, typeLabel: typeLabel(n.type), accessText: accessWords(n.security, bypassDCFor),
        reach: n.availability?.global ? 'Every scene' : on ? 'This scene' : 'Switched off here',
        reachTone: n.availability?.global ? 'good' : on ? 'act' : 'attn',
      };
    });
    const dial = buildDial(rows, { sel: this._dialSel, jam });
    const hereIds = new Set(onHere.map(n => n.id));
    const elsewhere = players.filter(p => p.networkId && !hereIds.has(p.networkId)).map(p => ({
      ...p, networkName: this.networkService?.getNetwork?.(p.networkId)?.name || p.networkId,
    }));
    const unknown = players.filter(p => !p.networkId);
    // Everyone online, with where they are — the dial's foot line.
    const foot = players.map(p => {
      const net = p.networkId ? this.networkService?.getNetwork?.(p.networkId) : null;
      const state = !p.networkId ? 'none' : jam ? 'jam' : hereIds.has(p.networkId) ? 'on' : 'away';
      return { ...p, netName: net?.name || p.networkId || '', state, isAway: state === 'away', isJam: state === 'jam', isNone: state === 'none' };
    });
    return {
      dial, foot,
      id: scene?.id || '', name: scene?.name || 'No scene', jam, scenePicker, bcastPicker, herePicker,
      bcastText: this._bcastText,
      defaultOptions: [{ id: '', name: '— none —', on: !def },
        ...onHere.map(n => ({ id: n.id, name: n.name, on: def === n.id || def === n.name }))],
      rows, count: rows.length, elsewhere, unknownCount: unknown.length,
    };
  }

  _allContext(nets, scenes, scene, players) {
    const q = this._search.trim().toLowerCase();
    const inUse = (n) => players.some(p => p.networkId === n.id);
    const onHere = (n) => !!n.availability?.global || (scene && this._sceneState(scene, n) === true);
    const nowhere = (n) => !n.availability?.global && !scenes.some(s => this._sceneState(s, n) === true);
    const F = {
      all: () => true, here: onHere, sec: (n) => !!n.security?.requiresAuth,
      global: (n) => !!n.availability?.global, use: inUse, nowhere,
    };
    const searched = q ? nets.filter(n => `${n.name} ${n.description || ''} ${n.group || ''} ${n.type || ''}`.toLowerCase().includes(q)) : nets;
    const chips = [['all', 'All'], ['here', 'On this scene'], ['sec', 'Secured'], ['global', 'Everywhere'], ['use', 'In use'], ['nowhere', 'On no scene']]
      .map(([k, l]) => ({ key: k, label: l, count: searched.filter(F[k]).length, on: this._filter === k }));
    const rows = searched.filter(F[this._filter] || F.all);
    const groupKey = {
      type: (n) => typeLabel(n.type),
      folder: (n) => (n.isCore ? 'Core networks' : (n.group?.trim() || 'No folder')),
      access: (n) => this._access(n).label,
      none: () => '',
    }[this._groupBy] || ((n) => typeLabel(n.type));
    const groupsMap = new Map();
    for (const n of rows) {
      const g = groupKey(n);
      if (!groupsMap.has(g)) groupsMap.set(g, []);
      const sc = this._scenesFor(n, scenes);
      groupsMap.get(g).push({
        id: n.id, name: n.name, ic: this._ic(n), sel: n.id === this._selId && !this._isNew,
        subline: `${sc ? `${sc.length} ${sc.length === 1 ? 'scene' : 'scenes'}` : 'Everywhere'} · ${this._access(n).label.toLowerCase()}`,
        // the same facts split, so the access reads as its badge (open / secured / Black ICE)
        where: sc ? `${sc.length} ${sc.length === 1 ? 'scene' : 'scenes'}` : 'Everywhere', access: this._access(n),
        here: onHere(n), users: players.filter(p => p.networkId === n.id).length, nowhere: nowhere(n),
      });
    }
    // A search opens every group; so does the group holding the open network.
    const forced = !!q;
    const groups = [...groupsMap.entries()].map(([name, list]) => {
      const key = `${this._groupBy}:${name}`;
      // A group heading's edge: grouped by access it means something (locked = violet, Black ICE = red);
      // otherwise it is just "which one" — a category hue from the group's name.
      const edge = this._groupBy === 'access'
        ? ({ Open: 'var(--ncm-text-label)', Secured: 'var(--ncm-secret)', 'Black ICE': 'var(--ncm-bad)' }[name] || 'var(--ncm-text-label)')
        : tagHue(name);
      return { name, key, list, count: list.length, edge, shut: !!name && !forced && !list.some(r => r.sel) && this._netShut.has(key) };
    });
    const canFold = groups.filter(g => g.name).length > 1;
    const allShut = canFold && groups.filter(g => g.name).every(g => g.shut || g.list.some(r => r.sel));

    if (!this._isNew && (!this._selId || !nets.some(n => n.id === this._selId))) {
      this._selId = rows[0]?.id || nets[0]?.id || null;
      if (this._edit && !this._isNew) this._edit = false;
    }
    const sel = this._selId ? nets.find(n => n.id === this._selId) : null;
    const out = {
      search: this._search, chips, groups, empty: !rows.length, canFold, allShut,
      groupOptions: [['type', 'Group: Type'], ['folder', 'Group: Folder'], ['access', 'Group: Access'], ['none', 'Group: None']]
        .map(([value, label]) => ({ value, label, on: value === this._groupBy })),
      editing: this._edit,
    };
    if (this._edit) out.ed = this._editorContext(nets, scenes, sel);
    else if (sel) out.det = this._detailContext(sel, scenes, players);
    return out;
  }

  _detailContext(n, scenes, players) {
    const sec = n.security || {};
    const ways = [];
    if (sec.requiresAuth) {
      if (sec.allowPassword || sec.password) ways.push({ icon: 'fa-key', label: 'Password', m: sec.password ? '' : 'not set' });
      if (sec.allowSkillCheck) for (const s of sec.bypassSkills || []) ways.push({ icon: 'fa-dice-d20', label: s, m: `DV ${bypassDCFor(sec, s)}` });
      if (sec.allowKeyItem && sec.keyItemName) ways.push({ icon: 'fa-id-badge', label: sec.keyItemName, m: sec.keyItemConsume ? 'used up' : '' });
    }
    const mins = Math.round((sec.lockoutDuration ?? 3600000) / 60000);
    const fail = { lockout: `then a ${mins >= 60 && mins % 60 === 0 ? `${mins / 60}-hour` : `${mins}-minute`} lockout`, permanent: 'then locked out for good',
      damage: `then ${sec.encryptionType === 'RED_ICE' ? 'Red' : 'Black'} ICE bites`, nothing: 'no penalty' }[sec.failureMode || 'lockout'];
    const sc = this._scenesFor(n, scenes);
    const recent = (this.accessLogService?.getEntries?.({ networkId: n.id, limit: 5 }) ?? []).map(e => this._formatLogEntry(e));
    const fx = n.effects || {};
    const tags = [];
    if (fx.traced) tags.push({ cls: 'bad', icon: 'fa-satellite-dish', label: 'Traffic is traced' });
    if (fx.anonymity) tags.push({ cls: 'secret', icon: 'fa-user-secret', label: 'Anonymous' });
    if (fx.messageDelay > 0) tags.push({ cls: 'warn', icon: 'fa-hourglass-half', label: `Messages delayed ${fx.messageDelay} ms` });
    if (fx.restrictedAccess) tags.push({ cls: 'warn', icon: 'fa-eye-slash', label: 'Mail only readable here' });
    if (fx.canRoute === false) tags.push({ cls: '', icon: 'fa-route', label: 'Can’t reach other networks' });
    else if ((fx.allowedRecipientNetworks || []).length) tags.push({ cls: '', icon: 'fa-route', label: `Reaches ${(fx.allowedRecipientNetworks || []).map(id => this.networkService?.getNetwork?.(id)?.name || id).join(', ')}` });
    return {
      id: n.id, name: n.name, ic: this._ic(n), isCore: !!n.isCore,
      subline: `${typeLabel(n.type)} · signal ${n.signalStrength ?? 0}% · reliability ${n.reliability ?? 0}%`,
      typeName: typeLabel(n.type), signal: n.signalStrength ?? 0, tier: sigTier(n.signalStrength ?? 0), reliability: n.reliability ?? 0,
      access: this._access(n),
      // what failing costs, in its tone: a bite or a permanent lock is bad, a timed lockout needs watching
      failTag: { damage: { cls: 'bad', icon: 'fa-skull', label: `${sec.encryptionType === 'RED_ICE' ? 'Red' : 'Black'} ICE bites` },
        permanent: { cls: 'bad', icon: 'fa-ban', label: 'Locked out for good' },
        lockout: { cls: 'attn', icon: 'fa-hourglass-half', label: `${mins >= 60 && mins % 60 === 0 ? `${mins / 60} h` : `${mins} min`} lockout` },
        nothing: { cls: 'plain', icon: 'fa-circle-minus', label: 'No penalty' } }[sec.failureMode || 'lockout'],
      description: n.description || '', lore: n.lore || '',
      isGlobal: !!n.availability?.global, scenes: sc || [],
      isOpen: !sec.requiresAuth, ways,
      waysNote: `${sec.authLogic === 'all' ? 'All of these' : 'Any one of these'} · ${sec.maxAttempts ?? 3} attempts, ${fail}`,
      tags, users: players.filter(p => p.networkId === n.id), recent, menuOpen: this._menu === 'net',
      nodes: this._nodesContext(n),
    };
  }

  /**
   * The network's nodes for its detail pane: one row each (state in words and its meaning colour) and, per scene, how
   * many are up — the scene rule (utils/networkNodes.js): the network reaches a scene with nodes only while one is up.
   */
  _nodesContext(n) {
    const ns = this.networkService;
    const all = ns?.getNodes?.() ?? [];
    const mine = all.filter(x => x.networkId === n.id);
    const now = ns?._nowMs?.() ?? Date.now();
    const tone = { on: 'good', off: 'plain', jammed: 'attn', damaged: 'bad' };
    const list = mine.map(x => {
      const st = nodeStateAt(x, now);
      const scene = x.sceneId ? game.scenes?.get(x.sceneId) : null;
      return {
        id: x.id, name: x.name, icon: (NODE_KINDS[x.kind] || NODE_KINDS.relay).icon, kindLabel: (NODE_KINDS[x.kind] || NODE_KINDS.relay).label,
        hex: nodeHex(x.id), place: x.place, sceneId: x.sceneId, sceneName: scene?.name || (x.sceneId ? 'a deleted scene' : 'no scene yet'),
        noScene: !scene, state: st, stateLabel: stateLabel(x, now), tone: tone[st] || 'plain', isUp: st === 'on',
        hidden: x.hidden, alert: x.alert, netId: n.id,
        infections: (x.infections || []).map(i => ({
          id: i.id, nodeId: x.id, family: i.family, icon: NODE_PROGRAMS[i.kind].icon,
          label: `${i.name || NODE_PROGRAMS[i.kind].label} — ${i.actorName || 'someone'}${i.sloppy ? ' (sloppy)' : ''}`,
          detail: i.kind === 'worm' ? `on ${familyNodes(all, i.family).length} node(s)${i.nextAt ? ` · next hop in ${Math.max(1, Math.ceil((i.nextAt - now) / 60000))} min` : ' · at its limit'}`
            : i.kind === 'bomb' ? `goes off in ${Math.max(1, Math.ceil((i.fireAt - now) / 60000))} min` : i.kind === 'sniffer' ? `${i.loot.length} caught` : `stealth DV ${i.stealthDV}`,
        })),
        runs: (x.runs || []).filter(r => now < r.until).map(r => ({
          nodeId: x.id, actorId: r.actorId,
          label: `${r.actorName || 'Someone'} · ${Math.max(0, r.moves - r.used)}/${r.moves} moves${r.open ? ' · in now' : ''}`,
          left: `${Math.max(1, Math.ceil((r.until - now) / 60000))} min`,
        })),
        get summary() {
          const out = [];
          const inf = this.infections, fx = this.effects, rn = this.runs;
          if (inf.length) out.push({ nodeId: x.id, tone: 'bad', icon: 'fa-bug', label: `${inf.length} infection${inf.length === 1 ? '' : 's'}`, tip: inf.map(i => i.label).join(' · ') });
          const taps = fx.filter(e => e.kind === 'taps'), doors = fx.filter(e => e.kind === 'backdoors');
          if (taps.length) out.push({ nodeId: x.id, tone: 'secret', icon: 'fa-ear-listen', label: `${taps.length} tap${taps.length === 1 ? '' : 's'}`, tip: taps.map(e => e.label).join(' · ') });
          if (doors.length) out.push({ nodeId: x.id, tone: 'secret', icon: 'fa-door-open', label: `${doors.length} backdoor${doors.length === 1 ? '' : 's'}`, tip: doors.map(e => e.label).join(' · ') });
          const inNow = rn.filter(r => / in now/.test(r.label)).length;
          if (rn.length) out.push({ nodeId: x.id, tone: 'act', icon: 'fa-plug', label: inNow ? `${inNow} jacked in` : `${rn.length} session${rn.length === 1 ? '' : 's'}`, tip: rn.map(r => r.label).join(' · ') });
          return out;
        },
        effects: Object.keys(NODE_EFFECTS).flatMap(k => activeEffects(x, k, now).map(e => ({
          kind: k, id: e.id, nodeId: x.id, icon: NODE_EFFECTS[k].icon,
          label: `${NODE_EFFECTS[k].label} — ${e.actorName || 'someone'}`,
          left: e.until ? `${Math.max(1, Math.ceil((e.until - now) / 60000)) >= 60 ? `${Math.round((e.until - now) / 3600000)} h` : `${Math.max(1, Math.ceil((e.until - now) / 60000))} min`}` : '',
        }))),
      };
    }).sort((a, b) => a.sceneName.localeCompare(b.sceneName) || a.name.localeCompare(b.name));
    const sceneIds = [...new Set(mine.map(x => x.sceneId).filter(Boolean))];
    const scenes = sceneIds.map(id => {
      const v = sceneVerdict(all, n.id, id, now);
      return { id, name: game.scenes?.get(id)?.name || 'a deleted scene', up: v.up, total: v.up + v.down, cut: v.cut, netName: n.name };
    }).sort((a, b) => Number(b.cut) - Number(a.cut) || a.name.localeCompare(b.name));
    return { list, has: list.length > 0, count: list.length, scenes, cutCount: scenes.filter(x => x.cut).length };
  }

  /** Add or edit a node through its dialog. */
  async _editNode(nodeId, netId) {
    const ns = this.networkService;
    const net = ns?.getNetwork?.(netId || this._selId);
    if (!net) return;
    const base = nodeId ? ns.getNode(nodeId) : { networkId: net.id, sceneId: game.scenes?.viewed?.id || '' };
    if (nodeId && !base) return ui.notifications.warn('That node no longer exists.');
    const edited = await editNodeDialog(base, net);
    if (!edited) return;
    const res = await ns.saveNode({ ...edited, id: nodeId || undefined, networkId: net.id });
    if (!res?.success) return ui.notifications.warn(`Could not save the node: ${res?.error || 'unknown error'}`);
    if (nodeId && !!base.hidden !== !!res.node.hidden) await game.nightcity?.terminalScenePins?.setNodeHidden?.(nodeId, res.node.hidden);
    if (!res.node.sceneId) ui.notifications.info(`${res.node.name} has no scene yet — it won't affect anything until it stands on one.`);
    this.app.render();
  }

  async _nodeState(nodeId, state) {
    const ns = this.networkService;
    let minutes = 0;
    if (state === 'jammed') {
      const node = ns.getNode(nodeId);
      const v = await themedPrompt({
        title: 'Jam a node', label: 'Jam it', icon: 'fas fa-wave-square',
        content: dialogBodyHtml({ tone: 'attn', icon: 'fas fa-wave-square', title: node?.name || 'Node', kind: 'Node',
          lead: 'For how long? It comes back on by itself when the time runs out (game time).',
          field: { name: 'minutes', label: 'Minutes', value: '30' } }),
        read: (root) => Number(root.querySelector('[name="minutes"]')?.value) || 0,
      });
      if (!v) return;
      minutes = v;
    }
    const res = await ns.setNodeState(nodeId, state, { minutes, who: 'GM' });
    if (!res?.success) ui.notifications.warn(res?.error || 'Could not change the node.');
  }

  async _deleteNode(nodeId) {
    const ns = this.networkService;
    const node = ns.getNode(nodeId);
    if (!node) return;
    const net = ns.getNetwork(node.networkId);
    const ok = await themedConfirm({
      title: 'Remove node', yes: 'Remove', yesIcon: 'fas fa-trash', bad: true,
      content: dialogBodyHtml({ tone: 'bad', icon: (NODE_KINDS[node.kind] || NODE_KINDS.relay).icon, title: node.name, sub: net?.name || '', kind: 'Node',
        lead: `Remove this node from **${net?.name || 'the network'}**?`,
        goes: ['The node and its log'], stays: ['The network itself', node.sceneId ? 'The network on its scene (unless another node there is down)' : 'Everything else'] }),
    });
    if (!ok) return;
    await game.nightcity?.terminalScenePins?.removePinsForNode?.(nodeId);
    await ns.deleteNode(nodeId);
  }

  _editorContext(nets, scenes, sel) {
    if (!this._draft) {
      const where = sel ? (this._scenesFor(sel, scenes) || []).map(s => s.id) : [];
      this._draft = this._isNew ? applyPreset(draftFrom(null), this._presetKey || 'blank') : draftFrom(sel, where);
      if (sel && !this._isNew) { this._draft.id = sel.id; this._draft.isCore = !!sel.isCore; }
    }
    const d = this._draft;
    const recipId = this.scopeId('recip');
    const allowed = d.effects?.allowedRecipientNetworks || [];
    const unknown = allowed.filter(id => !nets.some(n => n.id === id)).map(id => ({ id, name: id, group: 'Not a network', icon: 'fa-question', meta: 'no network has this id' }));
    const recipientPicker = ScopePicker.html(recipId, {
      noun: 'network', nouns: 'networks', icon: 'fa-route', multi: true, allLabel: 'Every network',
      items: [...this._netPickItems(nets).map(i => (i.id === d.id ? { ...i, meta: 'this network' } : i)), ...unknown],
    });
    const sortedScenes = [...scenes].sort((a, b) => (Number(b.id === game.scenes?.viewed?.id) - Number(a.id === game.scenes?.viewed?.id)) || a.name.localeCompare(b.name));
    const ctx = editorContext(d, {
      isNew: this._isNew, step: this._step, presetKey: this._presetKey,
      types: Object.values(NETWORK_TYPES),
      scenes: sortedScenes.map(s => ({ id: s.id, name: s.name, current: s.id === game.scenes?.viewed?.id })),
      iceActors: (game.actors?.filter?.(isIceActor) ?? []).map(a => ({ id: a.id, name: a.name, atk: a.system?.stats?.atk ?? 0 })),
      groups: [...new Set(nets.map(n => n.group).filter(g => g && g.trim()))].sort(),
      bypassHtml: bypassRowsHtml(d.security, { defaultDV: 15 }),
      recipientPicker,
    });
    ctx.cmvOverride = cmvOverrideContext(d.security?.countermeasures, 'network');
    ctx.session = this._editSession;
    ctx.title = this._isNew ? 'New network' : `Editing ${d.name || 'network'}`;
    ctx.ic = this._isNew ? { color: 'var(--ncm-secondary)', icon: 'fa-plus', img: '' } : this._ic(d);
    const i = NET2_STEPS.findIndex(s => s.key === ctx.step);
    ctx.prev = NET2_STEPS[i - 1] || null;
    ctx.next = NET2_STEPS[i + 1] || null;
    return ctx;
  }

  // ═══════════════════════════════════════════════════════════
  //  Scenes — THE ATLAS (2026-10-29). Rules: utils/scenesAtlas.js.
  //  Shelves = the GM's own scene folders (tree order, nested, foldable) with the
  //  navigation bar pinned on top; Paint = a transmitter strip (click a network,
  //  then click scenes to wire it); Grid = scenes × networks for bulk; In
  //  compendiums = pre-wire pack scenes, applied on import.
  // ═══════════════════════════════════════════════════════════

  /** Scene folders in the sidebar's tree order (depth-first), as plain records. */
  _sceneFolders() {
    const all = game.folders?.filter?.((f) => f.type === 'Scene') ?? [];
    const kids = new Map();
    for (const f of all) { const p = f.folder?.id || null; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f); }
    const out = [];
    const walk = (parent, depth, path) => {
      const list = (kids.get(parent) || []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)));
      for (const f of list) {
        const p = [...path, f.name];
        out.push({ key: f.id, name: f.name, depth, path: p, parentKey: parent });
        if (depth < 12) walk(f.id, depth + 1, p);
      }
    };
    walk(null, 0, []);
    return out;
  }

  /** One world scene as a plain row for scenesAtlas. */
  _sceneRow(s, nets, viewed, players) {
    const avail = s.getFlag?.(MODULE_ID, 'networkAvailability') ?? {};
    const deadZone = !!s.getFlag?.(MODULE_ID, 'deadZone');
    const def = s.getFlag?.(MODULE_ID, 'defaultNetwork') ?? '';
    const startNet = def ? nets.find((n) => n.id === def || n.name === def) : null;
    return {
      id: s.id, name: s.name, folderKey: s.folder?.id || null, sort: s.sort ?? 0,
      nav: !!s.navigation, navOrder: s.navOrder ?? 0, cur: s.id === viewed?.id, dead: deadZone,
      start: startNet?.id || '', nets: nets.filter((n) => !n.availability?.global && this._sceneState(s, n) === true).map((n) => n.id),
      players: players.filter((p) => p.viewing === s.id), source: sourceUuidOf(s), imported: !!sourceUuidOf(s),
      configured: deadZone || !!def || Object.values(avail).some(Boolean), modified: s._stats?.modifiedTime || 0, thumb: s.thumb || s.background?.src || '',
    };
  }

  _dotsFor(ids, netById) {
    return ids.map((id) => netById.get(id)).filter(Boolean).map((n) => ({ id: n.id, name: n.name, color: this._ic(n).color }));
  }

  /** A card for a world scene or a pack scene. */
  _sceneCard(r, netById, paint, { pack = null } = {}) {
    const dots = this._dotsFor(r.nets, netById);
    const start = r.start ? netById.get(r.start) : null;
    return {
      id: r.id, uuid: r.uuid || '', pack: !!pack, name: r.name, thumb: r.thumb || '', hue: tagHue(r.name),
      cur: !!r.cur, dead: !!r.dead, nav: !!r.nav, inWorld: !!r.inWorld,
      sel: this._scSel === (pack ? r.uuid : r.id),
      faces: (r.players || []).slice(0, 3), moreFaces: Math.max(0, (r.players || []).length - 3),
      start: start ? { name: start.name, color: this._ic(start).color } : null,
      dots: dots.slice(0, 5), more: Math.max(0, dots.length - 5),
      unwired: !pack && !r.dead && !r.nets.length,
      has: !!paint && r.nets.includes(paint), netsAttr: r.nets.join(' '),
    };
  }

  _prewire() { try { return game.settings.get(MODULE_ID, 'scenePrewire') || {}; } catch { return {}; } }
  async _setPrewire(uuid, rec) {
    const map = { ...this._prewire() };
    if (rec) map[uuid] = rec; else delete map[uuid];
    await game.settings.set(MODULE_ID, 'scenePrewire', map);
  }

  /** The default-network options for one scene (or a pre-wire record): none + every network that reaches it. */
  _startOptions(netIds, start, nets) {
    const reach = [...nets.filter((n) => n.availability?.global), ...netIds.map((id) => nets.find((n) => n.id === id)).filter(Boolean)];
    return [{ id: '', name: '— none —', on: !start }, ...reach.map((n) => ({ id: n.id, name: n.name, on: start === n.id }))];
  }

  /** Compendium shelves: one per Scene pack. Indexes load once (async) and the tab re-renders when they land. */
  _packShelves(nets, netById, paint, q, inWorld) {
    const packs = game.packs?.filter?.((p) => p.documentName === 'Scene') ?? [];
    const pre = this._prewire();
    const forced = !!String(q || '').trim();
    return packs.map((p) => {
      const loaded = !!p.indexed || (p.index?.size ?? 0) > 0;
      if (!loaded && !this._packLoading.has(p.collection)) {
        this._packLoading.add(p.collection);
        Promise.resolve(p.getIndex?.({ fields: ['thumb', 'background.src'] })).then(() => this.app.render()).catch(() => { /* a broken pack stays "loading" */ });
      }
      const label = p.metadata?.label || p.title || p.collection;
      const uuidOf = (e) => e.uuid || `Compendium.${p.collection}.Scene.${e._id}`;
      const entries = (loaded ? [...p.index.values()] : [])
        .filter((e) => sceneMatches(e, q, [label]))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
      const key = `pack:${p.collection}`;
      const more = this._scMore.has(key);
      const rows = entries.map((e) => {
        const uuid = uuidOf(e); const rec = sanitizePrewire(pre[uuid]);
        return { id: uuid, uuid, name: e.name, thumb: e.thumb || e.background?.src || '', nets: rec.nets, start: rec.start, dead: rec.dead, inWorld: inWorld.has(uuid) };
      });
      const shown = more ? rows : rows.slice(0, SHELF_LIMIT);
      return {
        key, name: label, pkg: p.metadata?.packageName || '', total: rows.length, hidden: rows.length - shown.length, more, loading: !loaded,
        wiredN: rows.filter((r) => r.nets.length || r.dead).length,
        shut: shelfShut(key, { defaultOpen: false, shut: this._scShut, open: this._scOpen, forced }),
        cards: shown.map((r) => this._sceneCard(r, netById, paint, { pack: p })),
      };
    }).filter((s) => s.loading || s.total > 0 || !forced);
  }

  /** The inspector under the shelves: the picked world scene or pack scene, with every control the old row had. */
  _sceneInspector(nets, netById) {
    const sel = this._scSel;
    if (!sel || this._scPaint) return null;
    const nonGlobal = nets.filter((n) => !n.availability?.global);
    const globalsNote = nets.filter((n) => n.availability?.global).map((n) => n.name).join(' and ');
    if (sel.startsWith('Compendium.')) {
      const rec = sanitizePrewire(this._prewire()[sel]);
      const coll = sel.slice('Compendium.'.length, sel.lastIndexOf('.Scene.'));
      const pack = game.packs?.get?.(coll);
      const entry = pack?.index?.get?.(sel.slice(sel.lastIndexOf('.') + 1));
      if (!pack || !entry) { this._scSel = null; return null; }
      const pid = this.scopeId('scpre');
      if (!ScopePicker.isOpen(pid)) ScopePicker.set(pid, rec.nets);
      ScopePicker.on(pid, async (v) => {
        if (ScopePicker.isOpen(pid)) return this.app.render();
        const cur = sanitizePrewire(this._prewire()[sel]);
        if (v.join() === cur.nets.join()) return this.app.render();
        const next = sanitizePrewire({ ...cur, nets: v });
        await this._setPrewire(sel, (next.nets.length || next.dead) ? next : null);
        this.app.render();
      });
      return {
        kind: 'pack', isPack: true, uuid: sel, name: entry.name, thumb: entry.thumb || entry.background?.src || '', hue: tagHue(entry.name), where: pack.metadata?.label || coll,
        inWorld: this._scInWorld?.has(sel), dead: rec.dead,
        nets: this._dotsFor(rec.nets, netById).map((d) => ({ ...d, ic: this._ic(netById.get(d.id)) })),
        picker: ScopePicker.html(pid, { noun: 'network', nouns: 'networks', icon: 'fa-plus', multi: true, fixedLabel: rec.nets.length ? 'Add' : 'Pre-wire networks', items: this._netPickItems(nonGlobal) }),
        startOptions: this._startOptions(rec.nets, rec.start, nets), globalsNote,
      };
    }
    const r = this._scAll?.get(sel);
    const scene = game.scenes?.get(sel);
    if (!r || !scene) { this._scSel = null; return null; }
    const pid = this.scopeId('scsel');
    if (!ScopePicker.isOpen(pid)) ScopePicker.set(pid, r.nets);
    ScopePicker.on(pid, async (v) => {
      if (ScopePicker.isOpen(pid)) return this.app.render(); // apply on Done / close
      await this._setSceneNets(game.scenes.get(sel), v);
      this.app.render();
    });
    const folders = this._scFolders || [];
    return {
      kind: 'scene', isPack: false, id: r.id, name: r.name, thumb: r.thumb, hue: tagHue(r.name), cur: r.cur, dead: r.dead,
      where: folders.find((f) => f.key === r.folderKey)?.path.join(' / ') || 'Not in a folder', players: r.players,
      nets: r.nets.map((id) => netById.get(id)).filter(Boolean).map((n) => ({ id: n.id, name: n.name, ic: this._ic(n) })),
      picker: ScopePicker.html(pid, { noun: 'network', nouns: 'networks', icon: 'fa-plus', multi: true, fixedLabel: r.nets.length ? 'Add' : 'Add networks', items: this._netPickItems(nonGlobal) }),
      startOptions: this._startOptions(r.nets, r.start, nets), globalsNote,
    };
  }

  _scenesContext(nets, scenes, viewed, players) {
    const netById = new Map(nets.map((n) => [n.id, n]));
    const globalIds = new Set(nets.filter((n) => n.availability?.global).map((n) => n.id));
    const folders = this._sceneFolders();
    this._scFolders = folders;
    const fById = new Map(folders.map((f) => [f.key, f]));
    const all = scenes.map((s) => this._sceneRow(s, nets, viewed, players));
    this._scAll = new Map(all.map((r) => [r.id, r]));
    this._scInWorld = new Set(all.map((r) => r.source).filter(Boolean));
    if (this._scPaint && (!netById.has(this._scPaint) || globalIds.has(this._scPaint))) this._scPaint = null;
    const paint = this._scPaint;
    const isGrid = this._scMode === 'grid';

    // the Folder picker narrows to one folder and everything under it
    if (this._scFolder && !fById.has(this._scFolder)) this._scFolder = null;
    const fpid = this.scopeId('scfolder');
    ScopePicker.set(fpid, this._scFolder ? [this._scFolder] : []);
    ScopePicker.on(fpid, (v) => {
      const k = v[0] || null;
      if (k === this._scFolder) return; // the callback also fires on open (the standing ScopePicker rule)
      this._scFolder = k; this.app.render();
    });
    const folderPicker = ScopePicker.html(fpid, {
      noun: 'folder', nouns: 'folders', icon: 'fa-folder-tree', label: 'Folder', allLabel: 'All folders',
      items: folders.map((f) => ({ id: f.key, name: f.name, meta: f.path.length > 1 ? f.path.slice(0, -1).join(' / ') : '', group: f.path[0], icon: 'fa-folder' })),
      pinned: [{ id: '', name: 'All folders', icon: 'fa-layer-group' }],
    });
    const sub = subtreeKeys(this._scFolder, folders);

    const hideable = all.filter((r) => r.imported && !r.configured).length;
    let base = this._sceneHideImported ? all.filter((r) => !(r.imported && !r.configured)) : all;
    base = base.filter((r) => (!sub || sub.has(r.folderKey)) && sceneMatches(r, this._sceneSearch, fById.get(r.folderKey)?.path || []));
    const counts = showCounts(base);
    if (!SCENE_SHOW.some(([k]) => k === this._scShow)) this._scShow = 'all';
    const list = base.filter((r) => scenePasses(r, this._scShow));
    const forced = !!this._sceneSearch.trim() || this._scShow !== 'all' || !!this._scFolder;

    // default folds: the nav bar + the viewed scene's folder (and its parents) open; else the first shelf
    const curFolder = all.find((r) => r.cur)?.folderKey || null;
    const openKeys = new Set(['__nav__', ...ancestorKeys(curFolder, folders)]);
    const shelves = buildShelves(list, folders, { sort: this._scSort, limit: isGrid ? 0 : SHELF_LIMIT, more: this._scMore, globalIds, selId: this._scSel });
    if (!shelves.some((s) => openKeys.has(s.key)) && shelves[0]) openKeys.add(shelves[0].key);
    const shutOf = (key) => shelfShut(key, { defaultOpen: openKeys.has(key), shut: this._scShut, open: this._scOpen, forced });
    this._scShelfIds = new Map(shelves.map((s) => [s.key, s.ids]));
    const paintName = paint ? netById.get(paint)?.name : '';
    const paintAllFor = (ids) => {
      if (!paint) return null;
      const pa = shelfPaint(ids.map((id) => this._scAll.get(id)).filter(Boolean), paint);
      if (!pa.ids.length) return null;
      return { on: pa.on, label: pa.on ? `Wire all (${pa.ids.length})` : `Unwire all (${pa.ids.length})`, tip: pa.on ? `Give ${paintName} to every scene on this shelf` : `Take ${paintName} off every scene on this shelf` };
    };
    const shelfView = (s) => ({
      key: s.key, name: s.name, depth: s.depth, indent: s.depth * 16, isNested: s.depth > 0, total: s.total, hidden: s.hidden, more: this._scMore.has(s.key),
      shut: shutOf(s.key), dots: this._dotsFor(s.summary.nets, netById), dead: s.summary.dead, unwired: s.summary.unwired, players: s.summary.players,
      paintAll: paintAllFor(s.ids), cards: isGrid ? [] : s.rows.map((r) => this._sceneCard(r, netById, paint)),
    });

    let nav = null;
    if (!isGrid) {
      const navRows = navShelf(list);
      if (navRows.length) {
        this._scShelfIds.set('__nav__', navRows.map((r) => r.id));
        const sm = shelfSummary(navRows, globalIds);
        nav = { key: '__nav__', name: 'On the navigation bar', isNav: true, subline: 'the scenes you keep within reach', depth: 0, indent: 0, total: navRows.length, hidden: 0,
          shut: shutOf('__nav__'), dots: this._dotsFor(sm.nets, netById), dead: sm.dead, unwired: sm.unwired, players: sm.players,
          paintAll: paintAllFor(navRows.map((r) => r.id)), cards: navRows.map((r) => this._sceneCard(r, netById, paint)) };
      }
    }

    // the transmitter strip — the Paint picker; globals show their reach but cannot be painted
    const transmitters = [...nets].sort((a, b) => Number(globalIds.has(a.id)) - Number(globalIds.has(b.id)) || String(a.name).localeCompare(String(b.name)))
      .map((n) => {
        const g = globalIds.has(n.id), cv = coverage(all, n.id, { global: g });
        return { id: n.id, name: n.name, ic: this._ic(n), global: g, n: cv.n, of: cv.of, pct: cv.pct, signal: n.signalStrength ?? 0, on: n.id === paint,
          tip: g ? `${n.name} reaches every scene that isn't a dead zone — edit the network to put it on chosen scenes instead` : (n.id === paint ? 'Click to stop painting' : `Paint ${n.name}: click scenes to give it to them`) };
      });

    // Many networks: a dock of the useful few + "All networks" (a searchable picker grouped by type)
    const paintMany = transmitters.length > PAINT_DOCK_AT;
    const dock = paintMany ? paintDock(transmitters, { paint, recent: this._scPaintRecent, limit: 6 }) : null;
    let paintPicker = '';
    {
      const pid = this.scopeId('paint');
      ScopePicker.set(pid, paint ? [paint] : []);
      paintPicker = ScopePicker.html(pid, {
        noun: 'network', nouns: 'networks', icon: 'fa-paintbrush', label: 'Paint with',
        allLabel: 'Pick a network…', ...(paint ? { label: '', fixedLabel: 'Change' } : {}),
        items: nets.filter((n) => !globalIds.has(n.id)).map((n) => {
          const t = transmitters.find((x) => x.id === n.id);
          return { id: n.id, name: n.name, group: typeLabel(n.type), color: this._ic(n).color, icon: this._ic(n).icon, img: this._ic(n).img || undefined,
            meta: t ? `on ${t.n} of ${t.of} scenes` : '' };
        }),
      });
    }

    const packs = isGrid ? [] : this._packShelves(nets, netById, paint, this._sceneSearch, this._scInWorld);
    const packTotal = packs.reduce((n, p) => n + p.total, 0);

    let grid = null;
    if (isGrid) {
      const cols = [...nets.filter((n) => globalIds.has(n.id)), ...nets.filter((n) => !globalIds.has(n.id))]
        .map((n) => ({ id: n.id, name: n.name, ic: this._ic(n), global: globalIds.has(n.id) }));
      const bands = shelves.map((s) => {
        const rows = s.ids.map((id) => this._scAll.get(id)).filter(Boolean);
        return {
          key: s.key, name: s.name, indent: s.depth * 16, total: s.total, shut: shutOf(s.key),
          tallies: cols.map((c) => {
            if (c.global) return { id: c.id, global: true };
            const live = rows.filter((r) => !r.dead);
            const n = live.filter((r) => r.nets.includes(c.id)).length;
            return { id: c.id, bandKey: s.key, n, of: live.length, full: live.length > 0 && n === live.length, color: c.ic.color, tip: n === live.length ? `Take ${c.name} off every scene in ${s.name}` : `Give ${c.name} to every scene in ${s.name}` };
          }),
          rows: s.rows.map((r) => ({
            id: r.id, name: r.name, cur: r.cur, dead: r.dead, nav: r.nav, players: r.players,
            cells: cols.map((c) => ({ id: c.id, sceneId: r.id, global: c.global, on: c.global ? !r.dead : r.nets.includes(c.id), color: c.ic.color, name: c.name })),
            startOptions: this._startOptions(r.nets, r.start, nets),
          })),
        };
      });
      this._scGridOrder = bands.filter((b) => !b.shut).flatMap((b) => b.rows.map((r) => r.id));
      grid = { cols, bands, empty: !bands.length };
    }

    const shown = list.length;
    return {
      isGrid, search: this._sceneSearch, folderPicker,
      show: SCENE_SHOW.map(([key, label]) => ({ key, label, count: counts[key], on: key === this._scShow })),
      sort: SCENE_SORTS.map(([key, label]) => ({ key, label, on: key === this._scSort })),
      hideImported: this._sceneHideImported, hideable, canHide: hideable > 0,
      shown, total: all.length, packTotal, narrowed: shown !== all.length,
      transmitters, paintMany, dock: dock?.dock || [], dockMore: dock?.more || 0, paintPicker,
      painting: paint ? (() => { const t = transmitters.find((x) => x.id === paint); return { id: paint, name: paintName, color: this._ic(netById.get(paint)).color, ic: this._ic(netById.get(paint)), count: all.filter((r) => r.nets.includes(paint)).length, of: t?.of ?? all.length }; })() : null,
      // the brush bar's quick swaps: the networks painted most recently (not the current one, never a global)
      paintRecent: this._scPaintRecent.filter((id) => id !== paint).map((id) => transmitters.find((t) => t.id === id && !t.global)).filter(Boolean).slice(0, 4),
      paintable: transmitters.filter((t) => !t.global).length,
      nav, shelves: shelves.map(shelfView), packs, hasPacks: packs.length > 0,
      sel: this._sceneInspector(nets, netById), grid,
      empty: !shelves.length && !nav,
    };
  }

  _logContext(nets) {
    const all = this.accessLogService?.getEntries?.({ limit: 5000 }) ?? [];
    const counts = {};
    const seen = new Map();
    for (const e of all) {
      const id = e.networkId || 'unknown';
      counts[id] = (counts[id] || 0) + 1;
      if (!seen.has(id)) seen.set(id, e.networkName || id);
    }
    const items = this._netPickItems(nets, { counts });
    for (const [id, name] of seen) if (!nets.some(n => n.id === id)) items.push({ id, name: id === 'all' ? 'All networks (broadcast)' : name, group: 'Other', icon: 'fa-circle-question', count: counts[id] });
    const pid = this.scopeId('netlog');
    const netPicker = ScopePicker.html(pid, { noun: 'network', nouns: 'networks', icon: 'fa-network-wired', multi: true, items, countLabel: 'entries', activeLabel: 'In the log' });
    const picked = new Set(ScopePicker.value(pid));
    const kind = LOG_KINDS.find(k => k.value === this._logKind) || LOG_KINDS[0];
    const q = this._logSearch.trim().toLowerCase();
    const filtered = all.filter(e => {
      if (picked.size && !picked.has(e.networkId || 'unknown')) return false;
      if (kind.value === 'manual' && e.manual !== true) return false;
      if (kind.types && !kind.types.includes(e.type)) return false;
      if (q && !`${e.actorName || ''} ${e.message || ''} ${e.networkName || e.networkId || ''} ${e.sceneName || ''} ${e.type}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const LIMIT = 200;
    const lockouts = (game.nightcity?.securityService?.getActiveLockouts?.() ?? []).map(l => ({
      actorId: l.actorId, targetId: l.targetId,
      actorName: game.actors?.get(l.actorId)?.name ?? 'Unknown',
      targetName: this.networkService?.getNetwork?.(l.targetId)?.name ?? l.targetId,
    }));
    const notePid = this.scopeId('notenet');
    const notePicker = this._noteOpen ? ScopePicker.html(notePid, {
      noun: 'network', nouns: 'networks', icon: 'fa-network-wired', allLabel: 'Pick a network', items: this._netPickItems(nets),
    }) : '';
    return {
      search: this._logSearch, netPicker, notePicker, noteOpen: this._noteOpen, note: this._note,
      noteTypes: [['manual', 'Note'], ['connect', 'Connection'], ['auth_success', 'Login'], ['auth_failure', 'Failed login'], ['hack', 'Hack'], ['lockout', 'Lockout'], ['trace', 'Trace'], ['system', 'System']]
        .map(([value, label]) => ({ value, label, on: value === this._note.type })),
      kinds: LOG_KINDS.map(k => ({ value: k.value, label: k.label, on: k.value === kind.value })),
      rows: filtered.slice(0, LIMIT).map(e => this._formatLogEntry(e)),
      shown: Math.min(LIMIT, filtered.length), matched: filtered.length, total: all.length, capped: filtered.length > LIMIT,
      empty: !filtered.length, lockouts, lockoutCount: lockouts.length, menuOpen: this._menu === 'log',
      filtered: picked.size > 0 || kind.value !== 'all' || !!q,
    };
  }

  /** The node row's ⋯ menu: everything that is not the state pill or Inspect. */
  async _nodeMenu(nodeId, netId, anchor) {
    const ns = this.networkService;
    const node = ns?.getNode(nodeId); if (!node) return;
    const { nodeAccessEntries, showEntriesMenu, openNodePlaceDialog } = await import('../../../integrations/AccessPoints.js');
    const up = nodeStateAt(node, ns._nowMs()) === 'on';
    const entries = [
      { head: 'This node' },
      up ? { label: 'Jam it for a while…', icon: 'fas fa-wave-square', fn: () => this._nodeState(nodeId, 'jammed') }
        : { label: 'Switch it back on', icon: 'fas fa-plug', fn: () => this._nodeState(nodeId, 'on') },
      { label: 'Open its console', icon: 'fas fa-display', fn: () => game.nightcity?.openNode?.(nodeId) },
      { label: 'Place on the map…', icon: 'fas fa-map-pin', fn: () => openNodePlaceDialog(nodeId) },
      { label: 'Edit…', icon: 'fas fa-pen', fn: () => this._editNode(nodeId, netId) },
      { head: 'Ways in' },
      ...nodeAccessEntries(nodeId).filter(e => !e.head),
      { sep: true },
      { label: 'Remove this node…', icon: 'fas fa-trash', bad: true, fn: () => this._deleteNode(nodeId) },
    ];
    showEntriesMenu(entries, anchor);
  }

  _formatLogEntry(e) {
    const type = e.type ?? 'system';
    const BADGE = {
      connect: ['fa-plug', 'ok'], disconnect: ['fa-plug-circle-xmark', 'muted'], auth_success: ['fa-lock-open', 'ok'],
      auth_failure: ['fa-lock', 'bad'], auth_fail: ['fa-lock', 'bad'], lockout: ['fa-ban', 'bad'], dead_zone: ['fa-signal-slash', 'muted'],
      network_switch: ['fa-arrows-rotate', 'info'], hack: ['fa-skull-crossbones', 'bad'], manual: ['fa-pen', 'note'],
      malware: ['fa-virus', 'bad'], system: ['fa-tower-broadcast', 'info'], trace: ['fa-eye', 'warn'],
      message_trace: ['fa-eye', 'warn'], shard_trace: ['fa-satellite-dish', 'warn'],
      node: ['fa-tower-cell', 'warn'], scene_move: ['fa-person-walking', 'info'],
    };
    const VERBS = {
      connect: 'connected to', disconnect: 'disconnected from', auth_success: 'logged in to', auth_failure: 'failed to log in to',
      auth_fail: 'failed to log in to', lockout: 'was locked out of', dead_zone: 'lost signal on', network_switch: 'switched to',
      hack: 'attempted a hack on', manual: 'note on', malware: 'malware found on', system: 'system event on',
      trace: 'was traced on', message_trace: 'sent a traced message on', shard_trace: 'triggered a shard trace on',
      node: 'at a node of', scene_move: 'moved scene, on',
    };
    const TAG = {
      connect: 'Connect', disconnect: 'Disconnect', auth_success: 'Login', auth_failure: 'Failed login', auth_fail: 'Failed login',
      lockout: 'Lockout', dead_zone: 'Dead zone', network_switch: 'Switch', hack: 'Hack', manual: 'Note', malware: 'Malware',
      system: 'System', trace: 'Trace', message_trace: 'Trace', shard_trace: 'Shard trace', node: 'Node', scene_move: 'Moved',
    };
    const [icon, tone] = BADGE[type] ?? ['fa-circle-info', 'muted'];
    const extra = e.extra ?? {};
    let linkType = '', linkLabel = '', linkIcon = '';
    if (extra.itemId) { linkType = 'shard'; linkLabel = 'Open shard'; linkIcon = 'fa-microchip'; }
    else if (extra.messageId) { linkType = 'message'; linkLabel = 'Open message'; linkIcon = 'fa-envelope'; }
    const actorImg = (() => {
      const a = e.actorId ? game.actors?.get(e.actorId)?.img : game.users?.get(e.userId)?.character?.img;
      return a && !a.includes('mystery-man') ? a : '';
    })();
    const d = e.timestamp ? new Date(e.timestamp) : null;
    const p2 = (n) => String(n).padStart(2, '0');
    const net = this.networkService?.getNetwork?.(e.networkId);
    return {
      id: e.id, type, icon, tone, manual: e.manual === true,
      time: d ? `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}` : '',
      date: d ? `${p2(d.getUTCMonth() + 1)}.${p2(d.getUTCDate())}.${d.getUTCFullYear()}` : '',
      actorName: e.actorName ?? game.actors?.get(e.actorId)?.name ?? 'System', actorImg,
      verb: VERBS[type] ?? 'event on', networkId: e.networkId || 'unknown',
      networkName: e.networkName ?? net?.name ?? e.networkId ?? '—', netColor: net?.theme?.color || 'var(--ncm-secondary)',
      tag: TAG[type] ?? String(type).toUpperCase(), message: e.message ?? '',
      sceneName: e.sceneName || (e.sceneId ? game.scenes?.get(e.sceneId)?.name : '') || '',
      hasLink: !!linkType, linkType, linkLabel, linkIcon,
      linkMessageId: extra.messageId ?? '', linkActorId: extra.actorId ?? e.actorId ?? '', linkItemId: extra.itemId ?? '',
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  DOM wire-up
  // ═══════════════════════════════════════════════════════════

  onRender() {
    const el = this.element?.querySelector('.ncm-net2');
    if (!el) return;
    ScopePicker.after();

    el.querySelectorAll('[data-net2-scroll]').forEach(s => { const v = this._scroll[s.dataset.net2Scroll]; if (v) s.scrollTop = v; });

    // ─── Searches (debounced re-render, focus kept) ───
    const searchKeys = { nets: '_search', scenes: '_sceneSearch', log: '_logSearch' };
    el.querySelectorAll('[data-net2-search]').forEach(inp => {
      const prop = searchKeys[inp.dataset.net2Search];
      if (!prop) return;
      const fire = foundry.utils.debounce(() => { this[prop] = inp.value; this.app.render(); }, 280);
      inp.addEventListener('input', fire);
      if (this._focus?.key === inp.dataset.net2Search) {
        inp.focus();
        const p = this._focus.start ?? inp.value.length;
        try { inp.setSelectionRange(p, p); } catch { /* not a text input */ }
      }
    });

    // ─── Selects (data-action fires on click, not change) ───
    el.querySelectorAll('select[data-net2-default]').forEach(sel => sel.addEventListener('change', async () => {
      await this.networkService?.setSceneDefaultNetwork?.(sel.dataset.sceneId, sel.value || '');
      this.app.render();
    }));
    el.querySelector('select[data-net2-groupby]')?.addEventListener('change', (e) => { this._groupBy = e.target.value; this.app.render(); });
    this._wireAtlas(el);

    // ─── Broadcast: Enter sends ───
    el.querySelector('[data-net2-bcast]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._sendBroadcast(); }
    });
    el.querySelector('[data-net2-note] [name="noteMessage"]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._addNote(); }
    });

    this._wireDialMeters(el);
    const form = el.querySelector('.ncm-net2-form');
    if (form) this._wireEditor(form);
  }

  /**
   * The radio dial's meters (This scene) — drag up/down or use the arrow keys.
   * DOM only while dragging (networksDial paints the same way the template does);
   * the ONE write, NetworkService.updateNetwork({signalStrength}), happens on
   * release (keys: once the keys stop, 350 ms). A dead zone locks every meter.
   */
  _wireDialMeters(root) {
    const qualityEl = (m) => m.closest('.ncm-net2-dialcol')?.querySelector('.ncm-net2-dialq');
    root.querySelectorAll('.ncm-net2-dialm[data-network-id]').forEach((m) => {
      if (m.classList.contains('is-locked')) return;
      const col = m.closest('.ncm-net2-dialcol');
      const paint = (pct) => {
        const lit = litCount(pct);
        m.querySelectorAll('.ncm-net2-dialseg').forEach((s, i) => {
          s.classList.toggle('is-lit', i < lit);
          s.classList.toggle('is-top', i < lit && i >= lit - 2);
        });
        const th = m.querySelector('.ncm-net2-dialthumb'); if (th) th.style.bottom = `${pct}%`;
        const crowd = col?.querySelector('.ncm-net2-dialcrowd'); if (crowd) crowd.style.bottom = `${crowdBottom(pct)}%`;
        const out = col?.querySelector('.ncm-net2-dialpct b'); if (out) out.textContent = String(pct);
        const num = col?.querySelector('[data-dial-num]'); if (num && document.activeElement !== num) num.value = String(pct);
        const q = qualityEl(m); if (q) q.textContent = signalQuality(pct);
        m.setAttribute('aria-valuenow', String(pct));
        m.setAttribute('aria-valuetext', `${pct}% · ${signalQuality(pct)}`);
      };
      const save = async (pct) => {
        m.dataset.saved = String(pct);   // drag, keys, typing and ▲▼ all land here
        await this.networkService?.updateNetwork?.(m.dataset.networkId, { signalStrength: pct });
        log.info(`Admin: signal for ${m.dataset.networkId} set to ${pct}%`);
      };
      m.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        m.focus?.();
        const rect = m.getBoundingClientRect();
        let pct = pctAtPointer(e.clientY, rect);
        m.classList.add('is-drag'); paint(pct);
        const move = (ev) => { pct = pctAtPointer(ev.clientY, rect); paint(pct); };
        const up = async () => {
          document.removeEventListener('pointermove', move);
          document.removeEventListener('pointerup', up);
          m.classList.remove('is-drag');
          await save(pct);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
      });
      let keyTimer = null;
      const saveSoon = (pct) => { clearTimeout(keyTimer); keyTimer = setTimeout(() => save(pct), 350); };
      m.addEventListener('keydown', (e) => {
        const pct = stepSignal(Number(m.getAttribute('aria-valuenow')) || 0, e.key, e.shiftKey);
        if (pct === null) return;
        e.preventDefault();
        paint(pct);
        saveSoon(pct);
      });
      // The number box + ▲▼ beside it (2026-10-28, dev: "an up and down arrow with a spot to enter a number").
      // Same paint + one save as a drag, so typing, stepping and dragging can never disagree.
      const num = col?.querySelector('[data-dial-num]');
      const current = () => Number(m.getAttribute('aria-valuenow')) || 0;
      const commit = (raw) => {
        const pct = Math.max(0, Math.min(100, Math.round(Number(raw))));
        if (!Number.isFinite(pct)) { if (num) num.value = String(current()); return; }
        paint(pct);
        if (num) num.value = String(pct);
        if (pct !== Number(m.dataset.saved ?? -1)) { m.dataset.saved = String(pct); saveSoon(pct); }
      };
      if (num) {
        m.dataset.saved = String(current());
        num.addEventListener('change', () => commit(num.value));
        num.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(num.value); num.blur(); }
          else if (e.key === 'Escape') { num.value = String(current()); num.blur(); }
        });
      }
      (col?.querySelectorAll?.('[data-dial-step]') || []).forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        commit(current() + Number(b.dataset.dialStep) * (e.shiftKey ? 10 : 1));
      }));
    });
    // "Broadcast" in the readout: the box is ready to type in
    if (this._bcastFocus) { this._bcastFocus = false; root.querySelector('[data-net2-bcast]')?.focus(); }
  }

  /** The editor is DOM-driven between saves — steps, switches, segments, previews never re-render. */
  _wireEditor(form) {
    wireBypassRows(form);
    wireCmvOverride(form);
    const showStep = (key) => {
      if (!NET2_STEPS.some(s => s.key === key)) return;
      this._step = key;
      const i = NET2_STEPS.findIndex(s => s.key === key);
      form.querySelectorAll('[data-step-sec]').forEach(s => s.classList.toggle('is-on', s.dataset.stepSec === key));
      this.element?.querySelectorAll('[data-net2-step]').forEach(s => s.classList.toggle('on', s.dataset.net2Step === key));
      const n = this.element?.querySelector('[data-net2-stepn]');
      if (n) n.textContent = `step ${i + 1} of ${NET2_STEPS.length} · ${NET2_STEPS[i].label}`;
      const nav = (sel, st) => {
        const b = this.element?.querySelector(sel);
        if (!b) return;
        b.hidden = !st;
        if (st) { b.dataset.net2Go = st.key; b.querySelector('span').textContent = st.label; }
      };
      nav('[data-net2-prev]', NET2_STEPS[i - 1]);
      nav('[data-net2-next]', NET2_STEPS[i + 1]);
      form.closest('[data-net2-scroll]')?.scrollTo?.({ top: 0 });
    };
    this.element?.querySelectorAll('[data-net2-step], [data-net2-go]').forEach(b => b.addEventListener('click', (e) => {
      e.preventDefault();
      showStep(b.dataset.net2Step || b.dataset.net2Go);
    }));

    // Segmented controls → their hidden input.
    form.querySelectorAll('[data-seg]').forEach(seg => {
      seg.addEventListener('click', (e) => {
        const opt = e.target.closest('[data-v]');
        if (!opt) return;
        seg.querySelectorAll('[data-v]').forEach(o => o.classList.toggle('on', o === opt));
        const inp = form.querySelector(`[name="${seg.dataset.seg}"]`);
        if (inp) { inp.value = opt.dataset.v; inp.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    });

    const sync = () => {
      const v = (n) => form.querySelector(`[name="${n}"]`)?.value;
      const c = (n) => !!form.querySelector(`[name="${n}"]`)?.checked;
      form.querySelectorAll('[data-method]').forEach(m => m.classList.toggle('on', c(m.dataset.method)));
      form.querySelector('[data-when-secured]')?.classList.toggle('is-off', v('requiresAuth') !== 'true');
      const openNote = form.querySelector('[data-open-note]'); if (openNote) openNote.hidden = v('requiresAuth') === 'true';
      form.querySelectorAll('[data-when-damage]').forEach(x => { x.hidden = v('failureMode') !== 'damage'; });
      form.querySelectorAll('[data-ice-panel]').forEach(x => { x.hidden = x.dataset.icePanel !== v('iceSource'); });
      form.querySelectorAll('[data-icon-mode]').forEach(x => { x.hidden = x.dataset.iconMode !== v('iconMode'); });
      form.querySelector('[data-where-list]')?.classList.toggle('is-off', c('globalAvailability'));
      const r = form.querySelector('[data-route-list]'); if (r) r.hidden = !c('canRoute');
      // preview pill + head icon
      const color = /^#[0-9a-f]{6}$/i.test(v('themeColor') || '') ? v('themeColor') : '#19f3f7';
      const pill = form.querySelector('[data-preview-pill]');
      if (pill) {
        pill.style.setProperty('--c', color);
        const img = v('iconMode') === 'image' && v('customImage');
        pill.querySelector('[data-preview-icon]').innerHTML = img ? `<img src="${esc(v('customImage'))}" alt="">` : `<i class="fas ${esc(v('themeIcon') || 'fa-wifi')}"></i>`;
        pill.querySelector('[data-preview-name]').textContent = v('name') || 'Network';
      }
      form.querySelectorAll('[data-color-sw]').forEach(s => s.classList.toggle('on', s.dataset.colorSw.toLowerCase() === color.toLowerCase()));
      const pick = form.querySelector('[data-color-pick]'); if (pick && document.activeElement !== pick) pick.value = color;
      const gl = form.querySelector('[data-glitch-out]'); if (gl) gl.textContent = `${Math.round(Number(v('glitchIntensity') || 0) * 100)}%`;
    };
    form.addEventListener('input', sync);
    form.addEventListener('change', sync);

    // Icon grid + colour swatches.
    form.querySelectorAll('[data-icon-pick]').forEach(b => b.addEventListener('click', () => {
      form.querySelector('[name="themeIcon"]').value = b.dataset.iconPick;
      form.querySelectorAll('[data-icon-pick]').forEach(x => x.classList.toggle('on', x === b));
      sync();
    }));
    form.querySelectorAll('[data-color-sw]').forEach(b => b.addEventListener('click', () => {
      form.querySelector('[name="themeColor"]').value = b.dataset.colorSw; sync();
    }));
    form.querySelector('[data-color-pick]')?.addEventListener('input', (e) => {
      form.querySelector('[name="themeColor"]').value = e.target.value; sync();
    });

    // Where: scene search filters the list in place.
    form.querySelector('[data-where-search]')?.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      form.querySelectorAll('[data-where-row]').forEach(r => { r.style.display = !q || r.dataset.whereRow.includes(q) ? '' : 'none'; });
    });
    const count = () => { const n = form.querySelectorAll('[data-where-scene]:checked').length; const o = form.querySelector('[data-where-count]'); if (o) o.textContent = `${n} picked`; };
    form.querySelectorAll('[data-where-scene]').forEach(cb => cb.addEventListener('change', count));

    showStep(this._step);
    sync();
  }

  // ═══════════════════════════════════════════════════════════
  //  Actions — data-action="tabAct" data-op="…"
  // ═══════════════════════════════════════════════════════════

  async onAct(op, event, target) {
    const ds = target?.dataset ?? {};
    const netId = ds.networkId || target?.closest?.('[data-network-id]')?.dataset.networkId;
    const sceneId = ds.sceneId || target?.closest?.('[data-scene-id]')?.dataset.sceneId;
    switch (op) {
      // navigation
      case 'view': if (VIEWS[ds.view]) { this._view = ds.view; this._menu = ''; this.app._pendingContentScrollReset = true; } return this.app.render();
      case 'netFilter': this._filter = ds.filter || 'all'; return this.app.render();
      case 'netFold': { const k = ds.key; if (this._netShut.has(k)) this._netShut.delete(k); else this._netShut.add(k); this._saveNetShut(); return this.app.render(); }
      case 'netFoldAll': {
        const keys = [...this.element?.querySelectorAll?.('.ncm-net2-grp[data-key]') ?? []].map(e => e.dataset.key);
        const shut = ds.shut === '1';
        for (const k of keys) { if (shut) this._netShut.add(k); else this._netShut.delete(k); }
        this._saveNetShut(); return this.app.render();
      }
      case 'select': this._selId = netId; this._edit = false; this._isNew = false; this._draft = null; this._menu = ''; return this.app.render();
      case 'menu': this._menu = this._menu === ds.menu ? '' : (ds.menu || ''); return this.app.render();

      // editor
      case 'new': this._startNew(); return this.app.render();
      case 'edit': this._startEdit(netId || this._selId); return this.app.render();
      case 'cancel': this._edit = false; this._isNew = false; this._draft = null; return this.app.render();
      case 'save': return this._save();
      case 'preset': return this._usePreset(ds.preset);
      case 'keyPick': return this._pickKeyItem();
      case 'keyClear': return this._setKeyItem(null);
      case 'browseImg': return this._browse('customImage', target);
      case 'browseIce': return this._browse('iceCustomPortrait', target);

      // network actions
      case 'resetAuth': return this._resetAuth(netId);
      // network nodes (utils/networkNodes.js) — the writes re-render through the networkNodes setting hook
      case 'nodeAdd': return this._editNode(null, netId);
      case 'nodeEdit': return this._editNode(ds.nodeId, netId);
      case 'nodeState': return this._nodeState(ds.nodeId, ds.state);
      case 'nodeToggle': { const nd = this.networkService?.getNode(ds.nodeId); if (!nd) return; return this._nodeState(ds.nodeId, nodeStateAt(nd, this.networkService._nowMs()) === 'on' ? 'off' : 'on'); }
      case 'nodeDel': return this._deleteNode(ds.nodeId);
      case 'nodePlace': { const { openNodePlaceDialog } = await import('../../../integrations/AccessPoints.js'); return openNodePlaceDialog(ds.nodeId); }
      case 'nodeAccess': { const { nodeAccessEntries, showEntriesMenu } = await import('../../../integrations/AccessPoints.js'); return showEntriesMenu(nodeAccessEntries(ds.nodeId), target); }
      case 'nodeOpen': return game.nightcity?.openNode?.(ds.nodeId);
      case 'nodeInspect': return game.nightcity?.inspectNode?.(ds.nodeId);
      case 'nodeMenu': return this._nodeMenu(ds.nodeId, netId, target);
      case 'nodeFxDel': return this.networkService?.removeNodeEffect(ds.nodeId, ds.kind, ds.fxId, 'GM');
      case 'nodeRunDel': return this.networkService?.clearRun(ds.nodeId, ds.actorId);
      case 'nodeInfClean': return this.networkService?.cleanInfection(ds.nodeId, ds.infId, 'GM');
      case 'nodeInfRecall': return this.networkService?.recallFamily(ds.family, '');
      case 'nodeScene': { const sc = game.scenes?.get(sceneId); if (sc) await sc.view(); return; }
      case 'duplicate': return this._duplicate(netId);
      case 'delete': return this._delete(netId);
      case 'logFor': this._view = 'log'; this._menu = ''; ScopePicker.set(this.scopeId('netlog'), [netId]); return this.app.render();

      // scene
      case 'sceneDead': return this._toggleDead(sceneId);
      case 'sceneNet': return this._toggleSceneNet(sceneId, netId);
      case 'sceneRm': {
        const scene = game.scenes?.get(sceneId); const n = this.networkService?.getNetwork?.(netId);
        if (scene && n) await this.networkService.setSceneNetworkAvailability(scene.id, { [n.id]: false, ...(n.name && (scene.getFlag(MODULE_ID, 'networkAvailability') ?? {})[n.name] ? { [n.name]: false } : {}) });
        return this.app.render();
      }
      // the Atlas
      case 'scMode': this._scMode = ds.mode === 'grid' ? 'grid' : 'atlas'; this._scSel = null; return this.app.render();
      case 'scPaint': {
        const n = this.networkService?.getNetwork?.(netId);
        if (!n) return;
        if (n.availability?.global) { ui.notifications.info(`NCM | ${n.name} reaches every scene. Edit it to put it on chosen scenes instead.`); return; }
        this._scPaint = this._scPaint === n.id ? null : n.id; this._scSel = null;
        if (this._scPaint) this._scPaintRecent = [n.id, ...this._scPaintRecent.filter((x) => x !== n.id)].slice(0, 8);
        return this.app.render();
      }
      case 'scPaintStop': this._scPaint = null; return this.app.render();
      case 'scCard': return this._onSceneCard(ds);
      case 'scClose': this._scSel = null; return this.app.render();
      case 'scShelfPaint': return this._paintShelf(ds.key, this._scPaint);
      case 'scBandNet': return this._paintShelf(ds.key, netId);
      case 'scMore': if (this._scMore.has(ds.key)) this._scMore.delete(ds.key); else this._scMore.add(ds.key); return this.app.render();
      case 'scCell': return this._onGridCell(event, sceneId, netId);
      case 'scImport': return this._importPackScene(ds.uuid);
      case 'scView': { const sc = game.scenes?.get(sceneId); if (sc) await sc.view(); return; }
      case 'scThis': this._sceneId = sceneId || null; ScopePicker.set(this.scopeId('scene'), sceneId ? [sceneId] : []); this._view = 'scene'; this._scSel = null; return this.app.render();
      case 'scPreRm': return this._togglePrewireNet(ds.uuid, netId);
      case 'scPreDead': {
        const cur = sanitizePrewire(this._prewire()[ds.uuid]);
        const next = { ...cur, dead: !cur.dead };
        await this._setPrewire(ds.uuid, (next.nets.length || next.dead) ? next : null);
        return this.app.render();
      }
      case 'hideImported': this._sceneHideImported = !this._sceneHideImported; return this.app.render();
      case 'goScenes': this._view = 'scenes'; return this.app.render();
      case 'broadcast': return this._sendBroadcast();
      // the radio dial (This scene)
      case 'dialPick': this._dialSel = netId || null; return this.app.render();
      case 'dialStart': {
        const scene = game.scenes?.get(sceneId); const n = this.networkService?.getNetwork?.(netId);
        if (!scene || !n) return;
        const cur = scene.getFlag?.(MODULE_ID, 'defaultNetwork') ?? '';
        const isCur = cur && (cur === n.id || cur === n.name);
        await this.networkService?.setSceneDefaultNetwork?.(scene.id, isCur ? '' : n.id);
        return this.app.render();
      }
      case 'dialBcast':
        if (netId) ScopePicker.set(this.scopeId('bcast'), [netId]);
        this._bcastFocus = true;
        return this.app.render();

      // log
      case 'logKind': this._logKind = ds.kind || 'all'; return this.app.render();
      case 'logNet': ScopePicker.set(this.scopeId('netlog'), [ds.networkId]); return this.app.render();
      case 'logClearFilters': ScopePicker.set(this.scopeId('netlog'), []); this._logKind = 'all'; this._logSearch = ''; return this.app.render();
      case 'noteToggle': this._noteOpen = !this._noteOpen; return this.app.render();
      case 'noteAdd': return this._addNote();
      case 'logEdit': return this._editLogEntry(ds.entryId);
      case 'logDelete':
        if (this.accessLogService?.deleteEntry(ds.entryId)) ui.notifications.info('NCM | Log entry deleted.');
        return this.app.render();
      case 'logRef': return this._openLogReference(target);
      case 'logImport': this._menu = ''; return this._importLogs();
      case 'logExport': this._menu = ''; this.app.render(); return this._download(this.accessLogService?.exportLog(), 'json', 'application/json');
      case 'logExportText': this._menu = ''; this.app.render(); return this._download(this.accessLogService?.exportFormatted(), 'txt', 'text/plain');
      case 'logClear': this._menu = ''; return this._clearLogs();
      case 'resetLockouts': this._menu = ''; return this._resetLockouts();
      case 'resetLockout':
        game.nightcity?.securityService?.resetState?.(ds.actorId, ds.targetId);
        ui.notifications.info('NCM | Lockout lifted.');
        return this.app.render();
      default: log.warn(`NetworksTab: unknown op ${op}`);
    }
  }

  // ─── kept for AdminPanelApp's surviving delegators (Overview button, keyboard N) ───
  onOpenManager() { this.app._activeTab = 'networks'; this._view = 'scene'; this.app.render(true); }
  onCreate() { this.app._activeTab = 'networks'; this._startNew(); this.app.render(true); }

  // ═══════════════════════════════════════════════════════════
  //  Editor
  // ═══════════════════════════════════════════════════════════

  _startNew() {
    this._view = 'all'; this._edit = true; this._isNew = true; this._draft = null;
    this._presetKey = 'blank'; this._step = 'identity'; this._editSession++; this._menu = '';
    ScopePicker.set(this.scopeId('recip'), []);
  }

  _startEdit(networkId) {
    const n = networkId && this.networkService?.getNetwork?.(networkId);
    if (!n) return;
    this._view = 'all'; this._selId = n.id; this._edit = true; this._isNew = false; this._draft = null;
    this._step = 'identity'; this._editSession++; this._menu = '';
    ScopePicker.set(this.scopeId('recip'), n.effects?.allowedRecipientNetworks || []);
  }

  _form() { return this.element?.querySelector(`.ncm-net2-form[data-edit-session="${this._editSession}"]`); }

  _usePreset(key) {
    if (!NET2_PRESETS[key]) return;
    const form = this._form();
    const cur = form ? { ...this._readForm(form) } : (this._draft || draftFrom(null));
    this._draft = applyPreset(draftFrom(cur, cur.where), key);
    this._presetKey = key;
    this._editSession++; // the mounted form no longer describes the draft
    this.app.render();
  }

  async _save() {
    const form = this._form();
    if (!form) return;
    const data = this._readForm(form);
    const where = data.where; delete data.where;
    if (!data.name) {
      ui.notifications.warn('NCM | A network needs a name.');
      const nameStep = this.element?.querySelector('[data-net2-step="identity"]'); nameStep?.click();
      return;
    }
    const ns = this.networkService;
    let id = this._isNew ? null : this._selId;
    let result;
    if (this._isNew) {
      result = await ns.createNetwork(data);
      if (result?.success) id = result.network.id;
    } else {
      result = await ns.updateNetwork(id, data);
    }
    if (!result?.success) { ui.notifications.error(`NCM | ${result?.error || 'Could not save the network.'}`); return; }

    // Where: the scenes' own availability flags (the Scenes view's path).
    const net = ns.getNetwork(id) || { id, name: data.name, availability: data.availability };
    const scenes = (game.scenes?.contents ?? []).map(s => ({ id: s.id, avail: s.getFlag(MODULE_ID, 'networkAvailability') ?? {} }));
    for (const { sceneId, patch } of wherePatches(net, where, scenes)) await ns.setSceneNetworkAvailability(sceneId, patch);

    ui.notifications.info(`NCM | Network "${data.name}" ${this._isNew ? 'created' : 'saved'}.`);
    this._selId = id; this._edit = false; this._isNew = false; this._draft = null;
    this.app.render();
  }

  async _pickKeyItem() {
    const items = (game.items?.contents ?? []).filter(isCarrier);
    if (!items.length) { ui.notifications.warn('NCM | No items found in the world.'); return; }
    const pick = await showNamePicker({
      title: 'Pick the key item',
      hint: 'The item a character must carry to get in. Matched by name (and tag, when the item has one).',
      entries: documentEntries(items, { note: (i) => i.type }),
      placeholder: 'search items or folders…',
    });
    const item = pick?.id ? game.items.get(pick.id) : null;
    if (item) this._setKeyItem(item);
  }

  _setKeyItem(item) {
    const form = this._form();
    if (!form) return;
    const set = (n, v) => { const i = form.querySelector(`[name="${n}"]`); if (i) i.value = v; };
    set('keyItemName', item?.name || '');
    set('keyItemImg', item?.img || '');
    set('keyItemTag', item?.system?.tag || '');
    const chip = form.querySelector('[data-key-chip]');
    if (chip) {
      chip.hidden = !item;
      const img = item?.img && !item.img.includes('mystery-man') ? `<img src="${esc(item.img)}" alt="">` : '<i class="fas fa-id-badge"></i>';
      chip.querySelector('[data-key-chip-img]').innerHTML = img;
      chip.querySelector('[data-key-chip-name]').textContent = item?.name || '';
    }
    const allow = form.querySelector('[name="allowKeyItem"]');
    if (item && allow && !allow.checked) { allow.checked = true; allow.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  _browse(field, target) {
    const form = this._form();
    const input = form?.querySelector(`[name="${field}"]`);
    const FP = (typeof FilePicker !== 'undefined') ? FilePicker : foundry.applications?.apps?.FilePicker;
    if (!FP) return;
    new FP({ type: 'image', current: input?.value || '', callback: (path) => {
      if (!input) return;
      input.value = path;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } }).render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Network / scene writes
  // ═══════════════════════════════════════════════════════════

  async _resetAuth(networkId) {
    this._menu = '';
    if (!networkId) return;
    this.networkService?.revokeAuth?.(networkId);
    game.nightcity?.securityService?.resetAllForTarget?.(networkId);
    ui.notifications.info(`NCM | Logins and lockouts reset for ${this.networkService?.getNetwork?.(networkId)?.name || networkId}.`);
    this.app.render();
  }

  async _duplicate(networkId) {
    this._menu = '';
    const n = this.networkService?.getNetwork?.(networkId);
    if (!n) return;
    const copy = foundry.utils.deepClone(n);
    delete copy.id; delete copy.isCore; delete copy.createdAt; delete copy.createdBy;
    copy.name = `${n.name} (copy)`;
    const res = await this.networkService.createNetwork(copy);
    if (!res?.success) { ui.notifications.error(`NCM | ${res?.error || 'Could not duplicate.'}`); return; }
    ui.notifications.info(`NCM | Duplicated as "${copy.name}". It is on no scene yet.`);
    this._startEdit(res.network.id);
    this.app.render();
  }

  async _delete(networkId) {
    this._menu = '';
    const n = this.networkService?.getNetwork?.(networkId);
    if (!n) return;
    if (n.isCore) { ui.notifications.warn('NCM | The core networks can’t be deleted.'); return; }
    const ok = await adminConfirm({ title: 'Delete network', content: `<p>Delete <strong>${esc(n.name)}</strong>? This can’t be undone.</p>` });
    if (!ok) return this.app.render();
    const res = await this.networkService.deleteNetwork(networkId);
    if (res?.success) { ui.notifications.info(`NCM | Network "${n.name}" deleted.`); this._selId = null; this._edit = false; }
    else ui.notifications.error(`NCM | ${res?.error || 'Could not delete.'}`);
    this.app.render();
  }

  async _toggleDead(sceneId) {
    const scene = game.scenes?.get(sceneId);
    if (!scene) return;
    await this.networkService?.toggleDeadZone?.(sceneId, !scene.getFlag(MODULE_ID, 'deadZone'));
    this.app.render();
  }

  async _toggleSceneNet(sceneId, networkId) {
    const scene = game.scenes?.get(sceneId); const n = this.networkService?.getNetwork?.(networkId);
    if (!scene || !n) return;
    if (n.availability?.global) { ui.notifications.info(`NCM | ${n.name} is everywhere. Edit it to put it on chosen scenes instead.`); return; }
    const on = this._sceneState(scene, n) === true;
    const patch = { [n.id]: !on };
    if (on && n.name && (scene.getFlag(MODULE_ID, 'networkAvailability') ?? {})[n.name]) patch[n.name] = false;
    await this.networkService.setSceneNetworkAvailability(scene.id, patch);
    this.app.render();
  }

  /** Make exactly `ids` the non-global networks on `scene`. */
  async _setSceneNets(scene, ids) {
    if (!scene) return;
    const want = new Set(ids || []);
    const patch = {};
    for (const n of this.networkService?.getAllNetworks?.() ?? []) {
      if (n.availability?.global) continue;
      const on = this._sceneState(scene, n) === true;
      if (on !== want.has(n.id)) patch[n.id] = want.has(n.id);
      if (!want.has(n.id) && n.name && (scene.getFlag(MODULE_ID, 'networkAvailability') ?? {})[n.name]) patch[n.name] = false;
    }
    if (Object.keys(patch).length) await this.networkService.setSceneNetworkAvailability(scene.id, patch);
  }

  /** Put one network on, or take it off, one scene (clears a legacy name key on the way off). */
  async _setSceneNet(scene, n, on) {
    if (!scene || !n || n.availability?.global) return;
    if ((this._sceneState(scene, n) === true) === on) return;
    const patch = { [n.id]: on };
    if (!on && n.name && (scene.getFlag(MODULE_ID, 'networkAvailability') ?? {})[n.name]) patch[n.name] = false;
    await this.networkService.setSceneNetworkAvailability(scene.id, patch);
  }

  /** A card click: while painting it toggles the painted network; otherwise it picks the card for the inspector. */
  async _onSceneCard(ds) {
    const uuid = ds.uuid || '';
    if (this._scPaint) {
      if (uuid) return this._togglePrewireNet(uuid, this._scPaint);
      return this._toggleSceneNet(ds.sceneId, this._scPaint);
    }
    const key = uuid || ds.sceneId || null;
    this._scSel = this._scSel === key ? null : key;
    return this.app.render();
  }

  /** "Wire all" on a shelf head (Paint) or a Grid band tally: the whole shelf on, or — when it already is — off. */
  async _paintShelf(key, netId) {
    const n = this.networkService?.getNetwork?.(netId);
    const ids = this._scShelfIds?.get(key) || [];
    if (!n || !ids.length) return;
    if (n.availability?.global) { ui.notifications.info(`NCM | ${n.name} reaches every scene.`); return; }
    const pa = shelfPaint(ids.map((id) => this._scAll?.get(id)).filter(Boolean), n.id);
    for (const id of pa.ids) await this._setSceneNet(game.scenes?.get(id), n, pa.on);
    if (pa.ids.length) ui.notifications.info(`NCM | ${n.name} ${pa.on ? 'added to' : 'taken off'} ${pa.ids.length} scene${pa.ids.length === 1 ? '' : 's'}.`);
    this.app.render();
  }

  /** A Grid cell. Shift-click with the same network applies the clicked cell's new state to the whole range. */
  async _onGridCell(event, sceneId, netId) {
    const n = this.networkService?.getNetwork?.(netId);
    const r = this._scAll?.get(sceneId);
    if (!n || !r) return;
    if (n.availability?.global) { ui.notifications.info(`NCM | ${n.name} reaches every scene.`); return; }
    const want = !r.nets.includes(n.id);
    const ids = (event?.shiftKey && this._scLast?.net === n.id) ? rangeIds(this._scGridOrder || [], this._scLast.id, sceneId) : [sceneId];
    for (const id of ids) await this._setSceneNet(game.scenes?.get(id), n, want);
    this._scLast = { id: sceneId, net: n.id };
    this.app.render();
  }

  /** Toggle one network on a pack scene's pre-wiring. */
  async _togglePrewireNet(uuid, netId) {
    if (!uuid || !netId) return;
    await this._setPrewire(uuid, togglePrewire(this._prewire()[uuid], netId));
    this.app.render();
  }

  /** Import a pack scene into the world — the createScene hook applies its pre-wiring. */
  async _importPackScene(uuid) {
    const at = uuid ? uuid.lastIndexOf('.Scene.') : -1;
    if (at < 0) return;
    const pack = game.packs?.get?.(uuid.slice('Compendium.'.length, at));
    const id = uuid.slice(at + '.Scene.'.length);
    if (!pack) { ui.notifications.warn('NCM | That compendium is not available.'); return; }
    try {
      const doc = await game.scenes.importFromCompendium(pack, id);
      if (doc) { ui.notifications.info(`NCM | ${doc.name} imported${this._prewire()[uuid] ? ' with its networks' : ''}.`); this._scSel = doc.id; }
    } catch (e) { log.warn('Scenes: import failed', e); ui.notifications.error(`NCM | Could not import that scene: ${e.message}`); }
    this.app.render();
  }

  /** Broadcast — everyone online, everyone on a scene, or everyone on one network. GMs always get a copy. */
  async _sendBroadcast() {
    const input = this.element?.querySelector('[data-net2-bcast]');
    const message = input?.value?.trim();
    if (!message) { ui.notifications.warn('NCM | Type a message to broadcast.'); return; }
    const to = ScopePicker.value(this.scopeId('bcast'))[0] || 'all';
    const scene = this._scene();
    const gms = game.users.filter(u => u.active && u.isGM).map(u => u.id);
    let players, label, networkId = 'all';
    if (to === 'all') { players = game.users.filter(u => u.active && !u.isGM); label = 'ALL NETWORKS'; }
    else if (to === 'scene') { players = game.users.filter(u => u.active && !u.isGM && u.viewedScene === scene?.id); label = scene?.name || 'THIS SCENE'; }
    else {
      const map = game.nightcity?.playerNetworks;
      players = game.users.filter(u => u.active && !u.isGM && map?.get?.(u.id)?.networkId === to);
      label = this.networkService?.getNetwork?.(to)?.name || to; networkId = to;
    }
    // Never an empty list — Foundry reads `whisper: []` as PUBLIC.
    const whisper = [...new Set([...players.map(u => u.id), ...gms, game.user.id])];
    const content = await renderTemplate(`modules/${MODULE_ID}/templates/chat/network-broadcast.hbs`, {
      networkName: label, message: foundry.utils.encodeHTML ? foundry.utils.encodeHTML(message) : esc(message), when: chatCardTime(),
    });
    await ChatMessage.create({ content, whisper, speaker: { alias: `NCM // ${label}` } });
    this.accessLogService?.addManualEntry({ networkId, networkName: label, actorName: 'SYSTEM', type: 'system', message: `Broadcast: ${message}` });
    if (input) input.value = '';
    this._bcastText = '';
    if (to !== 'all' && !players.length) ui.notifications.warn(`NCM | No player is on ${label} right now — only the GMs got it.`);
    else ui.notifications.info(`NCM | Broadcast sent to ${players.length} player${players.length === 1 ? '' : 's'}.`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Log
  // ═══════════════════════════════════════════════════════════

  _addNote() {
    const row = this.element?.querySelector('[data-net2-note]');
    const message = row?.querySelector('[name="noteMessage"]')?.value?.trim();
    if (!message) { ui.notifications.warn('NCM | The note needs some text.'); return; }
    const networkId = ScopePicker.value(this.scopeId('notenet'))[0] || 'unknown';
    const net = this.networkService?.getNetwork?.(networkId);
    this.accessLogService?.addManualEntry({
      networkId, networkName: net?.name ?? networkId,
      actorName: row.querySelector('[name="noteActor"]')?.value?.trim() || 'Unknown',
      type: row.querySelector('[name="noteType"]')?.value || 'manual', message,
    });
    this._note = { actor: '', type: this._note.type, message: '' };
    const msg = row.querySelector('[name="noteMessage"]'); if (msg) msg.value = '';
    ui.notifications.info('NCM | Note added to the log.');
    this.app.render();
  }

  _editLogEntry(entryId) {
    const entry = (this.accessLogService?._entries ?? []).find(e => e.id === entryId);
    if (!entry) return;
    adminDialog({
      title: 'Edit log entry',
      content: `<form class="ncm-net2-dlg">
          <label>Message<input type="text" name="message" value="${esc(entry.message ?? '')}"></label>
          <label>Who<input type="text" name="actorName" value="${esc(entry.actorName ?? '')}"></label>
        </form>`,
      buttons: {
        save: { icon: '<i class="fas fa-check"></i>', label: 'Save', callback: (html) => {
          this.accessLogService?.updateEntry(entryId, { message: html.find('[name="message"]').val(), actorName: html.find('[name="actorName"]').val() });
          this.app.render();
        } },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'save',
    }).render(true);
  }

  _openLogReference(target) {
    const el = target.closest('[data-link-type]') ?? target;
    const { linkType, messageId, actorId, itemId } = el.dataset;
    if (linkType === 'message' && messageId && actorId) game.nightcity?.messenger?.openInbox?.(actorId, { messageId });
    else if (linkType === 'shard' && itemId) {
      const item = this.app.constructor._findItem?.(itemId)
        ?? game.items?.get(itemId) ?? Array.from(game.actors ?? []).reduce((f, a) => f ?? a.items?.get(itemId), null);
      if (item) game.nightcity?.messenger?.forceOpenDataShard?.(item);
      else ui.notifications.warn('NCM | Could not find that data shard.');
    }
  }

  _download(text, ext, type) {
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url; a.download = `ncm-network-log-${Date.now()}.${ext}`; a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`NCM | Network log exported (${ext}).`);
  }

  _importLogs() {
    this.app.render();
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const res = this.accessLogService?.importLog(await file.text());
        if (res?.success) { ui.notifications.info(`NCM | Imported ${res.imported} log entries.`); this.app.render(); }
        else ui.notifications.error(`NCM | Import failed: ${res?.error ?? 'unknown error'}`);
      } catch (err) { ui.notifications.error(`NCM | Import failed: ${err.message}`); }
    });
    input.click();
  }

  async _clearLogs() {
    const ok = await adminConfirm({ title: 'Clear the network log', content: '<p>Clear every network log entry? This can’t be undone.</p>' });
    if (ok) { this.accessLogService?.clearLog(); ui.notifications.info('NCM | Network log cleared.'); }
    this.app.render();
  }

  async _resetLockouts() {
    const sec = game.nightcity?.securityService;
    const list = sec?.getActiveLockouts?.() ?? [];
    if (!list.length) { ui.notifications.info('NCM | Nobody is locked out.'); return this.app.render(); }
    const ok = await adminConfirm({ title: 'Reset lockouts', content: `<p>Lift all ${list.length} active lockout${list.length === 1 ? '' : 's'}?</p>` });
    if (ok) { for (const l of list) sec.resetState(l.actorId, l.targetId); ui.notifications.info('NCM | Lockouts lifted.'); }
    this.app.render();
  }

  /** The Atlas' DOM-only bits: shelf folds, the Show / Sort selects, the transmitter hover preview, keyboard, Esc. */
  _wireAtlas(el) {
    el.querySelectorAll('select[data-net2-sc]').forEach((sel) => sel.addEventListener('change', () => {
      if (sel.dataset.net2Sc === 'show') this._scShow = sel.value;
      if (sel.dataset.net2Sc === 'sort') this._scSort = sel.value;
      this.app.render();
    }));
    el.querySelectorAll('select[data-net2-prestart]').forEach((sel) => sel.addEventListener('change', async () => {
      const uuid = sel.dataset.uuid; const cur = sanitizePrewire(this._prewire()[uuid]);
      await this._setPrewire(uuid, { ...cur, start: sel.value || '' });
      this.app.render();
    }));
    // folds: the GM's choice wins for the session (scenesAtlas.shelfShut)
    const fold = (h) => {
      const box = h.closest('[data-sc-shelf]'); if (!box) return;
      const k = box.dataset.scShelf, shut = !box.classList.contains('is-shut');
      box.classList.toggle('is-shut', shut); h.setAttribute('aria-expanded', String(!shut));
      if (shut) { this._scShut.add(k); this._scOpen.delete(k); } else { this._scOpen.add(k); this._scShut.delete(k); }
      if (this._scMode === 'grid') this._scGridOrder = [...el.querySelectorAll('[data-sc-shelf]:not(.is-shut) tr[data-scene-id]')].map((tr) => tr.dataset.sceneId);
    };
    el.querySelectorAll('[data-sc-fold]').forEach((h) => {
      h.addEventListener('click', (e) => { if (e.target.closest('[data-action]')) return; fold(h); });
      h.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === h) { e.preventDefault(); fold(h); } });
    });
    el.querySelectorAll('.ncm-net2-atcard[role="button"]').forEach((c) => c.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === c) { e.preventDefault(); c.click(); }
    }));
    // hovering a transmitter previews its reach (DOM only)
    const body = el.querySelector('.ncm-net2-atbody');
    el.querySelectorAll('[data-sc-tx]').forEach((t) => {
      const id = t.dataset.scTx;
      t.addEventListener('mouseenter', () => {
        if (!body || this._scPaint) return;
        body.classList.add('is-preview'); body.style.setProperty('--pc', t.style.getPropertyValue('--c'));
        body.querySelectorAll('.ncm-net2-atcard').forEach((c) => c.classList.toggle('is-beam', (c.dataset.nets || '').split(' ').includes(id)));
      });
      t.addEventListener('mouseleave', () => {
        if (!body || this._scPaint) return;
        body.classList.remove('is-preview');
        body.querySelectorAll('.is-beam').forEach((c) => c.classList.remove('is-beam'));
      });
    });
    // Esc stops painting (one document listener; containment: only while this panel is on screen and painting)
    if (!this._scKeys && typeof document !== 'undefined') {
      this._scKeys = (e) => {
        if (e.key !== 'Escape' || !this._scPaint || this._view !== 'scenes') return;
        if (!this.app?.element?.isConnected) return;
        e.preventDefault(); e.stopPropagation(); this._scPaint = null; this.app.render();
      };
      document.addEventListener('keydown', this._scKeys, true);
    }
  }

  onClose() {
    for (const k of Object.keys(this._scroll)) delete this._scroll[k];
    if (this._scKeys) { document.removeEventListener('keydown', this._scKeys, true); this._scKeys = null; }
    this._dockObs?.disconnect(); this._dockObs = null;
  }
}
