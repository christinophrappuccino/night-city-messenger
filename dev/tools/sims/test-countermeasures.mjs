// Sim: COUNTERMEASURE VISIBILITY (2026-10-27, mock dev/mockups/countermeasure-visibility-mock.html).
// Drives the pure rules (utils/countermeasures.js), the Foundry glue
// (utils/countermeasureView.js: the expert check through the REAL canOperate,
// the override editor's wire/read over a fake DOM), renders the REAL override
// partial + the REAL auth dialog through Handlebars and asserts that a
// layperson's DOM never carries the ICE name, its damage or a hidden DV, and
// guards the wiring (dialog actions, Roll Reveal hideDV, the three editor hosts,
// the setting, the stylesheet).
// Run: node dev/tools/sims/test-countermeasures.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ═══ 1. Pure rules ═══
const C = await imp('scripts/utils/countermeasures.js');
const d = C.sanitizeCmvConfig(undefined);
ok(d.mode === 'open' && d.hideDV === true && d.scan.dv === 15 && d.scan.identifyBy === 5, 'defaults: open, scan DV 15, identify by 5, hide DV on');
ok(C.sanitizeCmvConfig({ mode: 'nonsense' }).mode === 'open', 'unknown mode → open');
const s = C.sanitizeCmvConfig({ mode: 'both', scan: { skills: ['Interface', 'Interface', ''], dv: 99, identifyBy: -3 }, expert: { skills: [{ name: 'Interface', min: 40 }, { name: '' }], roles: ['Netrunner'] } });
ok(s.scan.skills.length === 1 && s.scan.dv === 40 && s.scan.identifyBy === 0, 'scan skills de-duped, DVs clamped');
ok(s.expert.skills.length === 1 && s.expert.skills[0].min === 10, 'expert skills cleaned + rank clamped');
ok(C.sanitizeCmvOverride(null).visibility === 'inherit' && C.sanitizeCmvOverride({ scanDV: '' }).scanDV === null, 'override defaults to inherit, blank scan DV = null');
ok(C.sanitizeCmvOverride({ visibility: 'weird', dv: 'x', scanDV: 18 }).scanDV === 18, 'override sanitised');
ok(!C.expertHasRule({}) && C.expertHasRule({ roles: ['x'] }), 'an empty expert rule names nobody');
ok(C.expertGate({ roles: ['Netrunner'] }).allowGM === false && C.expertGate({}).mode === 'gated', 'expert gate is gated, GM escape off');

const W = { mode: 'both', expert: { roles: ['Netrunner'] }, scan: { skills: ['Interface'], dv: 14, identifyBy: 5 } };
const R = (cfg, ov, f) => C.resolveCountermeasures(cfg, ov, f);
ok(R({ mode: 'open' }, null, {}).state === 'open' && R({ mode: 'open' }, null, {}).showDV, 'open world: everyone sees all + the DV');
ok(R({ mode: 'open' }, { dv: 'hidden' }, {}).showDV === false, 'open world + per-object DV hidden');
ok(R({ mode: 'open' }, { visibility: 'concealed' }, {}).state === 'unknown', 'Concealed in an open world → hidden (experts + scan)');
ok(R({ mode: 'open' }, { visibility: 'concealed' }, {}).canScan === true, 'Concealed in an open world can be scanned');
ok(R(W, { visibility: 'visible' }, {}).state === 'open', 'Always visible beats the world');
ok(R(W, null, { isGM: true }).state === 'identified' && R(W, null, { isGM: true }).showDV, 'the GM sees everything');
const lay = R(W, null, {});
ok(lay.state === 'unknown' && lay.canScan && !lay.showDV && !lay.show.iceDetail && !lay.show.attempts, 'layperson: unknown, can scan, no DV, no details');
ok(R(W, null, { isExpert: true, expertLabel: 'Netrunner' }).credit === 'Identified · Netrunner', 'expert identified with credit');
ok(R({ ...W, mode: 'scan' }, null, { isExpert: true }).state === 'unknown', 'scan-only mode: expertise does not count');
ok(R({ ...W, mode: 'experts' }, null, {}).canScan === false, 'experts-only mode: nobody can scan');
ok(R(W, null, { scan: { total: 19 } }).state === 'identified', 'scan beating DV by 5 → identified');
ok(R(W, null, { scan: { total: 19 } }).showDV, 'identified by scan → DV shown');
const sp = R(W, null, { scan: { total: 15 } });
ok(sp.state === 'spotted' && sp.show.ice && sp.show.trace && !sp.show.iceDetail && !sp.showDV, 'scan 15 vs 14 → spotted: ICE running + trace, not which, no DV');
const miss = R(W, null, { scan: { total: 9 } });
ok(miss.state === 'unknown' && miss.scanFailed && !miss.canScan, 'a missed scan → blind, and no second try');
ok(R(W, { scanDV: 20 }, { scan: { total: 19 } }).state === 'unknown', 'per-object scan DV raises the bar');
ok(R(W, null, { attemptsUsed: 1 }).show.attemptsCount === true, 'the first failure tells you the attempt count');
ok(R(W, { dv: 'shown' }, {}).showDV === true, 'per-object DV shown beats the world hide');
ok(R({ ...W, hide: { ice: false, iceDetail: false, attempts: false, trace: false } }, null, {}).show.iceDetail, 'unticking a hide shows it to laypeople');

const lock = { icePresent: true, iceName: 'Hellhound', formula: '3d6', failureMode: 'damage', traced: true, maxAttempts: 3 };
const roLay = C.cmvReadout(lay, lock);
ok(roLay.length === 4 && roLay.every((c) => !c.known), 'layperson readout: four redacted cells');
ok(!JSON.stringify(roLay).includes('Hellhound') && !JSON.stringify(roLay).includes('3d6'), 'layperson readout carries no ICE name or damage');
const roSp = C.cmvReadout(sp, lock);
ok(roSp[0].known && roSp[0].text === 'Running' && !roSp[1].known && roSp[2].text === 'Yes' && roSp[3].text === 'Limited', 'spotted readout: Running · ? · Yes · Limited');
ok(!JSON.stringify(roSp).includes('Hellhound'), 'spotted readout carries no ICE name');
const roId = C.cmvReadout(R(W, null, { isGM: true }), lock);
ok(roId[0].text === 'Hellhound' && roId[1].text === '3d6 to HP' && roId[3].text === '3', 'identified readout names everything');
ok(/GM always sees everything/.test(C.cmvSummary(W, ['Netrunners'])) && /Netrunners see/.test(C.cmvSummary(W, ['Netrunners'])), 'summary sentence');
ok(/nobody qualifies/.test(C.cmvSummary({ mode: 'experts' }, [])), 'summary says when nobody is an expert');
ok(C.cmvChip({ mode: 'open' }).off && C.cmvChip(W).dvHidden, 'fold chip');
C.rememberScan('A1', 'net1', 17);
ok(C.recallScan('A1', 'net1')?.total === 17 && C.recallScan('A1', 'net2') === null && C.recallScan('A2', 'net1') === null, 'scan memory per actor + object');
C.forgetScans();
ok(C.recallScan('A1', 'net1') === null, 'forgetScans');

// ═══ 2. Foundry glue — the real canOperate through countermeasureView ═══
const settings = new Map();
globalThis.game = {
  user: { isGM: false, character: null },
  settings: { get: (m, k) => { if (!settings.has(k)) throw new Error('unregistered'); return settings.get(k); } },
  actors: { get: () => null, contents: [] }, users: [],
  nightcity: { skillService: { getSkillData: (a, n) => ({ skillLevel: (a.skills || {})[n] || 0 }) } },
};
globalThis.foundry = { utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), mergeObject: (a, b) => ({ ...a, ...b }) } };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
const V = await imp('scripts/utils/countermeasureView.js');
ok(V.getCmvConfig().mode === 'open', 'unregistered setting → defaults');
settings.set('countermeasureVisibility', { mode: 'both', expert: { roles: ['Netrunner'], skills: [{ name: 'Interface', min: 4 }] }, scan: { skills: ['Interface'], dv: 14 } });
const runner = { id: 'R', items: [{ type: 'role', name: 'Netrunner' }] };
const solo = { id: 'S', items: [{ type: 'role', name: 'Solo' }], skills: { Interface: 2 } };
const deckhead = { id: 'D', items: [], skills: { Interface: 5 } };
ok(V.isCmvExpert(runner) && V.isCmvExpert(deckhead) && !V.isCmvExpert(solo), 'expert by role OR skill rank, not otherwise');
ok(!V.isCmvExpert(runner, { ...V.getCmvConfig(), expert: { roles: [], skills: [], itemGroups: [], actors: [] } }), 'empty expert rule → nobody');
ok(V.cmvForViewer({ actor: runner, key: 'k' }).credit === 'Identified · Netrunner', 'cmvForViewer credits the role');
ok(V.cmvForViewer({ actor: solo, key: 'k' }).state === 'unknown', 'cmvForViewer: a solo is a layperson');
C.rememberScan('S', 'k', 20);
ok(V.cmvForViewer({ actor: solo, key: 'k' }).state === 'identified', 'cmvForViewer reads the remembered scan');
game.user.isGM = true;
ok(V.cmvForViewer({ actor: null, key: 'k' }).state === 'identified', 'GM always identified');
game.user.isGM = false;
const ctxO = V.cmvOverrideContext({ visibility: 'concealed', scanDV: 18 }, 'network');
ok(ctxO.visOpts.find((o) => o.on).value === 'concealed' && ctxO.scanDV === 18 && ctxO.worldScanDV === 14, 'override context');
ok(/scan it at DV 18/.test(ctxO.verdict) && /expert/.test(ctxO.verdict), 'override verdict names expert + scan DV');
ok(/Everyone sees/.test(V.cmvOverrideVerdict({ visibility: 'visible' })), 'Always visible verdict');

// fake DOM for wire/read
function seg(group, values, on) {
  const spans = values.map((v) => ({ dataset: { value: v }, classList: cls(v === on ? ['on'] : []), setAttribute() {}, closest: (sel) => (sel === '[data-cmv-seg]' ? groupEl : null) }));
  const groupEl = { dataset: { cmvSeg: group }, querySelectorAll: () => spans, spans };
  return groupEl;
}
function cls(init) { const set = new Set(init); return { contains: (c) => set.has(c), toggle: (c, f) => (f ? set.add(c) : set.delete(c)), add: (c) => set.add(c), remove: (c) => set.delete(c) }; }
const visG = seg('visibility', ['inherit', 'visible', 'concealed'], 'inherit');
const dvG = seg('dv', ['inherit', 'shown', 'hidden'], 'inherit');
const num = { value: '', addEventListener() {} };
const verdict = { textContent: '' };
const listeners = {};
const box = {
  dataset: { noun: 'shard' },
  matches: (s) => s === '[data-cmv-ovr]',
  addEventListener: (t, f) => { listeners[t] = f; },
  contains: () => true,
  querySelector: (sel) => {
    if (sel === '[data-cmv-scandv]') return num;
    if (sel === '[data-cmv-verdict]') return verdict;
    const m = sel.match(/\[data-cmv-seg="(\w+)"\] \[data-value\]\.on/);
    if (m) return (m[1] === 'visibility' ? visG : dvG).spans.find((x) => x.classList.contains('on')) || null;
    return null;
  },
  querySelectorAll: () => [],
};
V.wireCmvOverride(box);
ok(box.dataset.cmvWired === '1' && /Security unreadable/.test(verdict.textContent), 'wire paints the verdict (Inherit under the Experts + Scan world)');
num.value = '19';
const pick = visG.spans[2];
listeners.click({ target: { closest: (sel) => (sel.includes('[data-value]') ? pick : null) }, preventDefault() {} });
num.value = '19';
const st = V.readCmvOverride(box);
ok(st.visibility === 'concealed' && st.scanDV === 19 && st.dv === 'inherit', 'click a segment + type a DV → read back');
ok(/DV 19/.test(verdict.textContent), 'verdict repaints live');
ok(V.readCmvOverride({ matches: () => false, querySelector: () => null }) === null, 'read returns null when the block is absent');

// ═══ 3. REAL renders through Handlebars ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars;
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  H.registerHelper('ncm-net-icon', () => new H.SafeString('<i class="fas fa-wifi"></i>'));
  const part = H.compile(read('templates/partials/countermeasure-override.hbs'))({ cmv: ctxO });
  ok(part.includes('data-cmv-ovr') && part.includes('data-value="concealed"') && /class="on" data-value="concealed"/.test(part), 'override partial renders with Concealed on');
  ok(part.includes('value="18"') && !/name="/.test(part), 'override partial: scan DV shown, controls unnamed');

  const dlg = H.compile(read('templates/dialogs/network-auth-dialog.hbs'));
  const baseCtx = {
    network: { name: 'CorpNet', typeLabel: 'Corporate Subnet', securityLevel: 'HIGH', securityTagClass: 'danger', theme: {}, color: '#4488ff' },
    hasPassword: true, hasSkillBypass: true, showPolicy: true, showOrBeforeSkill: true,
    bypassSkills: [{ name: 'Interface', dc: '??', danger: '', statName: 'TECH', statValue: 6, skillValue: 4, total: 10 }],
    bypassDCLabel: '??', attemptPips: [], isLethalICE: false,
  };
  const layHtml = dlg({ ...baseCtx, cmv: { isHidden: true, readout: roLay, canScan: true, scanSkills: [{ name: 'Interface', statName: 'TECH', statValue: 6, skillValue: 4, total: 10 }], scanCount: 1, scanDVLabel: '??', showDV: false, showAttempts: false } });
  ok(layHtml.includes('Security unreadable') && layHtml.includes('ncm-cmv-redact'), 'layperson dialog: unreadable panel + redactions');
  ok(layHtml.includes('data-action="scanDefences"') && layHtml.includes('data-action="toggleCmvScan"'), 'layperson dialog: the scan strip');
  ok(!/Hellhound|3d6|\b17\b/.test(layHtml), 'layperson dialog DOM carries no ICE name, damage or DV');
  ok(layHtml.includes('DV ??') && !layHtml.includes('ncm-auth__pips"'), 'DV ?? and no attempt pips');
  const spHtml = dlg({ ...baseCtx, cmv: { isHidden: true, isSpotted: true, readout: roSp, canScan: false, showAttempts: false } });
  ok(spHtml.includes('Defences detected') && spHtml.includes('ncm-cmv-sec--spotted') && !spHtml.includes('scanDefences'), 'spotted dialog');
  const idHtml = dlg({ ...baseCtx, bypassDCLabel: '17', isLethalICE: true, iceInfo: { name: 'Hellhound', formula: '3d6' }, iceDealsDamage: true, attemptPips: [{ state: 'current' }], cmv: { isHidden: false, credit: 'Identified · Netrunner', showAttempts: true } });
  ok(idHtml.includes('Hellhound') && idHtml.includes('ncm-cmv-credit') && idHtml.includes('Identified · Netrunner') && !idHtml.includes('ncm-cmv-sec '), 'identified dialog: ICE panel + credit, no readout');
}

// ═══ 4. Wiring guards ═══
const dlgJs = read('scripts/ui/NetworkManagement/NetworkAuthDialog.js');
ok(/toggleCmvScan: NetworkAuthDialog\._onToggleCmvScan/.test(dlgJs) && /scanDefences: NetworkAuthDialog\._onScanDefences/.test(dlgJs), 'dialog registers both actions');
ok(/_applyCountermeasures\(ctx, network/.test(dlgJs) && /ctx\.isLethalICE = false/.test(dlgJs), 'dialog strips ICE from the context for laypeople');
ok(/hideDV: this\._cmv \? !this\._cmv\.showDV/.test(dlgJs), 'bypass roll hides the DV in the Roll Reveal');
ok(/rememberScan\(actor\.id, this\.networkId, res\.total\)/.test(dlgJs), 'scan is remembered');
ok(/'Security' : \(this\.network\.security\.encryptionType/.test(dlgJs), 'chat flavour does not name the ICE for a layperson');
const rr = read('scripts/ui/content/RollReveal.js');
ok(/DV \$\{o\.hideDV \? '\?\?' : esc\(dv\)\}/.test(rr) && /if \(o\.hideDV && els\.dvtag\) els\.dvtag\.textContent = `DV \$\{dv\}`/.test(rr), 'Roll Reveal: DV ?? until the verdict, then the DV');
ok(/typeof w === 'function' \? w\(r\)/.test(rr), 'Roll Reveal: a verdict word may depend on the result');
ok(/hideDV: !!reveal\.hideDV/.test(read('scripts/services/SkillService.js')), 'SkillService forwards hideDV');
ok(/countermeasure-override\.hbs" cmv=cmvOverride/.test(read('templates/terminal/partials/config-account.hbs')), 'terminal account editor includes the override');
const tca = read('scripts/ui/Terminal/TerminalConfigApp.js');
ok(/cmvOverride: cmvOverrideContext\(s\.countermeasures, 'account'\)/.test(tca) && /wireCmvOverride\(editor/.test(tca) && /countermeasures: cm/.test(tca), 'terminal config: context + wire + save');
ok(/countermeasure-override\.hbs" cmv=cmvOverride/.test(read('templates/item-inbox/item-inbox-config.hbs')), 'shard config includes the override');
const iic = read('scripts/ui/ItemInbox/ItemInboxConfig.js');
ok(/cmvOverrideContext\(config\.countermeasures, 'shard'\)/.test(iic) && /wireCmvOverride\(el\)/.test(iic) && /countermeasures: readCmvOverride\(el\)/.test(iic), 'shard config: context + wire + save');
const iia = read('scripts/ui/ItemInbox/ItemInboxApp.js');
ok(/_applyShardCountermeasures\(ctx, config, session, actor\)/.test(iia) && /data-dc="\$\{hideDV \? '' : dc\}"/.test(iia), 'shard viewer + breach dialog apply the state (no DV in the DOM)');
ok(/const iceName = knowsIce \?/.test(iia), 'shard breach sequence does not name unknown ICE');
ok(/CMV_OVERRIDE: `\$\{T\}\/partials\/countermeasure-override\.hbs`/.test(read('scripts/utils/constants.js')), 'partial is in TEMPLATES (preloaded)');
ok(/register\(MODULE_ID, 'countermeasureVisibility', \{\s*name: 'Countermeasure Visibility',/.test(read('scripts/core/SettingsManager.js')), 'world setting registered with a literal name');
ok(/@import 'components\/countermeasures\.css';/.test(read('styles/night-city-messenger.css')), 'stylesheet imported');
const css = read('styles/components/countermeasures.css');
const usedCls = new Set([...(read('templates/partials/countermeasure-override.hbs') + read('templates/dialogs/network-auth-dialog.hbs') + read('templates/admin-panel/tab-security.hbs') + iia).matchAll(/ncm-(?:cmv|hd-cmv)[a-z0-9_-]*/g)].map((m) => m[0]).filter((c) => !c.endsWith('-')));
for (const c of usedCls) ok(css.includes(`.${c}`) || read('styles/components/admin-panel/tab-security.css').includes(`.${c}`), `.${c} is styled`);

console.log(`\ntest-countermeasures: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
