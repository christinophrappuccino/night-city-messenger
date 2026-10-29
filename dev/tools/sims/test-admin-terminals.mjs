// Sim: Admin → TERMINALS redesign (2026-10-27, mock dev/mockups/admin-terminals-redesign-mock.html)
// + the rack / information detail (2026-10-28, mock admin-terminals-rack-modules-mock.html, Version A).
// Drives the REAL TerminalsTab over mocked Foundry globals: gathering (pins,
// lockouts, plants, heat, countdowns, accounts with portraits + last login),
// filters / grouping / search / sort / fold / select mode / openTo, every
// data-op the template uses is handled, every term2 key the template reads is
// produced, every class the template uses is styled, and a REAL Handlebars render.
// Run: node dev/tools/sims/test-admin-terminals.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const MOD = 'night-city-messenger';

// ── Mock Foundry ──
class Coll extends Map {
  constructor(arr = []) { super(arr.map((d) => [d.id, d])); }
  filter(fn) { return [...this.values()].filter(fn); }
  find(fn) { return [...this.values()].find(fn); }
  [Symbol.iterator]() { return this.values(); }
  get contents() { return [...this.values()]; }
}
const NOW = Date.parse('2045-08-14T21:00:00Z');
const iso = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
const actors = new Coll([
  { id: 'aV', name: 'V', img: 'v.png' }, { id: 'aR', name: 'Rache', img: 'r.png' }, { id: 'aH', name: 'Hiro', img: 'h.png' },
]);
const mkItem = (id, name, folder, parent = null) => ({ id, uuid: parent ? `Actor.${parent.id}.Item.${id}` : `Item.${id}`, name, img: `${id}.png`, folder: folder ? { name: folder } : null, parent });
const items = {
  ws: mkItem('ws', 'WS-7F-12', 'Arasaka'),
  lobby: mkItem('lobby', 'Lobby kiosk', 'Arasaka'),
  bbs: mkItem('bbs', 'Afterlife BBS', 'Watson'),
  rig: mkItem('rig', 'Nomad rig', null, actors.get('aV')),
};
const cfgs = {
  ws: {
    terminalName: 'WS-7F-12', metadata: { org: 'Arasaka', location: 'Arasaka Tower', classification: 'SECRET' },
    theme: { preset: 'arasaka-workstation' }, loginStyle: 'cards', mailboxStyle: 'tabs', soundSet: 'corp-chime',
    network: { required: true, allowedNetworks: ['corp'] },
    accounts: [
      { id: 'a1', username: 'v_arasaka', displayName: 'Veronica Ames', role: 'Analyst', masterContactId: 'c1', security: { requiresAuth: true, allowPassword: true } },
      { id: 'a2', username: 'h.tanaka', displayName: 'Hiro Tanaka', actorId: 'aH', security: { requiresAuth: true, allowPassword: true, allowKeyItem: true, keyItemName: 'Arasaka keycard', authLogic: 'all' }, network: { restricted: true, allowedNetworks: ['corp'] } },
      { id: 'a3', username: 'root', displayName: 'sysadmin', isAdmin: true, security: { requiresAuth: true, allowPassword: true, allowSkillCheck: true, bypassSkills: ['Cryptography'], bypassDC: 20 } },
      { id: 'a4', username: 'guest', hidden: true, security: { requiresAuth: false } },
    ],
  },
  lobby: { metadata: { org: 'Arasaka', location: 'Arasaka Tower' }, theme: { preset: 'classic' }, accounts: [{ id: 'k', username: 'kiosk', security: { requiresAuth: false } }] },
  bbs: { metadata: { location: 'The Afterlife' }, theme: { preset: 'streetkid-bbs' }, allowExfil: false, accounts: [{ id: 'b', username: 'sysop', security: { requiresAuth: true, allowPassword: true } }] },
  rig: { metadata: {}, accounts: [] },
};
const states = {
  ws: { sessions: { aR: { activeAccountId: 'a3' }, aV: { activeAccountId: 'a1' } }, loginLog: [
    { ts: iso(300), accountId: 'a3', username: 'root', operatorId: 'aR', operatorName: 'Rache' },
    { ts: iso(80), accountId: 'a1', username: 'v_arasaka', operatorId: 'aV', operatorName: 'V' },
    { ts: iso(55), accountId: 'a3', username: 'root', operatorId: 'aR', operatorName: 'Rache' },
  ], residents: [{ id: 'r1', state: 'armed', effectType: 'keylog', trigger: { kind: 'onLogin', accountId: 'a1' }, provenance: { plantedBy: 'aR' } }, { id: 'r2', state: 'fired' }] },
  lobby: { sessions: {} },
  bbs: { sessions: {}, gmBypassed: true },
  rig: { sessions: {} },
};
const calls = [];
const traceLog = [
  { ts: iso(30), actorId: 'aH', action: 'net-auth', targetNetworkId: 'ws::a3', outcome: 'failed' },
  { ts: iso(10), actorId: 'aH', action: 'terminal-login', objectId: 'ws', objectName: 'WS-7F-12 · Veronica Ames', outcome: 'failed' },
  { ts: iso(9), actorId: 'aH', action: 'terminal-login', objectId: 'ws', objectName: 'WS-7F-12 · Veronica Ames', outcome: 'failed' },
  { ts: iso(8), actorId: 'aH', action: 'terminal-login', objectId: 'ws', objectName: 'WS-7F-12 · Veronica Ames', outcome: 'failed' },
  { ts: iso(200), actorId: 'aR', action: 'net-hack', targetNetworkId: 'ws::a1', outcome: 'failed' },
  { ts: iso(199), actorId: 'aR', action: 'net-hack', targetNetworkId: 'ws::a1', outcome: 'failed' },
  { ts: iso(198), actorId: 'aR', action: 'net-hack', targetNetworkId: 'ws::a1', outcome: 'failed' },
];
const terminalService = {
  collectTerminals: () => Object.values(items),
  getConfig: (it) => cfgs[it.id],
  getState: (it) => states[it.id],
  getUplink: (it) => ({ network: it.id === 'ws' ? { name: 'Arasaka CorpNet' } : null }),
  getResidents: (it) => states[it.id].residents || [],
  getLoginLog: (it) => states[it.id].loginLog || [],
  getLastLogin(it, acctId) { const l = this.getLoginLog(it); for (let i = l.length - 1; i >= 0; i--) if (l[i].accountId === acctId) return l[i]; return null; },
  getExfilPolicy: (it) => {
    const master = cfgs[it.id].allowExfil !== false;
    return { master, agent: { allow: master, require: false }, shard: { allow: master, require: true, dv: 15 }, forward: { allow: false }, leak: { allow: false }, sell: { allow: false }, wipe: { allow: false } };
  },
  relock: async (it) => calls.push(['relock', it.id]),
  updateResident: async (it, id, patch) => calls.push(['defuse', it.id, id, patch.state]),
  getAccountMessages: (it, acct, opts) => (it.id === 'ws' && acct === 'a1' && opts?.enforceGates === false
    ? [{ envelope: 'mail', status: { read: false } }, { envelope: 'mail', status: { read: true } }, { envelope: 'file', status: {} }, { envelope: 'mail', status: { deleted: true } }]
    : []),
  logout: async (it, actorId, full) => calls.push(['logout', it.id, actorId, full]),
  // a2 is gated to CorpNet's TYPE-less id 'corp'; the uplink in this mock reaches nothing gated
  uplinkReaches: (it, nv) => !nv?.restricted,
  forceUnlock: async (it) => calls.push(['unlock', it.id]),
  removeTerminal: async (it) => calls.push(['remove', it.id]),
};
const secStates = new Map([
  ['aV::ws::a3', { actorId: 'aV', targetId: 'ws::a3', lockoutUntil: NOW + 42 * 60000 }],
  ['aV::lobby::k', { actorId: 'aV', targetId: 'lobby::k', lockoutUntil: NOW - 1000 }],
]);
globalThis.game = {
  user: { isGM: true, id: 'gm' },
  users: [
    { id: 'gm', isGM: true, name: 'GM' },
    { id: 'u1', isGM: false, name: 'Pat', character: actors.get('aV') },
    { id: 'u2', isGM: false, name: 'Sam', character: actors.get('aR') },
    { id: 'u3', isGM: false, name: 'Kim', character: actors.get('aH') },
  ],
  items: new Coll([items.ws, items.lobby, items.bbs]),
  actors,
  scenes: Object.assign(new Coll([
    { id: 's7', name: 'Arasaka Tower — 7th Floor', folder: { name: 'Arasaka' }, notes: [{ flags: { [MOD]: { terminalItemId: 'ws' } } }] },
    { id: 'sA', name: 'The Afterlife', folder: null, notes: [{ flags: { [MOD]: { terminalItemId: 'bbs' } } }, { flags: {} }] },
  ]), {}),
  nightcity: {
    terminalService,
    timeService: { getCurrentTimeMs: () => NOW },
    securityService: {
      _states: secStates, _remote: new Map(),
      getLockoutRemaining: (a, t) => Math.max(0, (secStates.get(`${a}::${t}`)?.lockoutUntil || 0) - NOW),
      getKnownState(a, t) {
        const s = secStates.get(`${a}::${t}`);
        if (!s || !(s.lockoutUntil > NOW)) return null;
        return { attempts: 3, maxAttempts: 3, lockoutUntil: s.lockoutUntil, lockoutRemaining: s.lockoutUntil - NOW, forced: !!s.forced, reason: s.reason || '' };
      },
      clearFor: (a, t) => calls.push(['clearFor', a, t]),
      kickSession: (a, t, m) => calls.push(['kick', a, t, m]),
    },
    traceService: Object.assign({
      getHeatMap: () => ({ ws: { aR: { value: 72 }, aV: { value: 10 } } }),
      getHeat: (o, a) => ({ ws: { aR: 72, aV: 10 } })[o]?.[a] || 0,
      getCountdowns: () => [{ id: 'cd1', objectId: 'ws', actorId: 'aR', source: 'Arasaka', expiresAt: NOW + 9 * 60000 }],
      // The Security log: Hiro missed root once (dialog → lockout key), missed
      // Veronica's account three times (terminal console → "<terminal> · <name>");
      // Rache burned Veronica's account long ago (that lockout has expired).
      getLog: () => traceLog,
      _payload: (o) => ({ ts: new Date(NOW).toISOString(), actorId: o.actor?.id || null, action: o.action, objectId: o.objectId, objectName: o.objectName, targetNetworkId: o.targetNetworkId, outcome: o.outcome }),
      recordTrace: async (row) => { traceLog.push(row); calls.push(['trace', row.action, row.targetNetworkId]); },
    }, {}),
    portraitService: { resolvePortrait: (c) => c.portrait || (c.actorId ? actors.get(c.actorId)?.img : null) || null },
    masterContactService: { getContact: (id) => (id === 'c1' ? { id: 'c1', portrait: 'veronica.png' } : null) },
    networkService: { getNetwork: (id) => (id === 'corp' ? { name: 'CorpNet' } : id === 'milnet' ? { name: 'MilNet' } : null) },
    playerNetworks: new Map([['u2', { networkId: 'milnet' }], ['u1', { networkId: 'corp' }]]),
    terminalScenePins: { placeAtViewCenter: async (it) => calls.push(['place', it.id]) },
    openTerminal: (it) => calls.push(['openTerm', it.id]),
  },
};
game.scenes.viewed = game.scenes.get('s7');
game.nightcity.traceService.constructor = { tierOf: (v) => (v >= 80 ? 'burned' : v >= 50 ? 'hot' : 'warm') };
globalThis.foundry = { utils: { debounce: (fn) => fn, deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
globalThis.ui = { notifications: { info: () => {}, warn: (m) => calls.push(['warn', m]), error: () => {} } };
globalThis.Hooks = { on() {}, once() {}, off() {} };

const { TerminalsTab } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/TerminalsTab.js`).href);
let renders = 0;
const app = { id: 'ncm-admin', isPopout: false, element: null, render: () => { renders++; }, _activeTab: 'terminals' };
const tab = new TerminalsTab(app);
const ctx = () => tab.prepareContext().term2;

// ═══ 1. Gathering ═══
let c = ctx();
ok(c.total === 4 && c.accounts === 6 && c.logins === 2, 'header counts');
ok(c.sel?.id === 'lobby', 'first row shown is selected by default (Arasaka Tower group, A→Z)');
tab._selectedId = 'ws'; c = ctx();
const ws = c.sel;
ok(ws.pinLabel === 'Arasaka Tower — 7th Floor' && ws.pinSceneIds[0] === 's7', 'scene pin found from scene notes');
ok(ws.now.some((n) => n.cls === 'on' && n.label === 'Rache → root') && ws.now.some((n) => n.label === 'V → v_arasaka'), 'right now: sessions');
ok(ws.now.some((n) => n.cls === 'lock' && /V locked out of root · 42 min/.test(n.label)), 'right now: live lockout');
ok(ws.now.some((n) => n.cls === 'plant' && n.label === '1 armed plant'), 'right now: armed plants only');
ok(ws.now.some((n) => n.cls === 'hot' && n.label === 'Rache 72 HOT') && !ws.now.some((n) => /V 10/.test(n.label)), 'right now: warm+ heat only');
ok(ws.now.some((n) => /Arasaka closing in on Rache/.test(n.label)), 'right now: countdown');
ok(ws.attention === true, 'ws needs you');
ok(ws.uplinkName === 'Arasaka CorpNet' && ws.networkBinding === 'CorpNet', 'uplink + reach (network name, not id)');
ok(ws.exfil === 'To Agent, Burn (DV 15)', 'exfil summary lists allowed actions + gates');
ok(ws.presetLabel === 'Arasaka Workstation' && ws.loginLabel === 'Badge Cards' && ws.mailboxLabel === 'Tabs' && ws.mailboxStyle === 'tabs', 'setup labels');
const [a1, a2, a3, a4] = ws.accounts;
ok(a1.portrait === 'veronica.png' && a1.link === 'contact' && a1.isOnline && a1.onlineBy === 'V', 'account 1: contact portrait, online');
ok(a2.portrait === 'h.png' && a2.link === 'character', 'account 2: character portrait');
ok(a2.how[0].label === 'All of' && a2.how.some((h) => h.label === 'Arasaka keycard') && a2.netGated && a2.netLabel === 'CorpNet', 'account 2: all-of, key item, gated');
ok(!a3.portrait && a3.machineIcon === 'fa-server' && a3.isAdmin && a3.how.some((h) => h.label === 'Cryptography DV 20'), 'account 3: machine icon, skill DV');
ok(a3.lastAgo === '55 min ago' && /Rache/.test(a3.lastFull), 'account 3: Last login from the footprint log (game clock)');
ok(a4.isOpen && a4.hidden && a4.lastAgo === '' && a4.machineIcon === 'fa-user', 'account 4: open, hidden, never');
ok(ws.recentLogins.length === 3 && ws.recentLogins[0].operator === 'Rache' && ws.recentLogins[0].when === '55 min ago', 'recent logins newest first');
const bbs = tab._gather().find((t) => t.id === 'bbs');
ok(bbs.gmBypassed && bbs.attention && bbs.now.some((n) => n.cls === 'unl') && bbs.exfil === 'Read-only', 'GM-unlocked counts as needs-you; exfil off = read-only');
const lobby = tab._gather().find((t) => t.id === 'lobby');
ok(!lobby.attention && !lobby.now.length, 'expired lockout ignored, nothing on lobby');
const rig = tab._gather().find((t) => t.id === 'rig');
ok(rig.folder === 'Carried by V' && rig.scope === 'V', 'carried terminal: folder + scope');

// ═══ 2. Filters / grouping / search / sort ═══
const f = Object.fromEntries(c.filters.map((x) => [x.key, x.count]));
ok(f.all === 4 && f.online === 1 && f.attention === 2 && f.locked === 1 && f.here === 1 && f.unplaced === 2, 'filter counts');
ok(c.groups.map((g) => g.label).join('|') === 'Arasaka Tower|The Afterlife|No location', 'location groups, "No …" sinks');
tab.onAct('filter', null, { closest: () => ({ dataset: { filter: 'unplaced' } }) });
c = ctx();
ok(c.shown === 2 && c.groups.flatMap((g) => g.rows).every((r) => ['lobby', 'rig'].includes(r.id)), 'Not pinned filter');
ok(c.sel.id === 'lobby', 'selection follows the filter');
tab._filter = 'here'; c = ctx();
ok(c.shown === 1 && c.sel.id === 'ws', 'This scene filter (viewed scene)');
tab._filter = 'all'; tab._group = 'folder'; c = ctx();
ok(c.groups.map((g) => g.label).join('|') === 'Arasaka|Watson|Carried by V', 'folder grouping; carried sinks');
tab._group = 'scene'; c = ctx();
ok(c.groups.at(-1).label === 'Not pinned' && c.groups.at(-1).count === 2, 'scene grouping');
tab._group = 'location'; tab._search = 'tanaka'; c = ctx();
ok(c.shown === 1 && c.sel.id === 'ws', 'search matches account display names');
tab._search = ''; tab._sort = 'attention'; c = ctx();
ok(c.groups[0].rows[0].id === 'ws', 'sort: needs-you first inside a group');
tab._sort = 'name';
// ── Default folds (dev-approved rule): first group open, rest closed; selection's group forced open;
//    search / non-All filter opens all; GM choices last for the session; a closed head summarises.
{
  const grp = (k) => tab.onAct('group', null, { closest: () => ({ dataset: { groupKey: k } }) });
  const G = (cx, k) => cx.groups.find((g) => g.key === k);
  tab._selectedId = 'lobby'; c = ctx();
  ok(!G(c, 'Arasaka Tower').shut && G(c, 'The Afterlife').shut && G(c, 'No location').shut, 'default: only the first group is open');
  ok(G(c, 'The Afterlife').rows.length === 0 && G(c, 'The Afterlife').count === 1, 'a closed group keeps its count, no rows');
  ok(!G(c, 'Arasaka Tower').shut && G(c, 'Arasaka Tower').forced === '', 'the first group holds the selection → open, but not forced (the GM can fold it)');
  const aft = G(c, 'The Afterlife').head;
  ok(aft && aft.chips.length > 0 && aft.chips.every((x) => x.tip && x.count > 0), 'closed head carries a light summary');
  ok(G(c, 'Arasaka Tower').head === null, 'an open group carries no head summary');
  grp('Arasaka Tower');
  ok(ctx().groups[0].shut, 'the GM can fold the group holding the selection, and it stays folded (no spring-back)');
  grp('Arasaka Tower');
  ok(!ctx().groups[0].shut, '…and open it again');
  grp('The Afterlife'); c = ctx();
  ok(!G(c, 'The Afterlife').shut && G(c, 'The Afterlife').rows.length === 1, 'GM opens a closed group');
  grp('The Afterlife');
  ok(G(ctx(), 'The Afterlife').shut, 'GM closes it again');
  tab._selectedId = 'bbs'; c = ctx();
  ok(!G(c, 'The Afterlife').shut, 'selecting into a closed group opens it (once — the GM can fold it after)');
  ok(!G(c, 'Arasaka Tower').shut, 'the first group stays open by default after the selection moves');
  grp('Arasaka Tower');
  ok(G(ctx(), 'Arasaka Tower').shut, 'once the selection left, the GM can fold the first group');
  tab._search = 'a'; c = ctx();
  ok(c.groups.every((g) => !g.shut && (g.forced === 'search')), 'a search opens every group');
  tab._search = ''; tab._filter = 'online'; c = ctx();
  ok(c.groups.every((g) => !g.shut), 'a non-All filter opens every group');
  tab._filter = 'all'; tab._selectedId = 'bbs'; c = ctx();
  ok(G(c, 'Arasaka Tower').shut, 'clearing the search/filter restores the GM fold choice');
  // Session memory: a fresh tab on the same window id reads the same choices.
  const tab2 = new TerminalsTab(app); tab2._selectedId = 'bbs';
  ok(tab2.prepareContext().term2.groups.find((g) => g.key === 'Arasaka Tower').shut, 'fold choices persist for the session (same window, new tab instance)');
  const pop = new TerminalsTab({ ...app, id: 'ncm-admin-pop-terminals' }); pop._selectedId = 'bbs';
  ok(!pop.prepareContext().term2.groups.find((g) => g.key === 'Arasaka Tower').shut, 'a pop-out window keeps its own fold memory');
  // Grouping memory is per grouping; "No groups" = one open group.
  tab._group = 'none'; c = ctx();
  ok(c.groups.length === 1 && !c.groups[0].shut && c.groups[0].rows.length === 4, '"No groups": one group, open, every unit');
  tab._group = 'location';
  grp('Arasaka Tower'); tab._selectedId = 'ws';
}

// ═══ 3. Select mode + bulk ═══
tab.onAct('bulk');
const pick = (id) => tab.onAct('select', null, { closest: () => ({ dataset: { itemId: id } }) });
pick('ws'); pick('bbs'); pick('bbs'); pick('lobby');
c = ctx();
ok(c.bulk && c.pickedCount === 2 && c.groups[0].rows.find((r) => r.id === 'ws').picked, 'bulk ticks toggle');
const picked = tab._items(tab._picked).map((i) => i.id).sort().join();
ok(picked === 'lobby,ws', 'bulk resolves picked items');
calls.length = 0;
tab._download = (p, n) => calls.push(['download', n, p]);
tab.onAct('bulkExport');
const dl = calls.find((x) => x[0] === 'download');
ok(dl && dl[2].ncmTerminals === 1 && dl[2].terminals.length === 2 && dl[2].terminals.every((t) => t.ncmTerminal === 1 && t.config), 'bulk export writes one envelope of per-terminal envelopes');
tab.onAct('bulk');
ok(!tab._bulk && tab._picked.size === 0, 'Done leaves select mode and clears picks');
calls.length = 0; tab.onAct('bulkExport');
ok(calls.some((x) => x[0] === 'warn'), 'bulk with nothing ticked warns');

// ═══ 4. Single actions route ═══
calls.length = 0;
tab.onAct('open', null, { dataset: { itemId: 'ws' } });
await tab.onAct('unlock', null, { dataset: { itemId: 'lobby' } });
await tab.onAct('place', null, { dataset: { itemId: 'ws' } });
ok(calls.some((x) => x[0] === 'openTerm' && x[1] === 'ws') && calls.some((x) => x[0] === 'unlock' && x[1] === 'lobby') && calls.some((x) => x[0] === 'place' && x[1] === 'ws'), 'open / force-unlock / place route to the services');
tab._menuOpen = false; tab.onAct('more');
ok(tab._menuOpen === true, '⋯ toggles the menu');
tab._closeMenu(false);
ok(tab._menuOpen === false, 'menu closes');

// ═══ 5. openTo ═══
tab._filter = 'online'; tab._search = 'zzz'; tab._fold.set('The Afterlife', false);
tab.openTo('Item.bbs');
c = ctx();
ok(c.sel.id === 'bbs' && tab._filter === 'all' && !tab._search && !c.groups.find((g) => g.key === 'The Afterlife').shut && tab._scrollToSel, 'openTo(uuid or id) clears filters, selects, and forces its group open');

// ═══ 6b. The information detail (mock admin-terminals-rack-modules-mock.html, Version A) ═══
{
  tab._selectedId = 'ws'; tab._filter = 'all'; tab._search = '';
  tab._acctOpen.clear();
  let sel = ctx().sel;
  const acc = (id) => sel.accounts.find((a) => a.id === id);
  // Rack unit fields (every terminal pays for these; they're cheap)
  const wsRow = ctx().groups.flatMap((g) => g.rows).find((r) => r.id === 'ws');
  ok(wsRow.leds.length === 4 && wsRow.leds.map((l) => l.cls).join() === 'good,bad,attn,', 'rack unit: four lights — someone in, someone locked out, a plant armed, not every account locked (guest is open)');
  ok(wsRow.heatBars.length === 8 && wsRow.heatBars.filter((b) => b.on).length === 6 && wsRow.heatTone === 'hot' && wsRow.maxHeat === 72, 'rack unit: 8-segment heat bar from the hottest operator (72 → 6 lit, hot)');
  ok(wsRow.traceTag === '9:00' && /Arasaka/.test(wsRow.traceTip), 'rack unit: red trace timer when a countdown runs');
  ok(wsRow.place === 'Arasaka Tower' && wsRow.acctLabel === '4 accounts' && wsRow.accountCount === 4 && wsRow.placeReal === true && wsRow.placeIcon === 'fa-location-dot' && wsRow.hasImg && wsRow.icon === 'fas fa-building', 'rack unit: location · N accounts, the item art (preset glyph as fallback)');
  tab._fold.set('The Afterlife', true); const bbsRow = ctx().groups.flatMap((g) => g.rows).find((r) => r.id === 'bbs');
  ok(bbsRow.leds[3].cls === '' && !bbsRow.traceTag, 'a GM-unlocked box does not wear the all-locked light');
  const lobbyU = tab._gather().find((t) => t.id === 'lobby');
  ok(!lobbyU.allSecured && lobbyU.leds.every((l) => !l.cls), 'a quiet machine: all lights dark');
  ok(ctx().legend.in === 1 && ctx().legend.armed === 1, 'the legend counts machines per light');

  // Header status line
  ok(sel.statusParts.map((p) => p.text).join(' · ') === '2 in · 2 locked out · plant armed · trace 9m · heat 72', 'header status line in words (V on root live, Hiro on v_arasaka from the Security log)');
  ok(sel.whereText === 'Arasaka Tower · Arasaka', 'header: location · organisation');

  // Right now
  const nr = (kind) => sel.nowRows.filter((r) => r.kind === kind);
  ok(nr('in').length === 2 && nr('in').some((r) => r.main === 'Rache' && r.acct === 'root' && r.time === '55m' && r.unit === 'in'), 'right now: sessions with how long they have been in');
  ok(nr('in').every((r) => r.btns[0].op === 'acctLogout' && r.btns[0].attrs['actor-id'] && r.btns[0].attrs['account-id'] && r.btns[0].attrs['item-id'] === 'ws'), 'right now: sessions → Log out with actor/account/item');
  const vLock = nr('lock').find((r) => r.main === 'V');
  ok(vLock && vLock.acct === 'root' && vLock.time === '42m' && vLock.unit === 'left' && vLock.lockUntil === NOW + 42 * 60000 && vLock.btns[0].op === 'acctClear', 'right now: a live lockout with time left → Clear');
  ok(nr('plant').length === 1 && nr('plant')[0].btns[0].op === 'defuse' && nr('plant')[0].btns[0].attrs['resident-id'] === 'r1' && nr('plant')[0].main === 'Keylogger' && /by Rache/.test(nr('plant')[0].post) && nr('plant')[0].l2 === 'fires next login' && nr('plant')[0].acct === 'v_arasaka', 'right now: armed plant — what, on which account, by whom, when it fires → Defuse');
  ok(nr('trace').length === 1 && nr('trace')[0].time === '9m' && nr('trace')[0].btns[0].op === 'callOff' && nr('trace')[0].btns[0].attrs['countdown-id'] === 'cd1', 'right now: trace countdown → Call off (Security tab handler)');
  const heatR = nr('heat');
  ok(heatR.length === 1 && heatR[0].num === 72 && heatR[0].meter.length === 10 && heatR[0].meter.filter((b) => b.on).length === 7 && /Hot · Rache/.test(heatR[0].post), 'right now: heat ≥ 25 only, 10-segment meter + tier word');
  ok(heatR[0].btns.map((b) => b.op).join() === 'heatClear,escalate' && heatR[0].btns[1].attrs['object-id'] === 'ws' && heatR[0].btns[1].attrs['actor-name'] === 'Rache', 'heat → Clear / Escalate with the Security tab\'s data attributes');
  const quiet = tab._gather().find((t) => t.id === 'lobby'); tab._buildDetail(quiet);
  ok(quiet.nowRows.length === 0 && quiet.statusParts.length === 0, 'a quiet machine: nothing in Right now, "Quiet" header');

  // Accounts table
  ok(sel.accounts.every((a) => a.open === false), 'every account starts folded (none opens by default)');
  ok(acc('a1').portrait === 'veronica.png' && acc('a1').avText === '' && acc('a3').avText && !acc('a3').portrait, 'accounts table: the portrait leads, initials when there is none');
  ok(acc('a1').status.cls === 'good' && acc('a1').status.text === 'V in', 'status: who is in');
  ok(acc('a2').status.cls === 'quiet' && acc('a4').lock.open, 'status: quiet; an open account reads open');
  ok(acc('a3').lock.parts.map((p) => p.t + (p.dv ? ` DV ${p.dv}` : '') + (p.conj ? ` ${p.conj}` : '')).join(' ') === 'password or Cryptography DV 20', 'lock in words (short)');
  ok(acc('a2').lockFull.parts.map((p) => p.t).join('|') === 'password|Arasaka keycard' && acc('a2').lockFull.parts[0].conj === '+', 'ALL logic joins with +');
  ok(acc('a1').owner?.name === 'Veronica Ames' && acc('a2').owner?.name === 'Hiro' && acc('a3').owner === null, 'belongs to: the linked contact / character, or none');
  ok(acc('a1').mail.count === 2 && acc('a1').mail.unread === 1 && acc('a1').mail.files === 1, 'mailbox: messages · unread · files (deleted mail skipped)');
  ok(acc('a3').rule.max === 3 && acc('a3').rule.lockout === '1h' && acc('a3').rule.used === 3 && acc('a4').rule === null, 'lockout rule: tries → lockout · used');
  ok(acc('a3').resetIds.split(',').sort().join() === 'aH,aV', 'reset tries covers every character with tries used or locked out');
  ok(acc('a1').lastWho === 'V' && acc('a1').lastWhen === '1h' && acc('a4').lastWhen === '', 'last login: who + when, or never');
  const l1 = acc('a1').logins;
  ok(l1.length === 3 && l1[0].name === 'Hiro' && l1[0].player === 'Kim' && l1[0].result === 'locked out' && l1[1].result === 'failed' && !l1[0].ok, 'logins here: last 3, newest first, the try that hit the limit reads "locked out", character (player)');
  ok(sel.recent.length === 6 && sel.recent[0].name === 'Hiro' && sel.recent.some((r) => r.name === 'Rache' && r.player === 'Sam' && r.ok && r.account === 'root'), 'recent logins: last 6 — character, player, account, result');
  ok(!sel.recent.some((r) => 'method' in r || 'how' in r), 'recent logins never claim a method');
  ok(/last 6 of/.test(sel.recentHint), 'recent logins: "last 6 of N" when there are more');
  // with V logged out of a1, Hiro's console lockout shows in the status cell
  const savedSess = states.ws.sessions; states.ws.sessions = { aR: { activeAccountId: 'a3' } };
  sel = ctx().sel;
  ok(acc('a1').status.cls === 'bad' && /Hiro out/.test(acc('a1').status.text) && /m$/.test(acc('a1').status.left) && acc('a1').status.lockUntil, 'status: who is locked out + time left (from the Security log)');
  states.ws.sessions = savedSess; sel = ctx().sel;
  ok(acc('a3').status.cls === 'good', 'someone in beats everything else in the status cell');
  ok(tab._gather().find((t) => t.id === 'ws').accounts.every((a) => a.status === undefined), 'unselected terminals do not build the detail');
  // the open state is kept per account across renders
  tab._acctOpen.set('ws:a2', true); tab._acctOpen.set('ws:a1', false);
  sel = ctx().sel;
  ok(acc('a2').open && !acc('a1').open, 'expanded rows survive a re-render (per account)');

  // ops route
  const btn = (acct, actorId) => ({ dataset: { actorId }, closest: (s) => (s === '[data-actor-id]' ? { dataset: { actorId } } : s.includes('account') ? { dataset: { accountId: acct } } : s.includes('resident') ? { dataset: { residentId: 'r1' } } : { dataset: { itemId: 'ws' } }) });
  calls.length = 0;
  await tab.onAct('acctLogout', null, btn('a1', 'aV'));
  ok(calls.some((x) => x[0] === 'logout' && x[1] === 'ws' && x[2] === 'aV' && x[3] === true), 'Log out ends the stored session');
  ok(calls.some((x) => x[0] === 'kick' && x[1] === 'aV' && x[2][0] === 'ws::a1'), 'Log out bounces the open viewer (kickSession)');
  calls.length = 0;
  await tab.onAct('acctClear', null, btn('a3', 'aV'));
  ok(calls.some((x) => x[0] === 'clearFor' && x[1] === 'aV' && x[2][0] === 'ws::a3'), 'Clear lockout clears on every client (clearFor)');
  ok(calls.some((x) => x[0] === 'trace' && x[1] === 'lockout-clear' && x[2] === 'ws::a3'), 'Clear writes a lockout-clear row to the Security log');
  calls.length = 0;
  await tab.onAct('acctReset', null, btn('a3', 'aH'));
  ok(calls.some((x) => x[0] === 'clearFor' && x[1] === 'aH'), 'Reset tries (one character) routes to the same clear');
  ok(!ctx().sel.accounts.find((a) => a.id === 'a3').resetIds.includes('aH'), "after the clear row, Hiro's earlier miss no longer counts");
  calls.length = 0;
  const multi = { dataset: { actorIds: 'aV,aH', accountId: 'a3', itemId: 'ws' }, closest: (s) => (s.includes('actor-ids') ? multi : s.includes('account') ? multi : { dataset: { itemId: 'ws' } }) };
  await tab.onAct('acctResetAll', null, multi);
  ok(calls.filter((x) => x[0] === 'clearFor').map((x) => x[1]).sort().join() === 'aH,aV' && calls.filter((x) => x[0] === 'trace').length === 2, 'Reset tries on an account clears every listed character');
  calls.length = 0;
  await tab.onAct('defuse', null, btn('a1', 'aV'));
  ok(calls.some((x) => x[0] === 'defuse' && x[1] === 'ws' && x[2] === 'r1'), 'Defuse writes the resident state (works for carried terminals too)');
  const secCalls = [];
  app.tabs = { security: { onHeatClear: (e, t) => secCalls.push(['heatClear', t]), onEscalate: (e, t) => secCalls.push(['escalate', t]), onCountdownCancel: (e, t) => secCalls.push(['callOff', t]) } };
  tab.onAct('heatClear', null, 'T1'); tab.onAct('escalate', null, 'T2'); tab.onAct('callOff', null, 'T3');
  ok(secCalls.map((c) => c[0] + c[1]).join() === 'heatClearT1,escalateT2,callOffT3', 'heat Clear / Escalate / trace Call off reuse the Security tab handlers');
  delete app.tabs;
  let opened = null;
  tab.onEditLock = async (e, t) => { opened = t?.closest?.('[data-account-id]')?.dataset?.accountId; };
  await tab.onAct('editLock', null, btn('a2', 'aV'));
  ok(opened === 'a2', 'edit the lock routes with the account');
  delete tab.onEditLock;
  const js_ = read('scripts/ui/AdminPanel/tabs/TerminalsTab.js');
  ok(/_activeTab !== 'terminals'/.test(js_) && /_stopLiveClock\(\)/.test(js_.slice(js_.indexOf('onClose() {'))), 'countdown interval stops off-tab and on close');
  ok(/\[data-acct-row\]/.test(js_) && /this\._acctOpen\.set\(key, open\)/.test(js_), 'row expand is a DOM-only toggle that remembers the account');
}

// ═══ 6d. Toolbar: no summary header, Pop out beside Import, ONE View menu (Group by · Sort) ═══
{
  const tpl_ = read('templates/admin-panel/tab-terminals.hbs');
  const js_ = read('scripts/ui/AdminPanel/tabs/TerminalsTab.js');
  ok(!/ncm-term2-hd\b/.test(tpl_) && !/terminals · \{\{accounts\}\} accounts/.test(tpl_) && (tpl_.match(/<h2>/g) || []).length === 1 && /<header class="ncm-tabhd">[^\n]*<h2>Terminals<\/h2>/.test(tpl_), 'the summary header strip is gone (only the shared page title remains)');
  const tb = tpl_.slice(tpl_.indexOf('<div class="ncm-term2-tb">'), tpl_.indexOf('data-term2-viewpop'));
  ok(/data-op="import"[\s\S]*data-action="popOutTab"/.test(tb) && /class="ncm-term2-btn" data-action="popOutTab"/.test(tb) && /fa-up-right-from-square"><\/i> Pop out/.test(tb), 'Pop out sits in the toolbar after Import, in the same button vocabulary');
  ok(!/<select[^>]*data-term2-(group|sort)/.test(tpl_) && !/\[data-term2-group\]|\[data-term2-sort\]/.test(js_), 'the Group and Sort selects are gone');
  ok(/data-op="view" data-term2-viewbtn/.test(tb) && /\{\{viewLabel\}\}/.test(tb), 'one View button in the toolbar, labelled with the current choice');
  tab._bulk = false; tab._viewOpen = false; tab._group = 'location'; tab._sort = 'name';
  let c = ctx();
  ok(c.viewLabel === 'By location · Name' && c.viewOpen === false, 'View label summarises group + sort');
  ok(c.groupOptions.length === 6 && c.groupOptions.every((o) => o.icon && !/^Group:/.test(o.label)) && c.sortOptions.length === 4 && c.sortOptions.every((o) => o.icon), 'menu options: 6 groupings + 4 orders, each with an icon');
  renders = 0;
  tab.onAct('view');
  ok(tab._viewOpen === true && renders === 1 && ctx().viewOpen === true, 'View toggles the menu open (state on the tab)');
  tab._pickView('group', 'org');
  c = ctx();
  ok(tab._group === 'org' && !tab._viewOpen && c.viewLabel === 'By organization · Name' && [...tab._fold.entries()].every(([key, v]) => key === '\u0000sel' || v === true), 'picking a grouping applies it (its own fold memory) and closes the menu');
  tab._viewOpen = true; tab._pickView('sort', 'attention');
  ok(tab._sort === 'attention' && !tab._viewOpen && ctx().viewLabel === 'By organization · Needs you first', 'picking an order applies it and closes');
  tab._pickView('group', 'nonsense'); tab._pickView('sort', 'nonsense');
  ok(tab._group === 'org' && tab._sort === 'attention', 'unknown picks are ignored');
  tab._pickView('group', 'none');
  ok(ctx().viewLabel === 'No groups · Needs you first', 'no grouping reads "No groups"');
  tab._viewOpen = true; tab.onAct('bulk');
  ok(!tab._viewOpen && ctx().viewOpen === false, 'select mode closes the menu');
  tab.onAct('bulk');
  ok(/_mountViewMenu\(root\)/.test(js_) && /document\.body\.appendChild\(pop\)/.test(js_) && /dataset\.ncmAdminTheme = theme/.test(js_) && /'Escape'/.test(js_) && /'pointerdown', this\._viewListener, true/.test(js_), 'the menu is a body-mounted portal wearing the window theme; outside click / Esc close it');
  ok(/data-view-owner="\$\{CSS\.escape\(this\._viewKey\(\)\)\}"/.test(js_) && /this\._closeView\(false\)/.test(js_.slice(js_.indexOf('onClose() {'))), 'one menu per window (keyed by app id) and it is removed on close');
  const css_ = read('styles/components/admin-panel/tab-terminals.css');
  ok(/\.ncm-term2-viewpop \{ display: none; \}/.test(css_) && /\.ncm-app\.ncm-term2-viewpop\.is-portal \{[^}]*position: fixed; z-index: 10000/.test(css_), 'the in-panel copy never shows; the portal is fixed above the panel');
  tab._group = 'location'; tab._sort = 'name'; tab._viewOpen = false;
}

// ═══ 6c. accountStatus.js — the pure rules ═══
{
  const A = await import(pathToFileURL(`${ROOT}/scripts/utils/accountStatus.js`).href);
  const T = iso(5);
  const base = { itemId: 'ws', accountId: 'a1', accountNames: ['Veronica Ames'], actorId: 'aV', maxAttempts: 3, lockoutMs: 3600000, now: NOW };
  const f = (extra = {}) => ({ ts: T, actorId: 'aV', action: 'net-auth', targetNetworkId: 'ws::a1', outcome: 'failed', ...extra });
  ok(A.triesFromLog({ ...base, log: [f(), f(), { ...f(), action: 'lockout-clear', outcome: 'success' }] }).used === 0, 'paused clock: two misses then a clear at the same instant → 0 (log order wins)');
  ok(A.triesFromLog({ ...base, log: [f(), { ...f(), action: 'lockout-clear' }, f()] }).used === 1, 'a miss after the clear counts');
  ok(A.triesFromLog({ ...base, log: [f(), f({ outcome: 'success' }), f()] }).used === 1, 'a successful login resets the count');
  ok(A.triesFromLog({ ...base, log: [f(), f()], logins: [{ ts: T, accountId: 'a1', operatorId: 'aV' }] }).used === 0, 'a login footprint at the same instant lands after the misses');
  const locked = A.triesFromLog({ ...base, log: [f(), f(), f()] });
  ok(locked.used === 3 && locked.lockUntil === Date.parse(T) + 3600000, 'the third miss locks for the account\'s lockout');
  ok(A.triesFromLog({ ...base, now: Date.parse(T) + 3600001, log: [f(), f(), f()] }).used === 0, 'an expired lockout resets the counter');
  ok(A.triesFromLog({ ...base, log: [f({ actorId: 'aR' }), f({ targetNetworkId: 'ws::a3' })] }).used === 0, 'other characters / accounts do not count');
  ok(A.triesFromLog({ ...base, log: [{ ts: T, actorId: 'aV', action: 'terminal-login', objectId: 'ws', objectName: 'WS · Veronica Ames', outcome: 'failed' }] }).used === 1, 'the quick-entry console row is matched by "<terminal> · <account>"');
  ok(A.fmtCountdown(42 * 60000) === '42:00' && A.fmtCountdown(3723000) === '1:02:03' && A.fmtCountdown(-5) === '00:00', 'countdown format');
  ok(A.partyRowState({ loggedIn: false, known: { attempts: 1, forced: true, reason: 'heat', lockoutUntil: NOW + 1000 }, derived: {}, maxAttempts: 3, now: NOW }).why === 'forced — heat', 'a forced lockout says so');
  ok(A.partyRowState({ loggedIn: false, known: null, derived: { used: 0 }, blocked: 'x', maxAttempts: 3, now: NOW }).state === 'cant', 'blocked → can\'t');
  ok(A.partyRowState({ loggedIn: true, known: { lockoutUntil: NOW + 1000 }, derived: {}, maxAttempts: 3, now: NOW }).state === 'in', 'logged in wins over everything');
  ok(A.lockInWords({ requiresAuth: true }, []).text === 'sealed — no way in' && A.lockInWords({}, []).text === 'open — no login', 'sealed / open in words');
}

// ═══ 6. Wiring guards ═══
const tpl = read('templates/admin-panel/tab-terminals.hbs');
const js = read('scripts/ui/AdminPanel/tabs/TerminalsTab.js');
const css = read('styles/components/admin-panel/tab-terminals.css');
const onActBody = js.slice(js.indexOf('onAct(op, event, target) {'), js.indexOf('_resolve(target)'));
const ops = new Set([...tpl.matchAll(/data-op="([^"{]+)"/g)].map((m) => m[1]));
for (const m of js.matchAll(/btn\('(\w+)'/g)) ops.add(m[1]); // ops the detail builds for Right now
for (const op of ops) ok(onActBody.includes(`case '${op}':`), `onAct handles data-op "${op}"`);
ok(tpl.includes('data-op="{{op}}"'), 'Right now buttons take their op from the row');
ok(!/data-action="(?!tabAct|popOutTab)[^"]+"/.test(tpl), 'template uses only tabAct / popOutTab actions');
ok(/data-owner="terminals"/.test(tpl), 'root carries data-owner');
// every identifier the template reads exists somewhere in the context it renders
const KEYWORDS = new Set(['if', 'unless', 'each', 'else', 'with', 'eq', 'ncm', 'this', 'term2', 'activeTab', 'sel']);
const keysDeep = (o, out = new Set(), seen = new Set()) => {
  if (!o || typeof o !== 'object' || seen.has(o)) return out;
  seen.add(o);
  for (const [k, v] of Object.entries(o)) { out.add(k); keysDeep(v, out, seen); }
  return out;
};
tab._selectedId = 'ws'; tab._filter = 'all'; tab._search = ''; tab._group = 'location'; tab._fold.clear();
const ctxAll = keysDeep(ctx());
const read2 = [...tpl.replace(/\{\{!--[\s\S]*?--\}\}/g, '').matchAll(/\{\{[#/]?(?:if|unless|each|with)?\s*([a-zA-Z][\w]*)/g)].map((m) => m[1]).filter((k) => !KEYWORDS.has(k));
for (const k of new Set(read2)) ok(ctxAll.has(k), `template reads a key the context provides: ${k}`);
// the new structure
ok(/class="ncm-term2-rack"/.test(tpl) && /ncm-term2-ru\b/.test(tpl) && /\{\{#each leds\}\}/.test(tpl) && /ncm-term2-hbar/.test(tpl) && /ncm-term2-trace/.test(tpl), 'list = a rack of units with lights, heat bar, trace timer');
ok(/ncm-term2-mod__k[^>]*><i class="fas fa-wave-square"><\/i>Right now/.test(tpl) && /Accounts<span/.test(tpl) && /Recent logins<span/.test(tpl), 'detail modules: Right now, Accounts, Recent logins');
ok(/data-acct-row="\{\{foldKey\}\}"/.test(tpl) && /data-acct-facts="\{\{foldKey\}\}"/.test(tpl), 'accounts table rows expand into facts');
for (const k of ['Belongs to', 'Lock', 'Mailbox', 'Lockout rule', 'Logins here']) ok(tpl.includes(`<span class="k">${k}</span>`), `expanded facts: ${k}`);
ok(/Open terminal/.test(tpl) && !/View as admin/.test(tpl), 'no fake "View as admin" — the button says it opens the terminal');
ok(!/ncm-term2-party|ncm-term2-pr\b|ncm-term2-acct\b|data-acct-fold|acctFold/.test(tpl + js), 'the per-character party boxes are gone');
ok(!/\bodds\b|\bchance\b|type="range"|lockOdds|\brace\b/i.test(tpl), 'no odds / chance / DV slider markup in the tab');
const classes = new Set([...tpl.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)).filter((k) => /^ncm-term2-[a-z]/.test(k)));
for (const k of classes) ok(css.includes(`.${k}`), `class .${k} is styled`);
ok(!/#[0-9a-f]{3,8}\b/i.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'CSS carries no literal hex colour');
ok(/\.ncm-admin-panel--pop \.ncm-term2-split/.test(css), 'pop-out widens the split');
ok(/prefers-reduced-motion[\s\S]*ncm-term2-led[^}]*animation: none/.test(css), 'the blinking light respects reduced motion');
ok(/\.ncm-term2-ax\[hidden\]\s*\{\s*display: none !important/.test(css), 'a folded facts block cannot be re-shown by a display rule');
ok(/tab-terminals\.css/.test(read('styles/night-city-messenger.css')) || /tab-terminals\.css/.test(read('styles/components/admin-panel.css')), 'stylesheet imported');
ok(!fs.readdirSync(`${ROOT}/styles`, { recursive: true }).filter((f) => String(f).endsWith('.css') && !String(f).includes('tab-terminals') && !String(f).includes('admin-hierarchy')).some((f) => fs.readFileSync(`${ROOT}/styles/${f}`, 'utf8').includes('.ncm-term2-')), 'no other stylesheet uses the ncm-term2- prefix');
ok(js.includes("mailboxStyle: cfg.mailboxStyle || 'classic'") && tpl.includes('{{mailboxStyle}}'), 'mailbox-styles sim contract kept');
ok(/showNamePicker\(/.test(js) && /ScopePicker\.html\(/.test(js) && /ScopePicker\.after\(\)/.test(js), 'name picker (import) + scope picker (scenes)');
ok(/openTo\(select\)/.test(js), 'openTo implemented');
ok(/getAccountMessages\?\.\(item, a\.id, \{ enforceGates: false/.test(js), 'mailbox counts read with gates off (GM read)');

// ═══ 7. REAL render ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars — render checks did not run'); }
else {
  { const { registerTagHueHelper } = await import(new URL('../../../scripts/utils/tagHue.js', import.meta.url)); registerTagHueHelper(Handlebars); }
  Handlebars.registerHelper('eq', (a, b) => String(a) === String(b));
  const render = Handlebars.compile(tpl);
  tab._filter = 'all'; tab._search = ''; tab._group = 'location'; tab._selectedId = 'ws'; tab._menuOpen = true; tab._acctOpen.clear(); tab._fold.clear();
  // NCM_DUMP=<path> writes this view-model (menu closed) for dev/mockups/admin-terminals-preview.html.
  // NCM_DUMP_SEL=<itemId> / NCM_DUMP_SHUT='Group A|Group B' dump another selection / GM-closed groups (bbs + 'Arasaka Tower' shows a busy closed head).
  if (process.env.NCM_DUMP) { if (process.env.NCM_DUMP_SEL) tab._selectedId = process.env.NCM_DUMP_SEL; for (const k of (process.env.NCM_DUMP_SHUT || '').split('|').filter(Boolean)) tab._fold.set(k, false); tab._menuOpen = false; fs.writeFileSync(process.env.NCM_DUMP, JSON.stringify({ activeTab: 'terminals', ...tab.prepareContext() }, null, 1)); tab._menuOpen = true; tab._selectedId = 'ws'; tab._fold.clear(); }
  {
    // Default folds as rendered: the selection's group open, every other head closed with its summary.
    const dflt = render({ activeTab: 'terminals', ...tab.prepareContext() });
    ok((dflt.match(/class="ncm-term2-grp is-shut/g) || []).length === 2, 'render: two closed heads by default');
    ok(/ncm-term2-gsum__c is-unl/.test(dflt) && /aria-expanded="false"/.test(dflt), 'render: a closed head shows what needs you (GM-unlocked chip) and says it is folded');
    ok(!/Holds the open terminal/.test(dflt) && !/ncm-term2-grp[^"]*is-forced/.test(dflt), 'render: the selection’s group is not forced (no dead head click)');
  }
  // The checks below want every unit on screen.
  for (const k of ['Arasaka Tower', 'The Afterlife', 'No location']) tab._fold.set(k, true);
  const html = render({ activeTab: 'terminals', ...tab.prepareContext() });
  ok(render({ activeTab: 'messages', ...tab.prepareContext() }).trim() === '', 'renders nothing on another tab');
  ok((html.match(/class="ncm-term2-ru[ "]/g) || []).length === 4, 'four rack units');
  ok((html.match(/class="ncm-term2-led[ "]/g) || []).length === 4 * 4 + 4, 'four lights per unit (+ the legend)');
  ok((html.match(/ncm-term2-led is-bad/g) || []).length >= 2 && html.includes('ncm-term2-led is-good') && html.includes('ncm-term2-led is-attn'), 'lights render lit');
  ok((html.match(/data-acct-row="/g) || []).length === 4 && (html.match(/data-acct-facts="/g) || []).length === 4, 'four account rows, each with its facts');
  ok((html.match(/data-acct-facts="[^"]+"[^>]*hidden>/g) || []).length === 4, 'every account folded on first render');
  ok(html.includes('<header class="ncm-tabhd"><i class="fas fa-terminal"></i><div><h2>Terminals</h2>'), 'page title + description at the top');
  ok(/class="ncm-tagp ncm-term2-ru__pl" style="--tc:[^"]+"/.test(html) && /class="ncm-term2-ru__n"[^>]*><i class="fas fa-user"><\/i><b>4<\/b>/.test(html), 'rack unit: location pill in its hue + account count chip');
  ok(/class="ncm-term2-aav has-img"[^>]*><img src="veronica.png"/.test(html) && /class="ncm-term2-aav"[^>]*>[A-Z?]{1,2}<\/span>/.test(html), 'account rows lead with a portrait, else initials');
  ok(/<span class="ncm-term2-an__tx">\s*<span class="l1"><span class="u">[^<]+<\/span><span class="ncm-term2-tg is-adm">/.test(html), 'Admin tag sits inline after the NAME (inside the name column, not beside the chevron)');
  ok(html.includes('ncm-term2-more is-open'), 'menu open state renders');
  ok(/data-lock-until="\d+"/.test(html) && ['acctClear', 'acctLogout', 'editLock', 'defuse', 'callOff', 'escalate', 'heatClear', 'acctResetAll'].every((op) => html.includes(`data-op="${op}"`)), 'live clock + every row action render');
  ok(html.includes('data-resident-id="r1"') && html.includes('data-countdown-id="cd1"') && html.includes('data-object-id="ws"'), 'buttons carry the Security tab\'s data attributes');
  ok((html.match(/class="ncm-term2-lr"/g) || []).length === 6 && html.includes('<span class="pl">(Kim)</span>') && html.includes('<span class="pl">(Sam)</span>'), 'recent logins: 6 rows with the player in brackets');
  ok(html.includes('<b>DV&nbsp;20</b>') && html.includes('<em>or</em>'), 'the lock in words with the DV');
  ok(html.includes('2 in</span>') && html.includes('locked out</span>'), 'header status line renders');
  ok(html.includes('Nothing happening.') === false, 'busy machine shows Right now rows');
  ok(html.includes('data-action="popOutTab"') && html.includes('data-select="ws"'), 'pop out carries the selection');
  tab._menuOpen = false; tab._viewOpen = true;
  const vh = render({ activeTab: 'terminals', ...tab.prepareContext() });
  ok(vh.includes('ncm-term2-viewpop is-open') && (vh.match(/role="menuitemradio"/g) || []).length === 10 && (vh.match(/aria-checked="true"/g) || []).length === 2 && vh.includes('>Group by<') && vh.includes('>Sort<') && vh.includes('aria-expanded="true"'), 'View menu renders: Group by + Sort radio sections, the current picks checked');
  ok(!/ncm-term2-hd[ "]/.test(vh) && /data-op="import"[\s\S]{0,400}data-action="popOutTab"/.test(vh), 'rendered: no header strip, Pop out right after Import');
  tab._viewOpen = false;
  app.isPopout = true;
  ok(!render({ activeTab: 'terminals', ...tab.prepareContext() }).includes('popOutTab'), 'no Pop out inside the pop-out');
  app.isPopout = false;
  tab._selectedId = 'lobby';
  const quietHtml = render({ activeTab: 'terminals', ...tab.prepareContext() });
  ok(quietHtml.includes('Nothing happening.') && quietHtml.includes('<span class="is-dim">Quiet</span>'), 'a quiet machine says so');
  tab._selectedId = 'ws';
  // empty world
  const saved = terminalService.collectTerminals; terminalService.collectTerminals = () => [];
  const empty = render({ activeTab: 'terminals', ...tab.prepareContext() });
  ok(empty.includes('No terminals yet') && !empty.includes('ncm-term2-split'), 'empty state');
  terminalService.collectTerminals = saved;
}

// ═══ 8. The REAL SecurityService across two clients (mocked sockets) ═══
{
  const { SecurityService } = await import(pathToFileURL(`${ROOT}/scripts/services/SecurityService.js`).href);
  const { SOCKET_OPS } = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href);
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0; // lockout expiry polls — the clock is frozen here
  const ns = game.nightcity;
  const savedSec = ns.securityService;
  const wire = [];
  const clients = {};
  // Each client gets its own service; a socket emit reaches the OTHER client.
  const as = (who, fn) => { const was = game.user; game.user = who === 'gm' ? { isGM: true, id: 'gm' } : { isGM: false, id: 'u1' }; try { return fn(); } finally { game.user = was; } };
  const deliver = (from, op, data) => {
    wire.push([from, op]);
    const to = from === 'gm' ? 'pl' : 'gm';
    as(to, () => {
      const svc = clients[to];
      if (op === SOCKET_OPS.SECURITY_REPORT) { if (game.user.isGM) svc.receiveReport(data, 'u1'); }
      else if (op === SOCKET_OPS.SECURITY_CLEAR) svc.receiveClear(data);
      else if (op === SOCKET_OPS.TERMINAL_KICK) svc.receiveKick(data);
      else if (op === SOCKET_OPS.SECURITY_LOCKOUT) svc.receiveForcedLockout(data);
    });
  };
  ns.eventBus = { emit: () => {} };
  game.users = Object.assign([...game.users], { activeGM: { id: 'gm' } });
  ns.socketManager = { emit: (op, data) => deliver(game.user.isGM ? 'gm' : 'pl', op, data) };
  clients.gm = as('gm', () => new SecurityService());
  clients.pl = as('pl', () => new SecurityService());
  const KEY = 'ws::a1';
  as('pl', () => { clients.pl.initTracking('aV', KEY, { maxAttempts: 3, lockoutDuration: 600000 }); clients.pl.recordFailedAttempt('aV', KEY); });
  ok(wire.some((w) => w[0] === 'pl' && w[1] === SOCKET_OPS.SECURITY_REPORT), 'a player miss on a terminal account is reported to the GM');
  let k = as('gm', () => clients.gm.getKnownState('aV', KEY));
  ok(k?.attempts === 1 && k.source === 'remote' && !k.lockoutUntil, 'GM sees 1 try from the report');
  as('pl', () => { clients.pl.recordFailedAttempt('aV', KEY); clients.pl.recordFailedAttempt('aV', KEY); });
  k = as('gm', () => clients.gm.getKnownState('aV', KEY));
  ok(k?.lockoutUntil === NOW + 600000 && k.lockoutRemaining === 600000 && !k.forced, 'an EARNED lockout reaches the GM with its deadline');
  // the tab reads it
  ns.securityService = clients.gm;
  tab._selectedId = 'ws';
  ns.terminalService.getState = (it) => ({ ...states[it.id], sessions: {} }); // V not logged in for this check
  const vRow = ctx().sel.nowRows.find((r) => r.kind === 'lock' && r.main === 'V' && r.acct === 'v_arasaka');
  ok(vRow && vRow.time === '10m' && vRow.lockUntil === NOW + 600000, "the Terminals tab shows the player's earned lockout");
  // GM clears → the player's client unblocks
  as('gm', () => clients.gm.clearFor('aV', [KEY]));
  ok(wire.some((w) => w[0] === 'gm' && w[1] === SOCKET_OPS.SECURITY_CLEAR), 'clear goes out on SECURITY_CLEAR');
  ok(as('pl', () => !clients.pl.isLockedOut('aV', KEY) && clients.pl.getRemainingAttempts('aV', KEY) === 3), "the player's own check is unblocked");
  ok(as('gm', () => clients.gm.getKnownState('aV', KEY)) === null, 'the GM view is clean');
  // a success reports zero → the GM forgets
  as('pl', () => { clients.pl.recordFailedAttempt('aV', KEY); });
  ok(as('gm', () => clients.gm.getKnownState('aV', KEY))?.attempts === 1, 'a new miss shows again');
  as('pl', () => clients.pl.recordSuccess('aV', KEY));
  ok(as('gm', () => clients.gm.getKnownState('aV', KEY)) === null, 'a later success clears the report');
  // networks / shards (bare ids) are never reported; no GM online = nothing sent
  wire.length = 0;
  as('pl', () => clients.pl.recordFailedAttempt('aV', 'some-network'));
  ok(!wire.length, 'bare-id targets are not reported');
  game.users.activeGM = null;
  as('pl', () => clients.pl.recordFailedAttempt('aV', KEY));
  ok(!wire.length, 'no GM online → nothing to do');
  game.users.activeGM = { id: 'gm' };
  // a player cannot write the GM map
  as('pl', () => clients.pl.receiveReport({ actorId: 'aV', targetId: KEY, attempts: 2 }));
  ok(clients.pl._remote.size === 0, 'only the GM stores reports');
  // forced lockouts keep their reason; the GM view reads it
  as('gm', () => clients.gm.forceLockoutMany('aH', ['ws::a3'], { durationMs: 300000, reason: 'heat BURNED', label: 'WS-7F-12' }));
  k = as('gm', () => clients.gm.getKnownState('aH', 'ws::a3'));
  ok(k?.forced && k.reason === 'heat BURNED', 'a forced lockout carries its reason');
  ok(as('pl', () => clients.pl.isLockedOut('aH', 'ws::a3')), 'forced lockout still mirrors to the player');
  // kick: the player's open viewer on that account drops to login
  const kicked = [];
  globalThis.ui.windows = { 1: { item: { id: 'ws' }, actorId: 'aV', forceLogout: (m) => kicked.push(m) }, 2: { item: { id: 'lobby' }, actorId: 'aV', forceLogout: (m) => kicked.push('wrong') } };
  globalThis.foundry.applications = { instances: new Map() };
  wire.length = 0;
  as('gm', () => clients.gm.kickSession('aV', [KEY], 'LOGGED OUT BY THE SYSTEM ADMINISTRATOR.'));
  ok(wire.some((w) => w[1] === SOCKET_OPS.TERMINAL_KICK), 'Log out goes out on TERMINAL_KICK');
  ok(kicked.filter((m) => /SYSTEM ADMINISTRATOR/.test(m)).length === 2 && !kicked.includes('wrong'), 'the matching viewer is bounced (GM client + player client), others untouched');
  // the socket handlers exist and route to these methods
  const sh = read('scripts/integrations/SocketHandlers.js');
  for (const [op, fn] of [['SECURITY_REPORT', 'receiveReport'], ['SECURITY_CLEAR', 'receiveClear'], ['TERMINAL_KICK', 'receiveKick']]) {
    ok(new RegExp(`register\\(SOCKET_OPS\\.${op},[\\s\\S]{0,240}${fn}`).test(sh), `SocketHandlers routes ${op} → ${fn}`);
    ok(typeof SOCKET_OPS[op] === 'string', `SOCKET_OPS.${op} exists`);
  }
  ok(/register\(SOCKET_OPS\.SECURITY_REPORT, \(data, sender\) => \{\s*if \(!game\.user\.isGM\) return;/.test(sh), 'the report handler is GM-only');
  ns.securityService = savedSec;
  ns.terminalService.getState = (it) => states[it.id];
  globalThis.setTimeout = realTimeout;
}

// ═══ Default rack folds — the pure rules (terminalsRack.js) ═══
{
  const { rackFoldState, rackHeadSummary } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/terminalsRack.js`).href);
  const st = rackFoldState(['a', 'b', 'c'], { choices: new Map([['c', true], ['a', false]]), selectedKey: 'b' });
  ok(!st.get('a').open && st.get('b').open && st.get('b').forced === 'selection' && st.get('c').open, 'fold rules: GM choice beats the default, selection forced open');
  ok([...rackFoldState(['a', 'b'], { choices: new Map([['a', false]]), openAll: true }).values()].every((v) => v.open && v.forced === 'search'), 'fold rules: openAll beats GM choices');
  ok(rackFoldState(['a', 'b']).get('a').open && !rackFoldState(['a', 'b']).get('b').open, 'fold rules: first open, rest closed');
  const L = (i, o, a, s) => [{ cls: i ? 'good' : '' }, { cls: o ? 'bad' : '' }, { cls: a ? 'attn' : '' }, { cls: s ? 'secret' : '' }];
  const h = rackHeadSummary([{ leds: L(1, 0, 0, 1), maxHeat: 0 }, { leds: L(0, 1, 1, 0), maxHeat: 30, traceTag: '4:00' }, { leds: L(0, 0, 0, 0), gmBypassed: true }]);
  ok(h.chips.map((x) => x.kind).join() === 'bad,trace,attn,hot,unl,good,secret' && h.needs && h.tone === 'bad', 'head summary: needs-you chips first, red tone when locked out / traced');
  const q = rackHeadSummary([{ leds: L(1, 0, 0, 0) }]);
  ok(q.chips.length === 1 && !q.needs && q.tone === '', 'head summary: a quiet group shows only what is on, no tone');
  ok(rackHeadSummary([]).chips.length === 0, 'head summary: empty group shows nothing');
}

console.log(`\ntest-admin-terminals: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
