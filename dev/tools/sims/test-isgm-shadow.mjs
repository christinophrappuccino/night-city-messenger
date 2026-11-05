// Sim: the phone preview no longer overwrites game.user.isGM (audit remediation C2: COMPAT-03, plus COMPAT-04).
//
//   COMPAT-03  Admin → Phone's call-screen preview did Object.defineProperty(game.user, 'isGM', {value:false}) and in
//              `finally` defineProperty again with the old value. That leaves an OWN property on the user that hides
//              Foundry's isGM getter for the rest of the session, for every module.
//   COMPAT-04  a bare `.mt` rule in tab-phone.css turned every `.mt` element anywhere in Foundry into a flex box.
//
// Drives the REAL CallHud: a copy marked `asPlayer` draws the player's view while game.user stays a GM, untouched.
import { pathToFileURL, fileURLToPath } from 'url';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

// A Foundry-like user: isGM is a getter on the class, not a property of the object.
class User { constructor(role) { this.role = role; this.id = 'gm'; } get isGM() { return this.role >= 4; } }
globalThis.game = { user: new User(4), users: { get: () => null, activeGM: null }, settings: { get: () => undefined }, nightcity: {} };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
globalThis.Hooks = { on() {}, off() {}, once() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };

const { CallHud } = await import(pathToFileURL(`${ROOT}/scripts/ui/Calls/CallHud.js`).href);
const svc = { calls: new Map(), usableModes: ['loud'], offeredModes: ['loud'], modeFor: () => 'loud', homeCode: null, _get: (k, d) => d };
const call = { id: 'c1', from: { name: 'Unknown', number: '', anon: true, contactId: null }, to: { userId: 'u', name: 'V', number: 'WAT-4471', kind: 'player' }, net: null, mode: 'loud', state: 'ringing', startedAt: Date.now() - 2000, answeredAt: null };

let gmHtml = '', playerHtml = '';
try { gmHtml = new CallHud(svc)._callHtml({ call, role: 'callee' }, {}); } catch (err) { ok(false, `the GM view draws (${err.message})`); }
const preview = Object.assign(new CallHud(svc), { asPlayer: true });
try { playerHtml = preview._callHtml({ call, role: 'callee' }, {}); } catch (err) { ok(false, `the player view draws (${err.message})`); }

ok(/they cannot see who/.test(gmHtml) && !/Trace/.test(gmHtml.replace(/data-tooltip="[^"]*"/g, '')) , 'a GM\'s own call screen shows the GM view');
ok(/Incoming call/.test(playerHtml) && !/is calling|Answer as/.test(playerHtml), 'the preview copy shows what the player gets ("Incoming call")');
{ const live = { ...call, state: 'live', answeredAt: Date.now() - 5000 };
  const p = preview._callHtml({ call: live, role: 'callee' }, {}); const g = new CallHud(svc)._callHtml({ call: live, role: 'callee' }, {});
  ok(/Trace/.test(p) && !/they cannot see who/.test(p), 'live, withheld: the player view offers Trace');
  ok(/they cannot see who/.test(g) && !/>Trace</.test(g), 'and the GM view carries the GM note instead'); }
ok(game.user.isGM === true && !Object.prototype.hasOwnProperty.call(game.user, 'isGM'), 'game.user is untouched: isGM is still Foundry\'s getter');
game.user.role = 1;
ok(game.user.isGM === false, 'and it still follows the user (nothing froze it)');

// Wiring: nothing in the module overwrites a user's GM status.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []));
const shadows = walk(`${ROOT}/scripts`).filter((f) => /defineProperty\(\s*game\.user\s*,\s*['"]isGM['"]|game\.user\.isGM\s*=[^=]/.test(readFileSync(f, 'utf8')));
ok(!shadows.length, `no script overwrites game.user.isGM${shadows.length ? `: ${shadows.join(', ')}` : ''}`);
ok(/Object\.assign\(new CallHud\(HUD_SVC\), \{ asPlayer: true \}\)/.test(read('scripts/ui/AdminPanel/tabs/phoneNumbersView.js')), 'the Admin → Phone preview uses its own asPlayer copy');

// COMPAT-04: no bare `.mt` rule
const css = read('styles/components/admin-panel/tab-phone.css').replace(/\/\*[\s\S]*?\*\//g, '');
const bare = css.split('}').map((r) => r.split('{')[0]).flatMap((sel) => sel.split(',')).map((s) => s.trim()).filter((s) => s === '.mt');
ok(!bare.length, 'tab-phone.css has no bare `.mt` selector (it styled every .mt in Foundry)');

console.log(`test-isgm-shadow: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
