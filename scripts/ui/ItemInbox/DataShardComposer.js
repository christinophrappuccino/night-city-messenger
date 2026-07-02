/**
 * DataShardComposer — Add Entries to Data Shards (Sprint 4.6)
 * @file scripts/ui/ItemInbox/DataShardComposer.js
 * @module cyberpunkred-messenger
 * @description GM-only dialog for authoring typed entries on data shards AND
 *   terminals (target descriptor { kind, item, accountId? }). Content type
 *   selector swaps form fields per type; a live preview renders the shared
 *   content-body partial. Repeatable rows (bank txns, calendar events, log
 *   lines, credentials) run through the generic list engine.
 *   Spreadsheet is the one type still without a form (grid editor pending).
 */

import { MODULE_ID, DEFAULTS, CONTENT_TYPES, TEMPLATES } from '../../utils/constants.js';
import { log, isGM, formatCyberDate } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { CyberTimePicker } from '../components/CyberTimePicker.js';
import { enrichContent, CT_COLORS } from '../content/ContentRenderers.js';

/** Content type pill definitions */
const TYPE_PILLS = [
  { key: CONTENT_TYPES.MESSAGE,  icon: 'fas fa-envelope',       label: 'Message' },
  { key: CONTENT_TYPES.EDDIES,   icon: 'fas fa-coins',          label: 'Eddies' },
  { key: CONTENT_TYPES.DOSSIER,  icon: 'fas fa-user-secret',    label: 'Dossier' },
  { key: CONTENT_TYPES.PAYLOAD,  icon: 'fas fa-bug',            label: 'Payload' },
  { key: CONTENT_TYPES.AVLOG,    icon: 'fas fa-microphone',     label: 'AV Log' },
  { key: CONTENT_TYPES.LOCATION, icon: 'fas fa-map-pin',        label: 'Location' },
  { key: CONTENT_TYPES.BANKING,  icon: 'fas fa-building-columns', label: 'Banking' },
  { key: CONTENT_TYPES.SPREADSHEET, icon: 'fas fa-table-cells',  label: 'Spreadsheet' },
  { key: CONTENT_TYPES.CALENDAR, icon: 'fas fa-calendar-days',  label: 'Calendar' },
  { key: CONTENT_TYPES.SYSLOG,   icon: 'fas fa-terminal',       label: 'System Log' },
  { key: CONTENT_TYPES.CREDENTIALS, icon: 'fas fa-key',         label: 'Credentials' },
];

/**
 * Plain-language intro per content type (design doc §12b — every control is
 * self-explanatory). `what` = what the file IS; `how` = the authoring walkthrough.
 * Written from the GM's side of the screen.
 */
const TYPE_INTROS = {
  [CONTENT_TYPES.MESSAGE]:  { what: 'A plain message, like an email.', how: 'Fill in the sender, subject, and body.' },
  [CONTENT_TYPES.EDDIES]:   { what: 'An eddies dead-drop. Whoever opens it can claim the money into their character’s wealth.', how: 'Set the amount and an optional note.' },
  [CONTENT_TYPES.DOSSIER]:  { what: 'A profile on a person — portrait, stats, and write-up sections.', how: 'Fill the identity fields, then add sections. Tick “Redacted” to black a section out.' },
  [CONTENT_TYPES.PAYLOAD]:  { what: 'A program or virus the player can execute from the file.', how: 'Name it and describe what running it does.' },
  [CONTENT_TYPES.AVLOG]:    { what: 'An audio or video recording with an optional transcript.', how: 'Paste a media link (YouTube/Vimeo/file) and add transcript lines.' },
  [CONTENT_TYPES.LOCATION]: { what: 'A place pin — coordinates, district, image, optional linked scene.', how: 'Fill the location details; link a Foundry scene to add a “Go to Scene” button.' },
  [CONTENT_TYPES.BANKING]:  { what: 'A bank account record — balance, transactions, and the bank’s identity.', how: 'Set the bank + account, add transactions (newest first). Optionally let players siphon funds with a security roll.' },
  [CONTENT_TYPES.SPREADSHEET]: { what: 'A data table — like a leaked finance sheet.', how: 'Define your columns, add rows, then click any cell to format it (bold, color, flag, or redact). Turn on Σ to total a number column. Or import a .csv and edit from there.' },
  [CONTENT_TYPES.CALENDAR]: { what: 'A schedule of events — meetings, handoffs, deadlines.', how: 'Add events with a date, place, and people. Give each a category and the legend colors itself.' },
  [CONTENT_TYPES.SYSLOG]:   { what: 'A console / access log — who did what, and when.', how: 'Add lines, each with a severity (info/ok/warn/err). Tick “mark” to spotlight the key one.' },
  [CONTENT_TYPES.CREDENTIALS]: { what: 'A recovered password vault — logins the player can use to pivot.', how: 'Add host / username / password rows. A password reused across hosts auto-flags REUSED.' },
};

/** Banking transaction repeatable-row field schema (the shared list engine). */
const BANK_TXN_FIELDS = [
  { f: 'date', ph: 'date', w: '70px' },
  { f: 'desc', ph: 'description', cls: 'flex' },
  { f: 'amount', type: 'number', ph: 'amount', w: '90px' },
  { f: 'type', type: 'select', opts: ['debit', 'credit'], w: '78px' },
  { f: 'category', ph: 'category', w: '92px' },
  { f: 'pending', type: 'checkbox', lbl: 'pending' },
];

/** Calendar event rows — `{ brk:true }` wraps to a second line within the row. */
const CAL_EVENT_FIELDS = [
  { f: 'when', type: 'date', w: '118px' },
  { f: 'title', ph: 'event title', cls: 'flex' },
  { f: 'time', ph: '19:00', w: '62px' },
  { brk: true },
  { f: 'location', ph: 'where', cls: 'flex' },
  { f: 'who', ph: 'who', w: '108px' },
  { f: 'category', ph: 'category', w: '94px' },
];

/** Syslog line rows — msg gets its own line so it isn't squeezed out. */
const SYSLOG_LINE_FIELDS = [
  { f: 'ts', ph: '04:12:09', w: '88px' },
  { f: 'sev', type: 'select', opts: ['info', 'ok', 'warn', 'err', 'debug'], w: '74px' },
  { f: 'actor', ph: 'user / proc', cls: 'flex' },
  { brk: true },
  { f: 'msg', ph: 'log message', cls: 'flex' },
  { f: 'mark', type: 'checkbox', lbl: 'mark' },
];

/** Credential vault rows. */
const CRED_ENTRY_FIELDS = [
  { f: 'host', ph: 'host / system', cls: 'flex' },
  { f: 'user', ph: 'username', w: '118px' },
  { f: 'secret', ph: 'password / key', w: '128px' },
  { brk: true },
  { f: 'note', ph: 'note (optional)', cls: 'flex' },
  { f: 'strength', type: 'select', opts: ['', '1', '2', '3', '4'], w: '56px' },
  { f: 'encrypted', type: 'checkbox', lbl: 'locked' },
];

/** Colors cycled onto calendar categories at save (order = visual variety). */
const CAL_CATEGORY_CYCLE = ['cyan', 'gold', 'purple', 'green', 'pink', 'red', 'amber', 'blue'];

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

  /** Target descriptor — { kind:'shard'|'terminal', item, accountId? }. */
  _target = null;

  /** Currently selected content type */
  _selectedType = CONTENT_TYPES.MESSAGE;

  /** Currently selected accent color */
  _selectedAccent = 'cyan';

  get dataShardService() { return game.nightcity?.dataShardService; }
  get terminalService() { return game.nightcity?.terminalService; }
  get networkService() { return game.nightcity?.networkService; }

  /** The targeted item (shard or terminal). */
  get _item() { return this._target?.item || this.shardItem; }
  get _isTerminal() { return this._target?.kind === 'terminal'; }
  /** The service that owns the target's journal. */
  get _service() { return this._isTerminal ? this.terminalService : this.dataShardService; }
  /** The target's linked journal (both services expose `_getLinkedJournal`). */
  _journal() { return this._service?._getLinkedJournal?.(this._item) || null; }

  static DEFAULT_OPTIONS = foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
    id: 'ncm-data-shard-composer',
    classes: ['ncm-app', 'ncm-data-shard-composer'],
    window: { title: 'NCM.DataShard.AddEntry', icon: 'fas fa-file-medical', resizable: true, minimizable: false },
    position: { width: 820, height: 600 },
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
      addListRow: DataShardComposer._onAddListRow,
      removeListRow: DataShardComposer._onRemoveListRow,
      ssFormat: DataShardComposer._onSsFormat,
      ssColor: DataShardComposer._onSsColor,
      ssImportCsv: DataShardComposer._onSsImportCsv,
      ssAddRow: DataShardComposer._onSsAddRow,
      ssAddCol: DataShardComposer._onSsAddCol,
      ssRemoveRow: DataShardComposer._onSsRemoveRow,
      ssRemoveCol: DataShardComposer._onSsRemoveCol,
      browseImage: DataShardComposer._onBrowseImage,
      browseMedia: DataShardComposer._onBrowseMedia,
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
    // Target: explicit { kind, item, accountId } OR legacy `shardItem` (= shard).
    if (options.target?.item) {
      this._target = options.target;
      this.shardItem = options.target.item; // back-compat for code reading shardItem
    } else if (options.shardItem) {
      this._target = { kind: 'shard', item: options.shardItem };
      this.shardItem = options.shardItem;
    }
    if (options.onSave) this.onSave = options.onSave;
    if (options.editData) {
      this.editData = options.editData;
      this._selectedType = options.editData.contentType || CONTENT_TYPES.MESSAGE;
    }
  }

  get title() {
    const verb = this.editData ? 'Edit Entry' : 'Add Entry';
    return `${verb}: ${this._item?.name ?? 'Unknown'}`;
  }

  // ═══════════════════════════════════════════════════════════
  //  DATA PREPARATION
  // ═══════════════════════════════════════════════════════════

  async _prepareContext(options) {
    if (!this._item || !isGM()) return { hasItem: false };
    const config = (!this._isTerminal && this.dataShardService?.getConfig(this._item)) || DEFAULTS.SHARD_CONFIG;
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
      shardName: this._item.name,
      isTerminalTarget: this._isTerminal,
      selectedType: type,
      typeIntro: TYPE_INTROS[type] || null,

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
      isBanking: type === CONTENT_TYPES.BANKING,
      isCalendar: type === CONTENT_TYPES.CALENDAR,
      isSyslog: type === CONTENT_TYPES.SYSLOG,
      isCredentials: type === CONTENT_TYPES.CREDENTIALS,
      isSpreadsheet: type === CONTENT_TYPES.SPREADSHEET,

      // Scalar edit pre-fills (repeatable rows are injected in _onRender from
      // editContentData so each row schema stays in one place).
      bank: this._bankContext(this.editData?.contentData ?? {}),
      syslog: this._syslogContext(this.editData?.contentData ?? {}),
      creds: this._credsContext(this.editData?.contentData ?? {}),
      ss: this._ssContext(this.editData?.contentData ?? {}),
      ssColors: CT_COLORS,

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
    const el = this.element;
    if (!el) return;

    // ─── Live preview: re-render on any input/change (debounced) ───
    const form = el.querySelector('form');
    if (form) {
      const deb = foundry.utils.debounce(() => this._renderPreview(), 180);
      form.addEventListener('input', deb);
      form.addEventListener('change', deb);
    }

    // ─── Repeatable rows: inject edit pre-fill, else seed one blank row ───
    const cd0 = (this.editData?.contentType === this._selectedType) ? (this.editData.contentData ?? {}) : {};
    const listSpecs = {
      [CONTENT_TYPES.BANKING]:     [{ key: 'bankTxns',    fields: BANK_TXN_FIELDS,    rows: cd0.transactions }],
      [CONTENT_TYPES.CALENDAR]:    [{ key: 'calEvents',   fields: CAL_EVENT_FIELDS,   rows: cd0.events }],
      [CONTENT_TYPES.SYSLOG]:      [{ key: 'syslogLines', fields: SYSLOG_LINE_FIELDS, rows: cd0.lines }],
      [CONTENT_TYPES.CREDENTIALS]: [{ key: 'credEntries', fields: CRED_ENTRY_FIELDS,  rows: cd0.entries }],
    }[this._selectedType] || [];
    for (const spec of listSpecs) {
      const container = el.querySelector(`[data-list="${spec.key}"]`);
      if (!container || container.children.length) continue;
      const rows = spec.rows?.length ? spec.rows : [{}]; // empty rows are dropped at collect
      container.insertAdjacentHTML('beforeend', rows.map((r, i) => this._rowHtml(spec.key, i, spec.fields, r)).join(''));
    }

    // ─── Spreadsheet grid editor: build + active-cell tracking ───
    if (this._selectedType === CONTENT_TYPES.SPREADSHEET) {
      const ss = el.querySelector('[data-ss]');
      if (ss && !ss.querySelector('table')) this._ssBuild(ss);
      ss?.addEventListener('focusin', (e) => {
        const td = e.target.closest?.('.ncm-ss-cell');
        if (!td) return;
        ss.querySelectorAll('.ncm-ss-cell.is-active').forEach(x => x.classList.remove('is-active'));
        td.classList.add('is-active');
        const reason = el.querySelector('.ncm-ss-reason');
        if (reason) reason.value = td.dataset.reason || '';
      });
    }

    // First preview paint.
    this._renderPreview();

    if (!this.editData) return;
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
      bankSiphonMode: cd.siphonMode,
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
    if (!isGM() || !this._item) return;
    const entryData = this._collectEntryData({ validate: true });
    if (!entryData) return; // validation failed (warned inside)
    const res = await this._persistEntry(entryData);
    if (res?.success) {
      ui.notifications.info(`NCM | ${res.label} ${res.edited ? 'updated' : 'added'}.`);
      if (typeof this.onSave === 'function') this.onSave();
      this.close();
    } else {
      ui.notifications.error(`NCM | Failed: ${res?.error || 'Unknown error'}`);
    }
  }

  /** Read the form into a full entryData object. Shared by save + live preview. */
  _collectEntryData({ validate = false } = {}) {
    const form = this.element?.querySelector('form');
    if (!form) return null;
    const data = new FormDataExtended(form).object;
    const type = this._selectedType;

    let timestamp = data.timestamp || '';
    if (timestamp && !timestamp.includes('Z') && !timestamp.match(/[+-]\d{2}:\d{2}$/)) {
      try { timestamp = new Date(timestamp).toISOString(); } catch { /* keep */ }
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

    switch (type) {
      case CONTENT_TYPES.MESSAGE:
        if (validate && !entryData.subject?.trim() && !entryData.body?.trim()) {
          ui.notifications.warn('NCM | Entry needs a subject or body.'); return null;
        }
        break;
      case CONTENT_TYPES.EDDIES:
        entryData.subject = data.eddiesTitle || 'Eddies Dead Drop';
        entryData.contentData = { amount: parseInt(data.eddiesAmount) || 0, claimed: false, claimedBy: null, claimedAt: null, note: data.eddiesNote || '', splitEnabled: false };
        if (validate && entryData.contentData.amount <= 0) { ui.notifications.warn('NCM | Eddies amount must be greater than 0.'); return null; }
        break;
      case CONTENT_TYPES.DOSSIER:
        entryData.subject = data.dossierTargetName || 'Unknown Subject';
        entryData.contentData = { targetName: data.dossierTargetName || 'Unknown', targetAlias: data.dossierAlias || '', targetImage: data.dossierPortrait || null, linkedActorId: data.dossierLinkedActor || null, classification: data.dossierClassification || '', sections: this._collectDossierSections(), stats: { threat: data.dossierThreat || '', affiliation: data.dossierAffiliation || '', lastKnownLocation: data.dossierLastKnown || '' } };
        break;
      case CONTENT_TYPES.PAYLOAD:
        entryData.subject = data.payloadName || 'Unknown Program';
        entryData.contentData = { payloadType: data.payloadType || 'custom', name: data.payloadName || 'UNKNOWN.exe', description: data.payloadDescription || '', effect: { type: data.payloadEffectType || 'custom', duration: (parseInt(data.payloadDuration) || 24) * 3600000 }, executed: false, executedBy: null, executedAt: null, disguised: !!data.payloadDisguised, disguiseType: data.payloadDisguiseType || 'message' };
        break;
      case CONTENT_TYPES.AVLOG:
        entryData.subject = data.avlogTitle || 'Recording';
        entryData.contentData = { mediaType: data.avlogMediaType || 'audio', mediaUrl: data.avlogMediaUrl || '', duration: data.avlogDuration || '00:00', source: data.avlogSource || '', transcript: this._collectTranscriptLines(), corrupted: false, corruptionLevel: 0 };
        break;
      case CONTENT_TYPES.LOCATION:
        entryData.subject = data.locationName || 'Unknown Location';
        entryData.contentData = { locationName: data.locationName || 'Unknown', locationImage: data.locationImage || null, coordinates: data.locationCoords || '', district: data.locationDistrict || '', description: data.locationDescription || '', linkedSceneId: data.locationSceneId || null, pinX: null, pinY: null };
        break;
      case CONTENT_TYPES.BANKING:
        entryData.subject = data.subject || data.bankAccountName || 'Account Ledger';
        entryData.contentData = this._collectBanking(data);
        break;
      case CONTENT_TYPES.CALENDAR: {
        entryData.subject = data.calTitle || 'Schedule';
        const events = this._collectList('calEvents', CAL_EVENT_FIELDS);
        entryData.contentData = { events, categories: this._calendarCategories(events) };
        if (validate && !events.length) { ui.notifications.warn('NCM | Add at least one event.'); return null; }
        break;
      }
      case CONTENT_TYPES.SYSLOG: {
        entryData.subject = data.syslogTitle || (data.syslogHost ? `${data.syslogHost} — access log` : 'System Log');
        const lines = this._collectList('syslogLines', SYSLOG_LINE_FIELDS);
        entryData.contentData = {
          host: data.syslogHost || '', path: data.syslogPath || '',
          showLineNumbers: !!data.syslogShowLineNumbers, showFilter: !!data.syslogShowFilter,
          scanlines: !!data.syslogScanlines, showPrompt: !!data.syslogShowPrompt,
          lines,
        };
        if (data.syslogPrompt) entryData.contentData.prompt = data.syslogPrompt;
        if (validate && !lines.length) { ui.notifications.warn('NCM | Add at least one log line.'); return null; }
        break;
      }
      case CONTENT_TYPES.CREDENTIALS: {
        entryData.subject = data.credTitle || 'Credential Vault';
        const entries = this._collectList('credEntries', CRED_ENTRY_FIELDS)
          .map(e => ({ ...e, strength: e.strength ? Number(e.strength) : undefined }));
        entryData.contentData = { autoReuse: !!data.credAutoReuse, entries };
        if (validate && !entries.length) { ui.notifications.warn('NCM | Add at least one credential.'); return null; }
        break;
      }
      case CONTENT_TYPES.SPREADSHEET: {
        entryData.subject = data.ssTitle || data.ssFormat || 'Spreadsheet';
        entryData.contentData = this._collectSpreadsheet(data);
        if (validate && !entryData.contentData.columns.some(c => c.label.trim())) {
          ui.notifications.warn('NCM | Give at least one column a label.'); return null;
        }
        break;
      }
    }
    return entryData;
  }

  /**
   * Build the calendar `categories` map ({ name: colorName }) from the collected
   * events — colors auto-cycle so the legend colors itself. Colors already
   * assigned in an edited entry are preserved; only new categories draw from
   * the cycle (skipping colors in use).
   */
  _calendarCategories(events) {
    const prior = this.editData?.contentData?.categories || {};
    const cats = {};
    const used = new Set();
    for (const ev of events) {
      const name = (ev.category || '').trim();
      if (!name || name in cats) continue;
      cats[name] = prior[name] || null;
      if (cats[name]) used.add(cats[name]);
    }
    let i = 0;
    for (const name of Object.keys(cats)) {
      if (cats[name]) continue;
      while (used.has(CAL_CATEGORY_CYCLE[i % CAL_CATEGORY_CYCLE.length]) && i < CAL_CATEGORY_CYCLE.length) i++;
      cats[name] = CAL_CATEGORY_CYCLE[i % CAL_CATEGORY_CYCLE.length];
      used.add(cats[name]); i++;
    }
    return cats;
  }

  /** Build banking contentData from the form (scalars + the txn rows). */
  _collectBanking(data) {
    const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isNaN(n) ? null : n; };
    const cd = {
      bankName: data.bankName || '', bankLogo: data.bankLogo || '', bankLocation: data.bankLocation || '',
      bankCode: data.bankCode || '', bankTagline: data.bankTagline || '',
      owner: data.bankOwner || '', accountName: data.bankAccountName || '', accountNumber: data.bankAccountNumber || '',
      accountType: data.bankAccountType || '', currency: data.bankCurrency || '€$',
      balance: num(data.bankBalance) ?? 0,
      transactions: this._collectList('bankTxns', BANK_TXN_FIELDS),
      allowSiphon: !!data.bankAllowSiphon,
    };
    const cleared = num(data.bankCleared); if (cleared != null) cd.cleared = cleared;
    const held = num(data.bankHeld); if (held != null) cd.held = held;
    if (cd.allowSiphon) {
      cd.siphonSkill = data.bankSiphonSkill || 'Interface';
      cd.siphonDV = num(data.bankSiphonDV) || 15;
      cd.siphonMode = data.bankSiphonMode || 'cap';
      if (cd.siphonMode === 'cap') cd.siphonCap = num(data.bankSiphonCap) || 0;
      if (cd.siphonMode === 'percent') cd.siphonPercent = num(data.bankSiphonPercent) || 25;
    }
    return cd;
  }

  /** Generic persist (create or edit) for a shard OR terminal target. */
  async _persistEntry(entryData) {
    const typeLabel = TYPE_PILLS.find(p => p.key === entryData.contentType)?.label ?? 'Entry';
    if (this.editData?.entryId) {
      const journal = this._journal();
      if (!journal) return { success: false, error: 'Journal not found' };
      const page = journal.pages.find(p => p.flags?.[MODULE_ID]?.messageId === this.editData.entryId);
      if (!page) return { success: false, error: 'Entry not found' };
      const updateData = { name: entryData.subject || page.name, 'text.content': entryData.body || '' };
      for (const [k, v] of Object.entries(entryData)) updateData[`flags.${MODULE_ID}.${k}`] = v;
      await page.update(updateData);
      return { success: true, label: typeLabel, edited: true };
    }
    let res;
    if (this._isTerminal) res = await this.terminalService?.addAccountMessage(this._item, this._target.accountId, entryData);
    else res = await this.dataShardService?.addMessage(this._item, entryData);
    return res?.success ? { success: true, label: typeLabel } : { success: false, error: res?.error || 'save failed' };
  }

  // ═══════════════════════════════════════════════════════════
  //  GENERIC REPEATABLE-ROW LIST ENGINE (bank txns · calendar events · log lines · credentials)
  // ═══════════════════════════════════════════════════════════

  /** Schema lookup for a list key. */
  _listFieldsFor(key) {
    return {
      bankTxns: BANK_TXN_FIELDS,
      calEvents: CAL_EVENT_FIELDS,
      syslogLines: SYSLOG_LINE_FIELDS,
      credEntries: CRED_ENTRY_FIELDS,
    }[key] || null;
  }

  static _onAddListRow(event, target) {
    const key = target.dataset.list;
    const fields = this._listFieldsFor(key);
    const container = this.element?.querySelector(`[data-list="${key}"]`);
    if (!container || !fields) return;
    container.insertAdjacentHTML('beforeend', this._rowHtml(key, container.children.length, fields, {}));
    this._renderPreview();
  }

  static _onRemoveListRow(event, target) {
    target.closest('.ncm-cl-row')?.remove();
    this._renderPreview();
  }

  /** Build one repeatable row's HTML from a field schema. */
  _rowHtml(key, idx, fields, row = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const cells = fields.map(fl => {
      if (fl.brk) return '<div class="ncm-cl-brk"></div>'; // wrap to a second line
      const name = `${key}__${fl.f}-${idx}`;
      let v = row?.[fl.f] ?? '';
      const style = fl.w ? ` style="flex:0 0 ${fl.w};max-width:${fl.w}"` : (fl.cls === 'flex' ? ' style="flex:1"' : '');
      if (fl.type === 'select') {
        const opts = fl.opts.map(o => `<option value="${esc(o)}"${String(v) === o ? ' selected' : ''}>${esc(o || '—')}</option>`).join('');
        return `<select name="${name}" class="ncm-config-input ncm-config-select"${style}>${opts}</select>`;
      }
      if (fl.type === 'checkbox') {
        return `<label class="ncm-cl-check"><input type="checkbox" name="${name}"${v ? ' checked' : ''}> ${esc(fl.lbl || fl.f)}</label>`;
      }
      if (fl.type === 'date' && v) v = String(v).slice(0, 10); // ISO → the yyyy-mm-dd a date input needs
      const t = (fl.type === 'number' || fl.type === 'date') ? fl.type : 'text';
      return `<input type="${t}" name="${name}" value="${esc(v)}" placeholder="${esc(fl.ph || '')}" class="ncm-config-input"${style}>`;
    }).join('');
    return `<div class="ncm-cl-row">${cells}<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" title="Remove"><i class="fas fa-times"></i></button></div>`;
  }

  /** Read a repeatable list back into an array of objects (empty rows dropped). */
  _collectList(key, fields) {
    const rows = [];
    const container = this.element?.querySelector(`[data-list="${key}"]`);
    if (!container) return rows;
    for (const rowEl of container.querySelectorAll('.ncm-cl-row')) {
      const obj = {}; let any = false;
      for (const fl of fields) {
        if (fl.brk) continue;
        const input = rowEl.querySelector(`[name^="${key}__${fl.f}-"]`);
        if (!input) continue;
        if (fl.type === 'checkbox') obj[fl.f] = !!input.checked;
        else if (fl.type === 'number') { const n = Number(input.value); obj[fl.f] = Number.isNaN(n) ? 0 : n; if (input.value !== '') any = true; }
        else if (fl.type === 'select') obj[fl.f] = input.value ?? ''; // a default select value isn't user content
        else { obj[fl.f] = input.value?.trim() || ''; if (obj[fl.f]) any = true; }
      }
      if (any) rows.push(obj);
    }
    return rows;
  }

  // ═══════════════════════════════════════════════════════════
  //  SPREADSHEET GRID EDITOR (click-cell + format toolbar)
  //  The grid is DOM-only state: cell formatting lives in data attributes on
  //  each <td> (+ mirror classes for live visuals), so add/remove row/col
  //  operations move formatting with the cells and _collectSpreadsheet just
  //  walks the table. Rebuilt from editData (or a 3×2 starter) each render.
  // ═══════════════════════════════════════════════════════════

  static SS_COL_TYPES = ['text', 'number', 'currency', 'date', 'status'];

  /** Build the editor grid into its [data-ss] container (edit pre-fill or starter). */
  _ssBuild(container) {
    const cd = (this.editData?.contentType === CONTENT_TYPES.SPREADSHEET && this.editData.contentData) || {};
    this._ssRender(container, cd);
  }

  /** Render the editor grid from a contentData-shaped dataset (also used by CSV import). */
  _ssRender(container, cd) {
    const columns = (cd.columns || []).map(c =>
      (c && typeof c === 'object') ? { label: c.label ?? '', type: c.type || 'text' } : { label: c ?? '', type: 'text' });
    if (!columns.length) columns.push({ label: '', type: 'text' }, { label: '', type: 'text' }, { label: '', type: 'text' });
    const rawRows = cd.rows?.length ? cd.rows : [[], []];
    const flagged = new Set((cd.flagged || []).map(([r, c]) => `${r}:${c}`));
    const redacted = new Set((cd.redacted || []).map(([r, c]) => `${r}:${c}`));
    const reasons = cd.flagReasons || {};

    const head = columns.map((col) => this._ssColHeadHtml(col)).join('');
    const body = rawRows.map((row, r) => this._ssRowHtml(columns.map((_, c) => {
      const raw = (row || [])[c];
      const cell = (raw && typeof raw === 'object') ? { ...raw } : { value: raw ?? '' };
      cell.flag = flagged.has(`${r}:${c}`);
      cell.redact = redacted.has(`${r}:${c}`);
      cell.reason = reasons[`${r}:${c}`] || cell.reason || '';
      return cell;
    }), r)).join('');

    container.innerHTML = `<table class="ncm-ss-table">
      <thead><tr><th class="ncm-ss-gut"></th>${head}<th class="ncm-ss-addc"><button type="button" data-action="ssAddCol" class="ncm-ss-mini" data-tooltip="Add column"><i class="fas fa-plus"></i></button></th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  /** One column-header cell (label input + type select + remove). */
  _ssColHeadHtml(col = { label: '', type: 'text' }) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const opts = DataShardComposer.SS_COL_TYPES.map(t =>
      `<option value="${t}"${col.type === t ? ' selected' : ''}>${t}</option>`).join('');
    return `<th class="ncm-ss-colh">
      <input type="text" value="${esc(col.label)}" placeholder="column" class="ncm-ss-collbl">
      <div class="ncm-ss-colops">
        <select class="ncm-ss-coltype">${opts}</select>
        <button type="button" data-action="ssRemoveCol" class="ncm-ss-mini" data-tooltip="Remove column"><i class="fas fa-times"></i></button>
      </div></th>`;
  }

  /** One editor row from cell descriptors { value, bold, color, bg, flag, redact, reason }. */
  _ssRowHtml(cells, r) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const tds = cells.map(cell => {
      const cls = ['ncm-ss-cell'];
      if (cell.bold) cls.push('is-bold');
      if (cell.color) cls.push(`ncm-ct-c--${cell.color}`);
      if (cell.bg) cls.push(`ncm-ct-bg--${cell.bg}`);
      if (cell.flag) cls.push('is-flag');
      if (cell.redact) cls.push('is-redact');
      const data = (cell.bold ? ' data-bold="1"' : '') +
        (cell.color ? ` data-color="${esc(cell.color)}"` : '') +
        (cell.bg ? ` data-bg="${esc(cell.bg)}"` : '') +
        (cell.flag ? ' data-flag="1"' : '') +
        (cell.redact ? ' data-redact="1"' : '') +
        (cell.reason ? ` data-reason="${esc(cell.reason)}"` : '');
      return `<td class="${cls.join(' ')}"${data}><input type="text" value="${esc(cell.value)}"></td>`;
    }).join('');
    return `<tr><td class="ncm-ss-gut">${r + 1}<button type="button" data-action="ssRemoveRow" class="ncm-ss-mini ncm-ss-rowdel" data-tooltip="Remove row"><i class="fas fa-times"></i></button></td>${tds}<td class="ncm-ss-addc"></td></tr>`;
  }

  /** The active (last-clicked) cell, or null. */
  _ssActiveTd() {
    return this.element?.querySelector('.ncm-ss-cell.is-active') || null;
  }

  static _onSsFormat(event, target) {
    const td = this._ssActiveTd();
    if (!td) { ui.notifications.warn('NCM | Click a cell first, then format it.'); return; }
    const toggle = (key, cls) => {
      if (td.dataset[key]) { delete td.dataset[key]; td.classList.remove(cls); }
      else { td.dataset[key] = '1'; td.classList.add(cls); }
    };
    switch (target.dataset.fmt) {
      case 'bold': toggle('bold', 'is-bold'); break;
      case 'redact': toggle('redact', 'is-redact'); break;
      case 'flag': {
        toggle('flag', 'is-flag');
        const reason = this.element?.querySelector('.ncm-ss-reason')?.value?.trim();
        if (td.dataset.flag && reason) td.dataset.reason = reason;
        else delete td.dataset.reason;
        break;
      }
      case 'clear': {
        for (const k of ['bold', 'color', 'bg', 'flag', 'redact', 'reason']) delete td.dataset[k];
        td.className = 'ncm-ss-cell is-active';
        break;
      }
    }
    this._renderPreview();
  }

  static _onSsColor(event, target) {
    const td = this._ssActiveTd();
    if (!td) { ui.notifications.warn('NCM | Click a cell first, then color it.'); return; }
    const kind = target.dataset.kind; // 'color' (text) | 'bg' (fill)
    const prefix = kind === 'bg' ? 'ncm-ct-bg--' : 'ncm-ct-c--';
    if (td.dataset[kind]) td.classList.remove(`${prefix}${td.dataset[kind]}`);
    const c = target.dataset.c;
    if (c) { td.dataset[kind] = c; td.classList.add(`${prefix}${c}`); }
    else delete td.dataset[kind];
    this._renderPreview();
  }

  static _onSsAddRow(event, target) {
    const table = this.element?.querySelector('.ncm-ss-table');
    if (!table) return;
    const cols = table.querySelectorAll('thead .ncm-ss-colh').length;
    const r = table.querySelectorAll('tbody tr').length;
    table.querySelector('tbody').insertAdjacentHTML('beforeend',
      this._ssRowHtml(Array.from({ length: cols }, () => ({ value: '' })), r));
    this._renderPreview();
  }

  static _onSsAddCol(event, target) {
    const table = this.element?.querySelector('.ncm-ss-table');
    if (!table) return;
    table.querySelector('thead .ncm-ss-addc')?.insertAdjacentHTML('beforebegin', this._ssColHeadHtml());
    table.querySelectorAll('tbody tr').forEach(tr => {
      tr.querySelector('.ncm-ss-addc')?.insertAdjacentHTML('beforebegin', '<td class="ncm-ss-cell"><input type="text" value=""></td>');
    });
    this._renderPreview();
  }

  static _onSsRemoveRow(event, target) {
    const table = target.closest('table');
    target.closest('tr')?.remove();
    table?.querySelectorAll('tbody .ncm-ss-gut').forEach((g, i) => { g.childNodes[0].nodeValue = String(i + 1); });
    this._renderPreview();
  }

  static _onSsRemoveCol(event, target) {
    const table = target.closest('table');
    const th = target.closest('th.ncm-ss-colh');
    if (!table || !th) return;
    const idx = [...table.querySelectorAll('thead .ncm-ss-colh')].indexOf(th);
    if (idx < 0) return;
    table.querySelectorAll('tbody tr').forEach(tr => tr.querySelectorAll('td.ncm-ss-cell')[idx]?.remove());
    th.remove();
    this._renderPreview();
  }

  // ─── CSV import ───

  /** Max rows an import will load into the editor DOM (warned, never silent). */
  static SS_IMPORT_ROW_CAP = 500;

  /** Pick a local .csv/.tsv file and load it into the grid (replaces it). */
  static _onSsImportCsv(event, target) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv,text/tab-separated-values';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { this._ssApplyCsv(String(reader.result || ''), file.name); }
        catch (err) { ui.notifications.error(`NCM | CSV import failed: ${err.message}`); }
      };
      reader.onerror = () => ui.notifications.error('NCM | Could not read the file.');
      reader.readAsText(file);
    });
    input.click();
  }

  /** Parse CSV text → grid, infer column types, rebuild the editor. */
  _ssApplyCsv(text, fileName) {
    const grid = this._parseCsv(text);
    if (!grid.length) { ui.notifications.warn('NCM | The file is empty.'); return; }

    const hasHeader = this.element?.querySelector('[name="ssCsvHeader"]')?.checked !== false;
    const width = Math.max(...grid.map(r => r.length));
    const pad = (r) => Array.from({ length: width }, (_, i) => String(r[i] ?? '').trim());
    let dataRows = (hasHeader ? grid.slice(1) : grid).map(pad);
    const cap = DataShardComposer.SS_IMPORT_ROW_CAP;
    if (dataRows.length > cap) {
      ui.notifications.warn(`NCM | ${dataRows.length} rows — keeping the first ${cap}.`);
      dataRows = dataRows.slice(0, cap);
    }
    const headerRow = hasHeader ? pad(grid[0]) : [];
    const columns = Array.from({ length: width }, (_, c) => ({
      label: hasHeader ? headerRow[c] : String.fromCharCode(65 + (c % 26)),
      type: this._inferColType(dataRows.map(r => r[c])),
    }));

    const container = this.element?.querySelector('[data-ss]');
    if (!container) return;
    this._ssRender(container, { columns, rows: dataRows });

    const fmt = this.element?.querySelector('[name="ssFormat"]');
    if (fmt && !fmt.value) fmt.value = fileName || '';
    ui.notifications.info(`NCM | Imported ${dataRows.length} row(s) × ${width} column(s).`);
    this._renderPreview();
  }

  /**
   * Minimal RFC-4180 CSV parser: quoted fields, escaped quotes (""), CRLF.
   * The delimiter (comma / semicolon / tab) is auto-detected from the first line.
   */
  _parseCsv(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const delim = [',', ';', '\t'].reduce((a, b) =>
      (firstLine.split(b).length > firstLine.split(a).length ? b : a));
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQ = false;
        } else field += ch;
      }
      else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (ch !== '\r') field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  /** Guess a column's type from its values (status > currency > number > text). */
  _inferColType(values) {
    const vals = values.map(v => String(v ?? '').trim()).filter(Boolean);
    if (!vals.length) return 'text';
    const STATUS_WORDS = new Set([
      'CLEARED', 'OK', 'ACTIVE', 'VALID', 'PAID', 'APPROVED', 'DONE',
      'HELD', 'PENDING', 'REVIEW', 'PROCESSING', 'WARNING',
      'DENIED', 'FAILED', 'BLOCKED', 'FLAGGED', 'REJECTED', 'OVERDUE',
    ]);
    if (vals.every(v => STATUS_WORDS.has(v.toUpperCase()))) return 'status';
    const curRe = /[€$£¥₿]|(?:^|\s)(?:eb|eddies)$/i;
    const stripped = vals.map(v => v.replace(/[€$£¥₿]/g, '').replace(/(?:^|\s)(?:eb|eddies)$/i, '').trim());
    if (stripped.every(v => /^[-+]?\d[\d,.\s]*%?$/.test(v))) {
      return vals.some(v => curRe.test(v)) ? 'currency' : 'number';
    }
    return 'text';
  }

  /** Walk the editor table into the authored spreadsheet contentData shape. */
  _collectSpreadsheet(data) {
    const table = this.element?.querySelector('.ncm-ss-table');
    const cd = { columns: [], rows: [] };
    if (data.ssFormat) cd.format = data.ssFormat;
    if (data.ssNote) cd.note = data.ssNote;
    if (!table) return cd;
    cd.columns = [...table.querySelectorAll('thead .ncm-ss-colh')].map(th => ({
      label: th.querySelector('.ncm-ss-collbl')?.value ?? '',
      type: th.querySelector('.ncm-ss-coltype')?.value || 'text',
    }));
    const flagged = [], redacted = [], flagReasons = {};
    table.querySelectorAll('tbody tr').forEach((tr, r) => {
      cd.rows.push([...tr.querySelectorAll('td.ncm-ss-cell')].map((td, c) => {
        if (td.dataset.flag) { flagged.push([r, c]); if (td.dataset.reason) flagReasons[`${r}:${c}`] = td.dataset.reason; }
        if (td.dataset.redact) redacted.push([r, c]);
        const cell = { value: td.querySelector('input')?.value ?? '' };
        if (td.dataset.bold) cell.bold = true;
        if (td.dataset.color) cell.color = td.dataset.color;
        if (td.dataset.bg) cell.bg = td.dataset.bg;
        return (cell.bold || cell.color || cell.bg) ? cell : cell.value;
      }));
    });
    if (flagged.length) cd.flagged = flagged;
    if (redacted.length) cd.redacted = redacted;
    if (Object.keys(flagReasons).length) cd.flagReasons = flagReasons;
    if (data.ssTotals) cd.totals = true;
    return cd;
  }

  /** Spreadsheet scalar pre-fill (edit mode). */
  _ssContext(cd) {
    return {
      format: cd.format || '', note: cd.note || '',
      totals: cd.totals === true || (Array.isArray(cd.totals) && cd.totals.length > 0),
    };
  }

  /** Banking scalar pre-fill for the template (edit mode). */
  _bankContext(cd) {
    return {
      bankName: cd.bankName || '', bankLogo: cd.bankLogo || '', bankLocation: cd.bankLocation || '',
      bankCode: cd.bankCode || '', bankTagline: cd.bankTagline || '',
      owner: cd.owner || cd.accountName || '', accountName: cd.accountName || '', accountNumber: cd.accountNumber || '',
      accountType: cd.accountType || '', currency: cd.currency || '€$',
      balance: cd.balance ?? '', cleared: cd.cleared ?? '', held: cd.held ?? '',
      allowSiphon: !!cd.allowSiphon, siphonSkill: cd.siphonSkill || 'Interface', siphonDV: cd.siphonDV ?? 15,
      siphonMode: cd.siphonMode || 'cap', siphonCap: cd.siphonCap ?? '', siphonPercent: cd.siphonPercent ?? 25,
    };
  }

  /** Syslog scalar pre-fill (edit mode); toggles default on for new entries. */
  _syslogContext(cd) {
    return {
      host: cd.host || '', path: cd.path || '', prompt: cd.prompt || '',
      showLineNumbers: cd.showLineNumbers !== false, showFilter: cd.showFilter !== false,
      scanlines: cd.scanlines !== false, showPrompt: cd.showPrompt !== false,
    };
  }

  /** Credentials scalar pre-fill (edit mode); auto-reuse defaults on. */
  _credsContext(cd) {
    return { autoReuse: cd.autoReuse !== false };
  }

  /** Render the live preview pane via the shared content-body partial. */
  async _renderPreview() {
    const pane = this.element?.querySelector('.ncm-composer-preview-body');
    if (!pane) return;
    try {
      const entryData = this._collectEntryData({ validate: false });
      if (!entryData) return;
      const enriched = enrichContent({
        id: 'preview', contentType: entryData.contentType, contentData: entryData.contentData,
        subject: entryData.subject, from: entryData.from, body: entryData.body, timestamp: entryData.timestamp,
      }, { isGM: true, interactive: false });
      const rt = foundry.applications?.handlebars?.renderTemplate || renderTemplate;
      pane.innerHTML = await rt(TEMPLATES.CONTENT_BODY, enriched);
    } catch (err) { /* preview is best-effort */ }
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

  /**
   * Browse for an audio/video file. Picks the FilePicker file type from the
   * sibling Media Type select so the dialog shows the right files.
   */
  static _onBrowseMedia(event, target) {
    const targetInput = target.dataset.target;
    if (!targetInput) return;
    const input = this.element?.querySelector(`[name="${targetInput}"]`);
    const mediaType = this.element?.querySelector('[name="avlogMediaType"]')?.value;
    const pickerType = mediaType === 'audio' ? 'audio' : 'video';
    new FilePicker({
      type: pickerType,
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
