/**
 * EntryTemplates — per-type example entries + the GM entry-template library.
 * @file scripts/ui/content/EntryTemplates.js
 * @module night-city-messenger
 * @description Two layers, both surfaced in the DataShardComposer's
 *   "Templates & Examples" fieldset:
 *
 *   · BUILT-IN EXAMPLES — one option-rich seed per content type (ported from
 *     tools/test-terminal-setup.macro.js) so a GM can load a worked example of
 *     any type, see how the fields drive the renderer, and edit from there.
 *     Timestamps are deliberately omitted — the composer's game-time default
 *     applies on load.
 *
 *   · GM TEMPLATE LIBRARY — world setting `entryTemplates`
 *     ([{ id, name, type, entry }]) with save / delete / import / export
 *     (envelope { ncmEntryTemplates: 1, exportedAt, templates } — bare arrays
 *     accepted, fresh ids on import, de-duped by name+type; the spam-template
 *     pattern).
 *
 *   Loading either one prefills the composer via its existing editData
 *   machinery (entryId stripped, so Save always creates a NEW entry).
 */

import { MODULE_ID, CONTENT_TYPES } from '../../utils/constants.js';
import { log } from '../../utils/helpers.js';

/* ══════════════════════════════════════════════════════════════
   Built-in examples — one per content type (§8c catalog).
   Shape = the canonical addMessage entry: { contentType, from,
   subject, body?, contentData }. No timestamp (composer default).
   ══════════════════════════════════════════════════════════════ */

/** Calendar example dates ride relative to load time so the NEXT strip /
 *  month grid / past collapse all demo live (an authoring seed, not a
 *  countdown — the raw-Date rule targets gameplay timers). */
function _exWhen(days, hour = 12) {
  const d = new Date(Date.now() + days * 86400000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export const BUILTIN_EXAMPLES = Object.freeze({
  [CONTENT_TYPES.MESSAGE]: {
    contentType: 'message', from: 'logistics@arasaka.net', subject: 'Shipment 4471',
    body: 'Convoy 4471 cleared customs at NCIA. ETA 0400. Manifest attached.',
    contentData: {},
  },
  [CONTENT_TYPES.EDDIES]: {
    contentType: 'eddies', from: 'fixer@afterlife.nc', subject: 'Payment — half up front',
    contentData: { amount: 25000, claimed: false, claimedBy: null, claimedAt: null, note: 'Half now. The rest when the shard is in my hand.', splitEnabled: false },
  },
  [CONTENT_TYPES.DOSSIER]: {
    contentType: 'dossier', from: 'counterintel@arasaka.net', subject: '“Ratchet”',
    contentData: {
      targetName: 'Rachel Kovach', targetAlias: '"Ratchet"', targetImage: null, linkedActorId: null,
      classification: 'SECRET',
      sections: [
        { heading: 'Overview', body: 'Ex-Arasaka counter-intel, burned after the Q1 leak. Now freelancing for a Militech cutout.', redacted: false },
        { heading: 'Current operation', body: 'Details sealed pending director approval.', redacted: true },
      ],
      stats: { threat: 'HIGH', affiliation: 'Arasaka (former)', lastKnownLocation: 'Japantown, mega-building H4' },
      declassify: true, declassifySkill: 'Interface', declassifyDV: 15, traceOnFail: false,
      // Masked identity — the face + real name hide for players until a roll.
      faceLocked: true, faceUnlockSkill: 'Interface', faceUnlockDV: 15, faceTraceOnFail: true,
      // Combat profile — link a world actor and these read LIVE from the sheet.
      profile: { enabled: true, title: 'COMBAT PROFILE', visibility: 'encrypted', skill: 'Interface', dv: 13, stats: ['body', 'ref', 'cool', 'tech'], skills: ['Handgun', 'Stealth'], decrypted: false },
    },
  },
  [CONTENT_TYPES.PAYLOAD]: {
    contentType: 'payload', from: 'ghostworks@relay.onion', subject: 'BREACH.EXE',
    contentData: {
      name: 'BREACH.EXE', program: 'icebreaker suite', version: '2.1', sizeLabel: '4.7 MB',
      publisher: 'Night City Ghostworks', signed: true, charges: 1,
      description: 'Militech-surplus intrusion suite. Chews through file encryption on the host system.',
      effect: { type: 'icebreaker', duration: 0, macroId: '' },
      requirements: [{ kind: 'uplink', label: 'machine uplink must be online' }],
      output: [
        { sev: 'info', text: '> init breach.exe --target=LOCAL' },
        { sev: 'ok', text: 'loading cipher tables… done' },
        { sev: 'warn', text: 'bypassing watchdog…' },
        { sev: 'ok', text: 'injecting keys… OK' },
      ],
      executeRequire: true, executeSkill: 'Interface', executeDV: 13, traceOnFail: true,
      disguised: false, disguiseType: 'note', sniffDV: 15, sniffed: false,
      executed: false, executedBy: null, executedAt: null,
      active: false, expiresAt: null, killed: false, tripped: false, scanReport: '',
    },
  },
  [CONTENT_TYPES.AVLOG]: {
    // No mediaUrl + a duration → the viewer gets ▶ TRANSCRIPT PLAYBACK.
    contentType: 'avlog', from: 'surveillance@arasaka.net', subject: 'Lobby intercept — 7F',
    contentData: {
      mediaType: 'audio', mediaUrl: '', duration: '00:41', source: 'lobby mic — Tower B · 7F',
      transcript: [
        { speaker: 'ALVAREZ', text: 'The convoy moves at 0400. No escort past the border checkpoint.' },
        { speaker: 'UNKNOWN', text: 'And the eddies?' },
        { speaker: 'ALVAREZ', text: 'Cleared this morning. Off-book, same as last time.' },
        { speaker: 'UNKNOWN', text: 'Then we never spoke.' },
      ],
      corrupted: false, corruptionLevel: 0,
    },
  },
  [CONTENT_TYPES.LOCATION]: {
    contentType: 'location', from: 'logistics@arasaka.net', subject: 'Dead drop location',
    contentData: {
      locationName: 'Dead drop — Kabuki Market', locationImage: null,
      coordinates: 'N 37.7793° W 122.4192°', district: 'Watson · Kabuki',
      description: 'South entrance, under the red neon dragon. Loose brick, third row from the vent.',
      linkedSceneId: null, pinX: null, pinY: null,
      controlledBy: 'Tyger Claws', security: 3, heat: 'NCPD HOT ZONE',
      hours: '22:00 – 05:00', access: 'Service door, keypad — code changes weekly',
      approach: 'Come on foot; cars get made by the roof spotters', contact: 'Tiny (door), owes Rogue a favor',
      // Encrypted pin — image/coords/intel sealed until a DECRYPT roll (FUI reveal).
      locked: true, unlockSkill: 'Interface', unlockDV: 13, traceOnFail: false,
    },
  },
  [CONTENT_TYPES.SPREADSHEET]: {
    contentType: 'spreadsheet', from: 'finance@arasaka.net', subject: 'Q3 Off-Book Disbursements',
    contentData: {
      format: 'disbursements.csv',
      columns: [
        { label: 'Date', type: 'date' }, { label: 'Payee', type: 'text' }, { label: 'Account', type: 'text' },
        { label: 'Memo', type: 'text' }, { label: 'Amount €$', type: 'currency' }, { label: 'Status', type: 'status' },
      ],
      rows: [
        ['06.02', { value: 'Maelstrom (proxy)', bold: true, color: 'red' }, '—', '"consulting"', '240,000', 'CLEARED'],
        ['06.09', 'R. Kovach', 'NC-8841-A', 'severance', '18,500', 'CLEARED'],
        ['06.14', '—', { value: 'NC-0007-Z', bg: 'amber' }, '"logistics"', '512,000', 'HELD'],
        ['06.28', 'Petrov Imp/Exp', 'NC-3120-C', '"hardware"', '96,400', 'PENDING'],
      ],
      redacted: [[0, 2], [2, 1]], flagged: [[0, 4], [2, 4]],
      flagReasons: { '0:4': 'exceeds €$200k disclosure threshold', '2:4': 'held pending NetWatch review' },
      totals: [4], selected: [0, 4],
      note: 'Cross-ref account NC-0007-Z with NetWatch watchlist.',
    },
  },
  [CONTENT_TYPES.CALENDAR]: {
    contentType: 'calendar', from: 'calendar@arasaka.net', subject: 'V. Arasaka — Schedule',
    contentData: {
      defaultView: 'rail',
      categories: { Handoff: 'amber', Meeting: 'cyan', Payment: 'green' },
      events: [
        { title: 'Handoff — Pacifica docks, pier 7', when: _exWhen(2, 21), location: 'Pacifica', who: '"Tinman"', note: 'bring the shard', category: 'Handoff' },
        { title: 'Board review — Arasaka Tower 41F', when: _exWhen(5, 9), location: 'City Center', who: 'Exec floor', category: 'Meeting' },
        { title: 'Wire transfer confirm', when: _exWhen(-4, 14), location: 'remote', who: 'R. Kovach', category: 'Payment' },
        { title: 'OFF-GRID — do not log', when: _exWhen(1, 3), color: 'red' },
        { title: 'Silent extraction — the safehouse', when: _exWhen(3, 2), location: 'Charter Hill', category: 'Handoff', locked: true, unlockSkill: 'Cryptography', unlockDV: 14, traceOnFail: true },
      ],
    },
  },
  [CONTENT_TYPES.SYSLOG]: {
    contentType: 'syslog', from: 'syslog@arasaka.net', subject: 'auth.log — access history',
    contentData: {
      host: 'arasaka-ws-04', path: '/var/log/auth.log',
      showLineNumbers: true, showFilter: true, scanlines: true, showPrompt: true,
      lines: [
        { ts: '02:14:07', sev: 'info', actor: 'v_arasaka', msg: 'session opened from 10.4.x' },
        { ts: '02:31:55', sev: 'ok', actor: 'v_arasaka', msg: 'read: Q3-disbursements.csv' },
        { ts: '03:02:10', sev: 'warn', actor: 'guest', msg: '3 failed auth attempts' },
        { ts: '03:02:44', sev: 'error', actor: 'guest', msg: 'account locked — 60s' },
        { ts: '03:49:02', sev: 'warn', actor: 'admin_root', msg: 'purged auth.log[0:40]', mark: true },
      ],
    },
  },
  [CONTENT_TYPES.CREDENTIALS]: {
    contentType: 'credentials', from: 'vault@arasaka.net', subject: 'Recovered credentials',
    contentData: {
      autoReuse: true,
      entries: [
        { host: 'netwatch-relay.ncpd.gov', user: 'v.arasaka', secret: 'Hx9$kRel-2077', strength: 3, note: 'reused on tower mainframe → pivot' },
        { host: 'tower-mainframe.arasaka', user: 'v.arasaka', secret: 'Hx9$kRel-2077', strength: 3 },
        { host: 'cold-wallet.militech', user: 'treasury_07', secret: 'MTech-C0ldSt0re#7', encrypted: true, cracked: false, crackSkill: 'Interface', crackDV: 15 },
        { host: 'legacy-bbs.watson.nc', user: 'vee_2020', secret: 'password1', strength: 1 },
      ],
    },
  },
  [CONTENT_TYPES.BANKING]: {
    contentType: 'banking', from: 'bank@arasaka.net', subject: 'Ops account ledger',
    contentData: {
      bankName: 'Night City Trust', bankLogo: '', bankLocation: 'City Center · Corpo Plaza',
      bankCode: 'SWIFT NCTBNCNX', bankTagline: 'Your eddies. Our silence.', bankColor: '#7a2f2f',
      status: 'active',
      allowSiphon: true, siphonSkill: 'Interface', siphonDV: 15, siphonMode: 'cap', siphonCap: 500000,
      siphonDVScale: true, siphonDVPer: 100000, siphonLockout: true, siphonMaxAttempts: 3, siphonLockoutMin: 30,
      owner: 'V. Arasaka', accountType: 'Checking',
      accountName: 'Arasaka Holdings — Ops', accountNumber: 'NC-8841-A-0007',
      balance: 2419650, currency: '€$', cleared: 1907650, held: 512000,
      transactions: [
        { date: '06.28', desc: 'Inbound — Petrov Imp/Exp', amount: 96400, type: 'credit', category: 'inbound' },
        { date: '06.21', desc: 'Retainer — Trauma Team', amount: 75000, type: 'debit', category: 'services' },
        { date: '06.14', desc: '"logistics"', amount: 512000, type: 'debit', category: 'wire', pending: true },
        { date: '06.02', desc: '"consulting"', amount: 240000, type: 'debit', category: 'flagged' },
      ],
    },
  },
  [CONTENT_TYPES.GALLERY]: {
    contentType: 'gallery', from: 'seccam@arasaka.net', subject: 'cam-04 export — loading dock',
    contentData: {
      title: 'Loading dock — night shift', source: 'SECCAM-B2',
      unlockSkill: 'Interface', unlockDV: 15,
      images: [
        { url: 'icons/environment/settlement/building-rubble.webp', label: 'IMG_014', time: '03:41', caption: 'Truck arrives, plates covered' },
        { url: 'icons/environment/people/cleric-grey.webp', label: 'IMG_015', time: '03:44', caption: 'Unidentified handler', flagged: true },
        { url: 'icons/environment/settlement/gazebo.webp', label: 'IMG_016', time: '03:47', caption: 'Handoff moment — faces visible', locked: true },
        { label: 'IMG_017', time: '03:52', caption: 'Frame corrupted at source', corrupted: true },
      ],
    },
  },
  [CONTENT_TYPES.DOCUMENT]: {
    contentType: 'document', from: 'k.okada@arasaka.net', subject: 'MEMO — Warehouse 7 shortfall',
    contentData: {
      title: 'Re: Warehouse 7 inventory shortfall', docType: 'MEMO',
      author: 'K. Okada', org: 'Arasaka Logistics', date: '2077-06-12T00:00:00Z', revision: '3',
      classification: 'SECRET', watermark: 'ARASAKA',
      signed: 'K. Okada — Logistics Director, NC Branch',
      declassify: true, declassifySkill: 'Interface', declassifyDV: 15,
      paragraphs: [
        { heading: 'Summary', text: 'Q2 reconciliation shows a <b>512,000 eddie variance</b> in Warehouse 7 outbound manifests. Internal audit is <i>not</i> to be looped in until legal reviews exposure.' },
        { kind: 'list', ordered: true, heading: 'Findings', items: ['Manifests W7-0388 through W7-0441 falsified', 'Cold-storage counts off by 14 crates', 'Badge W7-0441 active during every camera gap'] },
        { quote: true, text: 'If this surfaces before the board review, we handle it internally. — T.M.' },
        { heading: 'Distribution', text: 'T. Mizuki (VP Logistics) · K. Okada · handler ID W7-0441 — no one else.', redacted: true },
        { text: 'Destroy after reading. Do not forward outside DL-7.' },
      ],
    },
  },
  [CONTENT_TYPES.CHATLOG]: {
    contentType: 'chatlog', from: 'nc-msg@backup.local', subject: 'Recovered chat — #dock-crew',
    contentData: {
      app: 'NC-MSG', channel: '#dock-crew',
      participants: [{ name: 'v_arasaka', me: true }, { name: 'Tinman' }, { name: 'Dispatch-7' }],
      messages: [
        { kind: 'system', system: 'Dispatch-7 added v_arasaka to the group', sysIcon: 'user-plus', date: '2045-06-01' },
        { from: 'Tinman', text: "truck's in. plates are clean, relax", time: '03:42', date: '2045-06-01' },
        { from: 'v_arasaka', text: 'transfer clears when the crates clear. same as always', time: '03:45', date: '2045-06-01' },
        { kind: 'photo', from: 'Dispatch-7', image: 'icons/environment/settlement/house-two-stories-small.webp', caption: 'B2 service door — circled', time: '03:46', date: '2045-06-01', reactions: ['👀', '👍'] },
        { from: 'Dispatch-7', text: 'cams on B2 go dark in 5. move.', time: '03:47', date: '2045-06-01' },
        { from: 'v_arasaka', text: 'on it.', time: '03:47', date: '2045-06-01', seen: true, seenTime: '03:48' },
        { kind: 'system', system: 'Missed call · Tinman', sysIcon: 'phone-slash', time: '04:02', date: '2045-06-02' },
        { from: 'Tinman', deleted: true, time: '04:05', date: '2045-06-02' },
      ],
    },
  },
  [CONTENT_TYPES.RECORD]: {
    contentType: 'record', from: 'dispatch@ncpd.gov', subject: 'BOLO registry — Watson',
    contentData: {
      dbName: 'NCPD BOLO REGISTRY', recordType: 'criminal', searchable: true,
      records: [
        { name: 'Morgan Wills', status: 'WANTED', flagged: true, fields: [
          { kind: 'id', value: 'NC-88213' },
          { kind: 'alias', value: "'Ghost'" },
          { kind: 'phone', value: '+1 555-0148' },
          { kind: 'date', value: '2045-06-01T00:00:00Z', label: 'Last seen' },
          { kind: 'threat', value: 3 },
          { kind: 'priors', value: 'armed robbery, grand theft auto' },
          { kind: 'bounty', value: 5000 },
          { kind: 'warrant', value: true },
          { kind: 'address', value: 'Watson · Kabuki, 4th St' },
        ] },
        { name: 'Jax Kane', status: 'ACTIVE', fields: [
          { kind: 'alias', value: "'Wrench'" },
          { kind: 'phone', value: '+1 555-2201' },
          { kind: 'note', value: 'Runs guns out of a Watson chop-shop. Known Maelstrom associate.' },
        ] },
        { name: 'Dr. Vera Cruz', status: 'STABLE', fields: [
          { kind: 'id', value: 'TT-4471' },
          { kind: 'blood', value: 'O−' },
          { kind: 'cyberware', value: 'Kerenzikov Mk.3, Ripperdoc-grade optics' },
          { kind: 'date', value: '2045-05-28T00:00:00Z', label: 'Intake' },
          { kind: 'rating', value: 4 },
        ] },
      ],
    },
  },
  [CONTENT_TYPES.SCHEMATIC]: {
    contentType: 'schematic', from: 'facilities@arasaka.net', subject: 'BP-114 — Warehouse 7, floor 2',
    contentData: {
      title: 'Warehouse 7 — Floor 2', docRef: 'BP-2077-114',
      imageUrl: 'icons/environment/settlement/house-two-stories-small.webp',
      annotations: [
        { id: 'p1', x: 80, y: 72, type: 'entry', label: 'Service door', note: 'maglock — Tinman has a key' },
        { id: 'p2', x: 55, y: 55, type: 'guard', label: 'Guard post', note: 'two guards, rotates 02:00' },
        { id: 'p3', x: 38, y: 30, type: 'camera', label: 'PTZ cam', note: 'covers the main aisle' },
        { id: 'p4', x: 20, y: 44, type: 'objective', label: 'Cold storage', note: 'the crates land here' },
        { id: 'p5', x: 62, y: 22, type: 'terminal', label: 'Security console', note: 'kills the cams', locked: true, unlockSkill: 'Interface', unlockDV: 13 },
      ],
      routes: [
        { from: 'p1', to: 'p2' },
        { from: 'p2', to: 'p4' },
      ],
    },
  },
  [CONTENT_TYPES.NOTE]: {
    contentType: 'note', from: 'v_arasaka@arasaka.net', subject: 'note to self',
    contentData: {
      title: "DON'T FORGET",
      text: "vault code = boss's dog's birthday\n0451? 0452??\nASK RITA BEFORE FRIDAY\n\n(and delete this note)",
      color: 'gold', pinned: true,
    },
  },
  [CONTENT_TYPES.MALWARE]: {
    contentType: 'malware', from: 'quarantine@arasaka.net', subject: 'QUARANTINE: HELLHOUND.exe',
    contentData: {
      name: 'HELLHOUND.exe', payloadType: 'daemon', threat: 3, sizeLabel: '4.7 MB',
      description: 'Scanner flags outbound C2 traffic and credential scraping. Origin unknown. Do NOT execute outside a sandbox.',
      deployable: true, honeypot: false,
      deployRequire: false, deploySkill: 'Interface', deployDV: 15, iceActorId: null,
      deployed: false, deployedBy: null, tripped: false,
    },
  },
});

/* ══════════════════════════════════════════════════════════════
   GM template library — world setting `entryTemplates`.
   ══════════════════════════════════════════════════════════════ */

const SETTING = 'entryTemplates';

/** All saved templates: [{ id, name, type, entry }]. */
export function getEntryTemplates() {
  try { return game.settings.get(MODULE_ID, SETTING) ?? []; }
  catch { return []; }
}

/** Save an entry as a named template. Returns the stored record. */
export async function saveEntryTemplate(name, entry) {
  const templates = getEntryTemplates().map(t => ({ ...t }));
  const record = {
    id: `tpl-${foundry.utils.randomID(8)}`,
    name: String(name || 'Untitled').trim() || 'Untitled',
    type: entry?.contentType || CONTENT_TYPES.MESSAGE,
    entry: foundry.utils.deepClone(entry),
  };
  // Strip anything that must not travel: a template always creates NEW.
  delete record.entry.entryId;
  templates.push(record);
  await game.settings.set(MODULE_ID, SETTING, templates);
  return record;
}

export async function deleteEntryTemplate(id) {
  const templates = getEntryTemplates().filter(t => t.id !== id);
  await game.settings.set(MODULE_ID, SETTING, templates);
}

/** Blob-download all saved templates (spam-template envelope pattern). */
export function exportEntryTemplates() {
  const templates = getEntryTemplates();
  const payload = { ncmEntryTemplates: 1, exportedAt: new Date().toISOString(), templates };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ncm-entry-templates-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return templates.length;
}

/**
 * Import templates from a parsed JSON payload (envelope or bare array).
 * Fresh ids; de-duped against existing by name+type (case-insensitive).
 * @returns {Promise<{imported:number, skipped:number}>}
 */
export async function importEntryTemplates(payload) {
  const incoming = Array.isArray(payload) ? payload : payload?.templates;
  if (!Array.isArray(incoming)) {
    throw new Error('Invalid format — expected an entry-template export or a JSON array.');
  }
  const templates = getEntryTemplates().map(t => ({ ...t }));
  const validTypes = new Set(Object.values(CONTENT_TYPES));
  // Dedupe key = NORMALIZED name+type (stored records are already normalized;
  // incoming records must normalize BEFORE keying or an unknown-type template
  // re-imports every time — caught by the logic sim).
  const keyOf = (name, type) => `${String(name).toLowerCase().trim()}|${type}`;
  const existing = new Set(templates.map(t => keyOf(t.name, t.type)));

  let imported = 0, skipped = 0;
  for (const raw of incoming) {
    const entry = raw?.entry;
    if (!entry || typeof entry !== 'object') { skipped++; continue; }
    const type = validTypes.has(entry.contentType) ? entry.contentType : CONTENT_TYPES.MESSAGE;
    const name = String(raw.name || entry.subject || 'Imported').trim() || 'Imported';
    if (existing.has(keyOf(name, type))) { skipped++; continue; }
    const record = {
      id: `tpl-${foundry.utils.randomID(8)}`,
      name, type,
      entry: { ...foundry.utils.deepClone(entry), contentType: type },
    };
    delete record.entry.entryId;
    templates.push(record);
    existing.add(keyOf(name, type));
    imported++;
  }
  if (imported > 0) await game.settings.set(MODULE_ID, SETTING, templates);
  log.info(`EntryTemplates: imported ${imported} (${skipped} skipped)`);
  return { imported, skipped };
}
