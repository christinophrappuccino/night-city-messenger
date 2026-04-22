/**
 * MessagesTab — Activity feed, scheduled, NPC quick-send, queue, broadcast.
 * @file scripts/ui/AdminPanel/tabs/MessagesTab.js
 * @module cyberpunkred-messenger
 *
 * Owns the heaviest tab: scans every NCM-Inbox-* journal for the
 * activity feed, paginated NPC send-as grid, scheduled message
 * countdown ticker (1s interval, cleaned in onClose), date-range
 * filter, and the actor-filter dropdown.
 *
 * Cross-parent dependencies:
 *   - this.app._activeTab                 — gates feed gathering
 *   - this.app._scrollPositions / _saveScroll() — admin-content scroll preservation
 *   - this.app._relativeTime(ts)          — shared with ContactsTab
 *   - this.app.messageRepository          — for hard-delete fallback
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log, formatCyberDate } from '../../../utils/helpers.js';
import { DateRangePicker } from '../../components/DateRangePicker.js';
import { BaseTab } from '../BaseTab.js';

export class MessagesTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  /** @type {string} Feed direction filter: 'all' | 'received' | 'sent' | 'unread' */
  _filter = 'all';
  /** @type {string} Feed search query */
  _search = '';
  /** @type {string} Actor filter (actor ID or '') */
  _actorFilter = '';
  /** @type {string|null} Expanded message ID in the activity feed */
  _expandedId = null;
  /** @type {boolean} Actor filter dropdown open */
  _actorDropdownOpen = false;
  /** @type {string} Actor filter dropdown search */
  _actorDropdownSearch = '';
  /** @type {string} Date-from filter (YYYY-MM-DD) */
  _dateFrom = '';
  /** @type {string} Date-to filter (YYYY-MM-DD) */
  _dateTo = '';
  /** @type {number} Pagination — how many feed entries to show */
  _limit = 20;
  /** @type {string} NPC quick-send search */
  _npcSearch = '';
  /** @type {number} NPC send page (0-indexed) */
  _npcPage = 0;
  /** @type {number} NPCs per page */
  _npcPerPage = 8;
  /** @type {number|null} Scheduled countdown interval id (1s tick) */
  _schedInterval = null;
  _searchHandler = null;
  _npcSearchHandler = null;
  _actorDdSearchHandler = null;

  get key() { return 'messages'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  prepareContext(stats) {
    const npcSendData = this._gatherNPCActors();
    const playerActors = this._gatherPlayerActors();

    return {
      npcSendEntries: npcSendData.entries,
      npcSendTotalCount: npcSendData.totalCount,
      npcSendPage: npcSendData.page + 1,
      npcSendTotalPages: npcSendData.totalPages,
      npcSendHasPrev: npcSendData.hasPrev,
      npcSendHasNext: npcSendData.hasNext,
      npcSendSearch: npcSendData.search,
      playerActors,
      ...this._gatherTabContext(stats),
    };
  }

  onRender(context, options) {
    // ── Feed search input ──
    const searchInput = this.element?.querySelector('.ncm-msg-feed-search__input');
    if (searchInput) {
      if (this._search) {
        searchInput.value = this._search;
        searchInput.focus();
        const len = this._search.length;
        searchInput.setSelectionRange(len, len);
      }

      const handler = this._searchHandler || (this._searchHandler =
        foundry.utils.debounce((e) => {
          this._search = e.target.value;
          this._limit = 20;
          this.render(true);
        }, 350)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }

    // ── NPC send-as search input ──
    const npcSearch = this.element?.querySelector('.ncm-msg-npc-search__input');
    if (npcSearch) {
      if (this._npcSearch) {
        npcSearch.value = this._npcSearch;
        npcSearch.focus();
        const len = this._npcSearch.length;
        npcSearch.setSelectionRange(len, len);
      }

      const npcHandler = this._npcSearchHandler || (this._npcSearchHandler =
        foundry.utils.debounce((e) => {
          this._npcSearch = e.target.value;
          this._npcPage = 0;
          this.render(true);
        }, 350)
      );
      npcSearch.removeEventListener('input', npcHandler);
      npcSearch.addEventListener('input', npcHandler);
    }

    // ── Actor filter dropdown search input ──
    const actorDdSearch = this.element?.querySelector('.ncm-msg-actor-dd-search__input');
    if (actorDdSearch) {
      if (this._actorDropdownSearch) {
        actorDdSearch.value = this._actorDropdownSearch;
        actorDdSearch.focus();
        const len = this._actorDropdownSearch.length;
        actorDdSearch.setSelectionRange(len, len);
      } else if (this._actorDropdownOpen) {
        actorDdSearch.focus();
      }

      const actorDdHandler = this._actorDdSearchHandler || (this._actorDdSearchHandler =
        foundry.utils.debounce((e) => {
          this._actorDropdownSearch = e.target.value;
          this.render(true);
        }, 200)
      );
      actorDdSearch.removeEventListener('input', actorDdHandler);
      actorDdSearch.addEventListener('input', actorDdHandler);
    }

    // ── Scheduled countdown ticking ──
    if (this._schedInterval) {
      clearInterval(this._schedInterval);
      this._schedInterval = null;
    }

    const countdownEls = this.element?.querySelectorAll('[data-delivery-time]');
    if (countdownEls?.length) {
      const ts = game.nightcity?.timeService;

      this._schedInterval = setInterval(() => {
        // Self-clean if tab switched or panel closed
        const firstEl = this.element?.querySelector('[data-delivery-time]');
        if (!firstEl || this.app._activeTab !== 'messages') {
          clearInterval(this._schedInterval);
          this._schedInterval = null;
          return;
        }

        for (const el of this.element.querySelectorAll('[data-delivery-time]')) {
          const deliveryIso = el.dataset.deliveryTime;
          const useGameTime = el.dataset.useGameTime === 'true';

          const nowIso = useGameTime
            ? (ts?.getCurrentTime() ?? new Date().toISOString())
            : new Date().toISOString();

          const nowMs = new Date(nowIso).getTime();
          const deliveryMs = new Date(deliveryIso).getTime();
          const diffMs = Math.max(0, deliveryMs - nowMs);
          const diffSec = Math.floor(diffMs / 1000);

          const hours = Math.floor(diffSec / 3600);
          const mins = Math.floor((diffSec % 3600) / 60);
          const secs = diffSec % 60;
          const countdown = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

          el.textContent = countdown;

          // Update soon class
          const isSoon = diffMs < 5 * 60 * 1000;
          el.classList.toggle('ncm-msg-sched-row__countdown--soon', isSoon);
        }
      }, 1000);
    }

    // ── Close actor dropdown when clicking outside ──
    if (this._actorDropdownOpen) {
      const closeDropdown = (e) => {
        if (!e.target.closest('.ncm-msg-actor-filter')) {
          this._actorDropdownOpen = false;
          this._actorDropdownSearch = '';
          this.render(true);
          document.removeEventListener('pointerdown', closeDropdown);
        }
      };
      setTimeout(() => document.addEventListener('pointerdown', closeDropdown), 0);
    }
  }

  onClose() {
    if (this._schedInterval) {
      clearInterval(this._schedInterval);
      this._schedInterval = null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Public — formatScheduledEntry (called from parent _prepareContext)
  // ═══════════════════════════════════════════════════════════

  formatScheduledEntry(entry) {
    const fromActor = game.actors.get(entry.messageData?.fromActorId);
    const toActor = game.actors.get(entry.messageData?.toActorId);

    const now = Date.now();
    const deliveryMs = new Date(entry.deliveryTime).getTime();
    const diffMs = Math.max(0, deliveryMs - now);
    const diffSec = Math.floor(diffMs / 1000);

    const hours = Math.floor(diffSec / 3600);
    const mins = Math.floor((diffSec % 3600) / 60);
    const secs = diffSec % 60;
    const countdown = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    const isSoon = diffMs < 5 * 60 * 1000; // < 5 minutes

    // Delivery date in cyberpunk format
    const dt = new Date(entry.deliveryTime);
    const deliveryDate = `${dt.getUTCDate().toString().padStart(2, '0')}.${(dt.getUTCMonth() + 1).toString().padStart(2, '0')}.${dt.getUTCFullYear()} // ${dt.getUTCHours().toString().padStart(2, '0')}:${dt.getUTCMinutes().toString().padStart(2, '0')}`;

    // Priority
    const priority = entry.messageData?.priority || 'normal';

    // From color
    const fromColor = fromActor?.hasPlayerOwner
      ? 'var(--ncm-secondary)'
      : (priority === 'critical' ? 'var(--ncm-danger)' : 'var(--ncm-accent)');

    return {
      ...entry,
      fromName: fromActor?.name ?? entry.messageData?.from ?? 'Unknown',
      toName: toActor?.name ?? entry.messageData?.to ?? 'Unknown',
      subject: entry.messageData?.subject ?? '(no subject)',
      countdown,
      isSoon,
      deliveryDate,
      priority,
      fromColor,
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers — data gathering
  // ═══════════════════════════════════════════════════════════

  _gatherNPCActors() {
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
      ripperdoc: '#e06888', gang: '#cc4444', government: '#5a7fa5', ai: '#ff44cc',
    };

    const all = [];
    const seenIds = new Set();

    // ── Pass 1: Master contacts (non-player) ──
    const contacts = this.masterContactService?.getAll() ?? [];
    for (const c of contacts) {
      if (!c.email) continue;
      // Skip player-linked contacts
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        if (actor?.hasPlayerOwner) continue;
      }
      const primaryId = c.actorId || c.id;
      if (seenIds.has(primaryId)) continue;
      seenIds.add(primaryId);
      if (c.actorId) seenIds.add(c.actorId);
      seenIds.add(c.id);

      const roleLower = (c.role || '').toLowerCase();
      all.push({
        id: primaryId,
        contactId: c.id,
        name: c.name,
        email: c.email,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        portrait: c.portrait || null,
        role: c.role || '',
        isContact: true,
      });
    }

    // ── Pass 2: NPC actors with emails NOT already in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner) continue;
      if (seenIds.has(actor.id)) continue;
      const email = actor.getFlag(MODULE_ID, 'email');
      if (!email) continue;
      seenIds.add(actor.id);

      all.push({
        id: actor.id,
        contactId: null,
        name: actor.name,
        email,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#F65261',
        portrait: actor.img && !actor.img.includes('mystery-man') ? actor.img : null,
        role: '',
        isContact: false,
      });
    }

    // Sort alphabetically
    all.sort((a, b) => a.name.localeCompare(b.name));

    // Apply search
    let filtered = all;
    if (this._npcSearch) {
      const q = this._npcSearch.toLowerCase();
      filtered = filtered.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.email.toLowerCase().includes(q) ||
        n.role.toLowerCase().includes(q)
      );
    }

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / this._npcPerPage));

    // Clamp page
    if (this._npcPage >= totalPages) this._npcPage = totalPages - 1;
    if (this._npcPage < 0) this._npcPage = 0;

    const startIdx = this._npcPage * this._npcPerPage;
    const entries = filtered.slice(startIdx, startIdx + this._npcPerPage);

    return {
      entries,
      totalCount,
      page: this._npcPage,
      totalPages,
      hasPrev: this._npcPage > 0,
      hasNext: this._npcPage < totalPages - 1,
      search: this._npcSearch,
    };
  }

  _gatherPlayerActors() {
    return game.actors
      .filter(a => a.hasPlayerOwner)
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img,
      }));
  }

  _gatherInboxDropdownEntries() {
    const entries = [];
    const seenIds = new Set();

    // ── Players ──
    for (const user of game.users ?? []) {
      if (user.isGM || !user.character) continue;
      const actor = user.character;
      if (seenIds.has(actor.id)) continue;
      seenIds.add(actor.id);

      entries.push({
        inboxId: actor.id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#19f3f7',
        type: 'Player',
        typeIcon: 'fa-user',
        email: actor.getFlag?.(MODULE_ID, 'email') || '',
        isPlayer: true,
      });
    }

    // ── Master contacts ──
    const contacts = this.masterContactService?.getAll() ?? [];
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
    };

    for (const c of contacts) {
      const primaryId = c.actorId || c.id;
      if (seenIds.has(primaryId)) continue;
      seenIds.add(primaryId);
      if (c.actorId) seenIds.add(c.actorId);
      seenIds.add(c.id);

      // Skip player-linked
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        if (actor?.hasPlayerOwner) continue;
      }

      const roleLower = (c.role || '').toLowerCase();
      entries.push({
        inboxId: primaryId,
        name: c.name,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        type: c.role ? c.role.charAt(0).toUpperCase() + c.role.slice(1) : 'NPC',
        typeIcon: 'fa-user-secret',
        email: c.email || '',
        isPlayer: false,
      });
    }

    // ── NPC actors with emails not in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner) continue;
      if (seenIds.has(actor.id)) continue;
      const email = actor.getFlag(MODULE_ID, 'email');
      if (!email) continue;
      seenIds.add(actor.id);

      entries.push({
        inboxId: actor.id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#F65261',
        type: 'NPC',
        typeIcon: 'fa-user-secret',
        email,
        isPlayer: false,
      });
    }

    // Sort: players first, then alphabetical
    entries.sort((a, b) => {
      if (a.isPlayer && !b.isPlayer) return -1;
      if (!a.isPlayer && b.isPlayer) return 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  _gatherTabContext(stats) {
    // Only compute feed when tab is active (performance)
    if (this.app._activeTab !== 'messages') {
      return {
        msgFeedEntries: [],
        msgFeedHasMore: false,
        msgFeedTotalCount: 0,
        msgFeedShowing: 0,
        msgQueueEntries: [],
        msgQueueCount: 0,
        msgSentToday: 0,
        msgFeedFilter: this._filter,
        msgFeedSearch: this._search,
        msgFeedActorFilter: this._actorFilter,
        msgFeedActorName: '',
        msgActorDropdownOpen: false,
        msgActorDropdownSearch: '',
        msgActorFilterOptions: [],
        msgFeedDateFrom: this._dateFrom,
        msgFeedDateTo: this._dateTo,
      };
    }

    const feedResult = this._gatherActivity();
    const feedEntries = feedResult.entries;
    const feedTotalFiltered = feedResult.totalFiltered;
    const queueEntries = this._gatherQueue();
    const actorOptions = this._gatherActorFilterOptions(feedEntries);

    // Resolve actor/contact name for the filter display
    let actorName = '';
    if (this._actorFilter) {
      const actor = game.actors?.get(this._actorFilter);
      if (actor) {
        actorName = actor.name;
      } else {
        const contact = this.masterContactService?.getContact(this._actorFilter);
        actorName = contact?.name ?? this._actorFilter;
      }
    }

    // Count sent today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const sentToday = feedEntries.filter(e =>
      e.isSent && e.rawTimestamp >= todayMs
    ).length;

    return {
      msgFeedEntries: feedEntries,
      msgFeedHasMore: feedTotalFiltered > feedEntries.length,
      msgFeedTotalCount: feedTotalFiltered,
      msgFeedShowing: feedEntries.length,
      msgQueueEntries: queueEntries,
      msgQueueCount: queueEntries.length,
      msgSentToday: sentToday,
      msgFeedFilter: this._filter,
      msgFeedSearch: this._search,
      msgFeedActorFilter: this._actorFilter,
      msgFeedActorName: actorName,
      msgActorDropdownOpen: this._actorDropdownOpen,
      msgActorDropdownSearch: this._actorDropdownSearch,
      msgActorFilterOptions: this._actorDropdownSearch
        ? actorOptions.filter(o => o.isGroupLabel || (o.name && o.name.toLowerCase().includes(this._actorDropdownSearch.toLowerCase())))
        : actorOptions,
      msgFeedDateFrom: this._dateFrom,
      msgFeedDateTo: this._dateTo,
    };
  }

  _gatherActivity() {
    const entries = [];

    try {
      // Scan all NCM inbox journals
      for (const journal of game.journal ?? []) {
        if (!journal.name?.startsWith('NCM-Inbox-')) continue;
        const isContactInbox = journal.name.startsWith('NCM-Inbox-Contact-');
        const ownerId = isContactInbox
          ? journal.name.replace('NCM-Inbox-Contact-', '')
          : journal.name.replace('NCM-Inbox-', '');

        for (const page of journal.pages ?? []) {
          const flags = page.flags?.['cyberpunkred-messenger'];
          if (!flags) continue;

          const msgId = flags.messageId || page.id;
          const isSentCopy = msgId.endsWith('-sent');
          const from = flags.senderName || flags.from || 'Unknown';
          const to = flags.recipientName || flags.to || 'Unknown';
          const subject = flags.subject || page.name || '(no subject)';
          const body = flags.body || page.text?.content || '';
          const timestamp = flags.timestamp || '';
          const rawTimestamp = timestamp ? new Date(timestamp).getTime() : 0;
          const isRead = flags.status?.read ?? false;
          const isDeleted = flags.status?.deleted ?? false;
          const network = flags.metadata?.networkTrace || flags.network || 'CITINET';
          const signal = flags.metadata?.signalStrength ?? null;
          const encrypted = flags.status?.encrypted ?? false;
          const attachments = (flags.attachments || []).map(a => ({
            name: typeof a === 'string' ? a : (a.name || a.filename || 'attachment'),
          }));

          // Determine direction
          let dirClass = 'in';
          let dirIcon = 'arrow-down';
          if (isSentCopy) {
            dirClass = 'out';
            dirIcon = 'arrow-up';
          }
          if (flags.isBroadcast || flags.type === 'broadcast') {
            dirClass = 'system';
            dirIcon = 'tower-broadcast';
          }

          // Status
          let statusClass = 'delivered';
          let statusIcon = 'check';
          let statusLabel = 'Delivered';
          if (isDeleted) {
            statusClass = 'deleted';
            statusIcon = 'trash';
            statusLabel = 'Deleted';
          } else if (isSentCopy) {
            statusClass = 'sent';
            statusIcon = 'paper-plane';
            statusLabel = 'Sent';
          } else if (isRead) {
            statusClass = 'read';
            statusIcon = 'check-double';
            statusLabel = 'Read';
          } else if (!isRead) {
            statusClass = 'unread';
            statusIcon = 'envelope';
            statusLabel = 'Unread';
          }

          // Relative time
          const relativeTime = this.app._relativeTime(timestamp);
          const isRecent = rawTimestamp > 0 && (Date.now() - rawTimestamp) < 600000; // 10 min

          // Full timestamp in cyberpunk format
          const fullTimestamp = timestamp ? formatCyberDate(timestamp) : '';
          // Short date for feed row (date only, respects format setting)
          const shortDate = timestamp ? formatCyberDate(timestamp, { dateOnly: true }) : '';

          // Body preview (strip HTML, truncate)
          let bodyPreview = body.replace(/<[^>]+>/g, '');
          if (bodyPreview.length > 300) bodyPreview = bodyPreview.slice(0, 300) + '...';

          // Determine actor/contact IDs for filter
          const fromActorId = flags.fromActorId || '';
          const toActorId = flags.toActorId || '';
          const fromContactId = flags.fromContactId || '';
          const toContactId = flags.toContactId || '';

          // Network theme data (color + icon from NetworkService)
          const _ns = game.nightcity?.networkService;
          const _netData = _ns?.getNetwork?.(network.toUpperCase()) || _ns?.getNetwork?.(network) || null;
          const networkColor = _netData?.theme?.color || '#8888a0';
          const networkIcon = _netData?.theme?.icon || 'fa-wifi';

          entries.push({
            messageId: msgId,
            inboxOwnerId: ownerId,
            fromName: from,
            toName: to,
            fromActorId,
            toActorId,
            fromContactId,
            toContactId,
            subject,
            bodyPreview,
            dirClass,
            dirIcon,
            statusClass,
            statusIcon,
            statusLabel,
            networkLabel: _netData?.name || network.toUpperCase(),
            networkName: _netData?.name || network,
            networkColor,
            networkIcon,
            signalStrength: signal,
            encrypted,
            attachments,
            relativeTime,
            fullTimestamp,
            shortDate,
            isRecent,
            unread: !isRead && !isSentCopy && !isDeleted,
            isSent: isSentCopy,
            isDeleted,
            rawTimestamp,
            isExpanded: this._expandedId === msgId,
          });
        }
      }
    } catch (error) {
      console.error(`${MODULE_ID} | MessagesTab._gatherActivity:`, error);
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.rawTimestamp - a.rawTimestamp);

    // Apply filters
    let filtered = entries;

    // Direction filter
    if (this._filter === 'received') {
      filtered = filtered.filter(e => e.dirClass === 'in');
    } else if (this._filter === 'sent') {
      filtered = filtered.filter(e => e.dirClass === 'out');
    } else if (this._filter === 'unread') {
      filtered = filtered.filter(e => e.unread);
    }

    // Actor / Contact filter — cross-resolve linked IDs
    if (this._actorFilter) {
      const actId = this._actorFilter;

      // Build a set of all IDs that belong to this entity
      const matchIds = new Set([actId]);

      // If actId is an actor, find any master contact linked to it
      const linkedContact = (this.masterContactService?.getAll() ?? [])
        .find(c => c.actorId === actId || c.id === actId);
      if (linkedContact) {
        if (linkedContact.id) matchIds.add(linkedContact.id);
        if (linkedContact.actorId) matchIds.add(linkedContact.actorId);
      }

      filtered = filtered.filter(e =>
        matchIds.has(e.fromActorId) || matchIds.has(e.toActorId) ||
        matchIds.has(e.fromContactId) || matchIds.has(e.toContactId) ||
        matchIds.has(e.inboxOwnerId)
      );
    }

    // Search filter
    if (this._search) {
      const q = this._search.toLowerCase();
      filtered = filtered.filter(e =>
        e.fromName.toLowerCase().includes(q) ||
        e.toName.toLowerCase().includes(q) ||
        e.subject.toLowerCase().includes(q) ||
        e.bodyPreview.toLowerCase().includes(q)
      );
    }

    // Date range filter
    if (this._dateFrom) {
      const fromMs = new Date(this._dateFrom + 'T00:00:00').getTime();
      if (!isNaN(fromMs)) filtered = filtered.filter(e => e.rawTimestamp >= fromMs);
    }
    if (this._dateTo) {
      const toMs = new Date(this._dateTo + 'T23:59:59').getTime();
      if (!isNaN(toMs)) filtered = filtered.filter(e => e.rawTimestamp <= toMs);
    }

    // Track total before limiting (for "Load More" button)
    const totalFiltered = filtered.length;
    return { entries: filtered.slice(0, this._limit), totalFiltered };
  }

  _gatherQueue() {
    try {
      const queue = this.messageService?.getQueue?.() ?? [];
      return queue.map(entry => {
        const fromActor = entry.fromActorId ? game.actors?.get(entry.fromActorId) : null;
        const toActor = entry.toActorId ? game.actors?.get(entry.toActorId) : null;
        const reason = entry.reason || 'Network unavailable';
        let reasonIcon = 'network-wired';
        if (reason.toLowerCase().includes('dead zone') || reason.toLowerCase().includes('dead_zone')) {
          reasonIcon = 'signal-slash';
        } else if (reason.toLowerCase().includes('lock') || reason.toLowerCase().includes('auth')) {
          reasonIcon = 'lock';
        }

        const queuedMs = entry.queuedAt ? Date.now() - new Date(entry.queuedAt).getTime() : 0;
        let queuedTime = '';
        if (queuedMs > 0) {
          const mins = Math.floor(queuedMs / 60000);
          if (mins < 60) queuedTime = `${mins}m`;
          else queuedTime = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        }

        return {
          messageId: entry.messageId || entry.id || '',
          fromName: fromActor?.name ?? entry.from ?? 'Unknown',
          toName: toActor?.name ?? entry.to ?? 'Unknown',
          reason,
          reasonIcon,
          queuedTime,
        };
      });
    } catch {
      return [];
    }
  }

  _gatherActorFilterOptions(feedEntries) {
    // ── Count messages per unique ID from feed ──
    const idCounts = new Map();
    const _inc = (id) => { if (id) idCounts.set(id, (idCounts.get(id) || 0) + 1); };

    for (const entry of feedEntries) {
      _inc(entry.fromActorId);
      _inc(entry.toActorId);
      _inc(entry.fromContactId);
      _inc(entry.toContactId);
      // Also count by inbox owner ID (catches NPC-inbox messages)
      _inc(entry.inboxOwnerId);
    }

    const players = [];
    const npcs = [];
    const seen = new Set();

    // ── Pass 1: Player actors ──
    for (const user of game.users ?? []) {
      if (user.isGM || !user.character) continue;
      const actor = user.character;
      const id = actor.id;
      if (seen.has(id)) continue;
      seen.add(id);

      const count = idCounts.get(id) || 0;
      players.push({
        actorId: id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#19f3f7',
        messageCount: count,
        isActive: this._actorFilter === id,
      });
    }

    // ── Pass 2: All master contacts ──
    const masterContacts = this.masterContactService?.getAll() ?? [];
    const roleColors = {
      fixer: '#d4a017', netrunner: '#00e5ff', runner: '#00e5ff',
      corp: '#4a8ab5', exec: '#6ec1e4', solo: '#e04848',
      tech: '#2ecc71', medtech: '#1abc9c', media: '#b87aff',
      nomad: '#d4844a', lawman: '#6b8fa3', rocker: '#e05cb5',
      ripperdoc: '#e06888', gang: '#cc4444', government: '#5a7fa5',
      ai: '#ff44cc',
    };

    for (const contact of masterContacts) {
      const actorId = contact.actorId;
      const contactId = contact.id;

      // Skip if we already added this as a player character
      if (actorId && seen.has(actorId)) continue;
      if (seen.has(contactId)) continue;

      const primaryId = actorId || contactId;
      seen.add(primaryId);
      if (actorId) seen.add(actorId);
      if (contactId) seen.add(contactId);

      // Merge counts from all possible IDs this contact could appear as
      let count = 0;
      if (actorId) count += (idCounts.get(actorId) || 0);
      if (contactId && contactId !== actorId) count += (idCounts.get(contactId) || 0);

      const roleLower = (contact.role || '').toLowerCase();

      npcs.push({
        actorId: primaryId,
        name: contact.name,
        initial: (contact.name || '?').charAt(0).toUpperCase(),
        color: roleColors[roleLower] || '#F65261',
        messageCount: count,
        isActive: this._actorFilter === primaryId,
      });
    }

    // ── Pass 3: NPC actors with emails but NOT in master contacts ──
    for (const actor of game.actors ?? []) {
      if (actor.hasPlayerOwner) continue;
      if (seen.has(actor.id)) continue;
      if (!actor.getFlag(MODULE_ID, 'email')) continue;
      seen.add(actor.id);

      npcs.push({
        actorId: actor.id,
        name: actor.name,
        initial: (actor.name || '?').charAt(0).toUpperCase(),
        color: '#F65261',
        messageCount: idCounts.get(actor.id) || 0,
        isActive: this._actorFilter === actor.id,
      });
    }

    // Sort: those with messages first, then alphabetically
    players.sort((a, b) => b.messageCount - a.messageCount || a.name.localeCompare(b.name));
    npcs.sort((a, b) => b.messageCount - a.messageCount || a.name.localeCompare(b.name));

    const options = [];
    if (players.length) {
      options.push({ isGroupLabel: true, label: 'Players' });
      options.push(...players);
    }
    if (npcs.length) {
      options.push({ isGroupLabel: true, label: 'NPCs & Contacts' });
      options.push(...npcs);
    }

    return options;
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  async onQuickSend(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors.get(actorId);
    if (!actor) return;

    game.nightcity?.openComposer?.({ fromActorId: actorId, fromName: actor.name });
    log.info(`Admin: Quick-send as ${actor.name}`);
  }

  onNpcQuickSend(event, target) {
    const el = target.closest('[data-npc-id]');
    const npcId = el?.dataset.npcId;
    const contactId = el?.dataset.contactId;
    if (!npcId) return;

    // Try as actor first
    const actor = game.actors?.get(npcId);
    if (actor) {
      game.nightcity?.openComposer?.({ fromActorId: npcId, fromName: actor.name });
      log.info(`Admin: Quick-send as actor ${actor.name}`);
      return;
    }

    // Try as contact
    const contact = contactId
      ? game.nightcity?.masterContactService?.getContact(contactId)
      : game.nightcity?.masterContactService?.getContact(npcId);
    if (contact) {
      if (contact.actorId) {
        game.nightcity?.openComposer?.({ fromActorId: contact.actorId });
      } else {
        game.nightcity?.openComposer?.({
          fromContact: {
            id: contact.id,
            name: contact.name,
            email: contact.email,
            portrait: contact.portrait || null,
          },
        });
      }
      log.info(`Admin: Quick-send as contact ${contact.name}`);
    }
  }

  onNpcPagePrev(event, target) {
    if (this._npcPage > 0) this._npcPage--;
    this.app._saveScroll();
    this.render(true);
  }

  onNpcPageNext(event, target) {
    this._npcPage++;
    this.app._saveScroll();
    this.render(true);
  }

  onOpenViewInboxDialog(event, target) {
    const entries = this._gatherInboxDropdownEntries();

    // Count messages per inbox
    const inboxCounts = new Map();
    for (const journal of game.journal ?? []) {
      if (!journal.name?.startsWith('NCM-Inbox-')) continue;
      const isContact = journal.name.startsWith('NCM-Inbox-Contact-');
      const ownerId = isContact
        ? journal.name.replace('NCM-Inbox-Contact-', '')
        : journal.name.replace('NCM-Inbox-', '');
      let total = 0;
      let unread = 0;
      for (const page of journal.pages ?? []) {
        const flags = page.flags?.['cyberpunkred-messenger'];
        if (!flags) continue;
        total++;
        const isSent = (flags.messageId || '').endsWith('-sent');
        if (!flags.status?.read && !isSent && !flags.status?.deleted) unread++;
      }
      inboxCounts.set(ownerId, { total, unread });
    }

    // Build rows
    const rows = entries.map(e => {
      const counts = inboxCounts.get(e.inboxId) || { total: 0, unread: 0 };
      return { ...e, totalMessages: counts.total, unreadMessages: counts.unread };
    });

    const S = {
      panel: 'background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:0; overflow:hidden;',
      search: 'display:flex; align-items:center; gap:6px; padding:7px 12px; border-bottom:1px solid #2a2a45; background:#0a0a0f;',
      scroll: 'max-height:340px; overflow-y:auto;',
      row: 'display:flex; align-items:center; gap:10px; padding:6px 12px; cursor:pointer; transition:background 0.1s; border-bottom:1px solid rgba(42,42,69,0.3);',
      pip: 'width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:Rajdhani,sans-serif; font-size:10px; font-weight:700; flex-shrink:0;',
      info: 'display:flex; flex-direction:column; flex:1; min-width:0;',
      name: 'font-family:Rajdhani,sans-serif; font-size:12px; font-weight:700; color:#e0e0e8; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;',
      meta: 'font-family:Share Tech Mono,monospace; font-size:9px; color:#8888a0;',
      badge: 'font-family:Share Tech Mono,monospace; font-size:10px; flex-shrink:0; padding:2px 6px; border-radius:2px; line-height:1;',
      empty: 'padding:20px; text-align:center; font-family:Rajdhani,sans-serif; font-size:12px; color:#8888a0;',
    };

    const buildRows = (list) => {
      if (!list.length) return `<div style="${S.empty}"><i class="fas fa-inbox" style="margin-right:6px;"></i> No inboxes found</div>`;
      return list.map(e => {
        const unreadBadge = e.unreadMessages > 0
          ? `<span style="${S.badge} background:rgba(246,82,97,0.12); color:#F65261;">${e.unreadMessages} new</span>`
          : '';
        const totalBadge = `<span style="${S.badge} background:rgba(136,136,160,0.08); color:#8888a0;">${e.totalMessages}</span>`;
        return `<div class="ncm-vi-row" data-inbox-id="${e.inboxId}" style="${S.row}">
          <div style="${S.pip} color:${e.color}; border:1px solid ${e.color}33; background:${e.color}0a;">${e.initial}</div>
          <div style="${S.info}">
            <span style="${S.name}">${e.name}</span>
            <span style="${S.meta}"><i class="fas ${e.typeIcon}" style="font-size:7px; margin-right:3px;"></i>${e.type}${e.email ? ` · ${e.email}` : ''}</span>
          </div>
          ${unreadBadge}
          ${totalBadge}
        </div>`;
      }).join('');
    };

    const content = `
      <div style="font-family:Rajdhani,sans-serif; color:#eeeef4; min-width:380px;">
        <div style="${S.panel}">
          <div style="${S.search}">
            <i class="fas fa-magnifying-glass" style="font-size:9px; color:#8888a0;"></i>
            <input type="text" id="ncm-vi-search" placeholder="Search by name, email, or role…" style="flex:1; background:none; border:none; outline:none; font-family:Rajdhani,sans-serif; font-size:12px; font-weight:600; color:#e0e0e8;">
          </div>
          <div id="ncm-vi-list" style="${S.scroll}">
            ${buildRows(rows)}
          </div>
        </div>
        <div style="font-family:Share Tech Mono,monospace; font-size:9px; color:#555570; padding:6px 4px 0; text-align:center;">
          ${rows.length} inboxes · Click to open
        </div>
      </div>`;

    const dialog = new Dialog({
      title: 'View Inbox',
      content,
      buttons: {
        close: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close',
        },
      },
      default: 'close',
      render: (html) => {
        const searchEl = html.find('#ncm-vi-search');
        const listEl = html.find('#ncm-vi-list');

        // Search filtering
        let searchTimeout;
        searchEl.on('input', () => {
          clearTimeout(searchTimeout);
          searchTimeout = setTimeout(() => {
            const q = searchEl.val().toLowerCase();
            const filtered = q
              ? rows.filter(e => e.name.toLowerCase().includes(q) || e.email.toLowerCase().includes(q) || e.type.toLowerCase().includes(q))
              : rows;
            listEl.html(buildRows(filtered));
            bindRowClicks();
          }, 200);
        });

        searchEl.focus();

        // Click to open inbox
        const bindRowClicks = () => {
          html.find('.ncm-vi-row').on('click', (e) => {
            const id = e.currentTarget.dataset.inboxId;
            if (!id) return;
            game.nightcity?.openInbox?.(id);
            dialog.close();
          });
        };
        bindRowClicks();
      },
    }, {
      width: 440,
      classes: ['ncm-time-config-dialog'],
    });

    dialog.render(true);
  }

  onOpenComposer(event, target) {
    game.nightcity?.openComposer?.();
  }

  async onCancelScheduled(event, target) {
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

  async onEditScheduled(event, target) {
    const scheduleId = target.closest('[data-schedule-id]')?.dataset.scheduleId;
    if (!scheduleId) return;

    const entry = this.schedulingService?.getScheduled?.(scheduleId);
    if (!entry) {
      ui.notifications.warn('NCM | Scheduled entry not found.');
      return;
    }

    const data = entry.messageData || {};
    const currentDelivery = entry.deliveryTime ? new Date(entry.deliveryTime) : new Date();
    const dateVal = `${currentDelivery.getUTCFullYear()}-${String(currentDelivery.getUTCMonth() + 1).padStart(2, '0')}-${String(currentDelivery.getUTCDate()).padStart(2, '0')}`;
    const timeVal = `${String(currentDelivery.getUTCHours()).padStart(2, '0')}:${String(currentDelivery.getUTCMinutes()).padStart(2, '0')}`;

    const content = `
      <div style="font-family:Rajdhani,sans-serif; color:#eeeef4;">
        <div style="background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:10px 14px; margin-bottom:10px;">
          <div style="font-size:9px; font-weight:700; color:#8888a0; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:4px;">Message Details</div>
          <div style="display:flex; gap:8px; align-items:center; margin-bottom:4px;">
            <span style="font-size:12px; font-weight:700; color:#F65261;">${data.from || data.fromName || 'Unknown'}</span>
            <i class="fas fa-arrow-right" style="font-size:8px; color:#555570;"></i>
            <span style="font-size:12px; font-weight:700; color:#19f3f7;">${data.to || data.toName || 'Unknown'}</span>
          </div>
          <div style="font-size:11px; color:#c0c0d0;">"${data.subject || '(no subject)'}"</div>
        </div>
        <div style="background:#1a1a2e; border:1px solid #2a2a45; border-radius:2px; padding:10px 14px;">
          <div style="font-size:9px; font-weight:700; color:#8888a0; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:6px;">Reschedule Delivery</div>
          <div style="display:flex; align-items:center; gap:8px;">
            <input type="date" id="ncm-sched-edit-date" value="${dateVal}" style="background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Share Tech Mono,monospace; font-size:12px; padding:5px 8px; border-radius:2px; outline:none; color-scheme:dark; flex:1;">
            <input type="time" id="ncm-sched-edit-time" value="${timeVal}" style="background:#12121a; border:1px solid #2a2a45; color:#eeeef4; font-family:Share Tech Mono,monospace; font-size:12px; padding:5px 8px; border-radius:2px; outline:none; width:100px;">
          </div>
        </div>
      </div>`;

    const dialog = new Dialog({
      title: 'Edit Scheduled Message',
      content,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: 'Reschedule',
          callback: async (html) => {
            const date = html.find('#ncm-sched-edit-date').val();
            const time = html.find('#ncm-sched-edit-time').val();
            if (!date || !time) return;
            const newDelivery = new Date(`${date}T${time}:00`).toISOString();
            await this.schedulingService?.editScheduled(scheduleId, { deliveryTime: newDelivery });
            ui.notifications.info('NCM | Scheduled message rescheduled.');
            this.render(true);
          },
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: 'Close',
        },
      },
      default: 'save',
    }, {
      width: 400,
      height: 'auto',
      classes: ['ncm-time-config-dialog'],
    });

    dialog.render(true);
  }

  onFilter(event, target) {
    const filter = target.dataset.filter || target.closest('[data-filter]')?.dataset.filter || 'all';
    this._filter = filter;
    this._limit = 20;
    this.app._saveScroll();
    this.render(true);
  }

  onLoadMore(event, target) {
    this._limit += 20;
    this.app._saveScroll();
    this.render(true);
  }

  onOpenDateRangePicker(event, target) {
    // Don't open picker if clicking the clear button
    if (event.target.closest('[data-action="clearFeedDates"]')) return;
    DateRangePicker.open({
      from: this._dateFrom,
      to: this._dateTo,
      title: 'Filter Messages by Date',
      onApply: (from, to) => {
        this._dateFrom = from;
        this._dateTo = to;
        this._limit = 20;
        this.render(true);
      },
      onClear: () => {
        this._dateFrom = '';
        this._dateTo = '';
        this._limit = 20;
        this.render(true);
      },
    });
  }

  onClearFeedDates(event, target) {
    event.stopPropagation();
    this._dateFrom = '';
    this._dateTo = '';
    this._limit = 20;
    this.app._saveScroll();
    this.render(true);
  }

  onToggleExpand(event, target) {
    if (event.target.closest('[data-action]:not([data-action="toggleMsgExpand"])')) return;
    const msgId = target.closest('[data-message-id]')?.dataset.messageId;
    if (!msgId) return;
    this._expandedId = (this._expandedId === msgId) ? null : msgId;
    this.app._saveScroll();
    this.render(true);
  }

  onToggleActorFilter(event, target) {
    if (event.target.closest('[data-action="setMsgActorFilter"]')) return;
    this._actorDropdownOpen = !this._actorDropdownOpen;
    this.app._saveScroll();
    this.render(true);
  }

  onSetActorFilter(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId ?? '';
    this._actorFilter = actorId;
    this._actorDropdownOpen = false;
    this._limit = 20;
    this.app._saveScroll();
    this.render(true);
  }

  onOpenInInbox(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner
                       || target.dataset.inboxOwner;
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!inboxOwnerId) return;
    game.nightcity?.openInbox?.(inboxOwnerId, messageId || undefined);
  }

  onReplyAs(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner
                       || target.dataset.inboxOwner;
    if (!inboxOwnerId) return;
    // Open composer as the inbox owner (reply as the recipient)
    const actor = game.actors?.get(inboxOwnerId);
    if (actor) {
      game.nightcity?.openComposer?.({ fromActorId: actor.id, fromName: actor.name });
    } else {
      game.nightcity?.openComposer?.();
    }
  }

  async onShareToChat(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!messageId) return;

    // Find the journal page for this message
    let foundPage = null;
    for (const journal of game.journal ?? []) {
      if (!journal.name?.startsWith('NCM-Inbox-')) continue;
      for (const page of journal.pages ?? []) {
        const flags = page.flags?.['cyberpunkred-messenger'];
        if (flags?.messageId === messageId) {
          foundPage = { page, flags };
          break;
        }
      }
      if (foundPage) break;
    }

    if (!foundPage) {
      ui.notifications.warn('NCM | Message not found.');
      return;
    }

    const { flags } = foundPage;
    const bodyText = flags.body || '';
    const content = await renderTemplate(
      `modules/${MODULE_ID}/templates/chat/intercepted-message.hbs`,
      {
        from: flags.senderName || flags.from || 'Unknown',
        to: flags.recipientName || flags.to || 'Unknown',
        subject: flags.subject || '(no subject)',
        bodyPreview: bodyText.length > 200 ? bodyText.slice(0, 200) + '...' : bodyText,
        networkDisplay: flags.network || 'UNKNOWN',
      }
    );

    await ChatMessage.create({
      content,
      speaker: { alias: 'NCM // GM' },
    });

    ui.notifications.info('NCM | Message shared to chat.');
  }

  async onForceDeliver(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!messageId) return;

    const result = await this.messageService?.forceDeliver?.(messageId);
    if (result?.success) {
      ui.notifications.info('NCM | Message force-delivered.');
    } else {
      ui.notifications.warn('NCM | Force delivery not available or failed.');
    }
    this.render(true);
  }

  async onCancelQueued(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const messageId = target.closest('[data-message-id]')?.dataset.messageId
                    || target.dataset.messageId;
    if (!messageId) return;

    const result = await this.messageService?.cancelQueued?.(messageId);
    if (result?.success) {
      ui.notifications.info('NCM | Queued message cancelled.');
    } else {
      ui.notifications.warn('NCM | Cancel failed.');
    }
    this.render(true);
  }

  async onFlushQueue(event, target) {
    event.preventDefault();
    const queue = this.messageService?.getQueue?.() ?? [];
    if (!queue.length) {
      ui.notifications.info('NCM | Queue is empty.');
      return;
    }

    const confirmed = await Dialog.confirm({
      title: 'Force Deliver All',
      content: `<p>Force-deliver <strong>${queue.length}</strong> queued message${queue.length > 1 ? 's' : ''}? This bypasses network requirements.</p>`,
    });
    if (!confirmed) return;

    let delivered = 0;
    for (const entry of queue) {
      const result = await this.messageService?.forceDeliver?.(entry.messageId || entry.id);
      if (result?.success) delivered++;
    }
    ui.notifications.info(`NCM | Force-delivered ${delivered} message${delivered !== 1 ? 's' : ''}.`);
    this.render(true);
  }

  async onMarkAllRead(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    try {
      const messages = await this.messageService?.getMessages(actorId) ?? [];
      const unread = messages.filter(m => !m.status?.read && !m.status?.sent && !m.status?.deleted);
      if (!unread.length) {
        ui.notifications.info('NCM | No unread messages.');
        return;
      }

      for (const msg of unread) {
        await this.messageRepository?.markRead(actorId, msg.messageId || msg.id);
      }
      ui.notifications.info(`NCM | Marked ${unread.length} message${unread.length !== 1 ? 's' : ''} as read.`);
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Mark all read failed:`, error);
      ui.notifications.error('NCM | Failed to mark messages as read.');
    }
  }

  async onPurgeOld(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId) return;

    const actor = game.actors?.get(actorId);
    if (!actor) return;

    const confirmed = await Dialog.confirm({
      title: 'Purge Old Messages',
      content: `<p>Delete all read messages older than 7 days from <strong>${actor.name}</strong>'s inbox?</p>`,
    });
    if (!confirmed) return;

    try {
      const messages = await this.messageService?.getMessages(actorId) ?? [];
      const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000);
      const toPurge = messages.filter(m => {
        const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
        return m.status?.read && ts < cutoff && !m.status?.saved;
      });

      if (!toPurge.length) {
        ui.notifications.info('NCM | No old read messages to purge.');
        return;
      }

      for (const msg of toPurge) {
        await this.messageRepository?.hardDelete(msg.messageId || msg.id);
      }
      ui.notifications.info(`NCM | Purged ${toPurge.length} old message${toPurge.length !== 1 ? 's' : ''} from ${actor.name}'s inbox.`);
      this.render(true);
    } catch (error) {
      console.error(`${MODULE_ID} | Purge failed:`, error);
      ui.notifications.error('NCM | Purge failed.');
    }
  }

  async onBroadcast(event, target) {
    // Open a dialog to compose a broadcast message to all player inboxes
    const playerActors = [];
    for (const user of game.users) {
      if (user.isGM || !user.character) continue;
      playerActors.push({ id: user.character.id, name: user.character.name });
    }

    if (!playerActors.length) {
      ui.notifications.warn('NCM | No player-owned characters found.');
      return;
    }

    const dialog = new Dialog({
      title: 'Mass Broadcast — All Player Inboxes',
      content: `
        <form style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <label style="font-size:11px; font-weight:600;">From (NPC / Sender name)</label>
          <input type="text" name="from" placeholder="e.g. NCPD, System, Rogue…" style="padding:6px 8px; font-size:12px;">
          <label style="font-size:11px; font-weight:600;">Subject</label>
          <input type="text" name="subject" placeholder="Message subject…" style="padding:6px 8px; font-size:12px;">
          <label style="font-size:11px; font-weight:600;">Message Body</label>
          <textarea name="body" rows="4" placeholder="Message content…" style="padding:6px 8px; font-size:12px; resize:vertical;"></textarea>
          <p style="font-size:10px; color:#888; margin:0;">Will be delivered to ${playerActors.length} player inbox${playerActors.length !== 1 ? 'es' : ''}: ${playerActors.map(a => a.name).join(', ')}</p>
        </form>`,
      buttons: {
        send: {
          icon: '<i class="fas fa-tower-broadcast"></i>',
          label: 'Send Broadcast',
          callback: async (html) => {
            const from = html.find('[name="from"]').val()?.trim() || 'System';
            const subject = html.find('[name="subject"]').val()?.trim() || 'Broadcast';
            const body = html.find('[name="body"]').val()?.trim();
            if (!body) return;

            let sent = 0;
            for (const pa of playerActors) {
              try {
                await this.messageService?.sendMessage({
                  from,
                  to: pa.name,
                  toActorId: pa.id,
                  subject,
                  body,
                  isBroadcast: true,
                });
                sent++;
              } catch { /* continue */ }
            }
            ui.notifications.info(`NCM | Broadcast sent to ${sent} player inbox${sent !== 1 ? 'es' : ''}.`);
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'send',
    });
    dialog.render(true);
  }

  async onHardDelete(event, target) {
    event.stopPropagation(); // Don't trigger row expand
    const messageId = target.closest('[data-message-id]')?.dataset.messageId;
    const inboxOwnerId = target.closest('[data-inbox-owner]')?.dataset.inboxOwner;
    if (!messageId) return;

    // Save scroll before async operation
    this.app._saveScroll();

    const confirmed = await Dialog.confirm({
      title: 'Hard Delete Message',
      content: '<p>Permanently delete this message? This cannot be undone.</p>',
    });
    if (!confirmed) return;

    try {
      if (inboxOwnerId) {
        await this.messageRepository?.hardDeleteMessage(inboxOwnerId, messageId);
      } else {
        // Fallback: scan all inboxes for this message
        for (const journal of game.journal ?? []) {
          if (!journal.name?.startsWith('NCM-Inbox-')) continue;
          const page = journal.pages?.find(p => {
            const flags = p.flags?.['cyberpunkred-messenger'];
            return flags?.messageId === messageId;
          });
          if (page) {
            await page.delete();
            break;
          }
        }
      }
      ui.notifications.info('NCM | Message permanently deleted.');
      this.app._saveScroll();
      this.render(true);
    } catch (err) {
      console.error(`${MODULE_ID} | Hard delete failed:`, err);
      ui.notifications.error('NCM | Failed to delete message.');
    }
  }
}
