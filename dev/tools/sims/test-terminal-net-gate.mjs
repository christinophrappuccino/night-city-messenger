// Sim: restricting a terminal entry to specific networks (tester 2026-10-30: "I save and it just goes to
// the citinet; re-editing it reverts"). Both terminal edit doors dropped networkVisibility, and the edit path
// writes entryData straight to flags, so re-saving wiped the restriction. Drives the REAL composer methods,
// TerminalService._buildMessageFlags / uplinkReaches and MessageRepository._pageToMessage over fake DOM.
// Run: node dev/tools/sims/test-terminal-net-gate.mjs
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

let GM = true;
globalThis.game = { get user() { return { isGM: GM }; }, users: { activeGM: {} }, settings: { get: () => undefined }, i18n: { localize: (s) => s },
  nightcity: { timeService: { getCurrentTime: () => '2046-03-13T02:14:00Z', getCurrentTimeMs: () => Date.parse('2046-03-13T02:14:00Z') } } };
globalThis.foundry = { utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)), randomID: () => Math.random().toString(36).slice(2, 10), debounce: (f) => f, mergeObject: (a, b) => ({ ...a, ...b }) },
  applications: { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => class extends B {} } } };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} } };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') };

const { DataShardComposer } = await imp('scripts/ui/ItemInbox/DataShardComposer.js');
const { TerminalService } = await imp('scripts/services/TerminalService.js');
const { MessageRepository } = await imp('scripts/data/MessageRepository.js');

const NETS = [{ id: 'citinet', name: 'CitiNet', type: 'public' }, { id: 'sierra', name: 'SS Sierra', type: 'corp' }, { id: 'pier', name: 'Pier <7>', type: 'dark' }];

// ── Fake DOM: only what _paintNetworkTags touches ──
const fakeEl = () => ({ innerHTML: '', textContent: '', hidden: true, checked: false, classList: { on: new Set(), toggle(c, v) { v ? this.on.add(c) : this.on.delete(c); } } });
function composer({ editData, isTerminal = true, interfaces = [] } = {}) {
  const c = Object.create(DataShardComposer.prototype);
  const parts = { '#ncm-entry-network-tags': fakeEl(), '#ncm-add-entry-network-select': fakeEl(), '[name="networkRestricted"]': fakeEl(), '[data-net-note]': fakeEl() };
  const element = { querySelector: (s) => parts[s] ?? null, querySelectorAll: () => [] };
  Object.defineProperties(c, {
    element: { get: () => element },
    networkService: { get: () => ({ getAllNetworks: () => NETS }) },
    terminalService: { get: () => ({ getConfig: () => ({ connection: { interfaces } }) }) },
    _isTerminal: { get: () => isTerminal },
    _item: { get: () => ({}) },
  });
  c.editData = editData;
  c._netDraft = null;
  c._syncCmpChips = () => {};
  return { c, parts };
}

// ═══ 1. The round trip the tester hit: save → read → edit door → save again ═══
const svc = Object.create(TerminalService.prototype);
const repo = Object.create(MessageRepository.prototype);
const nv = { restricted: true, allowedNetworks: ['sierra'], allowedTypes: [] };
const flags = svc._buildMessageFlags('m1', 'acct', { subject: 'Eyes only', from: 'x@y', networkVisibility: nv, folder: 'cases', status: { saved: false, deleted: false } });
ok(flags.networkVisibility?.allowedNetworks?.[0] === 'sierra', 'create keeps the restriction in the flags');
const raw = repo._pageToMessage({ id: 'p1', flags: { [MOD]: flags }, parent: { id: 'j' } });
ok(raw.networkVisibility?.restricted === true, 'the reader returns it');
const ed = DataShardComposer.terminalEditData(raw);
ok(ed.networkVisibility?.restricted === true && ed.networkVisibility.allowedNetworks[0] === 'sierra', 'the edit data carries it');
ok(ed.entryId === 'm1', 'the edit data keeps the entry id');
ok(ed.folder === 'cases', 'the edit data keeps a custom folder (an edit used to send it to the Inbox)');
{
  const { c, parts } = composer({ editData: ed, interfaces: [{ networkId: 'sierra' }] });
  c._paintNetworkTags();
  ok(parts['[name="networkRestricted"]'].checked === true, 're-editing shows Restrict ticked');
  ok(/SS Sierra/.test(parts['#ncm-entry-network-tags'].innerHTML) && /name="entryAllowedNetwork" value="sierra"/.test(parts['#ncm-entry-network-tags'].innerHTML), 're-editing shows the tag, with the hidden input the save reads');
  ok(!/value="sierra"/.test(parts['#ncm-add-entry-network-select'].innerHTML) && /value="citinet"/.test(parts['#ncm-add-entry-network-select'].innerHTML), 'a picked network leaves the add list');
  ok(parts['[data-net-note]'].hidden, 'no warning when the terminal has that network');
}

// ═══ 2. Both doors go through the one helper ═══
for (const f of ['scripts/ui/Terminal/TerminalViewerApp.js', 'scripts/ui/Terminal/TerminalConfigApp.js']) {
  const src = read(f);
  ok(/DataShardComposer\.terminalEditData\(raw\)/.test(src), `${f} uses terminalEditData`);
  ok(!/entryId: id, contentType: raw\.contentType/.test(src), `${f} builds no private edit data`);
}

// ═══ 3. Picks survive and behave ═══
{
  const { c, parts } = composer({ editData: undefined, interfaces: [{ networkId: 'citinet' }] });
  ok(c._netState().restricted === false && c._netState().ids.length === 0, 'a new entry starts unrestricted');
  c._setNetDraft({ restricted: true, ids: ['sierra'] });
  ok(parts['[name="networkRestricted"]'].checked === true, 'adding a network ticks Restrict');
  ok(c._netState().ids[0] === 'sierra', 'the pick lives in the draft, so a re-render cannot lose it');
  ok(!parts['[data-net-note]'].hidden && /no SS Sierra connection/.test(parts['[data-net-note]'].textContent), 'warns when the terminal has no uplink on that network');
  DataShardComposer._onRemoveEntryNetworkTag.call(c, {}, { dataset: { value: 'sierra' } });
  ok(c._netState().restricted === false && !c._netState().ids.length, 'removing the last network switches Restrict off');
  c._setNetDraft({ restricted: true });
  ok(/Pick a network/.test(parts['[data-net-note]'].textContent), 'Restrict on with no networks says so');
  c._setNetDraft({ restricted: false, ids: ['citinet'] });
  ok(parts['#ncm-entry-network-tags'].classList.on.has('is-off') && /ignored/.test(parts['[data-net-note]'].textContent), 'Restrict off with networks says they are ignored');
}
{
  const { c, parts } = composer({ editData: { networkVisibility: { restricted: true, allowedNetworks: ['pier', 'gone'] } }, isTerminal: false });
  c._paintNetworkTags();
  const tags = parts['#ncm-entry-network-tags'].innerHTML;
  ok(tags.includes('Pier &lt;7&gt;') || tags.includes('Pier &lt;7>'), 'names are escaped');
  ok(/Deleted network/.test(tags) && /value="gone"/.test(tags), 'a deleted network stays visible rather than silently leaving Restrict with nothing');
  ok(parts['[data-net-note]'].hidden, 'the interface warning is terminal-only');
}
{
  const seedDraft = composer({ editData: { networkVisibility: { restricted: true, allowedNetworks: ['sierra'] } } }).c;
  seedDraft._setNetDraft({ ids: [] });
  ok(/this\.editData = foundry\.utils\.deepClone\(seed\);[\s\S]{0,80}this\._netDraft = null/.test(read('scripts/ui/ItemInbox/DataShardComposer.js')), 'loading a template drops the draft');
}

// ═══ 4. What the viewer enforces ═══
{
  const t = Object.create(TerminalService.prototype);
  t.getUplink = () => ({ networkId: 'citinet', network: NETS[0] });
  ok(t.uplinkReaches({}, nv) === false, 'on CitiNet, a Sierra-only message is off the uplink');
  GM = true; ok(t.isContentVisible({}, nv) === true, 'the GM still sees it (tagged OFF-NET), which is not a save failure');
  GM = false; ok(t.isContentVisible({}, nv) === false, 'a player on CitiNet does not');
  t.getUplink = () => ({ networkId: 'sierra', network: NETS[1] });
  ok(t.isContentVisible({}, nv) === true, 'a player on Sierra does');
  GM = true;
}

// ═══ 5. The markup + CSS ═══
const hbs = read('templates/item-inbox/data-shard-composer.hbs');
const css = read('styles/components/item-inbox.css');
ok(/data-net-note/.test(hbs), 'the warning line is in the template');
ok(!/addEntryNetworkTag/.test(hbs) && !/addEntryNetworkTag/.test(read('scripts/ui/ItemInbox/DataShardComposer.js')), 'the separate + step is gone');
ok(/\.ncm-tag-list button\.ncm-tag__remove[^}]*width:[^;]*!important/.test(css), 'the remove button has a fixed width (Foundry stretches a bare button full width)');

// ═══ 6. Network Reachability: who can open the terminal at all (Layer 0) ═══
const { NetworkService } = await imp('scripts/services/NetworkService.js');
const { TerminalViewerApp } = await imp('scripts/ui/Terminal/TerminalViewerApp.js');
const NETS2 = [
  { id: 'citinet', name: 'CitiNet', type: 'public', signalStrength: 10, security: {} },
  { id: 'sierra', name: 'SS Sierra', type: 'corp', signalStrength: 90, security: {} },
  { id: 'vault', name: 'Vault', type: 'corp', signalStrength: 90, security: { requiresAuth: true } },
];
const onNet = (id) => {
  const s = Object.create(NetworkService.prototype);
  Object.defineProperties(s, {
    currentNetworkId: { get: () => id },
    currentNetwork: { get: () => NETS2.find(n => n.id === id) ?? null },
    signalStrength: { get: () => NETS2.find(n => n.id === id)?.signalStrength ?? 0 },
  });
  s.getNetwork = (nid) => NETS2.find(n => n.id === nid);
  s.getAvailableNetworks = () => NETS2;
  s.isAuthenticated = () => false;
  return s;
};
const only = (ids) => ({ accessMode: 'whitelist', allowedNetworks: ids });
ok(onNet('citinet').checkAccess({ accessMode: 'any', allowedNetworks: ['sierra'] }).allowed, 'Any network really is any (the sheet now hides the list under it)');
ok(!onNet('citinet').checkAccess(only(['sierra'])).allowed, 'Only these: CitiNet is refused');
ok(onNet('sierra').checkAccess(only(['sierra'])).allowed, 'Only these: SS Sierra is let in');
ok(!onNet(null).checkAccess({ accessMode: 'any' }).allowed, 'no connection at all is still refused');
ok(onNet('sierra').checkAccess({ accessMode: 'type', allowedTypes: ['corp'] }).allowed, 'shards keep their type mode');
ok(onNet('citinet').checkAccess({ accessMode: 'both', allowedNetworks: ['citinet'], allowedTypes: ['corp'] }).allowed, 'shards keep their both mode');

const viewer = (svc, state = 'gate') => {
  const app = Object.create(TerminalViewerApp.prototype);
  Object.defineProperty(app, 'networkService', { get: () => svc });
  app._state = state;
  return app;
};
const row = (c, id) => c.networks.find(n => n.id === id);
{
  const c = viewer(onNet('citinet'))._gateContext({ network: only(['sierra', 'vault']) });
  ok(c.requiredNetwork === 'SS Sierra or Vault', 'the gate names every allowed network');
  ok(c.requiredSecured === true, 'secured shows when an allowed network has a login');
  ok(row(c, 'sierra').statusClass === 'valid' && row(c, 'sierra').canClick, 'an allowed network is VALID and clickable');
  ok(row(c, 'vault').statusClass === 'sec' && row(c, 'vault').canClick, 'an allowed secured network can be clicked');
  ok(row(c, 'citinet').statusClass === 'conn' && !row(c, 'citinet').canClick, 'your current network is not a click target');
}
{
  const c = viewer(onNet('citinet'))._gateContext({ network: only(['sierra']) });
  ok(c.requiredSecured === false, 'an open network no longer reads as secured');
  ok(row(c, 'vault').statusClass === 'deny' && !row(c, 'vault').canClick, 'a denied network cannot be clicked');
}
{
  const c = viewer(onNet('citinet'))._gateContext({ network: only([]) });
  ok(c.networks.filter(n => n.id !== 'citinet').every(n => n.statusClass === 'deny'), 'nothing ticked: the gate stops promising VALID');
  ok(c.requiredNetwork === 'an authorized network', 'nothing ticked: a neutral requirement line');
}
{
  const c = viewer(onNet(null))._gateContext({ network: { accessMode: 'any', allowedNetworks: ['sierra'] } });
  ok(c.requiredNetwork === 'any network' && row(c, 'sierra').statusClass === 'valid' && row(c, 'citinet').statusClass === 'valid', 'Any network with no connection: every open network is VALID');
}

// Clicking a card
const realGame = globalThis.game;
const toasts = []; globalThis.ui.notifications.warn = (m) => toasts.push(m);
const clickWith = async (result, stateAfter) => {
  const app = viewer(onNet('citinet'));
  const calls = []; const entered = [];
  globalThis.game = { ...realGame, user: realGame.user, nightcity: { ...realGame.nightcity, connectToNetwork: async (id) => { calls.push(id); return result; } } };
  app._resolveEntryState = () => stateAfter;
  app._enterState = (s) => { entered.push(s); app._state = s; };
  toasts.length = 0;
  await app._onSwitchNetwork({}, { dataset: { networkId: 'sierra' } });
  globalThis.game = realGame;
  return { calls, entered, toasts: [...toasts] };
};
{
  const r = await clickWith({ success: true }, 'login');
  ok(r.calls[0] === 'sierra', 'a click goes through the normal connect path (which opens the login dialog)');
  ok(r.entered[0] === 'login' && !r.toasts.length, 'qualifying moves to the login screen');
  const refused = await clickWith({ success: false, reason: 'auth_failed' }, 'gate');
  ok(!refused.toasts.length && !refused.entered.length, 'a cancelled or failed login stays on the gate without a second message');
  const far = await clickWith({ success: false, reason: 'not_available' }, 'gate');
  ok(/doesn't reach this scene/.test(far.toasts[0]), 'a refused switch says why');
  const dead = await clickWith({ success: false, reason: 'dead_zone' }, 'gate');
  ok(/no signal/.test(dead.toasts[0]), 'a dead zone says why');
}
// The gate lifts by itself, and only the gate
{
  const app = viewer(onNet('sierra'));
  const entered = []; app._enterState = (s) => entered.push(s); app._resolveEntryState = () => 'login';
  app._recheckGate();
  ok(entered[0] === 'login', 'on the gate, qualifying lets them through');
  const inSession = viewer(onNet('citinet'), 'mailbox');
  const moved = []; inSession._enterState = (s) => moved.push(s); inSession._resolveEntryState = () => 'gate';
  inSession._recheckGate();
  ok(!moved.length, 'leaving the network while logged in does not kick anyone');
  const subs = []; const sub = Object.create(TerminalViewerApp.prototype);
  sub.subscribe = (e) => subs.push(e);
  sub._setupEventSubscriptions();
  ok(subs.length === 1 && !!subs[0], 'the viewer listens for network changes');
}

// A terminal saved in 'type' mode (no types can be set on the sheet) follows its ticked networks at once, no re-save
{
  const t = Object.create(TerminalService.prototype);
  t.getConfig = () => ({ network: { required: true, accessMode: 'type', allowedNetworks: ['sierra'] } });
  t.getState = () => ({});
  Object.defineProperty(t, 'networkService', { value: onNet('sierra'), configurable: true });
  ok(t.checkNetworkAccess({}).allowed, 'saved as type: a player on a ticked network gets in');
  Object.defineProperty(t, 'networkService', { value: onNet('citinet'), configurable: true });
  ok(!t.checkNetworkAccess({}).allowed, 'saved as type: a player on any other network is refused');
  t.getConfig = () => ({ network: { required: true, accessMode: 'type', allowedNetworks: [] } });
  ok(!t.checkNetworkAccess({}).allowed, 'saved as type, nothing ticked: still locked (the sheet warns)');
  t.getConfig = () => ({ network: { required: true, accessMode: 'type', allowedTypes: ['public'], allowedNetworks: [] } });
  ok(t.checkNetworkAccess({}).allowed, 'real types set by a macro keep working');
  const c = viewer(onNet('citinet'))._gateContext({ network: { accessMode: 'type', allowedNetworks: ['sierra'] } });
  ok(c.requiredNetwork === 'SS Sierra' && row(c, 'sierra').canClick && row(c, 'pier') === undefined && row(c, 'vault').statusClass === 'deny', 'the gate screen agrees with the check');
}

// The sheet + the template
const cfgHbs = read('templates/terminal/terminal-config.hbs');
const cfgJs = read('scripts/ui/Terminal/TerminalConfigApp.js');
ok(!/signalThreshold/.test(cfgHbs) && !/signalThreshold/.test(cfgJs), 'the dead signal threshold is gone from the terminal sheet');
ok(/Only these networks/.test(cfgJs) && !/\['any', 'whitelist', 'type'\]/.test(cfgJs), 'the sheet offers Any / Only these, not the type mode it cannot configure');
ok(/data-reach-list/.test(cfgHbs) && /data-reach-note/.test(cfgHbs) && /_wireReachability\(el\)/.test(cfgJs), 'the list hides under Any and an empty one warns');
ok(/does not log them out/.test(cfgHbs), 'the sheet says it is only checked on opening');
ok(/\(t => Number\.isNaN\(t\) \? 40 : t\)\(parseInt\(val\('signalThreshold'\), 10\)\)/.test(read('scripts/ui/ItemInbox/ItemInboxConfig.js')), 'a shard threshold of 0 stays 0');
ok(/\{\{#if canClick\}\}data-action="terminalSwitchNetwork"/.test(read('templates/terminal/terminal-network-gate.hbs')), 'a dead card carries no action');

// ═══ 7. A network-gated account warns when it would vanish for every player ═══
{
  const { TerminalConfigApp } = await imp('scripts/ui/Terminal/TerminalConfigApp.js');
  const app = Object.create(TerminalConfigApp.prototype);
  Object.defineProperty(app, 'networkService', { get: () => ({ getNetwork: (id) => NETS2.find(n => n.id === id) }) });
  const form = (gated, allowed, ifaces) => {
    const note = { textContent: '', hidden: true };
    const boxes = (vals) => vals.map(value => ({ value }));
    return { note, querySelector: (s) => s === '[data-acct-net-note]' ? note : s === '[name="acctNetRestricted"]' ? { checked: gated } : null,
      querySelectorAll: (s) => s === '[name="acctNetAllowed"]:checked' ? boxes(allowed) : s === '[name="uplinkIface"]:checked' ? boxes(ifaces) : [] };
  };
  const noteFor = (...a) => { const f = form(...a); app._syncAcctNetNote(f); return f.note; };
  ok(noteFor(false, ['sierra'], []).hidden, 'not gated: no warning');
  ok(/No network is ticked/.test(noteFor(true, [], ['sierra']).textContent), 'gated with nothing ticked warns');
  ok(/no SS Sierra connection, so players can never see/.test(noteFor(true, ['sierra'], ['citinet']).textContent), 'gated to a network the terminal lacks warns');
  ok(/no SS Sierra connection, so the account only shows on the others/.test(noteFor(true, ['sierra', 'citinet'], ['citinet']).textContent), 'one reachable network of two: says it still shows on the others');
  ok(noteFor(true, ['sierra'], ['sierra']).hidden, 'gated to a connected network: no warning');
  ok(/data-acct-net-note/.test(read('templates/terminal/partials/config-account.hbs')), 'the warning line is in the account editor');
  const js = read('scripts/ui/Terminal/TerminalConfigApp.js');
  ok(/\[name="acctNetAllowed"\], \[name="uplinkIface"\]/.test(js), 'it updates as networks and uplinks are ticked');
}

console.log(`test-terminal-net-gate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
