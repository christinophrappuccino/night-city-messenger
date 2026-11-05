// test-simple-network — stage 2, step 17. "Network simulation" off = SIMPLE NETWORK MODE: everyone on CitiNet,
// always connected at full signal, no dead zones, no network logins, no restricted mail, every network gate passes,
// network nodes do nothing — all answered inside NetworkService, so its callers need no change. A reload feature.
// Drives the REAL NetworkService (constructor included) with a mocked game, in both modes.
// Run: node dev/tools/sims/test-simple-network.mjs   (NCM_ROOT=<dir> to check another checkout)
import { readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';

const ROOT = path.resolve(process.env.NCM_ROOT || fileURLToPath(new URL('../../../', import.meta.url)));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const store = { networkSimulationEnabled: true, customNetworks: [], coreNetworkOverrides: {} };
const hooks = {};
const toasts = [];
const scene = { id: 'S1', name: 'Kabuki', getFlag: (m, k) => (k === 'deadZone' ? true : undefined) };
let gm = false;
globalThis.game = {
  user: { get isGM() { return gm; }, id: 'P1' },
  users: { activeGM: { id: 'G' } },
  settings: { get: (m, k) => store[k], set: async (m, k, v) => { store[k] = v; } },
  scenes: { get: (id) => (id === 'S1' ? scene : null), viewed: scene },
  actors: { filter: () => [] },
  i18n: { localize: (s) => s },
  nightcity: { eventBus: { emit() {}, on() {} }, stateManager: {}, socketManager: { emit() {} }, soundService: { play() {} },
    settingsManager: { get: (k) => store[k], set: async (k, v) => { store[k] = v; } }, timeService: { getCurrentTimeMs: () => 1_000_000 } },
};
globalThis.ui = { notifications: { warn: (m) => toasts.push(m), info() {}, error() {} } };
globalThis.Hooks = { on: (k, fn) => { (hooks[k] ||= []).push(fn); }, once() {}, callAll() {} };
globalThis.foundry = { utils: { deepClone: (x) => structuredClone(x), mergeObject: (a, b) => ({ ...a, ...b }), randomID: () => 'r' } };

const F = await imp('scripts/utils/features.js');
const { NetworkService } = await imp('scripts/services/NetworkService.js');
const { NETWORKS, DEFAULTS } = await imp('scripts/utils/constants.js');
ok(!!F.FEATURES.networks && !F.FEATURES.networks.live && F.FEATURES.networks.default === true, 'Network simulation is a reload feature, on by default');

// a restricted, login-gated custom network to try to reach
const DARK = { id: 'darknet', name: 'Darknet', type: 'custom', availability: { global: true, scenes: [] }, signalStrength: 40, reliability: 50,
  security: { requiresAuth: true }, effects: { restrictedAccess: true, canRoute: false, allowedRecipientNetworks: [] } };
store.customNetworks = [DARK];

// ═══ 1. the full simulation (on) ═══
F._resetFeatureCache();
const full = new NetworkService();
ok(!full.simple, 'on: not simple');
ok((hooks.canvasReady || []).length === 1 && (hooks.updateSetting || []).length >= 1, 'on: the scene and node hooks are installed');
full._isDeadZone = true; full._currentNetworkId = 'darknet'; full._signalStrength = 0;
ok(full.isDeadZone && full.currentNetworkId === 'darknet' && full.signalStrength === 0 && full.getAvailableNetworks().length === 0, 'on: a dead zone is a dead zone');
full._isDeadZone = false;
ok(full.getMessageAccessControl()?.restricted === true, 'on: mail sent on a restricted network is stamped restricted');
ok(full.checkAccess({ accessMode: 'whitelist', allowedNetworks: ['corpnet'] }).allowed === false, 'on: a network gate can refuse');

// ═══ 2. simple network mode (off) ═══
store.networkSimulationEnabled = false;
for (const k of Object.keys(hooks)) delete hooks[k];
F._resetFeatureCache();
const s = new NetworkService();
ok(s.simple === true, 'off: simple network mode');
ok(!hooks.canvasReady && !hooks.updateSetting && !hooks.updateWorldTime, 'off: no scene hook and no node hooks are installed');
s._isDeadZone = true; s._currentNetworkId = 'darknet'; s._signalStrength = 0; s._nodeDead = true;   // whatever state was left behind
ok(s.currentNetworkId === NETWORKS.CITINET && s.currentNetwork?.id === NETWORKS.CITINET, 'everyone is on CitiNet');
ok(s.isDeadZone === false && s.signalStrength === 100 && s.isNodeDead === false, 'always connected, full signal, no dead zone (even on a scene flagged dead)');
ok(s.getAvailableNetworks().map((n) => n.id).join() === NETWORKS.CITINET, 'CitiNet is the one network on offer');
ok(s.canAccessNetwork(NETWORKS.CITINET) && !s.canAccessNetwork('darknet'), 'only CitiNet can be joined');
ok(s.isAuthenticated('darknet') === true, 'no network logins');
ok(s.getMessageAccessControl() === null && s.getMessageAccessControl('darknet') === null, 'mail is never network-restricted');
ok(s.satisfiesMessageAccess({ restricted: true, requiredNetwork: 'darknet' }), 'mail stamped restricted before the switch opens');
ok(s.canSendToNetwork('darknet').allowed && s.getReachableNetworkIds().includes('darknet'), 'any recipient can be reached');
ok(s.checkAccess({ accessMode: 'whitelist', allowedNetworks: ['corpnet'], connectionMode: 'tethered', signalThreshold: 99 }).allowed, 'every shard / terminal network gate passes (even a tethered one)');
ok(s.networkPasses({ accessMode: 'whitelist', allowedNetworks: ['corpnet'] }, { id: 'x' }), 'the per-network status in a terminal gate passes too');
ok(s.checkReliability() === true, 'delivery is reliable');
ok(s.tappersAt(DARK, 'S1').length === 0, 'network nodes tap nothing');
const sw1 = await s.switchNetwork('darknet'), sw2 = await s.switchNetwork(NETWORKS.CITINET);
ok(sw1.success === false && sw1.reason === 'simple_network' && sw2.success === true, 'switching: refused to anything but CitiNet, which is a no-op success');
ok(store.customNetworks.length === 1 && store.customNetworks[0].id === 'darknet', 'network data is untouched');

// ═══ 3. the edges ═══
const NC = read('scripts/ui/NetworkNodes/NodeConsoleApp.js');
ok(/if \(ns\.simple\) return void ncmNotify\.warn\(/.test(NC), 'a node console does not open in simple mode (it says why)');
const RN = read('scripts/init/registerNetworkSystem.js');
ok(/\}, \{ feature: 'networks' \}\);   \/\/ simple network mode/.test(RN), 'node requests are dropped in simple mode (the socket op is feature-tagged)');
ok(/case 'deadZone':\n\s*if \(networkService\.simple\) break;/.test(RN), 'a GM dead-zone toggle broadcasts nothing to a simple world');
const SM = read('scripts/core/SettingsManager.js');
ok(/register\(MODULE_ID, 'networkSimulationEnabled', \{[\s\S]*?default: true, requiresReload: true,/.test(SM), 'the switch is registered: world, on by default, reload');
ok(DEFAULTS.CORE_NETWORKS.some((n) => n.id === NETWORKS.CITINET), 'CitiNet is a core network (always there to sit on)');

console.log(`test-simple-network: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
