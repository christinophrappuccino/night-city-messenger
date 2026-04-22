/**
 * ShardsTab — Data Shards tab controller.
 * @file scripts/ui/AdminPanel/tabs/ShardsTab.js
 * @module cyberpunkred-messenger
 *
 * Encapsulates shard listing, grouping, filters, bulk-select UI, and
 * the in-memory session activity log. Shard actions mutate item flags
 * directly or go through DataShardService.
 *
 * Cross-parent dependencies:
 *   - this.app.constructor._findItem(id)   — static item lookup
 *   - this.app._animationActive            — BaseApplication debounce guard
 *   - this.app._getRelativeTime(ts)        — used by logActivity timestamps
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';

export class ShardsTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {Array<object>} In-memory activity log for this session */
  _activityLog = [];
  /** @type {boolean} Bulk select mode active */
  _selectMode = false;
  /** @type {Set<string>} Selected shard item IDs */
  _selectedIds = new Set();
  /** @type {string|null} Expanded shard row item ID */
  _expandedId = null;
  /** @type {Set<string>} Collapsed owner group keys */
  _collapsedGroups = new Set();
  /** @type {string} Search query */
  _search = '';
  /** @type {string} Sort: 'name' | 'status' | 'accessed' */
  _sort = 'name';
  /** @type {string} Group mode: 'owner' | 'preset' | 'status' | 'none' */
  _groupMode = 'owner';
  /** @type {string} ICE filter */
  _iceFilter = 'all';
  /** @type {string} Status filter */
  _statusFilter = 'all';
  /** @type {string} Owner filter: 'all' | 'world' | 'actors' */
  _ownerFilter = 'all';
  /** @type {string} Preset filter (cycle includes dynamic preset keys) */
  _presetFilter = 'all';
  /** @type {Function|null} Lazy-init debounced search input handler */
  _searchHandler = null;

  get key() { return 'shards'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const shards = this._gatherData();
    const shardGroups = this._buildGroups(shards);
    const shardSummary = {
      total: shards.length,
      locked: shards.filter(s => s.status === 'locked' || s.status === 'blackice').length,
      breached: shards.filter(s => s.status === 'breached').length,
      destroyed: shards.filter(s => s.status === 'destroyed').length,
      open: shards.filter(s => s.status === 'open').length,
      totalEddies: shards.reduce((sum, s) => sum + (s.totalEddies || 0), 0),
      claimedEddies: shards.reduce((sum, s) => sum + (s.claimedEddies || 0), 0),
      unclaimedEddies: shards.reduce((sum, s) => sum + (s.unclaimedEddies || 0), 0),
      totalEntries: shards.reduce((sum, s) => sum + (s.entryCount || 0), 0),
    };

    // Quick-create preset buttons
    const shardPresetButtons = (game.nightcity?.dataShardService?.getAllPresets() ?? [])
      .filter(p => p.key !== 'blank');

    return {
      shards,
      shardGroups,
      shardSummary,
      shardPresetButtons,
      shardActivityLog: this._activityLog.slice(0, 10),
      shardSelectMode: this._selectMode,
      shardSelectedCount: this._selectedIds.size,
      shardSearch: this._search,
      shardSort: this._sort,
      shardGroupMode: this._groupMode,
      shardIceFilter: this._iceFilter,
      shardStatusFilter: this._statusFilter,
      shardOwnerFilter: this._ownerFilter,
    };
  }

  onRender(context, options) {
    const searchInput = this.element?.querySelector('.ncm-shard-search__input');
    if (searchInput) {
      // Restore cursor position after render
      if (this._search) {
        searchInput.value = this._search;
        searchInput.focus();
        const len = this._search.length;
        searchInput.setSelectionRange(len, len);
      }

      const handler = this._searchHandler || (this._searchHandler =
        foundry.utils.debounce((e) => {
          this._search = e.target.value;
          this.render(true);
        }, 350)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Activity Log — called from parent's shard EventBus subscriptions
  // ═══════════════════════════════════════════════════════════

  /**
   * Record a shard event in the session activity log.
   * @param {string} type - 'success' | 'fail' | 'gm'
   * @param {string} icon - FontAwesome icon name (without 'fa-')
   * @param {object} data - Event data with itemId, actorId
   * @param {string} text - Description text
   */
  logActivity(type, icon, data, text) {
    const actor = data.actorId ? game.actors?.get(data.actorId) : null;
    const item = data.itemId ? game.items?.get(data.itemId) : null;
    const actorName = actor?.name || (data.actorId === 'gm-override' ? 'GM' : 'Unknown');
    const shardName = item?.name || 'Unknown Shard';

    this._activityLog.unshift({
      type,
      icon,
      text: `<span class="ncm-activity-actor">${actorName}</span> ${text} — <span class="ncm-activity-shard">${shardName}</span>`,
      time: this.app._getRelativeTime(Date.now()),
      timestamp: Date.now(),
    });

    // Keep max 20 entries
    if (this._activityLog.length > 20) this._activityLog.length = 20;
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers — static shard collector
  // ═══════════════════════════════════════════════════════════

  /**
   * Collect every Item flagged as a data shard (world + actor-owned).
   * @returns {Item[]}
   */
  _getAllDataShards() {
    const shards = [];

    for (const item of game.items ?? []) {
      if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
    }

    for (const actor of game.actors ?? []) {
      for (const item of actor.items ?? []) {
        if (item.getFlag(MODULE_ID, 'isDataShard') === true) shards.push(item);
      }
    }

    return shards;
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers — data gathering and grouping
  // ═══════════════════════════════════════════════════════════

  _gatherData() {
    const shards = [];

    try {
      const allShards = this._getAllDataShards();
      const svc = this.dataShardService;

      for (const item of allShards) {
        const config = svc?.getConfig(item) ?? item.getFlag(MODULE_ID, 'config') ?? {};
        const state = svc?.getState(item) ?? item.getFlag(MODULE_ID, 'state') ?? {};
        const integrity = svc?.checkIntegrity(item) ?? { enabled: false, percentage: 100, tier: 'clean' };

        // Preset info
        const presetKey = config.preset || 'blank';
        const preset = game.nightcity?.dataShardService?.getPreset(presetKey);

        // Determine status
        let status = 'locked';
        if (state.destroyed || integrity.isBricked) {
          status = 'destroyed';
        } else if (state.decrypted) {
          status = 'breached';
        } else if (config.encryptionType === 'BLACK_ICE' || config.encryptionType === 'RED_ICE') {
          status = 'blackice';
        } else if (!config.encrypted && !config.requiresLogin && !(config.network?.required ?? config.requiresNetwork)) {
          status = 'open';
        }

        // ICE stripe class
        let iceStripe = 'none';
        if (config.encryptionType === 'RED_ICE') iceStripe = 'red';
        else if (config.encryptionType === 'BLACK_ICE') iceStripe = 'black';
        else if (config.encrypted) iceStripe = 'ice';
        if (state.decrypted) iceStripe = 'decrypted';
        if (status === 'destroyed') iceStripe = 'destroyed';

        // Build security badges
        const badges = [];
        if (state.decrypted) {
          badges.push({ type: 'green', icon: 'fa-unlock', label: 'Breached' });
        } else if (status === 'destroyed') {
          badges.push({ type: 'danger', icon: 'fa-skull-crossbones', label: 'Destroyed' });
        } else if (status === 'open') {
          badges.push({ type: 'muted', icon: 'fa-lock-open', label: 'Open' });
        } else if (config.encrypted) {
          badges.push({ type: 'red', icon: 'fa-lock', label: 'Locked' });
        }

        const netConfig = config.network ?? {};
        if (netConfig.required ?? config.requiresNetwork) {
          const netId = netConfig.allowedNetworks?.[0] ?? config.requiredNetwork ?? null;
          const netName = netId ? (this.networkService?.getNetwork(netId)?.name ?? netId) : 'Network';
          badges.push({ type: 'muted', icon: 'fa-network-wired', label: netName });
        }
        if (netConfig.connectionMode === 'tethered') {
          badges.push({ type: 'cyan', icon: 'fa-link', label: 'Tethered' });
        }

        // Integrity badge
        if (integrity.enabled && integrity.percentage < 75) {
          badges.push({ type: 'danger', icon: 'fa-triangle-exclamation', label: `${integrity.percentage}%` });
        }

        // Owner info — for grouping
        let ownerKey = 'world';
        let ownerName = 'World Items';
        let ownerIcon = 'fas fa-box-open';
        let ownerImg = null;
        if (item.parent && item.parent instanceof Actor) {
          ownerKey = `actor-${item.parent.id}`;
          ownerName = item.parent.name;
          ownerIcon = 'fas fa-user';
          ownerImg = item.parent.img || item.parent.prototypeToken?.texture?.src || null;
        } else if (item.compendium) {
          ownerKey = 'compendium';
          ownerName = 'Compendium';
          ownerIcon = 'fas fa-book';
        }

        // Count entries + eddies
        const journalId = item.getFlag(MODULE_ID, 'journalId');
        const journal = journalId ? game.journal.get(journalId) : null;
        const entryCount = journal?.pages?.size ?? 0;
        let totalEddies = 0;
        let claimedEddies = 0;
        let unclaimedEddies = 0;
        let corruptedCount = 0;

        if (journal) {
          for (const page of journal.pages) {
            const flags = page.flags?.[MODULE_ID];
            if (flags?.contentType === 'eddies' && flags?.contentData) {
              const amt = flags.contentData.amount ?? 0;
              totalEddies += amt;
              if (flags.contentData.claimed) claimedEddies += amt;
              else unclaimedEddies += amt;
            }
            if (flags?.corrupted) corruptedCount++;
          }
        }

        // Eddies badges — separate claimed vs unclaimed
        if (unclaimedEddies > 0) {
          badges.push({ type: 'gold', icon: 'fa-coins', label: `${unclaimedEddies.toLocaleString()} eb` });
        }
        if (claimedEddies > 0) {
          badges.push({ type: 'muted', icon: 'fa-coins', label: `${claimedEddies.toLocaleString()} eb claimed` });
        }

        // Count attempts + breached by + last accessed
        const sessions = state.sessions ?? {};
        let attemptCount = 0;
        let breachedBy = null;
        let lastAccessedTs = 0;
        for (const [actorId, session] of Object.entries(sessions)) {
          attemptCount += session.hackAttempts ?? 0;
          if (session.loggedIn || state.decrypted) {
            const actor = game.actors?.get(actorId);
            if (actor) breachedBy = actor.name;
          }
          // Track most recent access timestamp
          const ts = session.lastAccessed ?? session.lastLogin ?? 0;
          if (ts > lastAccessedTs) lastAccessedTs = ts;
        }

        // Format last accessed
        let lastAccessedLabel = 'Never';
        let lastAccessedRecent = false;
        if (lastAccessedTs > 0) {
          const ago = Date.now() - lastAccessedTs;
          if (ago < 60000) { lastAccessedLabel = 'Just now'; lastAccessedRecent = true; }
          else if (ago < 3600000) { lastAccessedLabel = `${Math.floor(ago / 60000)}m ago`; lastAccessedRecent = ago < 600000; }
          else if (ago < 86400000) { lastAccessedLabel = `${Math.floor(ago / 3600000)}h ago`; }
          else { lastAccessedLabel = `${Math.floor(ago / 86400000)}d ago`; }
        }

        // Preset icon + label + color class
        const presetIcon = preset?.icon || config.boot?.faIcon || 'fas fa-microchip';
        const presetLabel = preset?.label || 'Custom';
        const ICON_CLASS_MAP = {
          'corporate-dossier': 'corp',
          'military-intel': 'mil',
          'fixer-dead-drop': 'fixer',
          'street-shard': 'street',
          'black-market': 'black',
          'personal-memory': 'memory',
          'media-leak': 'media',
          'netwatch-evidence': 'nw',
          'blank': '',
        };
        const presetIconClass = ICON_CLASS_MAP[presetKey] || '';

        // Meta line
        const metaParts = [presetLabel];
        if (config.encrypted) {
          metaParts.push(`<span style="color:${iceStripe === 'red' ? '#cc0000' : iceStripe === 'black' ? 'var(--ncm-danger)' : 'var(--ncm-accent)'}">${config.encryptionType}</span>`);
          metaParts.push(`DV ${config.encryptionDC}`);
        }
        metaParts.push(netConfig.connectionMode === 'tethered' ? 'Tethered' : 'Offline');

        // Security layers for expand preview
        const layers = [];
        if (netConfig.required ?? config.requiresNetwork) layers.push({ key: 'network', name: 'Network', cleared: !!Object.values(sessions).find(s => s.hackedLayers?.includes('network')) || status === 'breached' || status === 'open' });
        if (config.requiresKeyItem) layers.push({ key: 'keyitem', name: 'Key Item', cleared: !!Object.values(sessions).find(s => s.keyItemUsed) });
        if (config.requiresLogin) layers.push({ key: 'login', name: 'Login', cleared: !!Object.values(sessions).find(s => s.loggedIn) });
        if (config.encrypted) layers.push({ key: 'encryption', name: 'Encryption', cleared: state.decrypted });

        // First entry preview snippet
        let firstEntrySnippet = '';
        if (journal?.pages?.size) {
          const firstPage = journal.pages.contents[0];
          const pageFlags = firstPage?.flags?.[MODULE_ID];
          firstEntrySnippet = pageFlags?.body || pageFlags?.contentData?.message || firstPage?.text?.content || '';
          if (firstEntrySnippet.length > 200) firstEntrySnippet = firstEntrySnippet.slice(0, 200) + '...';
          // Strip HTML tags
          firstEntrySnippet = firstEntrySnippet.replace(/<[^>]+>/g, '');
        }

        shards.push({
          itemId: item.id,
          name: config.shardName || item.name,
          ownerKey,
          ownerName,
          ownerIcon,
          ownerImg,
          status,
          iceStripe,
          presetKey,
          presetLabel,
          presetIcon,
          presetIconClass,
          metaLine: metaParts.join(' <span class="ncm-shard-row__meta-sep">·</span> '),
          badges,
          entryCount,
          corruptedCount,
          attemptCount,
          breachedBy,
          // Integrity
          integrityEnabled: integrity.enabled,
          integrityPercent: integrity.percentage,
          integrityTier: integrity.tier,
          // Eddies
          totalEddies,
          claimedEddies,
          unclaimedEddies,
          hasUnclaimed: unclaimedEddies > 0,
          // v4 fields
          lastAccessedLabel,
          lastAccessedRecent,
          lastAccessedTs,
          isSelected: this._selectedIds.has(item.id),
          isExpanded: this._expandedId === item.id,
          isDecrypted: state.decrypted ?? false,
          layers,
          firstEntrySnippet,
          hasLayers: layers.length > 0,
        });
      }
    } catch (error) {
      console.error(`${MODULE_ID} | ShardsTab._gatherData:`, error);
    }

    // Apply search filter
    let filtered = shards;
    if (this._search) {
      const q = this._search.toLowerCase();
      filtered = filtered.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.ownerName.toLowerCase().includes(q) ||
        s.presetLabel.toLowerCase().includes(q)
      );
    }

    // Apply ICE filter
    if (this._iceFilter !== 'all') {
      filtered = filtered.filter(s => {
        if (this._iceFilter === 'none') return s.iceStripe === 'none';
        return s.iceStripe === this._iceFilter;
      });
    }

    // Apply status filter
    if (this._statusFilter !== 'all') {
      filtered = filtered.filter(s => {
        if (this._statusFilter === 'locked') return s.status === 'locked' || s.status === 'blackice';
        return s.status === this._statusFilter;
      });
    }

    // Apply owner filter
    if (this._ownerFilter !== 'all') {
      filtered = filtered.filter(s => {
        if (this._ownerFilter === 'world') return s.ownerKey === 'world';
        return s.ownerKey !== 'world'; // 'actors'
      });
    }

    // Apply sort
    filtered.sort((a, b) => {
      switch (this._sort) {
        case 'status': return a.status.localeCompare(b.status);
        case 'accessed': return (b.lastAccessedTs || 0) - (a.lastAccessedTs || 0);
        default: return a.name.localeCompare(b.name);
      }
    });

    return filtered;
  }

  _buildGroups(shards) {
    const mode = this._groupMode || 'owner';

    // 'none' mode — single flat group
    if (mode === 'none') {
      return [this._buildGroupSummary({ key: 'all', name: 'All Shards', icon: 'fas fa-database', img: null, isWorld: false, shards })];
    }

    // Build groups map based on mode
    const groupMap = new Map();
    for (const shard of shards) {
      let groupKey, groupName, groupIcon, groupImg, isWorld;

      switch (mode) {
        case 'preset':
          groupKey = shard.presetKey || 'blank';
          groupName = shard.presetLabel || 'Custom';
          groupIcon = shard.presetIcon || 'fas fa-microchip';
          groupImg = null;
          isWorld = false;
          break;

        case 'status':
          groupKey = shard.status;
          const STATUS_LABELS = { locked: 'Locked', blackice: 'BLACK ICE', breached: 'Breached', open: 'Open', destroyed: 'Destroyed' };
          const STATUS_ICONS = { locked: 'fas fa-lock', blackice: 'fas fa-skull', breached: 'fas fa-unlock', open: 'fas fa-lock-open', destroyed: 'fas fa-skull-crossbones' };
          groupName = STATUS_LABELS[shard.status] || shard.status;
          groupIcon = STATUS_ICONS[shard.status] || 'fas fa-circle';
          groupImg = null;
          isWorld = false;
          break;

        default: // 'owner'
          groupKey = shard.ownerKey;
          groupName = shard.ownerName;
          groupIcon = shard.ownerIcon;
          groupImg = shard.ownerImg;
          isWorld = shard.ownerKey === 'world';
          break;
      }

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, { key: groupKey, name: groupName, icon: groupIcon, img: groupImg, isWorld, shards: [] });
      }
      groupMap.get(groupKey).shards.push(shard);
    }

    // Build final groups with summaries
    const groups = [...groupMap.values()].map(g => this._buildGroupSummary(g));

    // Sort: world/all first, then alphabetical
    groups.sort((a, b) => {
      if (a.isWorld) return -1;
      if (b.isWorld) return 1;
      return a.name.localeCompare(b.name);
    });

    return groups;
  }

  _buildGroupSummary(group) {
    const locked = group.shards.filter(s => s.status === 'locked' || s.status === 'blackice').length;
    const breached = group.shards.filter(s => s.status === 'breached').length;
    const open = group.shards.filter(s => s.status === 'open').length;
    const destroyed = group.shards.filter(s => s.status === 'destroyed').length;

    const pips = group.shards.map(s => ({ class: s.status === 'blackice' ? 'blackice' : s.status }));

    const parts = [];
    if (locked > 0) parts.push(`<span style="color:var(--ncm-color-primary,#F65261);">${locked}</span> locked`);
    if (breached > 0) parts.push(`<span style="color:var(--ncm-success,#00ff41);">${breached}</span> breached`);
    if (open > 0) parts.push(`${open} open`);
    if (destroyed > 0) parts.push(`<span style="color:var(--ncm-danger,#ff0033);">${destroyed}</span> destroyed`);

    return {
      ...group,
      shardCount: group.shards.length,
      pips,
      statusText: parts.join(' · '),
      collapsed: this._collapsedGroups.has(group.key),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  onOpenShardItem(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    // Use the shard viewer if it's a data shard, otherwise fall back to default sheet
    if (item.getFlag(MODULE_ID, 'isDataShard') && game.nightcity?.openDataShard) {
      game.nightcity.openDataShard(item);
    } else {
      item.sheet.render(true);
    }
    log.info(`Admin: Opening shard ${item.name}`);
  }

  async onForceDecrypt(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Force Decrypt',
      content: `<p>Force-decrypt <strong>${item.name}</strong>? This bypasses all security.</p>`,
    });
    if (!confirmed) return;

    await item.update({
      [`flags.${MODULE_ID}.state.decrypted`]: true,
    });

    ui.notifications.info(`Force-decrypted: ${item.name}`);
    this.render(true);
  }

  async onRelockShard(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Relock Shard',
      content: `<p>Relock <strong>${item.name}</strong>? All security state will be fully reset (encryption, login, key item, hack attempts, lockout, boot, expiration).</p>`,
    });
    if (!confirmed) return;

    try {
      this.app._animationActive = true;
      const result = await game.nightcity?.dataShardService?.relockShard(item);
      this.app._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | Relocked: ${item.name}`);
      } else {
        ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | relockShard failed:`, err);
      ui.notifications.error(`NCM | Relock failed: ${err.message}`);
    }
    this.render(true);
  }

  async onConvertItem(event, target) {
    const candidates = [];
    const seenIds = new Set();
    const types = new Set();
    const sources = new Map(); // source name → count

    for (const item of (game.items ?? [])) {
      if (item.getFlag(MODULE_ID, 'isDataShard')) continue;
      candidates.push({ id: item.id, name: item.name, type: item.type, source: 'World', uuid: item.uuid, img: item.img });
      seenIds.add(item.id);
      types.add(item.type);
      sources.set('World', (sources.get('World') || 0) + 1);
    }
    for (const actor of (game.actors ?? [])) {
      for (const item of actor.items) {
        if (seenIds.has(item.id) || item.getFlag(MODULE_ID, 'isDataShard')) continue;
        candidates.push({ id: item.id, name: item.name, type: item.type, source: actor.name, uuid: item.uuid, img: item.img });
        types.add(item.type);
        sources.set(actor.name, (sources.get(actor.name) || 0) + 1);
      }
    }

    if (!candidates.length) {
      ui.notifications.warn('NCM | No unconverted items found. Create an item first.');
      return;
    }

    candidates.sort((a, b) => a.name.localeCompare(b.name));
    const typeOpts = [...types].sort().map(t => `<option value="${t}">${t}</option>`).join('');
    const tabsHtml = [
      `<button class="ncm-pick__tab ncm-pick__tab--active" data-source="">All<span class="ncm-pick__tab-count">${candidates.length}</span></button>`,
      ...[...sources.entries()].map(([name, count]) =>
        `<button class="ncm-pick__tab" data-source="${name}">${name}<span class="ncm-pick__tab-count">${count}</span></button>`
      ),
    ].join('');

    const uuid = await new Promise(resolve => {
      new Dialog({
        title: 'Convert Item to Data Shard',
        content: `
          <div class="ncm-pick__controls">
            <div class="ncm-pick__search-wrap">
              <i class="fas fa-search"></i>
              <input type="text" class="ncm-pick__search" id="ncm-pick-search" placeholder="Search items..." autocomplete="off">
            </div>
            <select class="ncm-pick__filter" id="ncm-pick-type"><option value="">All types</option>${typeOpts}</select>
          </div>
          <div class="ncm-pick__tabs" id="ncm-pick-tabs">${tabsHtml}</div>
          <div class="ncm-pick__list" id="ncm-pick-list">
            ${candidates.map(c => `
              <div class="ncm-pick__item" data-uuid="${c.uuid}" data-name="${c.name.toLowerCase()}" data-type="${c.type}" data-source="${c.source}">
                <img class="ncm-pick__item-img" src="${c.img || 'icons/svg/item-bag.svg'}" width="30" height="30">
                <div style="flex:1;min-width:0;">
                  <div class="ncm-pick__item-name">${c.name}</div>
                  <div class="ncm-pick__item-meta">${c.source}</div>
                </div>
                <span class="ncm-pick__item-type">${c.type}</span>
              </div>
            `).join('')}
          </div>
          <div class="ncm-pick__count" id="ncm-pick-count">${candidates.length} items</div>`,
        buttons: {
          convert: { label: '<i class="fas fa-microchip"></i> Convert', callback: html => {
            const sel = html[0].querySelector('.ncm-pick__item--selected');
            resolve(sel?.dataset.uuid || null);
          }},
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'convert',
        render: html => {
          const root = html[0] ?? html;
          const search = root.querySelector('#ncm-pick-search');
          const typeFilter = root.querySelector('#ncm-pick-type');
          const tabs = root.querySelector('#ncm-pick-tabs');
          const list = root.querySelector('#ncm-pick-list');
          const count = root.querySelector('#ncm-pick-count');
          let activeSource = '';

          const filter = () => {
            const q = search.value.toLowerCase();
            const t = typeFilter.value;
            let visible = 0;
            list.querySelectorAll('.ncm-pick__item').forEach(el => {
              const nameMatch = !q || el.dataset.name.includes(q);
              const typeMatch = !t || el.dataset.type === t;
              const sourceMatch = !activeSource || el.dataset.source === activeSource;
              const show = nameMatch && typeMatch && sourceMatch;
              el.dataset.hidden = !show;
              if (show) visible++;
            });
            count.textContent = `${visible} item${visible !== 1 ? 's' : ''}`;
          };

          search.addEventListener('input', filter);
          typeFilter.addEventListener('change', filter);
          tabs.addEventListener('click', (ev) => {
            const tab = ev.target.closest('.ncm-pick__tab');
            if (!tab) return;
            tabs.querySelectorAll('.ncm-pick__tab').forEach(t => t.classList.remove('ncm-pick__tab--active'));
            tab.classList.add('ncm-pick__tab--active');
            activeSource = tab.dataset.source;
            filter();
          });
          list.addEventListener('click', (ev) => {
            const el = ev.target.closest('.ncm-pick__item');
            if (!el) return;
            list.querySelectorAll('.ncm-pick__item--selected').forEach(s => s.classList.remove('ncm-pick__item--selected'));
            el.classList.add('ncm-pick__item--selected');
          });
          list.addEventListener('dblclick', (ev) => {
            const el = ev.target.closest('.ncm-pick__item');
            if (el) { el.classList.add('ncm-pick__item--selected'); root.closest('.dialog')?.querySelector('[data-button="convert"]')?.click(); }
          });
          search.focus();
        },
      }, { width: 440, classes: ['ncm-pick-dialog'] }).render(true);
    });

    if (!uuid) return;
    const item = await fromUuid(uuid);
    if (!item) { ui.notifications.error('NCM | Item not found.'); return; }

    const result = await game.nightcity?.dataShardService?.convertToDataShard(item);
    if (result?.success) {
      ui.notifications.info(`NCM | "${item.name}" converted to data shard.`);
      ui.items?.render();
      this.render();
    } else {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
  }

  async onQuickCreateShard(event, target) {
    const presetKey = target.closest('[data-preset]')?.dataset.preset;
    if (!presetKey) return;

    // Prompt GM to select an item
    const items = game.items?.filter(i => !i.getFlag(MODULE_ID, 'isDataShard')) ?? [];
    if (!items.length) {
      ui.notifications.warn('NCM | No unconverted items available. Create an item first.');
      return;
    }

    const options = items.map(i => `<option value="${i.id}">${i.name}</option>`).join('');
    const itemId = await new Promise(resolve => {
      new Dialog({
        title: 'Quick Create Shard',
        content: `<p>Select an item to convert with the <strong>${presetKey}</strong> preset:</p>
          <div class="form-group"><select id="ncm-qc-item">${options}</select></div>`,
        buttons: {
          create: { label: 'Create', callback: html => resolve(html.find('#ncm-qc-item').val()) },
          cancel: { label: 'Cancel', callback: () => resolve(null) },
        },
        default: 'create',
      }).render(true);
    });

    if (!itemId) return;
    const item = game.items.get(itemId);
    if (!item) return;

    const result = await this.dataShardService?.convertToDataShard(item, {}, presetKey);
    if (result?.success) {
      ui.notifications.info(`NCM | Created "${item.name}" with ${presetKey} preset.`);
      this.render();
    } else {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
  }

  async onBulkRelockAll(event, target) {
    const shards = this._getAllDataShards().filter(i => {
      const state = i.getFlag(MODULE_ID, 'state') ?? {};
      return state.decrypted === true;
    });

    if (!shards.length) {
      ui.notifications.info('NCM | No breached shards to relock.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Bulk Relock All Shards',
      content: `<p>Relock <strong>${shards.length}</strong> breached shard${shards.length > 1 ? 's' : ''}? All session data will be reset.</p>`,
    });
    if (!confirmed) return;

    try {
      this.app._animationActive = true;
      for (const item of shards) {
        await this.dataShardService?.relockShard(item);
      }
      this.app._animationActive = false;
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | bulkRelockAll failed:`, err);
    }
    ui.notifications.info(`NCM | ${shards.length} shard${shards.length > 1 ? 's' : ''} relocked.`);
    this.render();
  }

  async onPurgeDestroyed(event, target) {
    const destroyed = this._getAllDataShards().filter(i => {
      const state = i.getFlag(MODULE_ID, 'state') ?? {};
      return state.destroyed === true;
    });

    if (!destroyed.length) {
      ui.notifications.info('NCM | No destroyed shards to purge.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Purge Destroyed Shards',
      content: `<p>Remove shard flags from <strong>${destroyed.length}</strong> destroyed shard${destroyed.length > 1 ? 's' : ''}? The items will remain but lose their shard data.</p>`,
    });
    if (!confirmed) return;

    for (const item of destroyed) {
      await this.dataShardService?.removeDataShard(item, true);
    }
    ui.notifications.info(`NCM | ${destroyed.length} destroyed shard${destroyed.length > 1 ? 's' : ''} purged.`);
    this.render();
  }

  onConfigureShardItem(event, target) {
    event.stopPropagation(); // Don't trigger card click (openShardItem)
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    import('../../ItemInbox/ItemInboxConfig.js').then(({ ItemInboxConfig }) => {
      new ItemInboxConfig({ item }).render(true);
    });
  }

  async onRelockShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    try {
      this.app._animationActive = true;
      const result = await game.nightcity?.dataShardService?.relockShard(item);
      this.app._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | Relocked: ${item.name}`);
      } else {
        ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | relockShardItem failed:`, err);
      ui.notifications.error(`NCM | Relock failed: ${err.message}`);
    }
    this.render();
  }

  // ─── v4 Shard Tab Handlers ───

  onToggleGroup(event, target) {
    const key = target.closest('[data-group-key]')?.dataset.groupKey;
    if (!key) return;
    if (this._collapsedGroups.has(key)) {
      this._collapsedGroups.delete(key);
    } else {
      this._collapsedGroups.add(key);
    }
    this.render();
  }

  onToggleSelectMode(event, target) {
    this._selectMode = !this._selectMode;
    if (!this._selectMode) this._selectedIds.clear();
    this.render();
  }

  onToggleSelect(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    if (this._selectedIds.has(itemId)) {
      this._selectedIds.delete(itemId);
    } else {
      this._selectedIds.add(itemId);
    }
    this.render();
  }

  onDeselectAll(event, target) {
    this._selectedIds.clear();
    this.render();
  }

  onExpand(event, target) {
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    this._expandedId = this._expandedId === itemId ? null : itemId;
    this.render();
  }

  async onBulkRelockSelected(event, target) {
    const ids = [...this._selectedIds];
    if (!ids.length) return;

    const confirmed = await Dialog.confirm({
      title: 'Relock Selected Shards',
      content: `<p>Relock <strong>${ids.length}</strong> selected shard${ids.length > 1 ? 's' : ''}? All session data will be reset.</p>`,
    });
    if (!confirmed) return;

    for (const id of ids) {
      const item = this.app.constructor._findItem(id);
      if (item) await this.dataShardService?.relockShard(item);
    }
    this._selectedIds.clear();
    ui.notifications.info(`NCM | ${ids.length} shard${ids.length > 1 ? 's' : ''} relocked.`);
    this.render();
  }

  onBulkExportSelected(event, target) {
    const ids = [...this._selectedIds];
    if (!ids.length) return;

    const exportData = [];
    for (const id of ids) {
      const item = this.app.constructor._findItem(id);
      if (!item) continue;
      const config = item.getFlag(MODULE_ID, 'config');
      const state = item.getFlag(MODULE_ID, 'state');
      exportData.push({ name: item.name, id: item.id, config, state });
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-shards-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info(`NCM | Exported ${exportData.length} shard${exportData.length > 1 ? 's' : ''}.`);
  }

  async onUnconvertShard(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;

    let item;
    if (itemId) {
      item = this.app.constructor._findItem(itemId);
    } else {
      const shards = this._getAllDataShards();
      if (!shards.length) {
        ui.notifications.warn('NCM | No data shards to unconvert.');
        return;
      }

      const pickedId = await new Promise(resolve => {
        new Dialog({
          title: 'Unconvert Data Shard',
          content: `
            <div class="ncm-pick--danger">
              <div class="ncm-pick__controls">
                <div class="ncm-pick__search-wrap">
                  <i class="fas fa-search"></i>
                  <input type="text" class="ncm-pick__search" id="ncm-pick-search" placeholder="Search shards..." autocomplete="off">
                </div>
              </div>
              <div class="ncm-pick__list" id="ncm-pick-list">
                ${shards.map(s => {
                  const config = s.getFlag(MODULE_ID, 'config') || {};
                  const preset = config.preset || 'default';
                  const encrypted = config.encrypted || false;
                  const iceType = config.iceType || (encrypted ? 'ICE' : '');
                  const state = s.getFlag(MODULE_ID, 'state') || {};
                  const isOpen = state.decrypted || !encrypted;
                  let badgeHtml = '';
                  if (iceType === 'BLACK_ICE' || iceType === 'black') {
                    badgeHtml = '<span class="ncm-pick__shard-badge ncm-pick__shard-badge--ice"><i class="fas fa-skull"></i> BLACK</span>';
                  } else if (encrypted) {
                    badgeHtml = '<span class="ncm-pick__shard-badge ncm-pick__shard-badge--ice"><i class="fas fa-shield-halved"></i> ICE</span>';
                  } else {
                    badgeHtml = '<span class="ncm-pick__shard-badge ncm-pick__shard-badge--open"><i class="fas fa-unlock"></i> Open</span>';
                  }
                  return `<div class="ncm-pick__item" data-id="${s.id}" data-name="${s.name.toLowerCase()}">
                    <img class="ncm-pick__item-img" src="${s.img || 'icons/svg/item-bag.svg'}" width="30" height="30">
                    <div style="flex:1;min-width:0;">
                      <div class="ncm-pick__item-name">${s.name}</div>
                      <div class="ncm-pick__item-meta">${s.type} · ${preset}</div>
                    </div>
                    ${badgeHtml}
                  </div>`;
                }).join('')}
              </div>
              <div class="ncm-pick__warning">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Shard content, ICE, boot sequence, and configuration will be permanently removed. The base item is preserved.</span>
              </div>
            </div>`,
          buttons: {
            unconvert: { label: '<i class="fas fa-rotate-left"></i> Unconvert', callback: html => {
              const sel = html[0].querySelector('.ncm-pick__item--selected');
              resolve(sel?.dataset.id || null);
            }},
            cancel: { label: 'Cancel', callback: () => resolve(null) },
          },
          default: 'unconvert',
          render: html => {
            const root = html[0] ?? html;
            const search = root.querySelector('#ncm-pick-search');
            const list = root.querySelector('#ncm-pick-list');

            search.addEventListener('input', () => {
              const q = search.value.toLowerCase();
              list.querySelectorAll('.ncm-pick__item').forEach(el => {
                el.dataset.hidden = q && !el.dataset.name.includes(q);
              });
            });
            list.addEventListener('click', (ev) => {
              const el = ev.target.closest('.ncm-pick__item');
              if (!el) return;
              list.querySelectorAll('.ncm-pick__item--selected').forEach(s => s.classList.remove('ncm-pick__item--selected'));
              el.classList.add('ncm-pick__item--selected');
            });
            search.focus();
          },
        }, { width: 400, classes: ['ncm-pick-dialog'] }).render(true);
      });

      if (!pickedId) return;
      item = this.app.constructor._findItem(pickedId);
    }

    if (!item) return;

    const confirmed = await Dialog.confirm({
      title: 'Unconvert Data Shard',
      content: `<p>Remove all data shard flags from <strong>${item.name}</strong>? The item will revert to a normal item. Shard entries and journal data will be preserved but detached.</p>`,
    });
    if (!confirmed) return;

    await item.unsetFlag(MODULE_ID, 'isDataShard');
    await item.unsetFlag(MODULE_ID, 'config');
    await item.unsetFlag(MODULE_ID, 'state');

    ui.notifications.info(`NCM | Unconverted: ${item.name} is now a regular item.`);
    ui.items?.render();
    this.render();
  }

  onCycleSort(event, target) {
    const sortOrder = ['name', 'status', 'accessed'];
    const idx = sortOrder.indexOf(this._sort);
    this._sort = sortOrder[(idx + 1) % sortOrder.length];
    this.render();
  }

  onCycleIceFilter(event, target) {
    const order = ['all', 'ice', 'black', 'red', 'decrypted', 'none'];
    const idx = order.indexOf(this._iceFilter);
    this._iceFilter = order[(idx + 1) % order.length];
    this.render();
  }

  onCycleStatusFilter(event, target) {
    const order = ['all', 'locked', 'breached', 'open', 'destroyed'];
    const idx = order.indexOf(this._statusFilter);
    this._statusFilter = order[(idx + 1) % order.length];
    this.render();
  }

  onCyclePresetFilter(event, target) {
    const presets = ['all', ...(game.nightcity?.dataShardService?.getAllPresets() ?? []).map(p => p.key)];
    const idx = presets.indexOf(this._presetFilter);
    this._presetFilter = presets[(idx + 1) % presets.length];
    this.render();
  }

  onCycleOwnerFilter(event, target) {
    const order = ['all', 'world', 'actors'];
    const idx = order.indexOf(this._ownerFilter);
    this._ownerFilter = order[(idx + 1) % order.length];
    this.render();
  }

  onCycleGroupMode(event, target) {
    const order = ['owner', 'preset', 'status', 'none'];
    const idx = order.indexOf(this._groupMode);
    this._groupMode = order[(idx + 1) % order.length];
    this.render();
  }

  async onToggleLayer(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const layer = target.closest('[data-layer]')?.dataset.layer;
    if (!itemId || !layer) return;

    const item = this.app.constructor._findItem(itemId);
    if (!item) {
      console.warn(`${MODULE_ID} | toggleShardLayer: item ${itemId} not found`);
      return;
    }

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    const sessions = foundry.utils.deepClone(state.sessions ?? {});

    // Determine current cleared state for this layer
    let isCleared = false;
    switch (layer) {
      case 'network':
        isCleared = !!Object.values(sessions).find(s => s.hackedLayers?.includes('network'));
        break;
      case 'keyitem':
        isCleared = !!Object.values(sessions).find(s => s.keyItemUsed);
        break;
      case 'login':
        isCleared = !!Object.values(sessions).find(s => s.loggedIn);
        break;
      case 'encryption':
        isCleared = state.decrypted ?? false;
        break;
    }

    const confirmed = await Dialog.confirm({
      title: `${isCleared ? 'Relock' : 'Unlock'} Security Layer`,
      content: `<p>${isCleared ? 'Relock' : 'Force-clear'} the <strong>${layer}</strong> layer on <strong>${item.name}</strong>?${isCleared ? ' All layers from this point forward will also be relocked.' : ''}</p>`,
    });
    if (!confirmed) return;

    const LAYER_ORDER = ['network', 'keyitem', 'login', 'encryption'];
    const layerIdx = LAYER_ORDER.indexOf(layer);

    // Build the complete new state object
    const newState = foundry.utils.deepClone(state);

    if (isCleared) {
      // RELOCK from this layer forward
      for (const [actorId, session] of Object.entries(newState.sessions ?? {})) {
        const hackedLayers = [...(session.hackedLayers || [])];
        for (let i = layerIdx; i < LAYER_ORDER.length; i++) {
          const l = LAYER_ORDER[i];
          const hIdx = hackedLayers.indexOf(l);
          if (hIdx !== -1) hackedLayers.splice(hIdx, 1);
          if (l === 'keyitem') session.keyItemUsed = false;
          if (l === 'login') session.loggedIn = false;
        }
        session.hackedLayers = hackedLayers;
      }
      if (layerIdx <= LAYER_ORDER.indexOf('encryption')) {
        newState.decrypted = false;
        newState.gmBypassed = false;
      }
    } else {
      // UNLOCK up to and including this layer
      if (!newState.sessions) newState.sessions = {};
      const gmSession = newState.sessions['gm-override']
        || { hackedLayers: [], hackAttempts: 0, loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, loginAttempts: 0, layerHackAttempts: {}, layerLockoutUntil: null, lockoutUntil: null };
      const hackedLayers = [...(gmSession.hackedLayers || [])];
      for (let i = 0; i <= layerIdx; i++) {
        const l = LAYER_ORDER[i];
        if (!hackedLayers.includes(l)) hackedLayers.push(l);
        if (l === 'keyitem') gmSession.keyItemUsed = true;
        if (l === 'login') gmSession.loggedIn = true;
      }
      gmSession.hackedLayers = hackedLayers;
      newState.sessions['gm-override'] = gmSession;
      if (layer === 'encryption') {
        newState.decrypted = true;
        newState.gmBypassed = true;
      }
    }

    try {
      // Suppress debounced re-renders during the two-step flag write
      this.app._animationActive = true;
      await item.unsetFlag(MODULE_ID, 'state');
      await item.setFlag(MODULE_ID, 'state', newState);
      this.app._animationActive = false;

      const verb = isCleared ? 'Relocked' : 'Force-cleared';
      ui.notifications.info(`NCM | ${verb} ${item.name} ${isCleared ? 'from' : 'through'} ${layer} layer.`);
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | toggleShardLayer failed:`, err);
      ui.notifications.error(`NCM | Layer toggle failed: ${err.message}`);
    }
    this.render();
  }

  async onForceDecryptShardItem(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;
    const item = this.app.constructor._findItem(itemId);
    if (!item) {
      console.warn(`${MODULE_ID} | forceDecryptShardItem: item ${itemId} not found`);
      return;
    }

    const state = item.getFlag(MODULE_ID, 'state') ?? {};
    if (state.decrypted) {
      // Already decrypted → relock (delegates to DataShardService which uses unsetFlag/setFlag)
      try {
        this.app._animationActive = true;
        const result = await game.nightcity?.dataShardService?.relockShard(item);
        this.app._animationActive = false;
        if (result?.success) {
          ui.notifications.info(`NCM | Relocked: ${item.name}`);
        } else {
          ui.notifications.error(`NCM | Relock failed: ${result?.error || 'Unknown'}`);
        }
      } catch (err) {
        this.app._animationActive = false;
        console.error(`${MODULE_ID} | forceDecryptShardItem relock failed:`, err);
        ui.notifications.error(`NCM | Relock failed: ${err.message}`);
      }
    } else {
      // Locked → force decrypt via atomic unset/set
      try {
        const newState = foundry.utils.deepClone(state);
        newState.decrypted = true;
        newState.gmBypassed = true;
        // Create a GM override session that has all layers cleared
        if (!newState.sessions) newState.sessions = {};
        const config = item.getFlag(MODULE_ID, 'config') ?? {};
        const gmSession = newState.sessions['gm-override']
          || { hackedLayers: [], hackAttempts: 0, loggedIn: false, keyItemUsed: false, keyItemAttempts: 0, loginAttempts: 0, layerHackAttempts: {}, layerLockoutUntil: null, lockoutUntil: null };
        // Mark all configured layers as cleared
        const allLayers = [];
        const netConfig = config.network ?? {};
        if (netConfig.required ?? config.requiresNetwork) allLayers.push('network');
        if (config.requiresKeyItem) allLayers.push('keyitem');
        if (config.requiresLogin) allLayers.push('login');
        if (config.encrypted) allLayers.push('encryption');
        gmSession.hackedLayers = allLayers;
        if (allLayers.includes('keyitem')) gmSession.keyItemUsed = true;
        if (allLayers.includes('login')) gmSession.loggedIn = true;
        newState.sessions['gm-override'] = gmSession;

        this.app._animationActive = true;
        await item.unsetFlag(MODULE_ID, 'state');
        await item.setFlag(MODULE_ID, 'state', newState);
        this.app._animationActive = false;
        ui.notifications.info(`NCM | Force-decrypted: ${item.name}`);
      } catch (err) {
        this.app._animationActive = false;
        console.error(`${MODULE_ID} | forceDecryptShardItem decrypt failed:`, err);
        ui.notifications.error(`NCM | Force-decrypt failed: ${err.message}`);
      }
    }
    this.render();
  }

  // ─── Integrity ───

  async onSetIntegrity(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    const value = parseInt(target.closest('[data-value]')?.dataset.value);
    if (!itemId || isNaN(value)) return;

    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    try {
      this.app._animationActive = true;
      const result = await game.nightcity?.dataShardService?.setIntegrity(item, value);
      this.app._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | ${item.name} integrity set to ${value}%${result.uncorruptedCount ? ` (${result.uncorruptedCount} entries restored)` : ''}`);
      } else {
        ui.notifications.warn(`NCM | Set integrity failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | setShardIntegrity failed:`, err);
      ui.notifications.error(`NCM | Set integrity failed: ${err.message}`);
    }
    this.render();
  }

  async onRestoreIntegrity(event, target) {
    event.stopPropagation();
    const itemId = target.closest('[data-item-id]')?.dataset.itemId;
    if (!itemId) return;

    const item = this.app.constructor._findItem(itemId);
    if (!item) return;

    try {
      this.app._animationActive = true;
      const result = await game.nightcity?.dataShardService?.setIntegrity(item, 100, { uncorrupt: true });
      this.app._animationActive = false;
      if (result?.success) {
        ui.notifications.info(`NCM | ${item.name} integrity fully restored${result.uncorruptedCount ? ` (${result.uncorruptedCount} entries un-corrupted)` : ''}`);
      } else {
        ui.notifications.warn(`NCM | Restore failed: ${result?.error || 'Unknown'}`);
      }
    } catch (err) {
      this.app._animationActive = false;
      console.error(`${MODULE_ID} | restoreShardIntegrity failed:`, err);
      ui.notifications.error(`NCM | Restore failed: ${err.message}`);
    }
    this.render();
  }
}
