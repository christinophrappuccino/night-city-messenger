// Sim: LOCK ODDS — "How hard for your party" in the terminal account editor
// (2026-10-27, dev-approved mock dev/mockups/admin-lock-odds-mock.html).
// Drives the pure scripts/utils/lockOdds.js, the REAL SkillService.getSkillData
// (stat + rank, roleAbilityRoll rank-only for role abilities) and the REAL
// TerminalConfigApp DOM readers via prototype.call over a mocked editor.
// Run: node dev/tools/sims/test-lock-odds.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ── minimal Foundry ──
let roleRoll = 'stat';
globalThis.game = {
  settings: { get: (m, k) => (k === 'roleAbilityRoll' ? roleRoll : undefined) },
  users: [], actors: [], nightcity: {},
  user: { isGM: true },
};
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'x', debounce: (f) => f },
  applications: { api: { ApplicationV2: class { constructor() {} }, HandlebarsApplicationMixin: (B) => class extends B {} } },
};
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '') };

const L = await imp('scripts/utils/lockOdds.js');
const { SkillService } = await imp('scripts/services/SkillService.js');

// ═══ 1. the d10 ═══
ok(L.d10Chance(14, 18).pct === 70 && L.d10Chance(14, 18).need === 4, 'Interface 14 vs 18 → needs 4+ → 70%');
ok(L.d10Chance(17, 18).pct === 100, 'needs 1 → always');
ok(L.d10Chance(20, 18).pct === 100, 'base above the DV → always');
ok(L.d10Chance(8, 18).pct === 10 && L.d10Chance(7, 18).pct === 0, 'needs 10 → 10%, needs 11 → never');
ok(L.oddsTone(70) === 'hi' && L.oddsTone(40) === 'mid' && L.oddsTone(10) === 'lo' && L.oddsTone(0) === 'none' && L.oddsTone(null) === 'none', 'tones: likely ≥65 / maybe ≥35 / long shot >0 / can\'t');

// ═══ 2. best skill, each row its own DV ═══
const lock = { requiresAuth: true, password: true, skill: true, keyItem: false, rows: [{ name: 'Interface', dv: 18 }, { name: 'Electronics/Security Tech', dv: 21 }], logic: 'any', failureMode: 'lockout', maxAttempts: 3, lockoutMin: 60 };
const pc = (name, skills, role = '') => ({ name, role, skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { base: v, found: v != null }])) });
const V = L.characterOdds(pc('V', { Interface: 14, 'Electronics/Security Tech': 9 }), lock);
ok(V.pct === 70 && V.skill === 'Interface' && /Interface 14 \+ d10 vs 18/.test(V.how), 'V: best = Interface vs 18, reads "Interface 14 + d10 vs 18"');
const J = L.characterOdds(pc('Judy', { 'Electronics/Security Tech': 15 }), lock);
ok(J.pct === 50 && J.skill === 'Electronics/Security Tech' && /Elec\/Sec Tech 15 \+ d10 vs 21/.test(J.how), 'Judy: Elec/Sec Tech vs its OWN DV 21 → 50%');
const both = L.characterOdds(pc('Both', { Interface: 9, 'Electronics/Security Tech': 18 }), lock);
ok(both.skill === 'Electronics/Security Tech' && both.pct === 80, 'the better of two skills wins even at a higher DV');
const K = L.characterOdds(pc('Kerry', {}), lock);
ok(K.pct === 0 && K.none && /no skill on the list/.test(K.how) && /only the password/.test(K.how), 'no listed skill → can\'t roll, the password is named');

// ═══ 3. the REAL SkillService base (stat + rank; roleAbilityRoll) ═══
const skill = Object.create(SkillService.prototype);
const actor = (stats, items) => ({ name: 'x', system: { stats }, items: Object.assign(items, { find: Array.prototype.find, filter: Array.prototype.filter }) });
const netrunner = actor({ tech: { value: 7 }, int: { value: 8 } }, [
  { type: 'role', name: 'Netrunner', system: { mainRoleAbility: { name: 'Interface', rank: 6 } } },
  { type: 'skill', name: 'Electronics/Security Tech', system: { level: 4, stat: 'tech' } },
]);
const baseOf = (a, s) => { const d = skill.getSkillData(a, s); return { base: d.statValue + d.skillLevel, found: d.found }; };
roleRoll = 'stat';
ok(baseOf(netrunner, 'Interface').base === 13 && baseOf(netrunner, 'Interface').found, 'Interface (stat mode): TECH 7 + rank 6 = 13');
roleRoll = 'rank';
ok(baseOf(netrunner, 'Interface').base === 6, 'Interface (rank mode): rank 6 only');
ok(baseOf(netrunner, 'Electronics/SecurityTech').base === 11, 'a normal skill keeps its stat in rank mode, names match space-insensitive');
const solo = actor({ tech: { value: 5 } }, [{ type: 'role', name: 'Solo', system: { mainRoleAbility: { name: 'Combat Awareness', rank: 4 } } }]);
ok(!baseOf(solo, 'Interface').found, 'a Solo has no Interface → not found → can\'t roll it');
roleRoll = 'stat';

// ═══ 4. ANY / ALL, sealed, open, no roll ═══
ok(/, and the password/.test(L.characterOdds(pc('V', { Interface: 14 }), { ...lock, logic: 'all' }).how), 'ALL: the roll AND the password');
ok(!/and the password/.test(V.how), 'ANY: the password is an alternative, not added');
const vOpen = L.lockOdds({ requiresAuth: false }, []);
ok(vOpen.open && /Anyone at the machine/.test(vOpen.verdict.text), 'Require login off → open');
const openHtml = L.lockOddsHtml(vOpen);
ok(/How hard for your party/.test(openHtml) && /Open — anyone at the machine walks straight in\./.test(openHtml) && !/ncm-lodds__v/.test(openHtml), 'open collapses to one line');
const sealed = L.lockOdds({ ...lock, password: false, skill: false, keyItem: false }, [pc('V', { Interface: 14 })]);
ok(sealed.verdict.title === 'Sealed.' && sealed.verdict.tone === 'bad', 'no method on → Sealed');
const noRoll = L.lockOdds({ ...lock, skill: false, keyItem: true }, [pc('V', { Interface: 14 })]);
ok(noRoll.verdict.title === 'No roll can open it.' && /password or key item/.test(noRoll.verdict.text) && /no roll — only the password or key item/.test(noRoll.rows[0].how), 'skill off → no roll can open it');

// ═══ 5. verdict wording ═══
const party3 = [pc('V', { Interface: 14 }, 'Netrunner'), pc('Rache', { Interface: 8 }, 'Solo'), pc('Judy', { 'Electronics/Security Tech': 15 }, 'Tech')];
const v3 = L.lockOdds(lock, party3);
ok(v3.layout === 'cards' && v3.rows[0].name === 'V', '≤4 characters → cards, best first');
ok(v3.verdict.title === 'Fair.' && /V, Judy are the ones to try it \(70% at best\)/.test(v3.verdict.text), 'Fair names the ones who can (best first)');
const hard = L.lockOdds({ ...lock, rows: [{ name: 'Interface', dv: 22 }] }, party3);
ok(hard.verdict.title === 'Hard.' && /V at 30%/.test(hard.verdict.text), 'Hard names the best chance');
const nobody = L.lockOdds({ ...lock, rows: [{ name: 'Interface', dv: 30 }] }, party3);
ok(nobody.verdict.title === 'Nobody can win the roll.', 'Nobody can win the roll');
const easy = L.lockOdds({ ...lock, rows: [{ name: 'Interface', dv: 5 }, { name: 'Electronics/Security Tech', dv: 5 }] }, party3);
ok(easy.verdict.title === 'Easy for everyone', 'Easy for everyone');
const many = Array.from({ length: 6 }, (_, i) => pc(`P${i}`, { Interface: 14 }));
const fair6 = L.lockOdds(lock, many);
ok(/P0, P1, P2 and 3 more are the ones/.test(fair6.verdict.text), 'names at most 3 people, "…and N more"');

// ═══ 6. large party: summary, spread, fold ═══
const p12 = [...many, ...Array.from({ length: 4 }, (_, i) => pc(`Z${i}`, {})), pc('Lo', { Interface: 8 }), pc('Mid', { Interface: 12 })];
const big = L.lockOdds(lock, p12);
ok(big.layout === 'list' && big.total === 12, '5+ → compact rows');
ok(big.counts.hi === 6 && big.counts.mid === 1 && big.counts.lo === 1 && big.counts.none === 4 && big.realistic === 7, 'tallies: likely / maybe / long shot / can\'t');
ok(Math.round(big.spread.reduce((n, s) => n + s.w, 0)) === 100, 'the spread bar adds up to 100%');
ok(big.shown.length === 8 && big.hiddenCount === 4 && big.canFold, "characters who can't roll fold away");
const bigHtml = L.lockOddsHtml(big);
ok(/<b>7<\/b> of 12 can realistically get in/.test(bigHtml) && /\+ 4 who can't roll — show them/.test(bigHtml) && /ncm-lodds__list/.test(bigHtml), 'summary line + "show them" button');
const bigAll = L.lockOdds(lock, p12, { showAll: true });
ok(bigAll.shown.length === 12 && /Hide the ones who can't roll/.test(L.lockOddsHtml(bigAll)), 'show them → all 12, then a hide button');
ok(!/ncm-lodds__sum/.test(L.lockOddsHtml(v3)), 'small party: no summary bar');

// ═══ 7. the note ═══
ok(/3 misses lock that character out for 60 min/.test(L.lockNote(lock)), 'note: lockout after N for M min');
ok(/Black ICE hits the runner/.test(L.lockNote({ ...lock, failureMode: 'damage' })), 'note: Black ICE');
ok(/lock them out for good/.test(L.lockNote({ ...lock, failureMode: 'permanent' })), 'note: permanent');
ok(/no crits or fumbles/.test(L.lockNote(lock)), 'note says the odds ignore crits and fumbles');
ok(!/<img src=x/.test(L.lockOddsHtml(L.lockOdds(lock, [pc('<img src=x onerror=1>', { Interface: 14 })]))), 'names are escaped');

// ═══ 8. the REAL editor readers (TerminalConfigApp via prototype.call) ═══
const { TerminalConfigApp } = await imp('scripts/ui/Terminal/TerminalConfigApp.js');
const field = (v) => ({ value: v, checked: !!v });
const rowsDom = [{ name: 'Interface', dv: '18' }, { name: 'Electronics/Security Tech', dv: '21' }].map((r) => ({
  querySelector: (sel) => (sel === '.ncm-bypass__skill' ? { value: r.name } : { value: r.dv }),
}));
const fields = { secRequiresAuth: field(true), secAllowPassword: field(true), secAllowSkill: field(true), secAllowKeyItem: field(false), secAuthLogic: { value: 'all' }, secFailureMode: { value: 'damage' }, secMaxAttempts: { value: '4' }, secLockoutMin: { value: '30' } };
const host = { innerHTML: '' };
const bypassBox = { matches: () => true, querySelectorAll: () => rowsDom };
const editor = {
  querySelector: (sel) => {
    if (sel === '[data-lock-odds]') return host;
    if (sel === '[data-bypass-rows]') return bypassBox;
    const m = sel.match(/\[name="([^"]+)"\]/);
    return m ? fields[m[1]] || null : null;
  },
  matches: () => false,
};
const read1 = TerminalConfigApp.prototype._readLockFromEditor.call({}, editor);
ok(read1.requiresAuth && read1.password && read1.skill && !read1.keyItem && read1.logic === 'all' && read1.failureMode === 'damage' && read1.maxAttempts === 4 && read1.lockoutMin === 30, 'reads the method toggles + hidden chip inputs + numbers from the DOM');
ok(read1.rows.length === 2 && read1.rows[1].dv === 21 && read1.rows[1].name === 'Electronics/Security Tech', 'reads the unnamed bypass rows (readBypassRows)');
// party through the real SkillService
game.nightcity.skillService = skill;
const nr = { ...netrunner, id: 'a1', name: 'V', img: 'icons/svg/mystery-man.svg' };
game.users = [{ id: 'u1', isGM: false, name: 'P', character: nr }];
const fake = { _oddsBases: new Map() };
const party = TerminalConfigApp.prototype._oddsParty.call(fake, ['Interface', 'Electronics/Security Tech']);
ok(party.length === 1 && party[0].role === 'Netrunner' && party[0].skills.Interface.base === 13 && party[0].skills['Electronics/Security Tech'].base === 11 && !party[0].img, 'party: getPlayerCharacters × SkillService base; the mystery-man portrait becomes initials');
TerminalConfigApp.prototype._paintLockOdds.call(Object.assign(fake, { _readLockFromEditor: TerminalConfigApp.prototype._readLockFromEditor, _oddsParty: TerminalConfigApp.prototype._oddsParty }), editor);
ok(/How hard for your party/.test(host.innerHTML) && /Interface 13 \+ d10 vs 18/.test(host.innerHTML) && /and the password/.test(host.innerHTML) && /Black ICE hits the runner/.test(host.innerHTML), 'paints the panel from the live DOM');
fields.secRequiresAuth = field(false);
TerminalConfigApp.prototype._paintLockOdds.call(fake, editor);
ok(/ncm-lodds is-open/.test(host.innerHTML), 'Require login off → one line');

// ═══ 9. wiring guards ═══
const tpl = read('templates/terminal/partials/config-account.hbs');
const i = tpl.indexOf('data-lock-odds');
ok(i > tpl.indexOf('name="secLockoutMin"') && i < tpl.indexOf('countermeasure-override.hbs'), 'panel sits under the failure rules, before the countermeasure override');
const cfgJs = read('scripts/ui/Terminal/TerminalConfigApp.js');
const wire = cfgJs.slice(cfgJs.indexOf('_wireAccountEditor(el) {'), cfgJs.indexOf('_wireAccountEditor(el) {') + 2400);
ok(/addEventListener\('input', paintOdds\)/.test(wire) && /addEventListener\('change', paintOdds\)/.test(wire) && /setTimeout\(paintOdds, 0\)/.test(wire), 'repaints on input / change / (deferred) chip click — no re-render');
ok(!/this\.render\(/.test(cfgJs.slice(cfgJs.indexOf('_paintLockOdds(editor) {'), cfgJs.indexOf('_paintLockOdds(editor) {') + 900)), 'painting never re-renders the sheet');
const css = read('styles/components/terminal.css');
const classes = new Set([...L.lockOddsHtml(big).matchAll(/class="([^"]+)"/g), ...L.lockOddsHtml(v3).matchAll(/class="([^"]+)"/g), ...openHtml.matchAll(/class="([^"]+)"/g)]
  .flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('ncm-lodds')));
for (const c of classes) ok(css.includes(`.${c}`), `.${c} is styled`);
const block = css.slice(css.indexOf('G · Lock odds'), css.indexOf('/* Items-directory terminal badge'));
ok(block.length > 1000 && !/#[0-9a-f]{3,8}\b/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), 'lock-odds CSS uses tokens only');
ok(/@container \(max-width: 520px\)/.test(block) && /container-type: inline-size/.test(block), 'narrow host: container query');
ok(/max-height: 196px/.test(block), 'big party scrolls in its own box');

console.log(`\ntest-lock-odds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
