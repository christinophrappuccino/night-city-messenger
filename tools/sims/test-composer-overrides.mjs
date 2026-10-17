// Sim: the composer's header pills (2026-10-17 tester ask — "is there a way to
// change the network it's sending from?").
//   - MessageService._resolveSendOverrides: GM-only "send via" network +
//     past-only backdate; every non-GM / unflagged caller keeps the old rule.
//   - NetworkService.getMessageAccessControl(networkId): stamps the chosen net.
//   - MessageComposerApp._buildNetPicker: player list = reachable nets only
//     (locked/active/available, same as the inbox selector); GM list = every
//     net, own connection pinned first, override marked, filter-chip counts.
// Drives the REAL methods via prototype.call with mocked globals.
import { pathToFileURL } from 'url';

const ROOT = 'C:/Users/cphan/AppData/Local/FoundryVTT/Data/modules/night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const NOW = Date.parse('2045-10-17T22:14:00Z');
globalThis.game = { user: { isGM: true }, settings: { get: () => undefined }, nightcity: {} };
globalThis.foundry = {
  utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'x' },
  applications: { api: { HandlebarsApplicationMixin: (B) => B, ApplicationV2: class {} } },
};
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };

const { MessageService } = await import(pathToFileURL(`${ROOT}/scripts/services/MessageService.js`).href);
const { NetworkService } = await import(pathToFileURL(`${ROOT}/scripts/services/NetworkService.js`).href);
const { MessageComposerApp } = await import(pathToFileURL(`${ROOT}/scripts/ui/MessageComposer/MessageComposerApp.js`).href);

// ── Fake network world ──
const NETS = [
  { id: 'CITINET', name: 'CitiNet', type: 'public', signalStrength: 90, theme: { color: '#19f3f7' }, security: {}, effects: {} },
  { id: 'DARKNET', name: 'DarkNet', type: 'hidden', signalStrength: 55, theme: {}, security: {}, effects: {} },
  { id: 'ARASAKA', name: 'Arasaka CorpNet', type: 'corporate', signalStrength: 30,
    theme: {}, security: { requiresAuth: true, password: 'x' }, effects: { restrictedAccess: true } },
  { id: 'NCPD', name: 'NCPD GovNet', type: 'government', signalStrength: 0, theme: {}, security: {}, effects: {} },
  { id: 'WEIRD', name: 'Zeta', type: 'mystery', signalStrength: 60, theme: {}, security: {}, effects: {} },
];
const available = new Set(['CITINET', 'DARKNET', 'ARASAKA', 'NCPD']);
const fakeNs = {
  currentNetworkId: 'CITINET',
  isDeadZone: false,
  getNetwork: (id) => NETS.find(n => n.id === id) ?? null,
  getAllNetworks: () => NETS,
  getAvailableNetworks: () => NETS.filter(n => available.has(n.id)),
  isAuthenticated: () => false,
};

// ═══ _resolveSendOverrides ═══
const svc = { _nowMs: () => NOW };
const R = (data) => MessageService.prototype._resolveSendOverrides.call(svc, data, fakeNs);

let r = R({ network: 'ARASAKA', networkOverride: true });
ok(r.viaNetwork?.id === 'ARASAKA', 'GM override → chosen network');
ok(R({ network: 'ARASAKA' }).viaNetwork === null, 'no override flag → no override (old rule)');
ok(R({ network: 'GONE', networkOverride: true }).viaNetwork === null, 'unknown network → ignored');
r = R({ timestamp: '2045-10-12T03:40:00Z', backdated: true });
ok(r.backdate === '2045-10-12T03:40:00.000Z', 'GM past date → backdate kept');
ok(R({ timestamp: '2045-10-20T00:00:00Z', backdated: true }).backdate === null, 'future date is NOT a stamp');
ok(R({ timestamp: '2045-10-12T03:40:00Z' }).backdate === null, 'timestamp without backdated flag → ignored (queue flush etc.)');
ok(R({ timestamp: 'garbage', backdated: true }).backdate === null, 'invalid date → ignored');
game.user.isGM = false;
r = R({ network: 'ARASAKA', networkOverride: true, timestamp: '2045-10-12T03:40:00Z', backdated: true });
ok(r.viaNetwork === null && r.backdate === null, 'player can never override network or date');
game.user.isGM = true;

// ═══ getMessageAccessControl(networkId) ═══
const nsLike = { get currentNetwork() { return fakeNs.getNetwork('CITINET'); }, getNetwork: fakeNs.getNetwork };
ok(NetworkService.prototype.getMessageAccessControl.call(nsLike) === null, 'current (unrestricted) → null');
const ac = NetworkService.prototype.getMessageAccessControl.call(nsLike, 'ARASAKA');
ok(ac?.requiredNetwork === 'ARASAKA', 'override → stamps the chosen restricted network');

// ═══ _buildNetPicker ═══
const app = { networkService: fakeNs, sendNetworkId: null };
const P = () => MessageComposerApp.prototype._buildNetPicker.call(app);

// Player
game.user.isGM = false;
let p = P();
ok(!p.isGM && !p.showFilters, 'player: no search/filters');
ok(p.rows.map(x => x.id).join() === 'CITINET,DARKNET,ARASAKA', 'player: only reachable nets, active→available→locked');
ok(p.rows[0].chip === 'Connected' && p.rows[2].chip === 'Locked', 'player: chips match the inbox selector');
ok(!p.rows.some(x => x.id === 'NCPD' || x.id === 'WEIRD'), 'player: 0% / unavailable networks hidden');
fakeNs.isDeadZone = true;
p = P();
ok(p.isDeadZone && p.rows.length === 0, 'player: dead zone → empty, flagged');
fakeNs.isDeadZone = false;

// GM
game.user.isGM = true;
p = P();
ok(p.isGM && p.showFilters, 'GM: search + filters shown');
ok(p.rows.length === NETS.length, 'GM: every network listed');
ok(p.rows[0].id === 'CITINET' && p.rows[0].pinned && p.rows[0].chip === 'Default', 'GM: own connection pinned first as Default');
const oor = p.rows.filter(x => x.oor).map(x => x.id).sort().join();
ok(oor === 'NCPD,WEIRD', 'GM: out-of-range marked (0% and not-available)');
ok(p.rows.findIndex(x => x.id === 'NCPD') > p.rows.findIndex(x => x.id === 'ARASAKA'), 'GM: in-range sorted before out-of-range');
ok(p.rows.find(x => x.id === 'WEIRD').kind === 'custom', 'GM: unknown type falls into Custom');
const fc = Object.fromEntries(p.filters.map(f => [f.key, f.count]));
ok(fc.all === 4 && fc.range === 2 && fc.custom === 1 && !('nonsense' in fc), 'GM: chip counts exclude the pinned row; empty types dropped');
ok(p.filters.find(f => f.key === 'public') === undefined, 'GM: Public chip hidden when only the pinned net is public');
app.sendNetworkId = 'ARASAKA';
p = P();
ok(p.rows.find(x => x.id === 'ARASAKA').chip === 'Sending via' && p.rows[0].chip === 'Use default', 'GM: override marked, default offered back');
ok(/stay on CitiNet/.test(p.footer), 'GM: footer names the connection that does not move');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
