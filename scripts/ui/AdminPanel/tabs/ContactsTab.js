/**
 * ContactsTab — Admin → Contacts (redesign 2026-10-27).
 * @file scripts/ui/AdminPanel/tabs/ContactsTab.js
 * @module night-city-messenger
 *
 * Four views, organized by the question the GM is asking:
 *   DIRECTORY       the NPCs — list + detail, aliases nested under their main;
 *                   Edit turns the detail pane into the full contact form.
 *   PLAYERS         each player character: address, who they know, groups, identities.
 *   GROUPS          the GM's contact groups: members, who they are pushed to.
 *   WHO KNOWS WHOM  contacts × characters; one click shares or takes back.
 *
 * The GM Contact Manager window is folded in here (its app is deleted) — every
 * write goes through the same MasterContactService / ContactRepository /
 * ContactGroupService calls it used. Rules live in contactsModel.js (pure).
 *
 * Buttons use the generic `data-action="tabAct" data-op="…"` (root carries
 * data-owner="contacts"); the legacy onXyz methods stay for AdminPanelApp's
 * existing static delegators and keyboard shortcuts.
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log, getPlayerCharacters } from '../../../utils/helpers.js';
import { MessageRepository } from '../../../data/MessageRepository.js';
import { BaseTab } from '../BaseTab.js';
import { adminDialog, adminConfirm, adminPrompt } from '../../../utils/adminTheme.js';
import { THEMED_DIALOG_CLASSES } from '../../../utils/dialogBody.js';
import { playerEditHtml, aliasDialogHtml, looksLikeAddress } from '../../../utils/personDialogs.js';
import { editGroupDialog } from '../../ContactGroups/GroupEditorDialog.js';
import { memberFromMasterContact, memberFromActor } from '../../../services/ContactGroupService.js';
import { memberKey } from '../../../utils/participants.js';
import { showNamePicker, documentEntries } from '../../../utils/namePicker.js';
import { identityRole, identitiesOfContact, identitiesOf, identityUsage, groupKeyOf, voiceInfo } from '../../../utils/identities.js';
import { getRoleIcon, getInitials } from '../../../utils/designHelpers.js';
import { BUILT_IN_ROLES, RELATIONSHIP_TYPES } from '../../../utils/contactVocab.js';
import { ScopePicker } from '../../../utils/scopePicker.js';
import { tagHue } from '../../../utils/tagHue.js';
import {
  TRUST_LEVELS, trustInfo, EDIT_SECTIONS, sectionOfField, DIR_FILTERS, MX_FILTERS,
  lc, isAutoAdded, knowIndex, playerEntryMatches, needsALook, haystack, passesFilter, pluralRole, buildDirectory, passesFacets, facetKey, foldShut, foldBadges, readFoldChoices,
  rangeIds, tally, mxPasses, KN_RINGS, knRing, knPasses, knownModules, ghState, groupRack, ghDiff, npcSwitchboard, sbAge,
  PLAYER_FILTERS, PLAYER_SORTS, PLAYER_GROUPS, passesPlayerFilter, sortPlayers, groupPlayers, playerHaystack,
  GROUP_FILTERS, GROUP_SORTS, passesGroupFilter, sortGroups, groupHaystack, groupSig, foldTail, GROUPS_RAIL_LIMIT,
} from './contactsModel.js';
import { buildMapContext, shareWithEveryone, wireContactsMap } from './contactsMap.js';

const FLAG = MODULE_ID;
const MYSTERY = 'mystery-man';
const okImg = (img) => (img && !String(img).includes(MYSTERY) ? img : '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NON_PERSON = new Set(['blackIce', 'black-ice', 'demon', 'container']);
const isIceActor = (a) => a && (a.type === 'blackIce' || a.type === 'black-ice' || a.getFlag?.(FLAG, 'isBlackICE') || /black\s*ice/i.test(a.name || ''));
const SKILLS = ['Interface', 'Electronics/Security Tech', 'Cryptography', 'Basic Tech', 'Library Search'];
const GROUP_BY = [['role', 'Role'], ['org', 'Organization'], ['trust', 'Trust'], ['folder', 'Folder'], ['none', 'None']];

export class ContactsTab extends BaseTab {

  /** The Voice box's prompt when the contact (and its main identity) has none. */
  static VOICE_PLACEHOLDER = 'How they talk — short, never apologises, calls everyone kid…';

  // ═══════════════════════════════════════════════════════════
  //  State
  // ═══════════════════════════════════════════════════════════

  _view = 'directory';
  _mxMode = 'map';          // Who knows whom: 'map' (the net map, default) | 'table' (the matrix)
  _mapSel = null;           // the map's picked character / contact id
  _mapHi = '';              // the map's highlight chip
  _mapPanelFor = null;      // which pick the info panel last showed (slide in only on change)
  // Directory → an NPC → the switchboard (who's writing to them): picked correspondent, Write-as pick, identity filter, fold.
  _sbSel = null;
  _sbAs = null;
  _sbIdent = 'all';
  _sbFor = null;
  // Inner tabs of a detail pane: Directory → an NPC ('main' | 'corr'), Players → a character ('main' | 'glance').
  // Reset to the main tab when another contact / character is opened.
  _dTab = 'main';
  _dTabFor = null;
  _pTab = 'main';
  _pTabFor = null;
  _newOpen = false;
  _moreOpen = false;
  _search = '';
  _filter = 'all';
  _facets = [];             // Directory → Filter picks (role:/org:/trust:), see contactsModel.passesFacets
  /** Directory groups the GM folded or opened by hand, keyed `<groupBy>:<label>` → true (shut) | false (open).
   *  Remembered per viewer (localStorage `ncm.ct2.dirFolds`; the older `ncm.ct2.dirShut` array of shut
   *  keys is read once as shut choices). A group with no choice follows the default: first open, rest shut. */
  _dirFold = (() => {
    try {
      const now = localStorage.getItem('ncm.ct2.dirFolds');
      if (now) return readFoldChoices(JSON.parse(now));
      return readFoldChoices(JSON.parse(localStorage.getItem('ncm.ct2.dirShut') || '[]'));
    } catch { return new Map(); }
  })();
  _saveDirFold() { try { localStorage.setItem('ncm.ct2.dirFolds', JSON.stringify(Object.fromEntries(this._dirFold))); } catch { /* private mode */ } }
  _dirSelSeen = undefined;  // the selection the Directory last opened a group for
  _dirSelKey = null;        // the group opened for it (stays open until the GM folds it)
  _groupBy = null;          // lazy from the client setting `contactsGroupBy`
  _sort = 'name';
  _selId = null;
  _editing = false;
  _creating = false;
  _draft = null;            // { field: value } — the edit form's working copy
  _dirty = new Set();       // edit sections with unsaved changes
  _guardTo = null;          // a row clicked while the form had unsaved edits
  _edSec = 'identity';
  _pSel = null;
  _knBy = 'role';            // Players → Who they know: role | org | az
  _knFold = new Map();      // folds the GM chose there, key → true shut | false open (DOM-only, this session)
  _knSolo = { actor: null, key: null }; // the jump chip that narrows Who they know to ONE group (DOM-only; cleared on another character)
  _knRing = null;           // Who they know → Orbit: the ring picked (0 this week … 3 never written)
  _knRoles = new Set();     // Who they know → Role equaliser: the roles picked
  _knSel = null;            // Who they know → the contact on the card
  _pGroupPeek = null;       // a player's own group whose members are showing
  _ghF = 'all';             // Groups they hold → rack filter chip
  _ghSel = null;            // Groups they hold → the tile whose tray is open ('m:<masterId>' for a push tile)
  _ghShut = false;          // Groups they hold → the rack folded (one choice, this session)
  _knNavShut = false;       // Who they know → the contact list module folded
  _gSel = null;
  // Players toolbar (2026-10-28): search · Show · Group · Sort, plus the folds of a grouped list
  // (remembered per viewer, localStorage `ncm.ct2.playerFolds`; same default rule as the Directory).
  _pSearch = '';
  _pShow = 'all';
  _pGroup = 'none';
  _pSort = 'name';
  _pFold = (() => { try { return readFoldChoices(JSON.parse(localStorage.getItem('ncm.ct2.playerFolds') || '{}')); } catch { return new Map(); } })();
  _savePlayerFold() { try { localStorage.setItem('ncm.ct2.playerFolds', JSON.stringify(Object.fromEntries(this._pFold))); } catch { /* private mode */ } }
  _pSelSeen = undefined;    // the character the Players list last opened a group for
  _pSelKey = null;          // the group opened for it
  _pGroupKeys = [];         // the keys of the groups last shown (Collapse / Expand all)
  // Groups toolbar: search · Show · Sort; past GROUPS_RAIL_LIMIT the rest fold behind "+N more".
  _gSearch = '';
  _gShow = 'all';
  _gSort = 'name';
  _gMore = false;
  _mxFilter = 'all';
  _mxSearch = '';
  _mxGroupBy = 'role';
  _mxOpen = new Set();
  _mxChanges = [];          // [{cid, aid, on}] this session — Undo walks it back
  _mxLast = null;           // last clicked cell, for shift ranges
  _scroll = {};
  _focus = null;
  _searchTimer = null;
  _busy = false;

  get key() { return 'contacts'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const all = this.masterContactService?.getAll?.() ?? [];
    const out = { contactSummary: { total: all.length, burned: 0 } };
    if (this.app._activeTab !== 'contacts') return out;
    try {
      out.ct2 = this._buildContext(all);
    } catch (err) {
      console.error(`${MODULE_ID} | ContactsTab context`, err);
      out.ct2 = { error: String(err?.message || err) };
    }
    return out;
  }

  onRender() {
    const root = this.element?.querySelector('.ncm-ct2');
    if (!root) return;
    // Scroll memo: every [data-ct2-scroll] box keeps its place across re-renders.
    for (const box of root.querySelectorAll('[data-ct2-scroll]')) {
      const k = box.dataset.ct2Scroll;
      if (this._scroll[k] != null) box.scrollTop = this._scroll[k];
      box.addEventListener('scroll', () => { this._scroll[k] = box.scrollTop; }, { passive: true });
    }
    // Search boxes (directory · players · groups · matrix): debounced, focus + caret kept.
    for (const inp of root.querySelectorAll('[data-ct2-q]')) {
      inp.addEventListener('input', () => {
        const which = inp.dataset.ct2Q;
        if (which === 'dir') this._search = inp.value;
        else if (which === 'players') this._pSearch = inp.value;
        else if (which === 'groups') this._gSearch = inp.value;
        else this._mxSearch = inp.value;
        this._focus = { sel: `[data-ct2-q="${which}"]`, caret: inp.selectionStart };
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this.render(true), 220);
      });
    }
    if (this._focus) {
      const f = root.querySelector(this._focus.sel);
      if (f) { f.focus(); try { f.setSelectionRange(this._focus.caret, this._focus.caret); } catch { /* not a text box */ } }
      this._focus = null;
    }
    // Short-enum selects (data-action on a <select> fires on click, not change).
    for (const sel of root.querySelectorAll('[data-ct2-select]')) {
      sel.addEventListener('change', () => this._onSelect(sel.dataset.ct2Select, sel.value));
    }
    // Players → Who they know: search filters the live list, folds are DOM-only.
    const kn = root.querySelector('.ncm-ct2-kn');
    if (kn) this._wireKnown(kn);
    this._wireFolds(root);
    wireContactsMap(root);
    // GM notes + Voice in the detail pane autosave on blur.
    const notes = root.querySelector('[data-ct2-notes]');
    if (notes) notes.addEventListener('blur', () => this._saveNotes(notes.dataset.ct2Notes, notes.value));
    const voice = root.querySelector('[data-ct2-voice]');
    if (voice) voice.addEventListener('blur', () => this._saveVoice(voice.dataset.ct2Voice, voice.value));
    // The edit form: every field writes the draft; DOM-only, never a render.
    const body = root.querySelector('.ncm-ct2-edbody');
    if (body) this._wireEditor(root, body);
    // The New menu closes on an outside click.
    if (this._newOpen || this._moreOpen) {
      const close = (e) => {
        if (e.target.closest?.('.ncm-ct2-menu, [data-op="newMenu"], [data-op="more"]')) return;
        document.removeEventListener('click', close, true);
        if (this._newOpen || this._moreOpen) { this._newOpen = false; this._moreOpen = false; this.render(true); }
      };
      setTimeout(() => document.addEventListener('click', close, true), 0);
    }
    ScopePicker.after();
  }

  /** Open on one row. A contact id → the directory on it; or { create:'blank'|'actor', actorId } / { view, actorId }. */
  openTo(select) {
    if (!select) return;
    if (typeof select === 'string') {
      this._view = 'directory';
      this._selectContact(select, { force: true });
      return;
    }
    if (select.create === 'actor' && select.actorId) return this.startCreateFromActor(select.actorId, { render: false });
    if (select.create) return this._startCreate(null, { render: false });
    if (select.edit) {
      // Pop out mid-edit: the unsaved draft moves into the bigger window.
      const e = select.edit;
      this._view = 'directory';
      this._selId = e.id || null;
      this._creating = !!e.creating; this._editing = !e.creating;
      this._draft = { ...(e.draft || {}) }; this._dirty = new Set(e.dirty || []);
      this._edSec = e.sec || 'identity'; this._jumpTo = e.sec || null; this._guardTo = null;
      return;
    }
    if (select.view) this._view = select.view;
    if (select.actorId) this._pSel = select.actorId;
    if (select.groupId) this._gSel = select.groupId;
    if (select.contactId) this._selectContact(select.contactId, { force: true });
  }

  // ═══════════════════════════════════════════════════════════
  //  World reads
  // ═══════════════════════════════════════════════════════════

  /** Player characters with their owner's colour and their own contact list. */
  _pcs() {
    return getPlayerCharacters().map((pc) => {
      const actor = pc.actor || game.actors?.get(pc.actorId);
      const user = (game.users ?? []).find((u) => !u.isGM && u.character?.id === pc.actorId)
        || (game.users ?? []).find((u) => !u.isGM && actor?.testUserPermission?.(u, 'OWNER'));
      const color = user?.color?.css || (user?.color ? String(user.color) : '') || 'var(--ncm-secondary)';
      let list = [];
      try { list = actor?.getFlag?.(FLAG, 'contacts') ?? []; } catch { list = []; }
      // Where the player is right now (the Overview's rule): online = the user is connected; the
      // scene is the one that user is LOOKING at, only while online.
      const online = !!user?.active;
      const sceneId = online ? (user?.viewedScene || '') : '';
      const scene = sceneId ? game.scenes?.get?.(sceneId) : null;
      return {
        actorId: pc.actorId, name: pc.actorName, player: pc.playerName || '', actor, color,
        img: okImg(actor?.img), initials: getInitials(pc.actorName), list: Array.isArray(list) ? list : [],
        email: actor?.getFlag?.(FLAG, 'email') || '',
        online, sceneId: scene ? scene.id : '', sceneName: scene?.name || '',
      };
    });
  }

  /** Is this contact a player's character (linked to a player-owned actor)? Those live in the Players view. */
  _isPcContact(c) {
    return !!(c?.actorId && game.actors?.get(c.actorId)?.hasPlayerOwner);
  }

  _portraitOf(all, c) {
    if (!c) return '';
    if (c.portrait) return c.portrait;
    if (identityRole(all, c)?.isAlias) return '';   // an alias never borrows its character's face
    return okImg(c.actorId ? game.actors?.get(c.actorId)?.img : '');
  }

  _roleLabel(role) {
    const key = lc(role);
    if (!key) return '';
    const custom = (this.masterContactService?.getCustomRoles?.() || []).find((r) => lc(r.id) === key || lc(r.label) === key);
    return BUILT_IN_ROLES[key]?.label || custom?.label || (key.charAt(0).toUpperCase() + key.slice(1));
  }

  /** Every role a form can pick: built-ins then the GM's custom roles. */
  _roleTable() {
    const out = Object.entries(BUILT_IN_ROLES).map(([id, r]) => ({ id, label: r.label, icon: `fas fa-${r.icon}` }));
    for (const cr of this.masterContactService?.getCustomRoles?.() || []) {
      if (out.some((r) => r.id === cr.id)) continue;
      out.push({ id: cr.id, label: cr.label, icon: getRoleIcon(cr.id) });
    }
    return out;
  }

  /**
   * One pass over every NPC inbox: per contact, player mail waiting (unread,
   * from a player's character), the newest waiting page (Reply as), and the
   * last mail either way. Cached for a second — a render touches it many times.
   */
  _mail(all) {
    const now = Date.now();
    if (this._mailCache && now - this._mailCache.at < 1000) return this._mailCache;
    const byContact = new Map();
    const byActor = new Map();
    const touch = (id) => { if (!byContact.has(id)) byContact.set(id, { waiting: 0, latest: null, lastTs: '', lastWho: '', recent: [] }); return byContact.get(id); };
    for (const j of game.journal ?? []) {
      const box = MessageRepository.identifyInbox(j);
      if (!box) continue;
      const ownerActor = box.isContact ? null : game.actors?.get(box.ownerId);
      if (ownerActor?.hasPlayerOwner) {
        let unread = 0, lastTs = '';
        for (const p of j.pages ?? []) {
          const f = p.flags?.[FLAG] || {};
          if (!f.messageId || f.status?.deleted) continue;
          if (!f.status?.read && !String(f.messageId).endsWith('-sent') && !f.status?.sent) unread++;
          if (f.timestamp && f.timestamp > lastTs) lastTs = f.timestamp;
        }
        byActor.set(box.ownerId, { unread, lastTs });
        continue;
      }
      const ids = box.isContact
        ? identitiesOfContact(all, all.find((c) => c.id === box.ownerId))
        : identitiesOf(all, box.ownerId);
      if (!ids.length) continue;
      for (const p of j.pages ?? []) {
        const f = p.flags?.[FLAG] || {};
        if (!f.messageId || f.status?.deleted) continue;
        const sent = !!f.status?.sent || String(f.messageId).endsWith('-sent');
        const named = sent ? f.fromContactId : f.toContactId;
        const who = ids.find((c) => c.id === named) || ids[0];
        const row = touch(who.id);
        const fromActor = f.fromActorId ? game.actors?.get(f.fromActorId) : null;
        const ts = f.timestamp || '';
        const counter = sent ? (f.toName || f.to || '?') : (fromActor?.name || f.from || '?');
        if (ts > row.lastTs) { row.lastTs = ts; row.lastWho = counter; }
        row.recent.push({ ts, sent, subject: f.subject || p.name || '(no subject)', who: counter, messageId: f.messageId, inboxId: box.ownerId,
          withActor: sent ? (f.toActorId || '') : (f.fromActorId || ''), unread: !sent && !f.status?.read && !f.status?.spam,
          // the switchboard reads these: which identity, the page to reply to, the other side's address
          ident: who.id, journalId: j.id, pageId: p.id, spam: !!f.status?.spam, withEmail: sent ? (f.to || '') : (f.from || '') });
        if (!sent && !f.status?.spam && !f.status?.read && fromActor?.hasPlayerOwner) {
          row.waiting++;
          if (!row.latest || ts > row.latest.ts) row.latest = { ts, journalId: j.id, pageId: p.id, inboxId: box.ownerId, isContact: !!box.isContact };
        }
      }
    }
    for (const r of byContact.values()) r.recent.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    this._mailCache = { at: now, byContact, byActor };
    return this._mailCache;
  }

  // ═══════════════════════════════════════════════════════════
  //  Context
  // ═══════════════════════════════════════════════════════════

  _buildContext(all) {
    if (this._groupBy === null) {
      try { this._groupBy = game.settings.get(MODULE_ID, 'contactsGroupBy') || 'role'; } catch { this._groupBy = 'role'; }
      if (!GROUP_BY.some(([k]) => k === this._groupBy)) this._groupBy = 'role';
    }
    const pcs = this._pcs();
    const lists = Object.fromEntries(pcs.map((p) => [p.actorId, p.list]));
    const kx = knowIndex(lists, { contacts: all });
    const mail = this._mail(all);
    const npcs = all.filter((c) => !this._isPcContact(c));
    const actorsWithMail = (game.actors?.contents ?? [])
      .filter((a) => !NON_PERSON.has(a.type))
      .map((a) => ({ id: a.id, name: a.name, email: a.getFlag?.(FLAG, 'email') || '' }))
      .filter((a) => a.email);
    const facts = new Map(all.map((c) => [c.id, {
      mail: mail.byContact.get(c.id)?.waiting || 0,
      knownBy: pcs.filter((p) => kx.knows(c, p.actorId)).length,
      knowers: pcs.filter((p) => kx.knows(c, p.actorId)),
      ice: !!c.encrypted, sys: !!c.sendOnly,
      alias: !!identityRole(all, c),
      issues: needsALook(c, all, actorsWithMail),
    }]));
    for (const f of facts.values()) f.check = f.issues.length > 0;
    const groups = this.app ? (game.nightcity?.contactGroupService?.getMasterGroups?.() ?? []) : [];

    const ctx = {
      view: this._view,
      isDirectory: this._view === 'directory',
      isPlayers: this._view === 'players',
      isGroups: this._view === 'groups',
      isMatrix: this._view === 'matrix',
      isPopout: this.isPopout,
      newOpen: this._newOpen,
      nav: [
        ['directory', 'fa-address-book', 'Directory', npcs.filter((c) => !identityRole(all, c)?.isAlias).length],
        ['players', 'fa-user', 'Players', pcs.length],
        ['groups', 'fa-users', 'Groups', groups.length],
        ['matrix', 'fa-table-cells', 'Who knows whom', 0],
      ].map(([key, icon, label, count]) => ({ key, icon, label, count, on: key === this._view })),
    };
    ctx.sendAsPicker = npcs.length ? this._sendAsPickerHtml(all, npcs, mail) : '';
    if (ctx.isDirectory) ctx.dir = this._directoryContext(all, npcs, pcs, kx, mail, facts);
    if (ctx.isPlayers) ctx.players = this._playersContext(all, pcs, kx, mail, groups);
    if (ctx.isGroups) ctx.groups = this._groupsContext(all, pcs, groups);
    if (ctx.isMatrix) {
      ctx.mxMap = this._mxMode === 'map' ? buildMapContext(this, { all, npcs, pcs, kx, mail, groups }) : { on: false };
      ctx.mx = this._matrixContext(all, npcs, pcs, kx);   // the Table (and the sims) read it in both modes
    }
    return ctx;
  }

  _rowOf(all, c, alias, facts) {
    const f = facts.get(c.id) || { knowers: [], issues: [] };
    const img = this._portraitOf(all, c);
    return {
      id: c.id, name: c.name || '(unnamed)', alias,
      subline: alias ? `alias · ${c.email || 'no address'}` : [c.organization, c.email].filter(Boolean).join(' · '),
      // Line 2 in colour: the role's icon + the organization each in their own hue, then the address.
      role: !alias && c.role ? { icon: getRoleIcon(c.role), hue: `role:${c.role}`, label: this._roleLabel(c.role) } : null,
      org: alias ? '' : (c.organization || '').trim(), email: c.email || '',
      img, initials: getInitials(c.name), sys: !!c.sendOnly && !img, ice: !!c.encrypted,
      mail: f.mail || 0, check: !!f.check, sel: c.id === this._selId,
      knows: f.knowers.map((p) => ({ color: p.color, name: p.name })),
      knowsTitle: f.knowers.length ? `Known by ${f.knowers.map((p) => p.name).join(', ')}` : 'No player knows them',
    };
  }

  /**
   * Send as — ONE picker in the sub-tab bar on every Contacts sub-tab (2026-10-28; the strip row of
   * recent chips is gone): the five most recently used NPCs pinned on top (ids `r:<id>`), everyone
   * else below by role. A pick opens the composer as that NPC.
   * @private
   */
  _sendAsPickerHtml(all, npcs, mail) {
    const lastTs = (c) => mail.byContact.get(c.id)?.lastTs || c.updatedAt || '';
    const recent = [...npcs].sort((a, b) => String(lastTs(b)).localeCompare(String(lastTs(a)))).slice(0, 5);
    const pid = this.scopeId('sendas');
    ScopePicker.on(pid, (v) => {
      if (v?.length) { ScopePicker.set(pid, []); ScopePicker.close(pid); this._sendAs(String(v[0]).replace(/^r:/, '')); }
      this.render(true);
    });
    return ScopePicker.html(pid, {
      noun: 'contact', nouns: 'contacts', icon: 'fa-paper-plane', fixedLabel: 'Send as',
      pinned: recent.map((c) => ({ id: `r:${c.id}`, name: c.name, img: this._portraitOf(all, c), icon: 'fa-clock-rotate-left', meta: 'recent' })),
      items: npcs.map((c) => ({ id: c.id, name: c.name, img: this._portraitOf(all, c), group: this._roleLabel(c.role) || 'No role', meta: c.email || '' })),
    });
  }

  _directoryContext(all, npcs, pcs, kx, mail, facts) {
    const q = lc(this._search);
    const hit = (c) => {
      const f = facts.get(c.id);
      if (!passesFilter(this._filter, f)) return false;
      if (!passesFacets(c, this._facets)) return false;
      if (!q) return true;
      const actorName = c.actorId ? game.actors?.get(c.actorId)?.name : '';
      return haystack(c, actorName).includes(q);
    };
    const mode = this._groupBy;
    const groupOf = (c) => {
      switch (mode) {
        case 'org': return (c.organization || '').trim() || 'No organization';
        case 'trust': return trustInfo(c.trust).label;
        case 'folder': return (c.folder || '').trim() || 'Unfiled';
        case 'none': return 'All contacts';
        default: { const l = this._roleLabel(c.role); return l ? pluralRole(l) : 'No role'; }
      }
    };
    const lastTs = (c) => mail.byContact.get(c.id)?.lastTs || c.updatedAt || '';
    const order = this._sort === 'recent'
      ? (a, b) => String(lastTs(b)).localeCompare(String(lastTs(a))) || String(a.name).localeCompare(String(b.name))
      : (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
    const raw = buildDirectory(npcs, hit, groupOf, order);
    const last = new Set(['No organization', 'No role', 'Unfiled', 'Unknown']);
    const trustOrder = TRUST_LEVELS.map((t) => t.label).reverse();
    raw.sort((a, b) => {
      if (mode === 'trust') return trustOrder.indexOf(a.label) - trustOrder.indexOf(b.label);
      if (last.has(a.label) !== last.has(b.label)) return last.has(a.label) ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
    const roleIconFor = (label) => {
      const hitRole = this._roleTable().find((r) => pluralRole(r.label) === label);
      return hitRole ? hitRole.icon : 'fas fa-user';
    };
    // A search or a filter opens every group that has a hit — a folded group must never hide a match.
    const forced = !!q || this._filter !== 'all' || this._facets.length > 0;
    const groups = raw.map((g) => ({
      key: `${mode}:${g.label}`,
      shut: false,              // decided below, once the selection is known
      label: g.label,
      icon: mode === 'role' ? roleIconFor(g.label) : mode === 'org' ? 'fas fa-building' : mode === 'folder' ? 'fas fa-folder' : mode === 'trust' ? 'fas fa-handshake' : 'fas fa-address-book',
      n: g.rows.filter((r) => !r.alias).length,
      folder: mode === 'folder' && g.label !== 'Unfiled' ? g.label : '',
      // The band wears what groups it: a role / org / folder hue, or the trust level's own colour.
      hue: mode === 'role' ? (g.rows[0]?.c?.role ? `role:${g.rows[0].c.role}` : '') : (mode === 'org' || mode === 'folder') && !last.has(g.label) && g.label !== 'Unfiled' ? g.label : '',
      tc: mode === 'trust' ? trustInfo(g.rows[0]?.c?.trust).color : '',
      rows: g.rows.map((r) => this._rowOf(npcs, r.c, r.alias, facts)),
    }));
    for (const g of groups) Object.assign(g, foldBadges(g.rows));

    // A chip counts the MAIN contacts it would show — an alias hit shows its main (mail to a burner counts).
    const counts = Object.fromEntries(DIR_FILTERS.map(([k]) => [k, buildDirectory(npcs, (c) => passesFilter(k, facts.get(c.id)), () => '', () => 0).flatMap((g) => g.rows).filter((r) => !r.alias).length]));

    // Filter: roles / organizations / trust, several at once (dev: "sort by selecting multiple roles").
    const fid = this.scopeId('dirfacets');
    ScopePicker.set(fid, this._facets);
    ScopePicker.on(fid, (v) => { this._facets = [...(v || [])]; this.render(true); });
    const mains = npcs.filter((c) => !identityRole(all, c)?.isAlias);
    const countOf = (key, kind) => mains.filter((c) => facetKey(kind, c) === key).length;
    const roleIds = [...new Set(mains.map((c) => c.role || ''))];
    const roleTable = this._roleTable();
    const faIcon = (cls) => String(cls || 'fas fa-user').split(/\s+/).find((x) => x.startsWith('fa-') && x !== 'fa-solid') || 'fa-user';
    const facetItems = [
      ...roleIds.map((id) => { const r = roleTable.find((x) => x.id === id); const label = id ? (r?.label || this._roleLabel(id) || id) : '';
        return { id: `role:${id}`, name: id ? pluralRole(label) : 'No role', group: 'Roles', icon: id ? faIcon(getRoleIcon(id)) : 'fa-circle-question', color: id ? tagHue(`role:${id}`) : 'var(--ncm-text-hint)', count: countOf(`role:${id}`, 'role') }; }),
      ...[...new Set(mains.map((c) => (c.organization || '').trim()))].sort((a, b) => (!a) - (!b) || a.localeCompare(b)).map((o) =>
        ({ id: `org:${o}`, name: o || 'No organization', group: 'Organizations', icon: o ? 'fa-building' : 'fa-circle-question', color: o ? tagHue(o) : 'var(--ncm-text-hint)', count: countOf(`org:${o}`, 'org') })),
      ...TRUST_LEVELS.map((t) => ({ id: `trust:${t.v}`, name: t.label, group: 'Trust', icon: 'fa-handshake', color: t.color, count: countOf(`trust:${t.v}`, 'trust') })).filter((x) => x.count),
    ];
    const facetPicker = ScopePicker.html(fid, { noun: 'filter', nouns: 'filters', icon: 'fa-filter', label: 'Filter', multi: true, allLabel: 'Everyone', countLabel: 'contacts', items: facetItems });
    const activeFacets = this._facets.map((k) => { const it = facetItems.find((x) => x.id === k); return it ? { key: k, label: it.name, icon: it.icon, color: it.color } : null; }).filter(Boolean);
    const shownMain = groups.reduce((n, g) => n + g.n, 0);

    if (this._selId && !all.some((c) => c.id === this._selId)) { this._selId = null; this._editing = false; }
    if (!this._selId && !this._creating) {
      const first = groups[0]?.rows[0];
      if (first) { this._selId = first.id; groups[0].rows[0].sel = true; }
    }
    // Default folds: first group open, rest shut; the GM's own choices win; a new selection opens its group.
    if (this._selId !== this._dirSelSeen) {
      this._dirSelSeen = this._selId;
      this._dirSelKey = groups.find((g) => g.rows.some((r) => r.id === this._selId))?.key || null;
    }
    groups.forEach((g, index) => { g.shut = foldShut({ index, key: g.key, choices: this._dirFold, forced, selKey: this._dirSelKey }); });
    const sel = all.find((c) => c.id === this._selId) || null;

    return {
      search: this._search,
      groupOpts: GROUP_BY.map(([v, l]) => ({ v, l: `Group: ${l}`, on: v === mode })),
      sortOpts: [['name', 'Sort: A–Z'], ['recent', 'Sort: Recent']].map(([v, l]) => ({ v, l, on: v === this._sort })),
      chips: DIR_FILTERS.map(([key, label]) => ({ key, label, n: counts[key], on: key === this._filter, warn: key === 'mail' || key === 'check', hot: (key === 'mail' || key === 'check') && counts[key] > 0, tone: (key === 'alias' || key === 'ice') && counts[key] > 0 ? 'secret' : '' })),
      // The quick filters live in the toolbar's Show select; the two that mean "needs you" stay
      // visible as amber count buttons whenever they have anything in them.
      showOn: this._filter !== 'all',
      alerts: [['mail', 'Mail waiting', 'fa-envelope'], ['check', 'Needs a look', 'fa-triangle-exclamation']]
        .filter(([key]) => counts[key] > 0)
        .map(([key, label, icon]) => ({ key, label, icon, n: counts[key], on: this._filter === key })),
      facetPicker, activeFacets, facetShown: shownMain, facetTotal: mains.length,
      groups,
      canFold: !forced && groups.length > 1,
      allShut: groups.length > 0 && groups.every((g) => g.shut),
      empty: !groups.length,
      emptyAll: !npcs.length,
      guard: this._guardTo ? { name: (this._creating ? 'the new contact' : sel?.name) || 'this contact' } : null,
      editing: this._editing || this._creating,
      edit: (this._editing || this._creating) ? this._editContext(all, sel, pcs) : null,
      sel: (!this._editing && !this._creating && sel) ? this._detailContext(all, sel, pcs, kx, mail, facts) : null,
    };
  }

  _detailContext(all, c, pcs, kx, mail, facts) {
    const role = identityRole(all, c);
    const ids = identitiesOfContact(all, c);
    const main = ids[0] || c;
    const f = facts.get(c.id) || { issues: [] };
    const m = mail.byContact.get(c.id);
    const linked = c.actorId ? game.actors?.get(c.actorId) : null;
    const rels = c.relationships || {};
    const tags = [];
    if (role?.isAlias) tags.push({ label: `alias of ${role.primary.name}`, cls: 'is-secret', icon: 'fa-masks-theater' });
    else if (role?.isPrimary) tags.push({ label: `main · ${role.count} identities`, cls: 'is-act', icon: 'fa-star' });
    if (c.encrypted) tags.push({ label: c.blackIce ? 'Encrypted · Black ICE' : 'Encrypted', cls: c.blackIce ? 'is-bad' : 'is-secret', icon: c.blackIce ? 'fa-skull' : 'fa-lock' });
    if (c.sendOnly) tags.push({ label: 'System address', cls: 'is-plain', icon: 'fa-tower-broadcast' });
    const meta = [];
    // Each marker is a pill: role / org / place take a hue from their NAME, so the same
    // organization reads the same colour on every contact; the last-mail stamp is dim mono.
    if (c.role) meta.push({ icon: getRoleIcon(c.role), text: this._roleLabel(c.role), hue: `role:${c.role}` });
    if (c.organization) meta.push({ icon: 'fas fa-building', text: c.organization, hue: c.organization });
    if (c.location) meta.push({ icon: 'fas fa-location-dot', text: c.location, hue: c.location });
    if (m?.lastTs) meta.push({ icon: 'fas fa-clock', text: `last mail ${m.lastWho} · ${this.app._relativeTime?.(m.lastTs) || ''}`, cls: 'is-time' });

    // Identities with usage from the group's mailbox (the old Identities card).
    let usage = new Map();
    if (ids.length > 1) {
      const charId = ids.find((x) => x.actorId)?.actorId || null;
      const ownerId = charId || (ids.find((x) => !x.identityOf) || ids[0])?.id;
      const repo = this.messageRepository || game.nightcity?.messageRepository;
      for (const j of game.journal ?? []) {
        const who = MessageRepository.identifyInbox(j);
        if (who && who.ownerId === ownerId) {
          usage = identityUsage(j.pages.contents.map((p) => repo?._pageToMessage?.(p)).filter(Boolean), ids);
          break;
        }
      }
    }
    const registered = linked?.getFlag?.(FLAG, 'email') || '';
    const trustRows = pcs.filter((p) => kx.knows(c, p.actorId) || rels[p.actorId]).map((p) => {
      const r = rels[p.actorId] || {};
      const v = r.trust != null ? r.trust : (c.trust ?? 0);
      const t = trustInfo(v);
      return {
        actorId: p.actorId, name: p.name, img: p.img, initials: p.initials, color: t.color, label: t.label,
        override: r.trust != null, segs: [1, 2, 3, 4, 5].map((s) => ({ v: s, on: s <= v })),
        rel: RELATIONSHIP_TYPES[r.type]?.label || '', note: r.note || '',
      };
    });
    const def = trustInfo(c.trust ?? 0);
    return {
      id: c.id, name: c.name, img: this._portraitOf(all, c), initials: getInitials(c.name), sys: !!c.sendOnly, ice: !!c.encrypted,
      address: c.email || 'No address', tags, meta, moreOpen: this._moreOpen,
      inboxId: c.actorId || c.identityOf || c.id,
      needs: f.issues.map((i) => ({ kind: i.kind, text: i.text, isAuto: i.kind === 'auto', isDup: i.kind === 'dup' })),
      mail: m?.waiting ? { count: m.waiting, label: `${m.waiting} message${m.waiting === 1 ? '' : 's'} from players waiting for ${c.name}` } : null,
      recent: (m?.recent || []).slice(0, 3).map((r) => ({ ...r, when: r.ts ? this.app._relativeTime?.(r.ts) || '' : '' })),
      who: pcs.map((p) => ({ actorId: p.actorId, name: p.name, img: p.img, initials: p.initials, on: kx.knows(c, p.actorId),
        held: [...new Set(kx.entriesFor(c, p.actorId).map((e) => e.email).filter(Boolean))].join(', ') })),
      whoLabel: role?.isAlias ? 'this alias' : 'them',
      hasPcs: pcs.length > 0,
      trust: {
        label: def.label, color: def.color,
        segs: TRUST_LEVELS.slice(1).map((t) => ({ v: t.v, on: t.v <= (c.trust ?? 0) })),
        rows: trustRows,
      },
      ids: {
        many: ids.length > 1,
        mainName: main.name,
        actorId: c.actorId || '',
        rows: ids.map((x, i) => {
          const u = usage.get(x.id) || { count: 0, last: '' };
          return { id: x.id, name: x.name, email: x.email || '—', main: i === 0, cur: x.id === c.id, img: this._portraitOf(all, x), initials: getInitials(x.name), uses: u.count };
        }),
        registered: registered && !ids.some((x) => lc(x.email) === lc(registered)) ? registered : '',
      },
      // Each value says what kind of thing it is: a state reads by meaning, a name of
      // something (character, folder, tag) takes that name's hue, a blank is dim.
      kv: [
        { l: 'Phone', v: c.phone || '—', cls: c.phone ? 'is-mono' : '' },
        { l: 'Messages', v: c.sendOnly ? 'Send-only' : 'Two-way', cls: c.sendOnly ? 'is-attn' : '' },
        { l: 'Security', v: c.encrypted ? `ICE · ${c.encryptionSkill || 'Interface'} DV ${c.encryptionDV || 15}${c.blackIce ? ' · Black ICE' : ''}` : 'Open', cls: c.encrypted ? (c.blackIce ? 'is-bad' : 'is-secret') : 'is-good' },
        { l: 'Character', v: linked ? linked.name : '—', hue: linked?.name },
        { l: 'Folder', v: c.folder || '—', hue: c.folder },
        { l: 'Tags', v: (c.tags || []).length ? '' : '—', tags: c.tags || [] },
      ].map((r) => ({ ...r, cls: [r.cls, r.v === '—' ? 'is-dim' : ''].filter(Boolean).join(' ') })),
      notes: c.notes || '',
      // VOICE (GM only): the contact's own, else — for an alias — the main identity's,
      // shown dimmed as the placeholder so typing over it is the override.
      voice: this._voiceContext(all, c),
      ...this._detailTabs(c, this._switchboardContext(all, c, pcs, kx, mail)),
    };
  }

  /**
   * The Voice box's view-model (detail pane AND the edit form share it):
   * `{ own, inherited, from, placeholder }` — `own` is this contact's text (what the
   * box holds), `inherited` the main identity's when this alias has none (shown as
   * the dimmed placeholder, "from <main>"), `placeholder` the prompt otherwise.
   */
  _voiceContext(all, c) {
    const v = voiceInfo(all, c);
    const own = String(c?.voice ?? '').trim();
    return {
      own,
      inherited: v.inherited ? v.text : '',
      from: v.inherited ? (v.from?.name || 'their main identity') : '',
      placeholder: v.inherited ? v.text : ContactsTab.VOICE_PLACEHOLDER,
    };
  }

  /**
   * Directory → an NPC → the inner tabs: Profile (everything else) and Correspondents
   * (the switchboard + the picked correspondent). No correspondents → Profile only.
   */
  _detailTabs(c, sb) {
    if (this._dTabFor !== c.id) { this._dTabFor = c.id; this._dTab = 'main'; }
    if (!sb) this._dTab = 'main';
    const corr = this._dTab === 'corr';
    const tabs = sb ? [
      { key: 'main', icon: 'fa-id-card', label: 'Profile', on: !corr },
      { key: 'corr', icon: 'fa-tower-broadcast', label: 'Correspondents', on: corr,
        count: sb.waitingTotal || sb.people.length, attn: !!sb.waitingTotal,
        tip: sb.waitingTotal ? `${sb.waitingTotal} waiting on a reply` : `${sb.people.length} correspondent${sb.people.length === 1 ? '' : 's'}` },
    ] : null;
    return { sb: corr ? sb : null, dtabs: tabs, onMain: !corr };
  }

  /**
   * Directory → an NPC → Correspondents: the switchboard (rules in
   * contactsModel.npcSwitchboard) and the picked correspondent's card.
   * Reads only this NPC group's rows out of the mail index; null when nobody writes
   * to them and no character holds them.
   */
  _switchboardContext(all, c, pcs, kx, mail) {
    if (!c || this._isPcContact(c)) return null;
    const ids = identitiesOfContact(all, c);
    const group = ids.length ? ids : [c];
    const forKey = group.map((x) => x.id).join('|');
    if (this._sbFor !== forKey) { this._sbFor = forKey; this._sbSel = null; this._sbAs = null; this._sbIdent = 'all'; }
    const now = Number(game.nightcity?.timeService?.getCurrentTimeMs?.()) || Date.now();
    const groupIds = new Set(group.map((x) => x.id));
    const byEmail = new Map(all.filter((x) => x.email).map((x) => [lc(x.email), x]));
    const roleOf = (actor, mc) => {
      const item = actor?.items?.find?.((i) => i.type === 'role');
      if (item?.name) return `role:${lc(item.name)}`;
      const m = mc || (actor ? all.find((x) => x.actorId === actor.id && x.role) : null);
      return m?.role ? `role:${lc(m.role)}` : '';
    };
    const rows = [];
    for (const x of group) {
      for (const r of mail.byContact.get(x.id)?.recent || []) {
        const email = lc(r.withEmail);
        if (!r.withActor && (!email || email.includes(','))) continue;   // a group copy's joined address is not a person
        const actor = r.withActor ? game.actors?.get(r.withActor) : null;
        const mc = actor ? null : byEmail.get(email);
        if (mc && groupIds.has(mc.id)) continue;                            // the NPC's own identities
        rows.push({
          ts: Date.parse(r.ts) || 0, sent: !!r.sent, ident: groupIds.has(r.ident) ? r.ident : x.id,
          key: r.withActor || `e:${email}`, name: actor?.name || mc?.name || r.who || email,
          actorId: r.withActor || mc?.actorId || '', isPc: !!actor?.hasPlayerOwner, hueKey: roleOf(actor, mc),
          subject: r.subject, journalId: r.journalId, pageId: r.pageId, messageId: r.messageId, inboxId: r.inboxId,
          spam: !!r.spam, email: r.withEmail || '',
        });
      }
    }
    const knowers = pcs.filter((p) => group.some((x) => kx.knows(x, p.actorId)))
      .map((p) => ({ key: p.actorId, name: p.name, actorId: p.actorId, isPc: true, hueKey: roleOf(p.actor) }));
    if (!rows.length && !knowers.length) return null;

    let answered = {};
    try { answered = game.settings.get(MODULE_ID, 'npcMailAnswered') || {}; } catch { answered = {}; }   // the GM's ✓ in Messages → Needs a reply
    const args = { identities: group.map((x) => ({ id: x.id, name: x.name })), rows, knowers, now, ident: this._sbIdent, answered };
    let sb = npcSwitchboard({ ...args, sel: this._sbSel });
    if (!sb.pick) {
      const first = sb.firstWaiting || sb.people.find((p) => p.count)?.key || sb.people[0]?.key || null;
      sb = npcSwitchboard({ ...args, sel: first });
    }
    const w = Object.fromEntries(sb.wedges.map((x) => [x.id, x]));
    const ago = (ts) => `${sbAge(now - ts)} ago`;
    const people = sb.people.map((p) => {
      const hue = p.hueKey ? tagHue(p.hueKey) : 'var(--ncm-text-label)';
      const dotStyle = p.never ? '' : p.isPc ? `fill:color-mix(in oklab, ${hue} ${p.mix}%, var(--ncm-attn));opacity:${p.bright}` : `stroke:color-mix(in srgb, ${hue} 55%, var(--ncm-text-label))`;
      return { ...p, dotStyle, links: p.links.map((l) => ({ ...l, dim: p.dim })), msgs: undefined, waitMsgs: undefined, perIdent: undefined };
    });

    // The picked correspondent's card.
    const p = sb.pick;
    let card = null;
    if (p) {
      const pc = p.isPc ? pcs.find((x) => x.actorId === p.actorId) : null;
      const actor = p.actorId ? game.actors?.get(p.actorId) : null;
      const lastIn = p.msgs.find((m) => !m.sent);
      const asId = (this._sbAs && w[this._sbAs]) ? this._sbAs : (lastIn && w[lastIn.ident] ? lastIn.ident : group[0].id);
      const wait = p.waitMsgs[0];
      const tv = p.isPc ? (c.relationships?.[p.actorId]?.trust ?? c.trust ?? 0) : 0;
      const t = trustInfo(tv);
      card = {
        key: p.key, name: p.name, isPc: p.isPc, img: pc?.img || okImg(actor?.img), initials: getInitials(p.name), player: pc?.player || '',
        idents: sb.wedges.filter((x) => p.perIdent[x.id]).map((x) => ({ name: x.name, n: p.perIdent[x.id], isAlias: x.isAlias })),
        count: p.count, msgWord: p.count === 1 ? 'message' : 'messages', waiting: p.waiting, waitLabel: p.waitLabel, lastLabel: p.count ? ago(p.lastTs) : '',
        waitMsgs: p.waitMsgs.slice(0, 3).map((m) => ({ subject: m.subject || '(no subject)', when: ago(m.ts) })),
        recent: p.msgs.slice(0, 3).map((m) => ({ sent: m.sent, subject: m.subject || '(no subject)', identName: w[m.ident]?.name || '', isAlias: !!w[m.ident]?.isAlias, when: ago(m.ts), inboxId: m.inboxId, messageId: m.messageId })),
        reply: wait ? { journalId: wait.journalId, pageId: wait.pageId, as: w[wait.ident]?.id || group[0].id, short: w[wait.ident]?.short || group[0].name, isAlias: !!w[wait.ident]?.isAlias } : null,
        asOpts: sb.wedges.map((x) => ({ id: x.id, name: x.name, isAlias: x.isAlias, on: x.id === asId })),
        asId, asShort: w[asId]?.short || '', asAlias: !!w[asId]?.isAlias, lastUsed: lastIn ? (w[lastIn.ident]?.name || '') : '',
        actorId: p.actorId, email: p.msgs.find((m) => m.email && !m.email.includes(','))?.email || pc?.email || '',
        convInbox: p.msgs[0]?.inboxId || '', convMessage: p.msgs[0]?.messageId || '',
        trust: p.isPc ? { label: t.label, color: t.color, segs: [1, 2, 3, 4, 5].map((v) => ({ v, on: v <= tv, cid: c.id, actorId: p.actorId })) } : null,
        cid: c.id, npcShort: String(group[0].name).split(/\s+/)[0],
        knows: p.isPc ? group.some((x) => kx.knows(x, p.actorId)) : true,
      };
    }
    const h = sb.half;
    return {
      ...sb, people, card, cid: c.id, npcShort: String(group[0].name).split(/\s+/)[0],
      vb: `${-h} ${-h} ${sb.size} ${sb.size}`, many: group.length > 1, plural: sb.people.length !== 1,
      chips: [{ id: '', label: 'All', n: sb.total, on: this._sbIdent === 'all', isAlias: false }, ...sb.wedges.map((x) => ({ id: x.id, label: x.name, n: x.count, on: x.on, isAlias: x.isAlias }))],
      pick: undefined,
    };
  }

  // ─── The edit form (Directory → Edit, or New) ───

  _draftFrom(c) {
    const d = {
      name: c?.name || '', alias: c?.alias || '', portrait: c?.portrait || '', role: c?.role || '',
      organization: c?.organization || '', location: c?.location || '', tags: (c?.tags || []).join(', '),
      actorId: c?.actorId || '', folder: c?.folder || '', email: c?.email || '', phone: c?.phone || '',
      sendOnly: c?.sendOnly ? 'true' : 'false', encrypted: c?.encrypted ? 'true' : 'false',
      encryptionDV: String(c?.encryptionDV ?? 15), encryptionSkill: c?.encryptionSkill || 'Interface',
      maxBreachAttempts: String(c?.maxBreachAttempts ?? 3), blackIce: c?.blackIce ? 'true' : 'false',
      blackIceDamage: c?.blackIceDamage || '3d6', iceSource: c?.iceSource || 'default',
      iceCustomName: c?.iceCustomName || '', iceCustomPortrait: c?.iceCustomPortrait || '',
      iceCustomDamage: c?.iceSource === 'custom' ? (c?.blackIceDamage || '3d6') : '3d6', iceActorId: c?.iceActorId || '',
      trust: String(c?.trust ?? 0), revealTrust: c?.revealTrust ? 'true' : 'false', notes: c?.notes || '',
      voice: c?.voice || '',
    };
    for (const [aid, r] of Object.entries(c?.relationships || {})) {
      d[`rel:${aid}:trust`] = r?.trust != null ? String(r.trust) : '';
      d[`rel:${aid}:type`] = r?.type || '';
      d[`rel:${aid}:note`] = r?.note || '';
    }
    return d;
  }

  _editContext(all, c, pcs) {
    if (!this._draft) this._draft = this._draftFrom(this._creating ? null : c);
    const d = this._draft;
    const isNew = this._creating;
    const ids = isNew ? [] : identitiesOfContact(all, c);
    const linked = d.actorId ? game.actors?.get(d.actorId) : null;
    const iceActor = d.iceActorId ? game.actors?.get(d.iceActorId) : null;
    const iceMode = d.blackIce === 'true' ? (d.iceSource || 'default') : 'none';
    const tags = String(d.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const folders = [...new Set(all.map((x) => x.folder).filter(Boolean))].sort();
    const roles = this._roleTable().map((r) => ({ ...r, on: lc(r.id) === lc(d.role) || lc(r.label) === lc(d.role) }));
    if (d.role && !roles.some((r) => r.on)) roles.push({ id: d.role, label: this._roleLabel(d.role), icon: getRoleIcon(d.role), on: true });
    const trustV = Number(d.trust) || 0;
    const dirtyN = this._dirty.size;
    return {
      isNew,
      title: isNew ? 'New contact' : `Editing ${c?.name || ''}`,
      subtitle: isNew ? (linked ? `From ${linked.name}` : 'Fill in what players will see') : (identityRole(all, c)?.isAlias ? `Alias of ${identityRole(all, c).primary.name}` : (c?.email || '')),
      img: d.portrait || okImg(linked?.img), initials: getInitials(d.name || '?'),
      secs: EDIT_SECTIONS.map(([key, label, icon]) => ({ key, label, icon, on: key === this._edSec, dirty: this._dirty.has(key) })),
      f: d,
      // The form's Voice box: an alias with no voice of its own shows the main's as the placeholder.
      voice: isNew ? { own: '', inherited: '', from: '', placeholder: ContactsTab.VOICE_PLACEHOLDER } : this._voiceContext(all, { ...c, voice: d.voice }),
      roles,
      tags,
      tagsJoined: tags.join(', '),
      tagSuggest: this.masterContactService?.getAllTags?.() || [],
      linkedName: linked?.name || '', linkedImg: okImg(linked?.img),
      folders,
      sendOnly: d.sendOnly === 'true',
      routeSegs: [['false', 'Two-way'], ['true', 'Send-only']].map(([v, l]) => ({ v, l, on: d.sendOnly === v })),
      encOn: d.encrypted === 'true',
      skills: [...new Set([...SKILLS, d.encryptionSkill].filter(Boolean))].map((s) => ({ v: s, on: s === d.encryptionSkill })),
      iceSegs: [['none', 'None'], ['default', 'Formula'], ['custom', 'Custom'], ['actor', 'From an actor']].map(([v, l]) => ({ v, l, on: iceMode === v })),
      iceIsDefault: iceMode === 'default', iceIsCustom: iceMode === 'custom', iceIsActor: iceMode === 'actor',
      iceActorName: iceActor?.name || '', iceActorImg: okImg(iceActor?.img),
      trustSegs: TRUST_LEVELS.map((t) => ({ v: String(t.v), l: t.label, color: t.color, on: t.v === trustV })),
      revealTrust: d.revealTrust === 'true',
      players: pcs.map((p) => {
        const tv = d[`rel:${p.actorId}:trust`] ?? '';
        const ty = d[`rel:${p.actorId}:type`] ?? '';
        return {
          actorId: p.actorId, name: p.name, img: p.img, initials: p.initials,
          segs: [['', 'Default', ''], ...TRUST_LEVELS.slice(1).map((t) => [String(t.v), String(t.v), t.color])].map(([v, l, color]) => ({ v, l, color, title: v ? trustInfo(v).label : 'Follow the default', on: String(tv) === v })),
          trustValue: tv,
          types: [['', '— relationship —'], ...Object.entries(RELATIONSHIP_TYPES).map(([k, r]) => [k, r.label.charAt(0) + r.label.slice(1).toLowerCase()])].map(([v, l]) => ({ v, l, on: v === ty })),
          note: d[`rel:${p.actorId}:note`] ?? '',
        };
      }),
      ids: ids.map((x, i) => ({ id: x.id, name: x.name, email: x.email || '—', main: i === 0, img: this._portraitOf(all, x), initials: getInitials(x.name) })),
      idsCan: !isNew,
      mainName: (ids[0] || c)?.name || d.name || 'them',
      dirtyN,
      dirtyLabel: dirtyN ? `Unsaved changes in ${dirtyN} section${dirtyN === 1 ? '' : 's'}` : (isNew ? 'Not saved yet' : 'No changes'),
      contactId: c?.id || '',
    };
  }

  _playersContext(all, pcs, kx, mail, groups) {
    if (!pcs.some((p) => p.actorId === this._pSel)) this._pSel = pcs[0]?.actorId || null;
    const svc = game.nightcity?.contactGroupService;
    // Every character with the facts the toolbar filters, sorts and groups on.
    const allRows = pcs.map((p) => {
      const box = mail.byActor.get(p.actorId);
      return {
        actorId: p.actorId, name: p.name, img: p.img, initials: p.initials, color: p.color, player: p.player, email: p.email,
        subline: [p.player, p.email || 'no address yet'].filter(Boolean).join(' · '), noEmail: !p.email,
        known: all.filter((c) => kx.knows(c, p.actorId)).length, sel: p.actorId === this._pSel,
        unread: box?.unread || 0, lastTs: box?.lastTs || '',
        online: !!p.online, sceneName: p.sceneName || '', groupsN: (svc?.getActorGroups?.(p.actorId) ?? []).length,
      };
    });
    // Toolbar: search (character, player, address, scene) · Show · Group · Sort · fold — the Directory's row.
    const q = lc(this._pSearch);
    const shownRows = sortPlayers(allRows.filter((r) => passesPlayerFilter(r, this._pShow) && (!q || playerHaystack(r).includes(q))), this._pSort);
    const counts = Object.fromEntries(PLAYER_FILTERS.map(([k]) => [k, allRows.filter((r) => passesPlayerFilter(r, k)).length]));
    const forced = !!q || this._pShow !== 'all';
    const pgroups = groupPlayers(shownRows, this._pGroup);
    if (this._pSel !== this._pSelSeen) {
      this._pSelSeen = this._pSel;
      this._pSelKey = pgroups.find((g) => g.rows.some((r) => r.actorId === this._pSel))?.key || null;
    }
    pgroups.forEach((g, index) => { g.n = g.rows.length; g.shut = foldShut({ index, key: g.key, choices: this._pFold, forced, selKey: this._pSelKey }); g.unread = g.rows.reduce((n, r) => n + r.unread, 0); g.noaddr = g.rows.filter((r) => r.noEmail).length; });
    this._pGroupKeys = pgroups.map((g) => g.key);
    const grouped = this._pGroup !== 'none';
    const toolbar = {
      search: this._pSearch,
      chips: PLAYER_FILTERS.map(([key, label]) => ({ key, label, n: counts[key], on: key === this._pShow })),
      showOn: this._pShow !== 'all',
      alerts: [['unread', 'unread', 'fa-envelope', 'attn'], ['noaddr', 'with no address', 'fa-at', 'bad']]
        .filter(([key]) => counts[key] > 0)
        .map(([key, label, icon, tone]) => ({ key, label, icon, tone, n: key === 'unread' ? allRows.reduce((n, r) => n + r.unread, 0) : counts[key], on: this._pShow === key })),
      groupOpts: PLAYER_GROUPS.map(([v, l]) => ({ v, l, on: v === this._pGroup })),
      sortOpts: PLAYER_SORTS.map(([v, l]) => ({ v, l, on: v === this._pSort })),
      canFold: grouped && !forced && pgroups.length > 1,
      allShut: grouped && pgroups.length > 0 && pgroups.every((g) => g.shut),
      grouped, groups: grouped ? pgroups : [],
      rows: grouped ? [] : shownRows,
      shown: shownRows.length, total: allRows.length, narrowed: forced && shownRows.length !== allRows.length,
      nothing: !shownRows.length,
    };
    const p = pcs.find((x) => x.actorId === this._pSel);
    let sel = null;
    if (p && this._pTabFor !== p.actorId) { this._pTabFor = p.actorId; this._pTab = 'main'; }
    if (p) {
      const known = all.filter((c) => kx.knows(c, p.actorId));
      const held = svc?.getActorGroups?.(p.actorId) ?? [];
      const ids = identitiesOf(all, p.actorId);
      const box = mail.byActor.get(p.actorId);
      sel = {
        actorId: p.actorId, name: p.name, img: p.img, initials: p.initials, player: p.player,
        email: p.email, noEmail: !p.email,
        unread: box?.unread || 0, lastMail: box?.lastTs ? this.app._relativeTime?.(box.lastTs) || '' : '',
        knownN: known.length,
        kn: this._knownContext(all, known, p.actorId, mail),
        own: p.list.filter((e) => !all.some((c) => playerEntryMatches(e, c))).map((e) => ({ name: e.name || e.email || '?', email: e.email || '', initials: getInitials(e.name || e.email || '?') })),
        ...this._heldGroupsContext(all, held, svc),
        rack: this._groupRackContext(all, held, svc, groups),
        groupsN: held.length,
        canPush: groups.length > 0,
        ids: ids.map((x, i) => ({ id: x.id, name: x.name, email: x.email || '—', main: i === 0, img: this._portraitOf(all, x), initials: getInitials(x.name) })),
        hasIds: ids.length > 0,
      };
      // Inner tabs: Profile (everything else) · At a glance (orbit, roles, waiting, contact card).
      if (!sel.kn.mods) this._pTab = 'main';
      const glance = this._pTab === 'glance';
      sel.onMain = !glance;
      sel.onGlance = glance;
      sel.ptabs = sel.kn.mods ? [
        { key: 'main', icon: 'fa-id-card', label: 'Profile', on: !glance },
        { key: 'glance', icon: 'fa-circle-nodes', label: 'At a glance', on: glance,
          count: sel.kn.mods.waitingTotal || known.length, attn: !!sel.kn.mods.waitingTotal,
          tip: sel.kn.mods.waitingTotal ? `${sel.kn.mods.waitingTotal} message${sel.kn.mods.waitingTotal === 1 ? '' : 's'} waiting on you` : `${known.length} contact${known.length === 1 ? '' : 's'}` },
      ] : null;
    }
    return { ...toolbar, sel, empty: !pcs.length };
  }

  /** The modules that fold DOM-only: the group rack and the contact list (state kept for the next render). */
  _wireFolds(root) {
    root.querySelectorAll('[data-fold-mod]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mod = btn.closest('.ncm-ct2-fold');
        const shut = !mod.classList.contains('is-shut');
        mod.classList.toggle('is-shut', shut);
        btn.setAttribute('aria-expanded', shut ? 'false' : 'true');
        if (btn.dataset.foldMod === 'rack') this._ghShut = shut;
        else this._knNavShut = shut;
      });
    });
    const rq = root.querySelector('[data-gh-q]');
    rq?.addEventListener('input', () => {
      const q = rq.value.trim().toLowerCase();
      let n = 0;
      root.querySelectorAll('.ncm-ct2-gr__t').forEach((t) => { const hit = !q || (t.dataset.search || '').includes(q); t.style.display = hit ? '' : 'none'; if (hit) n++; });
      root.querySelectorAll('.ncm-ct2-gr__sep').forEach((s) => { s.style.display = [...root.querySelectorAll('.ncm-ct2-gr__t.is-ghost')].some((t) => t.style.display !== 'none') ? '' : 'none'; });
      const empty = root.querySelector('.ncm-ct2-gr__none'); if (empty) empty.style.display = n ? 'none' : '';
    });
  }

  /** A Who-they-know group head: the GM's choice, else the default the template stamped (first open, rest shut). */
  _knIsShut(gh) {
    const k = gh.dataset.g;
    return this._knFold.has(k) ? this._knFold.get(k) : gh.dataset.dshut === '1';
  }

  _wireKnown(kn) {
    const list = kn.querySelector('.ncm-ct2-kn__list');
    // At a glance reuses the .ncm-ct2-kn section with no list in it — nothing to wire there. (Without this guard
    // the next line threw, and the panel skipped its after-render steps: addresses lost their colour, the tab
    // bar stopped folding its labels.)
    if (!list) return;
    const inp = kn.querySelector('[data-kn-q]');
    const empty = kn.querySelector('.ncm-ct2-kn__empty');
    const forced = () => !!(inp?.value || '').trim() || list?.dataset.knForced === '1';
    // A jump chip narrows the list to ONE group (dev 2026-10-29: "only show the appropriate accordions and hide the
    // other ones — it looks cleaner"); the lit chip again, or All, brings everything back. Per character.
    const actor = kn.querySelector('[data-op="pShareContacts"]')?.dataset.actor || '';
    if (this._knSolo.actor !== actor) this._knSolo = { actor, key: null };
    const solo = () => this._knSolo.key;
    const apply = () => {
      const q = (inp?.value || '').trim().toLowerCase();
      const only = solo();
      let any = false;
      for (const gh of list.querySelectorAll('.ncm-ct2-kn__gh')) {
        const k = gh.dataset.g;
        const out = !!only && k !== only;
        const shut = !out && !only && !forced() && this._knIsShut(gh);
        gh.classList.toggle('is-shut', shut);
        gh.classList.toggle('is-solo', !!only && k === only);
        let n = 0;
        for (const r of list.querySelectorAll(`.ncm-ct2-kn__r[data-g="${CSS.escape(k)}"]`)) {
          const hit = !out && (!q || (r.dataset.search || '').includes(q));
          if (hit) n++;
          r.style.display = hit && !shut ? '' : 'none';
        }
        gh.style.display = n ? '' : 'none';
        if (n) any = true;
      }
      if (empty) empty.style.display = any ? 'none' : '';
      for (const j of jumps) {
        const k = j.dataset.knJump;
        const on = k === undefined ? false : (k === '' ? !only : k === only);
        j.classList.toggle('is-on', on);
        j.setAttribute('aria-pressed', String(on));
      }
      kn.classList.toggle('is-solo', !!only);
    };
    inp?.addEventListener('input', apply);
    list?.addEventListener('click', (e) => {
      const gh = e.target.closest('.ncm-ct2-kn__gh');
      if (!gh || inp?.value.trim()) return;
      if (forced()) return;
      this._knFold.set(gh.dataset.g, !this._knIsShut(gh));
      apply();
    });
    // Jump strip: a chip per group narrows the list to that group, open; the lit chip again (or All) shows every
    // group again. While nothing is narrowed, the chip of the group you are scrolled into is marked.
    const jumps = [...kn.querySelectorAll('[data-kn-jump]')];
    for (const j of jumps) {
      const pick = () => {
        const k = j.dataset.knJump;
        this._knSolo.key = (!k || this._knSolo.key === k) ? null : k;
        apply();
        list.scrollTo({ top: 0, behavior: 'smooth' });
        lit();
      };
      j.addEventListener('click', pick);
      j.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    const lit = () => {
      if (solo()) { for (const j of jumps) j.classList.remove('is-here'); return; }
      let cur = null;
      for (const gh of list.querySelectorAll('.ncm-ct2-kn__gh')) { if (gh.style.display === 'none') continue; if (gh.offsetTop - list.offsetTop <= list.scrollTop + 4) cur = gh.dataset.g; }
      if (!cur) cur = list.querySelector('.ncm-ct2-kn__gh:not([style*="none"])')?.dataset.g;
      for (const j of jumps) j.classList.toggle('is-here', !!j.dataset.knJump && j.dataset.knJump === cur);
    };
    list?.addEventListener('scroll', lit, { passive: true });
    kn.querySelector('[data-kn-foldall]')?.addEventListener('click', () => {
      if (this._knSolo.key) { this._knSolo.key = null; }
      const heads = [...list.querySelectorAll('.ncm-ct2-kn__gh')];
      const anyOpen = heads.some((gh) => !this._knIsShut(gh));
      for (const gh of heads) this._knFold.set(gh.dataset.g, anyOpen);
      apply();
    });
    apply();
    lit();
  }

  /** Players → Who they know: the contacts grouped by role / organization / letter. */
  _knownContext(all, known, actorId, mail) {
    const by = this._knBy;
    // ── the modules: one row per contact, from this character's own mail with them ──
    const nowMs = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now();
    const facts = new Map();
    const modRows = known.map((c) => {
      const m = mail.byContact.get(c.id);
      const mine = (m?.recent || []).filter((r) => r.withActor === actorId);
      const lastMs = mine[0]?.ts ? Date.parse(mine[0].ts) : NaN;
      const days = Number.isFinite(lastMs) ? Math.max(0, Math.floor((nowMs - lastMs) / 86400000)) : null;
      const roleL = this._roleLabel(c.role);
      const row = { id: c.id, name: c.name, role: roleL ? (c.role || '') : '', roleLabel: roleL ? pluralRole(roleL) : '', roleIcon: roleL ? getRoleIcon(c.role) : '',
        days, waiting: mine.filter((r) => r.unread).length, mail: mine.length };
      facts.set(c.id, { row, mine, c });
      return row;
    });
    if (this._knSel && !facts.has(this._knSel)) this._knSel = null;
    if (!this._knSel) this._knSel = (modRows.find((r) => r.waiting) || modRows[0])?.id || null;
    const filt = { ring: this._knRing, roles: [...this._knRoles] };
    const mods = knownModules(modRows, { size: 280, ...filt, sel: this._knSel });
    const pick = facts.get(this._knSel);
    const card = pick ? (() => {
      const { row, mine, c } = pick;
      const trust = Number(c.trust ?? 0);
      return { id: c.id, name: c.name, img: this._portraitOf(all, c), initials: getInitials(c.name), email: c.email || '',
        role: row.role ? { label: this._roleLabel(c.role), icon: getRoleIcon(c.role), hue: `role:${c.role}` } : null, org: c.organization || '',
        waiting: row.waiting, mail: row.mail, last: mine[0]?.ts ? this.app._relativeTime?.(mine[0].ts) || '' : '',
        lastSubject: mine[0]?.subject || '', lastSent: !!mine[0]?.sent,
        trust: TRUST_LEVELS.slice(1).map((t) => ({ on: t.v <= trust, color: trustInfo(trust).color })), trustLabel: trustInfo(trust).label,
        canSendAs: !!c.actorId };
    })() : null;
    const chips = [
      ...(this._knRing != null ? [{ what: 'ring', label: KN_RINGS[this._knRing][1], hue: '' }] : []),
      ...[...this._knRoles].map((k) => ({ what: 'role', key: k, label: k ? pluralRole(this._roleLabel(k) || k) : 'No role', hue: k ? `role:${k}` : '' })),
    ];
    known = known.filter((c) => knPasses(facts.get(c.id).row, filt));
    const groups = new Map();
    for (const c of known) {
      const roleL = this._roleLabel(c.role);
      let key, label, icon, hue;
      if (by === 'org') { label = c.organization || 'No organization'; icon = c.organization ? 'fas fa-building' : 'fas fa-circle-question'; hue = c.organization || ''; }
      else if (by === 'az') { label = (c.name || '?').trim().charAt(0).toUpperCase() || '?'; icon = ''; hue = ''; }   // no icon: fa-font draws an "A", so every letter read "A B 1"
      else { label = roleL ? pluralRole(roleL) : 'No role'; icon = roleL ? getRoleIcon(c.role) : 'fas fa-user'; hue = roleL ? `role:${c.role}` : ''; }
      key = `${by}:${label}`;
      if (!groups.has(key)) groups.set(key, { key, label, icon, hue, rows: [] });
      const m = mail.byContact.get(c.id);
      const mine = (m?.recent || []).filter((r) => r.withActor === actorId);
      const waiting = mine.filter((r) => r.unread).length;
      groups.get(key).rows.push({
        id: c.id, name: c.name, img: this._portraitOf(all, c), initials: getInitials(c.name), email: c.email || '',
        org: by !== 'org' ? (c.organization || '') : '',
        role: by !== 'role' && roleL ? { label: roleL, icon: getRoleIcon(c.role), hue: `role:${c.role}` } : null,
        waiting, last: !waiting && mine[0]?.ts ? this.app._relativeTime?.(mine[0].ts) || '' : '',
        search: [c.name, c.email, c.organization, roleL, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase(),
      });
    }
    const isNo = (l) => /^No /.test(l);
    const list = [...groups.values()].sort((a, b) => (isNo(a.label) - isNo(b.label)) || a.label.localeCompare(b.label));
    const forced = chips.length > 0;
    list.forEach((g, index) => {
      g.n = g.rows.length;
      g.waiting = foldBadges(g.rows, { mailKey: 'waiting' }).waiting;
      g.dshut = index > 0;                                   // the default the DOM falls back to
      g.shut = foldShut({ index, key: g.key, choices: this._knFold, forced });
      g.rows.sort((a, b) => a.name.localeCompare(b.name));
    });
    return { by, groups: list, byOpts: [['role', 'Role'], ['org', 'Org'], ['az', 'A–Z']].map(([k, l]) => ({ key: k, label: l, on: k === by })),
      navShut: this._knNavShut, forced,
      mods: modRows.length ? mods : null, card, chips, filtered: chips.length > 0, shown: known.length };
  }

  /** Players → Groups they hold, as the RACK: a tile per held group + your groups they don't hold. */
  _groupRackContext(all, held, svc, masters = []) {
    const key = (m) => lc(m?.email) || m?.hint?.contactId || m?.hint?.actorId || lc(m?.name);
    const sig = groupSig;   // the ONE content signature (contactsModel) — the Groups tab's "out of date" reads the same
    const heldMaster = new Set(held.map((g) => g.sharedFrom?.groupId).filter(Boolean));
    const view = (members) => members.map((m) => this._memberView(all, m));
    const tiles = held.map((g) => {
      const master = g.sharedFrom?.groupId ? svc?.getMasterGroup?.(g.sharedFrom.groupId) : null;
      const fromYou = !!g.sharedFrom;
      const state = ghState({ fromYou, gone: fromYou && !master, stale: !!(master && sig(master) !== sig(g)) });
      const at = g.sharedFrom?.at ? this.app._relativeTime?.(g.sharedFrom.at, { real: true }) || '' : '';   // pushes are stamped on the real clock
      const members = view(g.members || []);
      return { sel: `g:${g.id}`, id: g.id, masterId: master?.id || '', name: g.name, color: g.color || 'var(--ncm-secondary)', img: g.img || master?.img || '', state, at, n: members.length,
        faces: members.slice(0, 4), more: Math.max(0, members.length - 4), raw: g, master,
        search: [g.name, ...members.map((m) => m.name)].join(' ').toLowerCase() };
    });
    const rack = groupRack(tiles, this._ghF);
    this._ghF = rack.filter;
    const ghosts = (rack.filter === 'all' || rack.filter === 'you') ? masters.filter((m) => !heldMaster.has(m.id)).map((m) => {
      const members = view(m.members || []);
      return { sel: `m:${m.id}`, masterId: m.id, name: m.name, color: m.color || 'var(--ncm-secondary)', img: m.img || '', n: members.length, faces: members.slice(0, 4), more: Math.max(0, members.length - 4),
        search: [m.name, ...members.map((x) => x.name)].join(' ').toLowerCase() };
    }) : [];
    // The open tray: members, and for a stale copy what changed since you pushed it.
    let tray = null;
    const t = tiles.find((x) => x.sel === this._ghSel && rack.tiles.includes(x));
    if (t) {
      const { added, removed } = t.master ? ghDiff((t.master.members || []).map(key), (t.raw.members || []).map(key)) : { added: [], removed: [] };
      const addedM = t.state === 'stale' ? (t.master.members || []).filter((m) => added.includes(key(m))) : [];
      const people = [...view(t.raw.members || []).map((v, i) => ({ ...v, cut: t.state === 'stale' && removed.includes(key(t.raw.members[i])) })), ...view(addedM).map((v) => ({ ...v, add: true }))];
      tray = { ...t, raw: undefined, master: undefined, people, added: addedM.length, removed: removed.length,
        line: t.state === 'stale' ? `Out of date — you changed this group since you pushed it${added.length || removed.length ? `: ${[added.length && `${added.length} added`, removed.length && `${removed.length} removed`].filter(Boolean).join(', ')}` : ' (its name or colour)'}.`
          : t.state === 'gone' ? 'You deleted your original. Their copy stays until you take it back.'
          : t.state === 'own' ? 'A group they made themselves — read only for you.'
          : `In sync — pushed ${t.at || 'earlier'}.` };
    } else if (this._ghSel?.startsWith('m:')) {
      const g = ghosts.find((x) => x.sel === this._ghSel);
      if (g) { const m = masters.find((x) => x.id === g.masterId); tray = { ...g, state: 'none', people: view(m?.members || []), line: 'Your group — they don\'t hold it yet.' }; }
    }
    return { ...rack, tiles: rack.tiles.map((x) => ({ ...x, raw: undefined, master: undefined, on: x.sel === this._ghSel })), ghosts: ghosts.map((g) => ({ ...g, on: g.sel === this._ghSel })),
      tray, shut: this._ghShut, total: tiles.length, searchable: tiles.length + masters.length > 6, pushN: masters.filter((m) => !heldMaster.has(m.id)).length };
  }

  /** Players → Groups they hold: copies you pushed (with an out-of-date check) and their own. */
  _heldGroupsContext(all, held, svc) {
    const row = (g) => {
      const master = g.sharedFrom?.groupId ? svc?.getMasterGroup?.(g.sharedFrom.groupId) : null;
      const at = g.sharedFrom?.at || '';
      // Out of date = the group's CONTENT differs (name, colour, members) — not a timestamp,
      // since the master group is re-saved for bookkeeping that changes nothing a player holds.
      const stale = !!(master && groupSig(master) !== groupSig(g));
      const members = (g.members || []).map((m) => this._memberView(all, m));
      return {
        id: g.id, name: g.name, color: g.color || 'var(--ncm-secondary)', img: g.img || '', n: members.length,
        fromYou: !!g.sharedFrom, masterId: master?.id || '', gone: !!g.sharedFrom && !master,
        at: at ? this.app._relativeTime?.(at, { real: true }) || '' : '', stale,   // real-clock push stamp
        faces: members.slice(0, 4), more: Math.max(0, members.length - 4),
        peek: this._pGroupPeek === g.id, names: members.map((m) => m.name).join(', '),
      };
    };
    const rows = held.map(row);
    return { groupsFromYou: rows.filter((r) => r.fromYou), groupsTheirs: rows.filter((r) => !r.fromYou) };
  }

  _memberView(all, m) {
    const hint = m?.hint || {};
    const c = (hint.contactId && all.find((x) => x.id === hint.contactId)) || (m?.email && all.find((x) => lc(x.email) === lc(m.email))) || null;
    const a = !c && hint.actorId ? game.actors?.get(hint.actorId) : null;
    const name = c?.name || a?.name || m?.name || m?.email || '?';
    return { name, img: c ? this._portraitOf(all, c) : okImg(a?.img), initials: getInitials(name), contactId: c?.id || '', gone: !c && !a && !m?.email };
  }

  _groupsContext(all, pcs, groups) {
    const svc = game.nightcity?.contactGroupService;
    if (!groups.some((g) => g.id === this._gSel)) this._gSel = groups[0]?.id || null;
    const allRows = groups.map((g) => {
      const to = svc?.sharedWith?.(g.id) ?? [];
      // Out of date = a pushed copy's CONTENT differs from this group (the Players tab's rule, groupSig).
      const mine = groupSig(g);
      const stale = to.some((s) => (svc?.getActorGroups?.(s.actorId) ?? []).some((c) => c.sharedFrom?.groupId === g.id && groupSig(c) !== mine));
      const members = (g.members || []).map((m) => this._memberView(all, m));
      return {
        id: g.id, name: g.name, color: g.color || 'var(--ncm-secondary)', img: g.img || '', n: (g.members || []).length,
        subline: `${(g.members || []).length} member${(g.members || []).length === 1 ? '' : 's'} · ${to.length ? `pushed to ${to.map((s) => s.name).join(', ')}` : 'not pushed'}`,
        sel: g.id === this._gSel, pushed: to.length, stale, lastUsedAt: g.lastUsedAt || '',
        memberNames: members.map((m) => m.name), memberEmails: (g.members || []).map((m) => m.email || ''),
      };
    });
    // Toolbar: search (group or a member) · Show · the out-of-date count · Sort; the rail folds past GROUPS_RAIL_LIMIT.
    const q = lc(this._gSearch);
    const shownRows = sortGroups(allRows.filter((r) => passesGroupFilter(r, this._gShow) && (!q || groupHaystack(r).includes(q))), this._gSort);
    const counts = Object.fromEntries(GROUP_FILTERS.map(([k]) => [k, allRows.filter((r) => passesGroupFilter(r, k)).length]));
    const forced = !!q || this._gShow !== 'all';
    const tail = foldTail(shownRows, { limit: GROUPS_RAIL_LIMIT, open: this._gMore, forced, keepId: this._gSel });
    const rows = tail.list;
    const toolbar = {
      search: this._gSearch,
      chips: GROUP_FILTERS.map(([key, label]) => ({ key, label, n: counts[key], on: key === this._gShow })),
      showOn: this._gShow !== 'all',
      alerts: counts.stale > 0 ? [{ key: 'stale', label: 'out of date', icon: 'fa-rotate', tone: 'attn', n: counts.stale, on: this._gShow === 'stale' }] : [],
      sortOpts: GROUP_SORTS.map(([v, l]) => ({ v, l, on: v === this._gSort })),
      hidden: tail.hidden, more: this._gMore && shownRows.length > GROUPS_RAIL_LIMIT,
      shown: shownRows.length, total: allRows.length, narrowed: forced && shownRows.length !== allRows.length,
      nothing: !shownRows.length && allRows.length > 0,
    };
    const g = groups.find((x) => x.id === this._gSel);
    let sel = null;
    if (g) {
      const to = new Set((svc?.sharedWith?.(g.id) ?? []).map((s) => s.actorId));
      sel = {
        id: g.id, name: g.name, color: g.color || 'var(--ncm-secondary)', img: g.img || '', note: g.note || '',
        members: (g.members || []).map((m) => this._memberView(all, m)), n: (g.members || []).length,
        to: pcs.map((p) => ({ actorId: p.actorId, name: p.name, img: p.img, initials: p.initials, on: to.has(p.actorId) })),
        hasPcs: pcs.length > 0,
      };
    }
    return { rows, ...toolbar, sel, empty: !groups.length };
  }

  _matrixContext(all, npcs, pcs, kx) {
    const colsId = this.scopeId('mxcols');
    ScopePicker.on(colsId, () => this.render(true));
    const picked = ScopePicker.value(colsId);
    const colsHtml = ScopePicker.html(colsId, {
      noun: 'character', nouns: 'characters', icon: 'fa-user', label: 'Columns', multi: true, allLabel: 'All characters',
      countLabel: 'contacts known', activeLabel: 'Know anyone',
      items: pcs.map((p) => ({ id: p.actorId, name: p.name, img: p.img, color: p.color, group: 'Players’ characters', meta: p.player ? `played by ${p.player}` : '', count: npcs.filter((c) => kx.knows(c, p.actorId)).length })),
    });
    const cols = pcs.filter((p) => !picked.length || picked.includes(p.actorId));
    const changed = (cid) => this._mxChanges.some((x) => x.cid === cid);
    const q = lc(this._mxSearch);
    const known = (c) => pcs.filter((p) => kx.knows(c, p.actorId)).length;
    const rowsAll = npcs.filter((c) => mxPasses(this._mxFilter, known(c), pcs.length, changed(c.id))
      && (!q || haystack(c).includes(q)));
    const groupOf = (c) => this._mxGroupBy === 'org'
      ? ((c.organization || '').trim() || 'No organization')
      : (this._roleLabel(c.role) ? pluralRole(this._roleLabel(c.role)) : 'No role');
    const forceOpen = !!q || this._mxFilter !== 'all';
    const built = buildDirectory(rowsAll, () => true, groupOf, (a, b) => String(a.name).localeCompare(String(b.name)))
      .sort((a, b) => a.label.localeCompare(b.label));
    const groups = built.map((g) => {
      const list = g.rows.map((r) => r.c);
      const open = forceOpen || this._mxOpen.has(g.label);
      return {
        label: g.label, n: list.length, open,
        tallies: cols.map((p) => {
          const t = tally(list, p.actorId, kx.knows);
          return { actorId: p.actorId, k: t.k, n: t.n, cls: t.cls, title: `${t.all ? 'Take every one back from' : 'Share every one with'} ${p.name}` };
        }),
        rows: open ? g.rows.map((r) => ({
          id: r.c.id, name: r.c.name, addr: r.c.email || '', alias: r.alias,
          cells: cols.map((p) => ({ actorId: p.actorId, on: kx.knows(r.c, p.actorId), chg: this._mxChanges.some((x) => x.cid === r.c.id && x.aid === p.actorId) })),
          nobody: !cols.some((p) => kx.knows(r.c, p.actorId)),
        })) : [],
      };
    });
    const nchg = new Set(this._mxChanges.map((x) => `${x.cid}:${x.aid}`)).size;
    return {
      search: this._mxSearch, colsHtml,
      groupOpts: [['role', 'Group: Role'], ['org', 'Group: Organization']].map(([v, l]) => ({ v, l, on: v === this._mxGroupBy })),
      chips: MX_FILTERS.map(([key, label]) => { const n = npcs.filter((c) => mxPasses(key, known(c), pcs.length, changed(c.id))).length; return { key, label, on: key === this._mxFilter, n, tone: n > 0 ? ({ every: 'good', chg: 'act' }[key] || '') : '' }; }),
      anyOpen: this._mxOpen.size > 0,
      cols: cols.map((p) => ({ actorId: p.actorId, name: p.name, img: p.img, initials: p.initials, knows: npcs.filter((c) => kx.knows(c, p.actorId)).length })),
      groups, total: rowsAll.length, totalLabel: `${rowsAll.length} contact${rowsAll.length === 1 ? '' : 's'}`,
      empty: !groups.length, noPcs: !pcs.length, noContacts: !npcs.length,
      nchg, chgLabel: `${nchg} change${nchg === 1 ? '' : 's'} this session`,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  The generic action: data-action="tabAct" data-op="…"
  // ═══════════════════════════════════════════════════════════

  async onAct(op, event, target) {
    const d = target?.dataset || {};
    const id = d.id || target?.closest?.('[data-id]')?.dataset.id || '';
    switch (op) {
      // ── chrome ──
      case 'view': if (this._leaveGuard()) return; this._view = d.view || 'directory'; this._newOpen = false; return this.render(true);
      case 'newMenu': this._newOpen = !this._newOpen; this._moreOpen = false; return this.render(true);
      case 'new': this._newOpen = false; return this._startCreate(null);
      case 'newFromActor': this._newOpen = false; this.render(true); return this.onImportActorAsNpc(event, target);
      case 'newGroup': this._newOpen = false; this._view = 'groups'; return this.onGroupNew(event, target);
      case 'importJson': this._newOpen = false; this.render(true); return this.onImportContactsJSON(event, target);
      case 'exportAll': this._newOpen = false; this.render(true); return this.onExportContacts(event, target);
      case 'syncActors': this._newOpen = false; return this.onSyncFromActors(event, target);

      // ── directory list ──
      case 'filter': this._filter = (this._filter === d.filter) ? 'all' : (d.filter || 'all'); return this.render(true);
      case 'facetOff': this._facets = this._facets.filter((k) => k !== d.k); return this.render(true);
      case 'facetClear': this._facets = []; return this.render(true);
      case 'sel': return this._rowClick(id);
      case 'dirFold': {
        const k = d.key; if (!k) return;
        // The header says what it shows now; the click records the opposite as the GM's choice.
        this._dirFold.set(k, d.shut !== '1');
        if (k === this._dirSelKey) this._dirSelKey = null;
        this._saveDirFold(); return this.render(true);
      }
      case 'dirFoldAll': {
        const keys = [...(this.element?.querySelectorAll?.('[data-op="dirFold"][data-key]') || [])].map((el) => el.dataset.key);
        const close = d.fold === 'close';
        for (const k of keys) this._dirFold.set(k, close);
        this._dirSelKey = null;
        this._saveDirFold(); return this.render(true);
      }
      case 'renameFolder': return this._renameFolder(d.folder);
      case 'guard': return this._resolveGuard(d.choice);
      case 'sendAs': return this._sendAs(id);

      // ── directory detail ──
      case 'message': return this._composeTo(id);
      case 'inbox': return this._openInbox(id);
      case 'edit': return this._startEdit(id, d.sec);
      case 'more': this._moreOpen = !this._moreOpen; this._newOpen = false; return this.render(true);
      case 'aliasAdd': this._moreOpen = false; return this._addAlias(id);
      case 'duplicate': this._moreOpen = false; return this._duplicate(id);
      case 'exportOne': this._moreOpen = false; this.render(true); return this._exportOne(id);
      case 'delete': this._moreOpen = false; return this._delete(id);
      case 'shareMany': this._moreOpen = false; return this._shareDialog([id]);
      case 'looksRight': return this._looksRight(id);
      case 'dTab': this._dTab = d.tab === 'corr' ? 'corr' : 'main'; return this.render(true);
      case 'sbPick': if (this._sbSel !== d.key) { this._sbSel = d.key || null; this._sbAs = null; } return this.render(true);
      case 'sbIdent': this._sbIdent = (this._sbIdent === d.ident || !d.ident) ? 'all' : d.ident; return this.render(true);
      case 'sbAs': this._sbAs = d.ident || null; return this.render(true);
      case 'sbReply': return this._sbReply(d.journal, d.page, d.as);
      case 'sbWrite': return this._sbWrite(d.as, d.actor, d.email);
      case 'replyAs': return this._replyAs(id);
      case 'whoToggle': return this._toggleKnows(id, d.actor, { record: false });
      case 'trustDefault': return this._setTrust(id, null, Number(d.v));
      case 'trustPlayer': return this._setTrust(id, d.actor, Number(d.v));
      case 'star': return this._setPrimary(id);
      case 'identOpen': return this._rowClick(id);
      case 'detailPortrait': return this._pickDetailPortrait(id);
      case 'recentOpen': return game.nightcity?.openInbox?.(d.inbox, d.message || undefined);

      // ── edit form ──
      case 'edTab': return this._jumpSection(d.sec);
      case 'edSeg': return this._edSeg(target, d.key, d.v);
      case 'edRole': return this._edRole(target, d.role);
      case 'manageRoles': return this._manageRoles();
      case 'edPortrait': return this._edPickImage('portrait');
      case 'edIcePortrait': return this._edPickImage('iceCustomPortrait');
      case 'edLink': return this._edPickActor();
      case 'edUnlink': return this._edSetValue('actorId', '', { label: '[data-ct2-linked]', text: 'None' });
      case 'edIceActor': return this._edPickIce();
      case 'edTagDel': return this._edTagDel(target, d.tag);
      case 'edFolderNew': return this._edFolderNew();
      case 'edCancel': return this._cancelEdit();
      case 'edSave': return this._save();
      case 'edPop': return this._popOutEditing();

      // ── players ──
      case 'pSel': this._pSel = d.actor; return this.render(true);
      case 'pFilter': this._pShow = (this._pShow === d.filter) ? 'all' : (d.filter || 'all'); return this.render(true);
      case 'pFold': {
        const k = d.key; if (!k) return;
        this._pFold.set(k, d.shut !== '1');
        if (k === this._pSelKey) this._pSelKey = null;
        this._savePlayerFold(); return this.render(true);
      }
      case 'pFoldAll': {
        const close = d.fold === 'close';
        for (const k of this._pGroupKeys) this._pFold.set(k, close);
        this._pSelKey = null;
        this._savePlayerFold(); return this.render(true);
      }
      case 'pTab': this._pTab = d.tab === 'glance' ? 'glance' : 'main'; return this.render(true);
      case 'pInbox': return game.nightcity?.openInbox?.(d.actor);
      case 'pMessage': return game.nightcity?.composeMessage?.({ toActorId: d.actor });
      case 'pContacts': return this.onViewPlayerContacts(event, target);
      case 'pShareContacts': return this._sharePickerFor(d.actor);
      case 'pPushGroup': return this._pushGroupPickerFor(d.actor);
      case 'knBy': this._knBy = d.by || 'role'; return this.render(true);
      // Who they know → the modules (each narrows the list underneath)
      case 'knRing': { const i = Number(d.ring); this._knRing = this._knRing === i ? null : i; return this.render(true); }
      case 'knRole': { const k = d.role ?? ''; if (this._knRoles.has(k)) this._knRoles.delete(k); else this._knRoles.add(k); return this.render(true); }
      case 'knPick': this._knSel = id || d.id || null; return this.render(true);
      case 'knClear': if (d.what === 'ring') this._knRing = null; else if (d.what === 'role') this._knRoles.delete(d.key ?? ''); else { this._knRing = null; this._knRoles.clear(); } return this.render(true);
      case 'knTake': return this._knTakeBack(d.id, d.actor);
      case 'pGroupUpdate': return this._regroupPush(d.groupId, d.actor);
      case 'pGroupTake': return this._takeGroupBack(d.groupId, d.actor);
      case 'ghF': this._ghF = d.f || 'all'; return this.render(true);
      case 'ghSel': this._ghSel = this._ghSel === d.sel ? null : d.sel; return this.render(true);
      case 'ghPush': {
        const r = await game.nightcity?.contactGroupService?.pushGroupToPlayer?.(d.groupId, d.actor);
        if (r?.success) { ui.notifications.info(`Pushed the group to ${game.actors?.get(d.actor)?.name || 'them'}.`); this._ghSel = null; }
        else ui.notifications.warn(`Could not push the group: ${r?.error || 'unknown reason'}`);
        return this.render(true);
      }
      case 'pGroupPeek': this._pGroupPeek = this._pGroupPeek === d.groupId ? null : d.groupId; return this.render(true);
      case 'pAddIdentity': return this._addIdentityForActor(d.actor);
      case 'pSetEmail': await game.nightcity?.openEmailSetup?.(game.actors?.get(d.actor)); return this.render(true);
      case 'pEdit': return this._editPlayer(d.actor);
      case 'pSheet': return game.actors?.get(d.actor)?.sheet?.render(true);
      case 'pShareSelf': return this._shareDialog([`pc-${d.actor}`]);
      case 'pOpenContact': this._view = 'directory'; this._selectContact(id, { force: true }); return this.render(true);

      // ── groups ──
      case 'gSel': this._gSel = id; return this.render(true);
      case 'gFilter': this._gShow = (this._gShow === d.filter) ? 'all' : (d.filter || 'all'); return this.render(true);
      case 'gMore': this._gMore = !this._gMore; return this.render(true);
      case 'gNew': return this.onGroupNew(event, target);
      case 'gEdit': return this.onGroupEdit(event, target);
      case 'gDelete': return this.onGroupDelete(event, target);
      case 'gPush': return this.onGroupPush(event, target);
      case 'gToggle': return this._toggleGroupFor(d.groupId, d.actor);
      case 'gMessage': return game.nightcity?.composeMessage?.({ groupId: d.groupId });

      // ── who knows whom ──
      case 'mxFilter': this._mxFilter = d.filter || 'all'; return this.render(true);
      case 'mxGrp': if (this._mxOpen.has(d.grp)) this._mxOpen.delete(d.grp); else this._mxOpen.add(d.grp); return this.render(true);
      case 'mxAll': if (this._mxOpen.size) this._mxOpen.clear(); else this._mxAllGroups().forEach((g) => this._mxOpen.add(g)); return this.render(true);
      case 'mxCell': return this._mxCell(d.cid, d.actor, event?.shiftKey);
      case 'mxTally': return this._mxTally(d.grp, d.actor);
      case 'mxUndo': return this._mxUndo();
      case 'mxReset': this._mxSearch = ''; this._mxFilter = 'all'; return this.render(true);
      // ── who knows whom → map (contactsMap.js) ──
      case 'mxMode': this._mxMode = d.mode === 'table' ? 'table' : 'map'; return this.render(true);
      case 'mapPick': this._mapSel = (!id || this._mapSel === id) ? null : id; return this.render(true);
      case 'mapHi': this._mapHi = d.hi || ''; this._mapSel = null; return this.render(true);
      case 'mapShareAll': await shareWithEveryone(this, id); this._mailCache = null; return this.render(true);
      default: log.warn(`Admin Contacts: unknown op ${op}`);
    }
  }

  _onSelect(which, value) {
    if (which === 'groupBy') {
      this._groupBy = value;
      try { game.settings.set(MODULE_ID, 'contactsGroupBy', value); } catch { /* client pref only */ }
    } else if (which === 'sort') this._sort = value;
    else if (which === 'show') this._filter = value || 'all';
    else if (which === 'pShow') this._pShow = value || 'all';
    else if (which === 'pGroup') { this._pGroup = value || 'none'; this._pSelKey = null; this._pSelSeen = undefined; }
    else if (which === 'pSort') this._pSort = value || 'name';
    else if (which === 'gShow') this._gShow = value || 'all';
    else if (which === 'gSort') this._gSort = value || 'name';
    else if (which === 'mxGroupBy') { this._mxGroupBy = value; this._mxOpen.clear(); }
    else if (which.startsWith('rel-type:')) return; // edit-form field — handled by the editor listener
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Directory — selection, guard, edit in place
  // ═══════════════════════════════════════════════════════════

  _selectContact(id, { force = false } = {}) {
    if (!id) return;
    if (force) { this._editing = false; this._creating = false; this._draft = null; this._dirty.clear(); this._guardTo = null; }
    this._selId = id;
    this._moreOpen = false;
  }

  /** True when there are unsaved edits — shows the guard instead of leaving. */
  _leaveGuard(toId = null) {
    if ((this._editing || this._creating) && this._dirty.size) {
      this._guardTo = toId || this._selId || '__view__';
      this.render(true);
      return true;
    }
    return false;
  }

  _rowClick(id) {
    if (!id) return;
    if (id === this._selId && !this._creating) return;
    if (this._leaveGuard(id)) return;
    this._selectContact(id, { force: true });
    this.render(true);
  }

  async _resolveGuard(choice) {
    const to = this._guardTo;
    this._guardTo = null;
    if (choice === 'stay' || !to) return this.render(true);
    if (choice === 'save') {
      const ok = await this._save({ quiet: false, keepOpen: true });
      if (!ok) return;
    }
    if (to !== '__view__') this._selectContact(to, { force: true });
    else { this._editing = false; this._creating = false; this._draft = null; this._dirty.clear(); }
    this.render(true);
  }

  _startEdit(id, sec) {
    const target = id || this._selId;
    if (!target) return;
    this._selId = target;
    this._editing = true; this._creating = false;
    this._draft = null; this._dirty.clear();
    this._edSec = sec || 'identity';
    this._jumpTo = sec || null;
    this._moreOpen = false;
    this._view = 'directory';
    this.render(true);
  }

  _startCreate(draft, { render = true } = {}) {
    if (render && this._leaveGuard()) return;
    this._view = 'directory';
    this._creating = true; this._editing = false;
    this._draft = { ...this._draftFrom(null), ...(draft || {}) };
    this._dirty = new Set(draft ? ['identity'] : []);
    this._edSec = 'identity';
    if (render) this.render(true);
  }

  /** Pop out while editing: hand the draft to the bigger window, and stop editing here. */
  async _popOutEditing() {
    const edit = { id: this._selId, creating: this._creating, draft: { ...(this._draft || {}) }, dirty: [...this._dirty], sec: this._edSec };
    this._editing = false; this._creating = false; this._draft = null; this._dirty.clear();
    this.render(true);
    return this.app.constructor.openTabWindow?.('contacts', { select: { edit } });
  }

  /**
   * New contact pre-filled from an actor (the old Quick Import): name, portrait,
   * NCM address, CPR role item, and the actor link. Nothing is saved until Save.
   */
  startCreateFromActor(actorId, { render = true } = {}) {
    const actor = game.actors?.get(actorId);
    if (!actor) return ui.notifications.warn('NCM | Actor not found.');
    const roleItem = actor.items?.find?.((i) => i.type === 'role');
    this._view = 'directory';
    this._creating = true; this._editing = false;
    this._draft = {
      ...this._draftFrom(null),
      name: actor.name, portrait: okImg(actor.img), email: actor.getFlag?.(FLAG, 'email') || '',
      role: lc(roleItem?.name) || '', actorId: actor.id,
    };
    this._dirty = new Set(['identity']);
    this._edSec = 'identity';
    if (render) this.render(true);
  }

  _cancelEdit() {
    this._editing = false; this._creating = false; this._draft = null; this._dirty.clear(); this._guardTo = null;
    this.render(true);
  }

  /** Wire the live edit form: draft writes, dirty dots, scroll-spy, tag entry. */
  _wireEditor(root, body) {
    const mark = (el) => {
      const name = el.name || el.dataset.field;
      if (!name || !this._draft) return;
      this._draft[name] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
      const sec = el.closest('[data-esec]')?.dataset.esec || sectionOfField(name);
      this._dirty.add(sec);
      this._paintDirty(root);
    };
    body.addEventListener('input', (e) => { if (e.target.matches?.('input, textarea, select')) mark(e.target); });
    body.addEventListener('change', (e) => { if (e.target.matches?.('input, textarea, select')) mark(e.target); });
    const tagIn = body.querySelector('[data-ct2-tagin]');
    if (tagIn) {
      tagIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault(); e.stopPropagation();
        const t = tagIn.value.trim().replace(/,$/, '');
        if (t) this._edTagAdd(root, t);
        tagIn.value = '';
      });
      tagIn.addEventListener('blur', () => { const t = tagIn.value.trim(); if (t) { this._edTagAdd(root, t); tagIn.value = ''; } });
    }
    body.addEventListener('scroll', () => {
      const top = body.getBoundingClientRect().top;
      let cur = EDIT_SECTIONS[0][0];
      for (const s of body.querySelectorAll('[data-esec]')) if (s.getBoundingClientRect().top - top < 40) cur = s.dataset.esec;
      this._edSec = cur;
      for (const t of root.querySelectorAll('[data-sec-tab]')) t.classList.toggle('on', t.dataset.secTab === cur);
    }, { passive: true });
    if (this._jumpTo) { const s = this._jumpTo; this._jumpTo = null; this._jumpSection(s, { smooth: false }); }
    // Enter in a single-line field saves (the old window's folder-field shortcut, generalised).
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches?.('input[type="text"], input[type="number"]') && !e.target.matches('[data-ct2-tagin]')) { e.preventDefault(); this._save(); }
    });
  }

  _paintDirty(root) {
    const n = this._dirty.size;
    for (const t of root.querySelectorAll('[data-sec-tab]')) t.classList.toggle('dirty', this._dirty.has(t.dataset.secTab));
    const st = root.querySelector('[data-ct2-edst]');
    if (st) { st.classList.toggle('dirty', n > 0); st.textContent = n ? `Unsaved changes in ${n} section${n === 1 ? '' : 's'}` : 'No changes'; }
  }

  _jumpSection(sec, { smooth = true } = {}) {
    const body = this.element?.querySelector('.ncm-ct2-edbody');
    const s = body?.querySelector(`[data-esec="${sec}"]`);
    if (!body || !s) return;
    body.scrollTo({ top: s.offsetTop - body.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
    this._edSec = sec;
  }

  /** Write one draft field from a widget and repaint that widget, DOM-only. */
  _edSetValue(name, value, { label, text } = {}) {
    if (!this._draft) return;
    this._draft[name] = value;
    const root = this.element?.querySelector('.ncm-ct2');
    const hidden = root?.querySelector(`[name="${CSS.escape(name)}"]`);
    if (hidden) hidden.value = value;
    if (label) { const l = root?.querySelector(label); if (l) l.textContent = text; }
    this._dirty.add(name === 'voice' ? 'notes' : sectionOfField(name));   // voice sits in the Notes section
    if (root) this._paintDirty(root);
  }

  _edSeg(target, key, v) {
    if (!this._draft) return;
    if (key === 'ice') {
      if (v === 'none') { this._draft.blackIce = 'false'; }
      else { this._draft.blackIce = 'true'; this._draft.iceSource = v; }
      this._dirty.add('security');
      return this.render(true);       // the panel underneath changes shape
    }
    if (key === 'encrypted') { this._draft.encrypted = this._draft.encrypted === 'true' ? 'false' : 'true'; this._dirty.add('security'); return this.render(true); }
    this._edSetValue(key, v);
    const seg = target.closest('.ncm-ct2-seg');
    for (const s of seg?.querySelectorAll('[data-v]') ?? []) s.classList.toggle('on', s.dataset.v === v);
    if (key === 'sendOnly') {
      const hint = this.element?.querySelector('[data-ct2-routehint]');
      if (hint) hint.textContent = v === 'true' ? 'A system address: you can send from it; players can’t reply, write to it or add it.' : 'Players can write to it and reply.';
    }
  }

  _edRole(target, role) {
    this._edSetValue('role', role);
    for (const r of target.closest('.ncm-ct2-roles')?.querySelectorAll('[data-role]') ?? []) r.classList.toggle('on', r.dataset.role === role);
  }

  _manageRoles() {
    import('../../GMContactManager/RoleManagerDialog.js').then(({ RoleManagerDialog }) => {
      new RoleManagerDialog(this.masterContactService).open();
    }).catch((e) => log.warn('Role manager failed to open', e));
  }

  _edPickImage(field) {
    const FP = (typeof FilePicker !== 'undefined') ? FilePicker : foundry.applications?.apps?.FilePicker;
    if (!FP) return;
    new FP({
      type: 'image', current: this._draft?.[field] || '',
      callback: (path) => {
        if (!path) return;
        this._edSetValue(field, path);
        if (field === 'portrait') this.render(true);
      },
    }).browse();
  }

  async _edPickActor() {
    const pick = await showNamePicker({
      title: 'Link a character',
      hint: "Mail to this contact lands in that character's inbox, and it takes the character's portrait when it has none.",
      entries: documentEntries(game.actors?.contents ?? [], { note: (a) => (a.hasPlayerOwner ? 'player' : a.type) }),
      allowNone: '— None —', selected: this._draft?.actorId || '', placeholder: 'search actors or folders…',
    });
    if (!pick) return;
    this._edSetValue('actorId', pick.none ? '' : pick.id);
    this.render(true);
  }

  async _edPickIce() {
    const actors = (game.actors?.contents ?? []).filter(isIceActor);
    if (!actors.length) return ui.notifications.warn('NCM | No Black ICE actors in this world (type "blackIce", the isBlackICE flag, or "Black ICE" in the name).');
    const pick = await showNamePicker({
      title: 'Black ICE actor', hint: "Damage comes from the actor's ATK when a breach fails.",
      entries: documentEntries(actors, { note: () => 'ICE' }), selected: this._draft?.iceActorId || '', placeholder: 'search ICE…',
    });
    if (!pick?.id) return;
    this._edSetValue('iceActorId', pick.id);
    this.render(true);
  }

  _edTagAdd(root, tag) {
    const tags = String(this._draft?.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.some((t) => lc(t) === lc(tag))) return;
    tags.push(tag);
    this._edSetValue('tags', tags.join(', '));
    const box = root.querySelector('[data-ct2-tags]');
    const input = box?.querySelector('[data-ct2-tagin]');
    if (box && input) {
      const span = document.createElement('span');
      span.innerHTML = `${esc(tag)}<i class="fas fa-xmark" data-action="tabAct" data-op="edTagDel" data-tag="${esc(tag)}"></i>`;
      box.insertBefore(span, input);
    }
  }

  _edTagDel(target, tag) {
    const tags = String(this._draft?.tags || '').split(',').map((t) => t.trim()).filter((t) => t && t !== tag);
    this._edSetValue('tags', tags.join(', '));
    target.closest('span')?.remove();
  }

  async _edFolderNew() {
    const name = await adminPrompt({
      title: 'New folder',
      content: '<form class="ncm-dialog-form"><div class="form-group"><label style="text-transform:none;">Folder name</label><input type="text" name="folderName" placeholder="e.g. Main story NPCs" maxlength="40" autofocus /></div></form>',
      callback: (html) => (html[0] || html).querySelector('[name="folderName"]')?.value?.trim(),
      rejectClose: false,
    }).catch(() => null);
    if (!name) return;
    this._edSetValue('folder', name);
    this.render(true);
  }

  /**
   * Read the form into the MasterContactService shape. The DOM wins (it has the
   * latest keystroke); the draft fills anything not on screen. Field-for-field
   * the GM Contact Manager's save, plus the ICE fields it used to drop.
   */
  _collectForm() {
    const d = { ...(this._draft || {}) };
    const form = this.element?.querySelector('.ncm-ct2-edbody');
    for (const el of form?.querySelectorAll('[name]') ?? []) d[el.name] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
    const s = (k) => String(d[k] ?? '').trim();
    const iceSource = s('iceSource') || 'default';
    const data = {
      name: s('name'), email: s('email'), alias: s('alias'), organization: s('organization'), phone: s('phone'),
      portrait: s('portrait'), notes: String(d.notes ?? '').trim(), voice: String(d.voice ?? '').trim(), actorId: s('actorId') || null,
      role: s('role'), location: s('location'), trust: parseInt(s('trust'), 10) || 0,
      sendOnly: s('sendOnly') === 'true', encrypted: s('encrypted') === 'true',
      encryptionDV: parseInt(s('encryptionDV'), 10) || 15, encryptionSkill: s('encryptionSkill') || 'Interface',
      maxBreachAttempts: parseInt(s('maxBreachAttempts'), 10) || 3,
      blackIce: s('blackIce') === 'true', iceSource,
      blackIceDamage: (iceSource === 'custom' ? s('iceCustomDamage') : s('blackIceDamage')) || '3d6',
      iceCustomName: s('iceCustomName'), iceCustomPortrait: s('iceCustomPortrait'), iceActorId: s('iceActorId'),
      revealTrust: s('revealTrust') === 'true',
      tags: s('tags').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean),
      folder: s('folder'),
    };
    const relationships = {};
    for (const pc of getPlayerCharacters()) {
      const tv = s(`rel:${pc.actorId}:trust`), ty = s(`rel:${pc.actorId}:type`), note = s(`rel:${pc.actorId}:note`);
      const trust = tv === '' ? null : parseInt(tv, 10);
      if (ty || note || trust != null) relationships[pc.actorId] = { type: ty, trust, note };
    }
    data.relationships = relationships;
    return data;
  }

  async _save({ keepOpen = false } = {}) {
    if (this._busy) return false;
    const svc = this.masterContactService;
    if (!svc) return false;
    const data = this._collectForm();
    if (!data.name) { ui.notifications.warn('Contact name is required.'); this._jumpSection('identity'); return false; }
    if (data.email && !/^[^\s@]+@[^\s@]+$/.test(data.email)) { ui.notifications.warn(`"${data.email}" is not an address.`); this._jumpSection('addr'); return false; }
    this._busy = true;
    try {
      let res;
      if (this._creating) {
        res = await svc.addContact(data);
        if (res?.success) { this._selId = res.contact.id; ui.notifications.info(`Contact "${data.name}" created.`); }
      } else if (this._selId) {
        // A save is a look: an auto-added sender stops asking.
        res = await svc.updateContact(this._selId, { ...data, reviewed: true });
        if (res?.success) ui.notifications.info(`Contact "${data.name}" updated.`);
      }
      if (!res?.success) { ui.notifications.error(res?.error || 'Failed to save contact.'); return false; }
      this._editing = false; this._creating = false; this._draft = null; this._dirty.clear();
      if (!keepOpen) this.render(true);
      return true;
    } catch (err) {
      console.error(`${MODULE_ID} | ContactsTab._save`, err);
      ui.notifications.error('Failed to save contact.');
      return false;
    } finally { this._busy = false; }
  }

  // ═══════════════════════════════════════════════════════════
  //  Directory — detail actions
  // ═══════════════════════════════════════════════════════════

  _contact(id) { return this.masterContactService?.getContact?.(id || this._selId) || null; }

  _sendAs(id) {
    const contact = this._contact(id);
    if (!contact) return;
    // Pass the CONTACT, not just its character: a character can have several
    // identities, and with only the actor id the composer fell back to the
    // character's registered address (tester 2026-10-27).
    if (contact.actorId) game.nightcity?.composeMessage?.({ fromContactId: contact.id });
    else game.nightcity?.composeMessage?.({ fromContact: { id: contact.id, name: contact.name, email: contact.email, portrait: contact.portrait || null } });
  }

  _composeTo(id) {
    const contact = this._contact(id);
    if (!contact) return;
    if (!contact.email && !contact.actorId) return ui.notifications.warn('Contact has no email address.');
    game.nightcity?.composeMessage?.({ toActorId: contact.actorId || null, to: contact.email });
  }

  _openInbox(id) {
    const contact = this._contact(id);
    if (!contact) return;
    const all = this.masterContactService.getAll();
    const inboxId = contact.actorId || (groupKeyOf(all, contact)?.startsWith('c:') ? groupKeyOf(all, contact).slice(2) : contact.id);
    const opened = MessageRepository && game.journal?.find?.((j) => MessageRepository.identifyInbox(j)?.ownerId === inboxId);
    if (!opened && !contact.actorId) ui.notifications.info(`NCM | ${contact.name} has no mail yet — the inbox opens empty.`);
    game.nightcity?.openInbox?.(inboxId);
  }

  async _replyAs(id) {
    const contact = this._contact(id);
    const m = this._mail(this.masterContactService.getAll()).byContact.get(contact?.id);
    const latest = m?.latest;
    if (!latest) return ui.notifications.warn('Nothing waiting.');
    const page = game.journal?.get(latest.journalId)?.pages?.get(latest.pageId);
    const repo = this.messageRepository || game.nightcity?.messageRepository;
    const msg = page ? repo?._pageToMessage?.(page) : null;
    if (!msg) return ui.notifications.warn('That message is gone.');
    // Reply AS the identity the mail reached (the identities rules).
    game.nightcity?.openComposer?.({ mode: 'reply', originalMessage: msg, fromContactId: contact.id });
  }

  /** Switchboard: reply to one correspondent's waiting message AS the identity it reached. */
  async _sbReply(journalId, pageId, asId) {
    const page = game.journal?.get(journalId)?.pages?.get(pageId);
    const repo = this.messageRepository || game.nightcity?.messageRepository;
    const msg = page ? repo?._pageToMessage?.(page) : null;
    if (!msg) return ui.notifications.warn('That message is gone.');
    game.nightcity?.openComposer?.({ mode: 'reply', originalMessage: msg, fromContactId: asId });
  }

  /** Switchboard: write a new message to the picked correspondent AS one of the NPC's identities. */
  _sbWrite(asId, actorId, email) {
    const as = this._contact(asId);
    if (!as) return;
    // Same rule as Send As: a character-linked identity goes by contact id, a contact-only one as the contact.
    const opts = as.actorId ? { fromContactId: as.id } : { fromContact: { id: as.id, name: as.name, email: as.email, portrait: as.portrait || null } };
    if (actorId) opts.toActorId = actorId;
    if (email) opts.to = email;
    game.nightcity?.composeMessage?.(opts);
  }

  async _looksRight(id) {
    const r = await this.masterContactService?.updateContact?.(id, { reviewed: true });
    if (!r?.success) ui.notifications.warn(r?.error || 'Could not save.');
    this.render(true);
  }

  async _saveNotes(id, notes) {
    const c = this._contact(id);
    if (!c || (c.notes || '') === notes) return;
    await this.masterContactService.updateContact(id, { notes });
    log.info(`GM notes saved for ${c.name}`);
  }

  /**
   * Voice autosave (blur). Only this contact's OWN text is compared and written — an
   * inherited voice lives on the main identity and is never copied down; clearing the
   * box on an alias just lets the main's show through again. A re-render follows so
   * the "from <main>" line and the dimmed placeholder stay honest.
   */
  async _saveVoice(id, voice) {
    const c = this._contact(id);
    const next = String(voice ?? '').trim();
    if (!c || (c.voice || '') === next) return;
    const r = await this.masterContactService.updateContact(id, { voice: next });
    if (!r?.success) return ui.notifications.warn(r?.error || 'Could not save the voice note.');
    log.info(`Voice saved for ${c.name}`);
    if (identityRole(this.masterContactService.getAll() || [], c)) this.render(true);   // aliases read it
  }

  async _setTrust(id, actorId, v) {
    const c = this._contact(id);
    if (!c || Number.isNaN(v)) return;
    if (!actorId) {
      const next = (c.trust ?? 0) === v ? 0 : v;   // click the current level again → clear
      await this.masterContactService.updateContact(id, { trust: next });
    } else {
      const rels = foundry.utils.deepClone(c.relationships || {});
      const cur = rels[actorId] || {};
      const trust = cur.trust === v ? null : v;
      rels[actorId] = { type: cur.type || '', trust, note: cur.note || '' };
      if (!rels[actorId].type && !rels[actorId].note && trust == null) delete rels[actorId];
      await this.masterContactService.updateContact(id, { relationships: rels });
    }
    this.render(true);
  }

  async _setPrimary(id) {
    const res = await this.masterContactService?.setPrimaryIdentity?.(id);
    if (!res?.success) return ui.notifications.warn(res?.error || 'Could not change the main identity.');
    this.render(true);
  }

  async _pickDetailPortrait(id) {
    const FP = (typeof FilePicker !== 'undefined') ? FilePicker : foundry.applications?.apps?.FilePicker;
    if (!FP || !id) return;
    new FP({
      type: 'image', current: this._contact(id)?.portrait || '',
      callback: async (path) => {
        if (!path) return;
        await this.masterContactService.updateContact(id, { portrait: path });
        this.render(true);
      },
    }).browse();
  }

  /** + Add an alias: a new contact in the same identity group (character or contact-only NPC). */
  async _addAlias(contactId) {
    const svc = this.masterContactService;
    const base = this._contact(contactId);
    if (!svc || !base) return;
    const actor = base.actorId ? game.actors?.get(base.actorId) : null;
    const who = actor || base;
    const picked = await this._aliasPrompt(who.name);
    if (!picked) return;
    const res = actor ? await svc.addIdentity(actor.id, picked) : await svc.addContactIdentity(contactId, picked);
    if (!res?.success) return ui.notifications.error(res?.error || 'Could not add the alias.');
    ui.notifications.info(`${res.contact.name} (${res.contact.email}) is now an alias of ${who.name}.`);
    this._selectContact(res.contact.id, { force: !this._dirty.size });
    this.render(true);
  }

  async _addIdentityForActor(actorId) {
    const svc = this.masterContactService;
    const actor = game.actors?.get(actorId);
    if (!svc || !actor) return;
    const picked = await this._aliasPrompt(actor.name);
    if (!picked) return;
    const res = await svc.addIdentity(actorId, picked);
    if (!res?.success) return ui.notifications.error(res?.error || 'Could not add the identity.');
    ui.notifications.info(`${res.contact.name} (${res.contact.email}) is now an identity of ${actor.name}.`);
    this.render(true);
  }

  /**
   * Edit a player character from the panel: name, address, picture. The name and picture
   * are the ACTOR's (what everyone sees); the address is the NCM email flag, written
   * through EmailService.forceSetEmail (the one writer), and the character's directory
   * entry that carried the old address follows it. Mail already sent keeps its address.
   */
  async _editPlayer(actorId) {
    const actor = game.actors?.get(actorId);
    if (!actor) return;
    const oldEmail = actor.getFlag?.(FLAG, 'email') || '';
    const all = this.masterContactService.getAll();
    const aliases = identitiesOf(all, actorId).map((x, i) => ({ name: x.name, email: x.email || '', main: i === 0 }));
    const playedBy = (game.users ?? []).filter(u => !u.isGM && actor.testUserPermission?.(u, 'OWNER')).map(u => u.name);
    const content = playerEditHtml({ name: actor.name, email: oldEmail, img: actor.img || '', playedBy, aliases });
    let addAlias = false;
    const picked = await new Promise((resolve) => {
      let out = null;
      const read = (root) => ({ name: root.querySelector('[name="ncmPcName"]')?.value?.trim() || '', email: root.querySelector('[name="ncmPcEmail"]')?.value?.trim() || '', img: root.querySelector('[name="ncmPcImg"]')?.value?.trim() || '' });
      adminDialog({
        title: `Edit ${actor.name}`, content,
        buttons: {
          cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
          save: { icon: '<i class="fas fa-floppy-disk"></i>', label: 'Save', callback: (html) => { out = read(html[0] ?? html); } },
        },
        default: 'save',
        render: (html) => this._wirePersonDialog(html[0] ?? html, {
          imgName: 'ncmPcImg', nameName: 'ncmPcName', emailName: 'ncmPcEmail',
          onSheet: () => actor.sheet?.render(true),
          onAlias: (root) => { addAlias = true; root.closest('.app')?.querySelector('.dialog-button.save')?.click(); },
        }),
        close: () => resolve(out),
      }, { width: 500, classes: [...THEMED_DIALOG_CLASSES, 'ncm-pe-dialog'] }).render(true);
    });
    if (!picked) return;
    if (picked.email && !looksLikeAddress(picked.email)) return ui.notifications.warn(`"${picked.email}" is not an address.`);
    const patch = {};
    if (picked.name && picked.name !== actor.name) patch.name = picked.name;
    if (picked.img && picked.img !== actor.img) patch.img = picked.img;
    try {
      if (Object.keys(patch).length) await actor.update(patch);
      if (picked.email && lc(picked.email) !== lc(oldEmail)) {
        await game.nightcity?.emailService?.forceSetEmail?.(actor, picked.email);
        // The directory entry that carried the old address follows it.
        const twin = oldEmail ? this.masterContactService.getAll().find((c) => c.actorId === actorId && lc(c.email) === lc(oldEmail)) : null;
        if (twin) await this.masterContactService.updateContact(twin.id, { email: picked.email });
      }
    } catch (err) {
      return ui.notifications.error(`Could not save ${actor.name}: ${err.message}`);
    }
    if (Object.keys(patch).length || (picked.email && lc(picked.email) !== lc(oldEmail))) ui.notifications.info(`Saved ${picked.name || actor.name}.`);
    this._mailCache = null;
    if (addAlias) return this._addIdentityForActor(actorId);
    return this.render(true);
  }

  /**
   * Live wiring shared by the player-edit and alias dialogs: Browse / the picture tile open the FilePicker,
   * the header card repaints as the GM types, and a bad address is flagged under its field.
   * @private
   */
  _wirePersonDialog(root, { imgName, nameName, emailName, onSheet, onAlias } = {}) {
    const img = root.querySelector(`[name="${imgName}"]`);
    const face = root.querySelector('.ncm-pe__face');
    const paintFace = () => {
      if (!face || face.classList.contains('is-static')) return;
      const src = img?.value?.trim();
      const pic = face.querySelector('img'), ini = face.querySelector('.ncm-pe__ini');
      if (pic) { pic.hidden = !src; if (src) pic.src = src; }
      if (ini) ini.hidden = !!src;
      face.classList.toggle('is-empty', !src);
    };
    root.querySelectorAll('[data-pe-browse]').forEach(b => b.addEventListener('click', () => {
      const FP = (typeof FilePicker !== 'undefined') ? FilePicker : foundry.applications?.apps?.FilePicker;
      if (FP) new FP({ type: 'image', current: img?.value || '', callback: (path) => { if (img) { img.value = path; paintFace(); } } }).render(true);
    }));
    img?.addEventListener('input', paintFace);
    const nameIn = root.querySelector(`[name="${nameName}"]`), emailIn = root.querySelector(`[name="${emailName}"]`);
    const showName = root.querySelector('[data-pe-show="name"]'), showEmail = root.querySelector('[data-pe-show="email"]');
    nameIn?.addEventListener('input', () => {
      if (showName) showName.textContent = nameIn.value.trim() || 'Unnamed';
      const ini = face?.querySelector('.ncm-pe__ini');
      if (ini && !face.classList.contains('is-static')) ini.textContent = (nameIn.value.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('') || '?').toUpperCase();
    });
    const err = root.querySelector('[data-pe-err]');
    emailIn?.addEventListener('input', () => {
      const v = emailIn.value.trim();
      if (showEmail) showEmail.textContent = v || 'no address yet';
      const bad = !!v && !looksLikeAddress(v);
      emailIn.classList.toggle('is-bad', bad);
      if (err) { err.hidden = !bad; err.textContent = bad ? 'That is not an address — it needs a name, an @ and a domain.' : ''; }
    });
    root.querySelector('[data-pe-sheet]')?.addEventListener('click', () => onSheet?.());
    root.querySelector('[data-pe-alias]')?.addEventListener('click', () => onAlias?.(root));
  }

  /** Name / address / picture for a new identity. Checks the address before anything is written. */
  async _aliasPrompt(ofName) {
    const picked = await new Promise((resolve) => {
      let out = null;
      adminDialog({
        title: `Add an alias — ${ofName}`, content: aliasDialogHtml({ ofName }),
        buttons: {
          cancel: { icon: '<i class="fas fa-xmark"></i>', label: 'Cancel' },
          add: { icon: '<i class="fas fa-plus"></i>', label: 'Add alias', callback: (html) => {
            const root = html[0] ?? html;
            out = { name: root.querySelector('[name="ncmIdName"]')?.value?.trim() || '', email: root.querySelector('[name="ncmIdEmail"]')?.value?.trim() || '', portrait: root.querySelector('[name="ncmIdPortrait"]')?.value?.trim() || null };
          } },
        },
        default: 'add',
        render: (html) => this._wirePersonDialog(html[0] ?? html, { imgName: 'ncmIdPortrait', nameName: 'ncmIdName', emailName: 'ncmIdEmail' }),
        close: () => resolve(out),
      }, { width: 460, classes: [...THEMED_DIALOG_CLASSES, 'ncm-pe-dialog'] }).render(true);
    });
    if (!picked?.name) return null;
    if (picked.email && !looksLikeAddress(picked.email)) { ui.notifications.warn(`"${picked.email}" is not an address.`); return null; }
    const taken = picked.email ? this.masterContactService.getByEmail?.(picked.email) : null;
    if (taken) { ui.notifications.warn(`${picked.email} already belongs to ${taken.name} in the directory.`); return null; }
    return picked;
  }

  async _duplicate(id) {
    const c = this._contact(id);
    if (!c) return;
    const { id: _drop, createdAt, updatedAt, primaryIdentity, identityOf, ...rest } = foundry.utils.deepClone(c);
    const res = await this.masterContactService.addContact({ ...rest, name: `${c.name} (copy)`, email: '', actorId: null });
    if (!res?.success) return ui.notifications.error(res?.error || 'Could not duplicate.');
    this._selectContact(res.contact.id, { force: true });
    this._startEdit(res.contact.id, 'identity');
  }

  _exportOne(id) {
    const c = this._contact(id);
    if (!c) return;
    this._download({ ncmMasterContacts: 1, exportedAt: new Date().toISOString(), contacts: [c], groups: [] },
      `ncm-contact-${lc(c.name).replace(/[^a-z0-9]+/g, '-') || 'contact'}.json`);
  }

  async _delete(id) {
    const c = this._contact(id);
    if (!c) return;
    const yes = await adminConfirm({
      title: 'Delete contact',
      content: `<p>Delete <b>${esc(c.name)}</b> from the directory? Copies players already hold stay in their lists.</p>`,
    });
    if (!yes) return;
    const res = await this.masterContactService.removeContact(id);
    if (!res?.success) return ui.notifications.error(res?.error || 'Failed to delete contact.');
    ui.notifications.info(`Contact "${c.name}" deleted.`);
    if (this._selId === id) { this._selId = null; this._editing = false; this._draft = null; this._dirty.clear(); }
    this.render(true);
  }

  async _renameFolder(oldName) {
    if (!oldName) return;
    const newName = await adminPrompt({
      title: 'Rename folder',
      content: `<form class="ncm-dialog-form"><div class="form-group"><label style="text-transform:none;">New name</label><input type="text" name="folderName" value="${esc(oldName)}" maxlength="40" autofocus /></div></form>`,
      callback: (html) => (html[0] || html).querySelector('[name="folderName"]')?.value?.trim(),
      rejectClose: false,
    }).catch(() => null);
    if (!newName || newName === oldName) return;
    const svc = this.masterContactService;
    const list = svc.getAll().filter((c) => c.folder === oldName);
    for (const c of list) await svc.updateContact(c.id, { folder: newName });
    ui.notifications.info(`Renamed "${oldName}" to "${newName}" (${list.length} contacts).`);
    this.render(true);
  }

  // ─── Sharing — who knows them ───

  /**
   * Ask before taking anything back from a character. Taking back removes it from their own
   * list, so it always confirms — names are escaped, a long list is shortened.
   */
  async _confirmTakeBack(names, actorId, { what = 'contact', note = '' } = {}) {
    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const list = [].concat(names).filter(Boolean);
    if (!list.length) return false;
    const who = esc(game.actors?.get(actorId)?.name || 'this character');
    const shown = list.slice(0, 6).map((x) => `<b>${esc(x)}</b>`).join(', ') + (list.length > 6 ? ` and ${list.length - 6} more` : '');
    const plural = list.length > 1 ? `${list.length} ${what}s` : `this ${what}`;
    return !!(await adminConfirm({
      title: 'Take back?',
      content: `<p>Take ${shown} back from <b>${who}</b>?</p><p>This removes ${plural} from their own list. ${esc(note) || 'You can share again later.'}</p>`,
    }));
  }

  async _knTakeBack(cid, actorId) {
    const c = this._contact(cid);
    const who = game.actors?.get(actorId)?.name || 'them';
    if (!c) return;
    if (!(await this._confirmTakeBack(c.name, actorId))) return;
    const r = await this._setKnows(cid, actorId, false);
    if (r?.success) ui.notifications.info(`Took ${c.name} back from ${who}.`);
    else ui.notifications.warn(`Could not take ${c.name} back from ${who}.`);
    this._mailCache = null;
    return this.render(true);
  }

  async _regroupPush(masterId, actorId) {
    const svc = game.nightcity?.contactGroupService;
    const r = await svc?.pushGroupToPlayer?.(masterId, actorId);
    if (r?.success) ui.notifications.info(`Updated ${game.actors?.get(actorId)?.name || 'their'} copy of the group.`);
    else ui.notifications.warn(`Could not update the group: ${r?.error || 'unknown reason'}`);
    return this.render(true);
  }

  async _takeGroupBack(copyId, actorId) {
    const svc = game.nightcity?.contactGroupService;
    const g = (svc?.getActorGroups?.(actorId) ?? []).find((x) => x.id === copyId);
    if (!g) return;
    const ok = await adminConfirm({ title: 'Take the group back', content: `<p>Remove <b>${g.name}</b> from ${game.actors?.get(actorId)?.name || 'their'} groups? The contacts in it stay in their list.</p>` });
    if (!ok) return;
    await svc?.deleteActorGroup?.(actorId, copyId);
    return this.render(true);
  }

  /** Share (pushToPlayer) or take back (remove the matching entries) one contact for one character. */
  async _setKnows(cid, actorId, on) {
    const svc = this.masterContactService;
    const c = this._contact(cid);
    if (!svc || !c || !actorId) return { success: false };
    if (on) return svc.pushToPlayer(cid, actorId);
    const repo = this.contactRepository || game.nightcity?.contactRepository;
    let list = [];
    try { list = game.actors?.get(actorId)?.getFlag?.(FLAG, 'contacts') ?? []; } catch { list = []; }
    const hits = knowIndex({ [actorId]: list }, { contacts: svc.getAll?.() || [] }).entriesFor(c, actorId);
    for (const e of hits) await repo?.removeContact?.(actorId, e.id);
    return { success: true, removed: hits.length };
  }

  _knowsNow(cid, actorId) {
    const c = this._contact(cid);
    let list = [];
    try { list = game.actors?.get(actorId)?.getFlag?.(FLAG, 'contacts') ?? []; } catch { list = []; }
    return knowIndex({ [actorId]: list }, { contacts: this.masterContactService?.getAll?.() || [] }).knows(c, actorId);
  }

  async _toggleKnows(cid, actorId, { record = true } = {}) {
    if (this._busy) return;
    this._busy = true;
    try {
      const on = !this._knowsNow(cid, actorId);
      if (!on && !(await this._confirmTakeBack(this._contact(cid)?.name, actorId))) return;
      const res = await this._setKnows(cid, actorId, on);
      if (!res?.success) ui.notifications.warn(res?.error || 'Could not change that.');
      else if (record) this._mxChanges.push({ cid, aid: actorId, on });
    } finally { this._busy = false; }
    this.render(true);
  }

  // ─── Who knows whom ───

  _mxAllGroups() {
    const npcs = (this.masterContactService?.getAll?.() ?? []).filter((c) => !this._isPcContact(c));
    return [...new Set(npcs.map((c) => this._mxGroupBy === 'org'
      ? ((c.organization || '').trim() || 'No organization')
      : (this._roleLabel(c.role) ? pluralRole(this._roleLabel(c.role)) : 'No role')))];
  }

  async _mxCell(cid, actorId, shift) {
    if (shift && this._mxLast && this._mxLast.aid === actorId && this._mxLast.cid !== cid) {
      const col = [...(this.element?.querySelectorAll(`[data-op="mxCell"][data-actor="${CSS.escape(actorId)}"]`) ?? [])].map((x) => x.dataset.cid);
      const on = this._knowsNow(this._mxLast.cid, actorId);
      if (!on) {
        const ids = rangeIds(col, this._mxLast.cid, cid).filter((id) => this._knowsNow(id, actorId));
        if (ids.length && !(await this._confirmTakeBack(ids.map((id) => this._contact(id)?.name), actorId))) return;
      }
      this._busy = true;
      try {
        for (const id of rangeIds(col, this._mxLast.cid, cid)) {
          if (this._knowsNow(id, actorId) === on) continue;
          const r = await this._setKnows(id, actorId, on);
          if (r?.success) this._mxChanges.push({ cid: id, aid: actorId, on });
        }
      } finally { this._busy = false; }
      this._mxLast = { cid, aid: actorId };
      return this.render(true);
    }
    this._mxLast = { cid, aid: actorId };
    return this._toggleKnows(cid, actorId);
  }

  async _mxTally(grp, actorId) {
    const npcs = (this.masterContactService?.getAll?.() ?? []).filter((c) => !this._isPcContact(c));
    const ids = [...(this.element?.querySelectorAll(`[data-mx-grp="${CSS.escape(grp)}"]`) ?? [])].map((x) => x.dataset.cid);
    // Closed group: no rows on screen — take the group's members from the data.
    const inGroup = ids.length ? npcs.filter((c) => ids.includes(c.id)) : npcs.filter((c) => (this._mxGroupBy === 'org'
      ? ((c.organization || '').trim() || 'No organization')
      : (this._roleLabel(c.role) ? pluralRole(this._roleLabel(c.role)) : 'No role')) === grp);
    const allKnow = inGroup.every((c) => this._knowsNow(c.id, actorId));
    if (allKnow && inGroup.length && !(await this._confirmTakeBack(inGroup.map((c) => c.name), actorId))) return;
    this._busy = true;
    try {
      for (const c of inGroup) {
        if (this._knowsNow(c.id, actorId) === !allKnow) continue;
        const r = await this._setKnows(c.id, actorId, !allKnow);
        if (r?.success) this._mxChanges.push({ cid: c.id, aid: actorId, on: !allKnow });
      }
    } finally { this._busy = false; }
    this.render(true);
  }

  async _mxUndo() {
    const x = this._mxChanges.pop();
    if (!x) return;
    await this._setKnows(x.cid, x.aid, !x.on);
    this.render(true);
  }

  // ─── Players ───

  async _sharePickerFor(actorId) {
    const actor = game.actors?.get(actorId);
    const svc = this.masterContactService;
    if (!actor || !svc) return;
    const all = svc.getAll().filter((c) => !(c.actorId === actorId));
    const picks = await showNamePicker({
      title: `Share contacts with ${actor.name}`,
      hint: 'They land in that character’s own contact list. Contacts they already have are greyed.',
      entries: all.map((c) => ({ id: c.id, name: c.name, img: this._portraitOf(all, c), sub: c.email || '', group: this._roleLabel(c.role) || 'No role', note: c.organization || '' })),
      taken: all.filter((c) => this._knowsNow(c.id, actorId)).map((c) => c.id),
      multi: true, placeholder: 'search contacts…',
    });
    if (!Array.isArray(picks) || !picks.length) return;
    let n = 0, bad = null;
    for (const p of picks) { const r = await svc.pushToPlayer(p.id, actorId); if (r?.success) n++; else bad = bad || r?.error; }
    ui.notifications.info(`NCM | Shared ${n} contact${n === 1 ? '' : 's'} with ${actor.name}.`);
    if (bad) ui.notifications.warn(`NCM | Some shares failed: ${bad}`);
    this.render(true);
  }

  async _pushGroupPickerFor(actorId) {
    const svc = game.nightcity?.contactGroupService;
    const actor = game.actors?.get(actorId);
    if (!svc || !actor) return;
    const groups = svc.getMasterGroups();
    if (!groups.length) return ui.notifications.warn('NCM | No GM groups yet — make one in the Groups view.');
    const held = new Set(svc.getActorGroups(actorId).map((g) => g.sharedFrom?.groupId).filter(Boolean));
    const pick = await showNamePicker({
      title: `Push a group to ${actor.name}`,
      hint: 'Members they lack are shared first; re-pushing refreshes their copy.',
      entries: groups.map((g) => ({ id: g.id, name: g.name, img: g.img || '', icon: 'fas fa-users', color: g.color || '', sub: `${g.members.length} members${held.has(g.id) ? ' · has it' : ''}`, group: 'Groups' })),
      placeholder: 'search groups…',
    });
    if (!pick?.id) return;
    const r = await svc.pushGroupToPlayer(pick.id, actorId);
    if (!r?.success) ui.notifications.warn(`NCM | ${r?.error || 'Push failed.'}`);
    else ui.notifications.info(`NCM | Pushed "${pick.name}" to ${actor.name} (${r.shared} contacts shared${r.failed?.length ? `, failed: ${r.failed.join(', ')}` : ''}).`);
    this.render(true);
  }

  // ─── Groups ───

  async _toggleGroupFor(groupId, actorId) {
    const svc = game.nightcity?.contactGroupService;
    const group = svc?.getMasterGroup?.(groupId);
    const actor = game.actors?.get(actorId);
    if (!group || !actor) return;
    const copy = svc.getActorGroups(actorId).find((g) => g.sharedFrom?.groupId === groupId);
    if (copy) {
      if (!(await this._confirmTakeBack(group.name, actorId, { what: 'group', note: 'The contacts it shared stay with them.' }))) return;
      const r = await svc.deleteActorGroup(actorId, copy.id);
      if (!r?.success) ui.notifications.warn(`NCM | ${r?.error || 'Could not take it back.'}`);
      else ui.notifications.info(`NCM | Took "${group.name}" back from ${actor.name}. Contacts it shared stay with them.`);
    } else {
      const r = await svc.pushGroupToPlayer(groupId, actorId);
      if (!r?.success) ui.notifications.warn(`NCM | ${r?.error || 'Push failed.'}`);
      else ui.notifications.info(`NCM | Pushed "${group.name}" to ${actor.name} (${r.shared} contacts shared).`);
    }
    this.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Legacy handlers — AdminPanelApp's static delegators + keyboard shortcuts
  // ═══════════════════════════════════════════════════════════

  /** Every old "open the GM Contact Manager" door now lands here. */
  onOpenGMContacts() {
    this.app._activeTab = 'contacts';
    this._view = 'directory';
    this.render(true);
  }

  onCreateNew() { return this._startCreate(null); }
  onEditInEditor(event, target) { return this._startEdit(target?.closest?.('[data-contact-id]')?.dataset.contactId || this._selId); }
  onPushAll() { this._view = 'matrix'; this.render(true); }
  onSendAsContact(event, target) { return this._sendAs(target?.closest?.('[data-contact-id]')?.dataset.contactId); }
  onComposeToContact(event, target) { return this._composeTo(target?.closest?.('[data-contact-id]')?.dataset.contactId); }
  onOpenContactInbox(event, target) { return this._openInbox(target?.closest?.('[data-contact-id]')?.dataset.contactId); }
  async onPushContact(event, target) { return this._shareDialog([target?.closest?.('[data-contact-id]')?.dataset.contactId].filter(Boolean)); }
  async onShareToPlayer(event, target) { return this.onPushContact(event, target); }
  async onSetTrust(event, target) {
    const id = target?.closest?.('[data-contact-id]')?.dataset.contactId;
    return this._setTrust(id, null, parseInt(target?.dataset.trustValue, 10));
  }
  onFilter(event, target) { this._filter = (this._filter === target?.dataset.filter) ? 'all' : (target?.dataset.filter || 'all'); this.render(true); }
  onClearSearch() { this._search = ''; this.render(true); }
  onToggleExpand(event, target) { return this._rowClick(target?.closest?.('[data-contact-id]')?.dataset.contactId); }
  onToggleSelect() {}
  onClearSelection() {}
  onToggleGroup() {}
  onToggleOverflow() { this._newOpen = !this._newOpen; this.render(true); }
  onBurnContact() { ui.notifications.info('NCM | Burning contacts is retired from the current scope.'); }
  onBatchShare() {}
  onBatchTag() {}
  onBatchBurn() {}
  onOpenRecentMessage(event, target) {
    const el = target?.closest?.('[data-inbox-owner]');
    if (el) game.nightcity?.openInbox?.(el.dataset.inboxOwner, el.dataset.messageId || undefined);
  }

  onViewPlayerContacts(event, target) {
    const actorId = target?.dataset?.actor || target?.closest?.('[data-actor-id]')?.dataset.actorId;
    if (!actorId || !game.user.isGM) return;
    const ContactManagerApp = game.nightcity?._ContactManagerApp;
    if (!ContactManagerApp) return game.nightcity?.openContacts?.(actorId, { gmInspectMode: true });
    new ContactManagerApp({ actorId, gmInspectMode: true }).render(true);
  }

  async onGMVerifyContact(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!actorId || !contactId || !game.user.isGM) return;
    const result = await game.nightcity?.contactRepository?.gmOverrideVerification(actorId, contactId, true);
    if (result?.success) { ui.notifications.info('Contact force-verified.'); this.render(true); }
    else ui.notifications.error(result?.error || 'Verification failed.');
  }

  async onGMUnverifyContact(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!actorId || !contactId || !game.user.isGM) return;
    const result = await game.nightcity?.contactRepository?.gmOverrideVerification(actorId, contactId, false);
    if (result?.success) { ui.notifications.info('Verification revoked.'); this.render(true); }
    else ui.notifications.error(result?.error || 'Failed to unverify.');
  }

  /**
   * Share one or more contacts with chosen characters. A `pc-<actorId>` id is a
   * player character (not a master contact) — it shares as an actor-linked
   * contact built from the actor; a character never receives itself.
   * @param {string[]} contactIds
   */
  async _shareDialog(contactIds) {
    if (!contactIds?.length) return;
    const playerActors = getPlayerCharacters();
    if (!playerActors.length) return ui.notifications.warn('NCM | No player-owned characters found.');
    const names = contactIds.map((id) => (id.startsWith('pc-') ? game.actors?.get(id.slice(3))?.name : this._contact(id)?.name)).filter(Boolean);
    if (!names.length) return ui.notifications.warn('NCM | Nothing to share — the selected contacts no longer exist.');
    const picks = await showNamePicker({
      title: names.length === 1 ? `Share ${names[0]} with…` : `Share ${names.length} contacts with…`,
      hint: "Each lands in that character's own contact list. Re-sharing never duplicates.",
      entries: playerActors.filter((pa) => !contactIds.includes(`pc-${pa.actorId}`)).map((pa) => ({ id: pa.actorId, name: pa.actorName, img: okImg(pa.actor?.img), sub: pa.playerName || '', group: 'Players', note: 'player' })),
      multi: true, placeholder: 'search characters…',
    });
    if (!Array.isArray(picks) || !picks.length) return;
    let shared = 0, firstError = null;
    for (const contactId of contactIds) {
      const isPc = contactId.startsWith('pc-');
      const pcActorId = isPc ? contactId.slice(3) : null;
      for (const p of picks) {
        if (isPc && p.id === pcActorId) continue;
        const r = isPc ? await this.masterContactService?.pushActorToPlayer(pcActorId, p.id) : await this.masterContactService?.pushToPlayer(contactId, p.id);
        if (r?.success) shared++; else firstError = firstError || r?.error || 'unknown error';
      }
    }
    if (shared) ui.notifications.info(`NCM | Shared ${names.length === 1 ? names[0] : `${names.length} contacts`} with ${picks.length} character${picks.length === 1 ? '' : 's'}.`);
    if (firstError) ui.notifications.warn(`NCM | Some shares failed: ${firstError}`);
    this.render(true);
  }

  // ─── Contact groups (GM) ───

  /** Pickable people for a GM group: the directory + player characters. */
  async _groupMemberSource() {
    const master = game.nightcity?.masterContactService?.getAll?.() || [];
    const entries = master.map((c) => {
      const member = memberFromMasterContact(c);
      return { id: memberKey(member), name: c.name, member, img: c.portrait || '', sub: c.email || '', group: c.folder || c.organization || 'Directory', note: c.role || c.type || '' };
    });
    const linked = new Set(master.map((c) => c.actorId).filter(Boolean));
    for (const pc of getPlayerCharacters()) {
      const actor = pc.actor || game.actors.get(pc.actorId);
      if (!actor || linked.has(actor.id)) continue;
      const member = memberFromActor(actor);
      entries.push({ id: memberKey(member), name: actor.name, member, img: actor.img || '', sub: member.email || 'no address yet', group: 'Player Characters', note: 'player' });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  _groupIdFrom(target) { return target?.dataset?.groupId || target?.closest?.('[data-group-id]')?.dataset.groupId || this._gSel; }

  async onGroupNew(event, target) {
    const group = await editGroupDialog({}, { memberSource: () => this._groupMemberSource() });
    if (!group) return this.render(true);
    const r = await game.nightcity?.contactGroupService?.saveMasterGroup(group);
    if (!r?.success) return ui.notifications.warn(`NCM | ${r?.error || 'Could not save the group.'}`);
    ui.notifications.info(`NCM | Group "${group.name}" saved. Push it to players from Groups.`);
    this._view = 'groups';
    this._gSel = r.group?.id || group.id || this._gSel;
    this.render(true);
  }

  async onGroupEdit(event, target) {
    const id = this._groupIdFrom(target);
    const svc = game.nightcity?.contactGroupService;
    const existing = svc?.getMasterGroup(id);
    if (!existing) return;
    const group = await editGroupDialog(existing, { memberSource: () => this._groupMemberSource() });
    if (!group) return;
    const r = await svc.saveMasterGroup(group);
    if (!r?.success) return ui.notifications.warn(`NCM | ${r?.error || 'Could not save the group.'}`);
    this.render(true);
  }

  async onGroupDelete(event, target) {
    const id = this._groupIdFrom(target);
    const svc = game.nightcity?.contactGroupService;
    const existing = svc?.getMasterGroup(id);
    if (!existing) return;
    const shared = svc.sharedWith(id);
    const yes = await adminConfirm({
      title: 'Delete group',
      content: `<p>Delete <b>${esc(existing.name)}</b> from the GM list?${shared.length ? ` Copies already pushed to ${shared.map((s) => esc(s.name)).join(', ')} stay with them.` : ''}</p>`,
    });
    if (!yes) return;
    await svc.deleteMasterGroup(id);
    if (this._gSel === id) this._gSel = null;
    this.render(true);
  }

  async onGroupPush(event, target) {
    const id = this._groupIdFrom(target);
    const svc = game.nightcity?.contactGroupService;
    const group = svc?.getMasterGroup(id);
    if (!group) return;
    const pcs = getPlayerCharacters();
    if (!pcs.length) return ui.notifications.warn('NCM | No player characters to push to.');
    const already = new Set(svc.sharedWith(id).map((s) => s.actorId));
    const picks = await showNamePicker({
      title: `Push "${group.name}" to…`,
      hint: 'Members the player lacks are shared first, then the group. Re-pushing refreshes their copy.',
      entries: pcs.map((pc) => ({ id: pc.actorId, name: pc.actorName, img: pc.actor?.img || '', sub: already.has(pc.actorId) ? 'has this group' : (pc.playerName || ''), note: 'player' })),
      multi: true,
      placeholder: 'search characters…',
    });
    if (!Array.isArray(picks) || !picks.length) return;
    const lines = [];
    for (const p of picks) {
      const r = await svc.pushGroupToPlayer(id, p.id);
      lines.push(r?.success ? `${p.name}: shared (${r.shared} contacts)${r.failed?.length ? `, failed: ${r.failed.join(', ')}` : ''}` : `${p.name}: ${r?.error || 'failed'}`);
    }
    ui.notifications.info(`NCM | Pushed "${group.name}" — ${lines.join(' · ')}`);
    this.render(true);
  }

  // ─── New menu: import / export / sync / from an actor ───

  _download(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  onExportContacts() {
    const svc = this.masterContactService;
    if (!svc) return;
    const contacts = svc.getAll?.() || [];
    // Envelope: contacts + the GM's groups (members keyed by address, so they
    // re-resolve in another world). Import accepts this OR the old bare array.
    const groups = game.nightcity?.contactGroupService?.exportMaster?.() || [];
    this._download({ ncmMasterContacts: 1, exportedAt: new Date().toISOString(), contacts, groups },
      `ncm-master-contacts-${new Date().toISOString().slice(0, 10)}.json`);
    ui.notifications.info(`Exported ${contacts.length} contacts.`);
  }

  async onImportContactsJSON() {
    const svc = this.masterContactService;
    if (!svc) return ui.notifications.warn('Master contact service not available.');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json'; input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        // Accept the {ncmMasterContacts, contacts, groups} envelope as well as a bare array.
        const contacts = Array.isArray(parsed) ? parsed : parsed?.contacts;
        const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
        if (!Array.isArray(contacts)) return ui.notifications.error('Invalid format — expected a JSON array of contacts.');
        let imported = 0, skipped = 0;
        const existingEmails = new Set((svc.getAll() || []).map((c) => c.email?.toLowerCase()));
        for (const c of contacts) {
          if (!c.name) { skipped++; continue; }
          if (c.email && existingEmails.has(c.email.toLowerCase())) { skipped++; continue; }
          const result = await svc.addContact({
            name: c.name, email: c.email || '', alias: c.alias || '', phone: c.phone || '',
            organization: c.organization || '', location: c.location || '', portrait: c.portrait || '',
            type: c.type || 'npc', role: c.role || '', tags: c.tags || [], notes: c.notes || '', voice: c.voice || '',
            trust: c.trust ?? 3, relationships: c.relationships || {}, folder: c.folder || '',
            sendOnly: !!c.sendOnly, encrypted: !!c.encrypted, encryptionDV: c.encryptionDV, encryptionSkill: c.encryptionSkill,
            blackIce: !!c.blackIce, blackIceDamage: c.blackIceDamage, iceSource: c.iceSource, iceCustomName: c.iceCustomName,
            iceCustomPortrait: c.iceCustomPortrait, iceActorId: c.iceActorId, maxBreachAttempts: c.maxBreachAttempts,
            revealTrust: !!c.revealTrust, actorId: c.actorId && game.actors?.get(c.actorId) ? c.actorId : null,
            primaryIdentity: !!c.primaryIdentity,
          });
          if (result?.success) { imported++; existingEmails.add(c.email?.toLowerCase()); }
        }
        let groupNote = '';
        if (groups.length) {
          const gr = await game.nightcity?.contactGroupService?.importMaster?.(groups);
          if (gr) {
            groupNote = ` Groups: ${gr.imported} imported${gr.skipped ? `, ${gr.skipped} skipped` : ''}.`;
            if (gr.unresolved.length) ui.notifications.warn(`NCM | Group members not found in this world: ${gr.unresolved.join('; ')}`, { permanent: true });
          }
        }
        ui.notifications.info(`Imported ${imported} contacts. ${skipped ? `${skipped} skipped (duplicates or invalid).` : ''}${groupNote}`);
        this.render(true);
      } catch (err) {
        console.error('NCM | Import contacts failed:', err);
        ui.notifications.error('Failed to parse JSON file.');
      } finally { input.remove(); }
    });
    input.click();
  }

  async onSyncFromActors(event) {
    event?.preventDefault?.();
    const confirmed = await adminConfirm({
      title: 'Sync from actors',
      content: '<p>Add a directory contact for every world actor that has an NCM address but is not in the directory yet?</p>',
    });
    if (!confirmed) return this.render(true);
    const result = await this.masterContactService?.importFromActors();
    if (result?.success) ui.notifications.info(`NCM | Added ${result.imported} contact${result.imported !== 1 ? 's' : ''} from world actors.`);
    else ui.notifications.warn('NCM | Sync failed.');
    this.render(true);
  }

  /** New contact from an actor: the searchable ActorImportPickerApp, which calls startCreateFromActor. */
  async onImportActorAsNpc() {
    if (!game.user.isGM) return;
    const { ActorImportPickerApp } = await import('../../GMContactManager/ActorImportPickerApp.js');
    new ActorImportPickerApp().render(true);
  }
}

export default ContactsTab;
