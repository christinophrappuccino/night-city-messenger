/**
 * OverviewTab — Dashboard: connections, alerts, activity log, quick actions.
 * @file scripts/ui/AdminPanel/tabs/OverviewTab.js
 * @module cyberpunkred-messenger
 *
 * Owns the cross-cutting activity log fed from EventBus subscriptions
 * registered on the parent app. Alerts depend on data already gathered
 * by the parent (stats, shards, scheduled, sceneStrip), so prepareContext
 * accepts those as args instead of recomputing.
 *
 * Cross-parent dependencies:
 *   - this.app._activeTab        — written by switchTab actions
 *   - this.app._getRelativeTime  — used by activity log timestamps
 *   - this.app._formatSessionTime— per-user session helper
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';

export class OverviewTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {Array<object>} Cross-domain activity log (session only) */
  _activityLog = [];
  /** @type {Set<string>} Dismissed alert keys (session only) */
  _dismissedAlerts = new Set();

  get key() { return 'overview'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  /**
   * Build the overview context fragment.
   * @param {object} stats           — From parent _gatherStats
   * @param {Array}  shards          — From ShardsTab.prepareContext().shards
   * @param {Array}  scheduledEntries— Formatted scheduled entries
   * @param {Array}  sceneStrip      — From NetworksTab.prepareContext().sceneStrip
   */
  prepareContext(stats, shards, scheduledEntries, sceneStrip) {
    return {
      connections: this._gatherConnections(),
      overviewAlerts: this._gatherAlerts(stats, shards, scheduledEntries, sceneStrip),
      overviewActivity: this._activityLog.slice(0, 15),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Public — logActivity (called from parent's EventBus subs)
  // ═══════════════════════════════════════════════════════════

  /**
   * Append an activity feed entry. Capped at 30, trimmed to 15 in context.
   * @param {string} domain - 'msg' | 'shard' | 'net' | 'contact' | 'alert'
   * @param {string} icon   - FontAwesome icon name (without 'fa-')
   * @param {string} html   - HTML text (may contain inline spans)
   * @param {object} [options] - { actorId, itemId, detail }
   */
  logActivity(domain, icon, html, options = {}) {
    this._activityLog.unshift({
      domain,
      icon,
      html,
      time: this.app._getRelativeTime(Date.now()),
      timestamp: Date.now(),
      actorId: options.actorId || null,
      itemId: options.itemId || null,
    });

    // Cap at 30 entries
    if (this._activityLog.length > 30) this._activityLog.length = 30;
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers — data gathering
  // ═══════════════════════════════════════════════════════════

  _gatherConnections() {
    const connections = [];

    for (const user of game.users) {
      if (!user.active) continue;

      const actors = user.isGM
        ? game.actors.filter(a => !a.hasPlayerOwner).slice(0, 3).map(a => a.name)
        : game.actors.filter(a => {
            const ownership = a.ownership || {};
            return ownership[user.id] >= 3;
          }).map(a => a.name);

      const npcCount = user.isGM ? game.actors.filter(a => !a.hasPlayerOwner).length : 0;
      let actorNames = actors.join(', ');
      if (user.isGM && npcCount > 3) {
        actorNames += ` (+${npcCount - 3} NPC)`;
      }

      connections.push({
        userId: user.id,
        userName: user.name,
        isGM: user.isGM,
        color: user.color,
        actorNames: actorNames || '—',
        sessionTime: this.app._formatSessionTime(user),
      });
    }

    return connections;
  }

  _gatherAlerts(stats, shards, scheduledEntries, sceneStrip) {
    const alerts = [];

    // ── Unread message pileup (>3 per actor) ──
    for (const actor of stats.actorStats) {
      if (actor.unreadMessages >= 3) {
        const key = `unread-${actor.actorId}`;
        if (this._dismissedAlerts.has(key)) continue;
        alerts.push({
          key,
          severity: 'urgent',
          iconClass: 'fas fa-envelope-circle-exclamation',
          text: `${actor.actorName} has ${actor.unreadMessages} unread messages piling up`,
          sub: null,
          domain: 'msg',
          domainLabel: 'MSG',
          actionLabel: 'Open Inbox',
          actionName: 'openInbox',
          actionActorId: actor.actorId,
        });
      }
    }

    // ── Destroyed / bricked shards ──
    for (const shard of shards) {
      if (shard.status === 'destroyed') {
        const key = `destroyed-${shard.itemId}`;
        if (this._dismissedAlerts.has(key)) continue;
        alerts.push({
          key,
          severity: 'urgent',
          iconClass: 'fas fa-skull-crossbones',
          text: `Shard "${shard.name}" integrity at 0% — destroyed`,
          sub: null,
          domain: 'shard',
          domainLabel: 'SHARD',
          actionLabel: 'View Shard',
          actionName: 'openShardItem',
          actionItemId: shard.itemId,
        });
      }
    }

    // ── Scheduled messages firing soon (<5 min) ──
    for (const entry of scheduledEntries) {
      if (entry.isSoon) {
        const key = `sched-${entry.id}`;
        if (this._dismissedAlerts.has(key)) continue;
        alerts.push({
          key,
          severity: 'warn',
          iconClass: 'fas fa-clock',
          text: `Scheduled message fires in ${entry.countdown}`,
          sub: `${entry.fromName} → ${entry.toName}: "${entry.subject}"`,
          domain: 'sched',
          domainLabel: 'SCHED',
          actionLabel: 'Edit',
          actionName: 'editScheduled',
          actionActorId: null,
        });
      }
    }

    // ── Dead zones on active scene ──
    const activeScene = game.scenes?.active;
    if (activeScene) {
      for (const scene of sceneStrip) {
        if (scene.deadZone && scene.sceneId === activeScene.id) {
          const key = `deadzone-${scene.sceneId}`;
          if (this._dismissedAlerts.has(key)) continue;
          alerts.push({
            key,
            severity: 'info',
            iconClass: 'fas fa-signal',
            text: `Dead zone active on current scene`,
            sub: `${scene.sceneName} — No signal, queued messages will hold`,
            domain: 'net',
            domainLabel: 'NET',
            actionLabel: 'Networks',
            actionName: 'switchTab',
            actionTab: 'networks',
          });
        }
      }
    }

    return alerts;
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  async onOpenInbox(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    game.nightcity?.openInbox?.(actorId);
    log.info(`Admin: Opening inbox for ${actorId}`);
  }

  onOpenAllInboxes(event, target) {
    // Open inbox for each actor with messages — limited to prevent window spam
    const actors = game.actors.filter(a =>
      a.hasPlayerOwner || a.getFlag(MODULE_ID, 'email')
    ).slice(0, 4);

    for (const actor of actors) {
      game.nightcity?.openInbox?.(actor.id);
    }
  }

  onComposeAs(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
    log.info(`Admin Overview: Compose as ${actor.name}`);
  }

  onNewShard(event, target) {
    this.app._activeTab = 'shards';
    this.render(true);
    log.info('Admin Overview: Switching to Shards tab for creation');
  }

  onBroadcast(event, target) {
    // Switch to networks tab where the broadcast UI lives
    this.app._activeTab = 'networks';
    this.render(true);
    log.info('Admin Overview: Switching to Networks for broadcast');
  }

  onClearAlerts(event, target) {
    // Gather all current alert keys and dismiss them
    const alertEls = this.element?.querySelectorAll('[data-alert-key]') ?? [];
    for (const el of alertEls) {
      const key = el.dataset.alertKey;
      if (key) this._dismissedAlerts.add(key);
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
