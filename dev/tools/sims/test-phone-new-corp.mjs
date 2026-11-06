// test-phone-new-corp — adding a corporation (tester round 2026-11-06: "is there a way to add a corporation?").
// Numbers → Corporations has New corporation, Setup → Places → Add has A corporation, both open one form that writes a
// Places row with category Corporate and then opens it on the Corporations screen. Add a place got a Category. And a
// world with no corporate rows no longer breaks the Corporations screen.
// Drives the REAL phoneNumbersView (render + its click / change / input handlers) over a REAL CallService on the shared
// mock world, through a small element double (no DOM library).
// Run: node dev/tools/sims/test-phone-new-corp.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import { createMockWorld } from './lib/world.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const M = 'night-city-messenger';
const quietInfo = console.info; console.info = () => {};
const toasts = [];

const world = await createMockWorld({ users: [{ id: 'gm1', name: 'GM', isGM: true }], realSettings: true });
globalThis.ui = { ...(globalThis.ui || {}), notifications: { warn: (m) => toasts.push(m), info: (m) => toasts.push(m), error: (m) => toasts.push(m) } };
globalThis.performance ??= { now: () => Date.now() };
globalThis.document ??= {};
globalThis.document.createElement ??= () => ({ innerHTML: '', querySelector: () => null });
const { CallService } = await imp('scripts/services/CallService.js');
const V = await imp('scripts/ui/AdminPanel/tabs/phoneNumbersView.js');
const PN = await imp('scripts/utils/phoneNumbering.js');
const svc = new CallService();
svc.eventBus = { emit() {}, on() {}, off() {} };
game.nightcity = { ...(game.nightcity || {}), callService: svc, masterContactService: { getAll: () => [], getContact: () => null } };

let renders = 0;
const tab = { calls: svc, _pn: V.newNumberState(), _view: 'numbers', app: { render: () => { renders++; }, isPopout: false } };
const html = () => V.numbersHtml(tab);

// the element double: the handlers wireNumbers adds, and what they read
const handlers = {};
const out = { innerHTML: '' };
const box = { addEventListener: (t, fn) => { handlers[t] = fn; }, querySelector: (s) => (s === '#ac-out' ? out : null), querySelectorAll: () => [], isConnected: true };
V.wireNumbers(tab, { querySelector: (s) => (s === '.ncm-pn' ? box : null) });
const el = (data, extra = {}) => ({ dataset: data, disabled: false, closest: (s) => (s === '[data-do]' && data.do ? el(data, extra) : s === '.ncm-pn' ? box : null), ...extra });
const click = (data) => handlers.click({ target: el(data) });
const change = (data, value, extra = {}) => handlers.change({ target: { id: '', dataset: data, value, ...extra, closest: (s) => (s === '.ncm-pn' ? box : null) } });
const type = (data, value) => handlers.input({ target: { dataset: data, value, closest: (s) => (s === '.ncm-pn' ? box : null) } });
const corpsNow = () => PN.buildNumberContext ? svc.numberContext.rows.filter((r) => r.Category === 'Corporate') : [];

// ═══ 1. the doors ═══
tab._pn.f = 'corp';
let h = html();
ok(/data-do="acOpen"/.test(h) && /New corporation/.test(h), 'Corporations has a New corporation button');
tab._pn.f = 'places';
h = html();
ok(/data-do="acOpen"[^>]*>.*A corporation/.test(h), 'Places → Add has A corporation');
ok(/id="ap-cat"/.test(h) === false, 'the place form is closed until opened');

// ═══ 2. the form, live checks ═══
await click({ do: 'acOpen' });
h = html();
ok(/New corporation/.test(h) && /id="ac-name"/.test(h) && /id="ac-code"/.test(h) && /id="ac-city"/.test(h) && /id="ac-hide"/.test(h), 'the form opens with name, code, city and hide');
ok(!/ncm-pn-check/.test(h.split('id="ac-out"')[1]?.split('</div></div>')[0] || ''), 'an untouched form shows no complaints');
const before = corpsNow().length;
toasts.length = 0;
await click({ do: 'acGo' });
ok(corpsNow().length === before && toasts.some((t) => /name/i.test(t)), 'Add it with nothing filled in: nothing added, says what is missing');
type({ in: 'ac', k: 'name' }, 'Xoma');
type({ in: 'ac', k: 'code' }, 'xo');
ok(/three letters/.test(out.innerHTML), 'a two-letter code is flagged while typing');
const taken = svc.numberContext.rows.find((r) => r.Code && r['Region code'] === svc.numberContext.home.rc && r['City code'] === svc.numberContext.home.city);
type({ in: 'ac', k: 'code' }, taken.Code.toLowerCase());
ok(new RegExp(`${taken.Code} is already`).test(out.innerHTML), 'a code already used in that city is flagged');
type({ in: 'ac', k: 'code' }, 'xom');
ok(/XOM-0100|XOM-/.test(out.innerHTML) && !/is already/.test(out.innerHTML), 'a free code shows the switchboard number');

// ═══ 3. Add it ═══
toasts.length = 0;
await click({ do: 'acGo' });
const xoma = corpsNow().find((r) => r.District === 'Xoma');
ok(!!xoma && xoma.Code === 'XOM' && xoma.Category === 'Corporate' && xoma['Players can pick'] === 'no' && xoma.Listed === 'yes', 'Xoma is a Corporate row, not pickable, listed');
ok(xoma && xoma['Region code'] === svc.numberContext.home.rc && xoma['City code'] === svc.numberContext.home.city, 'in the home city by default');
ok(tab._pn.f === 'corp' && tab._pn.off === PN.officeKey(xoma) && tab._view === 'numbers' && !tab._pn.addCorp, 'it opens on the Corporations screen, on Xoma');
h = html();
ok(/<h3>Xoma<\/h3>/.test(h), 'the Corporations editor shows Xoma');
ok(/Added Xoma/.test(h), 'with an undo line');

// it works as an office: its switchboard can be set (the 2.2.1 save fix)
await click({ do: 'corpAns', v: 'recording' });
ok(svc.office(xoma).answers === 'recording', 'its switchboard saves');

// hidden
await click({ do: 'acOpen' });
type({ in: 'ac', k: 'name' }, 'Ghost Corp');
type({ in: 'ac', k: 'code' }, 'GHO');
await change({ ch: 'acHide' }, '', { checked: true });
await click({ do: 'acGo' });
ok(corpsNow().find((r) => r.District === 'Ghost Corp')?.Listed === 'no', 'Keep it out of the directory writes Listed: no');

// ═══ 4. Add a place: Category ═══
tab._pn.f = 'places';
await click({ do: 'apOpen' });
h = html();
ok(/id="ap-cat"/.test(h) && /<option value="Corporate"/.test(h) && /<option value="" selected/.test(h), 'Add a place has a Category, default the old behaviour');
tab._pn.addPlace = { ...tab._pn.addPlace, city: 'Testville', cc: 'TV', di: 'Tower', ex: '', cat: 'Corporate' };
h = html();
ok(/needs a three-letter code/.test(h), 'Corporate without a code is flagged');
toasts.length = 0;
await click({ do: 'apGo' });
ok(!svc.numberContext.rows.some((r) => r.City === 'Testville') && toasts.some((t) => /three-letter/.test(t)), '…and not added');
tab._pn.addPlace.ex = 'TWR';
await click({ do: 'apGo' });
const tw = svc.numberContext.rows.find((r) => r.City === 'Testville');
ok(tw?.Category === 'Corporate' && tw['Players can pick'] === 'no', 'a place added as Corporate is a corporation');
await click({ do: 'apOpen' });
tab._pn.addPlace = { ...tab._pn.addPlace, city: 'Plainville', cc: 'PV', di: 'Centre', ex: 'CEN', cat: '' };
await click({ do: 'apGo' });
const pv = svc.numberContext.rows.find((r) => r.City === 'Plainville');
ok(pv?.Category === 'District' && pv['Players can pick'] === 'yes', 'left alone, a place is still a District players can pick');

// ═══ 5. no corporations at all ═══
await game.settings.set(M, 'phonePlaces', { list: 'blank' });
tab._pn.f = 'corp'; tab._pn.off = null; tab._pn.addCorp = null;
let threw = null;
try { h = html(); } catch (e) { threw = e; }
ok(!threw && /No corporations yet/.test(h) && /data-do="acOpen"/.test(h), 'a world with no corporations shows the empty screen with the button');

console.info = quietInfo;
console.log(`test-phone-new-corp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
