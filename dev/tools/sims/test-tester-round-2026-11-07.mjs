// Sim: tester round 2026-11-07 (calls / payphones). Drives the REAL module code with mocked globals:
//   1. Interface on a character with no Netrunner role is still a Role Ability (Rank Only = no TECH)
//   2. a greeting that plays out loud holds the tone until it ends (the timer is only a safety cap)
//   3. a trace always answers: burner = the number only, owner = name + number, special dead end = nothing
//   4. the call log shows a caller the way the call screen did, and offers Add-to-contact / a pre-filled Save
//   5. Looks right is remembered; whisper cards to players carry no "GM only" strip
//   6. wiring: the resize-corner grab, payphone Change… / Call from it…, the GM on a booth as themselves
//   node dev/tools/sims/test-tester-round-2026-11-07.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.error('FAIL:', m)); };

const settings = { roleAbilityRoll: 'rank', dateFormat: 'YMD', dateMonthStyle: 'short', timeFormat: '24h' };
let isGM = false;
globalThis.game = {
  user: { get isGM() { return isGM; }, id: 'u1' },
  settings: { get: (_m, k) => settings[k] },
  actors: { get: () => null },
  nightcity: {},
};
globalThis.ui = { notifications: { warn() {}, info() {} } };

// ═══ 1. Role Ability rolls ═══
const { SkillService } = await imp('scripts/services/SkillService.js');
const S = Object.create(SkillService.prototype);
const actor = (items, stats = { tech: { value: 6 }, int: { value: 7 } }) => ({ name: 'A', items, system: { stats } });
const solo = actor([{ type: 'role', name: 'Solo', system: { mainRoleAbility: 'Combat Awareness', rank: 4 } }]);
const runner = actor([{ type: 'role', name: 'Netrunner', system: { mainRoleAbility: 'Interface', rank: 5 } }]);
let d = S._readSkillData(solo, 'Interface');
ok(d.statName === 'none' && d.statValue === 0 && d.skillLevel === 0, 'Rank Only: Interface on a Solo rolls rank 0 + d10, no TECH (was TECH 6)');
d = S._readSkillData(runner, 'Interface');
ok(d.statName === 'none' && d.statValue === 0 && Number(d.skillLevel) === 5, 'Rank Only: a Netrunner still rolls rank 5, no stat');
d = S._readSkillData(solo, 'interface');
ok(d.statName === 'none', 'the setting\'s lowercase "interface" is the same ability');
settings.roleAbilityRoll = 'stat';
d = S._readSkillData(solo, 'Interface');
ok(d.statName === 'tech' && d.statValue === 6, 'Stat mode keeps TECH + rank');
settings.roleAbilityRoll = 'rank';
d = S._readSkillData(actor([{ type: 'skill', name: 'Library Search', system: { level: 3, stat: 'int' } }]), 'Library Search');
ok(d.statName === 'int' && d.statValue === 7 && d.skillLevel === 3, 'an ordinary skill still adds its stat');

// ═══ 2. voicemail greetings ═══
const V = await imp('scripts/utils/voicemail.js');
ok(V.greetingPlays({ readOut: true, text: 'x' }) && V.greetingPlays({ kind: 'recorded', audio: 'a.webm' }) && !V.greetingPlays({ kind: 'typed', text: 'x' }), 'which greetings play out loud');
const long = 'This is a long read-out greeting that takes the browser voice well over six seconds to get through. '.repeat(3);
ok(V.greetMs(long) === 6500, 'the old estimate capped a long greeting at 6.5 s (the cut-off)');
ok(V.greetTimerMs({ readOut: true, text: long }) === V.GREETING_PLAY_CAP_MS && V.GREETING_PLAY_CAP_MS >= 45000, 'a read-out greeting waits for the voice (safety cap only)');
ok(V.greetTimerMs({ kind: 'typed', text: 'Hi.' }) === V.greetMs('Hi.'), 'a typed greeting keeps the on-screen estimate');
const hud = read('scripts/ui/Calls/CallHud.js'), cs = read('scripts/services/CallService.js');
ok(/speak\(g\.text[^)]*\)\.then\(done/.test(hud) && /greetingDone\?\.\(cid\)/.test(hud) && /addEventListener\('ended'/.test(hud), 'the call screen reports the end of a spoken or recorded greeting');
ok(/greetingDone\(callId\) \{ this\._vmTone\(callId\); \}/.test(cs) && /greetTimerMs\(vm\.greeting\)/.test(cs), 'the service tones on greetingDone; its timer is greetTimerMs');
ok(/resolve\(true\)/.test(read('scripts/ui/Calls/speech.js')) && /return false;/.test(read('scripts/ui/Calls/speech.js')), 'speak() says whether it spoke');

// ═══ 3. the trace ═══
const PN = await imp('scripts/utils/phoneNumbering.js');
const types = PN.lineTypes({});
const t = (id) => types.find((x) => x.id === id);
ok(PN.traceFinds(t('burner'), { name: 'Rogue' }).numberOnly && PN.traceFinds(t('burner'), { name: 'Rogue' }).name === '', 'a burner: the number, never the name');
ok(PN.traceFinds(t('std'), { name: 'Rogue' }).owner && PN.traceFinds(t('std'), { name: 'Rogue' }).name === 'Rogue', 'a regular line: the holder');
const { CallService } = await imp('scripts/services/CallService.js');
const ctx = PN.defaultNumberContext();
const row = ctx.rows.find((r) => r.Code === 'WAT');
const burnerNo = PN.numberAt(row, '0612'), stdNo = PN.numberAt(row, '0111');
const fake = { numberContext: ctx, lineTypes: types, _get: (k, dflt) => (k === 'phoneSpecial' ? [{ id: 'x', num: '#DEAD', name: 'Dead', trace: 'dead' }] : dflt),
  lines: () => ({ [PN.normaliseNumber(burnerNo, ctx)]: { number: burnerNo, kind: 'burner', owner: { name: 'Rogue' } }, [PN.normaliseNumber(stdNo, ctx)]: { number: stdNo, kind: 'main', owner: { name: 'Rogue' } } }) };
const tr = (from) => CallService.prototype._traceResult.call(fake, from);
let r = tr({ number: burnerNo, name: 'Rogue', actorId: 'rogue', realName: 'Rogue' });
ok(r && r.number === burnerNo && r.name === '' && r.showOnly === 'number' && !r.actorId, 'trace on a burner: number only, no actor');
r = tr({ number: stdNo, name: 'Rogue', contactId: 'rogue', img: 'r.webp', realName: 'Rogue Amendiares' });
ok(r && r.number === stdNo && r.name === 'Rogue Amendiares' && r.showOnly === 'name' && !('realName' in r), 'trace on a regular line: name + number, no hidden fields');
ok(tr({ name: 'Unknown caller', anon: true }) === null, 'only a mask left: a dead end');
ok(tr({ number: '#DEAD', special: true, name: 'Dead' }) === null, 'a special number set to a dead end stays one');
ok(/_traceCard\(userId, found\)/.test(cs) && /dead: !found/.test(cs), 'every trace answers: a reveal packet (dead or not) and a whispered chat card');
ok(/from: call\.traced && call\.tracedFrom \? \{ \.\.\.call\.tracedFrom \} : maskCaller\(call\.from\)/.test(cs) && !/if \(!call\.from\?\.anon \|\| call\.traced\)/.test(cs), 'after a trace, later packets carry only what the trace found');
ok(/const shownCaller = /.test(cs) && /\[CALL\] \$\{direction === 'out' \? 'to' : 'from'\} \$\{\(direction === 'in' && hide \? shownCaller\(other\) : other\)/.test(cs), 'the callee\'s log page (and its title) shows only what the trace found');
ok(!/permanent: true/.test(hud.slice(hud.indexOf('CALL_TRACED'), hud.indexOf('CALL_TRACED') + 600)), 'the trace toast is no longer permanent (a queued permanent toast read as "minutes later")');

// ═══ 4. the call log ═══
game.nightcity.callService = { get homeCode() { return ctx; }, get numberContext() { return ctx; } };
const T = await imp('scripts/ui/MessageViewer/callsTab.js');
const contacts = [{ id: 'k1', name: 'Rogue', masterContactId: 'rogue', phone: '' }, { id: 'k2', name: 'Judy', phone: PN.numberAt(row, '0142') }];
const book = [{ name: 'Judy', number: contacts[1].phone, normal: PN.normaliseNumber(contacts[1].phone, ctx), img: '' }];
let o = T.shownOther({ other: { number: stdNo, name: 'Rogue', contactId: 'rogue' } }, book, ctx, contacts);
ok(o.name === 'Rogue' && o.known && !o.saved && o.addTo === 'k1' && o.replaces === '', 'a call from a contact with no number on file: their name, and Add this number');
o = T.shownOther({ other: { number: contacts[1].phone, name: 'Judy' } }, book, ctx, contacts);
ok(o.saved && o.name === 'Judy', 'a saved number: the contact, nothing to offer');
o = T.shownOther({ other: { number: stdNo, name: 'Fixer Dex', showOnly: 'name', img: 'dex.webp' } }, book, ctx, []);
ok(o.name === 'Fixer Dex' && o.offerName === 'Fixer Dex' && o.offerImg === 'dex.webp' && !o.saved, 'a line that shows its name: the log shows it, and Save comes pre-filled');
o = T.shownOther({ other: { number: stdNo, name: 'Secret NPC' } }, book, ctx, []);
ok(o.name !== 'Secret NPC' && !o.offerName && !o.known, 'a stranger whose screen showed only a number: the log shows only the number');
o = T.shownOther({ other: { name: 'Unknown caller', anon: true, contactId: null } }, book, ctx, contacts);
ok(!o.addTo && !o.offerName, 'a withheld caller is never matched to a contact');
const tpl = read('templates/message-viewer/partials/calls-tab.hbs');
ok(/data-action="calls-addnum"/.test(tpl) && /data-name="\{\{other\.offerName\}\}" data-img="\{\{other\.offerImg\}\}"/.test(tpl) && /\{\{#unless other\.saved\}\}/.test(tpl), 'the row offers Add-to-contact or a pre-filled Save');
const ctab = read('scripts/ui/MessageViewer/callsTab.js');
ok(/case 'calls-addnum':/.test(ctab) && /updateContact\?\.\(own\.actorId, cid, \{ phone: num \}\)/.test(ctab) && /portrait: img/.test(ctab), 'Add writes the number onto the contact; Save keeps the picture');
ok(/\.\.\.\(p\?\.showOnly \? \{ showOnly: p\.showOnly \} : \{\}\)/.test(cs), 'the log record keeps what the call screen showed');

// ═══ 5. Looks right + whisper cards ═══
const pnv = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
ok(/saveSetting\('phoneFlagsOk'/.test(pnv) && /SVC\._get\('phoneFlagsOk'/.test(pnv), 'Looks right is saved and read back on every load');
ok(/'phoneFlagsOk'/.test(read('scripts/core/SettingsManager.js')) && /NUMBER_SETTINGS = Object\.freeze\(\[[^\]]*'phoneFlagsOk'/.test(cs), 'the setting is registered and writable through saveNumberSetting');
const { whisperCardHtml } = await imp('scripts/utils/helpers.js');
ok(/GM only/.test(whisperCardHtml({ lines: ['x'] })) && !/ncm-cc__whisper/.test(whisperCardHtml({ lines: ['x'], strip: '' })), 'whisper cards: GM only by default, no strip for a player');

// ═══ 6. wiring ═══
const base = read('scripts/ui/BaseApplication.js');
ok(/_grabResizeHandle\(\)/.test(base) && /h\.setPointerCapture\(e\.pointerId\)/.test(base) && /'lostpointercapture'/.test(base), 'every NCM window grabs the pointer on the resize corner\'s pointerdown');
const ppv = read('scripts/ui/AdminPanel/tabs/payphonesView.js');
ok(/data-pph="setNumber"/.test(ppv) && /case 'setNumber':/.test(ppv) && /async function askBoothNumber/.test(ppv), 'payphone number: Change… picks district + digits');
ok(/rowOf\(parseNumber\(draft\.number/.test(ppv), 'Another stays in the booth\'s own district');
ok(/data-pph="callOut"/.test(ppv) && /case 'callOut':/.test(ppv) && /placeCall\(number, \{ payphone: pp\.id, gm: true \}\)/.test(ppv), 'the GM can call out from a booth, to anyone or a typed number');
ok(/as\.gm && isGM\(\) \? null : resolveOperator\(\)/.test(cs), 'the GM on a booth is themselves, not their operator character');

console.log(`test-tester-round-2026-11-07: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
