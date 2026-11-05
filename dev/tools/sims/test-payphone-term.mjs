// Sim: what players call a payphone — the `payphoneTerm` world setting (dev, 2026-11-05: "similar to memory chip").
// Drives the REAL scripts/utils/payphoneTerm.js + placeLabel, and guards that the player-facing payphone words read it
// while GM tools keep saying "payphone".
//   node dev/tools/sims/test-payphone-term.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const T = await imp('scripts/utils/payphoneTerm.js');
const P = await imp('scripts/utils/payphones.js');

// ═══ 1. Rules ═══
ok(T.payphoneTerm() === 'Payphone' && P.placeLabel({ name: 'Kabuki' }) === 'Payphone, Kabuki', 'no Foundry / no setting → "Payphone", no throw');
ok(T.resolvePayphoneTerm('') === 'Payphone' && T.resolvePayphoneTerm('   ') === 'Payphone' && T.resolvePayphoneTerm(null) === 'Payphone', 'empty means the default');
ok(T.resolvePayphoneTerm('  Public \n Comm ') === 'Public Comm' && T.resolvePayphoneTerm('x'.repeat(60)).length === 40, 'one line, trimmed, 40 characters at most');
let SETTING = 'Pay Terminal';
globalThis.game = { settings: { get: (m, k) => (k === 'payphoneTerm' ? SETTING : undefined) } };
ok(T.payphoneTerm() === 'Pay Terminal' && T.payphoneTerm('lower') === 'pay terminal' && T.payphoneTerm('upper') === 'PAY TERMINAL', 'read live, in three cases');
ok(T.payphoneTerm('', { a: true }) === 'a Pay Terminal' && T.payphoneTerm('lower', { a: true }) === 'a pay terminal', '"a" in front');
SETTING = 'Old-style Booth'; ok(T.payphoneTerm('', { a: true }) === 'an Old-style Booth', '"an" before a vowel');
SETTING = 'Public Comm';
ok(P.placeLabel({ name: 'Kabuki' }) === 'Public Comm, Kabuki' && P.placeLabel({}) === 'Public Comm, somewhere', 'the place label follows the setting');
ok(T.payphonePlace('Watson') === 'Public Comm, Watson', 'payphonePlace = the pin / screen label');
delete globalThis.game;

// ═══ 2. Wiring ═══
const sm = read('scripts/core/SettingsManager.js');
const reg = sm.slice(sm.indexOf("register(MODULE_ID, 'payphoneTerm'"), sm.indexOf("register(MODULE_ID, 'shardTermCustom'"));
ok(/type: String/.test(reg) && /default: 'Payphone'/.test(reg) && /config: true/.test(reg) && /scope: 'world'/.test(reg) && !/requiresReload/.test(reg), 'a world text setting, default "Payphone", no reload');
ok(/onChange: \(\) => \{ game\.nightcity\?\.terminalScenePins\?\.relabelPayphones\?\.\(\); \}/.test(reg), 'a change renames the map pins');
ok(/name: 'What Players Call a Payphone'/.test(reg), 'a literal name (not an i18n key)');
ok(read('scripts/ui/settingsLayout.js').includes("'shardTermCustom', 'payphoneTerm'"), 'placed beside the shard name in Module Settings');
const pins = read('scripts/integrations/TerminalScenePins.js');
ok(/async relabelPayphones\(\) \{\n    if \(!isPrimaryGM\(\)\) return;/.test(pins) && pins.includes("updateEmbeddedDocuments('Note', notes)") && pins.includes("updateEmbeddedDocuments('Region', regions)"), 'relabel: one GM writes the notes and areas');
ok(pins.includes('const label = payphonePlace(pp.name);') && !pins.includes('`Payphone, ${'), 'new pins are labelled with the word');
// no player-facing literal left in the player-facing files
const PLAYER_FILES = ['scripts/services/PayphoneService.js', 'scripts/integrations/TerminalScenePins.js', 'scripts/integrations/AccessPoints.js', 'scripts/utils/payphones.js'];
for (const f of PLAYER_FILES) {
  const lits = [...read(f).matchAll(/(['"`])([^'"`\n]*?\b[Pp]ayphone\b[^'"`\n]*?)\1/g)].map((m) => m[2])
    // GM-side or internal, on purpose: the GM's own menus / warnings, the default RECORD name (a name, not the word),
    // console lines, doc-comment examples, a select key
    .filter((t) => !/^payphone$|^payphones$|^Payphone$|^as\.payphone$|Payphone options|Open in Admin|Place a payphone|No free number to give a payphone|NCM — Payphones|payphone-|\/payphone|— payphone$|^ — payphone|^payphone:|relabel on|cleanup failed|^Payphone, Kabuki$|\$\{payphonePlace/.test(t) && !/^[a-z]+(Payphone|payphone)[A-Za-z]*$/.test(t));
  ok(lits.length === 0, `${f}: no player-facing "payphone" literal left (${lits.join(' | ')})`);
}
ok(read('scripts/services/CallService.js').includes('name: `${payphoneTerm()} line`'), 'a booth call shows "<word> line" as its network');
ok(read('scripts/services/PayphoneService.js').includes("payphoneTerm('', { a: true })") , 'the ringing toast says "A <word> is ringing"');

console.log(`\ntest-payphone-term: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
