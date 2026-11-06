// test-call-face — who sees a caller's name and picture (tester round 2026-11-06).
// (a) A contact saved from mail (email only, never linked to the directory, no phone) counts as knowing the caller.
// (b) A line type can show its holder's picture to people who don't have them saved (still no name).
// Drives the REAL savedContactFor / lineShown / sanitizeLineType and CallHud._other on the shared mock world.
// Run: node dev/tools/sims/test-call-face.mjs
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { createMockWorld } from './lib/world.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const M = 'night-city-messenger';
const quietInfo = console.info; console.info = () => {};

const PN = await imp('scripts/utils/phoneNumbering.js');

// ═══ 1. savedContactFor ═══
const rogue = { contactId: 'rogue', number: '+72 NC WAT-0150', name: 'Rogue', img: 'rogue.webp' };
ok(PN.savedContactFor([{ name: 'R', phone: '+72 NC WAT-0150' }], rogue)?.name === 'R', 'matched by number');
ok(PN.savedContactFor([{ name: 'R', masterContactId: 'rogue' }], rogue)?.name === 'R', 'matched by directory link');
ok(PN.savedContactFor([{ name: 'R', email: 'Rogue@Afterlife.net ' }], rogue, { email: 'rogue@afterlife.net' })?.name === 'R', 'matched by email, case and spaces ignored (saved from mail)');
ok(!PN.savedContactFor([{ name: 'R', email: 'rogue@afterlife.net' }], rogue, { email: '' }), 'no email to compare: no match');
ok(!PN.savedContactFor([{ name: 'R', email: 'rogue@afterlife.net' }], { ...rogue, asLine: true }, { email: 'rogue@afterlife.net' }), 'a business or burner line is not the person: email never matches it');
ok(PN.savedContactFor([{ name: 'V', actorId: 'v' }], { actorId: 'v', number: '1' })?.name === 'V', 'a character on their main line');
ok(!PN.savedContactFor([{ name: 'V', actorId: 'v' }], { actorId: 'v', number: '1', asLine: true }), '…not on another line of theirs');
ok(!PN.savedContactFor([{ name: 'X', email: 'x@y' }], rogue, { email: 'rogue@afterlife.net' }), 'a stranger stays a stranger');
ok(PN.savedContactFor(null, rogue) === null, 'no contact list');

// ═══ 2. the line type option ═══
ok(PN.sanitizeLineType({}).face === false && PN.sanitizeLineType({ face: 1 }).face === true, 'face sanitizes to a boolean, off by default');
ok(PN.DEFAULT_LINE_TYPES.every((t) => !t.face), 'no shipped type shows pictures to strangers');
const std = PN.lineTypes({}).find((t) => t.id === 'std');
ok(PN.lineShown({ ...std, face: true }, { name: 'Rogue', img: 'r.webp' }).face === true, 'a holder-showing type passes face on');
ok(PN.lineShown({ ...std, shows: 'number', face: true }, { name: 'Rogue', img: 'r.webp' }).face === false, 'Only the number never shows a picture, whatever is ticked');
const list = PN.lineTypes({}).map((t) => (t.id === 'std' ? { ...t, face: true } : t));
ok(PN.lineTypes(PN.lineTypesDiff(list)).find((t) => t.id === 'std').face === true, 'the option survives a save and read-back');
ok(PN.lineTypesDiff(PN.lineTypes({})).changed && !Object.keys(PN.lineTypesDiff(PN.lineTypes({})).changed).length, 'untouched types store nothing (the new field does not mark every type changed)');

// ═══ 3. the real call screen ═══
const world = await createMockWorld({
  users: [{ id: 'gm1', name: 'GM', isGM: true }, { id: 'p1', name: 'Kiri' }],
  actors: [{ id: 'v', name: 'V', type: 'character', owners: ['p1'], flags: { [M]: { contacts: [{ id: 'k1', name: 'Rogue (mail)', email: 'rogue@afterlife.net' }] } } },
    { id: 'j', name: 'Judy', type: 'character', owners: ['p1'], flags: { [M]: { contacts: [] } } }],
  realSettings: true,
});
globalThis.game.nightcity = { masterContactService: { getContact: (id) => (id === 'rogue' ? { id, name: 'Rogue', email: 'rogue@afterlife.net' } : null) } };
const { CallHud } = await imp('scripts/ui/Calls/CallHud.js');
const hud = { service: { homeCode: null }, _gmView: false, _savedFor: CallHud.prototype._savedFor };
const other = (from, toActor) => world.as('p1', () => CallHud.prototype._other.call(hud, { from, to: { actorId: toActor } }, 'callee'));
const a = await other({ ...rogue }, 'v');
ok(a.known && a.name === 'Rogue (mail)' && a.img === 'rogue.webp', 'V saved Rogue from mail: name and picture');
const b = await other({ ...rogue }, 'j');
ok(!b.known && b.name === rogue.number && b.img === '', 'Judy never saved Rogue: number, no picture');
const c = await other({ ...rogue, face: true }, 'j');
ok(!c.known && c.name === rogue.number && c.img === 'rogue.webp', 'on a picture-to-everyone line, Judy sees the picture and still no name');
const d = await other({ ...rogue, face: true, anon: true, number: '' }, 'j');
ok(d.img === '', 'a withheld call never shows the picture');

// ═══ 4. wiring ═══
const svc = read('scripts/services/CallService.js'), view = read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js'), hudSrc = read('scripts/ui/Calls/CallHud.js');
ok(/face: this\._showsFace\(number\)/.test(svc), 'the dialled side carries face too');
ok(/data-ch="typChk" data-k="face"/.test(view) && /x\.shows === 'owner' \? `<label class="ncm-pn-chk"/.test(view), 'the Line types editor has the checkbox, only for types that show the holder');
ok((hudSrc.match(/this\._savedFor\(/g) || []).length === 2 && !/normaliseNumber\(c\.phone/.test(hudSrc), 'the call screen and the voicemail note use the one matcher');

console.info = quietInfo;
console.log(`test-call-face: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
