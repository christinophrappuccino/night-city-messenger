// Sim: Admin → Shards redesign (2026-10-27). Drives the REAL ShardsTab over a
// mocked world (world + actor-held shards, journals, integrity), renders the REAL
// tab-shards.hbs through Foundry's Handlebars, and guards the wiring:
//   - every data-op the template uses is handled by onAct;
//   - every other data-action is registered on AdminPanelApp;
//   - every context key the template reads is produced;
//   - every ncm-sh2 class the template uses is styled;
//   - filters / search / holder / grouping / selection / bulk / openTo / import / export /
//     unconvert / authoring-on behave.
// Run: node dev/tools/sims/test-admin-shards.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const MOD = 'night-city-messenger';
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const clone = (o) => (o === undefined ? o : JSON.parse(JSON.stringify(o)));

// ═══ World ═══
class Actor { constructor(o) { Object.assign(this, o); } }
globalThis.Actor = Actor;

const journals = new Map();
const mkJournal = (id, pages) => ({ id, pages: Object.assign(pages, { size: pages.length, contents: pages }) });
const page = (messageId, contentType, subject, extra = {}) => ({
  id: 'pg-' + messageId,
  flags: { [MOD]: { type: 'shard-message', messageId, contentType, subject, ...extra } },
});

const mkItem = (id, name, flags, extra = {}) => ({
  id, name, type: 'gear', img: 'i.png', uuid: extra.parent ? `Actor.${extra.parent.id}.Item.${id}` : `Item.${id}`,
  folder: extra.folder || null, parent: extra.parent || null, compendium: null,
  _flags: { isDataShard: true, ...flags },
  getFlag(m, k) { return this._flags[k]; },
  async setFlag(m, k, v) { this._flags[k] = clone(v); },
  async unsetFlag(m, k) { delete this._flags[k]; },
});

const V = new Actor({ id: 'av', name: 'V', img: 'v.png', folder: { name: 'Crew' } });
const RACHE = new Actor({ id: 'ar', name: 'Rache', img: 'r.png', folder: null });

const worldItems = [
  mkItem('s-netw', 'NetWatch bulletin', { journalId: 'j-netw', config: { preset: 'netwatch-evidence', encrypted: true, encryptionType: 'BLACK_ICE', encryptionDC: 18 }, state: {} }, { folder: { name: 'NetWatch' } }),
  mkItem('s-cache', 'Militech cache codes', { journalId: 'j-cache', config: { preset: 'military-intel', encrypted: true, encryptionType: 'ICE', encryptionDC: 15, requiresKeyItem: true, keyItemName: 'Militech keycard' }, state: { sessions: { av: { hackAttempts: 2, keyItemUsed: true, lastAccessed: Date.now() - 7200000 } } } }, { folder: { name: 'Badlands' } }),
  mkItem('s-dead', 'Scorched shard', { journalId: 'j-dead', config: { preset: 'street-shard' }, state: { destroyed: true } }),
  mkItem('s-blank', 'Data Shard #4', { journalId: 'j-blank', config: { preset: 'blank' }, state: {} }),
];
const vItems = [
  mkItem('s-pay', 'Arasaka payroll', { journalId: 'j-pay', config: { preset: 'corporate-dossier', encrypted: true, encryptionType: 'ICE', encryptionDC: 18, requiresLogin: true, integrity: { enabled: true, mode: 'mechanical' } }, state: { decrypted: true, sessions: { av: { loggedIn: true, lastAccessed: Date.now() - 60000 * 5 } } } }, { parent: V }),
];
const racheItems = [
  mkItem('s-bribe', 'Forged chatlog', { journalId: 'j-bribe', config: { preset: 'blank', playerMade: { actorId: 'ar', actorName: 'Rache', outcome: 'sloppy' } }, state: {} }, { parent: RACHE }),
];
V.items = Object.assign([...vItems], { get: (id) => vItems.find(i => i.id === id) || null });
RACHE.items = Object.assign([...racheItems], { get: (id) => racheItems.find(i => i.id === id) || null });

journals.set('j-netw', mkJournal('j-netw', [page('m1', 'message', 'Bulletin')]));
journals.set('j-cache', mkJournal('j-cache', [page('m2', 'eddies', 'Cache funds', { contentData: { amount: 2000, claimed: false } }), page('m3', 'spreadsheet', 'Codes')]));
journals.set('j-dead', mkJournal('j-dead', []));
journals.set('j-blank', mkJournal('j-blank', []));
journals.set('j-pay', mkJournal('j-pay', [
  page('m4', 'message', 'RE: bonus'), page('m5', 'eddies', 'Severance', { contentData: { amount: 500, claimed: false } }),
  page('m6', 'spreadsheet', 'Payroll', { corruption: 0.5 }), page('m7', 'dossier', 'Employee 4471', { encrypted: true }),
]));
journals.set('j-bribe', mkJournal('j-bribe', [page('m8', 'chatlog', 'The chat')]));

const integrityOf = (item) => {
  const ig = item._flags.config?.integrity;
  if (!ig?.enabled) return { enabled: false, percentage: 100, tier: 'clean', isBricked: !!item._flags.state?.destroyed, cfg: { hardening: 0 } };
  return { enabled: true, percentage: 50, tier: 'heavy', isBricked: false, mode: ig.mode, cfg: { hardening: 20, degradePerFailure: 12, glitchDV: 2, hideLost: false } };
};
const calls = { removed: [], converted: [], added: [], relocked: [], created: [] };
const svc = {
  getConfig: (i) => i._flags.config || {},
  getState: (i) => i._flags.state || {},
  checkIntegrity: integrityOf,
  getPreset: (k) => ({ 'corporate-dossier': { label: 'Corporate Dossier', icon: 'fas fa-building' }, 'military-intel': { label: 'Military Intel', icon: 'fas fa-shield-halved' }, 'netwatch-evidence': { label: 'NetWatch Evidence', icon: 'fas fa-eye' }, 'street-shard': { label: 'Street Shard', icon: 'fas fa-skull' }, blank: { label: 'Blank', icon: 'fas fa-sd-card' } })[k] || null,
  getAllPresets: () => [{ key: 'corporate-dossier', label: 'Corporate Dossier', icon: 'fas fa-building' }, { key: 'military-intel', label: 'Military Intel', icon: 'fas fa-shield-halved' }, { key: 'blank', label: 'Blank', icon: 'fas fa-sd-card' }],
  getShardMessages: (item) => (journals.get(item._flags.journalId)?.pages || []).map(p => {
    const f = p.flags[MOD];
    return { id: f.messageId, pageId: p.id, contentType: f.contentType, subject: f.subject, from: 'X', body: '', encrypted: !!f.encrypted, decrypted: false, corrupted: false, corruption: f.corruption || 0, contentData: f.contentData || {} };
  }),
  removeDataShard: async (item, del) => { calls.removed.push([item.id, del]); return { success: true }; },
  convertToDataShard: async (item, cfg, preset) => { calls.converted.push([item.name, cfg, preset]); return { success: true }; },
  addMessage: async (item, e) => { calls.added.push([item.name, e.subject]); return { success: true }; },
  relockShard: async (item) => { calls.relocked.push(item.id); return { success: true }; },
};
let encoderRaw = { pricing: 'propose', blanks: { source: 'any' } };
const settingsManager = {
  getEncoderConfigRaw: () => clone(encoderRaw),
  setEncoderConfig: async (c) => { encoderRaw = clone(c); },
  get: () => ({}),
};

const allActors = [V, RACHE];
globalThis.game = {
  user: { isGM: true },
  items: Object.assign([...worldItems], { get: (id) => worldItems.find(i => i.id === id) || null, contents: worldItems, filter: (fn) => worldItems.filter(fn) }),
  actors: Object.assign([...allActors], { get: (id) => allActors.find(a => a.id === id) || null }),
  journal: { get: (id) => journals.get(id) || null },
  documentTypes: { Item: ['base', 'gear', 'weapon'] },
  settings: { get: () => undefined },
  nightcity: { dataShardService: svc },
};
globalThis.foundry = { utils: { deepClone: clone, mergeObject: (a, b) => ({ ...a, ...b }), debounce: (fn) => fn } };
globalThis.ui = { notifications: { info: () => {}, warn: () => {}, error: () => {} }, items: { render: () => {} }, windows: {} };
globalThis.Hooks = { on: () => {}, once: () => {}, off: () => {}, call: () => true, callAll: () => {} };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '') };
globalThis.fromUuidSync = (u) => [...worldItems, ...vItems, ...racheItems].find(i => i.uuid === u) || null;
globalThis.Dialog = { confirm: async () => true };  // confirm dialogs answer yes
globalThis.Item = { create: async (d) => { const it = mkItem('new' + calls.created.length, d.name, {}); it.type = d.type; calls.created.push(d); return it; } };

const { ShardsTab, SHARD_FILTERS } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/ShardsTab.js`).href);

const findItem = (id) => worldItems.find(i => i.id === id) || vItems.find(i => i.id === id) || racheItems.find(i => i.id === id) || null;
class FakeApp {
  static _findItem(id) { return findItem(id); }
  constructor() { this._activeTab = 'shards'; this.isPopout = false; this.id = 'ncm-admin'; this.renders = 0; }
  get dataShardService() { return svc; }
  get settingsManager() { return settingsManager; }
  get networkService() { return { getNetwork: () => null }; }
  render() { this.renders++; }
  _getRelativeTime() { return 'now'; }
}
const app = new FakeApp();
const tab = new ShardsTab(app);

const tgt = (attrs = {}) => {
  const el = { dataset: attrs, closest: (sel) => {
    const m = sel.match(/^\[data-([a-z-]+)\]$/);
    if (!m) return null;
    const key = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return attrs[key] !== undefined ? el : null;
  } };
  return el;
};
const ev = { stopPropagation() {} };

// ═══ 1. Context ═══
let ctx = tab.prepareContext();
const sh = ctx.shards2;
ok(Array.isArray(ctx.shards) && ctx.shards.length === 6, 'shards (all, unfiltered) is produced for the Overview + HUD');
ok(ctx.shardSummary && ctx.shardSummary.total === 6 && ctx.shardSummary.unclaimedEddies === 2500, 'shardSummary for the header stats line');
ok(sh && !('summary' in sh), 'the on-screen header census is gone (shardSummary still feeds Overview/HUD)');
ok(sh.viewLabel === 'By holder · Name' && sh.filterCount === 0 && sh.pills.length === 0, 'defaults: View By holder · Name, no filters, no pills');
ok(sh.viewSections.map(x => x.label).join() === 'Group by,Held by,Sort' && sh.viewSections.every(x => x.options.filter(o => o.on).length === 1), 'View menu: three radio sections, one pick each');
ok(sh.filterSections.map(x => x.label).join() === 'State,Has' && !sh.viewOpen && !sh.filterOpen, 'Filter menu: State + Has sections, both menus closed');
ok(sh.groups.length >= 3 && sh.groups[0].name === 'World items', 'grouped by holder, world first');
ok(sh.groups.some(g => g.name === 'V’s gear') && sh.groups.some(g => g.name === 'Rache’s gear'), 'a group per character');
ok(sh.detail && sh.detail.itemId === sh.groups[0].rows[0].itemId, 'the first visible row is selected by default');
ok(!sh.groups[0].shut && sh.groups.slice(1).every(g => g.shut), 'default folds: only the first bay (World items) is open, every other bay starts closed');
ok(sh.groups.slice(1).every(g => g.count > 0 && g.lights.length > 0), 'a closed bay still shows its count + state lights');
ok(sh.detail.shut.path && sh.detail.shut.integ && sh.detail.shut.ents, 'detail bands start closed');
const chip = (k) => sh.filterSections.flatMap(x => x.options).find(c => c.value === k);
ok(sh.totalCount === 6 && chip('locked').n === 2 && chip('ice').n === 1 && chip('breached').n === 1 && chip('eb').n === 2 && chip('dmg').n === 1 && chip('made').n === 1 && chip('bricked').n === 1, 'filter counts');

// inactive tab: no template context, but the shared keys stay
app._activeTab = 'overview';
const off = tab.prepareContext();
ok(off.shards2 === null && off.shards.length === 6 && off.shardSummary.total === 6, 'another tab: shards2 is null, shards/shardSummary still produced');
app._activeTab = 'shards';

// ═══ 2. Detail ═══
tab.onAct('row', ev, tgt({ itemId: 's-pay' }));
ctx = tab.prepareContext();
let d = ctx.shards2.detail;
ok(d.itemId === 's-pay' && !d.isWorld && d.holderName === 'V' && !d.isWorldItem, 'selecting a row opens it; a carried shard has no Permissions');
ok(d.layers.map(l => l.key).join() === 'login,encryption' && d.layers.every(l => l.cls === 'done'), 'security chain: login + encryption, both cleared (breached)');
ok(d.entries.length === 4 && d.entries[1].ebUnclaimed === '500 eb' && d.entries[3].encrypted && d.entries[2].damaged && d.entries[2].pct === 50, 'contents: eddies / encrypted / damage');
ok(d.entries.every(e => e.canSetDamage), 'mechanical integrity → pips are settable');
ok(d.ig && d.ig.pct === 50 && d.ig.tier === 'heavy' && d.ig.hardening === 20 && d.ig.degrade === 12 && d.ig.mechanical, 'integrity block');
ok(d.damagedEntries === 1, 'repair-all count');
ok(d.entries.every(e => /^var\(--ncm-(hue-[1-8]|money)\)$/.test(e.hue)) && d.entries[1].hue === 'var(--ncm-money)', 'each entry carries its content-type colour (the eddies drop in money)');
ok(d.shut && d.shut.path === true && d.shut.integ === true && d.shut.ents === true, 'detail sections start closed');
const sumTxt = (p) => p.map(x => x.text).join(' · ');
ok(sumTxt(d.sum.path) === 'Breached — all 2 locks open' && d.sum.path[0].tone === 'good', 'closed Breach path says: breached, all open (green)');
ok(sumTxt(d.sum.integ) === '50% · Degraded' && sumTxt(d.sum.integ) === `${d.igv.pct}% · ${d.igv.tierName}` && d.sum.integ.every(x => x.tone === 'tier' && x.tier === d.igv.tierCss), 'closed Integrity says: 50% · Degraded — the same tier as the open ladder, tier-coloured');
ok(sumTxt(d.sum.ents) === '4 files · 1 damaged · 1 encrypted · 500 eb unclaimed', 'closed Entries says: 4 files · 1 damaged · 1 encrypted · 500 eb unclaimed');
ok(d.sum.ents.some(x => x.tone === 'money' && /eb unclaimed$/.test(x.text)) && d.sum.ents.some(x => x.tone === 'attn' && x.text === '1 damaged'), 'entries summary parts wear meaning colours (money / attn)');
tab.onAct('sec', ev, tgt({ sec: 'path' }));
tab.onAct('sec', ev, tgt({ sec: 'bogus' }));
ok(tab.prepareContext().shards2.detail.shut.path === false && tab._secShut.size === 2, 'opening a section is remembered on the tab (unknown keys ignored)');
tab.onAct('row', ev, tgt({ itemId: 's-cache' }));
ok(tab.prepareContext().shards2.detail.shut.path === false, 'the choice holds when another shard is opened (one choice for the session)');
tab.onAct('sec', ev, tgt({ sec: 'path' }));
ok(tab.prepareContext().shards2.detail.shut.path === true, 'and folds again');
tab.onAct('row', ev, tgt({ itemId: 's-pay' }));

ok(d.lastOpened.startsWith('Last opened by V'), 'last opened line');
tab.onAct('row', ev, tgt({ itemId: 's-cache' }));
d = tab.prepareContext().shards2.detail;
ok(d.isWorldItem && d.layers.map(l => l.key).join() === 'keyitem,encryption' && d.layers[0].cls === 'done' && d.layers[1].cls === 'lock' && d.layers[0].small === 'Militech keycard', 'world shard: key item cleared, encryption locked, key item name shown');
ok(d.attempts === 2 && d.unclaimedEb === '2,000', 'attempts + unclaimed eb');
tab.onAct('row', ev, tgt({ itemId: 's-netw' }));
d = tab.prepareContext().shards2.detail;
ok(d.layers[0].cls === 'ice' && d.layers[0].name === 'Black ICE', 'Black ICE layer');
ok(/hits the runner/.test(d.layers[0].tip) && /unlock through here/.test(d.layers[0].tip) && !d.layers[0].isNext && d.layers[0].icon === 'fas fa-skull', 'breach path: ICE says what it does, never the amber next ring');
tab.onAct('row', ev, tgt({ itemId: 's-bribe' }));
d = tab.prepareContext().shards2.detail;
ok(d.makerTag && d.makerTag.label === 'Made by Rache' && d.makerTag.sloppy && d.editLabel.startsWith('Editable'), 'made-by + sloppy + editable (player-made defaults to maker)');
tab.onAct('row', ev, tgt({ itemId: 's-blank' }));
d = tab.prepareContext().shards2.detail;
ok(!d.hasLayers && d.entries.length === 0 && d.ig === null, 'open blank: no lock, empty, no integrity block');

// ═══ 3. Filters / search / holder / grouping ═══
tab._pickPop('filter', 'locked');
ctx = tab.prepareContext();
let ids = ctx.shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 2 && ids.includes('s-netw') && ids.includes('s-cache'), 'Locked filter narrows');
ok(ctx.shards2.detail.itemId === ids[0] || ids.includes(ctx.shards2.detail.itemId), 'selection follows the visible list');
ok(ctx.shards2.filterCount === 1 && ctx.shards2.pills.length === 1 && ctx.shards2.pills[0].label === 'Locked' && ctx.shards2.shownCount === 2, 'an active filter shows as a pill + count badge');
tab._pickPop('filter', 'bricked');
ids = tab.prepareContext().shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 3, 'two STATE filters OR together (Locked or Bricked)');
tab._pickPop('filter', 'eb');
ids = tab.prepareContext().shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 1 && ids[0] === 's-cache', 'a HAS filter ANDs with the states');
tab._pickPop('filter', 'nonsense');
ok(tab._filters.size === 3, 'an unknown filter key is ignored');
tab.onAct('filter', ev, tgt({ filter: 'eb' }));
ok(!tab._filters.has('eb'), "a pill's ✕ removes that filter");
tab._ownerFilter = 'world';
ctx = tab.prepareContext();
ok(ctx.shards2.pills[0].op === 'holderAll' && /World items/.test(ctx.shards2.pills[0].label), 'a Held by pick shows as a pill too');
tab.onAct('clearFilters', ev, tgt());
ok(tab._filters.size === 0 && tab._ownerFilter === 'all', 'Clear all empties the filters and Held by');
tab._pop = 'view'; ok(tab.prepareContext().shards2.viewOpen, 'the View menu opens');
tab._pickPop('group', 'status');
ok(tab._pop === null && tab._groupMode === 'status' && tab.prepareContext().shards2.viewLabel === 'By state · Name', 'a View pick closes the menu and the button says it');
tab._pop = 'filter'; tab._pickPop('filter', 'dmg');
ok(tab._pop === 'filter' && tab._filters.has('dmg'), 'a Filter pick keeps the menu open');
tab._pickPop('clear'); tab._pickPop('done');
ok(tab._filters.size === 0 && tab._pop === null, 'Clear + Done');
tab._groupMode = 'owner';
tab._search = 'badlands';
ids = tab.prepareContext().shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 1 && ids[0] === 's-cache', 'search matches the folder');
tab._search = 'rache';
ids = tab.prepareContext().shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 1 && ids[0] === 's-bribe', 'search matches the maker / holder');
tab._search = 'zzz';
ctx = tab.prepareContext();
ok(ctx.shards2.noMatch && ctx.shards2.detail === null, 'no-match state');
tab._filters.add('locked');
ok(tab.prepareContext().shards2.noMatchWhy === 'the search “zzz”, Locked', 'the no-match state names what hid everything');
tab.onAct('clearQuery', ev, tgt());
ok(tab._search === '' && tab._filters.size === 1, 'the search box ✕ clears only the search');
tab._search = 'zzz';
tab.onAct('clearSearch', ev, tgt());
ok(tab._search === '' && tab._filters.size === 0, 'clear search resets search + filters');
tab._ownerFilter = 'world';
ids = tab.prepareContext().shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 4 && ids.every(i => worldItems.some(w => w.id === i)), 'holder filter: world items');
tab._ownerFilter = 'actors';
ids = tab.prepareContext().shards2.groups.flatMap(g => g.rows.map(r => r.itemId));
ok(ids.length === 2, 'holder filter: characters');
tab._ownerFilter = 'all';
tab._groupMode = 'maker';
let gs = tab.prepareContext().shards2.groups;
ok(gs.some(g => g.name === 'Made by Rache' && g.count === 1) && gs.some(g => g.name === 'Made by the GM' && g.count === 5), 'group by maker');
tab._groupMode = 'folder';
gs = tab.prepareContext().shards2.groups;
ok(gs.some(g => g.name === 'Badlands') && gs.some(g => g.name === 'Crew') && gs.some(g => g.name === '(no folder)'), 'group by folder (a carried shard takes its holder\'s folder)');
tab._groupMode = 'status';
gs = tab.prepareContext().shards2.groups;
ok(gs.some(g => g.name === 'Bricked') && gs.some(g => g.name === 'Black ICE'), 'group by status');
tab._groupMode = 'none';
gs = tab.prepareContext().shards2.groups;
ok(gs.length === 1 && gs[0].count === 6, 'group none');
tab._groupMode = 'owner';
tab.onAct('group', ev, tgt({ groupKey: 'world' }));
gs = tab.prepareContext().shards2.groups;
ok(gs[0].shut && gs[0].rows.length === 4 && gs[0].count === 4 && gs[0].lights.length === 4, 'a folded bay keeps its rows (the fold animates) + a row of state lights');
tab._search = 'a'; ok(!tab.prepareContext().shards2.groups.find(g => g.key === 'world')?.shut, 'a search opens every bay'); tab._search = '';
tab.onAct('group', ev, tgt({ groupKey: 'world' }));
tab._sort = 'accessed';
ids = tab.prepareContext().shards2.groups.find(g => g.key === 'world').rows.map(r => r.itemId);
ok(ids[0] === 's-cache', 'sort by last opened');
tab._sort = 'name';
{ // default folds × the GM's session choices × the selection
  const saveSel = tab._selId;
  tab._openedGroups.clear(); tab._collapsedGroups.clear(); tab._baySelSeen = undefined;   // a fresh session
  tab._selId = 's-cache';   // a world shard
  let g2 = tab.prepareContext().shards2.groups;
  const other = g2.find(g => g.key !== 'world' && !g.rows.some(r => r.itemId === tab._selId));
  ok(other && other.shut, 'a bay that is not first and holds no selection starts closed');
  tab.onAct('group', ev, tgt({ groupKey: other.key }));
  ok(!tab.prepareContext().shards2.groups.find(g => g.key === other.key).shut && tab._openedGroups.has(other.key), 'unfolding a default-closed bay sticks across renders (the GM choice wins)');
  tab.onAct('group', ev, tgt({ groupKey: other.key }));
  ok(tab.prepareContext().shards2.groups.find(g => g.key === other.key).shut && !tab._openedGroups.has(other.key), 'and folding it again sticks too');
  tab.onAct('group', ev, tgt({ groupKey: 'world' }));
  ok(tab.prepareContext().shards2.groups.find(g => g.key === 'world').shut, 'the GM can fold the bay holding the selection, and it stays folded (no spring-back)');
  { const other2 = tab.prepareContext().shards2.groups.find(g => g.key === 'world').rows.find(r => r.itemId !== tab._selId)?.itemId;
    tab._selId = other2;
    ok(!tab.prepareContext().shards2.groups.find(g => g.key === 'world').shut, 'picking another shard opens its bay again (a new selection opens its bay once)');
    tab.onAct('group', ev, tgt({ groupKey: 'world' })); tab.prepareContext(); }   // fold it again for the next check
  tab._selId = other.rows[0].itemId;
  g2 = tab.prepareContext().shards2.groups;
  ok(!g2.find(g => g.key === other.key).shut && g2.find(g => g.key === 'world').shut, 'selecting into a closed bay opens it; the folded first bay stays folded');
  tab.onAct('group', ev, tgt({ groupKey: 'world' }));
  tab._pickPop('group', 'status'); tab._pickPop('group', 'owner');
  ok(!tab._collapsedGroups.size && !tab._openedGroups.size, 'changing Group by resets the bay choices');
  tab._selId = saveSel;
}

// ═══ 4. Bulk ═══
tab.onAct('bulk', ev, tgt());
ok(tab._selectMode, 'Select turns bulk mode on');
tab.onAct('row', ev, tgt({ itemId: 's-pay' }));
tab.onAct('row', ev, tgt({ itemId: 's-bribe' }));
ctx = tab.prepareContext();
ok(ctx.shards2.bulk && ctx.shards2.pickedCount === 2, 'rows pick in bulk mode');
ok(ctx.shards2.groups.flatMap(g => g.rows).every(r => !r.isSel), 'no row reads as selected in bulk mode');
calls.removed.length = 0;
await tab.onBulkUnconvertSelected();
ok(calls.removed.length === 2 && calls.removed.every(([, del]) => del === false), 'bulk unconvert → removeDataShard(item, false) per pick (journal kept)');
ok(tab._selectedIds.size === 0, 'picks clear after');
tab.onAct('pickAll', ev, tgt());
ok(tab._selectedIds.size === 6, 'All shown picks the visible list');
tab.onAct('bulk', ev, tgt());
ok(!tab._selectMode && tab._selectedIds.size === 0, 'Done leaves bulk mode and clears');

// ═══ 5. openTo ═══
tab._filters.add('bricked'); tab._search = 'x'; tab._collapsedGroups.add('actor-av');
tab.openTo('Actor.av.Item.s-pay');
ok(tab._selId === 's-pay' && tab._filters.size === 0 && tab._search === '' && !tab._collapsedGroups.size, 'openTo(uuid) selects it and clears what would hide it');
tab.openTo('s-netw');
ok(tab._selId === 's-netw', 'openTo(id)');
tab.openTo('nope');
ok(tab._selId === 's-netw', 'openTo an unknown id changes nothing');
ok(tab.prepareContext().shards2.detail.itemId === 's-netw', 'and the detail shows it');

// ═══ 6. Unconvert one ═══
calls.removed.length = 0;
await tab.onUnconvertShard(ev, tgt({ itemId: 's-blank' }));
ok(calls.removed.length === 1 && calls.removed[0][0] === 's-blank' && calls.removed[0][1] === false, 'unconvert goes through removeDataShard (restores name/art, keeps the journal)');

// ═══ 7. Import / export ═══
const P = ShardsTab.parseShardImport;
ok(P('not json').error && P('{}').error && P('[]').error, 'bad / empty files are refused with a reason');
const env = P(JSON.stringify({ ncmShards: 1, shards: [{ name: 'A', config: { preset: 'blank' }, entries: [{ subject: 'e1' }, null] }] }));
ok(env.shards.length === 1 && env.shards[0].entries.length === 1 && env.shards[0].img, 'the envelope (entries kept, junk dropped, a default img)');
const legacy = P(JSON.stringify([{ name: 'Old', id: 'x', config: { encrypted: true }, state: { decrypted: true } }, { name: 'no config' }]));
ok(legacy.shards.length === 1 && legacy.shards[0].entries.length === 0, 'the old bulk-export array still imports (config only)');
calls.converted.length = 0; calls.added.length = 0; calls.created.length = 0;
const res = await tab._importShardRecords([{ name: 'A', img: 'a.png', type: 'weapon', config: { preset: 'blank' }, entries: [{ subject: 'e1' }, { subject: 'e2' }] }, { name: 'B', img: 'b.png', type: 'bogus', config: {}, entries: [] }]);
ok(res.created === 2 && calls.created[0].type === 'weapon' && calls.created[1].type === 'gear', 'import creates NEW world items (unknown type → gear)');
ok(calls.converted.length === 2 && calls.converted[0][2] === null && calls.added.map(a => a[1]).join() === 'e1,e2', 'each is converted with its config and gets its entries');
let blobText = '';
globalThis.Blob = class { constructor(parts) { blobText = parts.join(''); } };
globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
globalThis.document = { createElement: () => ({ click() {} }), addEventListener() {}, removeEventListener() {} };
tab._exportShards(['s-pay']);
const exp = JSON.parse(blobText);
ok(exp.ncmShards === 1 && exp.shards[0].entries.length === 4 && !('id' in exp.shards[0].entries[0]) && !('pageId' in exp.shards[0].entries[0]), 'export carries entries, without page ids');
ok(P(blobText).shards[0].entries.length === 4, 'an export round-trips through import');

// ═══ 8. Player authoring ═══
encoderRaw = { pricing: 'propose', blanks: { source: 'any' } };
let auth = tab.prepareContext().shards2.auth;
ok(!auth.on && auth.facts.length === 0, 'off by default → the Off strip');
await tab.onAuthoringOn();
ok(encoderRaw.enabled === true && encoderRaw.pricing === 'propose' && encoderRaw.blanks.source === 'any', 'Turn on flips only the master switch');
auth = tab.prepareContext().shards2.auth;
ok(auth.on && auth.made === 1 && auth.facts.some(f => f.text === 'Blanks: any carried item') && auth.facts.some(f => f.text === 'Prices: you approve') && auth.facts.some(f => f.text === 'Anyone may encode'), 'On strip facts');

// ═══ 9. Template wiring ═══
const tpl = read('templates/admin-panel/tab-shards.hbs');
const appSrc = read('scripts/ui/AdminPanel/AdminPanelApp.js');
const tabSrc = read('scripts/ui/AdminPanel/tabs/ShardsTab.js');
const css = read('styles/components/admin-panel/tab-shards.css');
const onActBody = tabSrc.slice(tabSrc.indexOf('  onAct(op, event, target) {'), tabSrc.indexOf('  _toggleMenu('));
const handledOps = new Set([...onActBody.matchAll(/case '(\w+)':/g)].map(m => m[1]));
const usedOps = new Set([...tpl.matchAll(/data-op="(\w+)"/g)].map(m => m[1]));
const missingOps = [...usedOps].filter(o => !handledOps.has(o));
ok(usedOps.size >= 10 && missingOps.length === 0, `every data-op is handled by onAct (missing: ${missingOps.join(', ') || 'none'})`);
const actions = new Set([...tpl.matchAll(/data-action="(\w+)"/g)].map(m => m[1]));
const unreg = [...actions].filter(a => a !== 'tabAct' && !new RegExp(`\\b${a}: AdminPanelApp\\._`).test(appSrc));
ok(unreg.length === 0, `every other data-action is registered on AdminPanelApp (missing: ${unreg.join(', ') || 'none'})`);
ok(!/static _on(ImportShards|BulkUnconvert|AuthoringOn)/.test(appSrc), 'new buttons ride tabAct — no new static delegators');
ok(/\{\{#with shards2 as \|sh\|\}\}/.test(tpl) && tpl.trim().startsWith("{{#if (eq activeTab 'shards')}}"), 'tab-guarded, reads only the namespaced shards2 context');
ok(tpl.includes('data-owner="shards"'), 'the tabAct owner is on the tab root');

// context keys read by the template exist in what prepareContext produced
tab._selId = 's-pay'; encoderRaw.enabled = true;
tab._filters.add('locked'); const pillsCtx = tab.prepareContext().shards2.pills; tab._filters.clear(); tab._selId = 's-pay';
const full = tab.prepareContext().shards2;
const shKeys = [...new Set([...tpl.matchAll(/sh\.([a-zA-Z]+)/g)].map(m => m[1]))];
const dKeys = [...new Set([...tpl.matchAll(/\bd\.([a-zA-Z]+)/g)].map(m => m[1]))];
ok(shKeys.every(k => k in full), `every sh.* key is produced (missing: ${shKeys.filter(k => !(k in full)).join(', ') || 'none'})`);
ok(dKeys.every(k => k in full.detail), `every d.* key is produced (missing: ${dKeys.filter(k => !(k in full.detail)).join(', ') || 'none'})`);
const { integrityView } = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/shardsModel.js`).href);
const ivDemo = integrityView({ maxIntegrity: 100, currentIntegrity: 40, history: [100, 60, 40], lastHit: { by: 'V' } }, 15);
const arrays = [ivDemo.hist, ivDemo.scale, full.detail.entries.flatMap(e => e.cells), full.groups.flatMap(g => g.lights), full.groups.flatMap(g => g.rows), pillsCtx, full.viewSections, full.viewSections.flatMap(x => x.options), full.filterSections, full.filterSections.flatMap(x => x.options), full.presets, full.auth.facts, full.detail.layers, full.detail.entries, full.detail.entries.flatMap(e => e.pips), full.detail.igv ? full.detail.igv.scale : [], full.detail.sum.path, full.detail.sum.integ, full.detail.sum.ents];
const itemKeys = new Set(arrays.flatMap(a => a.flatMap(x => Object.keys(x))));
const thisKeys = [...new Set([...tpl.matchAll(/this\.([a-zA-Z]+)/g)].map(m => m[1]))];
ok(thisKeys.every(k => itemKeys.has(k)), `every this.* key is produced by some loop item (missing: ${thisKeys.filter(k => !itemKeys.has(k)).join(', ') || 'none'})`);

// CSS: every static ncm-sh2 class the template uses is styled, plus the dynamic variants
const classes = new Set();
for (const m of tpl.matchAll(/class="([^"]*)"/g)) for (const c of m[1].replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/)) if (/^ncm-sh2[\w-]*$/.test(c) && !c.endsWith('-') && !c.endsWith('--')) classes.add(c);
const dyn = ['ncm-sh2-tag--gold', 'ncm-sh2-tag--purple', 'ncm-sh2-tag--cyan', 
  'ncm-sh2-f--lost', 'ncm-sh2-f--glitch', 'ncm-sh2-f--safe',
  'ncm-sh2-menu--new', 'ncm-sh2-menu--det', 'ncm-sh2-led', 'ncm-sh2-slot', 'ncm-sh2-cart', 'ncm-sh2-notch', 'ncm-sh2-bat'];
const unstyled = [...classes, ...dyn].filter(c => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css)
  && !['ncm-sh2-tone', 'ncm-sh2-det__root', 'ncm-sh2-cart__lbl', 'ncm-sh2-dhead__txt', 'ncm-sh2-ent__txt', 'ncm-sh2-auth__txt', 'ncm-sh2--pop'].includes(c));
ok(unstyled.length === 0, `every ncm-sh2 class is styled (unstyled: ${unstyled.join(', ') || 'none'})`);
for (const c of ['ncm-sh2-tone', 'ncm-sh2-det__root', 'ncm-sh2-cart__lbl']) ok(css.includes('.' + c), `${c} is styled`);
const newBlock = css.slice(css.indexOf('/* ═══════════════════════════ layout'));
ok(!/#[0-9a-f]{3,8}\b/i.test(newBlock), 'the redesign block carries no literal hex (tokens only)');
ok(!/border-radius:\s*[3-9]px/.test(newBlock), 'radius stays at 2px (1px badges)');
ok(css.includes('.ncm-action-btn') && css.includes('.ncm-shard-summary-strip') && css.includes('.ncm-shard-stat'), 'shared legacy blocks other tabs use are kept');
ok(/\.ncm-admin-panel--pop \.ncm-sh2-split/.test(css), 'the pop-out widens the split');
ok(!/ncm-shard-row|ncm-sc-badge|ncm-shard-owner/.test(tpl), 'the old row/badge/owner-group markup is gone from the template');
ok(!/Move to/.test(tpl), 'the dead "Move to…" button is gone');
ok(!/ncm-sh2-hd|sh\.summary|<select|ncm-sh2-chips/.test(tpl), 'no header census, no toolbar selects, no chip row');
{ const tbSrc = tpl.slice(tpl.indexOf('<div class="ncm-sh2-tb">'), tpl.indexOf('ACTIVE FILTERS'));
  ok(['data-sh2-popbtn="view"', 'data-sh2-popbtn="filter"', 'data-op="bulk"', 'data-menu="new"', 'data-menu="more"', 'data-menu-id="new"', 'data-menu-id="more"'].every(x => tbSrc.includes(x)), 'one toolbar row: View · Filter · Select · New · ⋯ (and their menus)'); }
ok(/data-sh2-pop="view"/.test(tpl) && /data-sh2-pop="filter"/.test(tpl) && /document\.body\.appendChild\(pop\)/.test(tabSrc) && /'Escape'/.test(tabSrc), 'View/Filter are body-mounted portals that close on Esc');
ok(/\.ncm-sh2-dd \{ display: none; \}/.test(css) && /\.ncm-app\.ncm-sh2-dd\.is-portal/.test(css), 'the popover is hidden in the panel, shown only as the portal');
ok(/prefers-reduced-motion[^}]*ncm-sh2-dd/.test(css), 'the popover entrance has a reduced-motion veto');
ok(/data-op="import"/.test(tpl) && /parseShardImport/.test(tabSrc), 'Import from JSON is real');
// copy that the encoder sim guards
ok(tpl.includes('Data Shards → Player-Made') && tpl.includes("character's gear"), 'the strip says where a player-made shard lives');

// ═══ 10. Real render ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!H) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  { const { registerTagHueHelper } = await import(pathToFileURL(`${ROOT}/scripts/utils/tagHue.js`).href); registerTagHueHelper(H); }
  H.registerHelper('eq', (a, b) => a === b);
  const render = H.compile(tpl);
  const html = render({ activeTab: 'shards', shards2: full });
  ok(render({ activeTab: 'overview', shards2: full }).trim() === '', 'renders nothing on another tab');
  ok((html.match(/class="ncm-sh2-slot /g) || []).length === 6, 'six cartridges');
  ok(html.includes('class="ncm-sh2-slot is-sel ') && html.includes('data-item-id="s-pay"'), 'the selected cartridge is marked');
  ok((html.match(/class="ncm-sh2-ent /g) || []).length === 4, 'four entries in the detail');
  ok((html.match(/class="ncm-sh2-sec__sum"/g) || []).length === 3 && html.includes('500 eb unclaimed') && html.includes('ncm-sh2-sec__sp is-t-money') && html.includes('ncm-sh2-sec__sp is-t-tier is-degraded'), 'each band renders its closed summary (meaning + tier colours)');
  ok(/ncm-sh2-sec__sep" aria-hidden="true"> · </.test(html) && !/ncm-sh2-sec__sum"><span class="ncm-sh2-sec__sep/.test(html), 'summary parts join with · (none leading)');
  ok(html.includes('data-action="setShardEntryDamage" data-lv="2"'), 'settable damage pips');
  ok(html.includes('data-action="toggleShardLayer" data-item-id="s-pay" data-layer="login"'), 'the layer chain carries the shard id (block param through #each)');
  ok(html.includes('data-action="damageShard"') && html.includes('data-ig-amount value="12"') && html.includes('data-ig-roll'), 'integrity damage controls');
  ok(!html.includes('data-action="shardOwnership"'), 'no Permissions for a carried shard');
  ok(html.includes('Open Player Authoring') && html.includes('Prices: you approve'), 'On strip renders');
  const offHtml = render({ activeTab: 'shards', shards2: { ...full, auth: { on: false, facts: [] } } });
  ok(offHtml.includes('data-op="authOn"') && offHtml.includes('Set up'), 'Off strip renders Turn on + Set up');
  const bulk = render({ activeTab: 'shards', shards2: { ...full, bulk: true, pickedCount: 2 } });
  ok(bulk.includes('ncm-sh2-split is-bulk') && bulk.includes('data-op="bulkUnconvert"') && bulk.includes('data-action="bulkRelockSelected"') && !bulk.includes('data-sh2-popbtn'), 'bulk toolbar replaces View / Filter / New');
  ok(html.includes('ncm-sh2-view__v">By holder · Name<') && !html.includes('ncm-sh2-pills') && !html.includes('ncm-sh2-badge'), 'idle toolbar: View label, no pills, no badge');
  const filt = render({ activeTab: 'shards', shards2: { ...full, filterCount: 2, pills: [{ op: 'filter', value: 'locked', label: 'Locked', icon: 'fa-lock', tone: '' }, { op: 'filter', value: 'dmg', label: 'Damaged', icon: 'fa-bolt', tone: 'attn' }] } });
  ok(filt.includes('ncm-sh2-badge">2<') && (filt.match(/class="ncm-sh2-pill[ "]/g) || []).length === 2 && filt.includes('data-op="clearFilters"') && filt.includes('data-filter="dmg"'), 'active filters: badge + removable pills + Clear all');
  const none = render({ activeTab: 'shards', shards2: { ...full, groups: [], hasShards: false, detail: null } });
  ok(none.includes('No data shards yet') && none.includes('Nothing selected'), 'empty world states');
  const nm = render({ activeTab: 'shards', shards2: { ...full, groups: [], noMatch: true, detail: null } });
  ok(nm.includes('No shards match') && nm.includes('data-op="clearSearch"'), 'no-match state offers a reset');
  const nm2 = render({ activeTab: 'shards', shards2: { ...full, groups: [], noMatch: true, noMatchWhy: 'Locked, Damaged', detail: null } });
  ok(nm2.includes('Hidden by <b>Locked, Damaged</b>'), 'no-match names the filters');
  const bal = (s) => (s.match(/<div\b/g) || []).length === (s.match(/<\/div>/g) || []).length;
  ok(bal(html) && bal(offHtml) && bal(bulk) && bal(none), 'div tags balance in every render');
  tab._selId = 's-cache';
  const w = render({ activeTab: 'shards', shards2: tab.prepareContext().shards2 });
  ok(w.includes('data-action="shardOwnership" data-item-id="s-cache"'), 'Permissions for a world shard');
  // NCM_DUMP_CTX=<file> writes the render context for a headless preview harness.
  if (process.env.NCM_DUMP_CTX) { const cache = tab.prepareContext().shards2; tab._filters.add('locked'); tab._filters.add('eb'); tab._ownerFilter = 'world'; const filt = tab.prepareContext().shards2; tab._filters.clear(); tab._ownerFilter = 'all'; fs.writeFileSync(process.env.NCM_DUMP_CTX, JSON.stringify({ pay: full, cache, filt })); }
}

console.log(`test-admin-shards: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
