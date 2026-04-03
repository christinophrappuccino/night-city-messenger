/**
 * Character Select Application
 * @file scripts/ui/CharacterSelect/CharacterSelectApp.js
 * @module cyberpunkred-messenger
 * @description Character select screen for NCM. Shows a roster of available
 *   characters with a spotlight panel. "Jack In" runs a connecting animation
 *   and opens the MessageViewer. GM gets an Admin Panel entry.
 *
 *   Boot splash is handled externally by registerMessagingSystem._playBootSplash().
 *   Session memory stored in user flags (lastCharacterId).
 */

import { BaseApplication } from '../BaseApplication.js';
import { MODULE_ID } from '../../utils/constants.js';
import { log, isGM } from '../../utils/helpers.js';

const CONNECT_STEP_DELAY_MS = 400;
const SUCCESS_HOLD_MS = 1000;
const PORTRAIT_COLORS = ['cyan', 'gold', 'purple', 'red'];

export class CharacterSelectApp extends BaseApplication {

  static DEFAULT_OPTIONS = {
    id: 'ncm-character-select',
    classes: ['ncm-app', 'ncm-character-select-window'],
    position: { width: 800, height: 560 },
    window: {
      title: 'Night City Messenger',
      icon: 'fas fa-satellite-dish',
      resizable: true,
      minimizable: true,
    },
    actions: {
      'select-entry': CharacterSelectApp._onSelectEntry,
      'jack-in': CharacterSelectApp._onJackIn,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/character-select/character-select.hbs`,
    },
  };

  /** @type {string|null} Currently selected entry ID ('__admin__' or actor ID) */
  _selectedId = null;

  /** @type {boolean} Whether a jack-in sequence is in progress */
  _jackingIn = false;

  // ═══════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════

  async _prepareContext(options) {
    const networkService = game.nightcity?.networkService;
    const signalStrength = networkService?.signalStrength ?? 100;
    const isDeadZone = networkService?.isDeadZone ?? false;
    const currentNetwork = networkService?.currentNetwork;
    const networkName = isDeadZone ? 'NO SIGNAL' : (currentNetwork?.name || 'CITINET');
    const networkOnline = !isDeadZone && signalStrength > 0;

    const activeBarCount = isDeadZone ? 0
      : signalStrength >= 80 ? 4
      : signalStrength >= 50 ? 3
      : signalStrength >= 25 ? 2
      : signalStrength > 0 ? 1 : 0;
    const signalBars = [1, 2, 3, 4].map(i => ({ on: i <= activeBarCount }));

    const characters = this._buildCharacterList();

    if (!this._selectedId && characters.length) {
      this._selectedId = characters[0].id;
    }

    const isAdminSelected = this._selectedId === '__admin__';
    const selectedCharacter = isAdminSelected ? null : characters.find(c => c.id === this._selectedId) || null;

    let adminStats = null;
    if (isAdminSelected) {
      adminStats = this._getAdminStats();
    }

    return {
      isGM: isGM(),
      characters,
      selectedCharacter,
      isAdminSelected,
      adminStats,
      networkName,
      networkOnline,
      signalPercent: signalStrength,
      signalBars,
    };
  }

  // ═══════════════════════════════════════════════════════
  //  Character List Building
  // ═══════════════════════════════════════════════════════

  _buildCharacterList() {
    const actors = game.actors?.contents || [];
    const characters = [];

    for (const actor of actors) {
      if (!isGM() && !actor.isOwner) continue;
      if (actor.type !== 'character') continue;

      const email = game.nightcity?.contactRepository?.getActorEmail?.(actor.id)
        || actor.getFlag?.(MODULE_ID, 'emailHandle')
        || actor.getFlag?.(MODULE_ID, 'email')
        || null;

      const role = actor.system?.role
        || actor.system?.lifepath?.role
        || '';
      const rank = actor.system?.stats?.empathy?.rank || '';
      const roleLabel = role ? (rank ? `${role} // Rank ${rank}` : role) : 'Unknown Role';

      const stats = this._getCharacterStats(actor.id);

      const colorIndex = actor.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % PORTRAIT_COLORS.length;
      const hasCustomImg = actor.img && !actor.img.includes('mystery-man');

      characters.push({
        id: actor.id,
        name: actor.name,
        img: hasCustomImg ? actor.img : null,
        initial: (actor.name?.[0] || '?').toUpperCase(),
        colorClass: PORTRAIT_COLORS[colorIndex],
        role,
        roleLabel,
        email,
        selected: actor.id === this._selectedId,
        unreadCount: stats.unread,
        totalMessages: stats.total,
        shardCount: stats.shards,
        draftCount: stats.drafts,
      });
    }

    return characters;
  }

  _getCharacterStats(actorId) {
    const stats = { unread: 0, total: 0, shards: 0, drafts: 0 };
    try {
      const journalName = `NCM-Inbox-Actor-${actorId}`;
      const journal = game.journal?.getName(journalName);
      if (journal) {
        for (const page of journal.pages) {
          const flags = page.flags?.[MODULE_ID];
          if (!flags?.messageId) continue;
          if (flags.status?.deleted || flags.status?.spam) continue;
          stats.total++;
          if (!flags.status?.read && !flags.status?.sent) stats.unread++;
          if (flags.status?.draft) stats.drafts++;
        }
      }

      const actor = game.actors.get(actorId);
      if (actor) {
        for (const item of actor.items) {
          const config = item.getFlag(MODULE_ID, 'shardConfig') || item.getFlag(MODULE_ID, 'config');
          if (config) stats.shards++;
        }
      }
    } catch (err) {
      log.debug('CharacterSelect: Error getting stats for', actorId, err);
    }
    return stats;
  }

  _getAdminStats() {
    let totalUnread = 0;
    let actorCount = 0;
    const networkCount = game.nightcity?.networkService?.getAllNetworks?.()?.length ?? 0;
    const alertCount = 0;

    for (const actor of (game.actors?.contents || [])) {
      if (actor.type !== 'character') continue;
      actorCount++;
      const stats = this._getCharacterStats(actor.id);
      totalUnread += stats.unread;
    }

    return { totalUnread, actorCount, networkCount, alertCount };
  }

  // ═══════════════════════════════════════════════════════
  //  Actions
  // ═══════════════════════════════════════════════════════

  static _onSelectEntry(event, target) {
    if (this._jackingIn) return;
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;
    this._selectedId = entryId;
    this.render(true);
  }

  static _onJackIn(event, target) {
    if (this._jackingIn) return;
    if (!this._selectedId) {
      ui.notifications.warn('NCM | Select a character first.');
      return;
    }
    if (this._selectedId === '__admin__') {
      this._enterAdmin();
      return;
    }
    this._jackIn(this._selectedId);
  }

  // ═══════════════════════════════════════════════════════
  //  Jack In Sequence
  // ═══════════════════════════════════════════════════════

  async _jackIn(actorId) {
    this._jackingIn = true;
    const el = this.element;
    if (!el) return;

    const actor = game.actors.get(actorId);
    const email = game.nightcity?.contactRepository?.getActorEmail?.(actorId) || '';

    const roster = el.querySelector('[data-el="roster"]');
    if (roster) roster.classList.add('locked');

    const conName = el.querySelector('[data-el="con-name"]');
    const conEmail = el.querySelector('[data-el="con-email"]');
    if (conName) conName.textContent = actor?.name || 'Unknown';
    if (conEmail) conEmail.textContent = email;

    const btn = el.querySelector('[data-el="jack-in-btn"]');
    if (btn) btn.classList.add('connecting');

    const rosterSub = el.querySelector('[data-el="roster-sub"]');
    if (rosterSub) rosterSub.textContent = 'Connecting...';

    const overlay = el.querySelector('[data-el="connecting-overlay"]');
    if (overlay) overlay.classList.add('active');

    const steps = el.querySelectorAll('[data-el="con-steps"] .ncm-cs__con-step');
    for (let i = 0; i < steps.length; i++) {
      await this._delay(CONNECT_STEP_DELAY_MS);
      if (!this.rendered) return;

      if (i > 0) {
        steps[i - 1].classList.remove('active');
        steps[i - 1].classList.add('done');
        const prevIcon = steps[i - 1].querySelector('i');
        if (prevIcon) prevIcon.className = 'fas fa-check';
      }

      steps[i].classList.add('active');
      const curIcon = steps[i].querySelector('i');
      if (curIcon) curIcon.className = 'fas fa-circle-notch fa-spin';
    }

    await this._delay(CONNECT_STEP_DELAY_MS);
    if (!this.rendered) return;
    const lastStep = steps[steps.length - 1];
    if (lastStep) {
      lastStep.classList.remove('active');
      lastStep.classList.add('done');
      const lastIcon = lastStep.querySelector('i');
      if (lastIcon) lastIcon.className = 'fas fa-check';
    }

    const successOverlay = el.querySelector('[data-el="success-overlay"]');
    const successName = el.querySelector('[data-el="success-name"]');
    if (successName) successName.textContent = actor?.name || 'Unknown';
    if (overlay) overlay.classList.remove('active');
    if (successOverlay) successOverlay.classList.add('active');

    if (btn) {
      btn.classList.remove('connecting');
      btn.classList.add('connected');
      btn.innerHTML = '<i class="fas fa-check"></i> Connected';
    }

    try {
      await game.user.setFlag(MODULE_ID, 'lastCharacterId', actorId);
    } catch (err) {
      log.debug('CharacterSelect: Could not save lastCharacterId', err);
    }

    await this._delay(SUCCESS_HOLD_MS);
    if (!this.rendered) return;

    // Smooth transition: fade out, capture position, close, open next at same spot
    const pos = this._capturePosition();
    await this._fadeOutAndClose();
    game.nightcity?.openInbox?.(actorId);
  }

  async _enterAdmin() {
    const pos = this._capturePosition();
    await this._fadeOutAndClose();
    game.nightcity?.openAdmin?.();
  }

  // ═══════════════════════════════════════════════════════
  //  Transition Helpers
  // ═══════════════════════════════════════════════════════

  /**
   * Capture the current window position for seamless handoff.
   */
  _capturePosition() {
    return { ...this.position };
  }

  /**
   * Fade out the window, then close it.
   */
  async _fadeOutAndClose() {
    const el = this.element;
    if (el) {
      el.classList.add('ncm-fade-out');
      await this._delay(250);
    }
    await this.close();
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
