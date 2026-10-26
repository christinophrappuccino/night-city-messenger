/**
 * OverviewTab — "what needs me" + "the state of the table".
 * @file scripts/ui/AdminPanel/tabs/OverviewTab.js
 * @module night-city-messenger
 *
 * Rebuilt 2026-10-26 from the dev-approved mock
 * dev/mockups/admin-overview-redesign-mock.html. Sections, top to bottom:
 *   quick actions + clock · NEEDS YOU (one ranked, actionable queue) · AT THE
 *   TABLE (who is here, as whom, on which network) · six status tiles · RECENT
 *   ACTIVITY (durable: saved mail + the Security log) + COMING UP (every timer) ·
 *   players' characters · NPCs players are talking to.
 * The ranking / filtering / merging rules are the pure utils/overviewModel.js.
 * Long lists scroll inside their own box (dev: "anything that gets long just
 * has an overflow scroll").
 *
 * Cross-parent dependencies:
 *   - this.app._activeTab        — written by switchTab actions
 *   - this.app.tabs.security     — heat / countdowns / plants gatherers (reused)
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log, getPlayerCharacters, resolveDisplayName, formatCyberDate } from '../../../utils/helpers.js';
import { MessageRepository } from '../../../data/MessageRepository.js';
import { identityRole, identitiesOfContact } from '../../../utils/identities.js';
import { getInitials, getAvatarColor } from '../../../utils/designHelpers.js';
import {
  rankNeeds, needCounts, filterNeeds, agoLabel, untilLabel, mergeActivity, filterFeed, dismissKey,
} from '../../../utils/overviewModel.js';
import { BaseTab } from '../BaseTab.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class OverviewTab extends BaseTab {

  /** @type {Array<object>} Session events from the EventBus (network switches, contacts…) */
  _activityLog = [];
  /** @type {Set<string>} Dismissed "needs you" items, keyed `key|signature` (session only) */
  _dismissedAlerts = new Set();
  /** @type {string} Needs-you filter chip: all | mail | sec | money | setup */
  _needFilter = 'all';
  /** @type {string} Activity filter chip: all | mail | hack | shard */
  _feedFilter = 'all';

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
    return {
      ov: {
        clock: formatCyberDate(game.nightcity?.timeService?.getCurrentTime?.() || new Date(now).toISOString()),
        sceneName: scene?.name || '',
        sceneDead,
        needs: filterNeeds(needsAll, this._needFilter),
        needCounts: needCounts(needsAll),
        needFilter: this._needFilter,
        hasNeeds: needsAll.length > 0,
        table: this._gatherTable(stats),
        tiles: this._gatherTiles(stats, shards, mail, now),
        feed: filterFeed(feedAll, this._feedFilter),
        hasFeed: feedAll.length > 0,
        feedFilter: this._feedFilter,
        soon: this._gatherSoon(scheduledEntries, mail, now),
        pcs: this._gatherPcs(stats, mail, now),
        npcs: this._gatherNpcs(mail, now),
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
          { label: `Reply as ${g.aliasName || g.name}`, action: 'ovReplyAs', primary: true, data: { 'message-id': latest.messageId, 'inbox-id': g.ownerId } },
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
    for (const box of mail.inboxes) {
      if (box.isPlayer) continue;
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
        if (!m.status?.read) g.waiting++;
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

  _gatherTable(stats) {
    const nets = game.nightcity?.playerNetworks;
    const out = [];
    for (const user of game.users ?? []) {
      if (user.isGM) continue;
      const actor = user.character || game.actors?.find?.(a => a.hasPlayerOwner && a.ownership?.[user.id] >= 3) || null;
      if (!actor && !user.active) continue;
      const known = nets?.get?.(user.id);
      const net = known ? (this.networkService?.getNetwork?.(known.networkId)?.name || known.networkId) : '';
      const unread = stats.actorStats.find(s => s.actorId === actor?.id)?.unreadMessages || 0;
      out.push({
        userName: user.name, online: !!user.active,
        name: actor?.name || '(no character)', img: this._img(actor),
        initials: getInitials(actor?.name || user.name), color: user.color || getAvatarColor(user.name),
        network: net || (user.active ? 'network unknown' : ''), unread,
      });
    }
    return out.sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
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
    return [
      { tab: 'messages', icon: 'fa-envelope', color: 'var(--ncm-secondary)', label: 'Messages', n: stats.totalMessages,
        lines: [`<b>${stats.unreadMessages}</b> unread · <b>${received.filter(m => m._ts >= day).length}</b> today`] },
      { tab: 'contacts', icon: 'fa-address-book', color: 'var(--ncm-success)', label: 'Contacts', n: all.length,
        lines: [`<b>${all.filter(c => identityRole(all, c)?.isAlias).length}</b> aliases · <b>${groups}</b> groups`] },
      { tab: 'networks', icon: 'fa-network-wired', color: 'var(--ncm-accent)', label: 'Networks', n: nets.length,
        lines: [`<b>${nets.filter(n => n.enabled !== false).length}</b> live`], bad: deadScenes ? `${deadScenes} dead zone${deadScenes === 1 ? '' : 's'}` : '' },
      { tab: 'shards', icon: 'fa-microchip', color: 'var(--ncm-accent)', label: 'Shards', n: (shards || []).length,
        lines: [`<b>${(shards || []).filter(s => s.status === 'locked' || s.status === 'blackice').length}</b> locked · <b>${(shards || []).filter(s => s.makerName).length}</b> player-made`],
        bad: (() => { const b = (shards || []).filter(s => s.status === 'destroyed').length; return b ? `${b} bricked` : ''; })() },
      { tab: 'terminals', icon: 'fa-terminal', color: 'var(--ncm-primary)', label: 'Terminals', n: terminals.length,
        lines: [`<b>${loggedIn}</b> logged in · <b>${accounts}</b> accounts`] },
      { tab: 'security', icon: 'fa-shield-halved', color: 'var(--ncm-danger)', label: 'Security', n: (ts?.getLog?.() || []).filter(r => new Date(r.ts).getTime() >= day).length,
        lines: ['events in 24h'], bad: heat.hot.filter(h => h.value >= 50).length ? `${heat.hot.filter(h => h.value >= 50).length} running hot` : '' },
    ];
  }

  _gatherPcs(stats, mail, now) {
    return getPlayerCharacters().map(pc => {
      const owner = (game.users ?? []).find(u => !u.isGM && (u.character?.id === pc.actorId || pc.actor?.ownership?.[u.id] >= 3));
      const box = mail.inboxes.find(b => !b.isContact && b.ownerId === pc.actorId);
      const last = (box?.msgs || []).filter(m => !String(m.messageId || '').endsWith('-sent')).sort((a, b) => b._ts - a._ts)[0];
      return {
        actorId: pc.actorId, name: pc.actorName, img: this._img(pc.actor),
        initials: getInitials(pc.actorName), color: owner?.color || getAvatarColor(pc.actorName),
        playerName: pc.playerName || owner?.name || '', online: !!owner?.active,
        unread: stats.actorStats.find(s => s.actorId === pc.actorId)?.unreadMessages || 0,
        hasEmail: !!game.nightcity?.emailService?.hasEmail?.(pc.actor),
        last: last ? { from: this._senderName(last), subject: last.subject || '(no subject)', ago: agoLabel(last._ts, now) } : null,
      };
    });
  }

  _gatherNpcs(mail, now) {
    const all = this.masterContactService?.getAll?.() || [];
    const byOwner = new Map();
    for (const g of this._npcMailGroups(mail)) {
      const o = byOwner.get(g.ownerId) || { ownerId: g.ownerId, isContact: g.isContact, name: g.name, waiting: 0, lastTs: 0 };
      o.waiting += g.waiting;
      if (g.latest._ts > o.lastTs) { o.lastTs = g.latest._ts; o.latestId = g.latest.messageId; }
      byOwner.set(g.ownerId, o);
    }
    return [...byOwner.values()].map(o => {
      const actor = o.isContact ? null : game.actors?.get(o.ownerId);
      const contact = o.isContact ? this.masterContactService?.getContact?.(o.ownerId) : (this.masterContactService?.getByActorId?.(o.ownerId) || null);
      const aliases = contact ? Math.max(0, identitiesOfContact(all, contact).length - 1) : 0;
      return {
        ...o, img: this._img(actor) || contact?.portrait || null,
        initials: getInitials(o.name), color: getAvatarColor(o.name),
        aliases, last: agoLabel(o.lastTs, now),
      };
    }).sort((a, b) => b.waiting - a.waiting || b.lastTs - a.lastTs);
  }

  // ═══════════════════════════════════════════════════════════
  //  RECENT ACTIVITY · COMING UP
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

  _gatherSoon(scheduledEntries, mail, now) {
    const out = [];
    for (const e of (scheduledEntries || [])) {
      out.push({ ts: e.deliveryTs || 0, when: e.countdown, hot: !!e.isSoon, title: 'Scheduled mail', subline: `${e.fromName} → ${e.toName} · "${e.subject}"`, cancel: { action: 'cancelScheduled', key: 'schedule-id', id: e.id } });
    }
    for (const c of (game.nightcity?.traceService?.getCountdowns?.() || [])) {
      out.push({ ts: c.expiresAt, when: untilLabel(c.expiresAt, now), hot: true, title: `Trace — ${(c.source || '').trim() || 'a trace'} on ${c.actorName || 'someone'}`, subline: 'on game time', cancel: { action: 'securityCountdownCancel', key: 'countdown-id', id: c.id } });
    }
    const tsvc = game.nightcity?.terminalService;
    for (const it of (tsvc?.collectTerminals?.() || [])) {
      for (const a of (tsvc.getConfig(it).accounts || [])) {
        const exp = a.forged?.expiresAt ? new Date(a.forged.expiresAt).getTime() : 0;
        if (exp > now) out.push({ ts: exp, when: untilLabel(exp, now), hot: false, title: 'Backdoor account closes', subline: `${a.username || a.displayName} on ${tsvc.getConfig(it).terminalName || it.name}` });
      }
    }
    for (const box of mail.inboxes) {
      for (const m of box.msgs) {
        const exp = m.selfDestruct?.expiresAt ? new Date(m.selfDestruct.expiresAt).getTime() : 0;
        if (exp > now && !String(m.messageId || '').endsWith('-sent')) out.push({ ts: exp, when: untilLabel(exp, now), hot: false, title: 'Self-destructing mail expires', subline: `in ${box.name}'s inbox · "${m.subject || ''}"` });
      }
    }
    return out.sort((a, b) => (a.ts || Infinity) - (b.ts || Infinity)).slice(0, 25);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

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

  onNeedFilter(event, target) {
    this._needFilter = target.dataset.filter || 'all';
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
