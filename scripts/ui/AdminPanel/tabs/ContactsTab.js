/**
 * ContactsTab — Master contacts directory, push/share, batch ops.
 * @file scripts/ui/AdminPanel/tabs/ContactsTab.js
 * @module cyberpunkred-messenger
 *
 * Tab-local state tracks search/sort/filter, expanded accordion row,
 * batch selection, overflow menu, and group collapse.
 *
 * Cross-parent dependencies:
 *   - this.app._relativeTime(ts)   — "X min ago" formatter (shared with messages)
 *   - this.app._getRelativeTime(ts)— parent's session-relative helper
 *   - this.app._saveScroll()       — persists admin-content scroll position
 *
 * Bug fix during extraction: _showShareDialog was previously declared
 * `static` on AdminPanelApp but invoked via `this._showShareDialog(...)`
 * from static action handlers. Static methods are not on the prototype,
 * so those calls were silently broken. Here it is an instance method.
 */

import { MODULE_ID } from '../../../utils/constants.js';
import { log } from '../../../utils/helpers.js';
import { BaseTab } from '../BaseTab.js';

export class ContactsTab extends BaseTab {

  // ═══════════════════════════════════════════════════════════
  //  Instance State
  // ═══════════════════════════════════════════════════════════

  _search = '';
  _sort = 'name';
  _filter = 'all';
  _expandedId = null;
  _selectedIds = new Set();
  _collapsedGroups = new Set();
  _overflowOpen = false;
  _searchHandler = null;

  get key() { return 'contacts'; }

  // ═══════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════

  prepareContext() {
    const contactSummary = this._gatherSummary();
    return {
      contactSummary,
      pushLog: this._gatherPushLog(),
    };
  }

  onRender(context, options) {
    // Search input — new v6 class
    const searchInput = this.element?.querySelector('.ncm-ct-search__input');
    if (searchInput) {
      if (this._search) searchInput.focus();

      const handler = this._searchHandler || (this._searchHandler =
        foundry.utils.debounce((e) => {
          this._search = e.target.value;
          this.render(true);
        }, 250)
      );
      searchInput.removeEventListener('input', handler);
      searchInput.addEventListener('input', handler);
    }

    // Sort select — new v6 class
    const sortSelect = this.element?.querySelector('.ncm-ct-search__sort');
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        this._sort = e.target.value;
        this.render(true);
      });
    }

    // Close overflow menu when clicking outside
    const overflowBtn = this.element?.querySelector('.ncm-ct-overflow__btn');
    if (overflowBtn && this._overflowOpen) {
      const closeOverflow = (e) => {
        if (!e.target.closest('.ncm-ct-overflow')) {
          this._overflowOpen = false;
          this.render(true);
          document.removeEventListener('click', closeOverflow);
        }
      };
      setTimeout(() => document.addEventListener('click', closeOverflow), 0);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Private Helpers — data gathering
  // ═══════════════════════════════════════════════════════════

  _gatherSummary() {
    const contacts = this.masterContactService?.getAll() ?? [];

    // ── Role config — every role gets a unique type + color ──
    const roleChipMap = {
      fixer:     { label: 'Fixer',     type: 'role-fixer',     icon: 'crosshairs' },
      netrunner: { label: 'Runner',    type: 'role-netrunner',  icon: 'terminal' },
      runner:    { label: 'Runner',    type: 'role-netrunner',  icon: 'terminal' },
      corp:      { label: 'Corp',      type: 'role-corp',       icon: 'briefcase' },
      exec:      { label: 'Exec',      type: 'role-exec',       icon: 'building-columns' },
      solo:      { label: 'Solo',      type: 'role-solo',       icon: 'crosshairs' },
      tech:      { label: 'Tech',      type: 'role-tech',       icon: 'gear' },
      medtech:   { label: 'Medtech',   type: 'role-medtech',    icon: 'staff-snake' },
      ripperdoc: { label: 'Ripperdoc', type: 'role-ripperdoc',  icon: 'syringe' },
      media:     { label: 'Media',     type: 'role-media',      icon: 'podcast' },
      nomad:     { label: 'Nomad',     type: 'role-nomad',      icon: 'truck-monster' },
      lawman:    { label: 'Lawman',    type: 'role-lawman',     icon: 'shield-halved' },
      rockerboy: { label: 'Rocker',    type: 'role-rocker',     icon: 'guitar' },
      rocker:    { label: 'Rocker',    type: 'role-rocker',     icon: 'guitar' },
      gang:       { label: 'Gang',       type: 'role-gang',       icon: 'users-line' },
      civilian:   { label: 'Civilian',   type: 'role-civilian',   icon: 'user' },
      government: { label: 'Gov',        type: 'role-gov',        icon: 'landmark' },
      ai:         { label: 'A.I.',       type: 'role-ai',         icon: 'microchip' },
    };

    // Merge custom roles from GM settings
    const customRoles = this.masterContactService?.getCustomRoles?.() || [];
    for (const cr of customRoles) {
      if (!roleChipMap[cr.id]) {
        roleChipMap[cr.id] = { label: cr.label, type: `role-${cr.id}`, icon: cr.icon || 'tag' };
      }
    }

    const trustLabels = { 5: 'Implicitly Trusted', 4: 'Trusted', 3: 'Neutral', 2: 'Cautious', 1: 'Suspicious', 0: 'Unknown' };

    // ── Gather player-owned actors for "Known by" + Player Characters group ──
    const playerActors = [];
    for (const user of game.users) {
      if (user.isGM || !user.character) continue;
      playerActors.push({
        actorId: user.character.id,
        actorName: user.character.name,
        playerName: user.name,
        initial: (user.character.name || '?').charAt(0).toUpperCase(),
      });
    }

    // ── Build "Known by" for a contact: check which player actors have it ──
    const contactRepo = game.nightcity?.contactRepository;
    const _buildKnownBy = (masterContactId, contactEmail) => {
      const pips = [];
      const expanded = [];
      for (const pa of playerActors) {
        let has = false;
        try {
          const playerContacts = contactRepo?.getAll(pa.actorId) ?? [];
          has = playerContacts.some(pc =>
            pc.masterContactId === masterContactId ||
            (contactEmail && pc.email?.toLowerCase() === contactEmail.toLowerCase())
          );
        } catch { /* actor may not have contacts */ }
        pips.push({
          initial: pa.initial,
          has,
          tooltip: has
            ? `${pa.actorName} (${pa.playerName}) has this contact`
            : `${pa.actorName} (${pa.playerName}) does not have this contact`,
        });
        expanded.push({
          characterName: pa.actorName,
          playerName: pa.playerName,
          has,
        });
      }
      return { pips, expanded };
    };

    // ── Relationship type config (used in enriched contact per-player display) ──
    const RELATIONSHIP_TYPES = {
      ally:       { label: 'ALLY',       icon: 'fa-handshake',            color: '#00ff41' },
      hostile:    { label: 'HOSTILE',    icon: 'fa-skull-crossbones',     color: '#ff0033' },
      rival:      { label: 'RIVAL',     icon: 'fa-bolt',                 color: '#b87aff' },
      neutral:    { label: 'NEUTRAL',   icon: 'fa-minus',                color: '#555570' },
      contact:    { label: 'CONTACT',   icon: 'fa-address-card',         color: '#7aa2c4' },
      'owes-you': { label: 'OWES YOU',  icon: 'fa-coins',                color: '#f7c948' },
      'you-owe':  { label: 'YOU OWE',   icon: 'fa-hand-holding-dollar',  color: '#d4844a' },
      patron:     { label: 'PATRON',    icon: 'fa-crown',                color: '#6ec1e4' },
      informant:  { label: 'INFORMANT', icon: 'fa-user-secret',          color: '#1abc9c' },
    };

    // ── Enrich all master contacts ──
    const enriched = contacts.map(c => {
      const trust = c.trust ?? 0;
      let trustLevel = 'none';
      if (trust >= 4) trustLevel = 'high';
      else if (trust >= 2) trustLevel = 'med';
      else if (trust >= 1) trustLevel = 'low';

      // Detect role — from c.role field first, then scan tags as fallback
      let roleLower = (c.role || '').toLowerCase();
      if (!roleLower) {
        // Scan tags for known role names
        const knownRoles = Object.keys(roleChipMap);
        for (const tag of (c.tags || [])) {
          const tagLower = tag.toLowerCase();
          if (knownRoles.includes(tagLower)) {
            roleLower = tagLower;
            break;
          }
        }
      }
      const roleInfo = roleChipMap[roleLower];

      // Avatar color — per-role colors matching chip colors, with burned/encrypted overrides
      const roleAvatarColors = {
        fixer: '#d4a017',
        netrunner: '#00e5ff', runner: '#00e5ff',
        corp: '#4a8ab5', exec: '#6ec1e4',
        solo: '#e04848',
        tech: '#2ecc71', medtech: '#1abc9c', ripperdoc: '#e06888',
        media: '#b87aff',
        nomad: '#d4844a',
        lawman: '#6b8fa3',
        rockerboy: '#e05cb5', rocker: '#e05cb5',
        gang: '#cc4444', civilian: '#8888a0',
        government: '#5a7fa5', ai: '#ff44cc',
      };
      // Merge custom role colors
      for (const cr of customRoles) {
        if (cr.color && !roleAvatarColors[cr.id]) roleAvatarColors[cr.id] = cr.color;
      }
      let avatarColor = roleAvatarColors[roleLower] || '#9a9ab5';
      if (c.burned) avatarColor = '#ff3355';
      else if (c.encrypted) avatarColor = '#f7c948';
      const networkSlug = (c.network || 'citinet').toLowerCase().replace(/[^a-z]/g, '');

      // Actor resolution
      let actorName = null;
      let playerOwnerName = null;
      let isPlayerOwned = false;
      if (c.actorId) {
        const actor = game.actors?.get(c.actorId);
        actorName = actor?.name || null;
        if (actor?.hasPlayerOwner) {
          isPlayerOwned = true;
          const ownerEntry = Object.entries(actor.ownership || {}).find(
            ([uid, level]) => uid !== 'default' && level === CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
          );
          if (ownerEntry) {
            playerOwnerName = game.users.get(ownerEntry[0])?.name || null;
          }
        }
      }

      // Build color-coded chips with inline styles (Foundry-proof)
      // Every role gets a visually distinct color
      const chipColorMap = {
        'role-fixer':     { c: '#d4a017', b: 'rgba(212,160,23,0.35)', bg: 'rgba(212,160,23,0.10)' },
        'role-netrunner': { c: '#00e5ff', b: 'rgba(0,229,255,0.35)',  bg: 'rgba(0,229,255,0.10)' },
        'role-corp':      { c: '#4a8ab5', b: 'rgba(74,138,181,0.35)', bg: 'rgba(74,138,181,0.10)' },
        'role-exec':      { c: '#6ec1e4', b: 'rgba(110,193,228,0.35)', bg: 'rgba(110,193,228,0.10)' },
        'role-solo':      { c: '#e04848', b: 'rgba(224,72,72,0.35)',  bg: 'rgba(224,72,72,0.10)' },
        'role-tech':      { c: '#2ecc71', b: 'rgba(46,204,113,0.35)', bg: 'rgba(46,204,113,0.10)' },
        'role-medtech':   { c: '#1abc9c', b: 'rgba(26,188,156,0.35)', bg: 'rgba(26,188,156,0.10)' },
        'role-ripperdoc': { c: '#e06888', b: 'rgba(224,104,136,0.35)', bg: 'rgba(224,104,136,0.10)' },
        'role-media':     { c: '#b87aff', b: 'rgba(184,122,255,0.35)', bg: 'rgba(184,122,255,0.10)' },
        'role-nomad':     { c: '#d4844a', b: 'rgba(212,132,74,0.35)',  bg: 'rgba(212,132,74,0.10)' },
        'role-lawman':    { c: '#6b8fa3', b: 'rgba(107,143,163,0.35)', bg: 'rgba(107,143,163,0.10)' },
        'role-rocker':    { c: '#e05cb5', b: 'rgba(224,92,181,0.35)', bg: 'rgba(224,92,181,0.10)' },
        'role-gang':      { c: '#cc4444', b: 'rgba(204,68,68,0.35)',  bg: 'rgba(204,68,68,0.10)' },
        'role-civilian':  { c: '#8888a0', b: 'rgba(136,136,160,0.35)', bg: 'rgba(136,136,160,0.10)' },
        'role-gov':       { c: '#5a7fa5', b: 'rgba(90,127,165,0.35)', bg: 'rgba(90,127,165,0.10)' },
        'role-ai':        { c: '#ff44cc', b: 'rgba(255,68,204,0.35)', bg: 'rgba(255,68,204,0.10)' },
        'org':            { c: '#7aa2c4', b: 'rgba(122,162,196,0.35)', bg: 'rgba(122,162,196,0.10)' },
        'loc':            { c: '#c47a2a', b: 'rgba(196,122,42,0.35)',  bg: 'rgba(196,122,42,0.10)' },
        'tag':            { c: '#19f3f7', b: 'rgba(25,243,247,0.30)',  bg: 'rgba(25,243,247,0.08)' },
        'alias':          { c: '#c8c8dc', b: 'rgba(200,200,220,0.30)', bg: 'rgba(200,200,220,0.06)' },
      };
      // Merge custom role chip colors dynamically
      for (const cr of customRoles) {
        const key = `role-${cr.id}`;
        if (!chipColorMap[key] && cr.color) {
          const r = parseInt(cr.color.slice(1, 3), 16);
          const g = parseInt(cr.color.slice(3, 5), 16);
          const b = parseInt(cr.color.slice(5, 7), 16);
          chipColorMap[key] = {
            c: cr.color,
            b: `rgba(${r},${g},${b},0.35)`,
            bg: `rgba(${r},${g},${b},0.10)`,
          };
        }
      }
      const _chipStyle = (type) => {
        const cm = chipColorMap[type];
        return cm ? `color:${cm.c};border-color:${cm.b};background:${cm.bg};` : '';
      };

      const chips = [];
      if (roleInfo) chips.push({ type: roleInfo.type, label: roleInfo.label, icon: roleInfo.icon, style: _chipStyle(roleInfo.type) });
      if (c.organization) chips.push({ type: 'org', label: c.organization, icon: 'building', style: _chipStyle('org') });
      if (c.location) chips.push({ type: 'loc', label: c.location, icon: 'location-dot', style: _chipStyle('loc') });
      if (c.alias) chips.push({ type: 'alias', label: c.alias, icon: null, style: _chipStyle('alias') });
      if (c.tags) {
        c.tags.forEach(t => {
          // Skip tags that were already used as the role chip
          if (roleLower && t.toLowerCase() === roleLower) return;
          chips.push({ type: 'tag', label: t, icon: null, style: _chipStyle('tag') });
        });
      }

      // Known-by
      const knownBy = _buildKnownBy(c.id, c.email);

      // Activity label
      let activeLabel = 'Never contacted';
      let activeRecent = false;
      if (c.updatedAt) {
        const diff = Date.now() - new Date(c.updatedAt).getTime();
        const hours = diff / (1000 * 60 * 60);
        if (hours < 24) { activeLabel = 'Active today'; activeRecent = true; }
        else if (hours < 168) activeLabel = 'This week';
        else activeLabel = 'Inactive';
      }

      // Notes preview (first ~60 chars)
      const notesPreview = c.notes ? (c.notes.length > 60 ? c.notes.slice(0, 60) + '...' : c.notes) : '';

      // Per-player relationship summary for expanded detail
      const rels = c.relationships || {};
      const partyTrust = trust;
      const playerRelationships = playerActors.map(pa => {
        const rel = rels[pa.actorId] || {};
        const relType = rel.type || '';
        const relData = RELATIONSHIP_TYPES[relType];
        const playerTrust = rel.trust != null ? rel.trust : partyTrust;
        const isOverride = rel.trust != null && rel.trust !== partyTrust;
        const _badgeStyle = (color) => {
          if (!color) return '';
          const rr = parseInt(color.slice(1, 3), 16);
          const gg = parseInt(color.slice(3, 5), 16);
          const bb = parseInt(color.slice(5, 7), 16);
          return `color:${color};border-color:rgba(${rr},${gg},${bb},0.35);background:rgba(${rr},${gg},${bb},0.08);`;
        };
        return {
          actorId: pa.actorId,
          characterName: pa.actorName,
          playerName: pa.playerName,
          initial: pa.initial,
          relType,
          relBadgeLabel: relData?.label || '',
          relIcon: relData?.icon || '',
          relBadgeStyle: relData ? _badgeStyle(relData.color) : '',
          displayTrust: playerTrust,
          partyTrust,
          isOverride,
          trustSegments: [1, 2, 3, 4, 5].map(v => ({ value: v, active: v <= playerTrust })),
          hasNote: !!rel.note,
          note: rel.note || '',
        };
      });
      const hasPlayerRelationships = playerRelationships.some(pr => pr.relType || pr.hasNote || pr.isOverride);

      return {
        id: c.id,
        name: c.name,
        email: c.email || '—',
        alias: c.alias || '',
        phone: c.phone || '',
        notes: c.notes || '',
        notesPreview,
        role: c.role,
        roleLower,
        roleBadge: roleInfo?.label ?? null,
        trust,
        trustLevel,
        trustLabel: trustLabels[trust] ?? 'Unknown',
        trustSegments: [
          { value: 1, active: trust >= 1 },
          { value: 2, active: trust >= 2 },
          { value: 3, active: trust >= 3 },
          { value: 4, active: trust >= 4 },
          { value: 5, active: trust >= 5 },
        ],
        burned: c.burned ?? false,
        encrypted: c.encrypted ?? false,
        encryptionDV: c.encryptionDV,
        encryptionSkill: c.encryptionSkill || 'Interface',
        actorId: c.actorId || null,
        actorName,
        playerOwnerName,
        isPlayerOwned,
        portrait: c.portrait || null,
        hasPortrait: !!c.portrait,
        initial: (c.name || '?').charAt(0).toUpperCase(),
        avatarColor,
        avatarBorderColor: `${avatarColor}66`,
        networkSlug,
        networkName: (c.network || 'Citinet').charAt(0).toUpperCase() + (c.network || 'citinet').slice(1),
        contactType: isPlayerOwned ? 'Player' : (c.type || 'NPC').charAt(0).toUpperCase() + (c.type || 'npc').slice(1),
        organization: c.organization || '',
        location: c.location || '',
        tags: c.tags || [],
        chips,
        knownByPips: knownBy.pips,
        knownByExpanded: knownBy.expanded,
        activeLabel,
        activeRecent,
        updatedAt: c.updatedAt || c.createdAt || '',
        noInbox: false,
        isExpanded: this._expandedId === c.id,
        isSelected: this._selectedIds.has(c.id),
        // Per-player relationships (for expanded detail)
        playerRelationships,
        hasPlayerRelationships,
        // Recent messages (populated below for expanded contact)
        recentMessages: [],
      };
    });

    // ── Inject player characters that aren't already master contacts ──
    const masterActorIds = new Set(enriched.map(c => c.actorId).filter(Boolean));
    for (const pa of playerActors) {
      if (masterActorIds.has(pa.actorId)) continue;
      const actor = game.actors?.get(pa.actorId);
      if (!actor) continue;
      const email = actor.getFlag?.('cyberpunkred-messenger', 'email') || '';
      enriched.push({
        id: `pc-${pa.actorId}`,
        name: pa.actorName,
        email: email || '—',
        alias: '', phone: '', notes: '', notesPreview: '',
        role: '', roleLower: '', roleBadge: null,
        trust: 5, trustLevel: 'high', trustLabel: 'Trusted',
        trustSegments: [
          { value: 1, active: true }, { value: 2, active: true },
          { value: 3, active: true }, { value: 4, active: true },
          { value: 5, active: true },
        ],
        burned: false, encrypted: false, encryptionDV: null, encryptionSkill: '',
        actorId: pa.actorId, actorName: pa.actorName,
        playerOwnerName: pa.playerName, isPlayerOwned: true,
        portrait: actor.img || null, hasPortrait: !!actor.img && actor.img !== 'icons/svg/mystery-man.svg',
        initial: pa.initial,
        avatarColor: '#19f3f7', avatarBorderColor: 'rgba(25,243,247,0.4)',
        networkSlug: 'citinet', networkName: 'Citinet',
        contactType: 'Player',
        organization: '', location: '', tags: [], chips: [],
        knownByPips: [], knownByExpanded: [],
        activeLabel: email ? 'Active today' : 'Never contacted',
        activeRecent: !!email,
        updatedAt: '', noInbox: !email,
        isExpanded: this._expandedId === `pc-${pa.actorId}`,
        isSelected: this._selectedIds.has(`pc-${pa.actorId}`),
        playerRelationships: [], hasPlayerRelationships: false,
        recentMessages: [],
      });
    }

    // ── Populate recent messages for expanded contact ──
    const expandedContact = enriched.find(c => c.isExpanded);
    if (expandedContact && !expandedContact.noInbox) {
      try {
        const contactId = expandedContact.id;
        const actorId = expandedContact.actorId;
        const allMessages = [];

        // Messages in the contact's OWN inbox
        // Contains BOTH received messages AND sent copies (messageId ending in "-sent")
        // The viewer's auto-filter-switch handles navigating to the correct tab
        const ownJournalName = actorId
          ? `NCM-Inbox-${actorId}`
          : `NCM-Inbox-Contact-${contactId}`;
        const ownInbox = game.journal?.find(j => j.name === ownJournalName);
        if (ownInbox?.pages?.size) {
          for (const page of ownInbox.pages) {
            const flags = page.flags?.['cyberpunkred-messenger'] || {};
            const msgId = flags.messageId || '';
            const isSentCopy = msgId.endsWith('-sent');

            allMessages.push({
              page, flags,
              sent: isSentCopy,
              // Always open the contact's own inbox — viewer auto-switches filter
              openInboxId: actorId || contactId,
              openMessageId: msgId,
            });
          }
        }

        // Sort all messages by timestamp descending, take top 3
        allMessages.sort((a, b) =>
          (b.flags.timestamp || '').localeCompare(a.flags.timestamp || '')
        );

        expandedContact.recentMessages = allMessages.slice(0, 3).map(m => {
          const fromName = m.flags.senderName || m.flags.from || '?';
          const toName = m.flags.recipientName || m.flags.to || '?';
          return {
            from: fromName,
            to: toName,
            sent: m.sent,
            preview: (m.flags.subject || m.page.name || '(no subject)').slice(0, 50),
            time: m.flags.timestamp ? this.app._relativeTime(m.flags.timestamp) : '',
            messageId: m.openMessageId,
            inboxOwnerId: m.openInboxId,
          };
        });
      } catch { /* inbox may not exist */ }
    }

    // ── Totals ──
    const total = enriched.length;
    const burned = enriched.filter(c => c.burned).length;
    const encrypted = enriched.filter(c => c.encrypted).length;
    const linked = enriched.filter(c => c.actorId).length;
    const unlinked = total - linked;
    const playerCount = enriched.filter(c => c.isPlayerOwned).length;

    // ── Role counts for filter pills ──
    const roleCountMap = {};
    enriched.forEach(c => {
      if (c.roleBadge) roleCountMap[c.roleBadge] = (roleCountMap[c.roleBadge] || 0) + 1;
    });
    const roleCounts = Object.entries(roleCountMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }));

    // ── Apply search ──
    let filtered = enriched;
    const q = this._search?.toLowerCase().trim();
    if (q) {
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        (c.organization && c.organization.toLowerCase().includes(q)) ||
        (c.location && c.location.toLowerCase().includes(q)) ||
        (c.alias && c.alias.toLowerCase().includes(q)) ||
        (c.notes && c.notes.toLowerCase().includes(q)) ||
        (c.actorName && c.actorName.toLowerCase().includes(q)) ||
        (c.playerOwnerName && c.playerOwnerName.toLowerCase().includes(q)) ||
        c.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // ── Apply filter ──
    const f = this._filter;
    if (f && f !== 'all') {
      switch (f) {
        case 'linked':   filtered = filtered.filter(c => c.actorId); break;
        case 'unlinked': filtered = filtered.filter(c => !c.actorId); break;
        case 'burned':   filtered = filtered.filter(c => c.burned); break;
        case 'ice':      filtered = filtered.filter(c => c.encrypted); break;
        case 'player':   filtered = filtered.filter(c => c.isPlayerOwned); break;
        default:
          filtered = filtered.filter(c =>
            c.roleLower === f.toLowerCase() ||
            (c.roleBadge && c.roleBadge.toLowerCase() === f.toLowerCase())
          );
          break;
      }
    }

    // ── Apply sort ──
    switch (this._sort) {
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'trust':
        filtered.sort((a, b) => b.trust - a.trust || a.name.localeCompare(b.name)); break;
      case 'role':
        filtered.sort((a, b) => (a.roleLower || 'zzz').localeCompare(b.roleLower || 'zzz') || a.name.localeCompare(b.name)); break;
      case 'recent':
        filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); break;
      case 'org':
        filtered.sort((a, b) => (a.organization || 'zzz').localeCompare(b.organization || 'zzz') || a.name.localeCompare(b.name)); break;
    }

    // ── Build groups ──
    const groupOrder = ['Player Characters', 'Fixers', 'Corp Contacts', 'Runners', 'Street Contacts'];
    const groupMap = {};
    for (const c of filtered) {
      let groupName = 'Street Contacts';
      if (c.isPlayerOwned) groupName = 'Player Characters';
      else if (c.roleBadge === 'Fixer') groupName = 'Fixers';
      else if (c.roleBadge === 'Corp' || c.roleBadge === 'Exec') groupName = 'Corp Contacts';
      else if (c.roleBadge === 'Runner') groupName = 'Runners';

      if (!groupMap[groupName]) groupMap[groupName] = [];
      groupMap[groupName].push(c);
    }
    const groups = [];
    for (const name of groupOrder) {
      if (groupMap[name]?.length) {
        const key = name.toLowerCase().replace(/\s+/g, '-');
        groups.push({
          key,
          name,
          contacts: groupMap[name],
          collapsed: this._collapsedGroups.has(key),
        });
      }
    }
    // Remaining groups not in groupOrder
    for (const [name, contacts] of Object.entries(groupMap)) {
      if (!groupOrder.includes(name) && contacts.length) {
        const key = name.toLowerCase().replace(/\s+/g, '-');
        groups.push({ key, name, contacts, collapsed: this._collapsedGroups.has(key) });
      }
    }

    // ── Send As chips (up to 5 most recently updated NPC contacts) ──
    const sendAsChips = enriched
      .filter(c => !c.isPlayerOwned && !c.burned && !c.noInbox)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 5)
      .map(c => ({
        id: c.id,
        name: c.name,
        chipName: c.name.length > 12 ? c.name.split(' ')[0] : c.name,
        initial: c.initial,
        avatarColor: c.avatarColor,
        avatarBorderColor: c.avatarBorderColor,
        portrait: c.portrait,
        hasPortrait: c.hasPortrait,
      }));

    return {
      total,
      burned,
      encrypted,
      linked,
      unlinked,
      playerCount,
      filteredCount: filtered.length,
      groups,
      roleCounts,
      sendAsChips,
      selectedCount: this._selectedIds.size,
      overflowOpen: this._overflowOpen,
      contactSearch: this._search,
      contactSort: this._sort,
      contactFilter: this._filter,
    };
  }

  _gatherPushLog() {
    try {
      const rawLog = game.settings?.get(MODULE_ID, 'pushLog') ?? [];
      return rawLog.slice(0, 5).map(entry => ({
        text: entry.text || 'Contact pushed',
        time: this.app._getRelativeTime(entry.timestamp),
      }));
    } catch {
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  Shared Dialog — share contacts with players
  // ═══════════════════════════════════════════════════════════

  /**
   * Show the share-to-player dialog for one or more contacts.
   * Instance method (not static) so `this._showShareDialog(...)` from
   * handler methods actually resolves — fixes a latent bug in the
   * pre-refactor static version.
   * @param {string[]} contactIds
   */
  async _showShareDialog(contactIds) {
    if (!contactIds.length) return;

    // Gather player-owned actors
    const playerActors = [];
    for (const user of game.users) {
      if (user.isGM || !user.character) continue;
      playerActors.push({
        actorId: user.character.id,
        actorName: user.character.name,
        playerName: user.name,
      });
    }

    if (!playerActors.length) {
      ui.notifications.warn('NCM | No player-owned characters found.');
      return;
    }

    // Build contact names for display
    const contactNames = contactIds
      .map(id => {
        if (id.startsWith('pc-')) return null;
        return this.masterContactService?.getContact(id)?.name;
      })
      .filter(Boolean);

    const isSingle = contactNames.length === 1;
    const title = isSingle ? `Share ${contactNames[0]}` : `Share ${contactNames.length} Contacts`;
    const desc = isSingle
      ? `Share <b>${contactNames[0]}</b> with:`
      : `Share <b>${contactNames.length}</b> contacts with:`;

    const checkboxes = playerActors.map(pa =>
      `<label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:12px; cursor:pointer;">
        <input type="checkbox" name="actor-${pa.actorId}" value="${pa.actorId}" checked style="margin:0;">
        <b>${pa.actorName}</b> <span style="color:#888;">(${pa.playerName})</span>
      </label>`
    ).join('');

    const dialog = new Dialog({
      title,
      content: `
        <div style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <p style="font-size:11px; margin:0;">${desc}</p>
          <div style="display:flex; flex-direction:column; gap:2px;">${checkboxes}</div>
        </div>`,
      buttons: {
        share: {
          icon: '<i class="fas fa-share-nodes"></i>',
          label: 'Share',
          callback: async (html) => {
            const selectedActorIds = [];
            html.find('input[type="checkbox"]:checked').each((_, el) => {
              selectedActorIds.push(el.value);
            });
            if (!selectedActorIds.length) return;

            let shared = 0;
            for (const contactId of contactIds) {
              if (contactId.startsWith('pc-')) continue;
              for (const actorId of selectedActorIds) {
                const result = await this.masterContactService?.pushToPlayer(contactId, actorId);
                if (result?.success) shared++;
              }
            }

            const actorCount = selectedActorIds.length;
            ui.notifications.info(
              `NCM | Shared ${contactNames.length} contact${contactNames.length !== 1 ? 's' : ''} with ${actorCount} player${actorCount !== 1 ? 's' : ''}.`
            );
            this._selectedIds.clear();
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'share',
    });
    dialog.render(true);
  }

  // ═══════════════════════════════════════════════════════════
  //  Action Handlers
  // ═══════════════════════════════════════════════════════════

  onOpenGMContacts(event, target) {
    game.nightcity?.openGMContacts?.();
    log.info('Admin: Opening GM Contact Manager');
  }

  async onPushContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    await this._showShareDialog([contactId]);
  }

  onViewPlayerContacts(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    if (!actorId || !game.user.isGM) return;

    const actor = game.actors.get(actorId);
    if (!actor) {
      ui.notifications.warn('Actor not found.');
      return;
    }

    // Import ContactManagerApp dynamically to avoid circular deps
    const ContactManagerApp = game.nightcity?._ContactManagerApp;
    if (!ContactManagerApp) {
      // Fallback: try opening via the standard launch function
      game.nightcity?.openContacts?.(actorId, { gmInspectMode: true });
      return;
    }

    const app = new ContactManagerApp({
      actorId,
      gmInspectMode: true,
    });
    app.render(true);
  }

  async onGMVerifyContact(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!actorId || !contactId || !game.user.isGM) return;

    const contactRepo = game.nightcity?.contactRepository;
    const result = await contactRepo?.gmOverrideVerification(actorId, contactId, true);

    if (result?.success) {
      ui.notifications.info('Contact force-verified.');
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Verification failed.');
    }
  }

  async onGMUnverifyContact(event, target) {
    const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!actorId || !contactId || !game.user.isGM) return;

    const contactRepo = game.nightcity?.contactRepository;
    const result = await contactRepo?.gmOverrideVerification(actorId, contactId, false);

    if (result?.success) {
      ui.notifications.info('Verification revoked.');
      this.render(true);
    } else {
      ui.notifications.error(result?.error || 'Failed to unverify.');
    }
  }

  onSendAsContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = game.nightcity?.masterContactService?.getContact(contactId);
    if (!contact) return;

    if (contact.actorId) {
      game.nightcity?.composeMessage?.({ fromActorId: contact.actorId });
    } else {
      game.nightcity?.composeMessage?.({
        fromContact: {
          id: contact.id,
          name: contact.name,
          email: contact.email,
          portrait: contact.portrait || null,
        },
      });
    }
  }

  onOpenContactInbox(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = game.nightcity?.masterContactService?.getContact(contactId);
    if (!contact) return;

    const inboxId = contact.actorId || contactId;
    game.nightcity?.openInbox?.(inboxId);
  }

  onComposeToContact(event, target) {
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = game.nightcity?.masterContactService?.getContact(contactId);
    if (!contact) return;

    game.nightcity?.composeMessage?.({
      toActorId: contact.actorId || null,
      to: contact.email,
    });
  }

  onExportContacts(event, target) {
    const svc = game.nightcity?.masterContactService;
    if (!svc) return;

    const contacts = svc.getAll?.() || [];
    const data = JSON.stringify(contacts, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `ncm-master-contacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    ui.notifications.info(`Exported ${contacts.length} contacts.`);
  }

  async onImportContactsJSON(event, target) {
    const svc = game.nightcity?.masterContactService;
    if (!svc) {
      ui.notifications.warn('Master contact service not available.');
      return;
    }

    // Create a hidden file input
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const contacts = JSON.parse(text);

        if (!Array.isArray(contacts)) {
          ui.notifications.error('Invalid format — expected a JSON array of contacts.');
          return;
        }

        let imported = 0;
        let skipped = 0;
        const existing = svc.getAll() || [];
        const existingEmails = new Set(existing.map(c => c.email?.toLowerCase()));

        for (const c of contacts) {
          if (!c.name) { skipped++; continue; }
          // Skip duplicates by email
          if (c.email && existingEmails.has(c.email.toLowerCase())) { skipped++; continue; }

          const result = await svc.addContact({
            name: c.name,
            email: c.email || '',
            alias: c.alias || '',
            phone: c.phone || '',
            organization: c.organization || '',
            portrait: c.portrait || '',
            type: c.type || c.role || 'npc',
            tags: c.tags || [],
            notes: c.notes || '',
            relationship: c.relationship || '',
            trust: c.trust ?? 3,
          });
          if (result?.success) {
            imported++;
            existingEmails.add(c.email?.toLowerCase());
          }
        }

        ui.notifications.info(`Imported ${imported} contacts. ${skipped ? `${skipped} skipped (duplicates or invalid).` : ''}`);
        this.render(true);
      } catch (err) {
        console.error('NCM | Import contacts failed:', err);
        ui.notifications.error('Failed to parse JSON file.');
      } finally {
        input.remove();
      }
    });

    input.click();
  }

  async onSetTrust(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    const trustValue = parseInt(target.dataset.trustValue, 10);
    if (!contactId || isNaN(trustValue)) return;

    const svc = game.nightcity?.masterContactService;
    if (!svc) return;

    await svc.updateContact(contactId, { trust: trustValue });
    this.render(true);
  }

  async onEditInEditor(event, target) {
    event.stopPropagation();
    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    // openGMContacts returns the singleton app instance
    const gmApp = await game.nightcity?.openGMContacts?.();
    if (gmApp) {
      gmApp._selectedContactId = contactId;
      gmApp._isEditing = false;
      gmApp._isCreating = false;
      gmApp.render(true);
    }
  }

  async onCreateNew(event, target) {
    const gmApp = await game.nightcity?.openGMContacts?.();
    if (gmApp) {
      gmApp._isCreating = true;
      gmApp._selectedContactId = null;
      gmApp._isEditing = false;
      gmApp.render(true);
    }
  }

  onPushAll(event, target) {
    game.nightcity?.openGMContacts?.();
  }

  onFilter(event, target) {
    const filter = target.dataset.filter || 'all';
    // Toggle: clicking the active filter resets to 'all'
    this._filter = (this._filter === filter) ? 'all' : filter;
    this.app._saveScroll();
    this.render(true);
  }

  onClearSearch(event, target) {
    this._search = '';
    this.app._saveScroll();
    this.render(true);
  }

  onToggleExpand(event, target) {
    // Don't toggle if clicking on an action button, checkbox, or trust segment
    const clickedAction = event.target.closest('[data-action]:not([data-action="toggleContactExpand"])');
    if (clickedAction) return;

    const contactId = target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    this._expandedId = (this._expandedId === contactId) ? null : contactId;
    this._overflowOpen = false;
    this.app._saveScroll();
    this.render(true);
  }

  onToggleSelect(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const contactId = target.dataset.contactId || target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    if (this._selectedIds.has(contactId)) {
      this._selectedIds.delete(contactId);
    } else {
      this._selectedIds.add(contactId);
    }
    this.app._saveScroll();
    this.render(true);
  }

  onClearSelection() {
    this._selectedIds.clear();
    this.app._saveScroll();
    this.render(true);
  }

  onToggleGroup(event, target) {
    const groupKey = target.dataset.group || target.closest('[data-group]')?.dataset.group;
    if (!groupKey) return;
    if (this._collapsedGroups.has(groupKey)) {
      this._collapsedGroups.delete(groupKey);
    } else {
      this._collapsedGroups.add(groupKey);
    }
    this.app._saveScroll();
    this.render(true);
  }

  onToggleOverflow(event, target) {
    event.preventDefault();
    event.stopPropagation();
    this._overflowOpen = !this._overflowOpen;
    this.app._saveScroll();
    this.render(true);
  }

  async onBurnContact(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const contactId = target.dataset.contactId || target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;

    const contact = this.masterContactService?.getContact(contactId);
    if (!contact) return;

    const confirm = await Dialog.confirm({
      title: 'Burn Contact',
      content: `<p>Mark <b>${contact.name}</b> as burned (compromised)?</p><p>This will mark the contact as burned for all players.</p>`,
    });
    if (!confirm) return;

    await this.masterContactService.updateContact(contactId, { burned: true });
    ui.notifications.info(`NCM | ${contact.name} has been burned.`);
    this.render(true);
  }

  async onShareToPlayer(event, target) {
    event.preventDefault();
    event.stopPropagation();
    const contactId = target.dataset.contactId || target.closest('[data-contact-id]')?.dataset.contactId;
    if (!contactId) return;
    await this._showShareDialog([contactId]);
  }

  async onSyncFromActors(event, target) {
    event.preventDefault();
    event.stopPropagation();
    this._overflowOpen = false;

    const confirmed = await Dialog.confirm({
      title: 'Sync from Actors',
      content: `<p>Create master contacts for all world actors that have an NCM email assigned but aren't already in the directory?</p>`,
    });
    if (!confirmed) { this.render(true); return; }

    const result = await this.masterContactService?.importFromActors();
    if (result?.success) {
      ui.notifications.info(`NCM | Imported ${result.imported} contact${result.imported !== 1 ? 's' : ''} from world actors.`);
    } else {
      ui.notifications.warn('NCM | Sync failed.');
    }
    this.render(true);
  }

  async onBatchShare() {
    if (!this._selectedIds.size) return;
    await this._showShareDialog([...this._selectedIds]);
  }

  async onBatchTag() {
    if (!this._selectedIds.size) return;
    const count = this._selectedIds.size;

    // Build existing tags list for suggestions
    const existingTags = this.masterContactService?.getAllTags() ?? [];
    const tagOptions = existingTags.map(t => `<option value="${t}">`).join('');

    const dialog = new Dialog({
      title: `Tag ${count} Contact${count !== 1 ? 's' : ''}`,
      content: `
        <form style="display:flex; flex-direction:column; gap:8px; padding:4px 0;">
          <label style="font-size:11px; font-weight:600;">Tag name</label>
          <input type="text" name="tag" list="ncm-tag-suggest" placeholder="e.g. HEIST, WATSON, VIP..."
                 style="padding:6px 8px; font-size:12px;">
          <datalist id="ncm-tag-suggest">${tagOptions}</datalist>
          <p style="font-size:10px; color:#888; margin:0;">Will be added to all ${count} selected contacts.</p>
        </form>`,
      buttons: {
        apply: {
          icon: '<i class="fas fa-tag"></i>',
          label: 'Apply Tag',
          callback: async (html) => {
            const tag = html.find('[name="tag"]').val()?.trim();
            if (!tag) return;
            let tagged = 0;
            for (const contactId of this._selectedIds) {
              if (contactId.startsWith('pc-')) continue;
              const contact = this.masterContactService?.getContact(contactId);
              if (!contact) continue;
              const currentTags = contact.tags || [];
              if (!currentTags.includes(tag)) {
                await this.masterContactService.updateContact(contactId, {
                  tags: [...currentTags, tag],
                });
                tagged++;
              }
            }
            this._selectedIds.clear();
            ui.notifications.info(`NCM | Tagged ${tagged} contact${tagged !== 1 ? 's' : ''} with "${tag}".`);
            this.render(true);
          },
        },
        cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel' },
      },
      default: 'apply',
    });
    dialog.render(true);
  }

  async onBatchBurn() {
    if (!this._selectedIds.size) return;
    const count = this._selectedIds.size;
    const confirm = await Dialog.confirm({
      title: 'Burn Contacts',
      content: `<p>Mark <b>${count}</b> selected contacts as burned?</p>`,
    });
    if (!confirm) return;

    for (const contactId of this._selectedIds) {
      if (contactId.startsWith('pc-')) continue; // Can't burn player characters
      await this.masterContactService?.updateContact(contactId, { burned: true });
    }
    this._selectedIds.clear();
    ui.notifications.info(`NCM | ${count} contacts burned.`);
    this.render(true);
  }

  onOpenRecentMessage(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const msgEl = target.closest('.ncm-ct-detail__msg');
    if (!msgEl) return;

    const inboxOwnerId = msgEl.dataset.inboxOwner;
    const messageId = msgEl.dataset.messageId;

    if (!inboxOwnerId) return;

    // openInbox handles singleton window, actor switching, and message selection
    game.nightcity?.openInbox?.(inboxOwnerId, messageId || undefined);
  }
}
