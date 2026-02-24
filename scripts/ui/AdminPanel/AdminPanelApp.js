/**
 * AdminPanelApp
 * @file scripts/ui/AdminPanel/AdminPanelApp.js
 * @module cyberpunkred-messenger
 * @description GM dashboard with tabs: message stats, active scheduled messages,
 *              user connection status, quick-send tools, GM compact mode toggle.
 *              Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, EVENTS, TEMPLATES } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class AdminPanelApp extends BaseApplication {

  /** @type {string} Active tab: 'stats', 'scheduled', 'connections', 'tools' */
  _activeTab = 'stats';

  /** @type {boolean} GM compact mode toggle */
  _compactMode = false;

  // ─── Service Accessors ───

  get messageService() { return game.nightcity?.messageService; }
  get schedulingService() { return game.nightcity?.schedulingService; }
  get networkService() { return game.nightcity?.networkService; }
  get masterContactService() { return game.nightcity?.masterContactService; }
  get messageRepository() { return game.nightcity?.messageRepository; }

  // ─── ApplicationV2 Configuration ───

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-admin-panel',
    classes: ['ncm-app', 'ncm-admin-panel'],
    window: {
      title: 'NCM.Admin.Panel',
      icon: 'fas fa-terminal',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 750,
      height: 550,
    },
    actions: {
      switchTab: AdminPanelApp._onSwitchTab,
      cancelScheduled: AdminPanelApp._onCancelScheduled,
      editScheduled: AdminPanelApp._onEditScheduled,
      toggleCompactMode: AdminPanelApp._onToggleCompactMode,
      quickSend: AdminPanelApp._onQuickSend,
      hardDeleteMessage: AdminPanelApp._onHardDeleteMessage,
      openInbox: AdminPanelApp._onOpenInbox,
      openContacts: AdminPanelApp._onOpenContacts,
      openNetworks: AdminPanelApp._onOpenNetworks,
      openThemeCustomizer: AdminPanelApp._onOpenThemeCustomizer,
      refreshStats: AdminPanelApp._onRefreshStats,
      forceRefreshAll: AdminPanelApp._onForceRefreshAll,
    },
  }, { inplace: false });

  static PARTS = {
    main: {
      template: TEMPLATES.ADMIN_PANEL,
    },
  };

  // ─── Data Preparation ───

  async _prepareContext(options) {
    if (!isGM()) return { isGM: false };

    // ─── Stats Tab Data ───
    const stats = await this._gatherStats();

    // ─── Scheduled Tab Data ───
    const scheduled = this.schedulingService?.getPending() ?? [];
    const scheduledEntries = scheduled.map(entry => {
      const fromActor = game.actors.get(entry.messageData.fromActorId);
      const toActor = game.actors.get(entry.messageData.toActorId);
      return {
        ...entry,
        fromName: fromActor?.name ?? entry.messageData.from ?? 'Unknown',
        toName: toActor?.name ?? entry.messageData.to ?? 'Unknown',
        subject: entry.messageData.subject || '(no subject)',
      };
    });

    // ─── Connections Tab Data ───
    const connections = game.users
      .filter(u => u.active)
      .map(u => {
        const actors = game.actors.filter(a => a.isOwner && a.hasPlayerOwner);
        return {
          userId: u.id,
          userName: u.name,
          isGM: u.isGM,
          color: u.color,
          actors: actors.filter(a => {
            const owners = Object.entries(a.ownership || {});
            return owners.some(([uid, level]) => uid === u.id && level >= 3);
          }).map(a => ({ id: a.id, name: a.name, img: a.img })),
        };
      });

    // ─── Quick-Send Data ───
    const npcActors = game.actors
      .filter(a => !a.hasPlayerOwner)
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
        email: a.getFlag(MODULE_ID, 'email') || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const playerActors = game.actors
      .filter(a => a.hasPlayerOwner)
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      isGM: true,
      activeTab: this._activeTab,
      compactMode: this._compactMode,
      stats,
      scheduledEntries,
      scheduledCount: scheduledEntries.length,
      connections,
      npcActors,
      playerActors,
      currentNetwork: this.networkService?.currentNetworkId ?? 'UNKNOWN',
      MODULE_ID,
    };
  }

  /**
   * Gather message statistics across all inboxes.
   * @returns {Promise<object>}
   * @private
   */
  async _gatherStats() {
    const stats = {
      totalMessages: 0,
      unreadMessages: 0,
      actorStats: [],
      messagesByPriority: { normal: 0, urgent: 0, critical: 0 },
      scheduledPending: this.schedulingService?.getPending().length ?? 0,
    };

    try {
      // Iterate all actors with inboxes
      for (const actor of game.actors) {
        const messages = await this.messageService?.getMessages(actor.id) ?? [];
        if (messages.length === 0) continue;

        const unread = messages.filter(m =>
          !m.status?.read && !m.status?.sent && !m.status?.deleted
        ).length;

        stats.totalMessages += messages.length;
        stats.unreadMessages += unread;

        // Priority breakdown
        for (const msg of messages) {
          const p = msg.priority || 'normal';
          if (stats.messagesByPriority[p] !== undefined) {
            stats.messagesByPriority[p]++;
          }
        }

        if (messages.length > 0) {
          stats.actorStats.push({
            actorId: actor.id,
            actorName: actor.name,
            actorImg: actor.img,
            hasPlayerOwner: actor.hasPlayerOwner,
            totalMessages: messages.length,
            unreadMessages: unread,
          });
        }
      }

      // Sort by total messages descending
      stats.actorStats.sort((a, b) => b.totalMessages - a.totalMessages);
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._gatherStats:`, error);
    }

    return stats;
  }

  // ─── Event Subscriptions ───

  _setupEventSubscriptions() {
    this.subscribe(EVENTS.MESSAGE_SENT, () => {
      if (this._activeTab === 'stats') this.render(true);
    });
    this.subscribe(EVENTS.MESSAGE_RECEIVED, () => {
      if (this._activeTab === 'stats') this.render(true);
    });
    this.subscribe(EVENTS.MESSAGE_SCHEDULED, () => {
      if (this._activeTab === 'scheduled') this.render(true);
    });
  }

  // ─── Action Handlers ───

  static _onSwitchTab(event, target) {
    const tab = target.closest('[data-tab]')?.dataset.tab;
    if (!tab) return;
    this._activeTab = tab;
    this.render(true);
  }

  static async _onCancelScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;

    const confirmed = await Dialog.confirm({
      title: 'Cancel Scheduled Message',
      content: '<p>Cancel this scheduled message? It will not be delivered.</p>',
    });
    if (!confirmed) return;

    const result = await this.schedulingService?.cancelScheduled(scheduleId);
    if (result?.success) {
      ui.notifications.info('Scheduled message cancelled.');
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Failed to cancel.');
    }
  }

  static _onEditScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;

    const entry = this.schedulingService?.getScheduled(scheduleId);
    if (!entry) return;

    // Open composer pre-filled with scheduled message data
    game.nightcity.composeMessage?.({
      toActorId: entry.messageData.toActorId,
      subject: entry.messageData.subject,
      body: entry.messageData.body,
      // The composer can detect schedule editing via this flag
      _editingScheduleId: scheduleId,
    });
  }

  static _onToggleCompactMode(event, target) {
    this._compactMode = !this._compactMode;
    document.body.classList.toggle('ncm-compact-mode', this._compactMode);
    this.render(true);
  }

  static _onQuickSend(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    game.nightcity.composeMessage?.({
      fromActorId: actorId,
    });
  }

  static async _onHardDeleteMessage(event, target) {
    // Hard delete: actually removes the journal page (not soft-delete)
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!messageId || !actorId) return;

    const confirmed = await Dialog.confirm({
      title: 'Hard Delete Message',
      content: '<p>Permanently delete this message? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    try {
      const repo = this.messageRepository;
      if (repo?.hardDeleteMessage) {
        await repo.hardDeleteMessage(actorId, messageId);
        ui.notifications.info('Message permanently deleted.');
        this.render(true);
      } else {
        // Fallback to soft delete
        await this.messageService?.deleteMessage(actorId, messageId);
        ui.notifications.info('Message deleted (soft).');
        this.render(true);
      }
    } catch (error) {
      console.error(`${MODULE_ID} | AdminPanelApp._onHardDeleteMessage:`, error);
      ui.notifications.error('Failed to delete message.');
    }
  }

  static _onOpenInbox(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    game.nightcity.openInbox?.(actorId);
  }

  static _onOpenContacts(event, target) {
    game.nightcity.openContacts?.();
  }

  static _onOpenNetworks(event, target) {
    game.nightcity.openNetworkManagement?.();
  }

  static _onOpenThemeCustomizer(event, target) {
    game.nightcity.openThemeCustomizer?.();
  }

  static async _onRefreshStats(event, target) {
    this.render(true);
  }

  static async _onForceRefreshAll(event, target) {
    // Broadcast an inbox refresh signal to all connected clients
    const socketManager = game.nightcity?.socketManager;
    if (socketManager) {
      for (const actor of game.actors) {
        socketManager.emit('inbox:refresh', { actorId: actor.id });
      }
      ui.notifications.info('Refresh signal sent to all clients.');
    }
  }
}
