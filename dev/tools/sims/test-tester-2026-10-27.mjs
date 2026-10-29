// Sim: tester round 2026-10-27 (Aegaeon). Four reports, four fixes:
//   1. Admin → Contacts "Send As" on an NPC with a new main identity still sent
//      from the OLD address (the button passed only the actor id; the actor's
//      registered email flag was never moved with the main identity).
//   2. Network / terminal-account bypass skills shared ONE DV.
//   3. Admin → Security → Operator Access: picking a role did nothing, and the
//      gate held one skill only.
//   4. A world setting to roll role abilities (Interface) as rank + d10.
// Drives the REAL modules (bypassSkills.js, helpers.canOperate/gateSkillsOf,
// MasterContactService._syncActorEmail, MessageService._senderEmailFor,
// SkillService._readSkillData) over mocked globals, plus wiring guards.
// Run: node dev/tools/sims/test-tester-2026-10-27.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

const settings = {};
const flags = {};
const mkActor = (id, name, { pc = false, email = '', items = [], stats = {} } = {}) => {
  flags[id] = { email };
  return {
    id, name, hasPlayerOwner: pc, items, system: { stats },
    getFlag: (_m, k) => flags[id][k],
    setFlag: async (_m, k, v) => { flags[id][k] = v; },
  };
};
const actors = {
  exec: mkActor('exec', 'Exec', { email: 'exec@oldcorp.nc' }),
  pc: mkActor('pc', 'V', { pc: true, email: 'v@nightcity.net' }),
};
globalThis.game = {
  user: { isGM: true }, users: { activeGM: {} },
  settings: { get: (_m, k) => settings[k] },
  nightcity: {}, actors: { get: (id) => actors[id] || null }, journal: { contents: [] },
};
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => 'rid' } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

// ═══ 1. Send As — the identity survives and the registered address follows the main ═══
{
  const src = read('scripts/ui/AdminPanel/tabs/ContactsTab.js');
  // Admin → Contacts' one Send-As path (the Send-as strip, the detail button, the
  // legacy onSendAsContact delegator all call _sendAs). The GM Contact Manager
  // window that had its own copy was folded into this tab on 2026-10-27.
  const fn = src.slice(src.indexOf('  _sendAs(id) {'), src.indexOf('  _composeTo('));
  ok(fn.includes('fromContactId: contact.id') && !fn.includes('fromActorId: contact.actorId'), 'Admin Send As passes the contact, not just its character');
  ok(/onSendAsContact\(event, target\) \{ return this\._sendAs\(/.test(src), 'the legacy Send-As delegator uses the same path');
  ok(read('scripts/init/registerMessagingSystem.js').includes('options.fromContactId'), 'the compose launcher forwards fromContactId');
  // Every Send-As door (Admin Contacts, Messages → Send as NPC)
  // must hand over the contact; a bare actor id drops which identity was meant.
  for (const f of ['scripts/ui/AdminPanel/tabs/ContactsTab.js', 'scripts/ui/AdminPanel/tabs/MessagesTab.js']) {
    ok(!read(f).includes('fromActorId: contact.actorId'), `${f.split('/').pop()}: no Send-As by bare actor id`);
  }
  {
    const mt = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
    const q = mt.slice(mt.indexOf('onNpcQuickSend('), mt.indexOf('onNpcQuickSend(') + 900);
    ok(q.indexOf('fromContactId: rowContact.id') < q.indexOf('game.actors?.get(npcId)'), 'Send as NPC: a row naming a contact sends as that contact before the actor fallback');
  }

  // Portraits: every sender avatar shows the picked identity's own face; an
  // alias never falls back to its character's image.
  {
    const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
    ok(!comp.includes('fromImg: fromActor?.img ||') && comp.includes('resolveDisplayPortrait({ contactId: this.fromContact.id'), 'composer From avatar resolves the picked identity');
    ok(!comp.includes('portrait: senderActor?.img') && comp.includes('portrait: resolveDisplayPortrait(origIds)'), 'composer quote card uses the identity the mail came from');
    ok(comp.includes('c.contactId === this.fromContact.id'), 'Send-as list lights only the picked identity');
    const vw = read('scripts/ui/MessageViewer/MessageViewerApp.js');
    ok(vw.includes('(senderIsAlias ? null : fromActor?.img)'), 'Agent viewer: an alias sender never falls back to the actor image');
    const tv = read('scripts/ui/Terminal/TerminalViewerApp.js');
    ok(tv.includes('_senderPortrait(msg) {') && (tv.match(/this\._senderPortrait\(msg\)/g) || []).length >= 2, 'terminal viewer: sender + add-contact portrait read the named identity');
    const mt = read('scripts/ui/AdminPanel/tabs/MessagesTab.js');
    ok(mt.includes('portrait: resolveDisplayPortrait({ contactId: c.id })') && mt.includes('if (seenIds.has(c.id)) continue;'), 'Send as NPC: one chip per identity, each with its own portrait');
  }

  const { MasterContactService } = await imp('scripts/services/MasterContactService.js');
  const mcs = Object.create(MasterContactService.prototype);
  mcs._contacts = [
    { id: 'old', name: 'Exec', email: 'exec@oldcorp.nc', actorId: 'exec' },
    { id: 'new', name: 'Exec', email: 'exec@newcorp.nc', actorId: 'exec' },
    { id: 'vc', name: 'V', email: 'v.alt@nightcity.net', actorId: 'pc', primaryIdentity: true },
  ];
  mcs._persistContacts = async () => {};
  game.nightcity.masterContactService = mcs;
  game.nightcity.emailService = { forceSetEmail: async (a, e) => { flags[a.id].email = e; } };

  ok((await mcs.setPrimaryIdentity('new')).success, 'star the new identity');
  ok(flags.exec.email === 'exec@newcorp.nc', 'starring the main moves the NPC registered address');
  await mcs.updateContact('new', { email: 'exec@third.nc' });
  ok(flags.exec.email === 'exec@third.nc', 'editing the main identity address moves it too');
  await mcs.updateContact('old', { email: 'exec@ancient.nc' });
  ok(flags.exec.email === 'exec@third.nc', 'editing an ALIAS address leaves the registered one alone');
  await mcs._syncActorEmail('pc');
  ok(flags.pc.email === 'v@nightcity.net', "a player character's address is never rewritten");

  // read side: a starred main beats a stale flag — NPCs only
  const { MessageService } = await imp('scripts/services/MessageService.js');
  const ms = Object.create(MessageService.prototype);
  Object.defineProperty(ms, '_contactRepo', { value: { getActorEmail: (id) => flags[id]?.email || '' } });
  flags.exec.email = 'exec@oldcorp.nc';   // a world whose flag went stale before this fix
  ok(MessageService.prototype._senderEmailFor.call(ms, { fromActorId: 'exec' }, actors.exec) === 'exec@third.nc', 'NPC: starred main beats a stale registered flag');
  ok(MessageService.prototype._senderEmailFor.call(ms, { fromActorId: 'exec', fromContactId: 'old' }, actors.exec) === 'exec@ancient.nc', 'an explicitly picked alias still wins');
  ok(MessageService.prototype._senderEmailFor.call(ms, { fromActorId: 'pc' }, actors.pc) === 'v@nightcity.net', 'PC: the registered address still wins');
  const comp = read('scripts/ui/MessageComposer/MessageComposerApp.js');
  ok(/starred\?\.primaryIdentity && starred\.email && !game\.actors\?\.get\(this\.fromActorId\)\?\.hasPlayerOwner/.test(comp), 'composer header follows the same NPC-only rule');
}

// ═══ 2. Bypass skills with their own DV ═══
{
  const B = await imp('scripts/utils/bypassSkills.js');
  const legacy = { bypassSkills: ['Interface', 'Electronics/Security Tech'], bypassDC: 15 };
  ok(B.bypassDCFor(legacy, 'Interface') === 15 && B.bypassDCFor(legacy, 'Electronics/Security Tech') === 15, 'legacy block: every skill uses bypassDC');
  const per = { ...legacy, bypassSkillDCs: { Interface: 13, 'Electronics/Security Tech': 17 } };
  ok(B.bypassDCFor(per, 'Interface') === 13 && B.bypassDCFor(per, 'Electronics/Security Tech') === 17, 'per-skill DVs');
  ok(B.bypassDCFor(per, 'electronics/securitytech') === 17, 'names compare space/punctuation-insensitive');
  ok(B.bypassDCFor(per, 'Cryptography') === 15, 'an unlisted skill falls back to bypassDC');
  ok(B.bypassDCFor({ bypassSkillDCs: { Interface: 0 } }, 'Interface') === 0, 'DV 0 is a real DV, not a fallback');
  ok(B.bypassDCFor(null, 'Interface') === 15, 'no block → 15');
  const f = B.bypassFieldsFrom([{ name: 'Interface', dv: '13' }, { name: 'Electronics/Security Tech', dv: 17 }, { name: 'interface', dv: 9 }, { name: '', dv: 4 }]);
  ok(f.bypassSkills.join('|') === 'Interface|Electronics/Security Tech', 'rows → skills, duplicates and blanks dropped');
  ok(f.bypassDC === 13 && f.bypassSkillDCs.Interface === 13 && f.bypassSkillDCs['Electronics/Security Tech'] === 17, 'bypassDC = the first row, map carries each');
  ok(B.bypassFieldsFrom([]).bypassSkills.length === 0 && B.bypassFieldsFrom([]).bypassDC === 15, 'no rows → no skills, default DV');
  ok(B.bypassRowsOf(per).map((r) => `${r.name}:${r.dv}`).join() === 'Interface:13,Electronics/Security Tech:17', 'rows of a block');
  ok(B.bypassRowsHtml(per).split('data-bypass-row>').length - 1 === 2, 'editor renders one row per skill');
  ok(B.bypassRowsHtml(null).split('data-bypass-row>').length - 1 === 1, 'a new block starts with one row');
  ok(!/\bname="/.test(B.bypassRowsHtml(per)), 'editor inputs are unnamed (read back by readBypassRows)');

  // every DV read routes through the helper
  const reads = {
    'scripts/services/NetworkService.js': 'bypassDCFor(network.security, skillName)',
    'scripts/services/MessageAccessService.js': 'bypassDCFor(accessControl.bypass, skillName)',
    'scripts/ui/NetworkManagement/SecurityAuthAdapters.js': 'bypassDCFor(sec, skillName)',
    'scripts/ui/NetworkManagement/NetworkAuthDialog.js': 'bypassDCFor(this.network.security, skillName)',
    'scripts/ui/Terminal/TerminalViewerApp.js': 'bypassDCFor(account.security, skill)',
  };
  for (const [file, needle] of Object.entries(reads)) ok(read(file).includes(needle), `${file.split('/').pop()} reads the per-skill DV`);
  ok(!/security\??\.bypassDC \?\? 15;/.test(read('scripts/ui/Terminal/TerminalViewerApp.js')), 'terminal viewer has no single-DV read left');
  ok(!/name="bypassSkills"/.test(read('templates/admin-panel/tab-networks.hbs')), 'Networks editor: the comma box is gone');
  ok(read('templates/admin-panel/tab-networks.hbs').includes('{{{bypassHtml}}}') && read('scripts/ui/AdminPanel/tabs/NetworksTab.js').includes('bypassRowsHtml(d.security'), 'Networks editor (the folded-in Network Manager) renders the row editor');
  ok(read('templates/terminal/partials/config-account.hbs').includes('{{{bypassRowsHtml}}}') && !read('templates/terminal/partials/config-account.hbs').includes('name="secDV"'), 'terminal account editor renders the row editor');
  ok(read('scripts/services/NetworkService.js').includes('bypassSkillDCs: data.security?.bypassSkillDCs'), 'createNetwork keeps the map');
  ok(read('styles/night-city-messenger.css').includes("@import 'components/bypass-skills.css'"), 'row editor stylesheet imported');
}

// ═══ 3. Operator Access — role picker + several skills ═══
{
  const sec = read('scripts/ui/AdminPanel/tabs/SecurityTab.js');
  const roleFn = sec.slice(sec.indexOf('onGateAddRole('), sec.indexOf('// ─── log actions'));
  ok(!roleFn.includes(".closest('.ncm-sec-admin-gate__grp')"), 'role picker no longer searches the gear groups');
  ok(roleFn.includes(".closest('.ncm-sec-admin-gate__req')"), 'role picker finds its own block');
  const tpl = read('templates/admin-panel/tab-security.hbs');
  const roleBlock = tpl.slice(tpl.indexOf('securityGateAddRole'), tpl.indexOf('data-role-chips') + 20);
  ok(!tpl.slice(tpl.lastIndexOf('ncm-sec-admin-gate__req', tpl.indexOf('securityGateAddRole')), tpl.indexOf('securityGateAddRole')).includes('gate__grp'), 'role button sits in a __req block, not a gear group');
  ok(roleBlock.length > 0 && sec.includes("chips.querySelector('.ncm-sec-admin-gate__none')?.remove()"), 'the "no role required" placeholder clears when a chip lands');
  ok(tpl.includes('data-gate-skills') && tpl.includes('securityGateAddSkill') && !tpl.includes('name="gateSkill"'), 'skill block is a list with an add button');
  const panel = read('scripts/ui/AdminPanel/AdminPanelApp.js');
  ok(panel.includes('securityGateAddSkill: AdminPanelApp._onSecurityGateAddSkill') && panel.includes('securityGateRemoveSkill: AdminPanelApp._onSecurityGateRemoveSkill'), 'skill row actions registered');
  ok(sec.includes('skills: Array.from(el.querySelectorAll(\'[data-gate-skill-row]\'))'), 'save walks the skill rows');

  const H = await imp('scripts/utils/helpers.js');
  ok(H.gateSkillsOf({ skill: { name: 'Interface', min: 4 } }).length === 1, 'legacy single skill reads as a list of one');
  ok(H.gateSkillsOf({ skills: [{ name: 'Interface', min: 4 }], skill: { name: 'Science', min: 9 } }).map((s) => s.name).join() === 'Interface', 'the list wins over a legacy skill');
  ok(H.gateSkillsOf({}).length === 0, 'no skill rule');

  const levels = { Interface: 3, 'Electronics/Security Tech': 7 };
  game.nightcity.skillService = { getSkillData: (_a, n) => ({ skillLevel: levels[n] ?? 0 }) };
  const runner = { id: 'r', items: [] };
  const gate = { mode: 'gated', skills: [{ name: 'Interface', min: 4 }, { name: 'Electronics/Security Tech', min: 6 }] };
  game.user.isGM = false;
  ok(H.canOperate(runner, gate, { standalone: true }).ok, 'qualifies on the second skill');
  levels['Electronics/Security Tech'] = 5;
  const no = H.canOperate(runner, gate, { standalone: true });
  ok(!no.ok && /Interface 4\+ or Electronics\/Security Tech 6\+/.test(no.reason), 'neither skill high enough → names both');
  ok(H.canOperate(runner, { mode: 'gated', skill: { name: 'Interface', min: 3 } }, { standalone: true }).ok, 'a legacy single-skill gate still works');
  game.user.isGM = true;

  const enc = read('scripts/ui/ShardEncoder/EncoderConfigApp.js');
  ok(enc.includes("case 'gateSkillAdd'") && enc.includes('gate.skills.${i}.name') && !enc.includes("'gate.skill.name'"), 'Player Authoring card edits a skill list');
}

// ═══ 4. Role ability roll mode ═══
{
  const { SkillService } = await imp('scripts/services/SkillService.js');
  const ss = Object.create(SkillService.prototype);
  const runner = {
    name: 'Runner', system: { stats: { tech: { value: 6 } } },
    items: [{ type: 'role', name: 'Netrunner', system: { mainRoleAbility: 'Interface', rank: 4 } }],
  };
  const stat = SkillService.prototype._readSkillData.call(ss, runner, 'Interface');
  ok(stat.skillLevel > 0, `Interface rank resolves from the role (rank ${stat.skillLevel})`);
  ok(stat.statValue === 6, 'default: TECH is added');
  settings.roleAbilityRoll = 'rank';
  const rank = SkillService.prototype._readSkillData.call(ss, runner, 'Interface');
  ok(rank.statValue === 0 && rank.skillLevel === stat.skillLevel, 'rank mode: rank only, no stat');
  const normal = SkillService.prototype._readSkillData.call(ss, { ...runner, items: [{ type: 'skill', name: 'Electronics/Security Tech', system: { level: 5, stat: 'tech' } }] }, 'Electronics/Security Tech');
  ok(normal.statValue === 6, 'rank mode leaves ordinary skills alone');
  delete settings.roleAbilityRoll;
  const sm = read('scripts/core/SettingsManager.js');
  const reg = sm.slice(sm.indexOf("'roleAbilityRoll'"), sm.indexOf("'roleAbilityRoll'") + 900);
  ok(/config: true/.test(reg) && /default: 'stat'/.test(reg) && /name: 'Role Ability/.test(reg), 'setting registered, literal name, default unchanged');
}

console.log(`test-tester-2026-10-27: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
