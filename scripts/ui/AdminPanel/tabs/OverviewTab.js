/**
 * OverviewTab — THE NOW LINE.
 * @file scripts/ui/AdminPanel/tabs/OverviewTab.js
 * @module night-city-messenger
 *
 * Rebuilt 2026-10-28 from the dev-approved mock
 * dev/mockups/admin-overview-rethink-mock.html (Version B). ONE vertical
 * timeline owns the tab: the recent activity ABOVE a fixed NOW line (saved mail
 * + the Security log + session events, newest nearest the line), the needs-you
 * queue ON the line as lit chips by kind (click one → its ranked items with
 * their actions), and every timer BELOW it placed by time-to-go (1h / 6h / 24h,
 * each with its own buttons). A dock on the right holds the game clock + scene,
 * AT THE TABLE (compact rows, click → why + fixes), quick actions and the tiles.
 * The rules are the pure utils/overviewModel.js (nowLineLayout, rankNeeds,
 * assessPlayer…); this file only gathers and wires. A DOM clock moves the future
 * rows and ticks the labels every 15 s without a re-render.
 *
 * Cross-parent dependencies:
 *   - this.app._activeTab        — written by switchTab actions
 *   - this.app.tabs.security     — heat / countdowns / plants gatherers (reused)
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log, getPlayerCharacters, isHiddenCharacter, resolveDisplayName, formatCyberDate } from '../../../utils/helpers.js';
import { adminConfirm } from '../../../utils/adminTheme.js';
import { showNamePicker } from '../../../utils/namePicker.js';
import { MessageRepository } from '../../../data/MessageRepository.js';
import { identityRole } from '../../../utils/identities.js';
import { getInitials } from '../../../utils/designHelpers.js';
import { tagHue } from '../../../utils/tagHue.js';
import {
  rankNeeds, agoLabel, untilLabel, mergeActivity, filterFeed, dismissKey,
  assessPlayer, groupByScene, sceneNetworks, tableSummary, barList,
  nowLineLayout, RUNWAY_ZOOMS, NL_TRACK_PX, NOW_PCT, leftLabel, timerUrgency,
} from '../../../utils/overviewModel.js';
import { BaseTab } from '../BaseTab.js';
import { isAnswered, convKey } from './messagesModel.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class OverviewTab extends BaseTab {

  /** @type {Array<object>} Session events from the EventBus (network switches, contacts…) */
  _activityLog = [];
  /** @type {Set<string>} Dismissed "needs you" items, keyed `key|signature` (session only) */
  _dismissedAlerts = new Set();
  /** @type {string} The need KIND whose chip is open on the line ('all' = none open) */
  _needFilter = 'all';
  /** @type {string} Activity filter: all | mail | hack | shard (narrows the past zone) */
  _feedFilter = 'all';
  /** @type {string|null} At the table: the user whose "why" panel is open (one at a time; survives re-renders) */
  _tableOpen = null;
  /** The line's future half: zoom in game minutes, hidden timer kinds, the timer whose facts are open. */
  _rwZoom = 60;
  _rwOff = new Set();
  _rwSel = null;
  /** The line's DOM clock (moves future rows + ticks labels between renders) — cleared on every render + close. */
  _rwTimer = null;

  get key() { return 'overview'; }

  _now() {
    try { return game.nightcity?.timeService?.getCurrentTimeMs?.() ?? Date.now(); } catch { return Date.now(); }
  }

  /**
   * @param {object} stats            — parent _gatherStats (actorStats: unread per actor)
   * @param {Array}  shards           — ShardsTab rows
   * @param {Array}  scheduledEntries — formatted scheduled entries
   * @param {Array}  sceneStrip       — NetworksTab scenes
   */
  prepareContext(stats, shards, scheduledEntries, sceneStrip) {
    if (this.app._activeTab !== 'overview') return { ov: null };
    const now = this._now();
    const mail = this._scanMail();
    const needsAll = rankNeeds(this._gatherNeeds({ stats, shards, scheduledEntries, sceneStrip, mail, now }), this._dismissedAlerts);
    const feedAll = this._gatherFeed(mail, now);
    const scene = game.scenes?.viewed;
    const sceneDead = !!scene?.getFlag?.(MODULE_ID, 'deadZone');
    const iso = game.nightcity?.timeService?.getCurrentTime?.() || new Date(now).toISOString();
    return {
      ov: {
        clock: formatCyberDate(iso),
        time: formatCyberDate(iso, { timeOnly: true }),
        date: formatCyberDate(iso, { dateOnly: true }),
        sceneName: scene?.name || '',
        sceneDead,
        nl: this._nowLine({ needs: needsAll, feed: filterFeed(feedAll, this._feedFilter), scheduledEntries, mail, now }),
        table: this._gatherTable(stats),
        tiles: this._gatherTiles(stats, shards, mail, now),
      },
    };
  }

  /**
   * Append a session event (EventBus subscriptions on the parent). These are
   * folded into the activity feed alongside the durable rows.
   */
  logActivity(domain, icon, html, options = {}) {
    this._activityLog.unshift({
      domain, icon, html, ts: this._now(),
      actorId: options.actorId || null, itemId: options.itemId || null,
    });
    if (this._activityLog.length > 30) this._activityLog.length = 30;
  }

  // ═══════════════════════════════════════════════════════════
  //  One pass over every inbox
  // ═══════════════════════════════════════════════════════════

  /**
   * Every inbox's messages, once: { inboxes: [{ownerId, isContact, isPlayer, name, msgs}],
   * viaByBase } — `viaByBase` is the terminal "sent via" note, stored on the
   * sender's sent copy only, keyed by base message id so a received copy can show it.
   */
  _scanMail() {
    const repo = game.nightcity?.messageRepository;
    const mcs = this.masterContactService;
    const inboxes = [];
    const viaByBase = new Map();
    for (const journal of game.journal ?? []) {
      const who = MessageRepository.identifyInbox(journal);
      if (!who) continue;
      const actor = who.isContact ? null : game.actors?.get(who.ownerId);
      const contact = who.isContact ? mcs?.getContact?.(who.ownerId) : null;
      const linked = contact?.actorId ? game.actors?.get(contact.actorId) : null;
      const isPlayer = !!(actor?.hasPlayerOwner || linked?.hasPlayerOwner);
      const msgs = [];
      for (const page of journal.pages ?? []) {
        const m = repo?._pageToMessage?.(page);
        if (!m || m.status?.deleted) continue;
        m._ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
        msgs.push(m);
        const id = String(m.messageId || '');
        if (m.sentVia && id.endsWith('-sent')) {
          viaByBase.set(id.slice(0, -5), { machine: m.sentVia.machine || 'a terminal', typist: m.sentVia.operatorName || 'someone', impersonated: m.sentVia.impersonated !== false, ts: m._ts, as: m.fromContactId || m.fromActorId, to: m.to });
        }
      }
      inboxes.push({ ownerId: who.ownerId, isContact: who.isContact, isPlayer, name: actor?.name || contact?.name || 'Unknown', actor, contact, msgs });
    }
    return { inboxes, viaByBase };
  }

  _senderName(m) {
    return resolveDisplayName({ contactId: m.fromContactId, actorId: m.fromActorId, email: m.from }, m.from || 'Unknown');
  }

  /** A player typed it: the sender's character is player-owned, or a terminal impersonation. */
  _fromPlayer(m, viaByBase) {
    if (m.fromActorId && game.actors?.get(m.fromActorId)?.hasPlayerOwner) return true;
    return !!viaByBase.get(String(m.messageId || ''))?.impersonated;
  }

  // ═══════════════════════════════════════════════════════════
  //  NEEDS YOU
  // ═══════════════════════════════════════════════════════════

  _gatherNeeds({ stats, shards, scheduledEntries, sceneStrip, mail, now }) {
    const out = [];
    const sec = this.app.tabs?.security;
    const ts = game.nightcity?.traceService;
    const mcs = this.masterContactService;
    const all = mcs?.getAll?.() || [];

    // ── Player mail waiting on an NPC (per NPC, per alias it was addressed to) ──
    for (const g of this._npcMailGroups(mail)) {
      if (!g.waiting) continue;
      const latest = g.latest;
      out.push({
        kind: 'mail', key: `mail-${g.ownerId}-${g.aliasId || ''}`, sig: `${latest.messageId}|${g.waiting}`, count: g.waiting, ts: latest._ts,
        icon: g.aliasName ? 'fa-masks-theater' : 'fa-reply',
        html: `<b>${esc(g.senders.join(', '))}</b> wrote to <b>${esc(g.aliasName || g.name)}</b>${g.aliasName ? ` (alias of ${esc(g.name)})` : ''} — ${g.waiting} unanswered`,
        subline: `${agoLabel(latest._ts, now)} ago · "${esc(latest.subject || '(no subject)')}"`,
        actions: [
          // Jump into Messages → Needs a reply on THIS conversation (same key).
          { label: 'Reply', action: 'tabAct', primary: true, data: { owner: 'messages', op: 'openConversation', key: convKey(g.ownerId, g.aliasId) } },
          { label: `Reply as ${g.aliasName || g.name}`, action: 'ovReplyAs', data: { 'message-id': latest.messageId, 'inbox-id': g.ownerId } },
          { label: 'Open', action: 'ovOpenInboxOf', data: { 'inbox-id': g.ownerId } },
        ],
      });
    }

    // ── Heat (hot / burned) ──
    if (sec && ts) {
      for (const h of (sec._gatherHeat?.(ts)?.hot || []).filter(r => r.value >= 50)) {
        const burned = h.value >= 80;
        out.push({
          kind: burned ? 'burned' : 'hot', key: `heat-${h.objectId}-${h.actorId}`, sig: burned ? 'burned' : 'hot', ts: now,
          icon: 'fa-fire',
          html: `Heat <b>${burned ? 'BURNED' : 'HOT'}</b> — ${esc(h.actorName)} on <b>${esc(h.objectName)}</b>`,
          subline: `<span class="ncm-ov2-heat"><span><i style="width:${Math.min(100, h.value)}%"></i></span>${h.value}</span>`,
          actions: [
            { label: 'Escalate', action: 'securityEscalate', primary: true, danger: true, data: { 'object-id': h.objectId, 'actor-id': h.actorId, 'object-name': h.objectName, 'actor-name': h.actorName } },
            { label: 'Security', action: 'switchTab', data: { tab: 'security' } },
          ],
        });
      }
      // ── Trace countdowns ──
      for (const c of (ts.getCountdowns?.() || [])) {
        out.push({
          kind: 'countdown', key: `cd-${c.id}`, sig: '', ts: now,
          icon: 'fa-stopwatch',
          html: `<b>${esc((c.source || '').trim() || 'A trace')}</b> closes in on <b>${esc(c.actorName || 'someone')}</b> <span class="ncm-ov2-tick">${untilLabel(c.expiresAt, now)}</span>`,
          subline: `${esc(c.objectName || '')} · runs on game time`,
          actions: [{ label: 'Call off', action: 'securityCountdownCancel', primary: true, danger: true, data: { 'countdown-id': c.id } }],
        });
      }
      // ── Armed plants / residents ──
      for (const p of (sec._gatherPlants?.() || []).filter(r => r.state === 'armed')) {
        out.push({
          kind: 'plant', key: `plant-${p.itemId}-${p.id}`, sig: '', ts: now,
          icon: 'fa-bomb',
          html: `Armed <b>${esc(p.name)}</b> on <b>${esc(p.hostName)}</b> fires ${esc(p.trigger || 'on its trigger')}`,
          subline: `planted by ${esc(p.by)}${p.forge ? ` · ${esc(p.forge)}` : ''}`,
          actions: [
            { label: 'Fire now', action: 'securityFireResident', primary: true, data: { 'item-id': p.itemId, 'resident-id': p.id } },
            { label: 'Defuse', action: 'securityDefuse', data: { 'item-id': p.itemId, 'resident-id': p.id } },
          ],
        });
      }
    }

    // ── Impersonations (last 24h of game time) ──
    for (const [base, v] of mail.viaByBase) {
      if (!v.impersonated || now - (v.ts || 0) > 86400000) continue;
      const asName = resolveDisplayName({ contactId: v.as, actorId: v.as }, 'someone');
      out.push({
        kind: 'imp', key: `imp-${base}`, sig: '', ts: v.ts,
        icon: 'fa-user-secret',
        html: `<b>${esc(v.typist)}</b> sent mail <b>as ${esc(asName)}</b> from ${esc(v.machine)}`,
        subline: `to ${esc(v.to || '?')} · ${agoLabel(v.ts, now)} ago`,
        actions: [{ label: 'Messages', action: 'switchTab', primary: true, data: { tab: 'messages' } }],
      });
    }

    // ── Bricked shards ──
    for (const s of (shards || []).filter(x => x.status === 'destroyed')) {
      out.push({
        kind: 'bricked', key: `bricked-${s.itemId}`, sig: '', ts: now,
        icon: 'fa-heart-crack',
        html: `Shard <b>${esc(s.name)}</b> is bricked (integrity 0%)`,
        subline: s.ownerName ? `in ${esc(s.ownerName)}'s gear` : 'a world item',
        actions: [{ label: 'Open', action: 'openShardItem', primary: true, data: { 'item-id': s.itemId } }],
      });
    }

    // ── Scheduled mail about to fire ──
    for (const e of (scheduledEntries || []).filter(x => x.isSoon)) {
      out.push({
        kind: 'sched', key: `sched-${e.id}`, sig: '', ts: now,
        icon: 'fa-clock',
        html: `Scheduled mail fires in <b>${esc(e.countdown)}</b>`,
        subline: `${esc(e.fromName)} → ${esc(e.toName)} · "${esc(e.subject)}"`,
        actions: [{ label: 'Cancel', action: 'cancelScheduled', primary: true, data: { 'schedule-id': e.id } }],
      });
    }

    // ── Setup: players with no address ──
    const emailSvc = game.nightcity?.emailService;
    for (const pc of getPlayerCharacters()) {
      if (emailSvc?.hasEmail?.(pc.actor)) continue;
      out.push({
        kind: 'setup', key: `noemail-${pc.actorId}`, sig: '', ts: now,
        icon: 'fa-at',
        html: `<b>${esc(pc.actorName)}</b> has no email address yet`,
        subline: `they can't send or receive until one is set${pc.playerName ? ` · played by ${esc(pc.playerName)}` : ''}`,
        actions: [{ label: 'Set one', action: 'ovSetEmail', primary: true, data: { 'actor-id': pc.actorId } }],
      });
    }

    // ── The viewed scene is a dead zone ──
    const scene = game.scenes?.viewed;
    if (scene?.getFlag?.(MODULE_ID, 'deadZone')) {
      out.push({
        kind: 'deadzone', key: `dz-${scene.id}`, sig: '', ts: now,
        icon: 'fa-ban',
        html: `<b>${esc(scene.name)}</b> is a dead zone`,
        subline: 'no signal — players\' mail queues until they leave it',
        actions: [{ label: 'Networks', action: 'switchTab', data: { tab: 'networks' } }],
      });
    }

    return out.map(n => ({ ...n, dismissKey: dismissKey(n), actions: (n.actions || []).map(a => ({ ...a, dataAttrs: Object.entries(a.data || {}).map(([k, v]) => ({ k, v })) })) }));
  }

  /**
   * Player mail received by NPCs, grouped per NPC inbox and per alias it was
   * addressed to: { ownerId, name, aliasId, aliasName, waiting, total, latest, senders }.
   */
  _npcMailGroups(mail) {
    const all = this.masterContactService?.getAll?.() || [];
    const groups = new Map();
    // "Waiting" = not answered — the same rule as Messages → Needs a reply
    // (messagesModel.isAnswered: an NPC reply after it, or the GM's ✓ mark).
    let answered = {};
    try { answered = game.settings.get(MODULE_ID, 'npcMailAnswered') || {}; } catch { /* not registered yet */ }
    for (const box of mail.inboxes) {
      if (box.isPlayer) continue;
      const sent = box.msgs.filter(x => x.status?.sent || String(x.messageId || '').endsWith('-sent'));
      for (const m of box.msgs) {
        const id = String(m.messageId || '');
        if (m.status?.sent || id.endsWith('-sent') || m.status?.spam) continue;
        if (!this._fromPlayer(m, mail.viaByBase)) continue;
        const toC = all.find(c => c.id === m.toContactId);
        const alias = toC && identityRole(all, toC)?.isAlias ? toC : null;
        const key = `${box.ownerId}|${alias?.id || ''}`;
        let g = groups.get(key);
        if (!g) { g = { ownerId: box.ownerId, isContact: box.isContact, name: box.name, aliasId: alias?.id || '', aliasName: alias?.name || '', waiting: 0, total: 0, latest: null, senders: [] }; groups.set(key, g); }
        g.total++;
        if (!isAnswered(m, sent, answered)) g.waiting++;
        if (!g.latest || m._ts > g.latest._ts) g.latest = m;
        const who = this._senderName(m);
        if (!g.senders.includes(who)) g.senders.push(who);
      }
    }
    return [...groups.values()].filter(g => g.latest);
  }

  // ═══════════════════════════════════════════════════════════
  //  AT THE TABLE · TILES · CHARACTERS
  // ═══════════════════════════════════════════════════════════

  /**
   * AT THE TABLE (2026-10-27, dev-approved mock admin-guides-v5-mock.html "table"):
   * every player's character, grouped by the scene their USER is looking at,
   * with the few facts that decide whether their Agent works. The rules (status
   * word, grouping) are overviewModel.assessPlayer / groupByScene.
   */
  _gatherTable(stats) {
    const nets = game.nightcity?.playerNetworks;
    const netSvc = this.networkService;
    const allNets = netSvc?.getAllNetworks?.() || [];
    const emailSvc = game.nightcity?.emailService;
    const queue = this.messageService?.getQueue?.() || [];
    const groups = game.nightcity?.contactGroupService?.getMasterGroups?.() || [];
    const sceneOf = (id) => (id ? game.scenes?.get?.(id) : null);
    const players = [];
    const scenes = new Map();
    for (const user of game.users ?? []) {
      if (user.isGM) continue;
      const actor = user.character || game.actors?.find?.(a => a.hasPlayerOwner && !isHiddenCharacter(a.id) && a.ownership?.[user.id] >= 3) || null;
      if (!actor && !user.active) continue;
      const online = !!user.active;
      const sceneId = online ? (user.viewedScene || '') : '';
      const scene = sceneOf(sceneId);
      if (scene && !scenes.has(scene.id)) scenes.set(scene.id, this._tableScene(scene, allNets));
      const known = online ? nets?.get?.(user.id) : null;
      const network = known ? netSvc?.getNetwork?.(known.networkId) : null;
      const netName = known ? (network?.name || known.networkId) : '';
      const signal = network ? Number(network.signalStrength ?? 75) || 0 : 0;
      const address = actor ? (emailSvc?.getEmail?.(actor) || '') : '';
      const contacts = actor ? (actor.getFlag?.(MODULE_ID, 'contacts') || []).length : 0;
      const unread = stats.actorStats.find(s => s.actorId === actor?.id)?.unreadMessages || 0;
      const heldRows = queue.filter(q => (q.remote && q.userId === user.id) || (actor && q.fromActorId === actor.id));
      const held = new Set(heldRows.map(q => q.messageId)).size;
      const dead = !!scene?.getFlag?.(MODULE_ID, 'deadZone');
      const a = assessPlayer({
        online, playerName: user.name, address, deadZone: dead, sceneName: scene?.name || '',
        network: netName, signal, contacts, unread, held,
      });
      const name = actor?.name || '(no character)';
      const hue = tagHue(name);
      players.push({
        userId: user.id, actorId: actor?.id || '', playerName: user.name, online, sceneId: scene?.id || '',
        name, img: this._img(actor), initials: getInitials(name), hue,
        address, contacts, unread, held, network: netName, signal, bars: barList(signal), netHue: tagHue(netName),
        tone: a.tone, status: a.status, facts: a.facts, needsYou: a.needsYou, dead: a.dead, onNet: a.onNet, weak: a.weak,
        isOpen: this._tableOpen === user.id,
        fixes: actor ? this._tableFixes(a.fixes, groups) : [],
      });
    }
    players.sort((x, y) => (y.online - x.online) || x.name.localeCompare(y.name));
    if (this._tableOpen && !players.some(p => p.userId === this._tableOpen)) this._tableOpen = null;
    const viewedId = game.scenes?.viewed?.id || '';
    const bands = groupByScene(players, [...scenes.values()], viewedId)
      .map(b => ({ ...b, open: b.players.find(p => p.isOpen) || null }));
    const sum = tableSummary(players);
    // The dock's compact list: one row per player with the scene in words (the bands stay for callers that read them).
    const list = players.map(p => { const sc = scenes.get(p.sceneId); return { ...p, sceneName: sc?.name || '', sceneDead: !!sc?.deadZone, you: !!p.sceneId && p.sceneId === viewedId }; });
    return { scenes: bands, players: list, hasPlayers: players.length > 0, online: sum.online, need: sum.need };
  }

  /** A scene band: name, dead zone, the networks that reach it (with signal). */
  _tableScene(scene, allNets) {
    const deadZone = !!scene.getFlag?.(MODULE_ID, 'deadZone');
    const list = sceneNetworks(allNets, { id: scene.id, deadZone, availability: scene.getFlag?.(MODULE_ID, 'networkAvailability') || {} });
    return { id: scene.id, name: scene.name, deadZone, nets: list.map(n => ({ ...n, hue: tagHue(n.name) })) };
  }

  /** Fix keys (overviewModel.assessPlayer) → the buttons the "why" panel shows. */
  _tableFixes(keys, groups) {
    const out = [];
    for (const k of keys) {
      if (k === 'setEmail') out.push({ op: 'tblSetEmail', label: 'Set an address', primary: true });
      if (k === 'deliver') out.push({ op: 'tblDeliver', label: 'Deliver it now', primary: true });
      if (k === 'share') {
        if (groups.length === 1) out.push({ op: 'tblShareGroup', label: `Share ${groups[0].name}`, primary: true, groupId: groups[0].id });
        else if (groups.length > 1) out.push({ op: 'tblShareGroup', label: 'Share a group', primary: true, groupId: '' });
        out.push({ op: 'tblShareContacts', label: 'Share contacts', primary: !groups.length });
      }
    }
    return out;
  }

  _img(actor) {
    const img = actor?.img || '';
    return img && !img.includes('mystery-man') ? img : null;
  }

  _gatherTiles(stats, shards, mail, now) {
    const mcs = this.masterContactService;
    const all = mcs?.getAll?.() || [];
    const day = now - 86400000;
    const received = mail.inboxes.flatMap(b => b.msgs.filter(m => !String(m.messageId || '').endsWith('-sent')));
    const nets = this.networkService?.getAllNetworks?.() || [];
    const ts = game.nightcity?.traceService;
    const tsvc = game.nightcity?.terminalService;
    const terminals = tsvc?.collectTerminals?.() || [];
    const loggedIn = terminals.reduce((n, it) => n + Object.values(tsvc.getState(it)?.sessions || {}).filter(s => s?.activeAccountId).length, 0);
    const accounts = terminals.reduce((n, it) => n + (tsvc.getConfig(it).accounts || []).length, 0);
    const heat = this.app.tabs?.security?._gatherHeat?.(ts) || { hot: [] };
    const groups = (game.nightcity?.contactGroupService?.getMasterGroups?.() || []).length;
    const deadScenes = (game.scenes ?? []).filter(s => s.getFlag?.(MODULE_ID, 'deadZone')).length;
    // Each tile wears its own fixed category hue (which tab, not what is wrong — a
    // tile's red line is the only meaning colour on it).
    return [
      { tab: 'messages', icon: 'fa-envelope', color: 'var(--ncm-hue-2)', label: 'Messages', n: stats.totalMessages,
        lines: [`<b>${stats.unreadMessages}</b> unread · <b>${received.filter(m => m._ts >= day).length}</b> today`] },
      { tab: 'contacts', icon: 'fa-address-book', color: 'var(--ncm-hue-1)', label: 'Contacts', n: all.length,
        lines: [`<b>${all.filter(c => identityRole(all, c)?.isAlias).length}</b> aliases · <b>${groups}</b> groups`] },
      { tab: 'networks', icon: 'fa-network-wired', color: 'var(--ncm-hue-3)', label: 'Networks', n: nets.length,
        lines: [`<b>${nets.filter(n => n.enabled !== false).length}</b> live`], bad: deadScenes ? `${deadScenes} dead zone${deadScenes === 1 ? '' : 's'}` : '' },
      { tab: 'shards', icon: 'fa-microchip', color: 'var(--ncm-hue-6)', label: 'Shards', n: (shards || []).length,
        lines: [`<b>${(shards || []).filter(s => s.status === 'locked' || s.status === 'blackice').length}</b> locked · <b>${(shards || []).filter(s => s.makerName).length}</b> player-made`],
        bad: (() => { const b = (shards || []).filter(s => s.status === 'destroyed').length; return b ? `${b} bricked` : ''; })() },
      { tab: 'terminals', icon: 'fa-terminal', color: 'var(--ncm-hue-8)', label: 'Terminals', n: terminals.length,
        lines: [`<b>${loggedIn}</b> logged in · <b>${accounts}</b> accounts`] },
      { tab: 'security', icon: 'fa-shield-halved', color: 'var(--ncm-hue-7)', label: 'Security', n: (ts?.getLog?.() || []).filter(r => new Date(r.ts).getTime() >= day).length,
        lines: ['events in 24h'], bad: heat.hot.filter(h => h.value >= 50).length ? `${heat.hot.filter(h => h.value >= 50).length} running hot` : '' },
    ];
  }

  // ═══════════════════════════════════════════════════════════
  //  THE LINE — recent activity (the past) · every timer (the future)
  // ═══════════════════════════════════════════════════════════

  _gatherFeed(mail, now) {
    const rows = [];
    // Mail — the received copy of each message (sent copies would double it).
    for (const box of mail.inboxes) {
      for (const m of box.msgs) {
        const id = String(m.messageId || '');
        if (id.endsWith('-sent') || m.status?.spam) continue;
        const via = mail.viaByBase.get(id);
        rows.push({
          group: 'mail', ts: m._ts, icon: via?.impersonated ? 'fa-user-secret' : (m.eddies ? 'fa-coins' : 'fa-envelope'), kind: via?.impersonated ? 'imp' : 'mail',
          html: `<b>${esc(this._senderName(m))}</b> → <b>${esc(box.name)}</b>${m.eddies ? ` · ${Number(m.eddies).toLocaleString()} eb` : ''}`,
          subline: via?.impersonated ? `typed by ${esc(via.typist)} via ${esc(via.machine)} · "${esc(m.subject || '')}"` : `"${esc(m.subject || '(no subject)')}"`,
          tag: via?.impersonated ? 'impersonation' : (via ? 'terminal' : ''),
        });
      }
    }
    // The Security log — hacks, logins, plants, terminal sends, shard cracks…
    for (const r of (game.nightcity?.traceService?.getLog?.() || []).slice(-60)) {
      const isShard = r.targetKind === 'shard';
      rows.push({
        group: isShard ? 'shard' : 'hack', ts: new Date(r.ts).getTime() || 0,
        icon: r.outcome === 'success' ? (isShard ? 'fa-unlock' : 'fa-terminal') : 'fa-skull',
        kind: r.outcome === 'success' ? (isShard ? 'shard' : 'hack') : 'trace',
        html: `<b>${esc(r.actorName || 'Someone')}</b> ${esc(String(r.action || 'acted').replace(/-/g, ' '))} — <b>${esc(r.objectName || r.source || '')}</b>`,
        subline: [r.source && r.source !== r.objectName ? esc(r.source) : '', r.outcome === 'success' ? '' : `+${r.heatDelta || 0} heat`].filter(Boolean).join(' · '),
        tag: r.outcome === 'success' ? (isShard ? 'shard' : 'terminal') : 'trace',
      });
    }
    // Session events (network switches, contacts…) — this session only.
    for (const e of this._activityLog) rows.push({ group: 'other', ts: e.ts, icon: `fa-${e.icon}`, kind: 'other', html: e.html, subline: '', tag: '' });
    return mergeActivity([rows], 40).map(r => ({ ...r, ago: agoLabel(r.ts, now) }));
  }

  /**
   * Every timer on the game clock, one shape for the runway:
   * { id, kind, name, subline, at, lines:[{k,v,mono}], actions:[{label, icon, tone, action, data}] }.
   * The actions are the EXISTING handlers (Messages tab ops, Security's Call off, the
   * panel's cancel/edit/hard-delete) plus two runway ops that call existing services
   * (Lift = SecurityService.clearFor, Close now = TerminalService.removeAccount).
   */
  _gatherTimers(scheduledEntries, mail, now) {
    const out = [];
    const realNow = Date.now();
    // ── Scheduled mail (game-time entries sit on the game clock; real-time ones by what is left) ──
    for (const e of (scheduledEntries || [])) {
      const due = e.deliveryTime ? new Date(e.deliveryTime).getTime() : 0;
      if (!due) continue;
      const at = e.useGameTime === false ? now + (due - realNow) : due;
      out.push({
        id: `mail:${e.id}`, kind: 'mail', at, name: `"${e.subject || '(no subject)'}"`, subline: `${e.fromName} → ${e.toName}`,
        lines: [{ k: 'From', v: e.fromName }, { k: 'To', v: e.toName }, { k: 'Clock', v: e.useGameTime === false ? 'Real time' : 'Game time' }],
        actions: [
          { label: 'Send now', icon: 'fa-paper-plane', tone: 'pri', action: 'tabAct', data: { owner: 'messages', op: 'schedSendNow', 'schedule-id': e.id } },
          { label: 'Change time', icon: 'fa-clock', tone: '', action: 'editScheduled', data: { 'schedule-id': e.id } },
          { label: 'Cancel', icon: 'fa-xmark', tone: 'bad', action: 'cancelScheduled', data: { 'schedule-id': e.id } },
        ],
      });
    }
    // ── Trace countdowns ──
    for (const c of (game.nightcity?.traceService?.getCountdowns?.() || [])) {
      const who = (c.source || '').trim() || 'A trace';
      out.push({
        id: `trace:${c.id}`, kind: 'trace', at: Number(c.expiresAt) || 0, name: `${who} closing in on ${c.actorName || 'someone'}`, subline: `Trace · ${c.objectName || ''}`,
        lines: [{ k: 'Who', v: who }, { k: 'Target', v: c.actorName || 'someone' }, { k: 'From', v: c.objectName || '' }, { k: 'Why', v: c.reason || '' }],
        actions: [{ label: 'Call off', icon: 'fa-ban', tone: 'pri', action: 'securityCountdownCancel', data: { 'countdown-id': c.id } }],
      });
    }
    // ── Self-destructing mail (timed modes; "after read" has no clock) ──
    for (const box of mail.inboxes) {
      for (const m of box.msgs) {
        const exp = m.selfDestruct?.expiresAt ? new Date(m.selfDestruct.expiresAt).getTime() : 0;
        if (!(exp > now) || String(m.messageId || '').endsWith('-sent')) continue;
        out.push({
          id: `destruct:${m.messageId}`, kind: 'destruct', at: exp, name: `"${m.subject || '(no subject)'}"`, subline: `In ${box.name}'s inbox`,
          lines: [{ k: 'From', v: m.anonymous?.enabled ? 'Anonymous' : this._senderName(m) }, { k: 'To', v: box.name }, { k: 'Mode', v: `${m.selfDestruct.mode || 'timed'} after sending` }],
          actions: [
            { label: 'Erase now', icon: 'fa-fire', tone: 'bad', action: 'hardDeleteMessage', data: { 'message-id': m.messageId, 'inbox-owner': box.ownerId } },
            { label: 'Stop', icon: 'fa-hand', tone: '', action: 'tabAct', data: { owner: 'messages', op: 'stopTimer', 'journal-id': m._journalId || '', 'page-id': m._pageId || '' } },
          ],
        });
      }
    }
    // ── Forged backdoor accounts ──
    const tsvc = game.nightcity?.terminalService;
    for (const it of (tsvc?.collectTerminals?.() || [])) {
      const cfg = tsvc.getConfig(it);
      for (const a of (cfg.accounts || [])) {
        const exp = a.forged?.expiresAt ? new Date(a.forged.expiresAt).getTime() : 0;
        if (!(exp > now)) continue;
        out.push({
          id: `backdoor:${it.id}:${a.id}`, kind: 'backdoor', at: exp, name: `"${a.username || a.displayName}" on ${cfg.terminalName || it.name} closes`, subline: cfg.terminalName || it.name,
          lines: [{ k: 'Made by', v: a.forged.byName || 'Unknown' }, { k: 'On', v: `${cfg.terminalName || it.name} (hidden account)` }, { k: 'Login', v: a.username || '', mono: true }],
          actions: [{ label: 'Close now', icon: 'fa-door-closed', tone: 'bad', action: 'tabAct', data: { owner: 'overview', op: 'rwClose', 'item-id': it.id, 'account-id': a.id } }],
        });
      }
    }
    // ── Lockouts (this client's own + what players reported) ──
    const sec = game.nightcity?.securityService;
    const seen = new Set();
    const locks = [...(sec?.getActiveLockouts?.() || []), ...Array.from(sec?._remote?.values?.() || [])];
    const lockNow = sec?._nowMs?.() ?? now;
    for (const l of locks) {
      const key = `${l.actorId}::${l.targetId}`;
      if (!l.lockoutUntil || l.lockoutUntil <= lockNow || seen.has(key)) continue;
      seen.add(key);
      const who = game.actors?.get(l.actorId)?.name || 'Someone';
      const on = this._lockLabel(l.targetId);
      out.push({
        id: `lockout:${key}`, kind: 'lockout', at: now + (l.lockoutUntil - lockNow), name: `${who} locked out of ${on}`,
        subline: `Lockout · ${String(l.targetId).includes('::') ? 'terminal' : 'network'}`,
        lines: [{ k: 'Who', v: who }, { k: 'On', v: on }, { k: 'Why', v: l.reason || (l.forced ? 'Escalation by you' : 'Too many failed tries') }],
        actions: [{ label: 'Lift now', icon: 'fa-unlock', tone: 'pri', action: 'tabAct', data: { owner: 'overview', op: 'rwLift', 'lock-actor': l.actorId, 'lock-target': l.targetId } }],
      });
    }
    return out;
  }

  /** A lockout target in words: a network, "Terminal · account", or a shard. */
  _lockLabel(targetId) {
    const net = this.networkService?.getNetwork?.(targetId);
    if (net?.name) return net.name;
    const [itemId, acctId] = String(targetId || '').split('::');
    let item = game.items?.get?.(itemId) || null;
    if (!item) for (const a of (game.actors ?? [])) { item = a.items?.get?.(itemId); if (item) break; }
    if (!item) return String(targetId || 'something');
    const acct = acctId ? game.nightcity?.terminalService?.getAccount?.(item, acctId) : null;
    return acct ? `${item.name} · ${acct.displayName || acct.username}` : item.name;
  }

  /** The track's height (px) — the pop-out is taller; tab-overview.css sets the same numbers. */
  static TRACK_PX = NL_TRACK_PX;
  static TRACK_PX_POP = 680;

  /** The NOW LINE view-model: the past (activity), the chips (needs), the future (timers). */
  _nowLine({ needs, feed, scheduledEntries, mail, now }) {
    const nl = nowLineLayout({
      activity: feed, needs, timers: this._gatherTimers(scheduledEntries, mail, now), nowMs: now,
      zoom: this._rwZoom, open: this._needFilter, sel: this._rwSel, off: this._rwOff,
      trackPx: this.isPopout ? OverviewTab.TRACK_PX_POP : OverviewTab.TRACK_PX,
      clock: (ms) => formatCyberDate(new Date(ms).toISOString(), { timeOnly: true }),
    });
    nl.feedFilter = this._feedFilter;
    return nl;
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  // ─── AT THE TABLE: tabAct ops (data-action="tabAct" data-owner="overview" data-op="…") ───

  /** The ops the At-the-table cards fire. The sim asserts every one in the template is here. */
  static TABLE_OPS = Object.freeze(['tblToggle', 'tblClose', 'tblSetEmail', 'tblDeliver', 'tblShareContacts', 'tblShareGroup', 'tblInbox', 'tblWrite', 'tblContacts']);
  /** The ops the line's future half fires (zoom, hide a timer kind, open a timer's facts, lift a lockout, close a backdoor). */
  static RUNWAY_OPS = Object.freeze(['rwZoom', 'rwLane', 'rwPick', 'rwLift', 'rwClose', 'nlEarlier']);
  /** The dock's Quick verbs beyond the plain launchers (2026-10-28): a player's inbox, push a contact, a blank shard, the clock. */
  static QUICK_OPS = Object.freeze(['qInbox', 'qPush', 'qShard', 'qClock', 'qGuide']);

  /** The shipped Getting Started guide (docs/, in the module zip since 2026-10-29). */
  static GUIDE_PATH = 'modules/night-city-messenger/docs/NCM-Getting-Started.pdf';

  onAct(op, event, target) {
    const d = target?.closest?.('[data-user-id]')?.dataset || {};
    const userId = target?.dataset?.userId || d.userId || '';
    const actorId = target?.dataset?.actorId || target?.closest?.('[data-actor-id]')?.dataset.actorId || '';
    switch (op) {
      case 'tblToggle':
        this._tableOpen = this._tableOpen === userId ? null : (userId || null);
        return this.render(true);
      case 'tblClose':
        this._tableOpen = null;
        return this.render(true);
      case 'tblSetEmail': return this.onSetEmail(event, target);
      case 'tblDeliver': return this._deliverHeld(userId, actorId);
      case 'tblShareContacts': return this._shareContacts(actorId);
      case 'tblShareGroup': return this._shareGroup(actorId, target?.dataset?.groupId || '');
      case 'tblInbox': return actorId ? game.nightcity?.openInbox?.(actorId) : undefined;
      case 'tblWrite': return this.onWriteTo(event, target);
      case 'tblContacts': return this.app.tabs?.contacts?.onViewPlayerContacts?.(event, target);
      // ── The line's future half ──
      // ── Quick ──
      case 'qInbox': return this._quickInbox();
      case 'qGuide': {
        const route = (typeof foundry !== 'undefined' && foundry.utils?.getRoute) ? foundry.utils.getRoute(OverviewTab.GUIDE_PATH) : `/${OverviewTab.GUIDE_PATH}`;
        window.open(route, '_blank', 'noopener');
        return;
      }
      case 'qPush': return this._quickPush();
      case 'qShard': return this.app.tabs?.shards?._createBlankShard?.();
      case 'qClock': return this._quickClock(Number(target?.dataset?.add) || 0);
      case 'nlEarlier': {
        // "+N earlier" — the rows past the top of the line are mostly mail, so All mail (every message by date) is
        // where they live; the Security tab only holds the trace log, which read as "empty" when there was none.
        this.app.tabs?.messages?.openTo?.('view:all');
        this.app._activeTab = 'messages';
        return this.app.render(true);
      }
      case 'rwZoom': {
        const z = Number(target?.dataset?.zoom);
        if (RUNWAY_ZOOMS.some((x) => x.min === z)) this._rwZoom = z;
        return this.render(true);
      }
      case 'rwLane': {
        const k = target?.dataset?.kind;
        if (k) { if (this._rwOff.has(k)) this._rwOff.delete(k); else this._rwOff.add(k); }
        return this.render(true);
      }
      case 'rwPick': {
        const id = target?.closest?.('[data-timer-id]')?.dataset.timerId || null;
        this._rwSel = id && this._rwSel !== id ? id : null;   // a second click folds the facts away
        return this.render(true);
      }
      case 'rwLift': return this._liftLockout(target?.dataset?.lockActor, target?.dataset?.lockTarget);
      case 'rwClose': return this._closeBackdoor(target?.dataset?.itemId, target?.dataset?.accountId);
      default: log.warn(`Overview: unknown op ${op}`);
    }
  }

  /** Lift a lockout everywhere (SecurityService.clearFor — the Terminals tab's "Clear lockout"). */
  _liftLockout(actorId, targetId) {
    if (!actorId || !targetId) return;
    game.nightcity?.securityService?.clearFor?.(actorId, [targetId]);
    ui.notifications.info('NCM | Lockout lifted.');
    this.render(true);
  }

  /** Close a forged backdoor account now (what its expiry would do — TerminalService.removeAccount). */
  async _closeBackdoor(itemId, accountId) {
    const tsvc = game.nightcity?.terminalService;
    const item = (tsvc?.collectTerminals?.() || []).find((i) => i.id === itemId);
    const acct = item ? tsvc.getAccount?.(item, accountId) : null;
    if (!item || !acct) { ui.notifications.warn('NCM | That backdoor is already gone.'); return this.render(true); }
    const ok = await adminConfirm({ title: 'Close the backdoor', content: `<p>Close the backdoor account <b>${esc(acct.username || acct.displayName)}</b> on <b>${esc(item.name)}</b> now? Anyone using it is shut out.</p>` });
    if (!ok) return;
    await tsvc.removeAccount(item, accountId);
    ui.notifications.info('NCM | Backdoor closed.');
    this.render(true);
  }

  // ─── Quick: the dock's mid-session verbs ───

  /** The players' characters as picker rows (assigned first, then any a player owns — getPlayerCharacters' order). */
  _pcEntries() {
    return getPlayerCharacters().map((r) => ({ id: r.actorId, name: r.actorName, img: r.actor?.img || '', sub: r.playerName ? `played by ${r.playerName}` : 'no player', group: r.playerName || 'Unassigned' }));
  }

  /** Open a player character's inbox — the picker over the players' characters, then the Agent viewer. */
  async _quickInbox() {
    const entries = this._pcEntries();
    if (!entries.length) return ui.notifications.warn('NCM | No player characters in this world yet.');
    const pick = await showNamePicker({ title: 'Open an inbox', hint: 'Whose Agent do you want to read?', entries, placeholder: 'search characters…' });
    if (pick?.id) game.nightcity?.openInbox?.(pick.id);
  }

  /** Push a directory contact to a player character — two pickers, then MasterContactService.pushToPlayer (duplicate-safe). */
  async _quickPush() {
    const svc = this.masterContactService;
    const contacts = (svc?.getAll?.() || []).filter((c) => !c.sendOnly);
    if (!contacts.length) return ui.notifications.warn('NCM | The directory is empty — add a contact first.');
    const roleLabel = (c) => String(c.role || 'no role');
    const contact = await showNamePicker({
      title: 'Push a contact', hint: 'Pick who to share; then pick the character who gets them.',
      entries: contacts.map((c) => ({ id: c.id, name: c.name, img: c.portrait || '', sub: c.email || c.organization || '', group: roleLabel(c).charAt(0).toUpperCase() + roleLabel(c).slice(1) })),
      placeholder: 'search the directory…',
    });
    if (!contact?.id) return;
    const pcs = this._pcEntries();
    if (!pcs.length) return ui.notifications.warn('NCM | No player characters to share with.');
    const pc = await showNamePicker({ title: `Share ${contact.name} with…`, hint: 'The character gets a copy in their contacts; sharing again is a no-op.', entries: pcs, placeholder: 'search characters…' });
    if (!pc?.id) return;
    const res = await svc.pushToPlayer(contact.id, pc.id);
    if (res?.success) { ui.notifications.info(`NCM | ${contact.name} shared with ${pc.name}.`); this.app.render(true); }
    else ui.notifications.warn(`NCM | Could not share ${contact.name}: ${res?.error || 'unknown error'}`);
  }

  /**
   * Advance the GAME clock by `seconds` from the dock. Which clock depends on the time provider: manual → the
   * manual setting; world time / Simple Calendar → Foundry's world time (Simple Calendar follows it); real-world or
   * disguised time cannot be pushed forward from here, and the toast says where to change that.
   */
  async _quickClock(seconds) {
    const ts = game.nightcity?.timeService;
    if (!ts || !seconds) return;
    const mode = ts._mode === 'auto' ? (ts._autoResolved || 'real-time') : ts._mode;
    if (mode === 'manual') return ts.advanceManualTime(seconds);
    if (mode === 'world-time' || mode === 'simple-calendar') return game.time?.advance?.(seconds);
    ui.notifications.warn(`NCM | The clock follows ${mode === 'disguised' ? 'disguised real time' : 'real-world time'} — it cannot be advanced. Switch the time provider in Set time.`);
  }

  // ─── The line's clock: future rows move + labels tick between renders (DOM only, never a re-render) ───

  onRender() {
    this._stopRunwayClock();
    if (!this.app?.element?.querySelector?.('.ncm-ov2-nl[data-nl-zoom]')) return;
    this._rwTimer = setInterval(() => this._tickRunway(), 15000);
    // The two visible clocks (the NOW label and the dock's clock card) tick every second off the GAME clock,
    // so a real-time / disguised provider reads live and a manual one shows its set time at once; the line's
    // geometry still moves on the 15 s tick (2026-10-28, dev: "is anything that uses live time live?").
    this._clockTimer = setInterval(() => this._tickClocks(), 1000);
    this._tickClocks();
  }

  onClose() { this._stopRunwayClock(); }

  _stopRunwayClock() {
    if (this._rwTimer) { clearInterval(this._rwTimer); this._rwTimer = null; }
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
  }

  _tickClocks() {
    const root = this.app?.element;
    if (!root || root.isConnected === false) return this._stopRunwayClock();   // a detached window stops the clock; a stub with no isConnected does not
    const iso = new Date(this._now()).toISOString();
    const t = formatCyberDate(iso, { timeOnly: true }), d = formatCyberDate(iso, { dateOnly: true });
    const now = root.querySelector('[data-nl-clock]'); if (now && now.textContent !== t) now.textContent = t;
    const ct = root.querySelector('.ncm-ov2-clockcard__t'); if (ct && ct.textContent !== t) ct.textContent = t;
    const cd = root.querySelector('.ncm-ov2-clockcard__d'); if (cd && cd.textContent !== d) cd.textContent = d;
  }

  /**
   * Move every future row up the track by the game time that has passed since the
   * render (each keeps its laid-out offset, so the push-apart spacing holds), hide
   * the ones that have landed, tick every countdown and "ago" label, and the NOW clock.
   */
  _tickRunway() {
    const root = this.app?.element;
    const nl = root?.querySelector?.('.ncm-ov2-nl[data-nl-zoom]');
    if (!nl) return this._stopRunwayClock();
    const zoom = Number(nl.dataset.nlZoom) || 60;
    const renderedAt = Number(nl.dataset.nlNow) || 0;
    const now = this._now();
    const driftPct = ((now - renderedAt) / 60000) / zoom * (100 - NOW_PCT);
    for (const el of root.querySelectorAll('[data-nl-ev="f"][data-at]')) {
      const left = (Number(el.dataset.at) - now) / 60000;
      const top = Number(el.dataset.top) - driftPct;
      if (left <= 0 || top < NOW_PCT) { el.hidden = true; continue; }
      const urg = timerUrgency(left);
      el.style.top = `${top.toFixed(3)}%`;
      el.classList.toggle('is-bad', urg === 'bad');
      el.classList.toggle('is-attn', urg === 'attn');
      const em = el.querySelector('[data-nl-left]'); if (em) em.textContent = leftLabel(left);
    }
    for (const el of root.querySelectorAll('[data-nl-ev="p"][data-ts]')) {
      const ago = el.querySelector('[data-nl-ago]'); if (ago) ago.textContent = agoLabel(Number(el.dataset.ts), now);
    }
    for (const el of root.querySelectorAll('[data-rw-left][data-at]')) {
      const left = (Number(el.dataset.at) - now) / 60000;
      el.textContent = left > 0 ? leftLabel(left) : 'due';
      el.classList.toggle('is-bad', timerUrgency(left) === 'bad');
      el.classList.toggle('is-attn', timerUrgency(left) === 'attn');
    }
    const clock = root.querySelector('[data-nl-clock]');
    if (clock) clock.textContent = formatCyberDate(new Date(now).toISOString(), { timeOnly: true });
  }

  /** Deliver every message a player's Agent is holding (Messages → Outbox → Deliver now). */
  async _deliverHeld(userId, actorId) {
    const svc = this.messageService;
    const rows = (svc?.getQueue?.() || []).filter(q => (q.remote && q.userId === userId) || (actorId && q.fromActorId === actorId));
    const ids = [...new Set(rows.map(q => q.messageId).filter(Boolean))];
    if (!ids.length) { ui.notifications.info('NCM | Nothing is held for them any more.'); return this.render(true); }
    let n = 0, bad = null;
    for (const id of ids) {
      const r = await svc.forceDeliver(id);
      if (r?.success) n++; else bad = bad || r?.error || 'delivery failed';
    }
    if (n) ui.notifications.info(`NCM | Delivered ${n} held message${n === 1 ? '' : 's'}.`);
    if (bad) ui.notifications.warn(`NCM | Not delivered: ${bad}`);
    this.render(true);
  }

  /** Share contacts — the Contacts tab's own picker (Players → Share contacts). */
  async _shareContacts(actorId) {
    if (!actorId) return;
    await this.app.tabs?.contacts?._sharePickerFor?.(actorId);
    this.render(true);
  }

  /** Share a GM group: one group → push it; several → the Contacts tab's group picker. */
  async _shareGroup(actorId, groupId) {
    if (!actorId) return;
    const svc = game.nightcity?.contactGroupService;
    if (!groupId) { await this.app.tabs?.contacts?._pushGroupPickerFor?.(actorId); return this.render(true); }
    const group = svc?.getMasterGroup?.(groupId);
    const actor = game.actors?.get(actorId);
    const r = await svc?.pushGroupToPlayer?.(groupId, actorId);
    if (!r?.success) ui.notifications.warn(`NCM | ${r?.error || 'Push failed.'}`);
    else ui.notifications.info(`NCM | Shared "${group?.name || 'the group'}" with ${actor?.name || 'them'} (${r.shared} contacts).`);
    this.render(true);
  }

  async onOpenInbox(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    game.nightcity?.openInbox?.(actorId);
  }

  /** Open any inbox — a character's or a contact-only NPC's. */
  onOpenInboxOf(event, target) {
    const id = target.closest('[data-inbox-id]')?.dataset.inboxId;
    if (!id) return;
    game.nightcity?.openInbox?.(id);
  }

  onOpenAllInboxes() {
    for (const pc of getPlayerCharacters().slice(0, 4)) game.nightcity?.openInbox?.(pc.actorId);
  }

  onComposeAs(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (actor) game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
  }

  /** Write TO a player's character (from the GM's default sender). */
  onWriteTo(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (actorId) game.nightcity?.openComposer?.({ toActorId: actorId });
  }

  /**
   * Reply AS the NPC (or the alias the mail reached) to the latest waiting
   * message — the identities rules pick the alias automatically.
   */
  onReplyAs(event, target) {
    const { messageId, inboxId } = target.dataset;
    const box = this._scanMail().inboxes.find(b => b.ownerId === inboxId);
    const msg = box?.msgs.find(m => m.messageId === messageId);
    if (!msg) return ui.notifications.warn('That message is gone.');
    const opts = { mode: 'reply', originalMessage: msg };
    if (box.isContact) opts.fromContactId = box.ownerId; else opts.fromActorId = box.ownerId;
    game.nightcity?.openComposer?.(opts);
  }

  async onSetEmail(event, target) {
    const actor = game.actors?.get(target.closest('[data-actor-id]')?.dataset.actorId);
    if (actor) await game.nightcity?.openEmailSetup?.(actor);
    this.render(true);
  }

  /** A chip on the line: open that kind's items under it; the open chip again (or "all") folds them away. */
  onNeedFilter(event, target) {
    const k = target.dataset.filter || 'all';
    this._needFilter = k === 'all' || k === this._needFilter ? 'all' : k;
    this.render(true);
  }

  onFeedFilter(event, target) {
    this._feedFilter = target.dataset.filter || 'all';
    this.render(true);
  }

  onNewShard() {
    this.app._activeTab = 'shards';
    this.render(true);
  }

  onBroadcast() {
    this.app._activeTab = 'networks';   // Network Broadcast lives on the Networks tab
    this.render(true);
  }

  onClearAlerts() {
    for (const el of this.element?.querySelectorAll('[data-alert-key]') ?? []) {
      if (el.dataset.alertKey) this._dismissedAlerts.add(el.dataset.alertKey);
    }
    this.render(true);
  }

  onDismissAlert(event, target) {
    const key = target.closest('[data-alert-key]')?.dataset.alertKey;
    if (!key) return;
    this._dismissedAlerts.add(key);
    this.render(true);
  }
}
