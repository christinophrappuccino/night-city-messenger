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

import { MODULE_ID, DEFAULTS, CONTENT_TYPES, TEMPLATES, SKILL_MAP } from '../../utils/constants.js';
import { log, isGM, formatCyberDate, resolveMediaEmbed } from '../../utils/helpers.js';
import { BaseApplication } from '../BaseApplication.js';
import { CyberTimePicker } from '../components/CyberTimePicker.js';
import { enrichContent, openGalleryImage, CT_COLORS, RECORD_FIELD_KINDS, RECORD_DB_KINDS, SCHEM_MARKERS, schemMarkerInfo,
  FILE_DEFAULT_TYPES, suggestFilename, deriveFileSize, programEffectOptions } from '../content/ContentRenderers.js';
import { BUILTIN_EXAMPLES, getEntryTemplates, saveEntryTemplate, deleteEntryTemplate, exportEntryTemplates, importEntryTemplates } from '../content/EntryTemplates.js';

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
  { key: CONTENT_TYPES.GALLERY,  icon: 'fas fa-images',         label: 'Gallery' },
  { key: CONTENT_TYPES.DOCUMENT, icon: 'fas fa-file-lines',     label: 'Document' },
  { key: CONTENT_TYPES.CHATLOG,  icon: 'fas fa-comments',       label: 'Chat Log' },
  { key: CONTENT_TYPES.RECORD,   icon: 'fas fa-database',       label: 'Records' },
  { key: CONTENT_TYPES.SCHEMATIC, icon: 'fas fa-compass-drafting', label: 'Schematic' },
  { key: CONTENT_TYPES.NOTE,     icon: 'fas fa-note-sticky',    label: 'Note' },
  { key: CONTENT_TYPES.MALWARE,  icon: 'fas fa-biohazard',      label: 'Malware' },
];

/** CPR stat keys offered as combat-profile toggles (dossier redesign). */
const DOSS_PROFILE_STATS = ['int', 'ref', 'dex', 'tech', 'cool', 'will', 'luck', 'move', 'body', 'emp'];

/**
 * Plain-language intro per content type (design doc §12b — every control is
 * self-explanatory). `what` = what the file IS; `how` = the authoring walkthrough.
 * Written from the GM's side of the screen.
 */
const TYPE_INTROS = {
  [CONTENT_TYPES.MESSAGE]:  { what: 'A plain message, like an email.', how: 'Fill in the sender, subject, and body.' },
  [CONTENT_TYPES.EDDIES]:   { what: 'An eddies dead-drop. Whoever opens it can claim the money into their character’s wealth.', how: 'Set the amount and an optional note.' },
  [CONTENT_TYPES.DOSSIER]:  { what: 'A target file on a person — portrait, threat meter, live combat profile, write-up sections.', how: 'Type on the card (the portrait tile IS the file picker; the classification stamps itself). Click the threat meter, link a world actor to power the COMBAT PROFILE (its stats read live from the sheet), and toggle REDACT on a section to black it out. “Identity masked” hides the face + name until players decrypt it.' },
  [CONTENT_TYPES.PAYLOAD]:  { what: 'A program or virus the player can execute from the file.', how: 'Name it and describe what running it does.' },
  [CONTENT_TYPES.AVLOG]:    { what: 'An audio or video recording with a transcript feed.', how: 'Paste a media link (the player previews right here, type auto-detected) — or leave it blank with a Duration set and players get a ▶ that plays the transcript out line by line. Type lines in the bar below; Enter adds the next, chips pick the speaker.' },
  [CONTENT_TYPES.LOCATION]: { what: 'An intel postcard for a place — image, district, control, security, practical intel.', how: 'Type on the postcard (BROWSE sets the backdrop, 🎲 rolls flavor coordinates). Everything in the Intel box is optional — controlled-by, the security meter, a HEAT chip, hours/access/approach/contact. “Encrypted pin” seals the image + coordinates + intel behind a decrypt roll (the reveal plays an animation); “Pick a scene” gives the GM a Go-to-Scene button.' },
  [CONTENT_TYPES.BANKING]:  { what: 'A bank account record — balance, transactions, and the bank’s identity.', how: 'Set the bank + account, add transactions (newest first). Optionally let players siphon funds with a security roll.' },
  [CONTENT_TYPES.SPREADSHEET]: { what: 'A data table — like a leaked finance sheet.', how: 'Define your columns, add rows, then click any cell to format it (bold, color, flag, or redact). Turn on Σ to total a number column. Or import a .csv and edit from there.' },
  [CONTENT_TYPES.CALENDAR]: { what: 'A schedule of events — meetings, handoffs, deadlines. Players get a timeline AND a month grid.', how: 'One When picker sets date + time. Make categories up top (click a swatch to recolor), tap a chip on each event to file it. Lock an event and players must decrypt it to read what it is. CSV import/export for big schedules.' },
  [CONTENT_TYPES.SYSLOG]:   { what: 'A console / access log — who did what, and when.', how: 'Add lines, each with a severity (info/ok/warn/err). Tick “mark” to spotlight the key one.' },
  [CONTENT_TYPES.CREDENTIALS]: { what: 'A recovered password vault — logins the player can use to pivot.', how: 'Add host / username / password rows. A password reused across hosts auto-flags REUSED.' },
  [CONTENT_TYPES.GALLERY]:  { what: 'A photo dump — cam exports, surveillance stills, evidence shots. Players click a thumbnail to enlarge it. Switch it to FEED and the same frames become a live camera wall.', how: 'Add images (browse or paste a path). Tick “flag” to mark the important one, “dead” for an unrecoverable frame.' },
  [CONTENT_TYPES.DOCUMENT]: { what: 'A written document — a memo, report, or contract, with a classification stamp and optional watermark.', how: 'Fill the letterhead fields, then add paragraphs. A “heading” starts a section; tick “redacted” to black a paragraph out.' },
  [CONTENT_TYPES.CHATLOG]:  { what: 'A recovered chat transcript — texts rendered as message bubbles.', how: 'Add messages with sender + text. Name one sender as “this device’s owner” to put their bubbles on the right. Colors assign themselves.' },
  [CONTENT_TYPES.RECORD]:   { what: 'A searchable database — personnel files, patient lists, asset registries. Players type into the search box to look someone up.', how: 'Name the database, then add records (name, role, org, address, status). Tick “flag” on the one worth finding.' },
  [CONTENT_TYPES.SCHEMATIC]: { what: 'An annotated floorplan or blueprint — heist intel. Typed markers (entry, guard, camera, objective…) sit on the image; hover shows the label, and routes trace an infil path.', how: 'Pick the image, then choose a marker from the palette and click the plan to drop it. Click a pin to edit it, drag to move. Route mode links two pins. A marker can carry its own scene link and be Locked (players roll to scout it).' },
  [CONTENT_TYPES.NOTE]:     { what: 'A sticky note — a scrawled password, a diary line, a to-do. Sometimes the whole solution.', how: 'Write the text, pick a paper color. That’s it — notes are supposed to be simple.' },
  [CONTENT_TYPES.MALWARE]:  { what: 'A quarantined program the player can DEPLOY — what it does is up to you at the table. The honeypot variant is a decoy: deploying it fires a trace instead.', how: 'Name the file, set its type and threat meter. “Deployable” shows the DEPLOY button; “honeypot” makes it a trap (players can’t tell — the tag is GM-only).' },
};

/**
 * Type-picker groups (the "Change type" dropdown) — the 18-pill wall was the
 * single biggest source of composer clutter; grouped, it reads as a catalog.
 */
const TYPE_GROUPS = [
  { label: 'COMMS & RECORDS', keys: [CONTENT_TYPES.MESSAGE, CONTENT_TYPES.CHATLOG, CONTENT_TYPES.RECORD, CONTENT_TYPES.DOCUMENT, CONTENT_TYPES.NOTE] },
  { label: 'DATA & FINANCE', keys: [CONTENT_TYPES.SPREADSHEET, CONTENT_TYPES.BANKING, CONTENT_TYPES.EDDIES, CONTENT_TYPES.CALENDAR, CONTENT_TYPES.SYSLOG, CONTENT_TYPES.CREDENTIALS] },
  { label: 'MEDIA & INTEL', keys: [CONTENT_TYPES.GALLERY, CONTENT_TYPES.AVLOG, CONTENT_TYPES.DOSSIER, CONTENT_TYPES.SCHEMATIC, CONTENT_TYPES.LOCATION] },
  { label: 'HAZARDS', keys: [CONTENT_TYPES.MALWARE, CONTENT_TYPES.PAYLOAD] },
];

/** Banking transaction repeatable-row field schema (the shared list engine).
 *  `lbl` renders as a tiny label above each cell (placeholder-only fields were
 *  the layperson's #1 confusion); `dl` points an input at a <datalist>. */
const BANK_TXN_FIELDS = [
  { f: 'date', ph: '03/12', lbl: 'Date', w: '70px' },
  { f: 'desc', ph: 'what the money was for', lbl: 'Description', cls: 'flex' },
  { f: 'amount', type: 'number', ph: '1250', lbl: 'Amount', w: '90px' },
  { f: 'type', type: 'select', opts: ['debit', 'credit'], lbl: 'In / out', w: '78px' },
  { f: 'category', ph: 'salary, rent…', lbl: 'Category', w: '92px' },
  { f: 'pending', type: 'checkbox', lbl: 'pending' },
];

/** Syslog line rows — msg gets its own line so it isn't squeezed out. */
const SYSLOG_LINE_FIELDS = [
  { f: 'ts', ph: '04:12:09', lbl: 'Time', w: '88px' },
  { f: 'sev', type: 'select', opts: ['info', 'ok', 'warn', 'err', 'debug'], lbl: 'Severity', w: '74px' },
  { f: 'actor', ph: 'who / what process', lbl: 'User / proc', cls: 'flex' },
  { brk: true },
  { f: 'msg', ph: 'what the log line says', lbl: 'Log message', cls: 'flex' },
  { f: 'mark', type: 'checkbox', lbl: 'mark (spotlight)' },
];

/** Payload run-log lines (WYSIWYG console editor). */
const PL_OUTPUT_FIELDS = [
  { f: 'sev', type: 'select', opts: ['info', 'ok', 'warn', 'err', 'debug'], lbl: 'Severity', w: '74px' },
  { f: 'text', ph: 'console output line…', lbl: 'Output', cls: 'flex' },
];
/** Payload authored prerequisites (generic list). */
const PL_REQ_FIELDS = [
  { f: 'kind', type: 'select', opts: ['note', 'uplink', 'admin'], lbl: 'Kind', w: '92px' },
  { f: 'label', ph: 'e.g. must be jacked into ARASAKANET', lbl: 'Requirement', cls: 'flex' },
];

/** Credential vault rows. */
const CRED_ENTRY_FIELDS = [
  { f: 'host', ph: 'arasaka-mainframe.corp', lbl: 'Host / system', cls: 'flex' },
  { f: 'user', ph: 'jsmith', lbl: 'Username', w: '118px' },
  { f: 'secret', ph: 'hunter2', lbl: 'Password / key', w: '128px' },
  { brk: true },
  { f: 'note', ph: 'note (optional)', lbl: 'Note', cls: 'flex' },
  { f: 'strength', type: 'select', opts: ['', '1', '2', '3', '4'], lbl: 'Strength', w: '64px' },
  { f: 'encrypted', type: 'checkbox', lbl: 'locked (crack to reveal)' },
];

/** Gallery image rows — the contact-sheet card builder (_galCardHtml) renders
 *  these; the schema is the SAVE CONTRACT (_collectList + template prefill).
 *  looped/cut/loopedTime are table state written by runCamAction — carried
 *  through an edit so re-saving a feed doesn't reset a heist in progress. */
const GAL_IMG_FIELDS = [
  { f: 'url', type: 'image', ph: 'image path / URL', lbl: 'Image (thumbnail previews as you pick)', cls: 'flex' },
  { brk: true },
  { f: 'label', ph: 'blank = IMG_001', lbl: 'Label', w: '128px' },
  { f: 'time', ph: '04:12', lbl: 'Time', w: '64px' },
  { f: 'caption', ph: 'caption (optional)', lbl: 'Caption', cls: 'flex' },
  { f: 'flagged', type: 'checkbox', lbl: 'flag' },
  { f: 'corrupted', type: 'checkbox', lbl: 'dead' },
  { f: 'locked', type: 'checkbox', lbl: 'lock' },
  { f: 'unlockDV', ph: '15', lbl: 'DV', w: '48px' }, // per-frame override (blank = vault DV)
  // Feed-mode extras (LIVE FEED cards show these; stills ignore them).
  { f: 'ptz', type: 'checkbox', lbl: 'PTZ (steerable)' },
  { f: 'controlDV', ph: '—', lbl: 'Ctl DV', w: '48px' },  // TAKE CONTROL gate (blank = free)
  { f: 'loopDV', ph: '—', lbl: 'Loop DV', w: '48px' },    // blank = LOOP off
  { f: 'cutDV', ph: '—', lbl: 'Cut DV', w: '48px' },      // blank = CUT off
  { f: 'sceneId', ph: '', lbl: 'Scene', w: '0' },         // hidden; set via the scene-picker chip
  { f: 'looped', type: 'checkbox', lbl: 'looped (table state)' },
  { f: 'cut', type: 'checkbox', lbl: 'cut (table state)' },
  { f: 'loopedTime', ph: '', lbl: 'Looped at', w: '0' },  // hidden; the stale-clock stamp
];

/** Document paragraph rows — heading starts a section, text is the body. */
/** Chat message rows — sender autocompletes from names already used. */
// Chat is custom-collected (_collectChat) — bubbles store state in data-attrs.
// CHAT_MSG_FIELDS only feeds the injection listSpec (the builder ignores it).
const CHAT_MSG_FIELDS = [{ f: 'text', lbl: 'Message', cls: 'flex' }];

/** Curated emoji palette for the chat composer (native OS emoji — no assets). */
const CHAT_EMOJI = {
  Frequent: ['😂', '❤️', '👍', '🔥', '👀', '💀', '😅', '🙏', '😎', '💯', '😭', '🤔', '👎', '😱', '🥶', '🤝'],
  'Night City': ['🔫', '💊', '💉', '🤖', '⚡', '💾', '📡', '🩸', '🎭', '🚗', '💣', '🕶️', '📟', '🧠', '⛓️', '☠️'],
};

/** Text colors for the rich-text body editor (message). */
const RTE_COLORS = ['#F65261', '#f7c948', '#00ff41', '#19f3f7', '#a855f7', '#ff6ac1', '#5b9bff', '#ededf2', '#7a7a92'];

/** System-message quick presets (fill an editable notice + its icon). */
const CHAT_SYS_PRESETS = [
  { label: 'Custom notice…', text: '', icon: 'circle-info' },
  { label: 'Added to group', text: 'NAME added NAME to the group', icon: 'user-plus' },
  { label: 'Left the group', text: 'NAME left the group', icon: 'user-minus' },
  { label: 'Missed call', text: 'Missed call · NAME', icon: 'phone-slash' },
  { label: 'Call ended', text: 'Call ended · 04:12', icon: 'phone' },
  { label: 'Joined', text: 'NAME joined', icon: 'right-to-bracket' },
  { label: 'Message unsent', text: 'A message was unsent', icon: 'ban' },
];

/** Database record rows — status autocompletes from common status words. */
/** Schematic annotation-pin rows — x/y are percent from the top-left.
 *  (Laypeople never type these — clicking the floorplan stage fills them.) */

/** Colors cycled onto calendar categories at save (order = visual variety). */
const CAL_CATEGORY_CYCLE = ['cyan', 'gold', 'purple', 'green', 'pink', 'red', 'amber', 'blue'];

/** Month glyphs for the calendar card's live date block (mirrors the renderer). */
const CAL_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export class DataShardComposer extends BaseApplication {

  shardItem = null;
  onSave = null;

  /** Target descriptor — { kind:'shard'|'terminal', item, accountId? }. */
  _target = null;

  /** Currently selected content type */
  _selectedType = CONTENT_TYPES.MESSAGE;

  /** ①②③ section collapse state (content open, the rest chip-summarized). */
  _secOpen = { content: true, delivery: false, security: false };
  _secAutoDone = false;

  /** Spreadsheet focus mode — hides the preview + non-content sections. */
  _cmpFocus = false;


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
    position: { width: 920, height: 640 },
    actions: {
      saveEntry: DataShardComposer._onSaveEntry,
      cancel: DataShardComposer._onCancel,
      selectContentType: DataShardComposer._onSelectContentType,
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
      browseListImage: DataShardComposer._onBrowseListImage,
      addEntryNetworkTag: DataShardComposer._onAddEntryNetworkTag,
      removeEntryNetworkTag: DataShardComposer._onRemoveEntryNetworkTag,
      openTimePicker: DataShardComposer._onOpenTimePicker,
      loadExample: DataShardComposer._onLoadExample,
      tplLoad: DataShardComposer._onTplLoad,
      tplSave: DataShardComposer._onTplSave,
      tplDelete: DataShardComposer._onTplDelete,
      tplImport: DataShardComposer._onTplImport,
      tplExport: DataShardComposer._onTplExport,
      chatSend: DataShardComposer._onChatSend,
      chatEditMsg: DataShardComposer._onChatEditMsg,
      chatTombstone: DataShardComposer._onChatTombstone,
      rteCmd: DataShardComposer._onRteCmd,
      rteLink: DataShardComposer._onRteLink,
      rteColor: DataShardComposer._onRteColor,
      rteColorPick: DataShardComposer._onRteColorPick,
      rteEmoji: DataShardComposer._onRteEmoji,
      rteEmojiPick: DataShardComposer._onRteEmojiPick,
      rteRaw: DataShardComposer._onRteRaw,
      docAddPara: DataShardComposer._onDocAddPara,
      docAddList: DataShardComposer._onDocAddList,
      docAddFigure: DataShardComposer._onDocAddFigure,
      docBrowseFigure: DataShardComposer._onDocBrowseFigure,
      bankSyncBalance: DataShardComposer._onBankSyncBalance,
      docFmt: DataShardComposer._onDocFmt,
      docToggleQuote: DataShardComposer._onDocToggleQuote,
      docToggleRedact: DataShardComposer._onDocToggleRedact,
      docToggleOrdered: DataShardComposer._onDocToggleOrdered,
      chatType: DataShardComposer._onChatType,
      chatNewSender: DataShardComposer._onChatNewSender,
      chatPickSender: DataShardComposer._onChatPickSender,
      chatSetOwner: DataShardComposer._onChatSetOwner,
      chatEmoji: DataShardComposer._onChatEmoji,
      chatEmojiPick: DataShardComposer._onChatEmojiPick,
      chatReactAdd: DataShardComposer._onChatReactAdd,
      chatSeen: DataShardComposer._onChatSeen,
      chatBrowsePhoto: DataShardComposer._onChatBrowsePhoto,
      envSeg: DataShardComposer._onEnvSeg,
      exfState: DataShardComposer._onExfState,
      exfMode: DataShardComposer._onExfMode,
      galSeg: DataShardComposer._onGalSeg,
      galCardThumb: DataShardComposer._onGalCardThumb,
      galScene: DataShardComposer._onGalScene,
      galImportFolder: DataShardComposer._onGalImportFolder,
      wzCheck: DataShardComposer._onWzCheck,
      wzCycle: DataShardComposer._onWzCycle,
      wzReveal: DataShardComposer._onWzReveal,
      wzPip: DataShardComposer._onWzPip,
      recKind: DataShardComposer._onRecKind,
      recAddSubject: DataShardComposer._onRecAddSubject,
      recRemoveSubject: DataShardComposer._onRecRemoveSubject,
      recToggleCard: DataShardComposer._onRecToggleCard,
      recDuplicate: DataShardComposer._onRecDuplicate,
      recExportCsv: DataShardComposer._onRecExportCsv,
      recImportCsv: DataShardComposer._onRecImportCsv,
      recAddField: DataShardComposer._onRecAddField,
      recRemoveField: DataShardComposer._onRecRemoveField,
      recStatusCycle: DataShardComposer._onRecStatusCycle,
      recFlag: DataShardComposer._onRecFlag,
      recPip: DataShardComposer._onRecPip,
      recFlagField: DataShardComposer._onRecFlagField,
      recPortrait: DataShardComposer._onRecPortrait,
      calAddEvent: DataShardComposer._onCalAddEvent,
      calRemove: DataShardComposer._onCalRemove,
      calWhen: DataShardComposer._onCalWhen,
      calPickCat: DataShardComposer._onCalPickCat,
      calLock: DataShardComposer._onCalLock,
      calScene: DataShardComposer._onCalScene,
      calToggleCard: DataShardComposer._onCalToggleCard,
      calDuplicate: DataShardComposer._onCalDuplicate,
      calDefView: DataShardComposer._onCalDefView,
      calCatAdd: DataShardComposer._onCalCatAdd,
      calCatColor: DataShardComposer._onCalCatColor,
      calCatRemove: DataShardComposer._onCalCatRemove,
      calExportCsv: DataShardComposer._onCalExportCsv,
      calImportCsv: DataShardComposer._onCalImportCsv,
      dossPortrait: DataShardComposer._onDossPortrait,
      dossThreat: DataShardComposer._onDossThreat,
      dossRedact: DataShardComposer._onDossRedact,
      dossStatChip: DataShardComposer._onDossStatChip,
      dossSkillAdd: DataShardComposer._onDossSkillAdd,
      dossSkillDel: DataShardComposer._onDossSkillDel,
      avAddLine: DataShardComposer._onAvAddLine,
      avEditLine: DataShardComposer._onAvEditLine,
      avPickSpeaker: DataShardComposer._onAvPickSpeaker,
      locBrowse: DataShardComposer._onLocBrowse,
      locDice: DataShardComposer._onLocDice,
      locScene: DataShardComposer._onLocScene,
      locSec: DataShardComposer._onLocSec,
      cmpToggleSec: DataShardComposer._onCmpToggleSec,
      cmpTogglePicker: DataShardComposer._onCmpTogglePicker,
      cmpToggleTpl: DataShardComposer._onCmpToggleTpl,
      cmpToggleHow: DataShardComposer._onCmpToggleHow,
      cmpFocusMode: DataShardComposer._onCmpFocusMode,
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
    // entryId-keyed: a loaded template/example prefills editData WITHOUT an
    // entryId, so it still reads (and saves) as a new entry.
    const verb = this.editData?.entryId ? 'Edit Entry' : 'Add Entry';
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

    // Editing an entry that USES security features → auto-open ③ once (the
    // guard keeps re-renders from fighting a user who re-collapsed it).
    if (!this._secAutoDone) {
      this._secAutoDone = true;
      if (this.editData && (this.editData.encrypted || this.editData.networkVisibility?.restricted)) {
        this._secOpen.security = true;
      }
    }

    // Actors list for dossier linking
    const actorOptions = (game.actors ?? [])
      .filter(a => a.type === 'character' || a.type === 'npc' || a.type === 'mook')
      .map(a => ({ id: a.id, name: a.name }));

    return {
      hasItem: true,
      shardName: this._item.name,
      isTerminalTarget: this._isTerminal,
      // Pinned type bar + grouped picker + section collapse state.
      currentType: TYPE_PILLS.find(p => p.key === type) || TYPE_PILLS[0],
      typeGroups: TYPE_GROUPS.map(g => ({
        label: g.label,
        pills: g.keys.map(k => typePills.find(p => p.key === k)).filter(Boolean),
      })),
      secOpen: this._secOpen,
      // Terminal mailbox folders — ALL of them (Inbox, customs, Saved, Trash;
      // location semantics). Selected = the entry's current location
      // (Trash > Saved > custom folder > Inbox).
      targetFolders: this._isTerminal
        ? (() => {
            const defs = game.nightcity?.terminalService?.getFolders?.(this._item) || [];
            const st = this.editData?.status || {};
            const loc = st.deleted ? 'trash'
              : st.saved ? 'saved'
              : (defs.some(f => f.kind === 'custom' && f.id === this.editData?.folder) ? this.editData.folder : 'inbox');
            const all = [...defs];
            if (!all.some(f => f.id === 'saved')) all.push({ id: 'saved', name: 'Saved' });
            if (!all.some(f => f.id === 'trash')) all.push({ id: 'trash', name: 'Trash' });
            return all.map(f => ({ id: f.id, name: f.name, selected: loc === f.id }));
          })()
        : [],
      selectedType: type,
      typeIntro: TYPE_INTROS[type] || null,

      // Edit mode (entryId-keyed — a loaded template has editData but no id)
      isEditing: !!this.editData?.entryId,
      editEntryId: this.editData?.entryId || '',

      // Templates & examples
      hasExample: !!BUILTIN_EXAMPLES[type],
      savedTemplates: getEntryTemplates().map(t => ({
        id: t.id, name: t.name,
        typeLabel: TYPE_PILLS.find(p => p.key === t.type)?.label ?? t.type,
      })),

      // From ↔ GM Master List: datalist suggestions (every directory email).
      masterEmails: (game.nightcity?.masterContactService?.getAll() ?? [])
        .filter(c => c.email)
        .map(c => ({ email: c.email, name: c.name }))
        .sort((a, b) => a.email.localeCompare(b.email)),

      // Pre-filled values (from edit data or empty)
      editFrom: this.editData?.from || '',
      editSubject: this.editData?.subject || '',
      editBody: this.editData?.body || '',
      editTimestamp: this.editData?.timestamp || '',
      editTimestampFormatted: this.editData?.timestamp ? formatCyberDate(this.editData.timestamp) : '',
      editContentData: this.editData?.contentData ?? {},
      editEncrypted: this.editData?.encrypted ?? false,
      editNetworkRestricted: this.editData?.networkVisibility?.restricted ?? false,

      // Uploadable (design §4) — a program a runner can push onto a terminal.
      editUploadable: this.editData?.contentData?.uploadable ?? false,
      uploadDV: this.editData?.contentData?.uploadDV ?? 15,
      uploadStealthDV: this.editData?.contentData?.uploadStealthDV ?? '',
      editUploadTraceOnFail: this.editData?.contentData?.uploadTraceOnFail ?? false,
      uploadSkillOptions: this._skillOptions(this.editData?.contentData?.uploadSkill || 'Interface'),
      // EXECUTE authoring (thread #6) — a malware/payload entry can push a resident
      // VERB (keylog/backdoor/Black-ICE) instead of planting the file. Only these
      // types offer it; everything else uploads as a PLANT of the file itself.
      isExecuteProgram: type === CONTENT_TYPES.MALWARE || type === CONTENT_TYPES.PAYLOAD,
      // From the ONE catalog: an uploaded program leaves a resident behind, so only
      // 'triggered' verbs qualify. `plant` is excluded because planting the file
      // itself IS the blank default. `logicBomb` is excluded until there's a way to
      // author its inner effect — offered now it would upload and then no-op
      // ("logic bomb had no payload"), which is worse than not offering it.
      uploadEffectOptions: [
        { value: '', label: '— plant this file (default) —' },
        ...programEffectOptions({ mode: 'triggered', host: 'terminal', exclude: ['plant', 'adjudicate', 'logicBomb'] })
          .map(e => ({ value: e.key, label: `${e.label} — ${e.blurb}` })),
      ].map(o => ({ ...o, selected: (this.editData?.contentData?.uploadEffect || '') === o.value })),

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
      isGallery: type === CONTENT_TYPES.GALLERY,
      isDocument: type === CONTENT_TYPES.DOCUMENT,
      isChatlog: type === CONTENT_TYPES.CHATLOG,
      isRecord: type === CONTENT_TYPES.RECORD,
      isSchematic: type === CONTENT_TYPES.SCHEMATIC,
      isNote: type === CONTENT_TYPES.NOTE,
      isMalware: type === CONTENT_TYPES.MALWARE,

      // Envelope (#37) — mail vs file, + the per-entry exfil override grid.
      env: this._envContext(),
      exfil: this._exfilOverrideContext(),

      // Scalar edit pre-fills (repeatable rows are injected in _onRender from
      // editContentData so each row schema stays in one place).
      bank: this._bankContext(this.editData?.contentData ?? {}),
      cal: this._calContext(this.editData?.contentData ?? {}),
      doss: this._dossContext(this.editData?.contentData ?? {}),
      av: this._avContext(this.editData?.contentData ?? {}),
      loc: this._locContext(this.editData?.contentData ?? {}),
      dossierDecl: this._declassCtx(this.editData?.contentData ?? {}),
      avlogUnlock: (() => {
        const cd = this.editData?.contentData ?? {};
        return {
          locked: !!cd.locked,
          skills: this._skillOptions(cd.unlockSkill || 'Interface'),
          dv: cd.unlockDV ?? 15,
          trace: !!cd.traceOnFail,
        };
      })(),
      syslog: this._syslogContext(this.editData?.contentData ?? {}),
      creds: this._credsContext(this.editData?.contentData ?? {}),
      gal: this._galContext(this.editData?.contentData ?? {}),
      doc: this._docContext(this.editData?.contentData ?? {}),
      chat: this._chatContext(this.editData?.contentData ?? {}),
      rec: this._recContext(this.editData?.contentData ?? {}),
      schem: this._schemContext(this.editData?.contentData ?? {}),
      noteData: this._noteContext(this.editData?.contentData ?? {}),
      mal: this._malContext(this.editData?.contentData ?? {}),
      pl: this._plContext(this.editData?.contentData ?? {}),
      ss: this._ssContext(this.editData?.contentData ?? {}),
      ssColors: CT_COLORS,

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

    // ─── Program authoring is consolidated into the Malware Workshop ───
    // Payload/Malware entries are authored there (nicer UI + program library),
    // not in the composer's inline fieldsets. Redirect on render (covers both
    // picking the type here AND opening to edit an existing program entry).
    if (!this._redirecting
      && (this._selectedType === CONTENT_TYPES.PAYLOAD || this._selectedType === CONTENT_TYPES.MALWARE)
      && typeof game.nightcity?.openMalwareWorkshop === 'function') {
      this._redirecting = true;
      this._redirectToWorkshop();
      return;
    }

    // ─── Live preview + summary chips + interactive helpers: re-render on any
    //     input/change (debounced) ───
    const form = el.querySelector('form');
    if (form) {
      const deb = foundry.utils.debounce(() => {
        this._renderPreview();
        this._syncCmpChips();
        this._syncChatSenderChips();
      }, 180);
      form.addEventListener('input', deb);
      form.addEventListener('change', deb);
      // Instant (non-debounced) WYSIWYG echoes while typing/browsing:
      // gallery thumbnails, record initials avatars.
      form.addEventListener('input', (e) => {
        const host = e.target?.closest?.('.ncm-cl-cell--image, .ncm-galcard');
        if (host && /__url-/.test(e.target.name || '')) {
          const img = host.querySelector('.ncm-cl-thumb');
          if (img) {
            const v = e.target.value.trim();
            img.src = v;
            img.style.display = v ? '' : 'none';
          }
          const empty = host.querySelector('.ncm-galcard__empty');
          if (empty) empty.style.display = e.target.value.trim() ? 'none' : '';
        }
        const rec = e.target?.closest?.('.ncm-reccard');
        if (rec && /__name-/.test(e.target.name || '')) {
          const av = rec.querySelector('.ncm-reccard__av');
          if (av) av.textContent = (e.target.value || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
        }
      });
      // Syslog / payload run-log: Enter in a line input appends the next line.
      form.addEventListener('keydown', (e) => {
        const n = e.target?.name || '';
        let list = null;
        if (/^syslogLines__msg-/.test(n)) list = 'syslogLines';
        else if (/^plOutput__text-/.test(n)) list = 'plOutput';
        if (!list) return;
        e.preventDefault();
        el.querySelector(`[data-action="addListRow"][data-list="${list}"]`)?.click();
      });
      // Note: paper color select repaints the sticky-note editor live.
      el.querySelector('[name="noteColor"]')?.addEventListener('change', (e) => {
        el.querySelector('.ncm-notepaper')?.setAttribute('data-paper', e.target.value || 'gold');
      });
    }
    this._syncCmpChips();

    // ─── Entry Header: live From ↔ Master List status chip ───
    this._wireFromStatus(el);

    // Uploadable toggle — show/hide the forge fields via a wrapper class ([hidden]
    // loses to the .ncm-fg display rule, so we don't use it).
    el.querySelector('[data-cmp-upl-toggle]')?.addEventListener('change', (e) => {
      e.target.closest('[data-cmp-upl]')?.classList.toggle('is-on', e.target.checked);
    });
    // Envelope (#37): stamp the dual-purpose labels for the current envelope
    // ("Timestamp" for mail, "Modified" for a file) — the template ships both
    // halves as "Timestamp|Modified" and this picks one without a re-render.
    this._syncEnvLabels(el.querySelector('[name="envelope"]')?.value || 'mail');

    // ─── Repeatable rows: inject edit pre-fill, else seed one blank row ───
    const cd0 = (this.editData?.contentType === this._selectedType) ? (this.editData.contentData ?? {}) : {};
    const listSpecs = {
      [CONTENT_TYPES.BANKING]:     [{ key: 'bankTxns',    fields: BANK_TXN_FIELDS,    rows: cd0.transactions }],
      [CONTENT_TYPES.SYSLOG]:      [{ key: 'syslogLines', fields: SYSLOG_LINE_FIELDS, rows: cd0.lines }],
      [CONTENT_TYPES.CREDENTIALS]: [{ key: 'credEntries', fields: CRED_ENTRY_FIELDS,  rows: cd0.entries }],
      [CONTENT_TYPES.GALLERY]:     [{ key: 'galImages',   fields: GAL_IMG_FIELDS,     rows: cd0.images }],
      [CONTENT_TYPES.CHATLOG]:     [{ key: 'chatMsgs',    fields: CHAT_MSG_FIELDS,    rows: cd0.messages }],
      [CONTENT_TYPES.PAYLOAD]:     [{ key: 'plOutput', fields: PL_OUTPUT_FIELDS, rows: cd0.output },
                                    { key: 'plReqs',   fields: PL_REQ_FIELDS,   rows: cd0.requirements }],
    }[this._selectedType] || [];
    for (const spec of listSpecs) {
      const container = el.querySelector(`[data-list="${spec.key}"]`);
      if (!container || container.children.length) continue;
      // WYSIWYG types render as their artifact (bubbles / console lines /
      // vault cards / thumbs / …), not schema rows. Chat seeds empty (an
      // empty conversation is just an empty feed); the rest seed one blank.
      const builder = this._wzBuilderFor(spec.key);
      if (builder) {
        const rows = spec.rows?.length ? spec.rows : ((spec.key === 'chatMsgs' || spec.key === 'plOutput') ? [] : [{}]);
        container.insertAdjacentHTML('beforeend', rows.map((r, i) => builder(i, r)).join(''));
        continue;
      }
      const rows = spec.rows?.length ? spec.rows : [{}]; // empty rows are dropped at collect
      container.insertAdjacentHTML('beforeend', rows.map((r, i) => this._rowHtml(spec.key, i, spec.fields, r)).join(''));
    }
    // Gallery contact sheet — drag-to-reorder wiring (once per container).
    if (this._selectedType === CONTENT_TYPES.GALLERY) {
      this._wireGalReorder(el.querySelector('[data-list="galImages"]'));
    }
    // ─── Chat editor wiring: type toggle, sticky date, sender chips, emoji ───
    if (this._selectedType === CONTENT_TYPES.CHATLOG) {
      // System-preset dropdown (fills the notice text + its icon on change).
      const sysSel = el.querySelector('[data-chat-syspreset]');
      if (sysSel && !sysSel.options.length) {
        sysSel.innerHTML = CHAT_SYS_PRESETS.map(p => `<option value="${Handlebars.escapeExpression(p.text)}" data-icon="${p.icon}">${Handlebars.escapeExpression(p.label)}</option>`).join('');
        sysSel.addEventListener('change', () => {
          const t = el.querySelector('[data-chat-text]');
          if (t && sysSel.value) t.value = sysSel.value;
        });
      }
      this._setChatType('text');
      this._paintChatWhen();
      this._chatSyncSides();
      this._syncChatSenderChips();
      // Enter sends from the message input.
      el.querySelector('[data-chat-text]')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._chatSend(); } });
      // Typing a new sender name refreshes the chip highlight.
      el.querySelector('[data-chat-sender]')?.addEventListener('input', () => this._syncChatSenderChips());
      const feed = el.querySelector('.ncm-chatedit__feed');
      if (feed) feed.scrollTop = feed.scrollHeight;
    }

    // ─── Message: rich-text body editor wiring ───
    const rte = el.querySelector('[data-rte]');
    if (rte) {
      const surface = rte.querySelector('[data-rte-surface]');
      const sync = rte.querySelector('[data-rte-sync]');
      // Typing syncs the hidden textarea (the form's debounced input → preview);
      // caret movement lights the active-format toolbar buttons.
      surface?.addEventListener('input', () => { if (sync) sync.value = surface.innerHTML; this._rteRefreshState(); });
      surface?.addEventListener('keyup', () => this._rteRefreshState());
      surface?.addEventListener('mouseup', () => this._rteRefreshState());
      // Raw-mode textarea edits refresh the preview directly (form input catches it too).
      sync?.addEventListener('input', () => { if (rte.classList.contains('is-raw')) this._renderPreview(); });
      // Keep the surface selection alive while clicking toolbar/popover buttons —
      // BUT not for the raw textarea (it needs its own focus/caret).
      rte.addEventListener('mousedown', (e) => { if (e.target.closest('button') && !rte.classList.contains('is-raw')) e.preventDefault(); });
    }

    // ─── Document: inject body blocks (edit pre-fill, else one blank paragraph) ───
    if (this._selectedType === CONTENT_TYPES.DOCUMENT) {
      const list = el.querySelector('[data-doc-list]');
      if (list && !list.children.length) {
        const paras = cd0.paragraphs;
        list.insertAdjacentHTML('beforeend', (paras?.length ? paras : [{}]).map(p => this._docBlockHtml(p)).join(''));
      }
      // Keep the paragraph selection alive while clicking a block's toolbar (so
      // bold/italic apply to the selected text).
      el.querySelector('.ncm-docpage')?.addEventListener('mousedown', (e) => { if (e.target.closest('.ncm-docpara__tools button')) e.preventDefault(); });
    }

    // ─── Record: inject subject cards (edit pre-fill, else one blank seeded
    //     with the DB-kind's fields) — custom engine, not the list engine ───
    if (this._selectedType === CONTENT_TYPES.RECORD) {
      const list = el.querySelector('[data-rec-list]');
      if (list && !list.children.length) {
        const recs = cd0.records;
        if (recs?.length) {
          list.insertAdjacentHTML('beforeend', recs.map(r => this._recordCardHtml(r)).join(''));
        } else {
          const kind = el.querySelector('[name="recType"]')?.value;
          const seed = (RECORD_DB_KINDS[kind]?.seed || RECORD_DB_KINDS.personnel.seed).map(k => ({ kind: k }));
          list.insertAdjacentHTML('beforeend', this._recordCardHtml({ fields: seed }));
        }
      }
    }

    // ─── Calendar: category strip + event cards (custom engine, #34) ───
    if (this._selectedType === CONTENT_TYPES.CALENDAR) {
      const strip = el.querySelector('[data-cal-cats]');
      const list = el.querySelector('[data-cal-list]');
      if (strip && list && !list.children.length && !strip.querySelector('.ncm-calcat')) {
        // Strip: saved categories, plus any category an event carries that the
        // map lost (legacy) — colorless ones draw from the cycle.
        const cats = { ...(cd0.categories || {}) };
        for (const ev of cd0.events || []) if (ev.category && !(ev.category in cats)) cats[ev.category] = null;
        const used = new Set(Object.values(cats).filter(Boolean));
        let ci = 0;
        for (const k of Object.keys(cats)) {
          if (cats[k]) continue;
          while (used.has(CAL_CATEGORY_CYCLE[ci % CAL_CATEGORY_CYCLE.length]) && ci < CAL_CATEGORY_CYCLE.length) ci++;
          cats[k] = CAL_CATEGORY_CYCLE[ci % CAL_CATEGORY_CYCLE.length];
          used.add(cats[k]); ci++;
        }
        strip.querySelector('[data-cal-addwrap]')
          ?.insertAdjacentHTML('beforebegin', Object.entries(cats).map(([n, c]) => this._calCatChipHtml(n, c)).join(''));
        const evs = cd0.events?.length ? cd0.events : [{}];
        list.insertAdjacentHTML('beforeend', evs.map(ev => this._calEventCardHtml(ev)).join(''));
        this._calRepaintAll();
        this._calSortCards();
      }
      // Inline new-category input: Enter or blur commits the chip.
      const nc = el.querySelector('[data-cal-newcat]');
      nc?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this._calCommitNewCat(); } });
      nc?.addEventListener('blur', () => this._calCommitNewCat());
    }

    // ─── Schematic: interactive blueprint stage (markers, routes, fog) ───
    if (this._selectedType === CONTENT_TYPES.SCHEMATIC) this._wireSchemStage(el);

    // ─── Dossier: FUI card editor — inject sections, wire live paints ───
    if (this._selectedType === CONTENT_TYPES.DOSSIER) {
      const secs = el.querySelector('.ncm-dossier-sections-list');
      if (secs && !secs.children.length) {
        const rows = cd0.sections?.length ? cd0.sections : [{}];
        secs.insertAdjacentHTML('beforeend', rows.map((s, i) => this._dossSectionHtml(i, s)).join(''));
      }
      this._wireDossEditor(el);
    }

    // ─── AV Log: media deck + transcript feed editor ───
    if (this._selectedType === CONTENT_TYPES.AVLOG) {
      const feed = el.querySelector('[data-av-feed]');
      if (feed && !feed.children.length && cd0.transcript?.length) {
        feed.insertAdjacentHTML('beforeend', cd0.transcript.map((l, i) => this._avLineHtml(i, l.speaker, l.text)).join(''));
      }
      this._wireAvEditor(el);
    }

    // ─── Location: postcard editor ───
    if (this._selectedType === CONTENT_TYPES.LOCATION) this._wireLocEditor(el);

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
      // Enter = move DOWN a cell (adds a row on the last one); Tab = across.
      // Real-sheet data entry — "good but hard to maneuver" feedback.
      ss?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target?.tagName !== 'INPUT') return;
        const td = e.target.closest('td');
        const tr = td?.parentElement;
        if (!td || !tr) return;
        e.preventDefault();
        const colIdx = [...tr.children].indexOf(td);
        let next = tr.nextElementSibling;
        if (!next?.children?.[colIdx]?.querySelector('input')) {
          el.querySelector('[data-action="ssAddRow"]')?.click();
          next = tr.parentElement?.children?.[[...tr.parentElement.children].indexOf(tr) + 1];
        }
        next?.children?.[colIdx]?.querySelector('input')?.focus();
      });
      // Restore focus mode across the re-renders every action triggers.
      if (this._cmpFocus) el.querySelector('.ncm-composer-shell')?.classList.add('ncm-composer-shell--focus');
    }

    // First preview paint.
    this._renderPreview();

    if (!this.editData) return;
    const cd = this.editData.contentData ?? {};

    // ─── Set select values from editData (Handlebars has no eq helper) ───
    const selectMap = {
      // (dossier classification/threat + avlog mediaType moved to template-value
      //  prefill in the 2026-07-13 redesign — only the actor select remains.)
      dossierLinkedActor: cd.linkedActorId,
      payloadType: cd.payloadType,
      payloadEffectType: cd.effect?.type,
      payloadDisguiseType: cd.disguiseType,
      bankSiphonMode: cd.siphonMode,
      bankStatus: cd.status,
      noteColor: cd.color,
      malType: cd.payloadType,
      malThreat: cd.threat != null ? String(cd.threat) : null,
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
    this.render();  // _onRender redirects payload/malware to the Malware Workshop
  }

  /** Hand program authoring (payload/malware) off to the Malware Workshop. */
  _redirectToWorkshop() {
    try {
      const item = this._item;
      const target = item
        ? { kind: this._isTerminal ? 'terminal' : 'shard', item, accountId: this._target?.accountId ?? null, onSave: this.onSave }
        : null;
      const opts = { target, type: this._selectedType === CONTENT_TYPES.MALWARE ? 'malware' : 'payload' };
      // Editing an existing program entry → load it and replace it on save.
      if (this.editData?.entryId && this.editData.contentType === this._selectedType) {
        opts.entry = { contentType: this.editData.contentType, contentData: this.editData.contentData, subject: this.editData.subject };
        opts.editEntryId = this.editData.entryId;
      }
      game.nightcity.openMalwareWorkshop(opts);
      this.close();
    } catch (err) {
      // If the workshop can't open, fall back to the composer's own fieldset instead
      // of leaving a blank window (the early-return guard would otherwise stick).
      log.error(`Workshop redirect failed: ${err.message}`);
      this._redirecting = false;
      this.render();
    }
  }

  // (Entry Identity icon/accent handlers removed 2026-07-12 — the fieldset was
  //  dead UI: entryIcon was never collected; the viewer derives icon/accent
  //  from CONTENT_TYPE_INFO[contentType].)

  // ═══════════════════════════════════════════════════════════
  //  SHELL CHROME (type bar · picker · sections · focus mode)
  // ═══════════════════════════════════════════════════════════

  /** Collapse/expand a ①②③ section (DOM-only — unsaved edits survive). */
  static _onCmpToggleSec(event, target) {
    const sec = target.closest('[data-cmp-sec]');
    if (!sec) return;
    const closed = sec.classList.toggle('ncm-cmp-sec--closed');
    this._secOpen[sec.dataset.cmpSec] = !closed;
  }

  static _onCmpTogglePicker() {
    const p = this.element?.querySelector('[data-cmp-picker]');
    const t = this.element?.querySelector('[data-cmp-tplmenu]');
    if (p) p.hidden = !p.hidden;
    if (t) t.hidden = true;
  }

  static _onCmpToggleTpl() {
    const p = this.element?.querySelector('[data-cmp-picker]');
    const t = this.element?.querySelector('[data-cmp-tplmenu]');
    if (t) t.hidden = !t.hidden;
    if (p) p.hidden = true;
  }

  static _onCmpToggleHow() {
    const h = this.element?.querySelector('[data-cmp-howbox]');
    if (h) h.hidden = !h.hidden;
  }

  /** Spreadsheet focus mode — hide the preview + ②③ so the grid gets the room. */
  static _onCmpFocusMode(event, target) {
    this._cmpFocus = !this._cmpFocus;
    this.element?.querySelector('.ncm-composer-shell')?.classList.toggle('ncm-composer-shell--focus', this._cmpFocus);
    const i = target?.querySelector('i');
    if (i) i.className = this._cmpFocus ? 'fas fa-compress' : 'fas fa-expand';
  }

  /** Fill the ②③ header summary chips from live form values (DOM-only). */
  _syncCmpChips() {
    const el = this.element;
    if (!el) return;
    const set = (k, html) => { const c = el.querySelector(`[data-cmp-chip="${k}"]`); if (c) c.innerHTML = html; return c; };
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    // ENVELOPE (#37) — a FILE summarizes as filename · owner-node, not a sender.
    const isFile = el.querySelector('[name="envelope"]')?.value === 'file';
    if (isFile) {
      const fname = el.querySelector('[name="fileName"]')?.value?.trim()
        || el.querySelector('[name="fileName"]')?.placeholder || 'file';
      const owner = el.querySelector('[name="fileOwner"]')?.value?.trim();
      set('from', `<i class="fas fa-file"></i> ${esc(fname)}${owner ? ` · ${esc(owner)}` : ''}`);
    } else {
      set('from', `<i class="fas fa-user"></i> ${esc(el.querySelector('[name="from"]')?.value?.trim() || 'no sender')}`);
    }
    set('when', `<i class="fas fa-clock"></i> ${esc(el.querySelector('.ncm-ctp-trigger__value')?.textContent?.trim() || '')}`);
    const foldSel = el.querySelector('[name="entryFolder"]');
    if (foldSel) set('folder', `<i class="fas fa-folder"></i> ${esc(foldSel.selectedOptions[0]?.textContent || 'Inbox')}`);
    const encBox = el.querySelector('[name="encrypted"]');
    const enc = !!encBox?.checked;
    const encChip = set('enc', enc
      ? `<i class="fas fa-lock"></i> ENCRYPTED DV ${esc(el.querySelector('[name="encryptionDC"]')?.value || '15')}`
      : '<i class="fas fa-lock-open"></i> OPEN ACCESS');
    encChip?.classList.toggle('ncm-cmp-chip--warn', enc);
    encChip?.classList.toggle('ncm-cmp-chip--ok', !enc);
    const restricted = !!el.querySelector('[name="networkRestricted"]')?.checked;
    const nets = el.querySelectorAll('[name="entryAllowedNetwork"]').length;
    set('net', restricted
      ? `<i class="fas fa-wifi"></i> ${nets} NETWORK${nets === 1 ? '' : 'S'} ONLY`
      : '<i class="fas fa-wifi"></i> ALL NETWORKS');
  }

  // ═══════════════════════════════════════════════════════════
  //  WYSIWYG EDITORS — "the editor IS the artifact" (the spreadsheet-grid
  //  thesis, generalized). Every visual item is still a .ncm-cl-row whose
  //  NAMED controls match the field schema, so _collectList / edit-prefill /
  //  templates are untouched. Schema checkboxes stay real (hidden) checkboxes
  //  (_collectList reads .checked); select-typed fields ride hidden inputs
  //  (.value is all collect reads).
  // ═══════════════════════════════════════════════════════════

  /** Builder registry — null = the generic labeled-row engine. */
  _wzBuilderFor(key) {
    const map = {
      chatMsgs: (i, r) => this._chatBubbleHtml(i, r),
      syslogLines: (i, r) => this._slogLineHtml(i, r),
      credEntries: (i, r) => this._credCardHtml(i, r),
      galImages: (i, r) => this._galCardHtml(i, r),
      bankTxns: (i, r) => this._bankTxnHtml(i, r),
      plOutput: (i, r) => this._plLineHtml(i, r),
    };
    return map[key] || null;
  }

  /** Payload run-log — a console line: severity key (click cycles) · text · Enter=next. */
  _plLineHtml(idx, m = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const sev = m.sev || 'info';
    return `<div class="ncm-cl-row ncm-slog__line sev-${esc(sev)}">` +
      `<span class="ncm-cl-num">${idx + 1}</span>` +
      `<input type="hidden" name="plOutput__sev-${idx}" value="${esc(sev)}">` +
      `<button type="button" class="ncm-slog__sev" data-action="wzCycle" data-f="sev" data-vals="info,ok,warn,err,debug" data-tooltip="Click to cycle severity">${esc(sev).toUpperCase()}</button>` +
      `<input type="text" name="plOutput__text-${idx}" value="${esc(m.text)}" placeholder="what the program prints… Enter = next line" class="ncm-slog__in ncm-slog__msg">` +
      `<span class="ncm-wz-tools">` +
        `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>` +
      `</span>` +
    `</div>`;
  }

  /** Syslog — a console line: gutter · severity key (click cycles) · inline inputs. */
  _slogLineHtml(idx, m = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const sev = m.sev || 'info';
    return `<div class="ncm-cl-row ncm-slog__line sev-${esc(sev)}${m.mark ? ' is-mark' : ''}">` +
      `<span class="ncm-cl-num">${idx + 1}</span>` +
      `<input type="hidden" name="syslogLines__sev-${idx}" value="${esc(sev)}">` +
      `<input type="checkbox" name="syslogLines__mark-${idx}"${m.mark ? ' checked' : ''} class="ncm-wz-flag">` +
      `<button type="button" class="ncm-slog__sev" data-action="wzCycle" data-f="sev" data-vals="info,ok,warn,err,debug" data-tooltip="Click to cycle severity">${esc(sev).toUpperCase()}</button>` +
      `<input type="text" name="syslogLines__ts-${idx}" value="${esc(m.ts)}" placeholder="04:12:09" class="ncm-slog__in ncm-slog__ts">` +
      `<input type="text" name="syslogLines__actor-${idx}" value="${esc(m.actor)}" placeholder="user/proc" class="ncm-slog__in ncm-slog__actor">` +
      `<input type="text" name="syslogLines__msg-${idx}" value="${esc(m.msg)}" placeholder="log message… Enter = next line" class="ncm-slog__in ncm-slog__msg">` +
      `<span class="ncm-wz-tools">` +
        `<button type="button" data-action="wzCheck" data-f="mark" class="ncm-shard-hdr-btn" data-tooltip="Mark — spotlight this line"><i class="fas fa-star"></i></button>` +
        `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>` +
      `</span>` +
    `</div>`;
  }

  /** Credentials — a vault card: host / user / masked secret + eye / strength pips / lock. */
  _credCardHtml(idx, c = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const s = Number(c.strength || 0);
    const pips = [1, 2, 3, 4].map(v =>
      `<button type="button" class="ncm-credcard__pip${v <= s ? ' on' : ''}" data-action="wzPip" data-v="${v}" data-tooltip="Strength ${v}/4"></button>`).join('');
    return `<div class="ncm-cl-row ncm-credcard${c.encrypted ? ' is-encrypted' : ''}">` +
      `<input type="hidden" name="credEntries__strength-${idx}" value="${esc(c.strength)}">` +
      `<input type="checkbox" name="credEntries__encrypted-${idx}"${c.encrypted ? ' checked' : ''} class="ncm-wz-flag">` +
      `<input type="text" name="credEntries__host-${idx}" value="${esc(c.host)}" placeholder="host / system" class="ncm-credcard__host">` +
      `<div class="ncm-credcard__line">` +
        `<input type="text" name="credEntries__user-${idx}" value="${esc(c.user)}" placeholder="username" class="ncm-credcard__user">` +
        `<span class="ncm-credcard__secretwrap"><input type="password" name="credEntries__secret-${idx}" value="${esc(c.secret)}" placeholder="password / key" class="ncm-credcard__secret">` +
        `<button type="button" data-action="wzReveal" class="ncm-credcard__eye" data-tooltip="Show / hide"><i class="fas fa-eye"></i></button></span>` +
      `</div>` +
      `<input type="text" name="credEntries__note-${idx}" value="${esc(c.note)}" placeholder="note (optional)" class="ncm-credcard__note">` +
      `<div class="ncm-credcard__foot">` +
        `<span class="ncm-credcard__pips" data-tooltip="Password strength — draws the meter">${pips}</span>` +
        `<button type="button" data-action="wzCheck" data-f="encrypted" class="ncm-credcard__lock" data-tooltip="Locked — masked until cracked in the viewer"><i class="fas fa-lock"></i> LOCKED</button>` +
        `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>` +
      `</div>` +
    `</div>`;
  }

  /** Gallery — a contact-sheet card: the thumb IS the picker (click empty =
   *  browse, click filled = enlarge), ⋮⋮ drag reorders, corner toggles
   *  (flag/dead/lock + PTZ), URL row revealed on hover/focus, and a feed-only
   *  row (loop/cut/control DVs + scene link) shown when the gallery's Mode is
   *  LIVE FEED (CSS on [data-gal-cfg][data-gal-mode]). */
  _galCardHtml(idx, g = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    // Schema checkboxes stay real (hidden) checkboxes — _collectList reads
    // .checked. looped/cut/loopedTime are runCamAction table state riding
    // through the edit; the composer never toggles them.
    const flags = ['flagged', 'corrupted', 'locked', 'ptz', 'looped', 'cut'].map(f =>
      `<input type="checkbox" name="galImages__${f}-${idx}"${g[f] ? ' checked' : ''} class="ncm-wz-flag">`).join('');
    const cls = ['flagged', 'corrupted', 'locked', 'ptz'].map(f => (g[f] ? ` is-${f}` : '')).join('');
    const sceneName = g.sceneId ? ((typeof game !== 'undefined' && game.scenes?.get?.(g.sceneId)?.name) || 'scene ✓') : '';
    return `<div class="ncm-cl-row ncm-galcard${cls}">` +
      flags +
      `<input type="hidden" name="galImages__loopedTime-${idx}" value="${esc(g.loopedTime)}">` +
      `<input type="hidden" name="galImages__sceneId-${idx}" value="${esc(g.sceneId)}">` +
      `<div class="ncm-galcard__thumbwrap" data-action="galCardThumb" data-tooltip="${g.url ? 'Click to enlarge' : 'Click to pick an image'}">` +
        `<img class="ncm-cl-thumb ncm-galcard__thumb" src="${esc(g.url)}" alt=""${g.url ? '' : ' style="display:none"'}>` +
        `<span class="ncm-galcard__empty"${g.url ? ' style="display:none"' : ''}><i class="fas fa-folder-open"></i> PICK IMAGE</span>` +
        `<span class="ncm-galcard__drag" draggable="true" data-tooltip="Drag to reorder — order is display order"><i class="fas fa-grip-vertical"></i></span>` +
        `<span class="ncm-galcard__num ncm-cl-num">${idx + 1}</span>` +
        `<span class="ncm-galcard__badges">` +
          `<button type="button" data-action="wzCheck" data-f="flagged" class="ncm-galcard__badge ncm-galcard__badge--flag" data-tooltip="Flag — the important frame (stills: becomes the hero)"><i class="fas fa-flag"></i></button>` +
          `<button type="button" data-action="wzCheck" data-f="corrupted" class="ncm-galcard__badge ncm-galcard__badge--dead" data-tooltip="Dead frame — NO SIGNAL static"><i class="fas fa-skull"></i></button>` +
          `<button type="button" data-action="wzCheck" data-f="locked" class="ncm-galcard__badge ncm-galcard__badge--lock" data-tooltip="Encrypted frame — hidden until decrypted"><i class="fas fa-lock"></i></button>` +
          `<button type="button" data-action="wzCheck" data-f="ptz" class="ncm-galcard__badge ncm-galcard__badge--ptz" data-tooltip="PTZ — a steerable camera head (feed mode); players pan around the full image"><i class="fas fa-arrows-up-down-left-right"></i></button>` +
        `</span>` +
      `</div>` +
      `<div class="ncm-galcard__urlrow"><input type="text" name="galImages__url-${idx}" value="${esc(g.url)}" placeholder="image path / URL" class="ncm-config-input">` +
      `<button type="button" data-action="browseListImage" class="ncm-shard-hdr-btn" data-tooltip="Browse / upload"><i class="fas fa-folder-open"></i></button></div>` +
      `<div class="ncm-galcard__meta">` +
        `<input type="text" name="galImages__label-${idx}" value="${esc(g.label)}" placeholder="IMG_00${idx + 1}" class="ncm-config-input ncm-galcard__label">` +
        `<input type="text" name="galImages__time-${idx}" value="${esc(g.time)}" placeholder="04:12" class="ncm-config-input ncm-galcard__time">` +
        `<input type="text" name="galImages__unlockDV-${idx}" value="${esc(g.unlockDV)}" placeholder="DV" class="ncm-config-input ncm-galcard__dv" data-tooltip="Per-frame decrypt DV (blank = vault DV)">` +
      `</div>` +
      `<input type="text" name="galImages__caption-${idx}" value="${esc(g.caption)}" placeholder="caption (optional)" class="ncm-config-input ncm-galcard__cap">` +
      `<div class="ncm-galcard__feedrow">` +
        `<input type="text" name="galImages__loopDV-${idx}" value="${esc(g.loopDV)}" placeholder="LOOP" class="ncm-config-input ncm-galcard__fdv" data-tooltip="LOOP roll DV — blank turns the LOOP action off">` +
        `<input type="text" name="galImages__cutDV-${idx}" value="${esc(g.cutDV)}" placeholder="CUT" class="ncm-config-input ncm-galcard__fdv" data-tooltip="CUT FEED roll DV — blank turns the CUT action off">` +
        `<input type="text" name="galImages__controlDV-${idx}" value="${esc(g.controlDV)}" placeholder="CTL" class="ncm-config-input ncm-galcard__fdv ncm-galcard__ctldv" data-tooltip="TAKE CONTROL DV for the PTZ head — blank = anyone can drive it">` +
        `<button type="button" data-action="galScene" class="ncm-galcard__scene${g.sceneId ? ' is-on' : ''}" data-tooltip="Link a scene — GM gets Go-to-Scene in the monitor"><i class="fas fa-map"></i> <span data-gal-scene-lbl>${esc(sceneName || 'scene')}</span></button>` +
      `</div>` +
      `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger ncm-galcard__rm" data-tooltip="Remove"><i class="fas fa-times"></i></button>` +
    `</div>`;
  }

  /** Document — a paragraph block on the page surface with an H/quote/redact toolbar. */
  // ── DOCUMENT body blocks (text / list / figure) — a custom engine, not the
  //    list schema: block kinds vary, and text blocks are contenteditable so
  //    inline bold/italic works. Injected in _onRender, read by _collectDocBlocks. ──

  /** One body block. `data-kind` + block classes are the save contract. */
  _docBlockHtml(p = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const kind = (p.kind === 'list' || p.kind === 'figure') ? p.kind : 'text';
    const heading = `<input type="text" class="ncm-docpara__h" value="${esc(p.heading)}" placeholder="Heading (optional — starts a section)">`;
    const rm = `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>`;
    if (kind === 'figure') {
      return `<div class="ncm-cl-row ncm-docpara ncm-docpara--figure" data-kind="figure">${heading}` +
        `<span class="ncm-cl-imgrow"><img class="ncm-cl-thumb ncm-docpara__figthumb" src="${esc(p.image)}"${p.image ? '' : ' style="display:none"'}>` +
        `<input type="text" class="ncm-docpara__img ncm-config-input" value="${esc(p.image)}" placeholder="image path (chart, photo, exhibit)">` +
        `<button type="button" data-action="docBrowseFigure" class="ncm-shard-hdr-btn" title="Browse"><i class="fas fa-folder-open"></i></button></span>` +
        `<input type="text" class="ncm-docpara__cap ncm-config-input" value="${esc(p.caption)}" placeholder="caption (optional)">` +
        `<span class="ncm-wz-tools ncm-docpara__tools">${rm}</span></div>`;
    }
    if (kind === 'list') {
      const items = Array.isArray(p.items) ? p.items.join('\n') : (p.items || '');
      return `<div class="ncm-cl-row ncm-docpara ncm-docpara--list${p.ordered ? ' is-ordered' : ''}" data-kind="list">${heading}` +
        `<textarea class="ncm-docpara__items ncm-config-input" rows="3" placeholder="one item per line">${esc(items)}</textarea>` +
        `<span class="ncm-wz-tools ncm-docpara__tools">` +
          `<button type="button" data-action="docToggleOrdered" class="ncm-shard-hdr-btn${p.ordered ? ' is-active' : ''}" data-tooltip="Bulleted / numbered"><i class="fas fa-list-ol"></i></button>${rm}</span></div>`;
    }
    // text / quote
    return `<div class="ncm-cl-row ncm-docpara${p.quote ? ' is-quote' : ''}${p.redacted ? ' is-redacted' : ''}" data-kind="text">${heading}` +
      `<div class="ncm-docpara__t" contenteditable="true" data-doc-text data-placeholder="Paragraph text — select to bold/italic; redaction hides it, DECLASSIFY reveals">${p.text || ''}</div>` +
      `<span class="ncm-wz-tools ncm-docpara__tools">` +
        `<button type="button" data-action="docFmt" data-cmd="bold" class="ncm-shard-hdr-btn" data-tooltip="Bold"><i class="fas fa-bold"></i></button>` +
        `<button type="button" data-action="docFmt" data-cmd="italic" class="ncm-shard-hdr-btn" data-tooltip="Italic"><i class="fas fa-italic"></i></button>` +
        `<button type="button" data-action="docToggleQuote" class="ncm-shard-hdr-btn${p.quote ? ' is-active' : ''}" data-tooltip="Pulled quote"><i class="fas fa-quote-right"></i></button>` +
        `<button type="button" data-action="docToggleRedact" class="ncm-shard-hdr-btn${p.redacted ? ' is-active' : ''}" data-tooltip="Redact — black it out"><i class="fas fa-eye-slash"></i></button>${rm}</span></div>`;
  }

  static _onDocAddPara() { this._docAddBlock({}); }
  static _onDocAddList() { this._docAddBlock({ kind: 'list' }); }
  static _onDocAddFigure() { this._docAddBlock({ kind: 'figure' }); }
  _docAddBlock(p) {
    const list = this.element?.querySelector('[data-doc-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', this._docBlockHtml(p));
    list.lastElementChild?.querySelector('.ncm-docpara__h, [data-doc-text], .ncm-docpara__items, .ncm-docpara__img')?.focus();
    this._renderPreview();
  }

  static _onDocBrowseFigure(event, target) {
    const row = target.closest('.ncm-docpara');
    const inp = row?.querySelector('.ncm-docpara__img');
    if (!inp) return;
    new FilePicker({ type: 'image', current: inp.value || '', callback: (path) => {
      inp.value = path;
      const thumb = row.querySelector('.ncm-docpara__figthumb');
      if (thumb) { thumb.src = path; thumb.style.display = path ? '' : 'none'; }
      this._renderPreview();
    } }).render(true);
  }

  /** Inline bold/italic on the focused paragraph contenteditable. */
  static _onDocFmt(event, target) {
    try { document.execCommand(target.dataset.cmd, false, null); } catch { /* ignore */ }
    target.closest('.ncm-docpara')?.querySelector('[data-doc-text]')?.focus();
    this._renderPreview();
  }

  static _onDocToggleQuote(event, target) {
    const row = target.closest('.ncm-docpara');
    const on = row?.classList.toggle('is-quote');
    if (on) row.classList.remove('is-redacted');
    target.classList.toggle('is-active', !!on);
    this._renderPreview();
  }

  static _onDocToggleRedact(event, target) {
    const row = target.closest('.ncm-docpara');
    const on = row?.classList.toggle('is-redacted');
    target.classList.toggle('is-active', !!on);
    this._renderPreview();
  }

  static _onDocToggleOrdered(event, target) {
    const row = target.closest('.ncm-docpara');
    const on = row?.classList.toggle('is-ordered');
    target.classList.toggle('is-active', !!on);
    this._renderPreview();
  }

  /** Walk the document body blocks into the authored paragraphs[] shape. */
  _collectDocBlocks() {
    const out = [];
    const list = this.element?.querySelector('[data-doc-list]');
    if (!list) return out;
    for (const row of list.querySelectorAll('.ncm-docpara')) {
      const kind = row.dataset.kind || 'text';
      const heading = row.querySelector('.ncm-docpara__h')?.value?.trim() || '';
      if (kind === 'figure') {
        const image = row.querySelector('.ncm-docpara__img')?.value?.trim() || '';
        const caption = row.querySelector('.ncm-docpara__cap')?.value?.trim() || '';
        if (!image && !heading) continue;
        out.push({ kind: 'figure', image, caption, ...(heading ? { heading } : {}) });
      } else if (kind === 'list') {
        const items = (row.querySelector('.ncm-docpara__items')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
        const ordered = row.classList.contains('is-ordered');
        if (!items.length && !heading) continue;
        out.push({ kind: 'list', ordered, items, ...(heading ? { heading } : {}) });
      } else {
        const text = (row.querySelector('[data-doc-text]')?.innerHTML || '').trim();
        const quote = row.classList.contains('is-quote');
        const redacted = row.classList.contains('is-redacted');
        if (!text && !heading && !redacted) continue;
        out.push({ ...(heading ? { heading } : {}), text, ...(quote ? { quote: true } : {}), ...(redacted ? { redacted: true } : {}) });
      }
    }
    return out;
  }

  /** Records — a database card: live initials avatar · fields · cycling status pill. */
  // ═══════════════════════════════════════════════════════════
  //  RECORD CARD-BUILDER (typed-field dossiers, 2026-07-12)
  //  Each record is a full card: portrait tile · name · status pill · flag,
  //  plus a dynamic list of typed fields drawn from RECORD_FIELD_KINDS + a
  //  grouped +field palette. NOT the generic list engine — fields vary per
  //  record, so cards are injected in _onRender and read by _collectRecords()
  //  which walks the DOM (the spreadsheet-grid precedent). Date fields carry a
  //  uniquely-named hidden input so the shared CyberTimePicker can target them.
  // ═══════════════════════════════════════════════════════════

  /** One subject card (portrait + name + status + flag + fields + palette). */
  _recordCardHtml(record = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const name = record.name || '';
    const initials = (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
    const portrait = record.portrait || '';
    const status = record.status || '';
    const fields = Array.isArray(record.fields) ? record.fields : [];
    const fieldsHtml = fields.map(f => this._recFieldHtml(f.kind, f)).filter(Boolean).join('');
    return `<div class="ncm-reccard${record.flagged ? ' is-flagged' : ''}">` +
      `<input type="hidden" class="ncm-reccard__portrait" value="${esc(portrait)}">` +
      `<input type="hidden" class="ncm-reccard__flag" value="${record.flagged ? '1' : ''}">` +
      `<input type="hidden" class="ncm-reccard__status-val" value="${esc(status)}">` +
      `<div class="ncm-reccard__top">` +
        `<button type="button" class="ncm-reccard__portrait-tile" data-action="recPortrait" data-tooltip="Set portrait (photo, else initials)">` +
          (portrait ? `<img src="${esc(portrait)}" alt="">` : `<span class="ncm-reccard__init">${esc(initials)}</span>`) +
          `<span class="ncm-reccard__cam"><i class="fas fa-camera"></i></span>` +
        `</button>` +
        `<div class="ncm-reccard__idcol">` +
          `<div class="ncm-reccard__namerow">` +
            `<button type="button" class="ncm-reccard__chev" data-action="recToggleCard" data-tooltip="Collapse / expand"><i class="fas fa-chevron-down"></i></button>` +
            `<input type="text" class="ncm-reccard__name" value="${esc(name)}" placeholder="subject name">` +
            `<button type="button" class="ncm-reccard__status" data-action="recStatusCycle" data-tooltip="Cycle status (click) — auto-colors in the viewer">${status ? esc(status) : 'STATUS'} <i class="fas fa-rotate"></i></button>` +
            `<button type="button" class="ncm-reccard__flagbtn${record.flagged ? ' on' : ''}" data-action="recFlag" data-tooltip="Red-tag the subject worth finding"><i class="fas fa-flag"></i></button>` +
            `<button type="button" class="ncm-reccard__dupe" data-action="recDuplicate" data-tooltip="Duplicate this subject"><i class="fas fa-clone"></i></button>` +
            `<button type="button" class="ncm-reccard__rm" data-action="recRemoveSubject" data-tooltip="Remove subject"><i class="fas fa-times"></i></button>` +
          `</div>` +
          `<div class="ncm-reccard__collapsed">${fields.length} field${fields.length === 1 ? '' : 's'}</div>` +
          `<div class="ncm-reccard__fields" data-rec-fields>${fieldsHtml}</div>` +
          this._recPaletteHtml() +
        `</div>` +
      `</div>` +
    `</div>`;
  }

  /** The grouped +field palette (add a typed field to this card). */
  _recPaletteHtml() {
    const groups = { core: 'Core', security: 'Threat', work: 'Work', medical: 'Medical', asset: 'Asset', power: 'Extra', freeform: '' };
    let out = '<div class="ncm-recpalette">';
    for (const g of Object.keys(groups)) {
      const kinds = Object.entries(RECORD_FIELD_KINDS).filter(([, v]) => v.group === g);
      if (!kinds.length) continue;
      out += kinds.map(([k, v]) =>
        `<button type="button" class="ncm-recaddf" data-action="recAddField" data-kind="${k}" data-tooltip="Add ${Handlebars.escapeExpression(v.label)}"><i class="${v.icon}"></i>${Handlebars.escapeExpression(v.label)}</button>`
      ).join('');
    }
    return out + '</div>';
  }

  /** One typed field row. Read back by _collectRecords via data-kind + class. */
  _recFieldHtml(kind, field = {}) {
    const info = RECORD_FIELD_KINDS[kind];
    if (!info) return '';
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const val = field.value;
    const rm = `<button type="button" class="ncm-recfield__rm" data-action="recRemoveField" data-tooltip="Remove field"><i class="fas fa-times"></i></button>`;
    const head = `<i class="${info.icon} ncm-recfield__ic"></i><span class="ncm-recfield__lbl">${esc(info.label)}</span>`;
    let body;
    if (info.type === 'date') {
      // Dates carry an EDITABLE label (Last seen / Intake / DOB / …) — the
      // default "Date" is never what you mean. Stored as field.label.
      const uid = `recdate-${(typeof foundry !== 'undefined' && foundry.utils?.randomID) ? foundry.utils.randomID(8) : Math.floor(Date.now() % 1e8)}`;
      const iso = val ? String(val) : '';
      let dlabel = 'Set date';
      try { if (iso) dlabel = formatCyberDate(new Date(iso).toISOString(), { dateOnly: true }); } catch { dlabel = iso; }
      return `<div class="ncm-recfield" data-kind="date" data-ftype="date">` +
        `<i class="${info.icon} ncm-recfield__ic"></i>` +
        `<input type="text" class="ncm-recfield__key ncm-config-input" value="${esc(field.label || info.label)}" placeholder="label" style="flex:0 0 90px">` +
        `<input type="hidden" name="${uid}" class="ncm-recfield__val" value="${esc(iso)}">` +
        `<div class="ncm-ctp-trigger ncm-recfield__date" data-action="openTimePicker" data-target="${uid}">` +
          `<span class="ncm-ctp-trigger__value${iso ? '' : ' ncm-ctp-trigger__value--empty'}">${esc(dlabel)}</span>` +
          `<i class="fas fa-chevron-down ncm-ctp-trigger__chevron"></i></div>${rm}</div>`;
    } else if (info.type === 'threat' || info.type === 'rating') {
      const max = info.type === 'rating' ? 5 : 4;
      const n = Math.max(0, Math.min(max, Number(val) || 0));
      const glyph = info.type === 'rating' ? 'star' : 'sq';
      const pips = Array.from({ length: max }, (_, i) =>
        `<button type="button" class="ncm-recfield__pip ncm-recfield__pip--${glyph}${(i + 1) <= n ? ' on' : ''}" data-action="recPip" data-v="${i + 1}"></button>`).join('');
      body = `<input type="hidden" class="ncm-recfield__val" value="${n || ''}"><span class="ncm-recfield__pips">${pips}</span>`;
    } else if (info.type === 'flag') {
      const on = !!val;
      body = `<input type="hidden" class="ncm-recfield__val" value="${on ? '1' : ''}">` +
        `<button type="button" class="ncm-recfield__toggle${on ? ' on' : ''}" data-action="recFlagField">${on ? 'YES' : 'no'}</button>`;
    } else if (info.type === 'image') {
      body = `<input type="text" class="ncm-recfield__val ncm-config-input" value="${esc(val)}" placeholder="path to image">` +
        `<button type="button" data-action="browseListImage" class="ncm-shard-hdr-btn" data-tooltip="Browse / upload"><i class="fas fa-folder-open"></i></button>`;
    } else if (info.type === 'textarea') {
      body = `<textarea class="ncm-recfield__val ncm-config-input" rows="2" placeholder="${esc(info.ph || '')}" style="resize:vertical">${esc(val)}</textarea>`;
    } else if (info.type === 'customkv') {
      return `<div class="ncm-recfield ncm-recfield--full" data-kind="custom" data-ftype="customkv">` +
        `<i class="${info.icon} ncm-recfield__ic"></i>` +
        `<input type="text" class="ncm-recfield__key ncm-config-input" value="${esc(field.label)}" placeholder="label" style="flex:0 0 110px">` +
        `<input type="text" class="ncm-recfield__val ncm-config-input" value="${esc(val)}" placeholder="value">${rm}</div>`;
    } else { // text / number
      const t = info.type === 'number' ? 'number' : 'text';
      body = `<input type="${t}" class="ncm-recfield__val ncm-config-input" value="${esc(val)}" placeholder="${esc(info.ph || '')}"${info.unit ? ` data-unit="${esc(info.unit)}"` : ''}>`;
    }
    return `<div class="ncm-recfield${info.full ? ' ncm-recfield--full' : ''}" data-kind="${kind}" data-ftype="${info.type}">${head}${body}${rm}</div>`;
  }

  // ── Record actions ──

  /** Pick a DB-kind quick-start — stamps recType + re-seeds fields on empty new cards. */
  static _onRecKind(event, target) {
    const kind = target.dataset.kind;
    this.element?.querySelectorAll('.ncm-reckind').forEach(c => c.classList.toggle('on', c === target));
    const hidden = this.element?.querySelector('[name="recType"]');
    if (hidden) hidden.value = kind;
    this._renderPreview();
  }

  /** Add a blank subject card seeded with the current DB-kind's fields. */
  static _onRecAddSubject() {
    const list = this.element?.querySelector('[data-rec-list]');
    if (!list) return;
    const kind = this.element?.querySelector('[name="recType"]')?.value;
    const seed = (RECORD_DB_KINDS[kind]?.seed || []).map(k => ({ kind: k }));
    list.insertAdjacentHTML('beforeend', this._recordCardHtml({ fields: seed }));
    list.lastElementChild?.querySelector('.ncm-reccard__name')?.focus();
    this._renderPreview();
  }

  static _onRecRemoveSubject(event, target) {
    target.closest('.ncm-reccard')?.remove();
    this._renderPreview();
  }

  /** Collapse / expand a subject card (DOM-only; the fields/palette hide). */
  static _onRecToggleCard(event, target) {
    const card = target.closest('.ncm-reccard');
    if (!card) return;
    const collapsed = card.classList.toggle('is-collapsed');
    const i = target.querySelector('i');
    if (i) i.className = collapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
    // Refresh the collapsed summary count.
    const n = card.querySelectorAll('.ncm-recfield').length;
    const sum = card.querySelector('.ncm-reccard__collapsed');
    if (sum) sum.textContent = `${n} field${n === 1 ? '' : 's'}`;
  }

  /** Duplicate a subject — clone its data into a new expanded card after it. */
  static _onRecDuplicate(event, target) {
    const card = target.closest('.ncm-reccard');
    if (!card) return;
    const data = this._collectOneRecord(card);
    data.name = data.name ? `${data.name} (copy)` : '';
    card.insertAdjacentHTML('afterend', this._recordCardHtml(data));
    card.nextElementSibling?.querySelector('.ncm-reccard__name')?.focus();
    this._renderPreview();
  }

  // ── Record CSV import / export (edit the DB in Excel) ──

  /** Export the current subjects as a CSV (name/status/flagged + one column per field kind present). */
  static _onRecExportCsv() {
    const records = this._collectRecords();
    if (!records.length) { ui.notifications.warn('NCM | No subjects to export.'); return; }
    // Column set: the special trio + every distinct field present, keyed by
    // kind + its effective label (so two labeled dates → two columns, no
    // collision), in registry order. Header = the field's display label.
    const fkey = (f) => `${f.kind}:${f.label || ''}`;
    const cols = [];
    const seen = new Set();
    for (const r of records) for (const f of r.fields) {
      const key = fkey(f);
      if (seen.has(key)) continue;
      seen.add(key);
      cols.push({ key, kind: f.kind, header: f.label || RECORD_FIELD_KINDS[f.kind]?.label || f.kind });
    }
    const order = Object.keys(RECORD_FIELD_KINDS);
    cols.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    const headers = ['name', 'status', 'flagged', ...cols.map(c => c.header)];
    const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.map(cell).join(',')];
    for (const r of records) {
      const row = [r.name, r.status, r.flagged ? 'yes' : ''];
      for (const c of cols) row.push(this._recCsvCell(r.fields.find(x => fkey(x) === c.key)));
      lines.push(row.map(cell).join(','));
    }
    const dbName = (this.element?.querySelector('[name="recDbName"]')?.value || 'records').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'records';
    saveDataToFile(lines.join('\r\n'), 'text/csv', `${dbName}.csv`);
  }

  /** A field's CSV cell value (date→yyyy-mm-dd, flag→yes, else the value). */
  _recCsvCell(f) {
    if (!f) return '';
    const type = RECORD_FIELD_KINDS[f.kind]?.type;
    if (type === 'flag') return f.value ? 'yes' : '';
    if (type === 'date') { try { return f.value ? new Date(f.value).toISOString().slice(0, 10) : ''; } catch { return String(f.value ?? ''); } }
    return String(f.value ?? '');
  }

  /** Import subjects from a CSV — replaces the current card list. */
  static _onRecImportCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { this._recApplyCsv(String(reader.result || '')); }
        catch (err) { ui.notifications.error(`NCM | CSV import failed: ${err.message}`); }
      };
      reader.onerror = () => ui.notifications.error('NCM | Could not read the file.');
      reader.readAsText(file);
    });
    input.click();
  }

  /** Parse a records CSV → rebuild the subject cards. First row = headers. */
  _recApplyCsv(text) {
    const grid = this._parseCsv(text);
    if (grid.length < 2) { ui.notifications.warn('NCM | The CSV needs a header row + at least one subject.'); return; }
    const cols = grid[0].map(h => this._recCsvResolveHeader(String(h).trim()));
    const records = [];
    for (const cells of grid.slice(1)) {
      const rec = { name: '', status: '', flagged: false, fields: [] };
      cells.forEach((raw, i) => {
        const col = cols[i];
        if (!col) return;
        const v = String(raw ?? '').trim();
        if (col.special === 'name') rec.name = v;
        else if (col.special === 'status') rec.status = v.toUpperCase();
        else if (col.special === 'flagged') rec.flagged = /^(1|y|yes|true|flag)/i.test(v);
        else if (col.kind && v !== '') {
          const value = this._recCsvParseVal(col.kind, v);
          if (value === '' || value == null) return;
          const f = { kind: col.kind, value };
          if (col.kind === 'custom') f.label = col.customLabel || '';
          rec.fields.push(f);
        }
      });
      if (rec.name || rec.status || rec.fields.length) records.push(rec);
    }
    if (!records.length) { ui.notifications.warn('NCM | No subjects found in the CSV.'); return; }
    const list = this.element?.querySelector('[data-rec-list]');
    if (!list) return;
    list.innerHTML = records.map(r => this._recordCardHtml(r)).join('');
    ui.notifications.info(`NCM | Imported ${records.length} subject(s).`);
    this._renderPreview();
  }

  /** Resolve a CSV column header → a field target ({special} | {kind} | custom). */
  _recCsvResolveHeader(h) {
    const l = h.toLowerCase();
    if (l === 'name') return { special: 'name' };
    if (l === 'status') return { special: 'status' };
    if (l === 'flag' || l === 'flagged') return { special: 'flagged' };
    for (const [key, info] of Object.entries(RECORD_FIELD_KINDS)) {
      if (key === 'custom') continue;
      if (l === key || l === info.label.toLowerCase()) return { kind: key };
    }
    return { kind: 'custom', customLabel: h };  // unknown header → a custom field
  }

  /** Coerce a CSV string into a field value by the kind's type. */
  _recCsvParseVal(kind, v) {
    const type = RECORD_FIELD_KINDS[kind]?.type;
    if (type === 'flag') return /^(1|y|yes|true)/i.test(v);
    if (type === 'threat' || type === 'rating' || type === 'number') {
      const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
      return Number.isNaN(n) ? '' : n;
    }
    if (type === 'date') { try { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d.toISOString(); } catch { return v; } }
    return v;
  }

  /** Add a typed field to this card (from the palette). */
  static _onRecAddField(event, target) {
    const card = target.closest('.ncm-reccard');
    const box = card?.querySelector('[data-rec-fields]');
    const kind = target.dataset.kind;
    if (!box || !kind) return;
    box.insertAdjacentHTML('beforeend', this._recFieldHtml(kind, {}));
    const added = box.lastElementChild;
    added?.querySelector('input:not([type=hidden]), textarea')?.focus();
    this._renderPreview();
  }

  static _onRecRemoveField(event, target) {
    target.closest('.ncm-recfield')?.remove();
    this._renderPreview();
  }

  /** Cycle a card's status through the common words (mirrors the viewer colors). */
  static _onRecStatusCycle(event, target) {
    const vals = ['', 'ACTIVE', 'WANTED', 'FLAGGED', 'MISSING', 'DECEASED', 'CLEARED', 'PENDING', 'CLASSIFIED'];
    const card = target.closest('.ncm-reccard');
    const hidden = card?.querySelector('.ncm-reccard__status-val');
    if (!hidden) return;
    const next = vals[(vals.indexOf(hidden.value) + 1) % vals.length];
    hidden.value = next;
    target.childNodes[0].nodeValue = next ? next + ' ' : 'STATUS ';
    this._renderPreview();
  }

  static _onRecFlag(event, target) {
    const card = target.closest('.ncm-reccard');
    const hidden = card?.querySelector('.ncm-reccard__flag');
    if (!hidden) return;
    const on = !hidden.value;
    hidden.value = on ? '1' : '';
    target.classList.toggle('on', on);
    card.classList.toggle('is-flagged', on);
    this._renderPreview();
  }

  /** Threat/rating pips — click sets 1–N; clicking the top lit pip clears. */
  static _onRecPip(event, target) {
    const field = target.closest('.ncm-recfield');
    const hidden = field?.querySelector('.ncm-recfield__val');
    if (!hidden) return;
    const v = target.dataset.v;
    hidden.value = hidden.value === v ? '' : v;
    const n = Number(hidden.value) || 0;
    field.querySelectorAll('.ncm-recfield__pip').forEach((p, i) => p.classList.toggle('on', (i + 1) <= n));
    this._renderPreview();
  }

  /** Flag-type field (warrant/armed) — toggle YES/no. */
  static _onRecFlagField(event, target) {
    const field = target.closest('.ncm-recfield');
    const hidden = field?.querySelector('.ncm-recfield__val');
    if (!hidden) return;
    const on = !hidden.value;
    hidden.value = on ? '1' : '';
    target.classList.toggle('on', on);
    target.textContent = on ? 'YES' : 'no';
    this._renderPreview();
  }

  /** Record portrait FilePicker (updates the hidden path + the tile preview). */
  static _onRecPortrait(event, target) {
    const card = target.closest('.ncm-reccard');
    const hidden = card?.querySelector('.ncm-reccard__portrait');
    if (!hidden) return;
    new FilePicker({
      type: 'image', current: hidden.value || '',
      callback: (path) => {
        hidden.value = path;
        const init = card.querySelector('.ncm-reccard__name')?.value || '?';
        const initials = init.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
        const inner = path ? `<img src="${Handlebars.escapeExpression(path)}" alt="">` : `<span class="ncm-reccard__init">${Handlebars.escapeExpression(initials)}</span>`;
        target.innerHTML = inner + `<span class="ncm-reccard__cam"><i class="fas fa-camera"></i></span>`;
        this._renderPreview();
      },
    }).render(true);
  }

  /** Read ONE subject card into a record object (shared by collect + duplicate). */
  _collectOneRecord(card) {
    const name = card.querySelector('.ncm-reccard__name')?.value?.trim() || '';
    const portrait = card.querySelector('.ncm-reccard__portrait')?.value?.trim() || '';
    const status = card.querySelector('.ncm-reccard__status-val')?.value?.trim() || '';
    const flagged = !!card.querySelector('.ncm-reccard__flag')?.value;
    const fields = [];
    for (const fEl of card.querySelectorAll('.ncm-recfield')) {
      const kind = fEl.dataset.kind;
      const ftype = fEl.dataset.ftype;
      const valEl = fEl.querySelector('.ncm-recfield__val');
      if (!kind || !valEl) continue;
      let value;
      if (ftype === 'flag') value = !!valEl.value;
      else if (ftype === 'threat' || ftype === 'rating' || ftype === 'number') { value = valEl.value === '' ? '' : Number(valEl.value); if (value === '' || Number.isNaN(value)) continue; }
      else { value = (valEl.value ?? '').trim(); if (!value) continue; }
      const field = { kind, value };
      // A field row may carry an editable label input (custom + date) — store it.
      const keyEl = fEl.querySelector('.ncm-recfield__key');
      if (keyEl) { const lbl = keyEl.value.trim(); if (lbl) field.label = lbl; }
      fields.push(field);
    }
    return { name, portrait, status, flagged, fields };
  }

  /** Walk the record cards into the authored records[] shape. */
  _collectRecords() {
    const out = [];
    const list = this.element?.querySelector('[data-rec-list]');
    if (!list) return out;
    for (const card of list.querySelectorAll('.ncm-reccard')) {
      const r = this._collectOneRecord(card);
      // Drop a wholly-empty card (no name, no fields, no portrait/status).
      if (!r.name && !r.fields.length && !r.portrait && !r.status && !r.flagged) continue;
      out.push(r);
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════
  //  CALENDAR — event-card builder (#34, records-card precedent). Cards are
  //  injected in _onRender and read back by _collectCalendar() walking the
  //  DOM (all inputs are UNNAMED except the CyberTimePicker's randomID-named
  //  hidden `when` target). The category strip [data-cal-cats] owns the
  //  palette: chips are the source of truth for {name: color}; each card
  //  carries data-cat + data-ct-color (the same CSS var hook the renderer
  //  uses, so the editor edge/chips ARE the preview colors). Cards mirror
  //  the render: day/month block + past dimming repaint live, the rail
  //  auto-sorts when a date is picked, and cards collapse/duplicate.
  // ═══════════════════════════════════════════════════════════

  /** One event card. `ev` = the authored event shape (or {} for a blank). */
  _calEventCardHtml(ev = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const uid = `calwhen-${(typeof foundry !== 'undefined' && foundry.utils?.randomID) ? foundry.utils.randomID(8) : Math.floor(Math.random() * 1e8)}`;
    const iso = this._calReconWhen(ev);
    // A legacy free-text time that could NOT merge into the ISO survives as a
    // data attr so re-saving a legacy entry never silently drops it.
    const legacyTime = (ev.time && !/T\d\d:\d\d/.test(iso)) ? String(ev.time) : '';
    const cats = this._calCatsFromStrip();
    const cat = ev.category || '';
    const color = cats.find(c => c.name === cat)?.color || ev.color || 'cyan';
    const locked = !!ev.locked;
    const sceneId = ev.sceneId || '';
    const sceneName = sceneId ? ((typeof game !== 'undefined' && game.scenes?.get?.(sceneId)?.name) || 'scene ✓') : '';
    let whenLabel = 'Set date & time';
    try { if (iso) whenLabel = formatCyberDate(new Date(iso).toISOString()); } catch { whenLabel = iso; }
    const skillOpts = this._skillOptions(ev.unlockSkill || 'Interface')
      .map(s => `<option value="${esc(s.name)}"${s.selected ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    return `<div class="ncm-calev${locked ? ' is-locked' : ''}" data-ct-color="${color}" data-cat="${esc(cat)}" data-scene-id="${esc(sceneId)}"${legacyTime ? ` data-legacy-time="${esc(legacyTime)}"` : ''}>` +
      `<input type="hidden" name="${uid}" class="ncm-calev__when" value="${esc(iso)}">` +
      `<div class="ncm-calev__datecol"><b class="ncm-calev__day" data-cal-day>––</b><span class="ncm-calev__mon" data-cal-mon></span></div>` +
      `<div class="ncm-calev__body">` +
        `<div class="ncm-calev__sum"></div>` +
        `<div class="ncm-calev__main">` +
          `<div class="ncm-calev__row">` +
            `<div class="ncm-ctp-trigger ncm-calev__whenchip" data-action="calWhen" data-target="${uid}" data-tooltip="One picker sets date AND time">` +
              `<i class="fas fa-calendar-days ncm-ctp-trigger__icon"></i>` +
              `<span class="ncm-ctp-trigger__value${iso ? '' : ' ncm-ctp-trigger__value--empty'}">${esc(whenLabel)}</span>` +
              `<i class="fas fa-chevron-down ncm-ctp-trigger__chevron"></i>` +
            `</div>` +
            `<input type="text" class="ncm-calev__title" value="${esc(ev.title)}" placeholder="what happens">` +
          `</div>` +
          `<div class="ncm-calev__cats" data-cal-catrow>${this._calPickChipsHtml(cats, cat)}</div>` +
          `<div class="ncm-calev__row">` +
            `<input type="text" class="ncm-calev__loc ncm-config-input" value="${esc(ev.location)}" placeholder="where">` +
            `<input type="text" class="ncm-calev__who ncm-config-input" value="${esc(ev.who)}" placeholder="who">` +
            `<input type="text" class="ncm-calev__note ncm-config-input" value="${esc(ev.note)}" placeholder="note (optional)">` +
          `</div>` +
          `<div class="ncm-calev__lockrow"${locked ? '' : ' hidden'}>` +
            `<label>DECRYPT</label><select class="ncm-calev__skill ncm-config-input">${skillOpts}</select>` +
            `<label>DV</label><input type="number" class="ncm-calev__dv ncm-config-input" value="${Number(ev.unlockDV) || 15}" min="1">` +
            `<label class="ncm-calev__trace"><input type="checkbox" class="ncm-calev__tracechk"${ev.traceOnFail ? ' checked' : ''}> fail fires a trace</label>` +
          `</div>` +
        `</div>` +
        `<div class="ncm-calev__foot">` +
          `<button type="button" class="ncm-calev__tool${locked ? ' is-on' : ''}" data-action="calLock" data-tooltip="Lock — players see an encrypted entry until they decrypt it"><i class="fas fa-lock"></i></button>` +
          `<button type="button" class="ncm-calev__tool${sceneId ? ' is-on' : ''}" data-action="calScene" data-tooltip="Link a scene — GM gets a Go-to-Scene button"><i class="fas fa-map"></i> <span data-cal-scene-lbl>${esc(sceneName || 'scene')}</span></button>` +
          `<span class="ncm-calev__grow"></span>` +
          `<button type="button" class="ncm-calev__tool" data-action="calDuplicate" data-tooltip="Duplicate this event"><i class="fas fa-clone"></i></button>` +
          `<button type="button" class="ncm-calev__tool" data-action="calToggleCard" data-tooltip="Collapse / expand"><i class="fas fa-chevron-down"></i></button>` +
          `<button type="button" class="ncm-calev__tool ncm-calev__tool--danger" data-action="calRemove" data-tooltip="Remove event"><i class="fas fa-times"></i></button>` +
        `</div>` +
      `</div>` +
    `</div>`;
  }

  /** Legacy `when`(date) + `time`("21:30") → one full ISO for the When picker. */
  _calReconWhen(ev = {}) {
    const iso = ev.when ? String(ev.when) : '';
    if (!iso || /T\d\d:\d\d/.test(iso)) return iso;
    const m = /^(\d{1,2}):(\d{2})/.exec(String(ev.time || '').trim());
    if (m) {
      try {
        const d = new Date(iso);
        if (!Number.isNaN(d.getTime())) { d.setUTCHours(+m[1], +m[2], 0, 0); return d.toISOString(); }
      } catch { /* keep the bare date */ }
    }
    return iso;
  }

  /** The category strip's chips → [{name, color}] (the palette's source of truth). */
  _calCatsFromStrip() {
    return [...(this.element?.querySelectorAll('[data-cal-cats] .ncm-calcat') ?? [])]
      .map(ch => ({ name: ch.dataset.name || '', color: ch.dataset.color || 'cyan' }))
      .filter(c => c.name);
  }

  /** One category chip in the strip (swatch cycles the color; × removes). */
  _calCatChipHtml(name, color) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    return `<span class="ncm-calcat" data-name="${esc(name)}" data-color="${esc(color)}" data-ct-color="${esc(color)}">` +
      `<button type="button" class="ncm-calcat__sw" data-action="calCatColor" data-tooltip="Click to cycle the color"></button>` +
      `<span class="ncm-calcat__nm">${esc(name)}</span>` +
      `<button type="button" class="ncm-calcat__rm" data-action="calCatRemove" data-tooltip="Remove category"><i class="fas fa-times"></i></button>` +
    `</span>`;
  }

  /** A card's category quick-pick row (typo-proof — chips, never free text). */
  _calPickChipsHtml(cats, current) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const label = `<span class="ncm-calev__catlbl">CAT</span>`;
    if (!cats.length) return `${label}<span class="ncm-calev__nocat">add categories above to color-code events</span>`;
    return label + cats.map(c =>
      `<button type="button" class="ncm-calev__pk${c.name === current ? ' is-on' : ''}" data-action="calPickCat" data-name="${esc(c.name)}" data-ct-color="${esc(c.color)}"><span class="ncm-calev__pkdot"></span>${esc(c.name)}</button>`
    ).join('');
  }

  /** Rebuild every card's quick-pick row from the strip (add/remove/recolor). */
  _calSyncCatRows() {
    const cats = this._calCatsFromStrip();
    this.element?.querySelectorAll('[data-cal-list] .ncm-calev').forEach(card => {
      const row = card.querySelector('[data-cal-catrow]');
      if (row) row.innerHTML = this._calPickChipsHtml(cats, card.dataset.cat || '');
    });
  }

  /** Live mirror: day/month block + past dimming + category edge color. */
  _calRepaintCard(card) {
    if (!card) return;
    const iso = card.querySelector('.ncm-calev__when')?.value || '';
    const t = iso ? Date.parse(iso) : NaN;
    const d = Number.isNaN(t) ? null : new Date(t);
    const day = card.querySelector('[data-cal-day]');
    const mon = card.querySelector('[data-cal-mon]');
    if (day) day.textContent = d ? String(d.getUTCDate()).padStart(2, '0') : '––';
    if (mon) mon.textContent = d ? CAL_MONTHS[d.getUTCMonth()] : '';
    let now = Date.now();
    try { now = game.nightcity?.timeService?.getCurrentTimeMs?.() ?? now; } catch { /* real time */ }
    card.classList.toggle('is-past', !!d && t < now);
    const color = this._calCatsFromStrip().find(c => c.name === (card.dataset.cat || ''))?.color || 'cyan';
    card.setAttribute('data-ct-color', color);
  }

  _calRepaintAll() {
    this.element?.querySelectorAll('[data-cal-list] .ncm-calev').forEach(c => this._calRepaintCard(c));
  }

  /** Chronological rail — stable sort by the picked date; undated cards last. */
  _calSortCards() {
    const list = this.element?.querySelector('[data-cal-list]');
    if (!list) return;
    const val = (card) => {
      const t = Date.parse(card.querySelector('.ncm-calev__when')?.value || '');
      return Number.isNaN(t) ? Infinity : t;
    };
    [...list.querySelectorAll(':scope > .ncm-calev')]
      .map((card, i) => ({ card, t: val(card), i }))
      .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t - b.t))
      .forEach(({ card }) => list.appendChild(card));
  }

  /** Commit the inline new-category input → a strip chip (auto-cycled color). */
  _calCommitNewCat() {
    const inp = this.element?.querySelector('[data-cal-newcat]');
    const btn = this.element?.querySelector('[data-action="calCatAdd"]');
    if (!inp) return;
    const name = inp.value.trim();
    inp.value = '';
    inp.hidden = true;
    if (btn) btn.hidden = false;
    if (!name) return;
    const have = this._calCatsFromStrip();
    if (have.some(c => c.name.toLowerCase() === name.toLowerCase())) return;
    const used = new Set(have.map(c => c.color));
    let ci = 0;
    while (used.has(CAL_CATEGORY_CYCLE[ci % CAL_CATEGORY_CYCLE.length]) && ci < CAL_CATEGORY_CYCLE.length) ci++;
    this.element?.querySelector('[data-cal-addwrap]')
      ?.insertAdjacentHTML('beforebegin', this._calCatChipHtml(name, CAL_CATEGORY_CYCLE[ci % CAL_CATEGORY_CYCLE.length]));
    this._calSyncCatRows();
    this._renderPreview();
  }

  /** Walk one card back into the authored event shape (empty optionals dropped). */
  _collectOneCalEvent(card) {
    const v = (sel) => card.querySelector(sel)?.value?.trim() ?? '';
    const ev = {
      title: v('.ncm-calev__title'),
      when: card.querySelector('.ncm-calev__when')?.value || '',
      location: v('.ncm-calev__loc'),
      who: v('.ncm-calev__who'),
      note: v('.ncm-calev__note'),
      category: card.dataset.cat || '',
    };
    if (card.dataset.legacyTime) ev.time = card.dataset.legacyTime; // unmergeable diegetic time survives
    if (card.classList.contains('is-locked')) {
      ev.locked = true;
      ev.unlockSkill = card.querySelector('.ncm-calev__skill')?.value || 'Interface';
      ev.unlockDV = parseInt(card.querySelector('.ncm-calev__dv')?.value) || 15;
      if (card.querySelector('.ncm-calev__tracechk')?.checked) ev.traceOnFail = true;
    }
    if (card.dataset.sceneId) ev.sceneId = card.dataset.sceneId;
    for (const k of ['when', 'location', 'who', 'note', 'category']) if (!ev[k]) delete ev[k];
    return ev;
  }

  /** Walk the strip + cards into the authored calendar contentData. */
  _collectCalendar(data = {}) {
    const categories = {};
    for (const c of this._calCatsFromStrip()) categories[c.name] = c.color;
    const events = [];
    for (const card of this.element?.querySelectorAll('[data-cal-list] .ncm-calev') ?? []) {
      const ev = this._collectOneCalEvent(card);
      if (!ev.title && !ev.when && !ev.location && !ev.who && !ev.note) continue; // blank seed card
      events.push(ev);
    }
    const t = (ev) => { const p = ev.when ? Date.parse(ev.when) : NaN; return Number.isNaN(p) ? Infinity : p; };
    events.sort((a, b) => { const ta = t(a), tb = t(b); return ta === tb ? 0 : ta - tb; });
    return {
      defaultView: data.calDefaultView === 'month' ? 'month' : 'rail',
      categories, events,
    };
  }

  /** CSV date string → ISO. A timezone-less "YYYY-MM-DD[ HH:MM]" reads as UTC
   *  (all stored timestamps are Z — Date.parse would read it as LOCAL time and
   *  silently shift every imported clock by the GM's offset). */
  _calParseCsvWhen(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(s).trim());
    if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))).toISOString();
    const t = Date.parse(s);
    return Number.isNaN(t) ? '' : new Date(t).toISOString();
  }

  /** Import a schedule CSV — replaces the card list; new categories join the strip. */
  _calApplyCsv(text) {
    const grid = this._parseCsv(text);
    if (grid.length < 2) { ui.notifications.warn('NCM | The CSV needs a header row + at least one event.'); return; }
    const heads = grid[0].map(h => String(h).trim().toLowerCase());
    const events = [];
    for (const cells of grid.slice(1, DataShardComposer.SS_IMPORT_ROW_CAP + 1)) {
      const get = (...names) => {
        for (const n of names) { const i = heads.indexOf(n); if (i >= 0 && cells[i] != null && String(cells[i]).trim() !== '') return String(cells[i]).trim(); }
        return '';
      };
      const ev = {
        title: get('title', 'event'), location: get('location', 'where'),
        who: get('who', 'attendees'), note: get('note'), category: get('category', 'cat'),
      };
      let when = get('when', 'date');
      const time = get('time');
      if (when && time && !/T\d\d/.test(when)) when = `${when} ${time}`;
      if (when) {
        const isoWhen = this._calParseCsvWhen(when);
        if (isoWhen) ev.when = isoWhen;
        else { const iso2 = this._calParseCsvWhen(get('when', 'date')); if (iso2) { ev.when = iso2; if (time) ev.time = time; } }
      } else if (time) ev.time = time;
      if (/^(1|y|yes|true)/i.test(get('locked'))) {
        ev.locked = true;
        ev.unlockSkill = get('unlockskill', 'skill') || 'Interface';
        ev.unlockDV = parseInt(get('unlockdv', 'dv')) || 15;
        if (/^(1|y|yes|true)/i.test(get('traceonfail', 'trace'))) ev.traceOnFail = true;
      }
      const sc = get('sceneid', 'scene');
      if (sc) ev.sceneId = sc;
      for (const k of ['location', 'who', 'note', 'category']) if (!ev[k]) delete ev[k];
      if (ev.title || ev.when || ev.location) events.push(ev);
    }
    if (!events.length) { ui.notifications.warn('NCM | No events found in the CSV.'); return; }
    if (grid.length - 1 > DataShardComposer.SS_IMPORT_ROW_CAP) {
      ui.notifications.warn(`NCM | Import capped at the first ${DataShardComposer.SS_IMPORT_ROW_CAP} events.`);
    }
    // New categories join the strip with auto-cycled colors.
    const strip = this.element?.querySelector('[data-cal-cats]');
    const have = new Set(this._calCatsFromStrip().map(c => c.name));
    const used = new Set(this._calCatsFromStrip().map(c => c.color));
    let ci = 0;
    for (const ev of events) {
      const n = ev.category;
      if (!n || have.has(n)) continue;
      while (used.has(CAL_CATEGORY_CYCLE[ci % CAL_CATEGORY_CYCLE.length]) && ci < CAL_CATEGORY_CYCLE.length) ci++;
      const c = CAL_CATEGORY_CYCLE[ci % CAL_CATEGORY_CYCLE.length];
      used.add(c); ci++; have.add(n);
      strip?.querySelector('[data-cal-addwrap]')?.insertAdjacentHTML('beforebegin', this._calCatChipHtml(n, c));
    }
    const list = this.element?.querySelector('[data-cal-list]');
    if (!list) return;
    list.innerHTML = events.map(ev => this._calEventCardHtml(ev)).join('');
    this._calSyncCatRows();
    this._calRepaintAll();
    this._calSortCards();
    ui.notifications.info(`NCM | Imported ${events.length} event(s).`);
    this._renderPreview();
  }

  // ── Calendar actions ──

  static _onCalAddEvent() {
    const list = this.element?.querySelector('[data-cal-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', this._calEventCardHtml({}));
    this._calRepaintCard(list.lastElementChild);
    list.lastElementChild?.querySelector('.ncm-calev__title')?.focus();
    this._renderPreview();
  }

  static _onCalRemove(event, target) {
    target.closest('.ncm-calev')?.remove();
    this._renderPreview();
  }

  /** The ONE When picker (full ISO date+time — the chat #29b pattern). */
  static _onCalWhen(event, target) {
    const card = target.closest('.ncm-calev');
    const hidden = card?.querySelector(`input[name="${target.dataset.target}"]`);
    const valueEl = target.querySelector('.ncm-ctp-trigger__value');
    CyberTimePicker.open({
      value: hidden?.value || '',
      onSet: (iso, formatted) => {
        if (hidden) hidden.value = iso;
        if (valueEl) { valueEl.textContent = formatted; valueEl.classList.remove('ncm-ctp-trigger__value--empty'); }
        delete card?.dataset.legacyTime; // a real clock supersedes the legacy string
        this._calRepaintCard(card);
        this._calSortCards();
        this._renderPreview();
      },
      onClear: () => {
        if (hidden) hidden.value = '';
        if (valueEl) { valueEl.textContent = 'Set date & time'; valueEl.classList.add('ncm-ctp-trigger__value--empty'); }
        this._calRepaintCard(card);
        this._renderPreview();
      },
    });
  }

  /** Category quick-pick — click the active chip again to clear it. */
  static _onCalPickCat(event, target) {
    const card = target.closest('.ncm-calev');
    if (!card) return;
    card.dataset.cat = (card.dataset.cat === target.dataset.name) ? '' : (target.dataset.name || '');
    card.querySelectorAll('[data-action="calPickCat"]').forEach(b => b.classList.toggle('is-on', b.dataset.name === card.dataset.cat));
    this._calRepaintCard(card);
    this._renderPreview();
  }

  static _onCalLock(event, target) {
    const card = target.closest('.ncm-calev');
    if (!card) return;
    const on = card.classList.toggle('is-locked');
    target.classList.toggle('is-on', on);
    const row = card.querySelector('.ncm-calev__lockrow');
    if (row) row.hidden = !on;
    this._renderPreview();
  }

  /** Link a world scene to this event (GM Go-to-Scene in the viewer). */
  static _onCalScene(event, target) {
    const card = target.closest('.ncm-calev');
    if (!card) return;
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const cur = card.dataset.sceneId || '';
    const opts = ['<option value="">— no scene —</option>']
      .concat((game.scenes?.contents ?? []).map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}</option>`))
      .join('');
    new Dialog({
      title: 'Link a Scene',
      content: `<p style="font-size:12px">The GM gets a "Go to Scene" button on this event in the viewer.</p><select name="calScenePick" style="width:100%">${opts}</select>`,
      buttons: {
        ok: {
          label: 'Link',
          callback: (html) => {
            const id = html.find('select[name="calScenePick"]').val() || '';
            card.dataset.sceneId = id;
            const lbl = card.querySelector('[data-cal-scene-lbl]');
            if (lbl) lbl.textContent = id ? (game.scenes?.get(id)?.name || 'scene ✓') : 'scene';
            card.querySelector('[data-action="calScene"]')?.classList.toggle('is-on', !!id);
            this._renderPreview();
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'ok',
    }).render(true);
  }

  /** Collapse / expand a card (DOM-only) — the summary line fills at collapse. */
  static _onCalToggleCard(event, target) {
    const card = target.closest('.ncm-calev');
    if (!card) return;
    const collapsed = card.classList.toggle('is-collapsed');
    const i = target.querySelector('i');
    if (i) i.className = collapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-down';
    if (collapsed) {
      const sum = card.querySelector('.ncm-calev__sum');
      const when = card.querySelector('.ncm-ctp-trigger__value')?.textContent || '';
      const title = card.querySelector('.ncm-calev__title')?.value || 'untitled event';
      if (sum) sum.textContent = [when !== 'Set date & time' ? when : '', title].filter(Boolean).join(' · ');
    }
  }

  /** Duplicate an event — clone into a new expanded card after it. */
  static _onCalDuplicate(event, target) {
    const card = target.closest('.ncm-calev');
    if (!card) return;
    const ev = this._collectOneCalEvent(card);
    ev.title = ev.title ? `${ev.title} (copy)` : '';
    card.insertAdjacentHTML('afterend', this._calEventCardHtml(ev));
    this._calRepaintCard(card.nextElementSibling);
    card.nextElementSibling?.querySelector('.ncm-calev__title')?.focus();
    this._renderPreview();
  }

  static _onCalDefView(event, target) {
    const view = target.dataset.view === 'month' ? 'month' : 'rail';
    const hidden = this.element?.querySelector('[name="calDefaultView"]');
    if (hidden) hidden.value = view;
    this.element?.querySelectorAll('[data-action="calDefView"]').forEach(b => b.classList.toggle('is-on', b.dataset.view === view));
    this._renderPreview();
  }

  /** Reveal the inline new-category input (commit wiring lives in _onRender). */
  static _onCalCatAdd(event, target) {
    const inp = this.element?.querySelector('[data-cal-newcat]');
    if (!inp) return;
    inp.hidden = false;
    target.hidden = true;
    inp.focus();
  }

  /** Cycle a category's color through the CT palette (recolors its events live). */
  static _onCalCatColor(event, target) {
    const chip = target.closest('.ncm-calcat');
    if (!chip) return;
    const next = CT_COLORS[(CT_COLORS.indexOf(chip.dataset.color || 'cyan') + 1) % CT_COLORS.length];
    chip.dataset.color = next;
    chip.setAttribute('data-ct-color', next);
    this._calSyncCatRows();
    this._calRepaintAll();
    this._renderPreview();
  }

  /** Remove a category — its events fall back to the default color. */
  static _onCalCatRemove(event, target) {
    const chip = target.closest('.ncm-calcat');
    const name = chip?.dataset.name;
    chip?.remove();
    this.element?.querySelectorAll('[data-cal-list] .ncm-calev').forEach(card => {
      if (card.dataset.cat === name) card.dataset.cat = '';
    });
    this._calSyncCatRows();
    this._calRepaintAll();
    this._renderPreview();
  }

  // ── Calendar CSV import / export (edit the schedule in Excel) ──

  static _onCalExportCsv() {
    const { events } = this._collectCalendar({});
    if (!events.length) { ui.notifications.warn('NCM | No events to export.'); return; }
    const headers = ['title', 'when', 'location', 'who', 'note', 'category', 'locked', 'unlockSkill', 'unlockDV', 'traceOnFail', 'sceneId'];
    const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.join(',')];
    for (const ev of events) {
      lines.push([
        ev.title, ev.when || '', ev.location || '', ev.who || '', ev.note || '', ev.category || '',
        ev.locked ? 'yes' : '', ev.locked ? (ev.unlockSkill || '') : '', ev.locked ? (ev.unlockDV ?? '') : '',
        ev.traceOnFail ? 'yes' : '', ev.sceneId || '',
      ].map(cell).join(','));
    }
    const name = (this.element?.querySelector('[name="calTitle"]')?.value || 'schedule').replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'schedule';
    saveDataToFile(lines.join('\r\n'), 'text/csv', `${name}.csv`);
  }

  static _onCalImportCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.tsv,.txt,text/csv';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { this._calApplyCsv(String(reader.result || '')); }
        catch (err) { ui.notifications.error(`NCM | CSV import failed: ${err.message}`); }
      };
      reader.onerror = () => ui.notifications.error('NCM | Could not read the file.');
      reader.readAsText(file);
    });
    input.click();
  }

  /** Banking — a ledger line: date · description · amount, in/out chip toggles color. */
  _bankTxnHtml(idx, t = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const credit = t.type === 'credit';
    return `<div class="ncm-cl-row ncm-bankrow${credit ? ' is-credit' : ''}${t.pending ? ' is-pending' : ''}">` +
      `<input type="hidden" name="bankTxns__type-${idx}" value="${esc(t.type || 'debit')}">` +
      `<input type="checkbox" name="bankTxns__pending-${idx}"${t.pending ? ' checked' : ''} class="ncm-wz-flag">` +
      `<input type="text" name="bankTxns__date-${idx}" value="${esc(t.date)}" placeholder="03/12" class="ncm-config-input ncm-bankrow__date">` +
      `<input type="text" name="bankTxns__desc-${idx}" value="${esc(t.desc)}" placeholder="what the money was for" class="ncm-config-input ncm-bankrow__desc">` +
      `<input type="text" name="bankTxns__category-${idx}" value="${esc(t.category)}" list="ncm-bankcat" placeholder="category" class="ncm-config-input ncm-bankrow__cat">` +
      `<button type="button" data-action="wzCycle" data-f="type" data-vals="debit,credit" class="ncm-bankrow__type" data-tooltip="Click to flip debit / credit">${credit ? '▲ credit' : '▼ debit'}</button>` +
      `<input type="number" name="bankTxns__amount-${idx}" value="${esc(t.amount)}" placeholder="0" class="ncm-config-input ncm-bankrow__amt">` +
      `<span class="ncm-wz-tools">` +
        `<button type="button" data-action="wzCheck" data-f="pending" class="ncm-shard-hdr-btn" data-tooltip="Pending — not yet cleared"><i class="fas fa-hourglass-half"></i></button>` +
        `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>` +
      `</span>` +
    `</div>`;
  }

  /** Recompute the Balance field from the transaction rows (credits − debits). */
  static _onBankSyncBalance() {
    const el = this.element;
    if (!el) return;
    let net = 0;
    const txns = this._collectList('bankTxns', BANK_TXN_FIELDS);
    for (const t of txns) {
      const amt = Math.abs(Number(t.amount) || 0);
      net += (t.type === 'credit') ? amt : -amt;
    }
    const bal = el.querySelector('[name="bankBalance"]');
    if (bal) { bal.value = net; bal.dispatchEvent(new Event('input', { bubbles: true })); }
    ui.notifications.info(`NCM | Balance synced to ${net.toLocaleString()} from ${txns.length} transaction(s).`);
    this._renderPreview();
  }

  // ─── Generic WYSIWYG interactions ───

  /** Toggle a schema-checkbox field from a button; the row mirrors it as is-<f>. */
  static _onWzCheck(event, target) {
    const row = target.closest('.ncm-cl-row');
    const f = target.dataset.f;
    const box = row?.querySelector(`[name*="__${f}-"]`);
    if (!box) return;
    box.checked = !box.checked;
    row.classList.toggle(`is-${f}`, box.checked);
    if (f === 'mark') row.classList.toggle('is-mark', box.checked);
    this._renderPreview();
  }

  /** Cycle a value list into the field's (hidden) input, then repaint. */
  static _onWzCycle(event, target) {
    const row = target.closest('.ncm-cl-row');
    const f = target.dataset.f;
    const vals = (target.dataset.vals || '').split(',');
    const input = row?.querySelector(`[name*="__${f}-"]`);
    if (!input || !vals.length) return;
    input.value = vals[(vals.indexOf(input.value) + 1) % vals.length];
    this._wzRepaint(row);
    this._renderPreview();
  }

  /** Credential eye — show/hide the secret (editor-only). */
  static _onWzReveal(event, target) {
    const inp = target.closest('.ncm-credcard__secretwrap')?.querySelector('input');
    if (!inp) return;
    inp.type = inp.type === 'password' ? 'text' : 'password';
    const i = target.querySelector('i');
    if (i) i.className = inp.type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
  }

  /** Strength pips — click sets 1–4, clicking the lit pip clears. */
  static _onWzPip(event, target) {
    const row = target.closest('.ncm-cl-row');
    const input = row?.querySelector('[name*="__strength-"]');
    if (!input) return;
    input.value = input.value === target.dataset.v ? '' : target.dataset.v;
    this._wzRepaint(row);
    this._renderPreview();
  }

  /** Repaint a row's derived visuals from its hidden values. */
  _wzRepaint(row) {
    const sev = row.querySelector('[name*="__sev-"]');
    if (sev) {
      row.classList.remove('sev-info', 'sev-ok', 'sev-warn', 'sev-err', 'sev-debug');
      row.classList.add(`sev-${sev.value || 'info'}`);
      const chip = row.querySelector('.ncm-slog__sev');
      if (chip) chip.textContent = (sev.value || 'info').toUpperCase();
    }
    const strength = row.querySelector('[name*="__strength-"]');
    if (strength) {
      row.querySelectorAll('.ncm-credcard__pip').forEach(p =>
        p.classList.toggle('on', Number(p.dataset.v) <= Number(strength.value || 0)));
    }
    const btype = row.querySelector('[name*="__type-"]');
    if (btype && row.classList.contains('ncm-bankrow')) {
      row.classList.toggle('is-credit', btype.value === 'credit');
      const t = row.querySelector('.ncm-bankrow__type');
      if (t) t.textContent = btype.value === 'credit' ? '▲ credit' : '▼ debit';
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  CHAT LOG — WYSIWYG editor (write the conversation like a texting app;
  //  bubbles carry hidden chatMsgs__* inputs so collect/prefill are untouched)
  // ═══════════════════════════════════════════════════════════

  /** One chat bubble (a .ncm-cl-row so _collectList sees it). */
  // ── Chat editor (data-attr bubbles; custom _collectChat) ──

  /** One bubble — whole message state lives in data-attrs; visible parts derived. */
  _chatBubbleHtml(idx, m = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const kind = (m.kind === 'photo' || m.kind === 'system') ? m.kind : 'text';
    const reacts = Array.isArray(m.reactions) ? m.reactions.join(',') : (m.reactions || '');
    const attrs = `data-kind="${esc(kind)}" data-from="${esc(m.from)}" data-text="${esc(m.text)}" ` +
      `data-time="${esc(m.time)}" data-date="${esc(m.date)}" data-when="${esc(m.when)}" data-image="${esc(m.image)}" ` +
      `data-caption="${esc(m.caption)}" data-system="${esc(m.system)}" data-sysicon="${esc(m.sysIcon || 'circle-info')}" ` +
      `data-seen="${m.seen ? '1' : ''}" data-seentime="${esc(m.seenTime)}" data-reactions="${esc(reacts)}"`;
    let inner;
    if (kind === 'system') {
      inner = `<span class="ncm-chatedit__sys"><i class="fas fa-${esc(m.sysIcon || 'circle-info')}"></i> ${esc(m.system || m.text || 'system notice')}${m.time ? ` · ${esc(m.time)}` : ''}</span>`;
    } else if (kind === 'photo') {
      inner = `<b class="ncm-chatedit__from">${esc(m.from || '?')}</b>` +
        `<span class="ncm-chatedit__text"><i class="fas fa-image"></i> ${esc(m.caption || 'photo')}${m.image ? '' : ' (no image)'}</span>` +
        `<span class="ncm-chatedit__time">${esc(m.time || '')}</span>`;
    } else {
      inner = `<b class="ncm-chatedit__from">${esc(m.from || '?')}</b>` +
        `<span class="ncm-chatedit__text">${m.deleted ? '<i>message deleted</i>' : esc(m.text || '')}</span>` +
        `<span class="ncm-chatedit__time">${esc(m.time || '')}</span>`;
    }
    const reactChips = reacts ? `<span class="ncm-chatedit__reacts">${reacts.split(',').filter(Boolean).map(e => esc(e)).join(' ')}</span>` : '';
    const tools = kind === 'system'
      ? `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>`
      : `<button type="button" data-action="chatReactAdd" class="ncm-shard-hdr-btn" data-tooltip="Add reaction"><i class="fas fa-face-smile"></i></button>` +
        `<button type="button" data-action="chatSeen" class="ncm-shard-hdr-btn${m.seen ? ' is-active' : ''}" data-tooltip="Mark as Seen"><i class="fas fa-check-double"></i></button>` +
        `<button type="button" data-action="chatTombstone" class="ncm-shard-hdr-btn" data-tooltip="Tombstone (deleted message)"><i class="fas fa-ghost"></i></button>` +
        `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger" data-tooltip="Remove"><i class="fas fa-times"></i></button>`;
    return `<div class="ncm-cl-row ncm-chatedit__msg ncm-chatedit__msg--${kind}${m.deleted ? ' is-del' : ''}${m.seen ? ' is-seen' : ''}" ${attrs}>` +
      `<div class="ncm-chatedit__bubble" data-action="chatEditMsg" data-tooltip="Click to edit">${inner}</div>` +
      reactChips +
      `<span class="ncm-chatedit__tools">${tools}</span>` +
    `</div>`;
  }

  /** Owner's bubbles sit right — resync every non-system message against chatMe. */
  _chatSyncSides() {
    const el = this.element;
    if (!el) return;
    const me = (el.querySelector('[name="chatMe"]')?.value || '').trim().toLowerCase();
    el.querySelectorAll('.ncm-chatedit__msg').forEach(row => {
      if (row.dataset.kind === 'system') return;
      row.classList.toggle('is-me', !!me && (row.dataset.from || '').trim().toLowerCase() === me);
    });
  }

  /** The composer's active message type ('text' | 'photo' | 'system'). */
  get _chatType() { return this._chatTypeVal || 'text'; }
  set _chatType(v) { this._chatTypeVal = v; }

  /** Resolve the compose When → { when(ISO), date(ISO date), time(display) }.
   *  Falls back to an editing bubble's stored stamp when When is unset. */
  _chatWhen() {
    const el = this.element;
    const iso = (el?.querySelector('[name="chatWhen"]')?.value || '').trim();
    if (iso) {
      let time = '';
      try { time = formatCyberDate(new Date(iso).toISOString(), { timeOnly: true }); } catch { time = ''; }
      return { when: iso, date: iso.slice(0, 10), time };
    }
    if (this._chatEditRow) { const d = this._chatEditRow.dataset; return { when: d.when || '', date: d.date || '', time: d.time || '' }; }
    return { when: '', date: '', time: '' };
  }

  /** Send / Update from the compose bar (Enter or the button). */
  _chatSend() {
    const el = this.element;
    if (!el) return;
    const type = this._chatType;
    const val = (sel) => el.querySelector(sel)?.value?.trim() || '';
    const sender = val('[data-chat-sender]');
    const text = val('[data-chat-text]');
    const image = val('[data-chat-image]');
    const { when, date, time } = this._chatWhen();
    const stamp = { time, date, when };

    // Build the message object for this type.
    let m;
    if (type === 'system') {
      if (!text) return;
      m = { kind: 'system', system: text, sysIcon: el.querySelector('[data-chat-syspreset]')?.selectedOptions?.[0]?.dataset?.icon || 'circle-info', ...stamp };
    } else if (type === 'photo') {
      if (!image && !text) return;
      m = { kind: 'photo', from: sender || '?', image, caption: text, ...stamp };
    } else {
      if (!text && !this._chatEditRow) return;
      m = { kind: 'text', from: sender || '?', text, ...stamp };
    }

    if (this._chatEditRow?.isConnected) {
      // Preserve reactions/seen on edit; swap the rest.
      const prev = this._chatEditRow.dataset;
      m.reactions = prev.reactions || '';
      m.seen = prev.seen === '1'; m.seenTime = prev.seentime || '';
      m.deleted = this._chatEditRow.classList.contains('is-del');
      this._chatEditRow.outerHTML = this._chatBubbleHtml(0, this._normChatMsg(m));
      this._chatEditDone();
    } else {
      const container = el.querySelector('[data-list="chatMsgs"]');
      if (!container) return;
      container.insertAdjacentHTML('beforeend', this._chatBubbleHtml(container.querySelectorAll('.ncm-cl-row').length, this._normChatMsg(m)));
      container.scrollTop = container.scrollHeight;
    }
    // Clear the message body + image; sender/When/type stick for rapid entry.
    const t = el.querySelector('[data-chat-text]'); if (t) { t.value = ''; t.focus(); }
    const im = el.querySelector('[data-chat-image]'); if (im) im.value = '';
    this._chatSetAttachLabel('');
    this._chatSyncSides();
    this._syncChatSenderChips();
    this._renderPreview();
  }

  /** Update the photo Attach chip label (filename or the default prompt). */
  _chatSetAttachLabel(path) {
    const lbl = this.element?.querySelector('[data-chat-attach-label]');
    const btn = this.element?.querySelector('[data-chat-attach]');
    if (!lbl || !btn) return;
    const name = path ? String(path).split(/[\\/]/).pop() : '';
    lbl.textContent = name || 'Attach image';
    btn.classList.toggle('is-set', !!name);
  }

  /** Normalize a compose-bar message for the bubble builder (reactions as array). */
  _normChatMsg(m) {
    return { ...m, reactions: typeof m.reactions === 'string' ? m.reactions.split(',').filter(Boolean) : (m.reactions || []) };
  }

  /** Leave bubble-edit mode (restore the Send button + the sticky When). */
  _chatEditDone() {
    this._chatEditRow?.classList?.remove('is-editing');
    this._chatEditRow = null;
    const btn = this.element?.querySelector('[data-chat-send]');
    if (btn) btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
    // Restore the compose (sticky) When after an edit borrowed the field.
    if (this._chatStickyWhen !== undefined) {
      const h = this.element?.querySelector('[name="chatWhen"]');
      if (h) h.value = this._chatStickyWhen;
      this._chatStickyWhen = undefined;
      this._paintChatWhen();
    }
  }

  static _onChatSend() { this._chatSend(); }

  /** Click a bubble → load it into the compose bar (type + When too). */
  static _onChatEditMsg(event, target) {
    const row = target.closest('.ncm-cl-row');
    if (!row) return;
    this._chatEditDone();
    this._chatEditRow = row;
    row.classList.add('is-editing');
    const d = row.dataset;
    this._setChatType(d.kind || 'text');
    const set = (sel, v) => { const i = this.element?.querySelector(sel); if (i) i.value = v; };
    set('[data-chat-sender]', d.from || '');
    set('[data-chat-text]', d.kind === 'photo' ? (d.caption || '') : (d.system || d.text || ''));
    set('[data-chat-image]', d.image || '');
    this._chatSetAttachLabel(d.image || '');
    // Borrow the When field for this edit (restored in _chatEditDone). Legacy
    // messages (no ISO `when`) reconstruct from date + display time.
    const h = this.element?.querySelector('[name="chatWhen"]');
    if (h) { this._chatStickyWhen = h.value; h.value = d.when || this._reconWhen(d.date, d.time); this._paintChatWhen(); }
    const btn = this.element?.querySelector('[data-chat-send]');
    if (btn) btn.innerHTML = '<i class="fas fa-check"></i> Update';
    this.element?.querySelector('[data-chat-text]')?.focus();
  }

  /** Best-effort ISO from a stored date + display-time string (legacy edit). */
  _reconWhen(date, time) {
    if (!date) return '';
    try { const d = new Date(`${date} ${time || '00:00'}`); if (!Number.isNaN(d.getTime())) return d.toISOString(); } catch { /* ignore */ }
    return `${date}T00:00:00.000Z`;
  }

  static _onChatTombstone(event, target) {
    const row = target.closest('.ncm-cl-row');
    if (!row || row.dataset.kind === 'system') return;
    const del = !(row.dataset.deleted === '1');
    row.dataset.deleted = del ? '1' : '';
    row.classList.toggle('is-del', del);
    const t = row.querySelector('.ncm-chatedit__text');
    if (t) t.innerHTML = del ? '<i>message deleted</i>' : Handlebars.escapeExpression(row.dataset.text || '');
    this._renderPreview();
  }

  /** Mark a bubble Seen (a receipt shows after it in the viewer). */
  static _onChatSeen(event, target) {
    const row = target.closest('.ncm-cl-row');
    if (!row) return;
    const on = !(row.dataset.seen === '1');
    row.dataset.seen = on ? '1' : '';
    if (on && !row.dataset.seentime) row.dataset.seentime = row.dataset.time || '';
    row.classList.toggle('is-seen', on);
    target.classList.toggle('is-active', on);
    this._renderPreview();
  }

  // ── Sender chips + owner ──

  /** Rebuild the sender quick-pick chips from the bubbles + owner; also the datalist. */
  _syncChatSenderChips() {
    const el = this.element;
    if (!el) return;
    const names = [];
    el.querySelectorAll('.ncm-chatedit__msg').forEach(r => {
      if (r.dataset.kind === 'system') return;
      const f = (r.dataset.from || '').trim();
      if (f && f !== '?' && !names.includes(f)) names.push(f);
    });
    const me = (el.querySelector('[name="chatMe"]')?.value || '').trim();
    if (me && !names.includes(me)) names.push(me);
    const active = (el.querySelector('[data-chat-sender]')?.value || '').trim().toLowerCase();
    const box = el.querySelector('[data-chat-chips]');
    if (box) {
      box.innerHTML = names.map(n => {
        const owner = n.toLowerCase() === me.toLowerCase() && !!me;
        const on = n.toLowerCase() === active;
        return `<button type="button" class="ncm-chat-chip${on ? ' is-on' : ''}${owner ? ' is-owner' : ''}" data-action="chatPickSender" data-name="${Handlebars.escapeExpression(n)}">` +
          `<span class="ncm-chat-chip__dot"></span>${Handlebars.escapeExpression(n)}` +
          `<span class="ncm-chat-chip__star" data-action="chatSetOwner" data-name="${Handlebars.escapeExpression(n)}" data-tooltip="Set as device owner (bubbles right)"><i class="fas fa-star"></i></span></button>`;
      }).join('');
    }
    const dl = el.querySelector('[data-chat-senders]');
    if (dl) dl.innerHTML = names.map(n => `<option value="${Handlebars.escapeExpression(n)}">`).join('');
  }

  static _onChatPickSender(event, target) {
    const name = target.dataset.name || '';
    const inp = this.element?.querySelector('[data-chat-sender]');
    if (inp) inp.value = name;
    this._syncChatSenderChips();
    this.element?.querySelector('[data-chat-text]')?.focus();
  }

  static _onChatSetOwner(event, target) {
    event.stopPropagation();
    const name = target.dataset.name || '';
    const hidden = this.element?.querySelector('[name="chatMe"]');
    if (!hidden) return;
    // Toggle: clicking the current owner clears it.
    hidden.value = (hidden.value.trim().toLowerCase() === name.toLowerCase()) ? '' : name;
    this._chatSyncSides();
    this._syncChatSenderChips();
    this._renderPreview();
  }

  /** Reveal the inline "new sender" input. */
  static _onChatNewSender() {
    const inp = this.element?.querySelector('[data-chat-sender]');
    if (inp) { inp.hidden = false; inp.value = ''; inp.focus(); }
  }

  // ── Type toggle + When ──

  _setChatType(type) {
    this._chatType = type;
    const el = this.element;
    if (!el) return;
    el.querySelectorAll('.ncm-chat-seg button').forEach(b => b.classList.toggle('is-on', b.dataset.t === type));
    const show = (sel, on) => { const n = el.querySelector(sel); if (n) n.hidden = !on; };
    show('[data-chat-attach]', type === 'photo');
    show('[data-chat-syspreset]', type === 'system');
    // The sender row is irrelevant for system notices.
    el.querySelector('[data-chat-srow]')?.toggleAttribute('hidden', type === 'system');
    const t = el.querySelector('[data-chat-text]');
    if (t) t.placeholder = type === 'photo' ? 'caption (optional) — Enter sends' : type === 'system' ? 'notice text' : "type like you're texting… Enter sends";
  }

  static _onChatType(event, target) { this._setChatType(target.dataset.t || 'text'); }

  /** Paint the sticky When chip label (date + time) from the hidden value. */
  _paintChatWhen() {
    const el = this.element;
    const iso = el?.querySelector('[name="chatWhen"]')?.value || '';
    const span = el?.querySelector('.ncm-chat-whenchip .ncm-ctp-trigger__value');
    if (!span) return;
    let label = 'Set date & time';
    try { if (iso) label = formatCyberDate(new Date(iso).toISOString()); } catch { label = iso; }
    span.textContent = label;
    span.classList.toggle('ncm-ctp-trigger__value--empty', !iso);
  }

  // ── Emoji palette ──

  static _onChatEmoji(event, target) {
    const pop = this.element?.querySelector('[data-chat-emojipop]');
    if (!pop) return;
    this._chatEmojiTarget = target.dataset.target === 'react' ? 'react' : 'text';
    this._chatReactRow = null; // compose-bar emoji, not a bubble reaction
    if (pop.hidden || pop.dataset.mode !== 'text') { this._buildEmojiPop(pop, 'text'); pop.hidden = false; pop.dataset.mode = 'text'; }
    else pop.hidden = true;
  }

  /** Per-bubble reaction — open the palette targeting that bubble. */
  static _onChatReactAdd(event, target) {
    const row = target.closest('.ncm-cl-row');
    const pop = this.element?.querySelector('[data-chat-emojipop]');
    if (!row || !pop) return;
    this._chatReactRow = row;
    this._buildEmojiPop(pop, 'react');
    pop.hidden = false; pop.dataset.mode = 'react';
  }

  _buildEmojiPop(pop, mode) {
    pop.innerHTML = Object.entries(CHAT_EMOJI).map(([cat, list]) =>
      `<div class="ncm-chat-emcat">${mode === 'react' ? 'React · ' : ''}${cat}</div>` +
      `<div class="ncm-chat-emgrid">${list.map(e => `<button type="button" class="ncm-chat-em" data-action="chatEmojiPick" data-e="${e}">${e}</button>`).join('')}</div>`
    ).join('');
  }

  static _onChatEmojiPick(event, target) {
    const e = target.dataset.e || '';
    const pop = this.element?.querySelector('[data-chat-emojipop]');
    if (this._chatReactRow?.isConnected) {
      // Append to the bubble's reactions.
      const row = this._chatReactRow;
      const cur = (row.dataset.reactions || '').split(',').filter(Boolean);
      cur.push(e);
      row.dataset.reactions = cur.join(',');
      let chip = row.querySelector('.ncm-chatedit__reacts');
      if (!chip) { row.querySelector('.ncm-chatedit__bubble').insertAdjacentHTML('afterend', '<span class="ncm-chatedit__reacts"></span>'); chip = row.querySelector('.ncm-chatedit__reacts'); }
      chip.textContent = cur.join(' ');
      if (pop) pop.hidden = true;
      this._renderPreview();
    } else {
      // Insert into the message text at the caret.
      const inp = this.element?.querySelector('[data-chat-text]');
      if (inp) {
        const s = inp.selectionStart ?? inp.value.length;
        inp.value = inp.value.slice(0, s) + e + inp.value.slice(inp.selectionEnd ?? s);
        inp.focus(); inp.selectionStart = inp.selectionEnd = s + e.length;
      }
      // Palette stays open for multiple inserts.
    }
  }

  static _onChatBrowsePhoto() {
    const inp = this.element?.querySelector('[data-chat-image]');
    if (!inp) return;
    new FilePicker({ type: 'image', current: inp.value || '', callback: (path) => { inp.value = path; this._chatSetAttachLabel(path); } }).render(true);
  }

  /** Walk the chat bubbles into the authored messages[] shape. */
  _collectChat() {
    const out = [];
    const container = this.element?.querySelector('[data-list="chatMsgs"]');
    if (!container) return out;
    for (const row of container.querySelectorAll('.ncm-chatedit__msg')) {
      const d = row.dataset;
      const kind = d.kind || 'text';
      const time = (d.time || '').trim();
      const date = (d.date || '').trim();
      const when = (d.when || '').trim();
      const stamp = { ...(time ? { time } : {}), ...(date ? { date } : {}), ...(when ? { when } : {}) };
      if (kind === 'system') {
        const system = (d.system || '').trim();
        if (!system) continue;
        out.push({ kind: 'system', system, sysIcon: d.sysicon || 'circle-info', ...stamp });
        continue;
      }
      const from = (d.from || '').trim();
      const reactions = (d.reactions || '').split(',').filter(Boolean);
      const base = { from, ...stamp };
      if (reactions.length) base.reactions = reactions;
      if (d.seen === '1') { base.seen = true; if (d.seentime) base.seenTime = d.seentime; }
      if (kind === 'photo') {
        const image = (d.image || '').trim(); const caption = (d.caption || '').trim();
        if (!image && !caption) continue;
        out.push({ kind: 'photo', image, caption, ...base });
      } else {
        const text = (d.text || '').trim();
        const deleted = row.classList.contains('is-del') || d.deleted === '1';
        if (!text && !deleted) continue;
        out.push({ text, ...(deleted ? { deleted: true } : {}), ...base });
      }
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════
  //  RICH-TEXT BODY EDITOR (message) — a formatting toolbar over a
  //  contenteditable surface. The hidden textarea mirrors its HTML for
  //  FormDataExtended; _collectEntryData reads the surface directly. Toolbar/
  //  popover controls preventDefault mousedown (wired in _onRender) so the
  //  surface keeps its selection while a command runs.
  // ═══════════════════════════════════════════════════════════

  /** Mirror the editable surface into the hidden textarea + refresh the preview. */
  _rteSync() {
    const rte = this.element?.querySelector('[data-rte]');
    if (!rte) return;
    const surface = rte.querySelector('[data-rte-surface]');
    const sync = rte.querySelector('[data-rte-sync]');
    if (surface && sync) sync.value = surface.innerHTML;
    this._renderPreview();
  }

  /** Run a document.execCommand formatting command on the surface selection. */
  static _onRteCmd(event, target) {
    const cmd = target.dataset.cmd;
    if (!cmd) return;
    try { document.execCommand(cmd, false, target.dataset.val || null); } catch (err) { log.warn(`RTE ${cmd} failed: ${err.message}`); }
    this.element?.querySelector('[data-rte-surface]')?.focus();
    this._rteSync();
    this._rteRefreshState();
  }

  /** Light the toolbar buttons for formats active at the caret (queryCommandState). */
  _rteRefreshState() {
    const rte = this.element?.querySelector('[data-rte]');
    if (!rte || rte.classList.contains('is-raw')) return;
    rte.querySelectorAll('.ncm-rte__tool[data-cmd]').forEach(btn => {
      const cmd = btn.dataset.cmd;
      let on = false;
      try {
        if (cmd === 'formatBlock') { const b = (document.queryCommandValue('formatBlock') || '').toLowerCase(); on = b === (btn.dataset.val || '').toLowerCase(); }
        else if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) on = document.queryCommandState(cmd);
      } catch { on = false; }
      btn.classList.toggle('is-active', on);
    });
  }

  /** Toggle the raw-HTML source view (edit the underlying markup directly). */
  static _onRteRaw(event, target) {
    const rte = this.element?.querySelector('[data-rte]');
    if (!rte) return;
    const surface = rte.querySelector('[data-rte-surface]');
    const ta = rte.querySelector('[data-rte-sync]');
    const raw = rte.classList.toggle('is-raw');
    target.classList.toggle('is-active', raw);
    if (raw) {
      if (ta && surface) { ta.value = surface.innerHTML; ta.hidden = false; }
      if (surface) surface.hidden = true;
      ta?.focus();
    } else {
      if (surface && ta) surface.innerHTML = ta.value;
      if (ta) ta.hidden = true;
      if (surface) surface.hidden = false;
      this._rteSync();
    }
  }

  /** Insert a link over the selection (a Dialog — robust across browser/Electron). */
  static async _onRteLink() {
    const surface = this.element?.querySelector('[data-rte-surface]');
    // Save the selection — the Dialog steals focus, so execCommand would target nothing.
    const sel = window.getSelection?.();
    const range = (sel && sel.rangeCount && surface?.contains(sel.anchorNode)) ? sel.getRangeAt(0).cloneRange() : null;
    const url = await new Promise((resolve) => {
      let val = '';
      new Dialog({
        title: 'Insert Link',
        content: '<input type="text" name="rte-url" placeholder="https://…" style="width:100%" autofocus>',
        buttons: {
          ok: { icon: '<i class="fas fa-link"></i>', label: 'Insert', callback: (html) => { val = (html.find('[name="rte-url"]').val() || '').trim(); } },
          cancel: { label: 'Cancel' },
        },
        default: 'ok',
        close: () => resolve(val),
      }).render(true);
    });
    if (!url) return;
    surface?.focus();
    if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
    try { document.execCommand('createLink', false, url); } catch { /* ignore */ }
    this._rteSync();
  }

  /** Toggle the text-color swatch popover. */
  static _onRteColor() {
    const pop = this.element?.querySelector('[data-rte-pop]');
    if (!pop) return;
    if (!pop.hidden && pop.dataset.mode === 'color') { pop.hidden = true; return; }
    pop.dataset.mode = 'color';
    pop.innerHTML = `<div class="ncm-rte__swatches">${RTE_COLORS.map(c => `<button type="button" class="ncm-rte__swatch" data-action="rteColorPick" data-hex="${c}" style="background:${c}"></button>`).join('')}<button type="button" class="ncm-rte__swatch ncm-rte__swatch--clear" data-action="rteColorPick" data-hex="" data-tooltip="Default color"><i class="fas fa-ban"></i></button></div>`;
    pop.hidden = false;
  }

  static _onRteColorPick(event, target) {
    const hex = target.dataset.hex || '';
    this.element?.querySelector('[data-rte-surface]')?.focus();
    try { document.execCommand('foreColor', false, hex || 'inherit'); } catch { /* ignore */ }
    const pop = this.element?.querySelector('[data-rte-pop]'); if (pop) pop.hidden = true;
    this._rteSync();
  }

  /** Toggle the emoji popover (reuses the chat palette). */
  static _onRteEmoji() {
    const pop = this.element?.querySelector('[data-rte-pop]');
    if (!pop) return;
    if (!pop.hidden && pop.dataset.mode === 'emoji') { pop.hidden = true; return; }
    pop.dataset.mode = 'emoji';
    pop.innerHTML = Object.entries(CHAT_EMOJI).map(([cat, list]) =>
      `<div class="ncm-chat-emcat">${cat}</div><div class="ncm-chat-emgrid">${list.map(e => `<button type="button" class="ncm-chat-em" data-action="rteEmojiPick" data-e="${e}">${e}</button>`).join('')}</div>`
    ).join('');
    pop.hidden = false;
  }

  static _onRteEmojiPick(event, target) {
    const e = target.dataset.e || '';
    this.element?.querySelector('[data-rte-surface]')?.focus();
    try { document.execCommand('insertText', false, e); } catch { /* ignore */ }
    // Palette stays open for multiple inserts.
    this._rteSync();
  }

  // ═══════════════════════════════════════════════════════════
  //  SCHEMATIC — interactive blueprint stage (markers · routes · fog)
  //  The stage DOM is the source of truth: pins are .ncm-schem-pin
  //  spans carrying data-attrs, routes live in this._schemRoutes.
  //  _collectSchematic() walks them into the authored shape.
  // ═══════════════════════════════════════════════════════════

  /** Palette buttons: Select · Route · one chip per marker type. */
  _schemPaletteHtml() {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const btn = (tool, icon, title, color) =>
      `<button type="button" class="ncm-schem-tool${this._schemTool === tool ? ' is-active' : ''}" ` +
      `data-schem-tool="${esc(tool)}"${color ? ` data-ct-color="${esc(color)}"` : ''} ` +
      `data-tooltip="${esc(title)}"><i class="${esc(icon)}"></i></button>`;
    let html = btn('select', 'fas fa-arrow-pointer', 'Select / move a pin') +
               btn('route', 'fas fa-route', 'Route: click two pins to link');
    html += '<span class="ncm-schem-tool__div"></span>';
    // Group markers the same way the legend does.
    const order = ['Entry / Exit', 'Access', 'Security', 'Objective', 'Points'];
    const groups = {};
    for (const [key, info] of Object.entries(SCHEM_MARKERS)) {
      (groups[info.group] ??= []).push([key, info]);
    }
    for (const g of order) {
      for (const [key, info] of (groups[g] || [])) {
        html += btn(key, info.icon, info.label, info.color);
      }
    }
    return html;
  }

  /** Normalize a stored annotation into the editor's pin shape (ensures id). */
  _normSchemPin(a = {}, i = 0) {
    return {
      id: a.id || `p${++this._schemPinSeq}`,
      x: Math.max(0, Math.min(100, Number(a.x) || 50)),
      y: Math.max(0, Math.min(100, Number(a.y) || 50)),
      type: a.type || 'pin',
      label: a.label || '',
      note: a.note || '',
      color: a.color || '',
      sceneId: a.sceneId || '',
      locked: !!a.locked,
      unlockSkill: a.unlockSkill || '',
      unlockDV: a.unlockDV != null ? String(a.unlockDV) : '',
    };
  }

  /** Build (and append) one pin element on the stage from a pin object. */
  _schemAddPinEl(stage, pin) {
    const info = schemMarkerInfo(pin.type);
    const color = pin.color || info.color || 'cyan';
    const el = document.createElement('span');
    el.className = 'ncm-schem-pin' + (pin.locked ? ' is-locked' : '');
    el.dataset.id = pin.id;
    el.dataset.x = pin.x; el.dataset.y = pin.y;
    el.dataset.type = pin.type;
    el.dataset.label = pin.label;
    el.dataset.note = pin.note;
    el.dataset.color = pin.color;
    el.dataset.scene = pin.sceneId;
    el.dataset.locked = pin.locked ? '1' : '0';
    el.dataset.unlockSkill = pin.unlockSkill;
    el.dataset.unlockDv = pin.unlockDV;
    el.dataset.ctColor = color;
    el.setAttribute('data-ct-color', color);
    el.style.left = `${pin.x}%`;
    el.style.top = `${pin.y}%`;
    el.innerHTML = `<i class="${Handlebars.escapeExpression(pin.locked ? 'fas fa-question' : info.icon)}"></i>` +
                   `<b class="ncm-schem-pin__n"></b>`;
    stage.appendChild(el);
    return el;
  }

  /** Renumber pins in placement order (cosmetic, matches the legend). */
  _schemRenumber(stage) {
    stage.querySelectorAll('.ncm-schem-pin').forEach((p, i) => {
      const n = p.querySelector('.ncm-schem-pin__n');
      if (n) n.textContent = i + 1;
    });
  }

  /** Redraw the route SVG from this._schemRoutes, dropping orphans. */
  _schemRedrawRoutes(stage) {
    const svg = stage.querySelector('[data-schem-routes]');
    if (!svg) return;
    const pos = {};
    stage.querySelectorAll('.ncm-schem-pin').forEach(p => {
      pos[p.dataset.id] = { x: parseFloat(p.dataset.x), y: parseFloat(p.dataset.y) };
    });
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    let lines = '';
    for (const r of (this._schemRoutes || [])) {
      const a = pos[r.from], b = pos[r.to];
      if (!a || !b) continue;
      lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ` +
               `data-ct-color="${esc(r.color || 'cyan')}" data-from="${esc(r.from)}" data-to="${esc(r.to)}"/>`;
    }
    svg.innerHTML = lines;
  }

  /** Wire the whole interactive stage on render (idempotent per render). */
  _wireSchemStage(el) {
    const stage = el.querySelector('[data-schem-stage]');
    const palette = el.querySelector('[data-schem-palette]');
    if (!stage || !palette) return;
    if (this._schemPinSeq == null) this._schemPinSeq = 0;
    if (!this._schemTool) this._schemTool = 'select';
    this._schemRouteFrom = null;
    stage.dataset.tool = this._schemTool;

    palette.innerHTML = this._schemPaletteHtml();

    // Image + seed pins/routes (only when the freshly-rendered stage is empty).
    const cd0 = (this.editData?.contentType === CONTENT_TYPES.SCHEMATIC) ? (this.editData.contentData ?? {}) : {};
    const img = stage.querySelector('[data-schem-img]');
    const url = el.querySelector('[name="schemImageUrl"]')?.value?.trim() || cd0.imageUrl || '';
    if (img) img.src = url;
    stage.hidden = !url;
    if (!stage.querySelector('.ncm-schem-pin')) {
      this._schemPinSeq = 0;
      (cd0.annotations || []).forEach((a, i) => this._schemAddPinEl(stage, this._normSchemPin(a, i)));
      this._schemRoutes = (cd0.routes || []).map(r => ({ from: r.from, to: r.to, color: r.color }));
    }
    this._schemRenumber(stage);
    this._schemRedrawRoutes(stage);

    // ── Palette: pick a tool ──
    palette.addEventListener('click', (e) => {
      const b = e.target.closest('[data-schem-tool]');
      if (!b) return;
      this._schemTool = b.dataset.schemTool;
      this._schemRouteFrom = null;
      stage.dataset.tool = this._schemTool;
      palette.querySelectorAll('[data-schem-tool]').forEach(x => x.classList.toggle('is-active', x === b));
      stage.querySelectorAll('.ncm-schem-pin.is-routefrom').forEach(p => p.classList.remove('is-routefrom'));
      this._schemClosePop(stage);
    });

    // ── Image field ↔ stage image ──
    el.querySelector('[name="schemImageUrl"]')?.addEventListener('input', (ev) => {
      const u = ev.target.value.trim();
      if (img) img.src = u;
      stage.hidden = !u;
    });
    img?.addEventListener('load', () => this._schemRedrawRoutes(stage));

    // ── Stage interactions ──
    stage.addEventListener('pointerdown', (e) => this._schemPointerDown(e, stage));
    stage.addEventListener('click', (e) => this._schemStageClick(e, stage));
    // Popover control edits write straight to the pin's data-attrs.
    stage.addEventListener('input', (e) => this._schemPopInput(e, stage));
    stage.addEventListener('click', (e) => {
      const act = e.target.closest?.('[data-pop-act]');
      if (act) { e.stopPropagation(); this._schemPopAct(act.dataset.popAct, stage); }
    });
  }

  /** Convert a client point to stage-relative x/y percent (clamped). */
  _schemPointPct(e, stage) {
    const img = stage.querySelector('[data-schem-img]');
    const host = (img && img.getBoundingClientRect().width) ? img : stage;
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 1000) / 10)),
      y: Math.max(0, Math.min(100, Math.round(((e.clientY - r.top) / r.height) * 1000) / 10)),
    };
  }

  /** pointerdown: begin a drag when a pin is grabbed in Select mode. */
  _schemPointerDown(e, stage) {
    if (this._schemTool !== 'select') return;
    const pin = e.target.closest?.('.ncm-schem-pin');
    if (!pin) return;
    e.preventDefault();
    this._schemDragMoved = false;
    const move = (ev) => {
      const pct = this._schemPointPct(ev, stage);
      if (!pct) return;
      this._schemDragMoved = true;
      pin.dataset.x = pct.x; pin.dataset.y = pct.y;
      pin.style.left = `${pct.x}%`; pin.style.top = `${pct.y}%`;
      this._schemRedrawRoutes(stage);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (this._schemDragMoved) this._renderPreview();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  /** click: place a marker, link a route, or open/close the edit popover. */
  _schemStageClick(e, stage) {
    if (e.target.closest('[data-schem-pop]')) return;   // clicks inside the popover
    const pin = e.target.closest('.ncm-schem-pin');
    const tool = this._schemTool;

    if (tool === 'route') {
      if (!pin) return;
      if (!this._schemRouteFrom) {
        this._schemRouteFrom = pin.dataset.id;
        pin.classList.add('is-routefrom');
        return;
      }
      if (this._schemRouteFrom !== pin.dataset.id) {
        const from = this._schemRouteFrom, to = pin.dataset.id;
        this._schemRoutes ??= [];
        const exists = this._schemRoutes.some(r =>
          (r.from === from && r.to === to) || (r.from === to && r.to === from));
        if (!exists) this._schemRoutes.push({ from, to, color: 'cyan' });
        this._schemRedrawRoutes(stage);
        this._renderPreview();
      }
      stage.querySelectorAll('.ncm-schem-pin.is-routefrom').forEach(p => p.classList.remove('is-routefrom'));
      this._schemRouteFrom = null;
      return;
    }

    if (tool === 'select') {
      if (this._schemDragMoved) { this._schemDragMoved = false; return; } // ignore the click that ends a drag
      if (pin) this._schemOpenPop(pin, stage);
      else this._schemClosePop(stage);
      return;
    }

    // A marker tool: drop a new pin of that type at the click point.
    if (pin) { this._schemOpenPop(pin, stage); return; }
    const pct = this._schemPointPct(e, stage);
    if (!pct) return;
    const info = schemMarkerInfo(tool);
    const el = this._schemAddPinEl(stage, this._normSchemPin({ x: pct.x, y: pct.y, type: tool, color: info.color }));
    this._schemRenumber(stage);
    this._renderPreview();
    this._schemOpenPop(el, stage);
  }

  /** Open the inline edit popover anchored to a pin. */
  _schemOpenPop(pin, stage) {
    const pop = stage.querySelector('[data-schem-pop]');
    if (!pop) return;
    this._schemClosePop(stage);
    pin.classList.add('is-editing');
    pop._pinId = pin.dataset.id;
    const d = pin.dataset;
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const info = schemMarkerInfo(d.type);
    const typeOpts = Object.entries(SCHEM_MARKERS).map(([k, v]) =>
      `<option value="${k}"${k === d.type ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
    const colors = ['', 'cyan', 'gold', 'red', 'green', 'amber', 'purple', 'blue', 'pink'];
    const colorOpts = colors.map(c =>
      `<option value="${c}"${c === d.color ? ' selected' : ''}>${c ? esc(c) : 'auto'}</option>`).join('');
    const locked = d.locked === '1';
    pop.innerHTML =
      `<div class="ncm-schem-pop__hd"><i class="${esc(locked ? 'fas fa-question' : info.icon)}"></i> ${esc(info.label)}</div>` +
      `<label class="ncm-schem-pop__f"><span>Label</span><input data-pop="label" value="${esc(d.label)}" placeholder="what’s here"></label>` +
      `<label class="ncm-schem-pop__f"><span>Note</span><input data-pop="note" value="${esc(d.note)}" placeholder="optional detail"></label>` +
      `<div class="ncm-schem-pop__grid">` +
        `<label class="ncm-schem-pop__f"><span>Type</span><select data-pop="type">${typeOpts}</select></label>` +
        `<label class="ncm-schem-pop__f"><span>Color</span><select data-pop="color">${colorOpts}</select></label>` +
      `</div>` +
      `<label class="ncm-schem-pop__f"><span>Scene link</span><input data-pop="scene" value="${esc(d.scene)}" placeholder="scene id — “Go to Scene” (GM)"></label>` +
      `<label class="ncm-schem-pop__chk"><input type="checkbox" data-pop="locked"${locked ? ' checked' : ''}> Locked — hidden until scouted (roll to reveal)</label>` +
      `<div class="ncm-schem-pop__lock" ${locked ? '' : 'hidden'}>` +
        `<label class="ncm-schem-pop__f"><span>Skill</span><input data-pop="uskill" value="${esc(d.unlockSkill)}" placeholder="Interface"></label>` +
        `<label class="ncm-schem-pop__f"><span>DV</span><input type="number" data-pop="udv" value="${esc(d.unlockDv)}" placeholder="15"></label>` +
      `</div>` +
      `<div class="ncm-schem-pop__ft">` +
        `<button type="button" class="ncm-schem-pop__del" data-pop-act="del"><i class="fas fa-trash"></i> Delete</button>` +
        `<button type="button" class="ncm-schem-pop__done" data-pop-act="close">Done</button>` +
      `</div>`;
    // Anchor: to the right of the pin, flipping left near the edge.
    const x = parseFloat(pin.dataset.x);
    pop.style.left = x > 62 ? 'auto' : `calc(${x}% + 16px)`;
    pop.style.right = x > 62 ? `calc(${100 - x}% + 16px)` : 'auto';
    pop.style.top = `${Math.min(78, parseFloat(pin.dataset.y))}%`;
    pop.hidden = false;
    pop.querySelector('[data-pop="label"]')?.focus();
  }

  _schemClosePop(stage) {
    const pop = stage.querySelector('[data-schem-pop]');
    stage.querySelectorAll('.ncm-schem-pin.is-editing').forEach(p => p.classList.remove('is-editing'));
    if (pop) { pop.hidden = true; pop._pinId = null; pop.innerHTML = ''; }
  }

  /** Popover input → write to the anchored pin's data-attrs (live). */
  _schemPopInput(e, stage) {
    const ctrl = e.target.closest?.('[data-pop]');
    const pop = stage.querySelector('[data-schem-pop]');
    if (!ctrl || !pop?._pinId) return;
    const pin = stage.querySelector(`.ncm-schem-pin[data-id="${CSS.escape(pop._pinId)}"]`);
    if (!pin) return;
    const key = ctrl.dataset.pop;
    if (key === 'label') pin.dataset.label = ctrl.value;
    else if (key === 'note') pin.dataset.note = ctrl.value;
    else if (key === 'scene') pin.dataset.scene = ctrl.value;
    else if (key === 'uskill') pin.dataset.unlockSkill = ctrl.value;
    else if (key === 'udv') pin.dataset.unlockDv = ctrl.value;
    else if (key === 'type') { pin.dataset.type = ctrl.value; this._schemRepaintPin(pin); }
    else if (key === 'color') { pin.dataset.color = ctrl.value; this._schemRepaintPin(pin); }
    else if (key === 'locked') {
      pin.dataset.locked = ctrl.checked ? '1' : '0';
      pop.querySelector('.ncm-schem-pop__lock')?.toggleAttribute('hidden', !ctrl.checked);
      this._schemRepaintPin(pin);
    }
    this._renderPreview();
  }

  /** Repaint a pin's icon/color after a type/color/locked change. */
  _schemRepaintPin(pin) {
    const info = schemMarkerInfo(pin.dataset.type);
    const locked = pin.dataset.locked === '1';
    const color = pin.dataset.color || info.color || 'cyan';
    pin.dataset.ctColor = color;
    pin.setAttribute('data-ct-color', color);
    pin.classList.toggle('is-locked', locked);
    const icon = pin.querySelector('i');
    if (icon) icon.className = locked ? 'fas fa-question' : info.icon;
  }

  /** Popover footer actions: delete pin / close. */
  _schemPopAct(act, stage) {
    const pop = stage.querySelector('[data-schem-pop]');
    if (act === 'close') { this._schemClosePop(stage); return; }
    if (act === 'del' && pop?._pinId) {
      const id = pop._pinId;
      stage.querySelector(`.ncm-schem-pin[data-id="${CSS.escape(id)}"]`)?.remove();
      this._schemRoutes = (this._schemRoutes || []).filter(r => r.from !== id && r.to !== id);
      this._schemClosePop(stage);
      this._schemRenumber(stage);
      this._schemRedrawRoutes(stage);
      this._renderPreview();
    }
  }

  /** Walk the stage DOM + route model into the authored schematic shape. */
  _collectSchematic() {
    const stage = this.element?.querySelector('[data-schem-stage]');
    const annotations = [];
    const ids = new Set();
    stage?.querySelectorAll('.ncm-schem-pin').forEach(p => {
      const d = p.dataset;
      ids.add(d.id);
      const a = {
        id: d.id,
        x: Math.round((parseFloat(d.x) || 0) * 10) / 10,
        y: Math.round((parseFloat(d.y) || 0) * 10) / 10,
        type: d.type || 'pin',
        label: d.label || '',
      };
      if (d.note) a.note = d.note;
      if (d.color) a.color = d.color;
      if (d.scene) a.sceneId = d.scene;
      if (d.locked === '1') {
        a.locked = true;
        if (d.unlockSkill) a.unlockSkill = d.unlockSkill;
        const dv = Number(d.unlockDv);
        if (dv) a.unlockDV = dv;
      }
      annotations.push(a);
    });
    const routes = (this._schemRoutes || [])
      .filter(r => ids.has(r.from) && ids.has(r.to))
      .map(r => ({ from: r.from, to: r.to, ...(r.color ? { color: r.color } : {}) }));
    return { annotations, routes };
  }

  /** Keep the cosmetic row numbers sequential after add/remove. */
  _renumberList(container) {
    container?.querySelectorAll('.ncm-cl-row').forEach((r, i) => {
      const n = r.querySelector('.ncm-cl-num');
      if (n) n.textContent = i + 1;
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  TEMPLATES & EXAMPLES (EntryTemplates.js)
  // ═══════════════════════════════════════════════════════════

  /**
   * Prefill the whole form from an entry seed (built-in example or saved
   * template) by riding the existing editData machinery — list rows, selects,
   * and the spreadsheet grid all reconstruct exactly like an edit, but with
   * NO entryId, so Save creates a new entry.
   */
  _loadEntrySeed(seed, msg) {
    this.editData = foundry.utils.deepClone(seed);
    delete this.editData.entryId;
    this._selectedType = this.editData.contentType || CONTENT_TYPES.MESSAGE;
    this.render();
    if (msg) ui.notifications.info(`NCM | ${msg}`);
  }

  static _onLoadExample() {
    const seed = BUILTIN_EXAMPLES[this._selectedType];
    if (!seed) { ui.notifications.warn('NCM | No example for this type yet.'); return; }
    this._loadEntrySeed(seed, 'Example loaded — every field is editable.');
  }

  static _onTplLoad() {
    const sel = this.element?.querySelector('[name="tplSelect"]');
    const tpl = getEntryTemplates().find(t => t.id === sel?.value);
    if (!tpl) { ui.notifications.warn('NCM | Pick a saved template first.'); return; }
    this._loadEntrySeed(tpl.entry, `Template "${tpl.name}" loaded.`);
  }

  static _onTplSave() {
    if (!isGM()) return;
    const entryData = this._collectEntryData({ validate: true });
    if (!entryData) return;
    const escape = (s) => Handlebars.escapeExpression(String(s ?? ''));
    let name = null;
    new Dialog({
      title: 'Save Entry Template',
      content: `<div class="form-group"><label>Template name</label><input type="text" name="tplName" value="${escape(entryData.subject)}" style="width:100%"/></div>`,
      buttons: {
        save: { icon: '<i class="fas fa-floppy-disk"></i>', label: 'Save', callback: (html) => { name = html.find('[name="tplName"]').val()?.trim(); } },
        cancel: { label: 'Cancel' },
      },
      default: 'save',
      close: async () => {
        if (!name) return;
        await saveEntryTemplate(name, entryData);
        ui.notifications.info(`NCM | Template "${name}" saved (world-wide).`);
        this.render();
      },
    }).render(true);
  }

  static async _onTplDelete() {
    if (!isGM()) return;
    const sel = this.element?.querySelector('[name="tplSelect"]');
    const tpl = getEntryTemplates().find(t => t.id === sel?.value);
    if (!tpl) { ui.notifications.warn('NCM | Pick a saved template first.'); return; }
    const ok = await Dialog.confirm({ title: 'Delete Template', content: `<p>Delete the template <b>${Handlebars.escapeExpression(tpl.name)}</b>?</p>` });
    if (!ok) return;
    await deleteEntryTemplate(tpl.id);
    ui.notifications.info(`NCM | Template "${tpl.name}" deleted.`);
    this.render();
  }

  static _onTplImport() {
    if (!isGM()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) { input.remove(); return; }
      try {
        const payload = JSON.parse(await file.text());
        const { imported, skipped } = await importEntryTemplates(payload);
        ui.notifications.info(`NCM | Imported ${imported} template(s).${skipped ? ` ${skipped} skipped (duplicates/invalid).` : ''}`);
        this.render();
      } catch (err) {
        log.error(`Entry-template import failed: ${err.message}`);
        ui.notifications.error(err.message || 'Failed to parse JSON file.');
      } finally {
        input.remove();
      }
    });
    input.click();
  }

  static _onTplExport() {
    const count = getEntryTemplates().length;
    if (!count) { ui.notifications.warn('NCM | No saved templates to export.'); return; }
    exportEntryTemplates();
    ui.notifications.info(`NCM | Exported ${count} template(s).`);
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
      // ENVELOPE (#37) — never auto-create a master contact for a FILE. Its
      // "from" is an owner NODE (SECCAM-B2, root, kowalski), not an Agent; the
      // link-or-create would pollute the directory with cameras and daemons.
      if (entryData.envelope !== 'file') await this._syncFromToMasterList(entryData.from);
      ui.notifications.info(`NCM | ${res.label} ${res.edited ? 'updated' : 'added'}.`);
      if (typeof this.onSave === 'function') this.onSave();
      this.close();
    } else {
      ui.notifications.error(`NCM | Failed: ${res?.error || 'Unknown error'}`);
    }
  }

  /**
   * Live status under the Entry Header From input — tells the GM up front
   * what save will do: linked directory contact (portrait + name shown on the
   * entry) / new sender (a master contact will be created) / system node
   * (left as typed). Pure DOM — repainted on every keystroke, no re-render.
   */
  _wireFromStatus(el) {
    const input = el?.querySelector('input[name="from"]');
    const host = el?.querySelector('[data-from-status]');
    if (!input || !host) return;
    const escape = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const paint = () => {
      const raw = input.value.trim();
      if (!raw) { host.style.display = 'none'; return; }
      const isEmail = raw.includes('@') && !raw.includes(' ');
      if (!isEmail) {
        host.className = 'ncm-composer-from-status is-node';
        host.innerHTML = `<i class="fas fa-satellite-dish"></i> System node — not a person; stays exactly as typed.`;
      } else {
        const contact = game.nightcity?.masterContactService?.getByEmail?.(raw);
        if (contact) {
          const portrait = game.nightcity?.portraitService?.resolvePortrait?.(contact);
          const ava = portrait ? `<img src="${escape(portrait)}" alt="">` : `<i class="fas fa-user"></i>`;
          host.className = 'ncm-composer-from-status is-linked';
          host.innerHTML = `<span class="ncm-composer-from-status__ava">${ava}</span> Linked to master contact <b>${escape(contact.name)}</b> — their portrait and name show on the entry header.`;
        } else {
          host.className = 'ncm-composer-from-status is-new';
          host.innerHTML = `<i class="fas fa-user-plus"></i> New sender — saving creates a master contact for <b>${escape(raw)}</b> (you'll be notified).`;
        }
      }
      host.style.display = '';
    };
    input.addEventListener('input', paint);
    paint();
  }

  /**
   * From ↔ GM Master List (everything feeds through the master directory —
   * the terminal-account link-or-create precedent). An email-shaped From that
   * isn't in the directory creates a new master contact with a provenance
   * note and tells the GM. Non-email Froms (SECCAM-B2, SOURCE-NODE) are
   * system nodes, not people — skipped. Never blocks the save.
   */
  async _syncFromToMasterList(from) {
    try {
      const mcs = game.nightcity?.masterContactService;
      const email = (from || '').trim();
      if (!mcs || !email.includes('@') || email.includes(' ') || email.length < 5) return;
      if (mcs.getByEmail(email)) return;
      // "k.okada" → "K Okada" — a readable directory name from the local part.
      const name = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
        .replace(/\b\w/g, c => c.toUpperCase()) || email;
      const created = await mcs.addContact({
        name, email,
        // Auto-created from a machine's file/mail — a system address by
        // default: players can't message, reply to, or add it. Untick
        // "Send-only" in the Master List to make it a real two-way contact.
        sendOnly: true,
        notes: `Created from a ${this._isTerminal ? 'terminal' : 'data shard'} entry on "${this._item?.name || 'unknown item'}".`,
      });
      if (created?.success) {
        ui.notifications.info(`NCM | New sender — created master contact "${created.contact.name}" (${email}) as SEND-ONLY.`);
      }
    } catch (err) {
      log.warn(`From→master-list sync skipped: ${err.message}`);
    }
  }

  /** Read the form into a full entryData object. Shared by save + live preview. */
  _collectEntryData({ validate = false } = {}) {
    const form = this.element?.querySelector('form');
    if (!form) return null;
    const data = new FormDataExtended(form).object;
    const type = this._selectedType;

    // Rich-text body: the contenteditable surface is the source of truth for the
    // message body (read it directly so we never miss an un-synced keystroke).
    // In raw-HTML mode the textarea is the source, so keep FormDataExtended's read.
    const rteBox = this.element?.querySelector('[data-rte]');
    if (rteBox && !rteBox.classList.contains('is-raw')) {
      const surf = rteBox.querySelector('[data-rte-surface]');
      if (surf) data.body = surf.innerHTML;
    }

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
    // Terminal mailbox location — the Entry Header select (terminal targets
    // only; shards have no folders). System locations translate here so BOTH
    // persist paths agree: create rides addAccountMessage/_buildMessageFlags,
    // but EDIT writes entryData keys straight to page flags.
    if (this._isTerminal) {
      const loc = data.entryFolder || 'inbox';
      const system = loc === 'inbox' || loc === 'saved' || loc === 'trash';
      entryData.folder = system ? '' : loc;
      entryData.status = { saved: loc === 'saved', deleted: loc === 'trash' };
    }

    // ── ENVELOPE (#37) — mail vs file ──
    // A FILE stores only what the GM AUTHORED; everything else (size, extension,
    // the type-aware count) derives at read time in resolveEnvelope, so a blank
    // Size stays honest as the content grows. The owner node also lands in
    // `from`, so every read path (sidebar, page name, exfil copy) has one source
    // of truth for "what this came off" — and the master-contact auto-create is
    // skipped for files (a camera is not an Agent).
    entryData.envelope = data.envelope === 'file' ? 'file' : 'mail';
    if (entryData.envelope === 'file') {
      const owner = (data.fileOwner || '').trim();
      entryData.file = {
        filename: (data.fileName || '').trim(),
        path: (data.filePath || '').trim(),
        owner,
        size: (data.fileSize || '').trim(),
        modified: timestamp,
      };
      if (owner) entryData.from = owner;
    } else {
      entryData.file = null;
    }

    // ── Per-entry exfil override (#37, terminal targets only) ──
    // Only non-inherit actions persist, so an untouched grid stores null and the
    // entry simply follows the terminal's Exfil tab.
    if (this._isTerminal) {
      const ov = {};
      let any = false;
      // 'custom' = the entry is the whole story: anything not explicitly ALLOWed
      // is denied (resolveEntryExfil enforces it). This mode is what makes
      // "allow only this one action" actually mean something.
      const mode = data.exfMode === 'custom' ? 'custom' : 'inherit';
      if (mode === 'custom') { ov.mode = 'custom'; any = true; }
      for (const row of this.element?.querySelectorAll('[data-exf-row]') || []) {
        const key = row.dataset.exfRow;
        const state = row.querySelector(`[name="exf_${key}"]`)?.value || 'inherit';
        const dv = parseInt(row.querySelector(`[name="exfdv_${key}"]`)?.value ?? '', 10);
        if (state === 'inherit' && !(dv > 0)) continue;
        ov[key] = { state };
        if (dv > 0) ov[key].dv = dv;
        any = true;
      }
      const reason = (data.exfDenyReason || '').trim();
      if (reason) ov.denyReason = reason;
      if (data.exfHideDenied) { ov.hideDenied = true; any = true; }
      entryData.exfil = any ? ov : null;
    }

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
      case CONTENT_TYPES.DOSSIER: {
        const faceLocked = !!data.dossierFaceLocked;
        // A masked dossier's SUBJECT must not leak the target's name in the
        // entry list/index — fall back to the alias.
        entryData.subject = faceLocked
          ? (data.dossierAlias ? `“${data.dossierAlias}”` : 'CLASSIFIED SUBJECT')
          : (data.dossierTargetName || 'Unknown Subject');
        entryData.contentData = {
          targetName: data.dossierTargetName || 'Unknown', targetAlias: data.dossierAlias || '',
          targetImage: data.dossierPortrait || null, linkedActorId: data.dossierLinkedActor || null,
          classification: data.dossierClassification || '', sections: this._collectDossierSections(),
          stats: { threat: data.dossierThreat || '', affiliation: data.dossierAffiliation || '', lastKnownLocation: data.dossierLastKnown || '' },
          declassify: !!data.dossierDeclassify, declassifySkill: data.dossierDeclassifySkill || 'Interface',
          declassifyDV: parseInt(data.dossierDeclassifyDV) || 15, traceOnFail: !!data.dossierDeclassifyTrace,
          // Masked identity (kind 'dossier-face').
          faceLocked, faceUnlockSkill: data.dossierFaceSkill || 'Interface',
          faceUnlockDV: parseInt(data.dossierFaceDV) || 15, faceTraceOnFail: !!data.dossierFaceTrace,
          // Combat profile — stat/skill PICKS are stored; values are read live
          // from the linked actor at render time.
          profile: {
            enabled: !!data.dossierProfileEnabled,
            title: data.dossierProfileTitle || '',
            visibility: data.dossierProfileVisibility || 'encrypted',
            skill: data.dossierProfileSkill || 'Interface',
            dv: parseInt(data.dossierProfileDV) || 13,
            stats: String(data.dossierProfileStats || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
            skills: String(data.dossierProfileSkills || '').split(',').map(s => s.trim()).filter(Boolean),
            decrypted: !!this.editData?.contentData?.profile?.decrypted,
          },
        };
        break;
      }
      case CONTENT_TYPES.PAYLOAD: {
        entryData.subject = data.payloadName || 'Utility Program';
        const durHrs = parseFloat(data.payloadDuration);
        entryData.contentData = {
          name: data.payloadName || 'UNKNOWN.EXE',
          program: data.payloadProgram || '',
          version: data.payloadVersion || '',
          sizeLabel: data.payloadSize || '',
          publisher: data.payloadPublisher || '',
          signed: !!data.payloadSigned,
          charges: parseInt(data.payloadCharges) || 1,
          description: data.payloadDescription || '',
          effect: {
            type: data.payloadEffectType || 'adjudicate',
            duration: (Number.isFinite(durHrs) && durHrs > 0) ? Math.round(durHrs * 3600000) : 0,
            macroId: data.payloadMacroId || '',
          },
          requirements: this._collectList('plReqs', PL_REQ_FIELDS),
          output: this._collectList('plOutput', PL_OUTPUT_FIELDS),
          executeRequire: !!data.payloadExecuteRequire,
          executeSkill: data.payloadExecuteSkill || 'Interface',
          executeDV: parseInt(data.payloadExecuteDV) || 15,
          traceOnFail: !!data.payloadExecuteTrace,
          disguised: !!data.payloadDisguised,
          disguiseType: data.payloadDisguiseType || 'note',
          sniffDV: parseInt(data.payloadSniffDV) || 15,
          sniffed: false,
          // Runtime state (fresh entry).
          executed: false, executedBy: null, executedAt: null,
          active: false, expiresAt: null, killed: false, tripped: false, scanReport: '',
        };
        break;
      }
      case CONTENT_TYPES.AVLOG:
        entryData.subject = data.avlogTitle || 'Recording';
        entryData.contentData = { mediaType: data.avlogMediaType || 'audio', mediaUrl: data.avlogMediaUrl || '', duration: data.avlogDuration || '00:00', source: data.avlogSource || '', transcript: this._collectTranscriptLines(), corrupted: false, corruptionLevel: 0, locked: !!data.avlogLocked, unlockSkill: data.avlogUnlockSkill || 'Interface', unlockDV: parseInt(data.avlogUnlockDV) || 15, traceOnFail: !!data.avlogUnlockTrace };
        break;
      case CONTENT_TYPES.LOCATION:
        entryData.subject = data.locationName || 'Unknown Location';
        entryData.contentData = {
          locationName: data.locationName || 'Unknown', locationImage: data.locationImage || null,
          coordinates: data.locationCoords || '', district: data.locationDistrict || '',
          description: data.locationDescription || '', linkedSceneId: data.locationSceneId || null,
          pinX: null, pinY: null,
          // Intel adds (all optional — redesign 2026-07-13).
          controlledBy: data.locationControl || '', security: parseInt(data.locationSecurity) || 0,
          heat: data.locationHeat || '', hours: data.locationHours || '', access: data.locationAccess || '',
          approach: data.locationApproach || '', contact: data.locationContact || '',
          // Encrypted pin (contentUnlock kind 'location').
          locked: !!data.locationLocked, unlockSkill: data.locationUnlockSkill || 'Interface',
          unlockDV: parseInt(data.locationUnlockDV) || 15, traceOnFail: !!data.locationUnlockTrace,
        };
        break;
      case CONTENT_TYPES.BANKING:
        entryData.subject = data.subject || data.bankAccountName || 'Account Ledger';
        entryData.contentData = this._collectBanking(data);
        break;
      case CONTENT_TYPES.CALENDAR: {
        entryData.subject = data.calTitle || 'Schedule';
        entryData.contentData = this._collectCalendar(data);
        if (validate && !entryData.contentData.events.length) { ui.notifications.warn('NCM | Add at least one event.'); return null; }
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
        entryData.contentData.declassify = !!data.ssDeclassify;
        entryData.contentData.declassifySkill = data.ssDeclassifySkill || 'Interface';
        entryData.contentData.declassifyDV = parseInt(data.ssDeclassifyDV) || 15;
        entryData.contentData.traceOnFail = !!data.ssDeclassifyTrace;
        if (validate && !entryData.contentData.columns.some(c => c.label.trim())) {
          ui.notifications.warn('NCM | Give at least one column a label.'); return null;
        }
        break;
      }
      case CONTENT_TYPES.GALLERY: {
        entryData.subject = data.galTitle || (data.galMode === 'feed' ? 'Camera Feed' : 'Image Gallery');
        // DVs coerce to numbers; blank = the action/override is OFF (undefined
        // keys drop out of the stored shape). looped/cut/loopedTime are table
        // state riding through the edit (see GAL_IMG_FIELDS).
        const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : undefined; };
        const images = this._collectList('galImages', GAL_IMG_FIELDS).map(i => ({
          ...i,
          unlockDV: num(i.unlockDV), loopDV: num(i.loopDV), cutDV: num(i.cutDV), controlDV: num(i.controlDV),
          sceneId: i.sceneId || undefined, loopedTime: i.loopedTime || undefined,
          ptz: i.ptz || undefined, looped: i.looped || undefined, cut: i.cut || undefined,
          flagged: i.flagged || undefined, corrupted: i.corrupted || undefined, locked: i.locked || undefined,
        }));
        entryData.contentData = {
          title: data.galTitle || '', source: data.galSource || '',
          layout: data.galLayout ? 'strip' : 'grid', // hidden input: '' | 'strip'
          mode: data.galMode === 'feed' ? 'feed' : undefined,
          camSkill: data.galMode === 'feed' ? (data.galCamSkill || 'Electronics/Security Tech') : undefined,
          // Clock source (feed only) — 'game' is the default, so it drops out.
          clock: (data.galMode === 'feed' && data.galClock && data.galClock !== 'game') ? data.galClock : undefined,
          unlockSkill: data.galUnlockSkill || 'Interface',
          unlockDV: parseInt(data.galUnlockDV) || 15,
          traceOnFail: !!data.galUnlockTrace,
          images,
        };
        if (validate && !images.length) { ui.notifications.warn('NCM | Add at least one image.'); return null; }
        break;
      }
      case CONTENT_TYPES.DOCUMENT: {
        entryData.subject = data.docTitle || 'Document';
        const paragraphs = this._collectDocBlocks();
        entryData.contentData = {
          title: data.docTitle || '', docType: data.docType || '',
          author: data.docAuthor || '', org: data.docOrg || '', date: data.docDate || '',
          revision: data.docRevision || '', classification: data.docClassification || '',
          watermark: data.docWatermark || '', signed: data.docSigned || '', signedImage: data.docSignedImage || '',
          declassify: !!data.docDeclassify,
          declassifySkill: data.docDeclassifySkill || 'Interface',
          declassifyDV: parseInt(data.docDeclassifyDV) || 15,
          traceOnFail: !!data.docDeclassifyTrace,
          paragraphs,
        };
        if (validate && !paragraphs.length) { ui.notifications.warn('NCM | Add at least one paragraph.'); return null; }
        break;
      }
      case CONTENT_TYPES.CHATLOG: {
        entryData.subject = data.chatTitle || data.chatChannel || 'Chat Log';
        const messages = this._collectChat();
        // Participants derive from non-system message senders; `me` (right-aligned
        // bubbles) is the sender marked owner via the chip ★ (the chatMe field).
        const me = (data.chatMe || '').trim().toLowerCase();
        const participants = [...new Set(messages.filter(m => m.kind !== 'system').map(m => m.from).filter(Boolean))]
          .map(name => ({ name, me: !!me && name.trim().toLowerCase() === me }));
        entryData.contentData = {
          app: data.chatApp || '', channel: data.chatChannel || '',
          participants, messages,
        };
        if (validate && !messages.length) { ui.notifications.warn('NCM | Add at least one message.'); return null; }
        break;
      }
      case CONTENT_TYPES.RECORD: {
        entryData.subject = data.recDbName || 'Records';
        const records = this._collectRecords();
        entryData.contentData = {
          dbName: data.recDbName || '', recordType: data.recType || 'personnel',
          searchable: !!data.recSearchable,
          records,
        };
        if (validate && !records.length) { ui.notifications.warn('NCM | Add at least one subject.'); return null; }
        break;
      }
      case CONTENT_TYPES.SCHEMATIC: {
        entryData.subject = data.schemTitle || 'Schematic';
        const { annotations, routes } = this._collectSchematic();
        entryData.contentData = {
          title: data.schemTitle || '', imageUrl: data.schemImageUrl || '',
          docRef: data.schemDocRef || '', linkedSceneId: data.schemSceneId || null,
          annotations, routes,
        };
        if (validate && !entryData.contentData.imageUrl) { ui.notifications.warn('NCM | A schematic needs an image.'); return null; }
        break;
      }
      case CONTENT_TYPES.NOTE: {
        entryData.subject = data.noteTitle || 'Note';
        entryData.contentData = {
          title: data.noteTitle || '', text: (data.noteText || '').trim(),
          color: data.noteColor || 'gold', pinned: !!data.notePinned,
        };
        if (validate && !entryData.contentData.text) { ui.notifications.warn('NCM | The note is blank.'); return null; }
        break;
      }
      case CONTENT_TYPES.MALWARE: {
        entryData.subject = data.malName || 'UNKNOWN.exe';
        entryData.contentData = {
          name: data.malName || 'UNKNOWN.exe',
          payloadType: data.malType || 'virus',
          description: data.malDesc || '',
          threat: parseInt(data.malThreat) || 0,
          sizeLabel: data.malSize || '',
          deployable: !!data.malDeployable,
          honeypot: !!data.malHoneypot,
          deployRequire: !!data.malDeployRequire,
          deploySkill: data.malDeploySkill || 'Interface',
          deployDV: parseInt(data.malDeployDV) || 15,
          iceActorId: data.malIceActorId || null,
          deployed: false, deployedBy: null, tripped: false,
        };
        if (validate && !data.malName?.trim()) { ui.notifications.warn('NCM | Name the file.'); return null; }
        break;
      }
    }

    // ── UPLOADABLE (design §4) — cross-type flag folded into contentData AFTER
    // the per-type build (each case replaces contentData). Read by the terminal's
    // OPS → UPLOAD picker off a carried shard / the Agent. ──
    if (data.uploadable) {
      const stealth = parseInt(data.uploadStealthDV);
      // EXECUTE verb (thread #6) — only meaningful on malware/payload; a real verb
      // makes this an EXECUTE program (installs a resident) instead of a PLANT.
      const execVerb = (entryData.contentType === CONTENT_TYPES.MALWARE || entryData.contentType === CONTENT_TYPES.PAYLOAD)
        ? (data.uploadEffect || '') : '';
      Object.assign(entryData.contentData, {
        uploadable: true,
        uploadDV: parseInt(data.uploadDV) || 15,
        uploadSkill: data.uploadSkill || 'Interface',
        uploadTraceOnFail: !!data.uploadTraceOnFail,
        ...(stealth > 0 ? { uploadStealthDV: stealth } : {}),
        ...(execVerb ? { uploadEffect: execVerb } : {}),
      });
    }

    return entryData;
  }

  /** Build banking contentData from the form (scalars + the txn rows). */
  _collectBanking(data) {
    const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isNaN(n) ? null : n; };
    const cd = {
      bankName: data.bankName || '', bankLogo: data.bankLogo || '', bankLocation: data.bankLocation || '',
      bankCode: data.bankCode || '', bankTagline: data.bankTagline || '', bankColor: data.bankColor || '',
      owner: data.bankOwner || '', accountName: data.bankAccountName || '', accountNumber: data.bankAccountNumber || '',
      accountType: data.bankAccountType || '', currency: data.bankCurrency || '€$', status: data.bankStatus || '',
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
      cd.siphonDVScale = !!data.bankSiphonDVScale;
      if (cd.siphonDVScale) cd.siphonDVPer = num(data.bankSiphonDVPer) || 50000;
      cd.siphonLockout = !!data.bankSiphonLockout;
      if (cd.siphonLockout) { cd.siphonMaxAttempts = num(data.bankSiphonAttempts) || 3; cd.siphonLockoutMin = num(data.bankSiphonLockMin) || 30; }
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
      syslogLines: SYSLOG_LINE_FIELDS,
      credEntries: CRED_ENTRY_FIELDS,
      galImages: GAL_IMG_FIELDS,
      chatMsgs: CHAT_MSG_FIELDS,
      plOutput: PL_OUTPUT_FIELDS,
      plReqs: PL_REQ_FIELDS,
    }[key] || null;
  }

  static _onAddListRow(event, target) {
    const key = target.dataset.list;
    const fields = this._listFieldsFor(key);
    const container = this.element?.querySelector(`[data-list="${key}"]`);
    if (!container || !fields) return;
    const idx = container.querySelectorAll('.ncm-cl-row').length;
    const builder = this._wzBuilderFor(key);
    container.insertAdjacentHTML('beforeend', builder ? builder(idx, {}) : this._rowHtml(key, idx, fields, {}));
    this._renumberList(container);
    // Focus the new row's first visible input — keeps rapid data entry flowing.
    const last = container.querySelector('.ncm-cl-row:last-child');
    [...(last?.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), textarea, select') || [])]
      .find(i => i.offsetParent !== null)?.focus();
    this._renderPreview();
  }

  static _onRemoveListRow(event, target) {
    const container = target.closest('[data-list]');
    target.closest('.ncm-cl-row')?.remove();
    this._renumberList(container);
    this._renderPreview();
  }

  /** Build one repeatable row's HTML from a field schema. */
  _rowHtml(key, idx, fields, row = {}) {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    // Every cell = a tiny label OVER its input (placeholder-only fields were
    // the layperson's #1 confusion). Flex sizing moves to the cell wrapper.
    const cellWrap = (fl, inner, extraCls = '') => {
      const sizing = fl.w ? ` style="flex:0 0 ${fl.w};max-width:${fl.w}"` : (fl.cls === 'flex' ? ' style="flex:1 1 60px;min-width:0"' : '');
      return `<span class="ncm-cl-cell${extraCls}"${sizing}><label class="ncm-cl-lbl">${esc(fl.lbl || fl.ph || fl.f)}</label>${inner}</span>`;
    };
    const cells = fields.map(fl => {
      if (fl.brk) return '<div class="ncm-cl-brk"></div>'; // wrap to a second line
      const name = `${key}__${fl.f}-${idx}`;
      let v = row?.[fl.f] ?? '';
      if (fl.type === 'select') {
        const opts = fl.opts.map(o => `<option value="${esc(o)}"${String(v) === o ? ' selected' : ''}>${esc(o || '—')}</option>`).join('');
        return cellWrap(fl, `<select name="${name}" class="ncm-config-input ncm-config-select">${opts}</select>`);
      }
      if (fl.type === 'checkbox') {
        return `<span class="ncm-cl-cell ncm-cl-cell--check"><label class="ncm-cl-check"><input type="checkbox" name="${name}"${v ? ' checked' : ''}> ${esc(fl.lbl || fl.f)}</label></span>`;
      }
      if (fl.type === 'image') {
        // Thumbnail echo + text input + per-row FilePicker (gallery images).
        // The input MUST stay immediately before the button (browseListImage
        // reads previousElementSibling).
        const inner = `<span class="ncm-cl-imgrow">` +
          `<img class="ncm-cl-thumb" src="${esc(v)}" alt=""${v ? '' : ' style="display:none"'}>` +
          `<input type="text" name="${name}" value="${esc(v)}" placeholder="${esc(fl.ph || '')}" class="ncm-config-input">` +
          `<button type="button" data-action="browseListImage" class="ncm-shard-hdr-btn" title="Browse / upload image"><i class="fas fa-folder-open"></i></button></span>`;
        return cellWrap(fl, inner, ' ncm-cl-cell--image');
      }
      if (fl.type === 'date' && v) v = String(v).slice(0, 10); // ISO → the yyyy-mm-dd a date input needs
      const t = (fl.type === 'number' || fl.type === 'date') ? fl.type : 'text';
      const dl = fl.dl ? ` list="${fl.dl}"` : '';
      return cellWrap(fl, `<input type="${t}" name="${name}" value="${esc(v)}" placeholder="${esc(fl.ph || '')}" class="ncm-config-input"${dl}>`);
    }).join('');
    return `<div class="ncm-cl-row"><span class="ncm-cl-num">${idx + 1}</span>${cells}` +
      `<button type="button" data-action="removeListRow" class="ncm-shard-hdr-btn ncm-shard-hdr-btn--danger ncm-cl-rm" title="Remove"><i class="fas fa-times"></i></button></div>`;
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
      ...this._declassCtx(cd),
    };
  }

  /** SKILL_MAP dropdown options, keeping a legacy/hand-typed value visible. */
  _skillOptions(cur = 'Interface') {
    const skills = Object.keys(SKILL_MAP);
    if (cur && !skills.includes(cur)) skills.unshift(cur);
    return skills.map(s => ({ name: s, selected: s === cur }));
  }

  /** Shared declassify pre-fill (document / dossier / spreadsheet). */
  _declassCtx(cd) {
    return {
      declassify: !!cd.declassify,
      declassifySkills: this._skillOptions(cd.declassifySkill || 'Interface'),
      declassifyDV: cd.declassifyDV ?? 15,
      declassifyTrace: !!cd.traceOnFail,
    };
  }

  /** Dossier card-editor pre-fill (redesign 2026-07-13). */
  _dossContext(cd) {
    const prof = cd.profile || {};
    const threatLevel = { LOW: 1, MEDIUM: 2, HIGH: 3, EXTREME: 4 }[String(cd.stats?.threat || '').toUpperCase()] || 0;
    const chosen = (prof.stats || []).map(s => String(s).toLowerCase());
    const vis = prof.visibility || 'encrypted';
    return {
      targetName: cd.targetName || '', alias: cd.targetAlias || '',
      classification: cd.classification || '', portrait: cd.targetImage || '',
      linkedActorId: cd.linkedActorId || '',
      threat: cd.stats?.threat || '', threatLevel,
      threatSegs: [1, 2, 3, 4].map(n => ({ n, on: n <= threatLevel })),
      affiliation: cd.stats?.affiliation || '', lastKnown: cd.stats?.lastKnownLocation || '',
      face: {
        locked: !!cd.faceLocked,
        skills: this._skillOptions(cd.faceUnlockSkill || 'Interface'),
        dv: cd.faceUnlockDV ?? 15,
        trace: !!cd.faceTraceOnFail,
      },
      profile: {
        enabled: !!prof.enabled,
        title: prof.title || '',
        visOptions: [
          { value: 'encrypted', label: 'Encrypted (roll to read)', selected: vis === 'encrypted' },
          { value: 'open', label: 'Open (everyone reads it)', selected: vis === 'open' },
          { value: 'gm', label: 'GM only', selected: vis === 'gm' },
        ],
        skills: this._skillOptions(prof.skill || 'Interface'),
        dv: prof.dv ?? 13,
        stats: DOSS_PROFILE_STATS.map(k => ({ k, label: k.toUpperCase(), on: chosen.includes(k) })),
        statsCsv: chosen.join(','),
        skillChips: prof.skills || [],
        skillsCsv: (prof.skills || []).join(','),
      },
    };
  }

  /** AV Log media-deck pre-fill (redesign 2026-07-13). */
  _avContext(cd) {
    return {
      mediaUrl: cd.mediaUrl || '', mediaType: cd.mediaType || 'audio',
      duration: cd.duration || '', source: cd.source || '',
    };
  }

  /** Location postcard pre-fill (redesign 2026-07-13). */
  _locContext(cd) {
    const sec = Math.max(0, Math.min(4, parseInt(cd.security) || 0));
    const sceneName = cd.linkedSceneId ? (game.scenes?.get(cd.linkedSceneId)?.name || '') : '';
    return {
      name: cd.locationName || '', image: cd.locationImage || '',
      coords: cd.coordinates || '', district: cd.district || '',
      description: cd.description || '',
      sceneId: cd.linkedSceneId || '', sceneName,
      control: cd.controlledBy || '', security: sec,
      securityLabel: ['', 'LOW', 'GUARDED', 'HIGH', 'LETHAL'][sec],
      secSegs: [1, 2, 3, 4].map(n => ({ n, on: n <= sec })),
      heat: cd.heat || '', hours: cd.hours || '', access: cd.access || '',
      approach: cd.approach || '', contact: cd.contact || '',
      lock: {
        locked: !!cd.locked,
        skills: this._skillOptions(cd.unlockSkill || 'Interface'),
        dv: cd.unlockDV ?? 15,
        trace: !!cd.traceOnFail,
      },
    };
  }

  /** Banking scalar pre-fill for the template (edit mode). */
  _bankContext(cd) {
    // Siphon skill dropdown (SKILL_MAP keys, legacy value kept visible).
    const siphonSkill = cd.siphonSkill || 'Interface';
    const skills = Object.keys(SKILL_MAP);
    if (!skills.includes(siphonSkill)) skills.unshift(siphonSkill);
    return {
      bankName: cd.bankName || '', bankLogo: cd.bankLogo || '', bankLocation: cd.bankLocation || '',
      bankCode: cd.bankCode || '', bankTagline: cd.bankTagline || '', bankColor: cd.bankColor || '#2b7a5b',
      owner: cd.owner || cd.accountName || '', accountName: cd.accountName || '', accountNumber: cd.accountNumber || '',
      accountType: cd.accountType || '', currency: cd.currency || '€$', status: cd.status || '',
      balance: cd.balance ?? '', cleared: cd.cleared ?? '', held: cd.held ?? '',
      allowSiphon: !!cd.allowSiphon, siphonSkill, siphonDV: cd.siphonDV ?? 15,
      siphonSkills: skills.map(s => ({ name: s, selected: s === siphonSkill })),
      siphonMode: cd.siphonMode || 'cap', siphonCap: cd.siphonCap ?? '', siphonPercent: cd.siphonPercent ?? 25,
      siphonDVScale: !!cd.siphonDVScale, siphonDVPer: cd.siphonDVPer ?? 50000,
      siphonLockout: !!cd.siphonLockout, siphonMaxAttempts: cd.siphonMaxAttempts ?? 3, siphonLockoutMin: cd.siphonLockoutMin ?? 30,
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

  /** Gallery scalar pre-fill (edit mode). */
  /**
   * ENVELOPE (#37) — mail vs file. A NEW entry of an obviously-file type
   * (feed gallery, syslog, malware, schematic…) pre-picks FILE; MESSAGE/EDDIES
   * and friends stay mail. It's only a default — one click flips it.
   */
  _envContext() {
    const cd = this.editData?.contentData ?? {};
    const type = this._selectedType;
    const editing = !!this.editData?.entryId;
    const f = this.editData?.file || {};
    // Editing: honor what was saved. New: suggest by type.
    const envelope = editing
      ? (this.editData?.envelope === 'file' ? 'file' : 'mail')
      : (FILE_DEFAULT_TYPES.includes(type) ? 'file' : 'mail');
    return {
      envelope, isFile: envelope === 'file',
      filename: f.filename || '',
      filenameSuggest: suggestFilename(type, cd, this.editData?.subject || ''),
      path: f.path || '',
      owner: f.owner || (this.editData?.envelope === 'file' ? (this.editData?.from || '') : ''),
      size: f.size || '',
      sizeSuggest: deriveFileSize(type, cd) || 'auto',
    };
  }

  /**
   * Per-entry exfil override grid (#37) — terminal targets only. Each of the
   * seven actions is INHERIT (follow the terminal's Exfil tab) / ALLOW / DENY,
   * with an optional own DV. SAVE FRAME only means anything on a camera feed,
   * so it's labeled as such rather than hidden (the GM should see it exists).
   */
  _exfilOverrideContext() {
    if (!this._isTerminal) return null;
    const META = [
      { key: 'agent',     label: 'To my Agent',   icon: 'fas fa-mobile-screen' },
      { key: 'shard',     label: 'Burn to shard', icon: 'fas fa-sd-card' },
      { key: 'saveFrame', label: 'Save frame',    icon: 'fas fa-camera', note: '(camera feeds only)', isFrame: true },
      { key: 'forward',   label: 'Forward',       icon: 'fas fa-share' },
      { key: 'leak',      label: 'Leak',          icon: 'fas fa-bullhorn' },
      { key: 'sell',      label: 'Sell',          icon: 'fas fa-hand-holding-dollar' },
      { key: 'wipe',      label: 'Wipe',          icon: 'fas fa-eraser' },
    ];
    const base = this.terminalService?.getExfilPolicy?.(this._item) || {};
    const ov = this.editData?.exfil || {};
    const isCustom = ov.mode === 'custom';
    return {
      mode: isCustom ? 'custom' : 'inherit',
      isCustom,
      modeNote: base.master === false
        ? 'The terminal’s master exfil switch is OFF — nothing leaves this machine, and nothing here can widen that.'
        : (isCustom
          ? 'Only the actions you set to ALLOW below can be used on this entry. Everything left on INH is denied.'
          : 'Actions left on INH follow the terminal’s Exfil tab. Set one to DENY to block it here.'),
      denyReason: ov.denyReason || '',
      hideDenied: !!ov.hideDenied,
      rows: META.map(m => {
        const o = ov[m.key] || {};
        const state = ['allow', 'deny'].includes(o.state) ? o.state : 'inherit';
        return {
          ...m, state,
          isInherit: state === 'inherit', isAllow: state === 'allow', isDeny: state === 'deny',
          inheritLabel: base[m.key]?.allow ? 'allowed' : 'off',
          dv: o.dv ?? '',
          dvPlaceholder: String(base[m.key]?.dv ?? 15),
        };
      }),
    };
  }

  _galContext(cd) {
    const clock = ['game', 'real', 'authored', 'off'].includes(cd.clock) ? cd.clock : 'game';
    return {
      title: cd.title || '', source: cd.source || '', isStrip: cd.layout === 'strip',
      isFeed: cd.mode === 'feed',
      unlockSkills: this._skillOptions(cd.unlockSkill || 'Interface'),
      camSkills: this._skillOptions(cd.camSkill || 'Electronics/Security Tech'),
      clockOptions: [
        { value: 'game', label: 'Game time (synced)' },
        { value: 'real', label: 'Real time (always ticking)' },
        { value: 'authored', label: 'Frozen — each cam’s Time' },
        { value: 'off', label: 'No timestamps' },
      ].map(o => ({ ...o, selected: o.value === clock })),
      unlockDV: cd.unlockDV ?? 15,
      unlockTrace: !!cd.traceOnFail,
    };
  }

  /** Document scalar pre-fill (edit mode). */
  _docContext(cd) {
    // The Dated line is a CyberTimePicker (ISO stored); format for the chip label.
    let dateLabel = cd.date || '';
    if (dateLabel && /^\d{4}-\d{2}-\d{2}/.test(dateLabel)) {
      try { dateLabel = formatCyberDate(new Date(dateLabel).toISOString(), { dateOnly: true }); } catch { /* keep raw */ }
    }
    return {
      title: cd.title || '', docType: cd.docType || '', author: cd.author || '',
      org: cd.org || '', date: cd.date || '', dateLabel, revision: cd.revision || '',
      classification: cd.classification || '', watermark: cd.watermark || '', signed: cd.signed || '',
      ...this._declassCtx(cd),
    };
  }

  /** Chatlog scalar pre-fill (edit mode) — `me` = the right-aligned sender. */
  _chatContext(cd) {
    return {
      app: cd.app || '', channel: cd.channel || '',
      me: (cd.participants || []).find(p => p.me)?.name || '',
    };
  }

  /** Record/DB scalar pre-fill (edit mode); search defaults on. */
  _recContext(cd) {
    const cur = cd.recordType || 'personnel';
    return {
      dbName: cd.dbName || '', recordType: cur, searchable: cd.searchable !== false,
      dbKinds: Object.entries(RECORD_DB_KINDS).map(([key, v]) => ({ key, label: v.label, selected: key === cur })),
    };
  }

  /** Calendar scalar pre-fill (edit mode) — default view for the viewer toggle. */
  _calContext(cd) {
    const view = cd.defaultView === 'month' ? 'month' : 'rail';
    return { defaultView: view, isRail: view === 'rail', isMonth: view === 'month' };
  }

  /** Schematic scalar pre-fill (edit mode). */
  _schemContext(cd) {
    return { title: cd.title || '', imageUrl: cd.imageUrl || '', docRef: cd.docRef || '', sceneId: cd.linkedSceneId || '' };
  }

  /** Note scalar pre-fill (edit mode). */
  _noteContext(cd) {
    return { title: cd.title || '', text: cd.text || '', color: cd.color || 'gold', pinned: !!cd.pinned };
  }

  /** Malware scalar pre-fill (edit mode). */
  _malContext(cd) {
    // Deploy-gate skill dropdown (SKILL_MAP keys, legacy value kept visible).
    const deploySkill = cd.deploySkill || 'Interface';
    const skills = Object.keys(SKILL_MAP);
    if (!skills.includes(deploySkill)) skills.unshift(deploySkill);
    // Linked Black ICE — same world-actor filter as shard security
    // (ItemInboxConfig's Black-ICE cards / ICEService actor source).
    const iceOptions = (game.actors?.filter(a =>
      a.type === 'blackIce' || a.type === 'black-ice' ||
      a.getFlag(MODULE_ID, 'isBlackICE') ||
      a.name?.toLowerCase().includes('black ice')
    ) ?? []).map(a => ({
      id: a.id, name: a.name,
      atkLabel: a.system?.stats?.atk != null ? `ATK ${a.system.stats.atk}` : '',
      selected: cd.iceActorId === a.id,
    }));
    return {
      name: cd.name || '', payloadType: cd.payloadType || 'virus', description: cd.description || '',
      threat: cd.threat || 0, sizeLabel: cd.sizeLabel || '',
      deployable: cd.deployable !== false, honeypot: !!cd.honeypot,
      deployRequire: !!cd.deployRequire,
      deploySkills: skills.map(s => ({ name: s, selected: s === deploySkill })),
      deployDV: cd.deployDV ?? 15,
      iceOptions, hasIceActors: iceOptions.length > 0,
    };
  }

  /** Payload (utility program) scalar pre-fill for the composer. */
  _plContext(cd) {
    const fx = cd.effect || {};
    const effType = fx.type || 'adjudicate';
    const DISGUISES = [
      ['note', 'Note'], ['message', 'Message'], ['eddies', 'Eddies Dead Drop'], ['dossier', 'Dossier'],
    ];
    const dur = Number(fx.duration) || 0;
    return {
      name: cd.name || '', program: cd.program || cd.payloadType || '', version: cd.version || '',
      sizeLabel: cd.sizeLabel || '', publisher: cd.publisher || '', signed: !!cd.signed,
      charges: cd.charges != null ? cd.charges : 1, description: cd.description || '',
      // From the ONE catalog (ContentRenderers.PROGRAM_EFFECTS) — a payload runs on
      // the spot, so only 'instant' verbs are offered.
      effectOptions: programEffectOptions({ mode: 'instant' })
        .map(e => ({ value: e.key, label: `${e.label} — ${e.blurb}`, selected: e.key === effType })),
      durationHrs: dur > 0 ? Math.round(dur / 3600000) : 0,
      // Linked world macros (GM authoring).
      macroOptions: (game.macros?.contents || []).map(m => ({ id: m.id, name: m.name, selected: fx.macroId === m.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      hasMacros: (game.macros?.size || 0) > 0,
      executeRequire: !!cd.executeRequire,
      executeSkills: this._skillOptions(cd.executeSkill || 'Interface'),
      executeDV: cd.executeDV ?? 15,
      executeTrace: !!cd.traceOnFail,
      disguised: !!cd.disguised,
      disguiseOptions: DISGUISES.map(([v, l]) => ({ value: v, label: l, selected: v === (cd.disguiseType || 'note') })),
      sniffDV: cd.sniffDV ?? 15,
    };
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
    container.insertAdjacentHTML('beforeend', this._dossSectionHtml(container.children.length));
    container.lastElementChild?.querySelector('[name^="dossierSectionHeading"]')?.focus();
  }

  static _onRemoveDossierSection(event, target) {
    const entry = target.closest('.ncm-dossier-section-entry');
    if (entry) entry.remove();
    this._renderPreview();
  }

  /** Paper-block markup for one dossier section (composer editor; the hidden
   *  `dossierSectionRedacted-N` checkbox is the save contract — the REDACT
   *  toggle button drives it, `_collectDossierSections` reads it). */
  _dossSectionHtml(idx, s = {}) {
    const esc = (x) => Handlebars.escapeExpression(String(x ?? ''));
    const red = !!s.redacted;
    return `<div class="ncm-dossier-section-entry ncm-dossec${red ? ' is-redacted' : ''}">
      <div class="ncm-dossec__bar">
        <input type="text" name="dossierSectionHeading-${idx}" class="ncm-dossec__h" value="${esc(s.heading)}" placeholder="SECTION HEADING" />
        <button type="button" data-action="dossRedact" class="ncm-dossec__redact${red ? ' is-on' : ''}" data-tooltip="Redact — players see black bars until they DECLASSIFY"><i class="fas fa-eraser"></i> REDACT</button>
        <button type="button" data-action="removeDossierSection" class="ncm-dossec__x" data-tooltip="Remove section"><i class="fas fa-times"></i></button>
      </div>
      <input type="checkbox" name="dossierSectionRedacted-${idx}" class="ncm-wz-flag"${red ? ' checked' : ''} />
      <textarea name="dossierSectionBody-${idx}" class="ncm-dossec__b" rows="3" placeholder="Section content — this is what a DECLASSIFY reveals…">${esc(s.body)}</textarea>
    </div>`;
  }

  // ═══════════════════════════════════════════════════════════
  //  DOSSIER CARD EDITOR (redesign 2026-07-13)
  // ═══════════════════════════════════════════════════════════

  static _onDossPortrait(event, target) {
    const input = this.element?.querySelector('[name="dossierPortrait"]');
    if (!input) return;
    new FilePicker({
      type: 'image', current: input.value || '',
      callback: (path) => { input.value = path; this._dossPaintPortrait(); this._renderPreview(); },
    }).render(true);
  }

  static _onDossThreat(event, target) {
    const wrap = target.closest('[data-doss-threat]');
    const input = wrap?.querySelector('[name="dossierThreat"]');
    if (!wrap || !input) return;
    const LEVELS = ['', 'LOW', 'MEDIUM', 'HIGH', 'EXTREME'];
    const lvl = Number(target.dataset.level) || 0;
    const cur = LEVELS.indexOf(String(input.value || '').toUpperCase());
    input.value = LEVELS[cur === lvl ? 0 : lvl]; // click the active level → clear
    this._dossPaintThreat();
    this._renderPreview();
  }

  static _onDossRedact(event, target) {
    const block = target.closest('.ncm-dossier-section-entry');
    const chk = block?.querySelector('[name^="dossierSectionRedacted"]');
    if (!block || !chk) return;
    chk.checked = !chk.checked;
    block.classList.toggle('is-redacted', chk.checked);
    target.classList.toggle('is-on', chk.checked);
    this._renderPreview();
  }

  static _onDossStatChip(event, target) {
    const on = target.classList.toggle('is-on');
    const input = this.element?.querySelector('[name="dossierProfileStats"]');
    if (input) {
      const set = new Set(input.value.split(',').map(s => s.trim()).filter(Boolean));
      if (on) set.add(target.dataset.stat); else set.delete(target.dataset.stat);
      input.value = DOSS_PROFILE_STATS.filter(k => set.has(k)).join(',');
    }
    this._renderPreview();
  }

  static _onDossSkillAdd(event, target) { this._dossAddSkill(); }

  static _onDossSkillDel(event, target) {
    const name = target.closest('[data-skill]')?.dataset.skill;
    const csv = this.element?.querySelector('[name="dossierProfileSkills"]');
    if (!name || !csv) return;
    csv.value = csv.value.split(',').map(s => s.trim()).filter(s => s && s !== name).join(',');
    this._dossPaintSkills();
    this._renderPreview();
  }

  _dossAddSkill() {
    const el = this.element;
    const inp = el?.querySelector('[data-doss-skillinp]');
    const csv = el?.querySelector('[name="dossierProfileSkills"]');
    const name = (inp?.value || '').trim();
    if (!name || !csv) return;
    const list = csv.value.split(',').map(s => s.trim()).filter(Boolean);
    if (!list.some(s => s.toLowerCase() === name.toLowerCase())) list.push(name);
    csv.value = list.join(',');
    inp.value = '';
    this._dossPaintSkills();
    this._renderPreview();
  }

  _dossLinkedActor() {
    const id = this.element?.querySelector('[name="dossierLinkedActor"]')?.value;
    return id ? game.actors?.get(id) : null;
  }

  /** Portrait tile: custom image → linked actor art → silhouette. */
  _dossPaintPortrait() {
    const el = this.element; if (!el) return;
    const tile = el.querySelector('[data-doss-port]'); if (!tile) return;
    const custom = (el.querySelector('[name="dossierPortrait"]')?.value || '').trim();
    const src = custom || this._dossLinkedActor()?.img || '';
    let img = tile.querySelector('img.ncm-dosscard__img');
    if (src) {
      if (!img) { img = document.createElement('img'); img.className = 'ncm-dosscard__img'; tile.prepend(img); }
      img.src = src;
      tile.classList.add('has-img');
    } else { img?.remove(); tile.classList.remove('has-img'); }
  }

  /** Live classification stamp across the portrait corner. */
  _dossPaintStamp() {
    const el = this.element; if (!el) return;
    const stamp = el.querySelector('[data-doss-stamp]'); if (!stamp) return;
    const v = (el.querySelector('[name="dossierClassification"]')?.value || '').trim().toUpperCase();
    stamp.textContent = v;
    stamp.hidden = !v;
  }

  _dossPaintThreat() {
    const el = this.element; if (!el) return;
    const wrap = el.querySelector('[data-doss-threat]'); if (!wrap) return;
    const lvl = { LOW: 1, MEDIUM: 2, HIGH: 3, EXTREME: 4 }[String(wrap.querySelector('[name="dossierThreat"]')?.value || '').toUpperCase()] || 0;
    wrap.querySelectorAll('b[data-level]').forEach(b => b.classList.toggle('on', Number(b.dataset.level) <= lvl));
    const cap = wrap.querySelector('[data-doss-threat-cap]');
    if (cap) cap.textContent = lvl ? String(wrap.querySelector('[name="dossierThreat"]').value).toUpperCase() : '—';
  }

  /** Stat chips show the linked actor's LIVE value as a badge. */
  _dossPaintStats() {
    const el = this.element; if (!el) return;
    const actor = this._dossLinkedActor();
    el.querySelectorAll('[data-action="dossStatChip"]').forEach(chip => {
      let v = '';
      if (actor) {
        const s = actor.system?.stats?.[chip.dataset.stat];
        v = String(s?.value ?? (typeof s === 'number' ? s : ''));
      }
      const em = chip.querySelector('em');
      if (em) em.textContent = v;
    });
  }

  /** Selected-skill chips (with the actor's live total when linked). */
  _dossPaintSkills() {
    const el = this.element; if (!el) return;
    const host = el.querySelector('[data-doss-skills]'); if (!host) return;
    const names = (el.querySelector('[name="dossierProfileSkills"]')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const actor = this._dossLinkedActor();
    const svc = game.nightcity?.skillService;
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    host.innerHTML = names.map(n => {
      let total = '';
      if (actor) { try { total = String(svc?.getAvailableSkills?.(actor, [n])?.[0]?.total ?? ''); } catch { /* blank */ } }
      return `<span class="ncm-dossskill" data-skill="${esc(n)}">${esc(n)}${total !== '' ? ` <em>${esc(total)}</em>` : ''}<button type="button" data-action="dossSkillDel" data-tooltip="Remove"><i class="fas fa-times"></i></button></span>`;
    }).join('');
  }

  /** The skill-picker datalist offers the LINKED actor's skill items (else SKILL_MAP). */
  _dossSyncSkillDatalist() {
    const el = this.element; if (!el) return;
    const dl = el.querySelector('[data-doss-skilldl]'); if (!dl) return;
    const actor = this._dossLinkedActor();
    const names = actor
      ? actor.items.filter(i => i.type === 'skill').map(i => i.name).sort((a, b) => a.localeCompare(b))
      : Object.keys(SKILL_MAP);
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    dl.innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  }

  _wireDossEditor(el) {
    this._dossPaintPortrait();
    this._dossPaintStamp();
    this._dossPaintThreat();
    this._dossPaintStats();
    this._dossPaintSkills();
    this._dossSyncSkillDatalist();
    el.querySelector('[name="dossierClassification"]')?.addEventListener('input', () => this._dossPaintStamp());
    el.querySelector('[name="dossierLinkedActor"]')?.addEventListener('change', () => {
      this._dossPaintPortrait();
      this._dossPaintStats();
      this._dossPaintSkills();
      this._dossSyncSkillDatalist();
    });
    el.querySelector('[data-doss-skillinp]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._dossAddSkill(); }
    });
  }

  // ═══════════════════════════════════════════════════════════
  //  TRANSCRIPT LINE MANAGEMENT (AV Log)
  // ═══════════════════════════════════════════════════════════

  /** Legacy row-adder (retired from the template — the compose bar adds lines now). */
  static _onAddTranscriptLine(event, target) { this._avCommitLine(); }

  static _onRemoveTranscriptLine(event, target) {
    const entry = target.closest('.ncm-transcript-entry');
    if (!entry) return;
    if (this._avEditRow === entry) {
      this._avEditRow = null;
      const send = this.element?.querySelector('[data-av-send]');
      if (send) send.innerHTML = 'ADD ⏎';
    }
    entry.remove();
    this._avPaintFeed();
    this._avSyncChips();
    this._renderPreview();
  }

  // ═══════════════════════════════════════════════════════════
  //  AV LOG — transcript feed editor + media deck (redesign 2026-07-13)
  // ═══════════════════════════════════════════════════════════

  static _onAvAddLine(event, target) { this._avCommitLine(); }

  /** Click a feed line → load it into the compose bar (ADD becomes UPDATE). */
  static _onAvEditLine(event, target) {
    if (event.target.closest('[data-action="removeTranscriptLine"]')) return;
    const row = target.closest('.ncm-transcript-entry');
    const el = this.element;
    if (!row || !el) return;
    el.querySelectorAll('.ncm-transcript-entry.is-editing').forEach(r => r.classList.remove('is-editing'));
    row.classList.add('is-editing');
    this._avEditRow = row;
    const spk = el.querySelector('[data-av-spk]'), txt = el.querySelector('[data-av-txt]');
    if (spk) spk.value = row.querySelector('[name^="transcriptSpeaker"]')?.value || '';
    if (txt) { txt.value = row.querySelector('[name^="transcriptText"]')?.value || ''; txt.focus(); }
    const send = el.querySelector('[data-av-send]');
    if (send) send.innerHTML = 'UPDATE ⏎';
    this._avSyncChips();
  }

  static _onAvPickSpeaker(event, target) {
    const spk = this.element?.querySelector('[data-av-spk]');
    if (!spk) return;
    spk.value = target.dataset.name || '';
    this._avSyncChips();
    this.element?.querySelector('[data-av-txt]')?.focus();
  }

  /** Commit the compose bar — appends a new line, or updates the row being edited. */
  _avCommitLine() {
    const el = this.element; if (!el) return;
    const spkI = el.querySelector('[data-av-spk]'), txtI = el.querySelector('[data-av-txt]');
    const speaker = (spkI?.value || '').trim().toUpperCase();
    const text = (txtI?.value || '').trim();
    if (!speaker && !text) return;
    if (this._avEditRow?.isConnected) {
      const row = this._avEditRow;
      const s = row.querySelector('[name^="transcriptSpeaker"]'), t = row.querySelector('[name^="transcriptText"]');
      if (s) s.value = speaker;
      if (t) t.value = text;
      const ss = row.querySelector('[data-av-line-spk]'), ts = row.querySelector('[data-av-line-txt]');
      if (ss) ss.textContent = speaker;
      if (ts) ts.textContent = text;
      row.classList.remove('is-editing');
      this._avEditRow = null;
      const send = el.querySelector('[data-av-send]');
      if (send) send.innerHTML = 'ADD ⏎';
    } else {
      const feed = el.querySelector('[data-av-feed]');
      if (!feed) return;
      feed.insertAdjacentHTML('beforeend', this._avLineHtml(this._avIdx++, speaker, text));
      feed.scrollTop = feed.scrollHeight;
    }
    if (txtI) { txtI.value = ''; txtI.focus(); }
    this._avPaintFeed();
    this._avSyncChips();
    this._renderPreview();
  }

  /** One transcript feed line — hidden transcriptSpeaker/Text-N inputs are the
   *  save contract (`_collectTranscriptLines` reads them, prefix-matched). */
  _avLineHtml(idx, speaker = '', text = '') {
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    return `<div class="ncm-transcript-entry ncm-avline" data-action="avEditLine">
      <input type="hidden" name="transcriptSpeaker-${idx}" value="${esc(speaker)}" />
      <input type="hidden" name="transcriptText-${idx}" value="${esc(text)}" />
      <span class="ncm-avline__spk" data-av-line-spk>${esc(speaker)}</span>
      <span class="ncm-avline__txt" data-av-line-txt>${esc(text)}</span>
      <button type="button" data-action="removeTranscriptLine" class="ncm-avline__x" data-tooltip="Remove line"><i class="fas fa-times"></i></button>
    </div>`;
  }

  /** Speaker colors cycle c1–c4 by first appearance (matches the viewer). */
  _avPaintFeed() {
    const el = this.element; if (!el) return;
    const order = [];
    el.querySelectorAll('[data-av-feed] .ncm-avline').forEach(row => {
      const span = row.querySelector('[data-av-line-spk]');
      const spk = span?.textContent.trim() || '';
      let i = order.indexOf(spk);
      if (i < 0) { order.push(spk); i = order.length - 1; }
      if (span) span.classList.remove('c1', 'c2', 'c3', 'c4');
      span?.classList.add(`c${(i % 4) + 1}`);
    });
  }

  /** Speaker quick-pick chips, auto-collected from the feed. */
  _avSyncChips() {
    const el = this.element; if (!el) return;
    const host = el.querySelector('[data-av-chips]'); if (!host) return;
    const cur = (el.querySelector('[data-av-spk]')?.value || '').trim().toUpperCase();
    const names = [];
    el.querySelectorAll('[data-av-feed] [data-av-line-spk]').forEach(s => {
      const n = s.textContent.trim();
      if (n && !names.includes(n)) names.push(n);
    });
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    host.innerHTML = names.map(n =>
      `<button type="button" data-action="avPickSpeaker" data-name="${esc(n)}" class="ncm-avchip${n === cur ? ' is-on' : ''}">${esc(n)}</button>`).join('');
  }

  /** Live media preview — resolveMediaEmbed on the URL, auto-set the hidden
   *  mediaType, render the real player (audio/video/embed) in the deck. */
  _avSyncMedia() {
    const el = this.element; if (!el) return;
    const url = (el.querySelector('[name="avlogMediaUrl"]')?.value || '').trim();
    const typeInput = el.querySelector('[name="avlogMediaType"]');
    const pill = el.querySelector('[data-av-pill]');
    const player = el.querySelector('[data-av-player]');
    if (!pill || !player) return;
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const media = resolveMediaEmbed(url, typeInput?.value);
    if (media.kind === 'none') {
      pill.textContent = url
        ? '✕ UNPLAYABLE LINK — players get the waveform + transcript'
        : '▸ NO MEDIA — players get ▶ transcript playback (set a Duration)';
      player.innerHTML = '';
      return;
    }
    if (typeInput) typeInput.value = media.isVideo ? 'video' : 'audio';
    if (media.kind === 'embed') {
      pill.textContent = '▸ EMBED — auto-detected (YouTube/Vimeo)';
      player.innerHTML = `<iframe src="${esc(media.src)}" frameborder="0" allowfullscreen></iframe>`;
    } else if (media.isVideo) {
      pill.textContent = '▸ VIDEO — auto-detected';
      player.innerHTML = `<video src="${esc(media.src)}" controls preload="metadata"></video>`;
    } else {
      pill.textContent = '▸ AUDIO — auto-detected';
      player.innerHTML = `<audio src="${esc(media.src)}" controls preload="metadata"></audio>`;
    }
  }

  _wireAvEditor(el) {
    this._avIdx = el.querySelectorAll('[data-av-feed] .ncm-avline').length;
    this._avEditRow = null;
    this._avPaintFeed();
    this._avSyncChips();
    this._avSyncMedia();
    el.querySelector('[name="avlogMediaUrl"]')?.addEventListener('input', foundry.utils.debounce(() => this._avSyncMedia(), 300));
    el.querySelector('[data-av-txt]')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._avCommitLine(); }
    });
    el.querySelector('[data-av-spk]')?.addEventListener('input', () => this._avSyncChips());
  }

  // ═══════════════════════════════════════════════════════════
  //  LOCATION — postcard editor (redesign 2026-07-13)
  // ═══════════════════════════════════════════════════════════

  static _onLocBrowse(event, target) {
    const input = this.element?.querySelector('[name="locationImage"]');
    if (!input) return;
    new FilePicker({
      type: 'image', current: input.value || '',
      callback: (path) => { input.value = path; this._locPaintStage(); this._renderPreview(); },
    }).render(true);
  }

  /** Flavor coordinates randomizer. */
  static _onLocDice(event, target) {
    const input = this.element?.querySelector('[name="locationCoords"]');
    if (!input) return;
    const deg = () => (Math.random() * 89 + 1).toFixed(4);
    input.value = `${Math.random() < 0.5 ? 'N' : 'S'} ${deg()}° · ${Math.random() < 0.5 ? 'W' : 'E'} ${deg()}°`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Scene-picker Dialog (the calendar precedent) — no more raw Scene-ID entry. */
  static _onLocScene(event, target) {
    const el = this.element;
    const input = el?.querySelector('[name="locationSceneId"]');
    if (!input) return;
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const cur = input.value || '';
    const opts = ['<option value="">— no scene —</option>']
      .concat((game.scenes?.contents ?? []).map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}</option>`))
      .join('');
    new Dialog({
      title: 'Link a Scene',
      content: `<p style="font-size:12px">The GM gets a "Go to Scene" button on this location in the viewer.</p><select name="locScenePick" style="width:100%">${opts}</select>`,
      buttons: {
        ok: {
          label: 'Link',
          callback: (html) => {
            input.value = html.find('select[name="locScenePick"]').val() || '';
            this._locPaintScene();
            this._renderPreview();
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'ok',
    }).render(true);
  }

  static _onLocSec(event, target) {
    const wrap = target.closest('[data-loc-sec]');
    const input = wrap?.querySelector('[name="locationSecurity"]');
    if (!wrap || !input) return;
    const lvl = Number(target.dataset.level) || 0;
    input.value = (Number(input.value) === lvl) ? 0 : lvl; // click the active level → clear
    this._locPaintSec();
    this._renderPreview();
  }

  _locPaintStage() {
    const el = this.element; if (!el) return;
    const stage = el.querySelector('[data-loc-stage]'); if (!stage) return;
    const src = (el.querySelector('[name="locationImage"]')?.value || '').trim();
    stage.classList.toggle('has-img', !!src);
    stage.style.backgroundImage = src ? `url('${src.replace(/'/g, "\\'")}')` : '';
  }

  _locPaintScene() {
    const el = this.element; if (!el) return;
    const id = el.querySelector('[name="locationSceneId"]')?.value || '';
    const lbl = el.querySelector('[data-loc-scene-lbl]');
    if (lbl) lbl.textContent = id ? (game.scenes?.get(id)?.name || 'scene ✓') : 'pick a scene…';
    el.querySelector('[data-action="locScene"]')?.classList.toggle('is-on', !!id);
  }

  _locPaintSec() {
    const el = this.element; if (!el) return;
    const wrap = el.querySelector('[data-loc-sec]'); if (!wrap) return;
    const lvl = Number(wrap.querySelector('[name="locationSecurity"]')?.value) || 0;
    wrap.querySelectorAll('b[data-level]').forEach(b => b.classList.toggle('on', Number(b.dataset.level) <= lvl));
    const cap = wrap.querySelector('[data-loc-sec-cap]');
    if (cap) cap.textContent = ['—', 'LOW', 'GUARDED', 'HIGH', 'LETHAL'][lvl];
  }

  _wireLocEditor(el) {
    this._locPaintStage();
    this._locPaintScene();
    this._locPaintSec();
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

  // ═══════════════════════════════════════════════════════════
  //  GALLERY contact-sheet editor (mode seg · thumb-picker · reorder ·
  //  scene link · folder import)
  // ═══════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════
  //  ENVELOPE (#37) — Show as MESSAGE / FILE + the exfil override grid
  // ═══════════════════════════════════════════════════════════

  /** Show-as segmented control → hidden input + DOM-only field swap. */
  static _onEnvSeg(event, target) {
    const wrap = target.closest('[data-env-seg]');
    const input = this.element?.querySelector('[name="envelope"]');
    if (!wrap || !input) return;
    const val = target.dataset.val === 'file' ? 'file' : 'mail';
    input.value = val;
    wrap.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === target));
    // CSS shows/hides [data-env-only] off this attr — a DOM-only swap, so
    // unsaved edits in the other envelope's fields survive a flip-flop.
    this.element?.querySelector('[data-env-cfg]')?.setAttribute('data-envelope', val);
    this._syncEnvLabels(val);
    this._syncCmpChips();
    this._renderPreview();
  }

  /** Swap dual-purpose labels ("Timestamp" ↔ "Modified") without a re-render. */
  _syncEnvLabels(envelope) {
    for (const el of this.element?.querySelectorAll('[data-env-lbl]') || []) {
      const [mail, file] = String(el.dataset.envLbl).split('|');
      const [mailTxt, fileTxt] = el.textContent.includes('|')
        ? el.textContent.split('|') : [null, null];
      // The template ships "Timestamp|Modified" as the text; keep both halves
      // in the dataset the first time we touch it so re-flips still work.
      if (!el.dataset.envLblMail) {
        el.dataset.envLblMail = (mailTxt ?? mail ?? el.textContent).trim();
        el.dataset.envLblFile = (fileTxt ?? file ?? el.textContent).trim();
      }
      el.textContent = envelope === 'file' ? el.dataset.envLblFile : el.dataset.envLblMail;
    }
  }

  /**
   * Exfil override MODE — "follow terminal" vs "only what I allow" (the latter
   * denies every action left on INH). This is the control whose absence made
   * overrides feel broken: allowing one action while the rest inherited an
   * allow changed nothing visible.
   */
  static _onExfMode(event, target) {
    const wrap = target.closest('[data-exf-seg]');
    const input = this.element?.querySelector('[name="exfMode"]');
    if (!wrap || !input) return;
    const val = target.dataset.val === 'custom' ? 'custom' : 'inherit';
    input.value = val;
    wrap.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === target));
    const box = this.element?.querySelector('[data-exf-ovr]');
    box?.setAttribute('data-exf-mode', val);
    const note = this.element?.querySelector('[data-exf-modenote]');
    if (note) {
      note.textContent = val === 'custom'
        ? 'Only the actions you set to ALLOW below can be used on this entry. Everything left on INH is denied.'
        : 'Actions left on INH follow the terminal’s Exfil tab. Set one to DENY to block it here.';
    }
    this._syncCmpChips();
  }

  /** Per-entry exfil override — INHERIT / ALLOW / DENY tri-state → hidden input. */
  static _onExfState(event, target) {
    const row = target.closest('[data-exf-row]');
    const tri = target.closest('[data-exf-tri]');
    if (!row || !tri) return;
    const key = tri.dataset.exfTri;
    const input = row.querySelector(`[name="exf_${key}"]`);
    if (!input) return;
    const val = target.dataset.val || 'inherit';
    input.value = val;
    tri.querySelectorAll('button').forEach((b) => {
      const on = b === target;
      b.classList.toggle('is-on', on);
      b.classList.toggle('is-allow', on && val === 'allow');
      b.classList.toggle('is-deny', on && val === 'deny');
    });
    // Only a rolled action needs its own DV — a plain allow/deny doesn't.
    const dv = row.querySelector(`[name="exfdv_${key}"]`);
    if (dv) dv.disabled = val === 'deny';
  }

  /** Segmented control (Mode STILLS/FEED · Layout GRID/STRIP) → hidden input. */
  static _onGalSeg(event, target) {
    const wrap = target.closest('[data-gal-seg]');
    const input = wrap && this.element?.querySelector(`[name="${wrap.dataset.galSeg}"]`);
    if (!input) return;
    input.value = target.dataset.val || '';
    wrap.querySelectorAll('button').forEach(b => b.classList.toggle('is-on', b === target));
    // Mode drives the feed-only card rows + cam-skill row via CSS on the fieldset.
    if (wrap.dataset.galSeg === 'galMode') {
      this.element?.querySelector('[data-gal-cfg]')?.setAttribute('data-gal-mode', input.value === 'feed' ? 'feed' : 'stills');
    }
    input.dispatchEvent(new Event('input', { bubbles: true })); // live preview refresh
  }

  /** The thumb IS the picker: empty → FilePicker; filled → NCM lightbox. */
  static _onGalCardThumb(event, target) {
    const row = target.closest('.ncm-cl-row');
    const input = row?.querySelector('[name^="galImages__url-"]');
    if (!input) return;
    const url = input.value.trim();
    if (url) {
      target.dataset.src = url;
      target.dataset.caption = row.querySelector('[name^="galImages__caption-"]')?.value || '';
      target.dataset.label = row.querySelector('[name^="galImages__label-"]')?.value || '';
      openGalleryImage(target, { host: this.element });
      return;
    }
    new FilePicker({
      type: 'image',
      callback: (path) => {
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
    }).render(true);
  }

  /** Per-cam scene link (feed mode) — the calendar scene-picker Dialog. */
  static _onGalScene(event, target) {
    const row = target.closest('.ncm-cl-row');
    const input = row?.querySelector('[name^="galImages__sceneId-"]');
    if (!input) return;
    const esc = (s) => Handlebars.escapeExpression(String(s ?? ''));
    const cur = input.value || '';
    const opts = ['<option value="">— no scene —</option>']
      .concat((game.scenes?.contents ?? []).map(s => `<option value="${s.id}"${s.id === cur ? ' selected' : ''}>${esc(s.name)}</option>`))
      .join('');
    new Dialog({
      title: 'Link a Scene',
      content: `<p style="font-size:12px">The GM gets a "Go to Scene" button on this camera in the monitor view.</p><select name="galScenePick" style="width:100%">${opts}</select>`,
      buttons: {
        ok: {
          label: 'Link',
          callback: (html) => {
            const id = html.find('select[name="galScenePick"]').val() || '';
            input.value = id;
            const lbl = row.querySelector('[data-gal-scene-lbl]');
            if (lbl) lbl.textContent = id ? (game.scenes?.get(id)?.name || 'scene ✓') : 'scene';
            row.querySelector('[data-action="galScene"]')?.classList.toggle('is-on', !!id);
            input.dispatchEvent(new Event('input', { bubbles: true }));
          },
        },
        cancel: { label: 'Cancel' },
      },
      default: 'ok',
    }).render(true);
  }

  /**
   * IMPORT FOLDER — FilePicker.browse lists a directory and every image file
   * in it becomes a card, auto-numbered (the ten-frame CCTV dump in two
   * clicks). Replaces nothing: cards append after the existing ones (an
   * untouched single blank seed row is dropped first).
   */
  static _onGalImportFolder() {
    const container = this.element?.querySelector('[data-list="galImages"]');
    if (!container) return;
    const fp = new FilePicker({
      type: 'folder',
      callback: async (path) => {
        try {
          const res = await FilePicker.browse(fp.activeSource || 'data', path);
          const isImg = /\.(png|jpe?g|webp|gif|avif|svg)(\?.*)?$/i;
          const files = (res?.files || []).filter(f => isImg.test(f));
          if (!files.length) { ui.notifications.warn('NCM | No image files in that folder.'); return; }
          // A single untouched blank seed row makes way for the import.
          const rows = container.querySelectorAll('.ncm-cl-row');
          if (rows.length === 1 && !rows[0].querySelector('[name^="galImages__url-"]')?.value.trim()) rows[0].remove();
          const base = container.querySelectorAll('.ncm-cl-row').length;
          container.insertAdjacentHTML('beforeend', files.map((f, i) => this._galCardHtml(base + i, { url: f })).join(''));
          this._renumberList(container);
          this._renderPreview();
          ui.notifications.info(`NCM | Imported ${files.length} image${files.length === 1 ? '' : 's'}.`);
        } catch (err) {
          log.warn(`Gallery folder import failed: ${err.message}`);
          ui.notifications.error('NCM | Folder import failed.');
        }
      },
    });
    fp.render(true);
  }

  /**
   * Drag-to-reorder the contact sheet — only the ⋮⋮ handle is draggable
   * (draggable on the whole card would break text selection in its inputs).
   * _collectList walks rows in DOM order with prefix-matched names, so a
   * moved card needs no input renaming — only the number chips repaint.
   */
  _wireGalReorder(container) {
    if (!container || container.dataset.dragWired) return;
    container.dataset.dragWired = '1';
    let dragRow = null;
    container.addEventListener('dragstart', (e) => {
      const handle = e.target?.closest?.('.ncm-galcard__drag');
      if (!handle) { e.preventDefault(); return; }
      dragRow = handle.closest('.ncm-cl-row');
      dragRow.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'gal'); } catch (_) { /* IE-ish */ }
      try { e.dataTransfer.setDragImage(dragRow, 60, 40); } catch (_) { /* optional */ }
    });
    container.addEventListener('dragover', (e) => {
      if (!dragRow) return;
      e.preventDefault();
      const over = e.target?.closest?.('.ncm-cl-row');
      if (!over || over === dragRow) return;
      const r = over.getBoundingClientRect();
      const before = (e.clientX - r.left) < r.width / 2;
      container.insertBefore(dragRow, before ? over : over.nextSibling);
    });
    container.addEventListener('dragend', () => {
      if (!dragRow) return;
      dragRow.classList.remove('is-dragging');
      dragRow = null;
      this._renumberList(container);
      this._renderPreview();
    });
  }

  /**
   * Per-row image FilePicker (list-engine `type:'image'` fields — gallery).
   * The button sits right after its input in the same row; the picked path
   * dispatches an input event so the live preview refreshes.
   */
  static _onBrowseListImage(event, target) {
    const input = target.previousElementSibling;
    if (!input || input.tagName !== 'INPUT') return;
    new FilePicker({
      type: 'image',
      current: input.value || '',
      callback: (path) => {
        input.value = path;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
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
      callback: (path) => {
        if (!input) return;
        input.value = path;
        // A programmatic set fires no events — refresh the deck preview + the
        // live entry preview explicitly.
        this._avSyncMedia();
        this._renderPreview();
      },
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
