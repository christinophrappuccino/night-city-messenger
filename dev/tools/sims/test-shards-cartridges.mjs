// Sim: Admin → Shards cartridge list + detail (2026-10-28, mock
// dev/mockups/admin-shards-modules-mock.html frame B-left). Drives the PURE rules in
// scripts/ui/AdminPanel/tabs/shardsModel.js, then renders the REAL tab-shards.hbs
// through Foundry's Handlebars with a context built from those rules, and guards the
// wiring the template + tab + stylesheet must agree on.
// Run: node dev/tools/sims/test-shards-cartridges.mjs
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import { createRequire } from 'module';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };

const M = await import(pathToFileURL(`${ROOT}/scripts/ui/AdminPanel/tabs/shardsModel.js`).href);
const IM = await import(pathToFileURL(`${ROOT}/scripts/ui/content/IntegrityModel.js`).href);

// ═══ 1. State lights + notches ═══
ok(M.stateOf('blackice').light === 'ice' && M.stateOf('destroyed').light === 'bricked' && M.stateOf('nonsense').light === 'locked', 'state → light (unknown reads as locked)');
ok(M.stateOf('locked').tone === 'is-secret' && M.stateOf('blackice').tone === 'is-bad' && M.stateOf('breached').tone === 'is-good', 'state pills wear their meaning (lock violet, ICE red, breached green)');
let n = M.notchStates([]);
ok(n.length === 5 && n.every(x => !x.cls) && n.map(x => x.key).join() === 'net,key,login,enc,ice', 'five notches, all dark for an open shard');
n = M.notchStates([{ key: 'network', small: 'CitiNet', cleared: false }, { key: 'login', cleared: true }, { key: 'encryption', small: 'DV 20', ice: true, cleared: false }]);
ok(n[0].cls === 'is-lock is-next' && n[0].next && /CitiNet/.test(n[0].tip) && /next lock/.test(n[0].tip), 'network notch: a lock like its breach-path stop (violet), the first uncleared one carries the amber "next" ring, names the net');
ok(!n[1].cls && n[2].cls === 'is-ok' && /cleared/.test(n[2].tip), 'missing key item dark; cleared login green');
ok(n[3].cls === 'is-ice' && n[4].cls === 'is-ice' && !n[3].next, 'ICE encryption: enc + ice notches both red (the path draws one red skull stop); ICE is never the amber "next"');
n = M.notchStates([{ key: 'encryption', small: 'DV 20', ice: true, cleared: false }]);
ok(!n.some(x => x.next), 'a shard whose first lock is ICE has no amber notch (matches the path: isNext skips ICE)');
n = M.notchStates([{ key: 'network', cleared: true }, { key: 'encryption', cleared: false }]);
ok(n[0].cls === 'is-ok' && n[3].cls === 'is-lock is-next', 'past a cleared layer, the next standing lock is ringed');

// ═══ 2. Integrity tiers ═══
ok(M.integTier(0).css === 'bricked' && M.integTier(1).css === 'critical' && M.integTier(24).css === 'critical' && M.integTier(25).css === 'unstable' && M.integTier(50).css === 'degraded' && M.integTier(75).css === 'intact' && M.integTier(100).css === 'intact', 'tier bands 0 / 1–24 / 25–49 / 50–74 / 75–100');
for (const p of [0, 1, 24, 25, 49, 50, 74, 75, 100]) ok(M.integTier(p).css === ({ bricked: 'bricked', severe: 'critical', heavy: 'unstable', light: 'degraded', clean: 'intact' })[IM.tierOf(p)], `tiers agree with IntegrityModel.tierOf at ${p}%`);

// ═══ 3. Entry state ═══
let e = M.entryState(0);
ok(e.key === 'whole' && !e.label && e.cells.every(c => !c.lost), 'whole entry: no badge, full battery');
e = M.entryState(0.25);
ok(e.key === 'part' && e.label === '75% left' && e.cells.filter(c => c.lost).length === 1 && e.cells[3].lost, 'a quarter lost: 75% left, the last cell struck');
e = M.entryState(0.5);
ok(e.css === 'unstable' && e.cells.filter(c => c.lost).length === 2, 'half lost reads unstable');
e = M.entryState(1);
ok(e.key === 'lost' && e.label === 'Lost' && e.cells.every(c => c.lost), 'gone: Lost, every cell struck');
ok(M.entryState(0.3).key === 'part' && M.entryState(0.3).pct === 25, 'levels quantize to quarter steps');
ok(M.entryState(0).cells.map(c => c.lv).join() === '4,3,2,1', 'clicking cell i sets damage to the cells from i to the end');

// ═══ 4. Cartridges ═══
const row = (o) => ({ itemId: 'x', name: 'Shard', img: 'a.webp', status: 'locked', ownerKey: 'actor-v', ownerName: 'V’s gear', entryCount: 3, integrityEnabled: true, integrityPercent: 47, layers: [{ key: 'login', cleared: false }], unclaimedEddies: 0, makerName: '', ...o });
let c = M.cartridgeView(row({}), { groupMode: 'status', sort: 'name' });
ok(c.holder === 'V' && c.showHolder && c.files === 3 && c.integ === 47 && c.tierCss === 'unstable' && c.light === 'locked' && c.stateWord === 'Locked', 'cartridge meta: holder, files, integrity %, tier colour, state');
ok(M.cartridgeView(row({}), { groupMode: 'owner' }).showHolder === false, 'grouped by holder → the bay already names the holder');
c = M.cartridgeView(row({ integrityEnabled: false }), {});
ok(c.integ === null && c.tierCss === 'off' && /off/.test(c.stripTip), 'integrity off → a striped strip, no %');
c = M.cartridgeView(row({ status: 'destroyed', integrityPercent: 0, ownerKey: 'world', ownerName: 'World items', makerName: 'Rache', unclaimedEddies: 2500 }), { sort: 'integ' });
ok(c.bricked && c.tierCss === 'bricked' && c.holder === '' && c.madeBy === 'Rache' && c.eb === '2,500' && c.integKey, 'bricked world shard, player-made, unclaimed eb, integrity is the sort key');
const pk = M.peekLights(Array.from({ length: 30 }, (_, i) => ({ light: 'locked', name: 's' + i })));
ok(pk.lights.length === 22 && pk.more === 8, 'a folded bay shows 22 lights then +N');
ok(M.bayColor('status', 'status:blackice') === 'var(--ncm-bad)' && M.bayColor('owner', 'x') === '', 'bay edge: state colour by state, else hued by name');
ok(M.agoLabel(5 * 60000) === '5m ago' && M.agoLabel(3 * 3600000) === '3h ago' && M.agoLabel(2 * 86400000) === '2d ago' && M.agoLabel(0) === '', 'last touched');

// ═══ 5. The integrity module ═══
const cfg = IM.resolveIntegrity({ enabled: true, currentIntegrity: 47, history: [100, 82, 47], lastHit: { by: 'V' }, hardening: 0 });
let iv = M.integrityView(cfg, IM.effectiveHit(cfg.degradePerFailure, cfg.hardening));
ok(iv.pct === 47 && iv.tierCss === 'unstable' && iv.per === 15, 'reads 47 / 100, unstable, 15 per hack');
ok(iv.say.next && iv.say.next.name === 'Critical' && iv.say.next.n === 2 && iv.say.toBrick === 4, 'hacks to the next tier (47 → ≤24 in 2) and to bricked (4)');
ok(iv.scale.length === 4 && iv.scale.find(x => x.on).css === 'unstable' && iv.scale.map(x => x.setTo).join() === '24,49,74,100', 'the ladder: four tiers, the current one lit, each sets its top');
ok(iv.hist.length === 2 && iv.hist[0].d === '-35' && iv.hist[0].cross?.name === 'Unstable' && iv.hist[0].latest && !iv.hist[1].cross, 'history newest first, tier crossings marked');
iv = M.integrityView(IM.resolveIntegrity({ enabled: true, currentIntegrity: 0, history: [30, 0] }), 15);
ok(iv.dead && iv.say.dead && iv.hist[0].kind === 'brick', 'bricked: dead sentence, brick row');
iv = M.integrityView(IM.resolveIntegrity({ enabled: true, currentIntegrity: 100 }), 15);
ok(iv.full && iv.hist.length === 0 && iv.say.toBrick === 7, 'full: nothing to repair, no hits yet');

// ═══ 5b. Entry hues + foldable sections ═══
const CT = await import(pathToFileURL(`${ROOT}/scripts/utils/constants.js`).href).catch(() => null);
const types = CT ? Object.values(CT.CONTENT_TYPES) : Object.keys(M.ENTRY_HUES);
ok(types.length === 18 && types.every(t => /^var\(--ncm-(hue-[1-8]|money)\)$/.test(M.ENTRY_HUES[t] || '')), 'every content type has an entry hue, tokens only');
ok(M.entryHue('eddies') === 'var(--ncm-money)' && Object.entries(M.ENTRY_HUES).filter(([, v]) => v === 'var(--ncm-money)').length === 1, 'money is the eddies drop ONLY; every other type wears a category hue');
ok(!Object.values(M.ENTRY_HUES).some(v => /(bad|secret|good|attn|act)\)/.test(v)), 'no entry type borrows a meaning colour');
ok(M.entryHue('nonsense') === M.ENTRY_HUES.message, 'an unknown type falls back to the message hue');
ok(new Set(['message', 'dossier', 'payload', 'avlog', 'eddies', 'syslog', 'banking'].map(M.entryHue)).size === 7, 'the common types are all different colours');
ok(M.DETAIL_SECTIONS.join() === 'path,integ,ents', 'three foldable detail sections');
c = M.cartridgeView(row({ status: 'blackice', makerName: 'Rache' }), {});
ok(c.stateTone === 'bad' && c.madeByLabel === 'Made by Rache' && M.cartridgeView(row({}), {}).stateTone === 'secret', 'the state word wears the state pill tone; the PM badge hues by the same "Made by" label as the detail tag');

// ═══ 6. Wiring: template · tab · stylesheet ═══
const tpl = read('templates/admin-panel/tab-shards.hbs');
const tab = read('scripts/ui/AdminPanel/tabs/ShardsTab.js');
const css = read('styles/components/admin-panel/tab-shards.css');
ok(/from '\.\/shardsModel\.js'/.test(tab) && /cartridgeView\(/.test(tab) && /integrityView\(/.test(tab) && /entryState\(/.test(tab), 'the tab builds its view from the pure model');
ok(!/ncm-sh2-row\b/.test(tpl) && /ncm-sh2-cart__pins/.test(tpl) && /ncm-sh2-caret/.test(tpl), 'rows are cartridges with pins and a caret');
ok(/data-op="row"/.test(tpl) && /_ejectLive\(/.test(tab) && /_replayEject\(/.test(tab), 'selection ejects on the live DOM, then replays on the new nodes');
ok(/case 'group':[\s\S]{0,700}classList\.toggle\('is-shut'/.test(tab), 'a bay folds DOM-only');
for (const op of ['igOn', 'igOff', 'igRepair', 'igBrick', 'igSalvage', 'igStep']) ok(tpl.includes(`data-op="${op}"`) && new RegExp(`case '${op}'`).test(tab), `integrity op ${op} is wired`);
ok(/repairIntegrity\(item/.test(tab) && /setIntegrity\(item, 0/.test(tab) && /salvageShard\(item/.test(tab) && /updateConfig\?\.\(item, \{ integrity: \{ enabled: on \} \}\)/.test(tab), 'integrity ops call the real DataShardService methods');
ok(/data-action="damageShard"/.test(tpl) && /data-ig-amount/.test(tpl) && /data-action="setShardIntegrity"/.test(tpl) && /data-action="toggleShardLayer"/.test(tpl), 'the existing Damage / set / breach-path actions are kept');
ok(/clip-path: polygon\(13px 0/.test(css) && /grid-template-rows: 0fr/.test(css) && /translate: 10px 0/.test(css), 'cut corners, grid-rows fold, a 10px eject');
ok(/cubic-bezier\(\.22, 1, \.36, 1\)/.test(css) && /prefers-reduced-motion: reduce\)[\s\S]*ncm-sh2-cart/.test(css), 'house motion curve + a reduced-motion veto');
ok(/<header class="ncm-tabhd"><i class="fas fa-microchip"><\/i><div><h2>[^<]+<\/h2><p>[^<]+<\/p><\/div><\/header>/.test(tpl) && tpl.indexOf('ncm-tabhd') < tpl.indexOf('ncm-sh2-tb'), 'the tab opens with the shared title + description, above the toolbar');
ok((tpl.match(/data-op="sec" data-sec="(path|integ|ents)"/g) || []).length === 3 && (tpl.match(/class="ncm-sh2-sec__k" role="button" tabindex="0" aria-expanded=/g) || []).length === 3, 'every detail band is a keyboard-reachable fold toggle with aria-expanded');
ok((tpl.match(/ncm-sh2-sec__body"><div class="ncm-sh2-sec__in">/g) || []).length === 3 && (tpl.match(/ncm-sh2-sec__chev/g) || []).length === 3, 'each section body folds behind its band, with a chevron');
ok(/case 'sec':[\s\S]{0,600}_secShut[\s\S]{0,400}classList\.toggle\('is-shut', shut\)[\s\S]{0,120}aria-expanded/.test(tab), 'a section folds DOM-only and the fold is remembered on the tab (no re-render)');
ok(/shut: Object\.fromEntries\(DETAIL_SECTIONS/.test(tab) && /_secShut = new Set\(DETAIL_SECTIONS\)/.test(tab), 'the folds survive a re-render (detail context carries them); every band starts folded');
// ═══ default folds + closed-band summaries (2026-10-28) ═══
{
  const o = new Set(['b']), c = new Set(['a']);
  ok(!M.bayShut({ index: 0, key: 'w' }) && M.bayShut({ index: 1, key: 'x' }) && M.bayShut({ index: 5, key: 'y' }), 'bays: first open, the rest closed by default');
  ok(M.bayShut({ index: 0, key: 'a', closed: c }) && !M.bayShut({ index: 3, key: 'b', opened: o }), 'the GM choices beat the default both ways');
  ok(!M.bayShut({ index: 0, key: 'a', closed: c, holdsSel: true }) && !M.bayShut({ index: 4, key: 'z', searching: true }), 'the selection bay is forced open; a search opens everything');
  const t = (p) => p.map(x => x.text).join(' · ');
  ok(t(M.pathSummary([])) === 'No locks — anyone can read it', 'path: no locks');
  ok(t(M.pathSummary([{ name: 'Network', cleared: true }, { name: 'Login', cleared: true }, { name: 'Black ICE', ice: true, cleared: false }])) === '2 of 3 open · next: Black ICE' && M.pathSummary([{ name: 'X', cleared: true }, { name: 'Black ICE', ice: true }])[1].tone === 'bad', 'path: "2 of 3 open · next: Black ICE", ICE in red');
  ok(M.pathSummary([{ name: 'Login' }])[1].tone === 'secret' && t(M.pathSummary([{ name: 'Login', cleared: true }])) === 'Breached — its lock is open', 'path: a plain lock is violet; all cleared = breached (green)');
  ok(t(M.pathSummary([{ name: 'Login' }], 2)) === '0 of 1 open · next: Login · 2 failed attempts' && M.pathSummary([{ name: 'Login' }], 1).at(-1).text === '1 failed attempt', 'path: failed attempts ride along (singular / plural)');
  ok(t(M.integSummary(null)) === 'Off' && !M.integSummary(null)[0].tone, 'integrity off: "Off", muted');
  const iv = M.integrityView({ maxIntegrity: 100, currentIntegrity: 40 }, 15);
  ok(t(M.integSummary(iv)) === '40% · Unstable' && M.integSummary(iv).every(x => x.tier === 'unstable'), 'integrity: "40% · Unstable", tier coloured');
  ok(t(M.entsSummary({ count: 5, damaged: 1, unclaimedEb: 200 })) === '5 files · 1 damaged · 200 eb unclaimed', 'entries: "5 files · 1 damaged · 200 eb unclaimed"');
  ok(t(M.entsSummary({ count: 1 })) === '1 file' && t(M.entsSummary({})) === 'Empty', 'entries: zero parts dropped, singular, empty');
  const tones = M.entsSummary({ count: 3, lost: 1, damaged: 1, encrypted: 1, unclaimedEb: 1500 }).map(x => x.tone).join();
  ok(tones === ',bad,attn,secret,money', 'entries: lost red · damaged amber · encrypted violet · eb gold');
  ok((tpl.match(/\{\{> ncmSh2Sum parts=d\.sum\.(path|integ|ents)\}\}/g) || []).length === 3 && /\{\{#\*inline "ncmSh2Sum"\}\}/.test(tpl), 'each band heading carries the shared summary partial');
  ok(/\.ncm-sh2-sec__sum \{ display: none; \}/.test(css) && /\.ncm-sh2-sec\.is-shut \.ncm-sh2-sec__sum \{[^}]*white-space: nowrap/.test(css) && /text-overflow: ellipsis/.test(css), 'css: the summary shows only while folded, one line, ellipsised');
  ok(/\.ncm-sh2-sec\.is-shut > \.ncm-sh2-sec__k > :is\(\.ncm-sh2-sec__r, \.ncm-sh2-sec__n, button\) \{ display: none !important; \}/.test(css), 'css: a folded band hides its open-state extras so the summary has the room');
  const sumBlock = css.slice(css.indexOf('Closed-band summaries'));
  ok(!/#[0-9a-f]{3,8}\b/i.test(sumBlock.replace(/\/\*[\s\S]*?\*\//g, '')) && /is-t-money\s*\{ --sc: var\(--ncm-money\)/.test(sumBlock), 'css: summary colours are tokens only (money = --ncm-money)');
  ok(/bayShut\(\{ index, key: g\.key/.test(tab) && /this\._selId !== this\._baySelSeen/.test(tab) && /holdsSel: false/.test(tab), 'the tab folds bays through bayShut; a NEW selection opens its bay once, then the GM fold wins');
}
ok(/keydown[\s\S]{0,200}'Enter'[\s\S]{0,40}' '/.test(tab), 'Enter / Space work the role=button bands');
ok(/hue: entryHue\(/.test(tab) && /style="--ec:\{\{this\.hue\}\}"/.test(tpl), 'entries carry their type hue');
ok(/style="--ih:\{\{ncm-hue this\.name\}\}"/.test(tpl) && /style="--ih:\{\{ncm-hue d\.name\}\}"/.test(tpl), 'cartridge chip tile and the detail tile wear the same name hue');
ok(/\.ncm-sh2-sec\.is-shut \.ncm-sh2-sec__body \{ grid-template-rows: 0fr/.test(css) && /\.ncm-sh2-ent:nth-child\(even\)/.test(css) && /inset 3px 0 var\(--ec\)/.test(css), 'css: section fold, zebra entries, a type-coloured edge');
ok(!/\.notch > i\.is-net/.test(css), 'no dead network-notch colour (the network notch is a lock, like its stop)');
const block = css.slice(css.indexOf('cartridges (2026-10-28)'));
ok(!/#[0-9a-f]{3,8}\b/i.test(block) && !/border-radius:\s*[3-9]px/.test(block), 'the cartridge block is tokens only, radius ≤ 2px');

// ═══ 7. Real render ═══
let H = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { H = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!H) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const { registerTagHueHelper } = await import(pathToFileURL(`${ROOT}/scripts/utils/tagHue.js`).href);
  registerTagHueHelper(H);
  H.registerHelper('eq', (a, b) => a === b);
  const shards = [
    row({ itemId: 'a', name: 'Militech Exec Dossier', status: 'blackice', layers: [{ key: 'encryption', ice: true, small: 'DV 20' }] }),
    row({ itemId: 'b', name: 'Burnt Courier Chip', status: 'destroyed', integrityPercent: 0, img: '' }),
    row({ itemId: 'c', name: 'Afterlife Ledger', status: 'breached', integrityEnabled: false, makerName: 'Rache' }),
  ];
  const cards = shards.map(s => ({ ...M.cartridgeView(s, { groupMode: 'status' }), isSel: s.itemId === 'a', isPicked: false }));
  const icfg = IM.resolveIntegrity({ enabled: true, currentIntegrity: 47, history: [100, 47], mode: 'mechanical' });
  const detail = {
    itemId: 'a', uuid: 'Item.a', name: 'Militech Exec Dossier', img: '', touched: '14h ago', stateFill: 'is-bad', stateFillIcon: 'fa-skull', stateFillLabel: 'Black ICE armed',
    isWorld: false, holderName: 'V', presetLabel: 'Corporate', folderName: 'Loot', makerTag: null, gmMade: true, isWorldItem: true, layers: [], hasLayers: false,
    integOn: true, igv: { ...M.integrityView(icfg, 15), degrade: 15, repairPts: 15, mechanical: true }, hardening: 0, canPop: true,
    entries: [0, 0.25, 1].map((lv, i) => { const es = M.entryState(lv); return { entryId: 'e' + i, icon: 'fas fa-envelope', title: 'Entry ' + i, type: 'Message', stateCss: es.css, stateIcon: es.icon, stateLabel: es.label, lost: es.key === 'lost', cells: es.cells, encrypted: i === 0, encDV: 'DV 16', canSetDamage: true, pct: es.pct, damaged: es.pct > 0 }; }),
    entryCount: 3,
  };
  const groups = [{ key: 'status:blackice', name: 'Black ICE', icon: 'fas fa-skull', count: 1, shut: false, edge: 'var(--ncm-bad)', hueName: 'Black ICE', lights: [{ light: 'ice', name: 'x' }], more: 0, rows: [cards[0]] },
    { key: 'status:destroyed', name: 'Bricked', icon: 'fas fa-skull', count: 2, shut: true, edge: 'var(--ncm-bad)', hueName: 'Bricked', lights: cards.slice(1).map(x => ({ light: x.light, name: x.name })), more: 0, rows: cards.slice(1) }];
  const ctx = { activeTab: 'shards', shards2: { auth: { on: false, facts: [] }, presets: [], groups, hasShards: true, detail, viewSections: [], filterSections: [], pills: [] } };
  const render = H.compile(tpl);
  const html = render(ctx);
  ok((html.match(/class="ncm-sh2-slot /g) || []).length === 3 && html.includes('ncm-sh2-slot is-sel'), 'three cartridges, one selected');
  ok(html.includes('ncm-sh2-bayw is-shut') && html.includes('ncm-sh2-led is-bricked'), 'a folded bay renders its lights');
  ok(html.includes('class="ncm-sh2-img is-glyph is-bricked"'), 'no art → chip glyph; bricked art is crossed');
  ok(html.includes('ncm-sh2-cart__ch is-na') && html.includes('style="height:47%"'), 'integrity strip: a striped off strip and a 47% fill');
  ok(html.includes('ncm-sh2-pm') && html.includes('ncm-sh2-notch'), 'PM tag + notches');
  ok(html.includes('Black ICE armed') && html.includes('GM-made') && html.includes('Last touched'), 'detail header: state pill, GM-made, last touched');
  ok(html.includes('data-op="igRepair"') && html.includes('ncm-sh2-ig__needle') && html.includes('Critical') && html.includes('data-value="24"'), 'the integrity ladder renders with its controls');
  ok(html.includes('ncm-sh2-ent is-bricked is-lost') && html.includes('75% left') && html.includes('DV 16'), 'entries: lost / part-lost / encrypted DV');
  ok((html.match(/data-action="setShardEntryDamage" data-lv="\d"/g) || []).length >= 12, 'a settable battery on every entry');
  const off = render({ ...ctx, shards2: { ...ctx.shards2, detail: { ...detail, igv: null, integOn: false } } });
  ok(off.includes('data-op="igOn"') && off.includes('Integrity is <b>off</b>'), 'integrity off → Turn on');
  const bulk = render({ ...ctx, shards2: { ...ctx.shards2, bulk: true } });
  ok(bulk.includes('ncm-sh2-tick') && !bulk.includes('fa-caret-right'), 'bulk mode: a tick box in place of the caret');
  ok(html.includes('class="ncm-tabhd"') && html.includes('<h2>Data shards</h2>'), 'title renders');
  ok(html.includes('data-st="bad"') && html.includes('style="--ih:var(--ncm-hue-'), 'state word tone + chip tile hue render');
  ok((html.match(/aria-expanded="true" data-action="tabAct" data-op="sec"/g) || []).length === 3 && !html.includes('ncm-sh2-sec is-shut'), 'sections render open by default');
  const shut = render({ ...ctx, shards2: { ...ctx.shards2, detail: { ...detail, shut: { path: true, integ: false, ents: true } } } });
  ok((shut.match(/ncm-sh2-sec is-shut/g) || []).length === 2 && (shut.match(/aria-expanded="false" data-action="tabAct" data-op="sec"/g) || []).length === 2, 'remembered folds render shut');
  const hued = render({ ...ctx, shards2: { ...ctx.shards2, detail: { ...detail, entries: detail.entries.map((e, i) => ({ ...e, hue: M.entryHue(['message', 'dossier', 'eddies'][i]) })) } } });
  ok(hued.includes('style="--ec:var(--ncm-hue-8)"') && hued.includes('style="--ec:var(--ncm-money)"') && hued.includes('ncm-sh2-ent__tyn'), 'entries render their type colour');
  const bal = (s) => (s.match(/<div\b/g) || []).length === (s.match(/<\/div>/g) || []).length;
  ok(bal(html) && bal(off) && bal(bulk) && bal(shut), 'div tags balance');
}

console.log(`test-shards-cartridges: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
