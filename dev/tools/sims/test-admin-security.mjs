// Sim: Admin → SECURITY redesign (2026-10-27, mock dev/mockups/admin-security-redesign-mock.html).
// Drives the REAL SecurityTab over mocked globals: the sub-tab context, the Live
// queue, the rule folds, every data-op the template fires is handled by onAct,
// every context key the template reads is produced, every class it uses is
// styled, the countermeasure save path, the contact deep-link, the d20 glyph —
// then renders the REAL template through Handlebars for each view.
// Run: node dev/tools/sims/test-admin-security.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ── mocked world ──
const settings = new Map(Object.entries({
  operatorGate: { mode: 'gated', roles: ['Netrunner'], skills: [{ name: 'Interface', min: 4 }] },
  hackResolution: 'flagged', roleAbilityRoll: 'stat',
  countermeasureVisibility: { mode: 'both', expert: { roles: ['Netrunner'] }, scan: { skills: ['Interface'], dv: 14 } },
  securityLogSeen: 0, securityAlertLevel: 'serious',
}));
const writes = [];
const now = Date.now();
const log = [
  { id: 'L1', ts: new Date(now - 60000).toISOString(), actorId: 'A1', actorName: 'Rache', action: 'net-hack', objectId: 'N1', objectName: 'CorpNet', targetKind: 'network', outcome: 'failure', severity: 'major', dv: 17, margin: -4, netVerb: 'Backdoor' },
  { id: 'L2', ts: new Date(now - 120000).toISOString(), actorId: 'A2', actorName: 'V', action: 'cmv-scan', objectId: 'N1', objectName: 'CorpNet', targetKind: 'network', outcome: 'success', severity: 'minor', dv: 14, margin: 5 },
];
const opened = [];
globalThis.game = {
  user: { isGM: true },
  settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => { writes.push([k, v]); settings.set(k, v); } },
  actors: Object.assign([], { get: (id) => ({ A1: { id: 'A1', name: 'Rache' } })[id] || null, contents: [] }),
  items: Object.assign([], { get: () => null }), users: [],
  nightcity: {
    traceService: {
      getLog: () => log, getHeat: () => 72, getHeatMap: () => ({ N1: { A1: 72 } }),
      getCountdowns: () => [{ id: 'C1', actorName: 'V', objectName: 'WS-7', source: 'Arasaka', expiresAt: now + 14 * 60000 }],
      getRecycleBin: () => [],
    },
    terminalService: null,
    networkService: { getNetwork: (id) => (id === 'N1' ? { name: 'CorpNet' } : null) },
    timeService: { getCurrentTimeMs: () => now, getProviderInfo: () => ({ effective: 'real-time' }) },
    openAdminTab: async (tab, o) => { opened.push([tab, o]); },
  },
};
globalThis.foundry = { utils: { debounce: (f) => f, deepClone: (x) => JSON.parse(JSON.stringify(x)) } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.Handlebars = { escapeExpression: (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) };
globalThis.CSS = { escape: (s) => s };

const { SecurityTab } = await imp('scripts/ui/AdminPanel/tabs/SecurityTab.js');
let renders = 0;
const app = { id: 'ncm-admin', _activeTab: 'security', render: () => { renders++; }, element: null, tabs: {} };
const tab = new SecurityTab(app);

// ═══ 1. context per view ═══
let ctx = tab.prepareContext().security;
ok(ctx.view === 'live' && ctx.isLive, 'opens on Live');
ok(ctx.nav.length === 5 && ctx.nav.map((n) => n.key).join() === 'live,activity,heat,machines,rules', 'five sub-tabs in order');
ok(ctx.nav.find((n) => n.key === 'live').count === 2 && ctx.nav.find((n) => n.key === 'live').cls === 'hot', 'Live count = countdowns + hot + armed');
ok(ctx.nav.find((n) => n.key === 'activity').count === 2 && ctx.nav.find((n) => n.key === 'activity').cls === 'new', 'Activity count = new rows');
ok(ctx.queue.countdowns.length === 1 && ctx.queue.hot.length === 1 && ctx.queue.hot[0].value === 72 && !ctx.queue.empty, 'Needs your call: the countdown + the HOT operator');
ok(ctx.peek.length === 2 && ctx.peek[0].actionLabel === 'Scanned the defences' && ctx.peek[1].actionLabel === 'Network bypass', 'latest activity, log order reversed (getLog is oldest-first), plain labels (incl. the scan)');
ok(ctx.stats.countdowns === 1 && ctx.stats.hot === 1, 'stats: traces running + running hot');
ok(ctx.rules.resLabel === '+ NET card' && ctx.rules.res.find((o) => o.on).value === 'flagged', 'resolution summary');
ok(/Only Netrunner or Interface 4\+/.test(ctx.rules.opSummary.text), `operator access summary (${ctx.rules.opSummary.text})`);
ok(ctx.rules.cmv.modes.find((m) => m.on).value === 'both' && ctx.rules.cmv.chip.dvHidden, 'countermeasure card: mode + chip');
ok(/Netrunners see every defence/.test(ctx.rules.cmv.summary), 'countermeasure summary sentence');
ok(ctx.rules.cmv.roleChips[0].name === 'Netrunner' && ctx.rules.cmv.scanSkills[0] === 'Interface' && !ctx.rules.cmv.scanSkillOpts.includes('Interface'), 'chips + the add list excludes chosen skills');
ok(ctx.rules.role.label === 'Stat + rank', 'role ability rolls summary');
tab.openTo('heat');
ok(tab.prepareContext().security.isHeat, 'openTo(view) opens that view');
tab.openTo('nonsense');
ok(tab._view === 'heat', 'openTo ignores an unknown view');

// ═══ 2. onAct ops ═══
await tab.onAct('view', {}, { dataset: { view: 'rules' } });
ok(tab._view === 'rules' && renders > 0, 'op view switches + renders');
const card = { dataset: { fold: 'cmv' }, classList: { _o: false, contains() { return this._o; }, toggle(c, f) { this._o = f; } } };
const hd = { dataset: {}, closest: (s) => (s === '[data-fold]' ? card : { setAttribute() {} }) };
const before = renders;
await tab.onAct('fold', {}, hd);
ok(tab._folds.has('cmv') && card.classList._o && renders === before, 'op fold: DOM-only, remembered, no re-render');
ok(tab.prepareContext().security.rules.folds.cmv, 'fold state rides the next render');
await tab.onAct('hackres', {}, { dataset: { value: 'gm' } });
ok(writes.some(([k, v]) => k === 'hackResolution' && v === 'gm'), 'op hackres saves the setting');
await tab.onAct('roleRoll', {}, { dataset: { value: 'rank' } });
ok(writes.some(([k, v]) => k === 'roleAbilityRoll' && v === 'rank'), 'op roleRoll saves the setting');

// countermeasure save through a fake card DOM
const q = (map) => (sel) => map[sel] ?? null;
const chip = (name) => ({ dataset: { name } });
const cmvCard = {
  querySelector: q({
    '[name="cmvMode"]:checked': { value: 'scan' }, '[name="cmvScanDV"]': { value: '18' }, '[name="cmvIdentifyBy"]': { value: '4' },
    '[name="cmvFailTraced"]': { checked: true }, '[name="cmvHideIce"]': { checked: false }, '[name="cmvHideIceDetail"]': { checked: true },
    '[name="cmvHideAttempts"]': { checked: true }, '[name="cmvHideTrace"]': { checked: false }, '[name="cmvHideDV"]': { checked: false },
  }),
  querySelectorAll: (sel) => ({
    '[data-cmv-roles] [data-name]': [chip('Netrunner'), chip('Tech')],
    '[data-cmv-skill-row]': [{ querySelector: (s) => (s.includes('skmin') ? { value: '6' } : { value: 'Electronics/Security Tech' }) }],
    '[data-cmv-gear] [data-name]': [chip('Cyberdeck')],
    '[data-cmv-scan] [data-name]': [chip('Interface'), chip('Basic Tech')],
  })[sel] || [],
};
app.element = { querySelector: (s) => (s === '[data-cmv-card]' ? cmvCard : null), querySelectorAll: () => [] };
await tab.onAct('cmvSave', {}, { dataset: {} });
const saved = settings.get('countermeasureVisibility');
ok(saved.mode === 'scan' && saved.scan.dv === 18 && saved.scan.identifyBy === 4 && saved.scan.failTraced, 'cmvSave: mode + scan block');
ok(saved.expert.roles.join() === 'Netrunner,Tech' && saved.expert.skills[0].min === 6 && saved.expert.itemGroups[0][0].name === 'Cyberdeck', 'cmvSave: expert rule');
ok(saved.scan.skills.join() === 'Interface,Basic Tech' && saved.hide.ice === false && saved.hide.iceDetail === true && saved.hideDV === false, 'cmvSave: scan skills, hides, DV');

// contact deep link
await tab.onJump({}, { dataset: { kind: 'contact', contact: 'MC9' } });
ok(opened.some(([t, o]) => t === 'contacts' && o?.select === 'MC9'), 'contact ↗ opens Admin → Contacts on that contact');

// ═══ 3. template ↔ tab drift guards ═══
const tpl = read('templates/admin-panel/tab-security.hbs');
const js = read('scripts/ui/AdminPanel/tabs/SecurityTab.js');
const ops = new Set([...(tpl + js).matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1]));
const onAct = js.slice(js.indexOf('async onAct('), js.indexOf('async _saveSetting('));
for (const o of ops) ok(onAct.includes(`case '${o}'`), `data-op "${o}" is handled by onAct`);
const appJs = read('scripts/ui/AdminPanel/AdminPanelApp.js');
const acts = new Set([...tpl.matchAll(/data-action="([a-zA-Z]+)"/g)].map((m) => m[1]));
for (const a of acts) ok(new RegExp(`^\\s+${a}: AdminPanelApp\\._`, 'm').test(appJs), `action "${a}" is registered on the panel`);
const ctxNow = tab.prepareContext().security;
const reads = new Set([...tpl.matchAll(/security\.([a-zA-Z]+)/g)].map((m) => m[1]));
for (const k of reads) ok(k in ctxNow, `context produces security.${k}`);
for (const k of ['res', 'resLabel', 'opSummary', 'role', 'cmv', 'folds']) ok(tpl.includes(`security.rules.${k}`), `template reads security.rules.${k}`);
ok(!/fa-dice-d10/.test(tpl + read('scripts/ui/content/SecurityConsole.js') + read('scripts/ui/content/SystemSweep.js')), 'no fa-dice-d10 left (not in FA free)');
ok(!/GMContactManagerApp/.test(js), 'the tab no longer opens the retired GM Contact Manager window');
ok(/data-cmv-skill-row/.test(js) && /data-gate-skill-row/.test(js), 'the two rule cards keep separate skill-row markers');

// every class used is styled
const css = read('styles/components/admin-panel/tab-security.css') + read('styles/components/countermeasures.css');
const used = new Set([...tpl.matchAll(/ncm-sec-admin-[a-z0-9_-]+/g)].map((m) => m[0]).filter((c) => !c.endsWith('-')));
for (const c of used) ok(css.includes(`.${c}`), `.${c} is styled`);
const shortCls = ['qi', 'qt', 'qd', 'qa', 'sum', 'chev', 'lede', 'go', 'txt'];
for (const c of shortCls) ok(new RegExp(`\\.${c}\\b`).test(read('styles/components/admin-panel/tab-security.css')), `.${c} is styled`);

// ═══ 4. REAL render through Handlebars ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!H) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('gt', (a, b) => Number(a) > Number(b));
  H.registerHelper('letter', (i) => String.fromCharCode(65 + Number(i)));
  H.registerHelper('ncm-hue', (t) => (t ? 'var(--ncm-hue-1)' : 'var(--ncm-text-label)'));
  const render = H.compile(tpl);
  for (const v of ['live', 'activity', 'heat', 'machines', 'rules']) {
    tab._view = v;
    const html = render({ activeTab: 'security', security: tab.prepareContext().security });
    ok(html.includes(`data-view="${v}"`) && new RegExp(`ncm-sec-admin-navbtn on"[^>]*data-view="${v}"`).test(html), `${v}: renders with its sub-tab lit`);
    if (v === 'live') ok(html.includes('Arasaka is closing in on V') && html.includes('Rache is running hot') && html.includes('Scanned the defences'), 'live: queue + peek');
    if (v === 'activity') ok(html.includes('ncm-sec-admin-scroll--log') && html.includes('Ping me: serious') && html.includes('Backdoor'), 'activity: the log + ping select + NET verb');
    if (v === 'heat') ok(html.includes('ncm-sec-admin-hx__g') && html.includes('data-op="heatPick"') && html.includes('data-action="securityEscalate"'), 'heat: the thermometers + Escalate for the picked operator');
    if (v === 'activity') ok(html.includes('data-sg-plot') && html.includes('data-scope-btn'), 'activity: the seismograph + its toolbar pickers');
    if (v === 'machines') ok(html.includes('Nothing planted.') && html.includes('Bin is empty.'), 'machines: empty states');
    if (v === 'rules') ok(html.includes('data-cmv-card') && html.includes('name="cmvMode"') && html.includes('name="gateMode"') && html.includes('data-op="roleRoll"'), 'rules: cmv card + gate editor + role rolls');
  }
  ok(render({ activeTab: 'messages', security: ctxNow }).trim() === '', 'renders nothing on another tab');
  // NCM_DUMP=<file.json> writes each view's real context, for a headless render harness
  if (process.env.NCM_DUMP) {
    const dump = {};
    for (const v of ['live', 'activity', 'heat', 'machines', 'rules']) { tab._view = v; dump[v] = tab.prepareContext().security; }
    fs.writeFileSync(process.env.NCM_DUMP, JSON.stringify(dump));
  }
}

console.log(`\ntest-admin-security: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
