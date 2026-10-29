// Sim: tester round 2026-10-26 (Aegaeon).
//   1. Shards can be renamed (display name + item name together), and removing
//      the shard data gives the item back its old name + picture.
//   2. Players can only write on items the GM's blank rule allows (gear by
//      default) — the Encoder list, the right-click door and the terminal burn.
//   3. The optional `shardNamePrefix` is added on convert and removed on unconvert.
//   4. Terminal accounts: a per-account Agent-mail mirror switch, and copying
//      chosen Agent messages (received + sent) onto an account.
// Drives the REAL DataShardService / TerminalService methods via prototype.call
// over mocked documents, plus wiring guards. Run:
//   node dev/tools/sims/test-shard-naming-and-import.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ── Minimal Foundry globals ──
let PREFIX = '';
globalThis.game = {
  user: { isGM: true }, users: { activeGM: {} },
  journal: { contents: [] }, actors: { get: () => null }, items: [],
  settings: { get: () => undefined },
  nightcity: {
    settingsManager: { getShardNamePrefix: () => PREFIX },
    timeService: { getCurrentTime: () => '2045-03-13T02:14:00Z', getCurrentTimeMs: () => 0 },
  },
};
const deepClone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));
globalThis.foundry = { utils: {
  deepClone,
  mergeObject: (a, b, { inplace = true } = {}) => {
    const out = inplace ? a : deepClone(a);
    const merge = (t, s) => { for (const [k, v] of Object.entries(s || {})) { if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else t[k] = v; } return t; };
    return merge(out, b);
  },
  randomID: () => Math.random().toString(36).slice(2, 10),
} };
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
globalThis.JournalEntry = { create: async (d) => ({ id: 'jrnl1', ...d }) };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

// ═══════════════ 1. Naming helpers (pure) ═══════════════
const N = await imp('scripts/utils/shardNaming.js');
ok(N.withShardPrefix('Pistol', 'Chip - ') === 'Chip - Pistol', 'prefix added');
ok(N.withShardPrefix('chip - Pistol', 'Chip - ') === 'chip - Pistol', 'already prefixed (any case) → unchanged');
ok(N.withShardPrefix('Pistol', '') === 'Pistol' && N.withShardPrefix('Pistol', '   ') === 'Pistol', 'no prefix → unchanged');
ok(N.stripShardPrefix('Chip - Pistol', 'Chip - ') === 'Pistol', 'prefix stripped');
ok(N.stripShardPrefix('Pistol', 'Chip - ') === 'Pistol', 'not prefixed → unchanged');
ok(N.stripShardPrefix('Chip - ', 'Chip - ') === 'Chip - ', 'never empties a name');
let rp = N.restorePatch({ name: 'Chip - Ledger', img: 'chip.svg' }, { name: 'Kang Tao Pistol', img: 'gun.webp' }, 'Chip - ');
ok(rp.name === 'Kang Tao Pistol' && rp.img === 'gun.webp', 'restore: recorded name + art win');
rp = N.restorePatch({ name: 'Chip - Ledger', img: 'chip.svg' }, null, 'Chip - ');
ok(rp.name === 'Ledger' && !('img' in rp), 'restore, legacy shard: prefix dropped, art kept');
rp = N.restorePatch({ name: 'Memo', img: 'a.svg' }, { name: 'Memo', img: 'a.svg' }, '');
ok(Object.keys(rp).length === 0, 'restore: nothing changed → empty patch');

// ═══════════════ 2. Blank rule (pure) ═══════════════
const E = await imp('scripts/ui/content/EncoderModel.js');
let cfg = E.resolveEncoderConfig({});
ok(cfg.blanks.source === 'gear', 'default rule is gear');
ok(E.resolveEncoderConfig({ blanks: { source: 'bogus' } }).blanks.source === 'gear', 'unknown rule → gear');
ok(E.isEligibleBlank(cfg, { name: 'Memory Chip', type: 'gear' }), 'gear qualifies');
ok(!E.isEligibleBlank(cfg, { name: 'Kang Tao Pistol', type: 'weapon' }), 'weapon refused by default');
ok(!E.isEligibleBlank(cfg, { name: 'Cyberarm', type: 'cyberware' }), 'cyberware refused by default');
ok(E.isEligibleBlank(cfg, { name: 'Pistol', type: 'weapon', tierId: 'standard' }), 'a bought blank (tierId) always qualifies');
const listed = E.resolveEncoderConfig({ tiers: [
  { id: 'scrap', name: 'Scrap', fallback: true, items: [] },
  { id: 'premium', name: 'Premium', items: [{ name: 'Militech Data Wafer' }] },
] });
ok(E.isEligibleBlank(listed, { name: 'Militech  Data-Wafer', type: 'cyberdeck' }), 'a tier-listed item qualifies whatever its type (name-insensitive)');
const reg = E.resolveEncoderConfig({ blanks: { source: 'registered' }, tiers: listed.tiers });
ok(!E.isEligibleBlank(reg, { name: 'Memory Chip', type: 'gear' }), 'registered: unlisted gear refused');
ok(E.isEligibleBlank(reg, { name: 'Militech Data Wafer', type: 'gear' }), 'registered: listed item qualifies');
ok(E.isEligibleBlank(E.resolveEncoderConfig({ blanks: { source: 'any' } }), { name: 'Pistol', type: 'weapon' }), 'any: old behaviour');
ok(/gear/i.test(E.blankRuleRefusal(cfg)) && /listed/i.test(E.blankRuleRefusal(reg)), 'refusal sentence follows the rule');
ok(Object.keys(E.BLANK_SOURCES).join() === 'gear,registered,any', 'three sources');

// ═══════════════ 3. Convert / unconvert (real DataShardService) ═══════════════
const { DataShardService } = await imp('scripts/services/DataShardService.js');
const shardSvc = Object.create(DataShardService.prototype);
shardSvc._applyPresetToConfig = (c) => c;
const mkItem = (name, img) => {
  const it = { id: 'i1', name, img, flags: {}, isOwner: true,
    getFlag: (m, k) => it.flags[m]?.[k],
    update: async (u) => {
      for (const [k, v] of Object.entries(u)) {
        if (k === `flags.-=${MOD}`) { delete it.flags[MOD]; continue; }
        if (!k.startsWith('flags.')) { it[k] = v; continue; }
        const parts = k.split('.').slice(1);
        let o = it.flags; for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
        o[parts[parts.length - 1]] = v;
      }
    },
  };
  return it;
};
PREFIX = 'Chip - ';
let gun = mkItem('Kang Tao Pistol', 'gun.webp');
let res = await shardSvc.convertToDataShard(gun);
ok(res.success, 'convert succeeds');
ok(gun.name === 'Chip - Kang Tao Pistol', 'convert adds the prefix');
ok(gun.flags[MOD].original?.name === 'Kang Tao Pistol' && gun.flags[MOD].original?.img === 'gun.webp', 'convert records the original name + art');
// the Encoder then restyles it
gun.name = 'Chip - Ghost Ledger'; gun.img = 'baked.png';
res = await shardSvc.removeDataShard(gun);
ok(res.success && !gun.flags[MOD], 'unconvert strips the flags');
ok(gun.name === 'Kang Tao Pistol' && gun.img === 'gun.webp', 'unconvert gives back the old name + art');
PREFIX = '';
const memo = mkItem('Memory Chip', 'chip.svg');
await shardSvc.convertToDataShard(memo);
ok(memo.name === 'Memory Chip', 'no prefix setting → name untouched');
const archive = mkItem('Copy of Ledger', 'x.png');
archive.flags[MOD] = { isDataShard: true, shardArchive: true, original: { name: 'Something else' } };
await shardSvc.removeDataShard(archive);
ok(archive.name === 'Copy of Ledger', 'an archive copy keeps its own name');
game.user.isGM = false;
ok(!(await shardSvc.removeDataShard(memo)).success, 'remove stays GM-only');
game.user.isGM = true;

// ═══════════════ 4. Terminal: mirror switch + copy onto an account ═══════════════
const { TerminalService } = await imp('scripts/services/TerminalService.js');
const { MessageRepository } = await imp('scripts/data/MessageRepository.js');
const pages = [];
const mkPage = (flags) => { const p = { id: 'p' + pages.length, flags: { [MOD]: flags } }; pages.push(p); return p; };
const tJournal = { pages: { contents: pages, find: (fn) => pages.find(fn) }, createEmbeddedDocuments: async (_, docs) => docs.map(d => mkPage(d.flags[MOD])) };
let tcfg = { accounts: [
  { id: 'reyes', username: 'mreyes', actorId: 'npcReyes', masterContactId: '', email: 'm.reyes@arasaka.corp' },
  { id: 'work', username: 'mreyes-w', actorId: 'npcReyes', masterContactId: '', mirrorAgentMail: false },
], folders: { custom: [] } };
const term = { id: 'term1', name: 'WS-7F', uuid: 'Item.term1',
  getFlag: (_, k) => (k === 'terminalConfig' ? tcfg : k === 'terminalState' ? {} : k === 'isTerminal' ? true : null),
  update: async (u) => { if (u[`flags.${MOD}.terminalConfig`]) tcfg = u[`flags.${MOD}.terminalConfig`]; } };
const svc = Object.create(TerminalService.prototype);
svc._getLinkedJournal = () => tJournal;
svc.collectTerminals = () => [term];
svc._exfilContentData = (m) => m.contentData || null;

// mirror
let mres = await svc.mirrorDeliveryToAccounts({ messageId: 'd1', toActorId: 'npcReyes', to: 'm.reyes@arasaka.corp', subject: 'hi', from: 'v@nc.net', status: {} });
ok(mres.mirrored === 1, 'mirror reaches the account with the switch on, not the one with it off');
ok(pages.some(p => p.flags[MOD].messageId === 'd1-t-reyes') && !pages.some(p => p.flags[MOD].messageId === 'd1-t-work'), 'the off account got nothing');

// the identity's Agent mailbox (actor inbox, received + sent + junk)
const repoPages = (list) => list.map((f) => ({ flags: { [MOD]: f } }));
const inbox = { flags: { [MOD]: { type: 'inbox', actorId: 'npcReyes' } }, name: 'Reyes — Inbox',
  pages: { contents: repoPages([
    { messageId: 'a1', subject: 'Payroll', from: 'hr@arasaka.corp', timestamp: '2045-03-01T00:00:00Z', status: { read: false }, eddies: 500 },
    { messageId: 'a2-sent', subject: 'Re: Payroll', from: 'm.reyes@arasaka.corp', to: 'hr@arasaka.corp', timestamp: '2045-03-02T00:00:00Z', status: { sent: true, read: true } },
    { messageId: 'a3', subject: 'old', status: { deleted: true } },
    { messageId: 'a4', subject: 'junk', status: { spam: true } },
  ]) } };
const otherInbox = { flags: { [MOD]: { type: 'inbox', actorId: 'someoneElse' } }, pages: { contents: repoPages([{ messageId: 'z1', subject: 'not hers', status: {} }]) } };
game.journal.contents = [inbox, otherInbox];
game.actors.get = (id) => (id === 'npcReyes' ? { name: 'M. Reyes' } : null);
game.nightcity.messageRepository = { _pageToMessage: (p) => deepClone(p.flags[MOD]) };
ok(typeof MessageRepository.identifyInbox === 'function', 'identifyInbox is static');

const g = svc.gatherIdentityMail(term, 'work');
ok(g.identity === 'M. Reyes', 'identity name resolved');
ok(g.messages.map(m => m.messageId).join() === 'a2-sent,a1', 'received + sent, newest first; deleted, spam and other inboxes left out');
ok(svc.gatherIdentityMail(term, 'nope').messages.length === 0, 'unknown account → nothing');

let cres = await svc.copyMessagesToAccount(term, 'work', g.messages);
ok(cres.success && cres.copied === 2, 'both copied');
const sentCopy = pages.find(p => p.flags[MOD].messageId === 'a2-sent-t-work');
const recvCopy = pages.find(p => p.flags[MOD].messageId === 'a1-t-work');
ok(!!sentCopy && !!recvCopy, 'copies get the mirror id');
ok(sentCopy.flags[MOD].folder === 'sent' && recvCopy.flags[MOD].folder === '', 'sent mail lands in Sent, received in the Inbox');
ok(tcfg.folders.custom.some(c => c.id === 'sent' && c.name === 'Sent'), 'a Sent folder was added to the mailbox');
ok(recvCopy.flags[MOD].eddies === 0, 'money is not copied');
ok(recvCopy.flags[MOD].from === 'hr@arasaka.corp' && recvCopy.flags[MOD].timestamp === '2045-03-01T00:00:00Z', 'original From + timestamp kept');
ok(recvCopy.flags[MOD].accountId === 'work', 'copy scoped to the account');
cres = await svc.copyMessagesToAccount(term, 'work', g.messages);
ok(cres.copied === 0 && cres.skipped === 2, 'a second import is a no-op');
ok(tcfg.folders.custom.filter(c => c.id === 'sent').length === 1, 'the Sent folder is not added twice');
ok(svc.gatherIdentityMail(term, 'work').copied.has(TerminalService.copyIdFor('a1', 'work')), 'the picker can tell what is already there');
// an existing folder NAMED Sent is reused
tcfg.folders.custom = [{ id: 'f9', name: 'sent', icon: 'fas fa-folder' }];
await svc.copyMessagesToAccount(term, 'reyes', [g.messages[0]]);
ok(pages.find(p => p.flags[MOD].messageId === 'a2-sent-t-reyes').flags[MOD].folder === 'f9', 'an existing "Sent" folder is reused');
game.user.isGM = false;
ok(!(await svc.copyMessagesToAccount(term, 'work', g.messages)).success, 'copy is GM-only');
game.user.isGM = true;

// outgoing mirror: the identity's sent copy lands in the Sent folder of the on account only
tcfg.folders.custom = [];
const mm = await svc.mirrorSentToAccounts({ messageId: 's9-sent', fromActorId: 'npcReyes', from: 'm.reyes@arasaka.corp', subject: 'out', status: { sent: true, read: true }, eddies: 200 });
ok(mm.mirrored === 1, 'sent mirror reaches the account with the switch on only');
const outCopy = pages.find(p => p.flags[MOD].messageId === 's9-sent-t-reyes');
ok(!!outCopy && outCopy.flags[MOD].folder === 'sent' && outCopy.flags[MOD].eddies === 0, 'sent mirror → Sent folder, no money');
ok(!pages.some(p => p.flags[MOD].messageId === 's9-sent-t-work'), 'the off account got no sent copy');
ok((await svc.mirrorSentToAccounts({ messageId: 's9-sent', fromActorId: 'npcReyes', status: { sent: true } })).mirrored === 0, 'sent mirror never doubles');
ok((await svc.mirrorSentToAccounts({ messageId: 's10-sent', fromActorId: 'stranger', status: { sent: true } })).mirrored === 0, 'unrelated sender → nothing');
ok(read('scripts/services/MessageService.js').includes('mirrorSentToAccounts?.(sentCopy)'), 'the sent-copy writer calls the outgoing mirror');

// ═══════════════ 5. Wiring guards ═══════════════
const sso = read('scripts/integrations/ShardSheetOverride.js');
ok(sso.includes("label: 'Rename…'") && sso.includes('this._nightCityEntries(item, actor)') && sso.includes('this._nightCityEntries(item, resolveOperator())'), 'Rename… in the one Night City menu, which the directory AND the sheet rows open (GM + player)');
ok(!/View Original Item/.test(sso) && /Edit Item Sheet/.test(sso), '"View Original Item" relabelled');
ok(/config\.shardName`\]: label/.test(sso) && /withShardPrefix\(label, prefix\)/.test(sso), 'rename writes display name + prefixed item name together');
ok(/isBlankFor\(item\)/.test(sso) && /blankRefusal\(\)/.test(sso), 'player convert door checks the blank rule');
const enc = read('scripts/ui/ShardEncoder/ShardEncoderApp.js');
ok(/isEligibleBlank\(this\.cfg, this\._desc\(i\)\)/.test(enc), 'Encoder blank list filtered by the rule');
ok(/const seed = seedOk/.test(enc), 'Encoder does not seed an excluded item');
ok(/Write on this item\?/.test(enc), 'Encoder asks before renaming an existing item');
ok(/withShardPrefix\(S\.label/.test(enc), 'Encoder keeps the prefix when it renames');
ok(/type: item\.type/.test(enc), 'Encoder descriptor carries the item type');
const tva = read('scripts/ui/Terminal/TerminalViewerApp.js');
ok(/isEligibleBlank\(encCfg/.test(tva), 'terminal burn picker follows the rule for players');
ok(/'blanks\.source'/.test(read('scripts/ui/ShardEncoder/EncoderConfigApp.js')), 'GM card exposes the rule');
ok(/'shardNamePrefix'/.test(read('scripts/core/SettingsManager.js')), 'prefix setting registered');
const acctHbs = read('templates/terminal/partials/config-account.hbs');
const cfgApp = read('scripts/ui/Terminal/TerminalConfigApp.js');
ok(/name="acctMirrorMail"/.test(acctHbs) && /mirrorAgentMail: chk\('acctMirrorMail'\)/.test(cfgApp) && /mirrorAgentMail: a\.mirrorAgentMail !== false/.test(cfgApp), 'mirror switch: template ↔ context ↔ save');
ok(/data-action="ctImportMail"/.test(read('templates/terminal/partials/config-content.hbs')) && /ctImportMail: TerminalConfigApp\._onCtImportMail/.test(cfgApp), 'Import from inbox wired');
ok(/linked: !!\(a\.actorId \|\| a\.masterContactId\)/.test(read('scripts/ui/Terminal/TerminalContentPanel.js')), 'import button only on linked accounts');
const detail = read('templates/message-viewer/partials/message-detail.hbs');
const viewer = read('scripts/ui/MessageViewer/MessageViewerApp.js');
ok((detail.match(/data-action="copy-to-terminal"/g) || []).length === 2 && /@root\.isGM/.test(detail), 'Copy to terminal: GM button on received + sent mail');
ok(/case 'copy-to-terminal':/.test(viewer) && /import \{ showNamePicker \}/.test(viewer), 'Copy to terminal routed');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
