// Editable words and looks on Lawman Backup and Trauma Team: the rules, and the call screen reading them.
import fs from 'node:fs';
import * as E from '../../../scripts/utils/phoneEmergency.js';

const root = new URL('../../../', import.meta.url);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');

// sanitizing
const cfg = E.sanitizeEmergency({
  trauma: { voice: { speaker: ['  Nurse Ito  ', ''], nonsense: ['x'], confirm: 'one\ntwo' } },
  backup: {
    orgs: { a: { name: 'A', kind: 'Police', rows: [{ r1: 3, r2: 4, name: 'Patrol' }, { r1: 5, r2: 7, name: 'Detectives' }], voice: { answer: ['Org answer'], ask: ['Org ask'] }, look: { color: '#112233', lights: false, openSound: 'em-dispatch' } } },
    chars: { p: 'a' },
    people: { p: { voice: { ask: ['Person ask', 'Person ask 2'], channel: ['UNIT-7'] }, look: { color: 'red', lights: true }, img: 'me.webp', groups: [{ r1: 3, r2: 4, name: 'Partner' }, { r1: 0, r2: 99, name: 'Clamped' }] } },
  },
});
ok(cfg.trauma.voice.speaker.length === 1 && cfg.trauma.voice.speaker[0] === 'Nurse Ito', 'lines are trimmed, blanks dropped');
ok(!('nonsense' in cfg.trauma.voice), 'an unknown slot is dropped');
ok(cfg.trauma.voice.confirm.length === 2, 'a string splits into lines');
ok(cfg.backup.orgs.a.look.color === '#112233' && cfg.backup.orgs.a.look.lights === false, 'an organization keeps its look');
ok(!('color' in cfg.backup.people.p.look), 'a colour that is not #rrggbb is dropped: the tracker appends alpha to it');
ok(cfg.backup.people.p.groups[1].r1 === 1 && cfg.backup.people.p.groups[1].r2 === 10, 'a person\'s group ranks are clamped');
const empty = E.sanitizeEmergency({});
ok(empty.backup.people && !Object.keys(empty.backup.people).length && !Object.keys(empty.trauma.voice).length, 'an older world needs no migration');
const again = E.sanitizeEmergency(JSON.parse(JSON.stringify(cfg)));
ok(JSON.stringify(again) === JSON.stringify(cfg), 'sanitizing twice changes nothing, so a save cannot lose the words');
ok(Object.keys(E.sanitizeEmergency({ backup: { orgs: E.DEFAULT_ORGS } }).backup.orgs.ncpd.voice).length === 0, 'the shipped organizations say the built-in words');

// the three layers
const layers = E.backupLayers(cfg, 'a', 'p');
const src = E.voiceSources(E.BACKUP_SLOTS, layers);
ok(src.ask.from === 'This person' && src.ask.lines.length === 2, 'the person beats the organization');
ok(src.answer.from === 'A' && src.answer.lines[0] === 'Org answer', 'the organization beats the built-in line');
ok(src.busy.from === 'Built in' && src.busy.lines[0] === 'Nobody free right now. Hold on.', 'and the built-in line is the last word');
ok(E.voiceSources(E.BACKUP_SLOTS, E.backupLayers(cfg, 'a', 'nobody')).ask.from === 'A', 'someone with no overrides inherits');

// picked once
const v0 = E.pickVoice(E.BACKUP_SLOTS, layers, () => 0), v9 = E.pickVoice(E.BACKUP_SLOTS, layers, () => 0.999);
ok(v0.ask === 'Person ask' && v9.ask === 'Person ask 2', 'several lines: one is picked');
ok(E.pickVoice(E.BACKUP_SLOTS, layers, () => 1).ask === 'Person ask 2', 'a random of exactly 1 still lands on a line');
ok(v0.channel === 'UNIT-7' && E.pickVoice(E.BACKUP_SLOTS, [], () => 0).channel === '', 'a blank channel stays blank so the call numbers it');

// fill-ins
ok(E.fillLine('At {place}, {name}', { place: 'Docks', name: 'V' }) === 'At Docks, V', 'fill-ins go in');
ok(E.fillLine('{rounds} out', { rounds: 1 }) === '1 round out' && E.fillLine('{rounds} out', { rounds: 3 }) === '3 rounds out', 'rounds reads as words, singular too');
ok(E.fillLine('{plce}', { place: 'Docks' }) === '{plce}', 'a typo shows as typed');
ok(E.fillLine('$& {org}', { org: '$1' }) === '$& $1', 'a dollar sign is only a dollar sign');
for (const s of [...E.BACKUP_SLOTS, ...E.TRAUMA_SLOTS]) for (const t of (s.def.match(/\{(\w+)\}/g) || [])) ok([...E.LINE_TOKENS.backup, ...E.LINE_TOKENS.trauma].includes(t.slice(1, -1)), `${s.key}: ${t} is an offered fill-in`);
for (const s of E.BACKUP_SLOTS) for (const t of (s.def.match(/\{(\w+)\}/g) || [])) ok(E.LINE_TOKENS.backup.includes(t.slice(1, -1)), `backup ${s.key}: ${t}`);
for (const s of E.TRAUMA_SLOTS) for (const t of (s.def.match(/\{(\w+)\}/g) || [])) ok(E.LINE_TOKENS.trauma.includes(t.slice(1, -1)), `trauma ${s.key}: ${t}`);

// their own people
const merged = E.orgForPerson(cfg, 'a', 'p');
ok(merged.rows.length === 4 && merged.rows[0].own && !cfg.backup.orgs.a.rows[0].own, 'a person\'s groups are added without touching the organization');
ok(E.orgForPerson(cfg, 'a', 'nobody') === cfg.backup.orgs.a, 'no groups of their own, the same organization');
ok(E.backupDefault(E.orgForPerson(E.sanitizeEmergency({ backup: { orgs: { a: { name: 'A', kind: 'Police', rows: [{ r1: 3, r2: 4, name: 'Patrol' }] } }, people: { p: { groups: [{ r1: 3, r2: 4, name: 'Partner' }] } } } }), 'a', 'p'), 4).name === 'Partner', 'at the same rank they reach for their own');
ok(E.backupOptions(merged, 2).every((r) => r.r1 <= 2), 'and the rank rule still applies');

// the look
ok(E.backupLook('Police').lights && E.backupLook('Police').arriveSound === 'em-arrive-backup' && !E.backupLook('Corporate').lights, 'the kind still decides by default');
ok(E.backupLook('Police', { lights: false }).lights === false && E.backupLook('Police', { lights: false }).arriveSound !== 'em-arrive-backup', 'an organization can switch the lights and siren off');
ok(E.backupLook('Corporate', { lights: false }, { lights: true }).lights === true, 'a person beats their organization');
ok(E.backupLook('Police', { color: '#112233' }, {}).color === '#112233' && E.backupLook('Police', { color: '#112233' }, { color: '#445566' }).color === '#445566', 'colour layers the same way');
ok(E.backupLook('Police', { openSound: 'x' }).openSound === 'x' && E.backupLook('Police').openSound === 'em-sting-backup', 'and the opening sound');
ok(E.backupArt({ logo: 'o' }, { logo: 'g' }, { img: 'p' }) === 'g' && E.backupArt({ logo: 'o' }, { logo: '' }, { img: 'p' }) === 'p' && E.backupArt({ logo: 'o' }, null, { img: '' }) === 'o', 'picture: group, person, organization');

// the editor's helpers
const held = E.sanitizeEmergency({ backup: { orgs: { a: { name: 'A', kind: 'Police', rows: [] } } } });
ok(E.voiceHolder(held, 't') === held.trauma && E.voiceHolder(held, 'o:a') === held.backup.orgs.a, 'a scope finds what holds its words');
ok(E.voiceHolder(held, 'o:gone') === null && E.voiceHolder(held, 'x') === null && E.voiceHolder(held, 'p:') === null, 'and a bad scope finds nothing');
const made = E.voiceHolder(held, 'p:new');
ok(made && held.backup.people.new === made && Array.isArray(made.groups) && made.voice && made.look, 'a person is made on first use');
ok(E.personChanges(cfg.backup.people.p) === 6 && E.personChanges(made) === 0 && E.personChanges(undefined) === 0, 'changes on a person are counted');
ok(E.badTokens(['At {plce}, {place}'], 'backup').join() === '{plce}' && !E.badTokens(['{line}'], 'trauma').length && E.badTokens(['{line}'], 'backup').length === 1, 'an unknown fill-in is found, per kind of call');
ok(E.EMERGENCY_SOUNDS.every((id) => /^em-/.test(id)), 'the sound list holds emergency sounds');

// wiring
const View = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js'), Cat = read('scripts/utils/soundCatalog.js');
for (const id of E.EMERGENCY_SOUNDS) ok(Cat.includes(`'${id}':`), `${id} has a name on the Sound Board`);
ok(/if \(emPending\.size && el\.dataset\.do !== 'emTok'\) await emFlush\(\)/.test(View), 'any button saves what is still waiting first, so Play plays what was typed');
ok(/addEventListener\('scroll', remember, \{ capture: true/.test(View), 'a save while typing cannot jump the scroll back');
ok((View.match(/data-in="emLine" data-scope=/g) || []).length === 1 && /emSlots\(\{ slots: TRAUMA_SLOTS, scope: 't'/.test(View) && /scope: 'o:' \+ S\.bkOrg/.test(View) && /scope = 'p:' \+ p\.id/.test(View), 'one editor for all three');
ok(!/new Dialog\(/.test(View.slice(View.indexOf('const emPending'), View.indexOf('/** Both emergency screens'))), 'the editor opens no raw dialog');
const Phone = read('styles/components/admin-panel/tab-phone.css');
ok(/@container \(max-width: 520px\)/.test(Phone) && /\.ncm-emv \{ container-type: inline-size/.test(Phone), 'the editor stacks in a narrow column');
const block = Phone.slice(Phone.indexOf('/* The words and look of an emergency call'));
ok(!/#[0-9a-f]{3,6}\b/i.test(block.replace(/var\([^)]*\)/g, '')), 'its colours are tokens');
ok(/arrivalFor\(e\)/.test(Svc0()) && /const show = this\.arrivalFor\(e\)/.test(Svc0()), 'the preview and the real arrival build the banner the same way');
function Svc0() { return read('scripts/services/EmergencyService.js'); }

const Hud = read('scripts/ui/Calls/EmergencyHud.js'), Svc = read('scripts/services/EmergencyService.js');
// the tracker's status words (trackWords) are a readout, not a line, so only the part below them is checked
const callCode = Hud.slice(Hud.indexOf('export class EmergencyHud'));
for (const s of [...E.BACKUP_SLOTS, ...E.TRAUMA_SLOTS]) if (s.def && !s.def.startsWith('{')) ok(!callCode.includes(s.def.replace(/\{\w+\}.*/, '')) || s.def.length < 6, `the call screen does not hardcode "${s.def}"`);
ok(/say\('team'\)/.test(Hud) && /say\('speaker'\)/.test(Hud) && /say\('caller'\)/.test(Hud), 'the call screen reads the slots');
ok(/res\.who, rounds: res\.rounds/.test(Hud), 'the arrived group and rounds reach the line');
ok(/orgForPerson\(this\.config, info\.orgId, info\.actorId\)/.test(Svc), 'the next-group-up roll sees a person\'s groups');
ok(/voice: undefined, look: undefined/.test(Svc), 'an active emergency row does not store the whole voice');
ok(/arriveTitle: e\.arriveTitle/.test(Svc) && /color: e\.color/.test(Svc), 'the arrival carries its words and colour to every screen');
ok(/replace\('● LIVE', \(\) =>/.test(Hud), 'a $ in a callsign cannot break the frame word');

console.log(`test-emergency-lines: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
