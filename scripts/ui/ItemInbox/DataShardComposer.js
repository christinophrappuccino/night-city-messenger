/**
 * DataShardComposer — Add Entries to Data Shards (Sprint 4.6)
 * @file scripts/ui/ItemInbox/DataShardComposer.js
 * @module cyberpunkred-messenger
 * @description GM-only dialog for adding entries to data shards.
 *   Content type selector swaps form fields per type.
 *   Phase A: message + eddies fully functional, dossier functional,
 *   payload/avlog/location have basic form shells.
 */

import { MODULE_ID, DEFAULTS, CONTENT_TYPES } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { CyberTimePicker } from '../components/CyberTimePicker.js';

/** Content type pill definitions */
const TYPE_PILLS = [
  { key: CONTENT_TYPES.MESSAGE,  icon: 'fas fa-envelope',       label: 'Message' },
  { key: CONTENT_TYPES.EDDIES,   icon: 'fas fa-coins',          label: 'Eddies' },
  { key: CONTENT_TYPES.DOSSIER,  icon: 'fas fa-user-secret',    label: 'Dossier' },
  { key: CONTENT_TYPES.PAYLOAD,  icon: 'fas fa-bug',            label: 'Payload' },
  { key: CONTENT_TYPES.AVLOG,    icon: 'fas fa-microphone',     label: 'AV Log' },
  { key: CONTENT_TYPES.LOCATION, icon: 'fas fa-map-pin',        label: 'Location' },
];

/** Accent color options */
const ACCENT_COLORS = [
  { key: 'red',    cssVar: 'var(--ncm-color-primary)',   hex: '#F65261' },
  { key: 'cyan',   cssVar: 'var(--ncm-color-secondary)', hex: '#19f3f7' },
  { key: 'gold',   cssVar: '#f7c948',                    hex: '#f7c948' },
  { key: 'green',  cssVar: '#00ff41',                    hex: '#00ff41' },
  { key: 'purple', cssVar: '#a855f7',                    hex: '#a855f7' },
  { key: 'danger', cssVar: '#ff0033',                    hex: '#ff0033' },
  { key: 'muted',  cssVar: 'var(--ncm-text-muted)',      hex: '#888888' },
];

/** Entry icon options */
const ENTRY_ICON_OPTIONS = [
  { value: 'fas fa-envelope',          label: 'Envelope' },
  { value: 'fas fa-skull-crossbones',  label: 'Skull & Bones' },
  { value: 'fas fa-crosshairs',        label: 'Crosshairs' },
  { value: 'fas fa-key',               label: 'Key' },
  { value: 'fas fa-building',          label: 'Building' },
  { value: 'fas fa-bolt',              label: 'Bolt' },
  { value: 'fas fa-brain',             label: 'Brain' },
  { value: 'fas fa-shield-halved',     label: 'Shield' },
  { value: 'fas fa-ghost',             label: 'Ghost' },
  { value: 'fas fa-gun',               label: 'Gun' },
  { value: 'fas fa-flask',             label: 'Flask' },
  { value: 'fas fa-bomb',              label: 'Bomb' },
  { value: 'fas fa-sack-dollar',       label: 'Money Bag' },
  { value: 'fas fa-coins',             label: 'Coins' },
  { value: 'fas fa-user-secret',       label: 'User Secret' },
  { value: 'fas fa-id-badge',          label: 'ID Badge' },
  { value: 'fas fa-virus',             label: 'Virus' },
  { value: 'fas fa-microphone',        label: 'Microphone' },
  { value: 'fas fa-headphones',        label: 'Headphones' },
  { value: 'fas fa-map-marker-alt',    label: 'Map Marker' },
  { value: 'fas fa-satellite-dish',    label: 'Satellite' },
  { value: 'fas fa-file-shield',       label: 'File Shield' },
];

export class DataShardComposer extends BaseApplication {

  shardItem = null;
  onSave = null;

  /** Currently selected content type */
  _selectedType = CONTENT_TYPES.MESSAGE;

  /** Currently selected accent color */
  _selectedAccent = 'cyan';

  get dataShardService() { return game.nightcity?.dataShardService; }
  get networkService() { return game.nightcity?.networkService; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-data-shard-composer',
    classes: ['ncm-app', 'ncm-data-shard-composer'],
    window: { title: 'NCM.DataShard.AddEntry', icon: 'fas fa-file-medical', resizable: true, minimizable: false },
    position: { width: 520, height: 580 },
    actions: {
      saveEntry: DataShardComposer._onSaveEntry,
      cancel: DataShardComposer._onCancel,
      selectContentType: DataShardComposer._onSelectContentType,
      selectAccent: DataShardComposer._onSelectAccent,
      selectIcon: DataShardComposer._onSelectIcon,
      addDossierSection: DataShardComposer._onAddDossierSection,
      removeDossierSection: DataShardComposer._onRemoveDossierSection,
      addTranscriptLine: DataShardComposer._onAddTranscriptLine,
      removeTranscriptLine: DataShardComposer._onRemoveTranscriptLine,
      browseImage: DataShardComposer._onBrowseImage,
      addEntryNetworkTag: DataShardComposer._onAddEntryNetworkTag,
      removeEntryNetworkTag: DataShardComposer._onRemoveEntryNetworkTag,
      openTimePicker: DataShardComposer._onOpenTimePicker,
    },
  }, { inplace: false });

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/item-inbox/data-shard-composer.hbs` },
  };

  constructor(options = {}) {
    super(options);
    if (options.shardItem) this.shardItem = options.shardItem;
    if (options.onSave) this.onSave = options.onSave;
    if (options.editData) {
      this.editData = options.editData;
      this._selectedType = options.editData.contentType || CONTENT_TYPES.MESSAGE;
    }
  }

  get title() {
    const verb = this.editData ? 'Edit Entry' : 'Add Entry';
    return `${verb}: ${this.shardItem?.name ?? 'Unknown'}`;
  }

  // ═══════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    if (!this.shardItem || !isGM()) return { hasItem: false };
    const config = this.dataShardService?.getConfig(this.shardItem) ?? DEFAULTS.SHARD_CONFIG;
    const type = this._selectedType;

    // Content type pills
    const typePills = TYPE_PILLS.map(p => ({
      ...p, isActive: p.key === type,
    }));

    // Icon options
    const iconOptions = ENTRY_ICON_OPTIONS.map(o => ({
      ...o, selected: false,
    }));

    // Accent colors
    const accentColors = ACCENT_COLORS.map(c => ({
      ...c, isActive: c.key === this._selectedAccent,
    }));

    // Actors list for dossier linking
    const actorOptions = (game.actors ?? [])
      .filter(a => a.type === 'character' || a.type === 'npc' || a.type === 'mook')
      .map(a => ({ id: a.id, name: a.name }));

    return {
      hasItem: true,
      shardName: this.shardItem.name,
      selectedType: type,

      // Edit mode
      isEditing: !!this.editData,
      editEntryId: this.editData?.entryId || '',

      // Pre-filled values (from edit data or empty)
      editFrom: this.editData?.from || '',
      editSubject: this.editData?.subject || '',
      editBody: this.editData?.body || '',
      editTimestamp: this.editData?.timestamp || '',
      editTimestampFormatted: this.editData?.timestamp ? formatCyberDate(this.editData.timestamp) : '',
      editContentData: this.editData?.contentData ?? {},
      editEncrypted: this.editData?.encrypted ?? false,
      editNetworkRestricted: this.editData?.networkVisibility?.restricted ?? false,

      // Dossier sections (for edit pre-fill)
      editDossierSections: (this.editData?.contentData?.sections ?? []).map((s, i) => ({
        index: i, heading: s.heading || '', body: s.body || '', redacted: !!s.redacted,
      })),
      hasDossierSections: (this.editData?.contentData?.sections?.length ?? 0) > 0,

      // Transcript lines (for edit pre-fill)
      editTranscriptLines: (this.editData?.contentData?.transcript ?? []).map((l, i) => ({
        index: i, speaker: l.speaker || '', text: l.text || '',
      })),
      hasTranscriptLines: (this.editData?.contentData?.transcript?.length ?? 0) > 0,

      // Payload duration in hours (stored in ms)
      editPayloadDurationHrs: this.editData?.contentData?.effect?.duration
        ? Math.round(this.editData.contentData.effect.duration / 3600000)
        : null,

      // Type pills
      typePills,

      // Type booleans for template sections
      isMessage: type === CONTENT_TYPES.MESSAGE,
      isEddies: type === CONTENT_TYPES.EDDIES,
      isDossier: type === CONTENT_TYPES.DOSSIER,
      isPayload: type === CONTENT_TYPES.PAYLOAD,
      isAvlog: type === CONTENT_TYPES.AVLOG,
      isLocation: type === CONTENT_TYPES.LOCATION,

      // Identity
      iconOptions,
      accentColors,
      selectedAccent: this._selectedAccent,

      // Per-entry encryption
      isPerMessageEncryption: config.encryptionMode === 'message',
      defaultDC: config.encryptionDC ?? 15,

      // Dossier helpers
      actorOptions,

      // Shared — default timestamp is game time
      defaultTimestamp: (() => {
        const ts = game.nightcity?.timeService;
        try {
          const gt = ts?.getCurrentTime?.();
          if (gt instanceof Date && !isNaN(gt.getTime())) return gt.toISOString();
        } catch { /* fall through */ }
        if (game.time?.worldTime) {
          const d = new Date(game.time.worldTime * 1000);
          if (!isNaN(d.getTime())) return d.toISOString();
        }
        return new Date().toISOString();
      })(),
      defaultTimestampFormatted: (() => {
        const ts = game.nightcity?.timeService;
        try {
          const gt = ts?.getCurrentTime?.();
          if (gt instanceof Date && !isNaN(gt.getTime())) return formatCyberDate(gt.toISOString());
        } catch { /* fall through */ }
        if (game.time?.worldTime) {
          const d = new Date(game.time.worldTime * 1000);
          if (!isNaN(d.getTime())) return formatCyberDate(d.toISOString());
        }
        return formatCyberDate(new Date().toISOString());
      })(),

      // Networks (for visibility restriction)
      networkOptions: (this.networkService?.getAllNetworks() ?? []).map(n => ({ value: n.id, label: n.name })),
    };
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER LIFECYCLE
  // ═══════════════════════════════════════════════════════════

  _onRender(context, options) {
    if (!this.editData) return;
    const el = this.element;
    if (!el) return;
    const cd = this.editData.contentData ?? {};

    // ─── Set select values from editData (Handlebars has no eq helper) ───
    const selectMap = {
      dossierClassification: cd.classification,
      dossierLinkedActor: cd.linkedActorId,
      dossierThreat: cd.stats?.threat,
      payloadType: cd.payloadType,
      payloadEffectType: cd.effect?.type,
      payloadDisguiseType: cd.disguiseType,
      avlogMediaType: cd.mediaType,
    };
    for (const [key, val] of Object.entries(selectMap)) {
      if (!val) continue;
      const select = el.querySelector(`[data-edit-select="${key}"]`);
      if (select) select.value = val;
    }

    // ─── Pre-populate network visibility tags ───
    const nv = this.editData.networkVisibility;
    if (nv?.restricted && nv.allowedNetworks?.length) {
      const container = el.querySelector('#ncm-entry-network-tags');
      const dropdown = el.querySelector('#ncm-add-entry-network-select');
      if (container && dropdown) {
        for (const netId of nv.allowedNetworks) {
          const opt = dropdown.querySelector(`option[value="${netId}"]`);
          if (!opt) continue;
          const label = opt.textContent;

          const tag = document.createElement('div');
          tag.classList.add('ncm-tag');
          tag.dataset.value = netId;
          tag.innerHTML = `<span>${label}</span>
            <button type="button" class="ncm-tag__remove" data-action="removeEntryNetworkTag" data-value="${netId}"><i class="fas fa-times"></i></button>
            <input type="hidden" name="entryAllowedNetwork" value="${netId}" />`;
          container.appendChild(tag);
          opt.remove();
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CONTENT TYPE SELECTION
  // ═══════════════════════════════════════════════════════════

  static _onSelectContentType(event, target) {
    const type = target.dataset.type;
    if (!type) return;
    this._selectedType = type;
    this.render();
  }

  static _onSelectAccent(event, target) {
    const accent = target.dataset.accent;
    if (!accent) return;
    this._selectedAccent = accent;
    this.element?.querySelectorAll('.ncm-composer-color-dot').forEach(dot => {
      dot.classList.toggle('ncm-composer-color-dot--active', dot.dataset.accent === accent);
    });
  }

  static _onSelectIcon(event, target) {
    const icon = target.dataset.icon;
    const targetInput = target.dataset.target;
    if (!icon || !targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    if (input) input.value = icon;
    const grid = target.closest('.ncm-icon-grid');
    grid?.querySelectorAll('.ncm-icon-grid__item').forEach(el => {
      el.classList.toggle('ncm-icon-grid__item--active', el.dataset.icon === icon);
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  SAVE ENTRY
  // ═══════════════════════════════════════════════════════════

  static async _onSaveEntry(event, target) {
    if (!isGM() || !this.shardItem) return;
    const form = this.element.querySelector('form');
    if (!form) return;
    const fd = new FormDataExtended(form);
    const data = fd.object;
    const type = this._selectedType;

    // Build base entry data — convert datetime-local → ISO
    let timestamp = data.timestamp || '';
    if (timestamp && !timestamp.includes('Z') && !timestamp.match(/[+-]\d{2}:\d{2}$/)) {
      try { timestamp = new Date(timestamp).toISOString(); } catch { /* keep as-is */ }
    }
    if (!timestamp) timestamp = new Date().toISOString();

    const entryData = {
      contentType: type,
      from: data.from || 'UNKNOWN',
      subject: data.subject || 'Data Fragment',
      body: data.body || '',
      timestamp,
      encrypted: !!data.encrypted,
      encryptionDC: parseInt(data.encryptionDC) || undefined,
      networkVisibility: {
        restricted: !!data.networkRestricted,
        allowedNetworks: Array.from(this.element?.querySelectorAll('[name="entryAllowedNetwork"]') ?? []).map(el => el.value).filter(Boolean),
        allowedTypes: [],
      },
      contentData: {},
    };

    // Build type-specific contentData
    switch (type) {
      case CONTENT_TYPES.MESSAGE:
        // No extra contentData — uses body/subject/from as-is
        if (!entryData.subject?.trim() && !entryData.body?.trim()) {
          ui.notifications.warn('NCM | Entry needs a subject or body.');
          return;
        }
        break;

      case CONTENT_TYPES.EDDIES:
        entryData.subject = data.eddiesTitle || 'Eddies Dead Drop';
        entryData.contentData = {
          amount: parseInt(data.eddiesAmount) || 0,
          claimed: false,
          claimedBy: null,
          claimedAt: null,
          note: data.eddiesNote || '',
          splitEnabled: false,
        };
        if (entryData.contentData.amount <= 0) {
          ui.notifications.warn('NCM | Eddies amount must be greater than 0.');
          return;
        }
        break;

      case CONTENT_TYPES.DOSSIER:
        entryData.subject = data.dossierTargetName || 'Unknown Subject';
        entryData.contentData = {
          targetName: data.dossierTargetName || 'Unknown',
          targetAlias: data.dossierAlias || '',
          targetImage: data.dossierPortrait || null,
          linkedActorId: data.dossierLinkedActor || null,
          classification: data.dossierClassification || '',
          sections: this._collectDossierSections(),
          stats: {
            threat: data.dossierThreat || '',
            affiliation: data.dossierAffiliation || '',
            lastKnownLocation: data.dossierLastKnown || '',
          },
        };
        break;

      case CONTENT_TYPES.PAYLOAD:
        entryData.subject = data.payloadName || 'Unknown Program';
        entryData.contentData = {
          payloadType: data.payloadType || 'custom',
          name: data.payloadName || 'UNKNOWN.exe',
          description: data.payloadDescription || '',
          effect: { type: data.payloadEffectType || 'custom', duration: (parseInt(data.payloadDuration) || 24) * 3600000 },
          executed: false,
          executedBy: null,
          executedAt: null,
          disguised: !!data.payloadDisguised,
          disguiseType: data.payloadDisguiseType || 'message',
        };
        break;

      case CONTENT_TYPES.AVLOG:
        entryData.subject = data.avlogTitle || 'Recording';
        entryData.contentData = {
          mediaType: data.avlogMediaType || 'audio',
          duration: data.avlogDuration || '00:00',
          source: data.avlogSource || '',
          transcript: this._collectTranscriptLines(),
          corrupted: false,
          corruptionLevel: 0,
        };
        break;

      case CONTENT_TYPES.LOCATION:
        entryData.subject = data.locationName || 'Unknown Location';
        entryData.contentData = {
          locationName: data.locationName || 'Unknown',
          locationImage: data.locationImage || null,
          coordinates: data.locationCoords || '',
          district: data.locationDistrict || '',
          description: data.locationDescription || '',
          linkedSceneId: data.locationSceneId || null,
          pinX: null,
          pinY: null,
        };
        break;
    }

    let result;
    const typeLabel = TYPE_PILLS.find(p => p.key === type)?.label ?? 'Entry';

    if (this.editData?.entryId) {
      // EDIT MODE — update existing journal page
      const journal = this.dataShardService?._getLinkedJournal(this.shardItem);
      if (!journal) { ui.notifications.error('NCM | Journal not found.'); return; }
      const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === this.editData.entryId);
      if (!page) { ui.notifications.error('NCM | Entry not found.'); return; }

      const updateData = {
        name: entryData.subject || page.name,
        'text.content': entryData.body || '',
      };
      for (const [key, val] of Object.entries(entryData)) {
        updateData[`flags.${MODULE_ID}.${key}`] = val;
      }
      await page.update(updateData);
      result = { success: true };
      ui.notifications.info(`NCM | ${typeLabel} updated.`);
    } else {
      // CREATE MODE — add new entry
      result = await this.dataShardService.addMessage(this.shardItem, entryData);
      if (result.success) {
        ui.notifications.info(`NCM | ${typeLabel} added to shard.`);
      }
    }

    if (result?.success) {
      if (typeof this.onSave === 'function') this.onSave();
      this.close();
    } else if (!result?.success) {
      ui.notifications.error(`NCM | Failed: ${result?.error || 'Unknown error'}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  DOSSIER SECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  static _onAddDossierSection(event, target) {
    const container = this.element?.querySelector('.ncm-dossier-sections-list');
    if (!container) return;
    const idx = container.children.length;
    const section = document.createElement('div');
    section.classList.add('ncm-dossier-section-entry');
    section.innerHTML = `
      <div class="ncm-config-row">
        <label class="ncm-config-label">Heading</label>
        <input type="text" name="dossierSectionHeading-${idx}" class="ncm-config-input ncm-config-flex" placeholder="Section heading" />
      </div>
      <div class="ncm-config-row ncm-config-row--col">
        <textarea name="dossierSectionBody-${idx}" class="ncm-config-input ncm-config-textarea" placeholder="Section content..."></textarea>
      </div>
      <div class="ncm-config-row">
        <label class="ncm-config-check"><input type="checkbox" name="dossierSectionRedacted-${idx}" /> Redacted</label>
        <button type="button" data-action="removeDossierSection" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" title="Remove section"><i class="fas fa-times"></i></button>
      </div>`;
    container.appendChild(section);
  }

  static _onRemoveDossierSection(event, target) {
    const entry = target.closest('.ncm-dossier-section-entry');
    if (entry) entry.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  TRANSCRIPT LINE MANAGEMENT (AV Log)
  // ═══════════════════════════════════════════════════════════

  static _onAddTranscriptLine(event, target) {
    const container = this.element?.querySelector('.ncm-transcript-list');
    if (!container) return;
    const idx = container.children.length;
    const line = document.createElement('div');
    line.classList.add('ncm-transcript-entry');
    line.innerHTML = `
      <input type="text" name="transcriptSpeaker-${idx}" class="ncm-config-input" style="max-width:100px;" placeholder="SPEAKER" />
      <input type="text" name="transcriptText-${idx}" class="ncm-config-input ncm-config-flex" placeholder="Dialogue line..." />
      <button type="button" data-action="removeTranscriptLine" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" title="Remove"><i class="fas fa-times"></i></button>`;
    container.appendChild(line);
  }

  static _onRemoveTranscriptLine(event, target) {
    const entry = target.closest('.ncm-transcript-entry');
    if (entry) entry.remove();
  }

  // ═══════════════════════════════════════════════════════════
  //  COLLECTION HELPERS
  // ═══════════════════════════════════════════════════════════

  _collectDossierSections() {
    const sections = [];
    const entries = this.element?.querySelectorAll('.ncm-dossier-section-entry') ?? [];
    for (let i = 0; i < entries.length; i++) {
      const heading = entries[i].querySelector(`[name^="dossierSectionHeading"]`)?.value?.trim();
      const body = entries[i].querySelector(`[name^="dossierSectionBody"]`)?.value?.trim();
      const redacted = entries[i].querySelector(`[name^="dossierSectionRedacted"]`)?.checked ?? false;
      if (heading || body) {
        sections.push({ heading: heading || 'Untitled', body: body || '', redacted });
      }
    }
    return sections;
  }

  _collectTranscriptLines() {
    const lines = [];
    const entries = this.element?.querySelectorAll('.ncm-transcript-entry') ?? [];
    for (let i = 0; i < entries.length; i++) {
      const speaker = entries[i].querySelector(`[name^="transcriptSpeaker"]`)?.value?.trim();
      const text = entries[i].querySelector(`[name^="transcriptText"]`)?.value?.trim();
      if (speaker || text) {
        lines.push({ speaker: speaker || 'UNKNOWN', text: text || '...' });
      }
    }
    return lines;
  }

  // ═══════════════════════════════════════════════════════════
  //  TIMESTAMP PICKER
  // ═══════════════════════════════════════════════════════════

  /** Open CyberTimePicker for a timestamp field */
  static _onOpenTimePicker(event, target) {
    const inputName = target.dataset.target || 'timestamp';
    const hiddenInput = this.element?.querySelector(`input[name="${inputName}"]`);
    const triggerValue = target.querySelector('.ncm-ctp-trigger__value');

    CyberTimePicker.open({
      value: hiddenInput?.value || '',
      onSet: (iso, formatted) => {
        if (hiddenInput) hiddenInput.value = iso;
        if (triggerValue) {
          triggerValue.textContent = formatted;
          triggerValue.classList.remove('ncm-ctp-trigger__value--empty');
        }
      },
      onClear: () => {
        if (hiddenInput) hiddenInput.value = '';
        if (triggerValue) {
          triggerValue.textContent = 'No timestamp set';
          triggerValue.classList.add('ncm-ctp-trigger__value--empty');
        }
      },
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  MISC
  // ═══════════════════════════════════════════════════════════

  static _onCancel(event, target) { this.close(); }

  static _onBrowseImage(event, target) {
    const targetInput = target.dataset.target;
    if (!targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    new FilePicker({
      type: 'image',
      current: input?.value || '',
      callback: (path) => { if (input) input.value = path; },
    }).render(true);
  }

  static _onAddEntryNetworkTag(event, target) {
    const select = this.element?.querySelector('#ncm-add-entry-network-select');
    const value = select?.value;
    if (!value) return;
    const label = select.options[select.selectedIndex]?.text || value;
    const container = this.element?.querySelector('#ncm-entry-network-tags');
    if (!container) return;

    // Don't add duplicates
    if (container.querySelector(`[data-value="${value}"]`)) return;

    const tag = document.createElement('div');
    tag.classList.add('ncm-tag');
    tag.dataset.value = value;
    tag.innerHTML = `<span>${label}</span>
      <button type="button" class="ncm-tag__remove" data-action="removeEntryNetworkTag" data-value="${value}"><i class="fas fa-times"></i></button>
      <input type="hidden" name="entryAllowedNetwork" value="${value}" />`;
    container.appendChild(tag);

    // Remove from dropdown
    const opt = select.querySelector(`option[value="${value}"]`);
    if (opt) opt.remove();
    select.value = '';
  }

  static _onRemoveEntryNetworkTag(event, target) {
    const value = target.dataset.value || target.closest('[data-value]')?.dataset.value;
    if (!value) return;
    const tag = this.element?.querySelector(`#ncm-entry-network-tags [data-value="${value}"]`);
    if (tag) {
      const label = tag.querySelector('span')?.textContent || value;
      tag.remove();
      // Re-add to dropdown
      const select = this.element?.querySelector('#ncm-add-entry-network-select');
      if (select) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        select.appendChild(opt);
      }
    }
  }
}
