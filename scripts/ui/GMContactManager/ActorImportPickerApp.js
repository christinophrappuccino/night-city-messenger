/**
 * Actor Import Picker — Quick Import Actor as NPC contact
 * @file scripts/ui/GMContactManager/ActorImportPickerApp.js
 * @module cyberpunkred-messenger
 * @description GM-only searchable list of world actors that can be imported as
 *   master contacts. Picking an actor closes this window and opens the GM
 *   Contact Manager's New-Contact form pre-filled and linked to that actor
 *   (see GMContactManagerApp.startCreateFromActor).
 *
 *   Importable = NOT player-owned AND not already linked to a master contact.
 *   Extends BaseApplication (ApplicationV2 + HandlebarsApplicationMixin).
 */

import { MODULE_ID, TEMPLATES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';

export class ActorImportPickerApp extends BaseApplication {

  get masterContactService() { return game.nightcity?.masterContactService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-actor-import-picker',
    classes: ['ncm-app', 'ncm-actor-import-picker'],
    window: {
      title: 'Import Actor as Contact',
      icon: 'fas fa-user-plus',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 440,
      height: 560,
    },
    actions: {
      pickActor: ActorImportPickerApp._onPickActor,
    },
  }, { inplace: false });

  static PARTS = {
    main: { template: TEMPLATES.ACTOR_IMPORT_PICKER },
  };

  // ═══════════════════════════════════════════════════════════
  //  Data Preparation
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    // Actor IDs already linked to a master contact — hide these.
    const linkedActorIds = new Set(
      (this.masterContactService?.getAll?.() ?? [])
        .map(c => c.actorId)
        .filter(Boolean)
    );

    const actors = (game.actors?.contents ?? [])
      .filter(a => !a.hasPlayerOwner && !linkedActorIds.has(a.id))
      .map(a => {
        // CPR roles are actor items (type 'role'), not actor.system.role.
        const roleItem = a.items?.find(i => i.type === 'role');
        const roleLabel = (roleItem?.name || '').toUpperCase();
        const hasImg = !!a.img && !a.img.includes('mystery-man');
        return {
          id: a.id,
          name: a.name,
          img: a.img,
          hasImg,
          initial: (a.name || '?').charAt(0).toUpperCase(),
          roleLabel,
          search: `${a.name} ${roleLabel}`.toLowerCase(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      actors,
      total: actors.length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle — DOM wiring
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    super._onRender(context, options);

    const input = this.element?.querySelector('.ncm-aip__search-input');
    if (!input) return;

    // Live client-side filtering — no re-render, so focus is preserved.
    const rows = Array.from(this.element.querySelectorAll('.ncm-aip__row'));
    const countEl = this.element.querySelector('.ncm-aip__count b');

    const applyFilter = () => {
      const q = input.value.toLowerCase().trim();
      let visible = 0;
      for (const row of rows) {
        const match = !q || (row.dataset.search || '').includes(q);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      }
      if (countEl) countEl.textContent = visible;
    };

    input.addEventListener('input', applyFilter);

    // Enter on a single visible result picks it.
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const shown = rows.filter(r => r.style.display !== 'none');
      if (shown.length === 1) {
        e.preventDefault();
        shown[0].click();
      }
    });

    input.focus();
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  static async _onPickActor(event, target) {
    const actorId = target.dataset.actorId;
    if (!actorId) return;

    await this.close();

    const gmApp = await game.nightcity?.openGMContacts?.();
    if (gmApp?.startCreateFromActor) {
      gmApp.startCreateFromActor(actorId);
      log.info(`Admin: Importing actor ${actorId} as new contact`);
    } else {
      ui.notifications.warn('NCM | Could not open the Contact Manager.');
    }
  }
}
