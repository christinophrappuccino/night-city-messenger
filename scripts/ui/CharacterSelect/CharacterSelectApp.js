/**
 * Character Select Application
 * @file scripts/ui/CharacterSelect/CharacterSelectApp.js
 * @module cyberpunkred-messenger
 * @description Entry point for NCM. Two-phase UI:
 *   1. Boot loader — progress bar with status text (~2s)
 *   2. Character select — roster + spotlight + "Jack In" flow
 *
 *   Session memory: stores lastCharacterId in user flags. On subsequent opens,
 *   skips both phases and opens the viewer directly.
 *
 *   GM gets an "Admin Panel" entry that bypasses connecting animation.
 */

import { BaseApplication } from '../BaseApplication.js';
import { MODULE_ID } from '../../utils/constants.js';
import { log, isGM, getPlayerActor } from '../../utils/helpers.js';

const BOOT_DURATION_MS = 2000;
const CONNECT_STEP_DELAY_MS = 400;
const SUCCESS_HOLD_MS = 1000;

const BOOT_STEPS = [
  { pct: 18, label: 'Loading services...' },
  { pct: 35, label: 'Scanning network...' },
  { pct: 58, label: 'Resolving identities...' },
  { pct: 78, label: 'Validating inboxes...' },
  { pct: 94, label: 'Synchronizing...' },
  { pct: 100, label: 'Ready', done: true },
];

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

  // ─────────────── Instance State ───────────────

  /** @type {boolean} Whether we're in the boot phase */
  _booting = true;

  /** @type {string|null} Currently selected entry ID ('__admin__' or actor ID) */
  _selectedId = null;

  /** @type {boolean} Whether a jack-in sequence is in progress */
  _jackingIn = false;

  /** @type {boolean} Whether to skip boot (re-login scenario) */
  _skipBoot = false;

  // ═══════════════════════════════════════════════════════
  //  Constructor
  // ═══════════════════════════════════════════════════════

  constructor(options = {}) {
    super(options);
    if (options.skipBoot) {
      this._skipBoot = true;
      this._booting = false;
    }
  }

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

    // Signal bars (4 bars)
    const activeBarCount = isDeadZone ? 0
      : signalStrength >= 80 ? 4
      : signalStrength >= 50 ? 3
      : signalStrength >= 25 ? 2
      : signalStrength > 0 ? 1 : 0;
    const signalBars = [1, 2, 3, 4].map(i => ({ on: i <= activeBarCount }));

    // Build character list
    const characters = this._buildCharacterList();

    // Auto-select first owned character if nothing selected
    if (!this._selectedId && characters.length) {
      this._selectedId = characters[0].id;
    }

    const isAdminSelected = this._selectedId === '__admin__';
    const selectedCharacter = isAdminSelected ? null : characters.find(c => c.id === this._selectedId) || null;

    // Admin aggregate stats
    let adminStats = null;
    if (isAdminSelected) {
      adminStats = this._getAdminStats();
    }

    return {
      booting: this._booting,
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
      // Players see only owned characters; GM sees all character-type actors
      if (!isGM() && !actor.isOwner) continue;
      if (actor.type !== 'character') continue;

      const email = game.nightcity?.contactRepository?.getActorEmail?.(actor.id)
        || actor.getFlag?.(MODULE_ID, 'emailHandle')
        || actor.getFlag?.(MODULE_ID, 'email')
        || null;

      // Role from CPR system data
      const role = actor.system?.role
        || actor.system?.lifepath?.role
        || '';

      const rank = actor.system?.stats?.empathy?.rank
        || '';

      const roleLabel = role ? (rank ? `${role} // Rank ${rank}` : role) : 'Unknown Role';

      // Get message stats
      const stats = this._getCharacterStats(actor.id);

      // Consistent color based on actor ID hash
      const colorIndex = actor.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % PORTRAIT_COLORS.length;

      // Use a default Foundry image check
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
      const messageRepo = game.nightcity?.messageRepository;
      if (!messageRepo) return stats;

      // Try to get inbox journal and count messages
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

      // Shard count from actor items
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
    const alertCount = 0; // Placeholder — could pull from admin overview alerts

    for (const actor of (game.actors?.contents || [])) {
      if (actor.type !== 'character') continue;
      actorCount++;
      const stats = this._getCharacterStats(actor.id);
      totalUnread += stats.unread;
    }

    return { totalUnread, actorCount, networkCount, alertCount };
  }

  // ═══════════════════════════════════════════════════════
  //  Post-Render Lifecycle
  // ═══════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender(context, options);

    if (this._booting) {
      this._playBootSequence();
    }
  }

  // ═══════════════════════════════════════════════════════
  //  Boot Sequence
  // ═══════════════════════════════════════════════════════

  _playBootSequence() {
    const el = this.element;
    if (!el) return;

    const bar = el.querySelector('[data-el="boot-bar"]');
    const label = el.querySelector('[data-el="boot-label"]');
    const pct = el.querySelector('[data-el="boot-pct"]');
    const icon = el.querySelector('[data-el="boot-icon"]');
    const subtitle = el.querySelector('[data-el="boot-subtitle"]');
    if (!bar) return;

    const stepDelay = BOOT_DURATION_MS / BOOT_STEPS.length;

    BOOT_STEPS.forEach((step, i) => {
      setTimeout(() => {
        // Guard: window may have been closed
        if (!this.rendered) return;

        bar.style.width = `${step.pct}%`;
        if (label) label.textContent = step.label;
        if (pct) pct.textContent = `${step.pct}%`;

        if (step.done) {
          bar.classList.add('done');
          if (label) label.classList.add('done');
          if (pct) pct.classList.add('done');
          if (icon) {
            icon.classList.add('done');
            const iconEl = icon.querySelector('i');
            if (iconEl) iconEl.className = 'fas fa-check';
          }
          if (subtitle) {
            subtitle.textContent = 'v4.1 // Systems online';
            subtitle.classList.add('done');
          }
        }
      }, stepDelay * i);
    });

    // Transition to character select after boot completes + brief hold
    setTimeout(() => {
      if (!this.rendered) return;
      this._booting = false;
      this.render(true);
    }, BOOT_DURATION_MS + 300);
  }

  // ═══════════════════════════════════════════════════════
  //  Actions
  // ═══════════════════════════════════════════════════════

  /**
   * Handle roster entry click — select a character.
   * Updates spotlight via re-render.
   */
  static _onSelectEntry(event, target) {
    if (this._jackingIn) return;
    const entryId = target.closest('[data-entry-id]')?.dataset.entryId;
    if (!entryId) return;

    this._selectedId = entryId;
    this.render(true);
  }

  /**
   * Handle "Jack In" / "Enter Admin" button click.
   */
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
  //  Jack In Sequence (character)
  // ═══════════════════════════════════════════════════════

  async _jackIn(actorId) {
    this._jackingIn = true;
    const el = this.element;
    if (!el) return;

    const actor = game.actors.get(actorId);
    const email = game.nightcity?.contactRepository?.getActorEmail?.(actorId) || '';

    // Lock roster
    const roster = el.querySelector('[data-el="roster"]');
    if (roster) roster.classList.add('locked');

    // Update connecting overlay content
    const conName = el.querySelector('[data-el="con-name"]');
    const conEmail = el.querySelector('[data-el="con-email"]');
    if (conName) conName.textContent = actor?.name || 'Unknown';
    if (conEmail) conEmail.textContent = email;

    // Disable jack-in button
    const btn = el.querySelector('[data-el="jack-in-btn"]');
    if (btn) btn.classList.add('connecting');

    // Update roster subtitle
    const rosterSub = el.querySelector('[data-el="roster-sub"]');
    if (rosterSub) rosterSub.textContent = 'Connecting...';

    // Show connecting overlay
    const overlay = el.querySelector('[data-el="connecting-overlay"]');
    if (overlay) overlay.classList.add('active');

    // Animate connection steps
    const steps = el.querySelectorAll('[data-el="con-steps"] .ncm-cs__con-step');
    for (let i = 0; i < steps.length; i++) {
      await this._delay(CONNECT_STEP_DELAY_MS);
      if (!this.rendered) return;

      // Mark previous as done
      if (i > 0) {
        steps[i - 1].classList.remove('active');
        steps[i - 1].classList.add('done');
        const prevIcon = steps[i - 1].querySelector('i');
        if (prevIcon) prevIcon.className = 'fas fa-check';
      }

      // Mark current as active
      steps[i].classList.add('active');
      const curIcon = steps[i].querySelector('i');
      if (curIcon) curIcon.className = 'fas fa-circle-notch fa-spin';
    }

    // Complete final step
    await this._delay(CONNECT_STEP_DELAY_MS);
    if (!this.rendered) return;
    const lastStep = steps[steps.length - 1];
    if (lastStep) {
      lastStep.classList.remove('active');
      lastStep.classList.add('done');
      const lastIcon = lastStep.querySelector('i');
      if (lastIcon) lastIcon.className = 'fas fa-check';
    }

    // Show success overlay
    const successOverlay = el.querySelector('[data-el="success-overlay"]');
    const successName = el.querySelector('[data-el="success-name"]');
    if (successName) successName.textContent = actor?.name || 'Unknown';
    if (overlay) overlay.classList.remove('active');
    if (successOverlay) successOverlay.classList.add('active');

    // Update bottom bar
    if (btn) {
      btn.classList.remove('connecting');
      btn.classList.add('connected');
      btn.innerHTML = '<i class="fas fa-check"></i> Connected';
    }

    // Save session memory
    try {
      await game.user.setFlag(MODULE_ID, 'lastCharacterId', actorId);
    } catch (err) {
      log.debug('CharacterSelect: Could not save lastCharacterId', err);
    }

    // Hold success, then open viewer
    await this._delay(SUCCESS_HOLD_MS);
    if (!this.rendered) return;

    // Close this window and open inbox
    await this.close();
    game.nightcity?.openInbox?.(actorId);
  }

  // ═══════════════════════════════════════════════════════
  //  Admin Mode (GM only)
  // ═══════════════════════════════════════════════════════

  async _enterAdmin() {
    await this.close();
    game.nightcity?.openAdmin?.();
  }

  // ═══════════════════════════════════════════════════════
  //  Utilities
  // ═══════════════════════════════════════════════════════

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
