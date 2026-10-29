// Sim: Admin → Contacts → Who knows whom → MAP (the net map, dev-approved mock frame 2A-cyber-grid).
// Drives the pure rules (contactsMapModel.js: layout, grid snap, trace routing, lanes, bus merge,
// label placement), the context builder (contactsMap.js) over mocked world data, renders the REAL
// partial through Handlebars, and guards the wiring (template path, stylesheet import, ops, scroller).
// Run: node dev/tools/sims/test-contacts-map.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

globalThis.game = { nightcity: { contactGroupService: { getActorGroups: (id) => id === 'a-V' ? [{ name: 'The Crew', sharedFrom: { groupId: 'crew' } }] : [] } },
  settings: { get: (m, k) => ({ dateFormat: 'YMD', dateMonthStyle: 'short', timeFormat: '24h' }[k]) } };
globalThis.ui = { notifications: { info() {}, warn() {} } };

const M = await imp('scripts/ui/AdminPanel/tabs/contactsMapModel.js');

// ── fixture: 5 characters, 30 contacts (V knows a crowd — one side of V passes the bus limit) ──
const RAW = [
  ['Rogue Amendiares', 'fixer', 'V Rache Judy Panam Brick'], ['Dexter DeShawn', 'fixer', 'V Brick'], ['Wakako Okada', 'fixer', 'V Judy'], ['Padre', 'fixer', 'V'],
  ['Regina Jones', 'fixer', 'Rache Judy Panam'], ['Mr. Hands', 'fixer', ''], ['Goro Takemura', 'corp', 'V Rache'], ['Meredith Stout', 'corp', 'V Brick'],
  ['Anders Hellman', 'corp', 'Rache'], ['Hiromi Sato', 'corp', ''], ['Jackie Welles', 'solo', 'V Rache Judy Panam Brick'], ['Royce', 'solo', 'Brick'],
  ['Weldon', 'solo', 'Panam'], ['River Ward', 'lawman', 'V Judy'], ['Officer Hayes', 'lawman', 'Judy Brick'], ['T-Bug', 'netrunner', 'V Rache'],
  ['Placide', 'netrunner', 'V Rache'], ['Song So Mi', 'netrunner', ''], ['Viktor Vektor', 'medtech', 'V Rache Judy Panam Brick'], ['Fingers', 'medtech', 'V Judy'],
  ['Robert Wilson', 'tech', 'V Panam Brick'], ['Saul Panzer', 'nomad', 'Panam'], ['Mitch Anderson', 'nomad', 'Panam Brick'], ['Kerry Eurodyne', 'media', 'Rache Judy'],
  ['Misty Olszewski', '', 'V Judy'], ['Delamain', 'fixer', 'V'], ['Claire Russell', 'fixer', 'V'], ['Ozob', 'fixer', 'V'], ['Lizzy Wizzy', 'media', 'V'], ['Rosalind', '', 'V'],
];
const PCN = ['V', 'Rache', 'Judy', 'Panam', 'Brick'];
const pcIds = PCN.map((n) => 'a-' + n);
const contacts = RAW.map(([name, role, kb], i) => ({ id: 'c' + i, name, role, hue: 'var(--ncm-hue-1)', knows: kb ? kb.split(' ').map((n) => 'a-' + n) : [] }));
const onMap = contacts.filter((c) => c.knows.length);

// ═══ 1. Layout + grid snap ═══
const P = M.layoutMap(pcIds, onMap);
const P0 = M.layoutMap(pcIds, onMap, { snapToGrid: false });
ok(JSON.stringify(P) === JSON.stringify(M.layoutMap(pcIds, onMap)), 'layout is deterministic');
ok(Object.values(P).every((p) => p.x % M.PITCH === 0 && p.y % M.PITCH === 0), 'every node sits on a grid intersection');
ok(Object.keys(P).every((k) => Math.hypot(P[k].x - P0[k].x, P[k].y - P0[k].y) <= Math.SQRT2 * M.PITCH / 2 + 1e-9), 'the snap moves a node at most half a grid diagonal (~7px)');
ok(Object.values(P).every((p) => p.x >= 0 && p.x <= M.MAP_W && p.y >= 0 && p.y <= M.MAP_H), 'every node is inside the viewBox');
const ids = onMap.map((c) => c.id);
let minGap = Infinity; for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) minGap = Math.min(minGap, Math.hypot(P[ids[a]].x - P[ids[b]].x, P[ids[a]].y - P[ids[b]].y));
ok(minGap >= 24, `contacts keep apart after the snap (closest ${minGap.toFixed(1)}px)`);
ok(!P.c5 && !P.c9, 'contacts nobody knows are left off the map (they go to the dock)');
// meaning: one-knower contacts sit nearer their character than any other; everyone-known sit near the middle
const near = (c) => pcIds.map((p) => [p, Math.hypot(P[c.id].x - P[p].x, P[c.id].y - P[p].y)]).sort((a, b) => a[1] - b[1])[0][0];
ok(onMap.filter((c) => c.knows.length === 1).every((c) => near(c) === c.knows[0]), 'a contact known by one sits closest to that character');
const mid = { x: M.MAP_W / 2, y: 212 };
ok(onMap.filter((c) => c.knows.length === 5).every((c) => Math.hypot(P[c.id].x - mid.x, P[c.id].y - mid.y) < 90), 'contacts everyone knows sit in the middle');

// ═══ 2. Traces: on grid lines / diagonals, 45° only ═══
const { lanes, buses } = M.traceLanes(P, pcIds, onMap);
let gridOk = true, angleOk = true, endOk = true;
for (const c of onMap) for (const pc of c.knows) {
  const t = M.tracePath(P[c.id], P[pc], lanes[`${c.id}|${pc}`] || 0);
  for (const pt of [t.m, t.end]) if (Math.abs(pt.x % M.PITCH) > 1e-6 || Math.abs(pt.y % M.PITCH) > 1e-6) gridOk = false;
  const seg = [[t.a, t.m], [t.m, t.end]];
  for (const [p, q] of seg) { const dx = Math.abs(q.x - p.x), dy = Math.abs(q.y - p.y); if (!(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6)) angleOk = false; }
  if (Math.hypot(t.end.x - P[pc].x, t.end.y - P[pc].y) < 27) endOk = false;
}
ok(gridOk, 'every bend and end point lands on a grid intersection');
ok(angleOk, 'every segment is horizontal, vertical or exactly 45°');
ok(endOk, 'traces stop outside the chip (pins, not through the hex)');
// lanes: adjacent grid lines, distinct per side, never more than BUS_MAX
const bySide = {};
for (const c of onMap) for (const pc of c.knows) { const s = `${pc}:${M.sideOf(P[c.id], P[pc])}`; (bySide[s] = bySide[s] || []).push(lanes[`${c.id}|${pc}`]); }
const small = Object.entries(bySide).filter(([, l]) => l.length <= M.BUS_MAX);
ok(small.every(([, l]) => new Set(l).size === l.length && l.every((v) => v % M.PITCH === 0)), 'up to BUS_MAX traces on a side take distinct adjacent grid lines');
ok(small.every(([, l]) => (Math.max(...l) - Math.min(...l)) === (l.length - 1) * M.PITCH), '…with no gaps between them');
const big = Object.entries(bySide).filter(([, l]) => l.length > M.BUS_MAX);
ok(big.length >= 1 && buses.length === big.length, `more than ${M.BUS_MAX} on one side merge into a bus (${buses.length} bus)`);
ok(big.every(([, l]) => l.every((v) => v === 0)), 'bus traces share one lane');

// ═══ 3. mapView: focus, bus, labels ═══
const V = M.mapView({ pcs: PCN.map((n) => ({ id: 'a-' + n, name: n, initials: n.slice(0, 2).toUpperCase() })), contacts, sel: 'a-V' });
ok(V.focus === 'pc' && V.traces.filter((t) => t.cls === 'is-hot').length === onMap.filter((c) => c.knows.includes('a-V')).length, 'picking a character lights exactly their traces');
ok(V.traces.filter((t) => t.pc !== 'a-V').every((t) => t.cls === 'is-dim'), 'every other trace dims');
ok(V.buses.some((b) => b.pc === 'a-V' && b.cls === 'is-hot' && b.n > M.BUS_MAX), "the picked character's bus lights and carries its count");
ok(V.labels.length === onMap.filter((c) => c.knows.includes('a-V')).length, 'every contact the character knows gets a name');
const boxes = V.labels.map((l) => l.box);
let overl = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0) overl++; }
ok(overl === 0, `no two name plates overlap with V picked (${overl})`);
const R = M.mapView({ pcs: PCN.map((n) => ({ id: 'a-' + n, name: n, initials: n[0] })), contacts, sel: 'c0' });
ok(R.focus === 'contact' && R.traces.filter((t) => t.cls === 'is-hot').length === 5, 'picking a contact lights one trace per character who knows them');
const rl = R.labels[0];
const hotSegs = R.traces.filter((t) => t.cls === 'is-hot').flatMap((t) => { const [a, b, c] = t.d.match(/[\d.]+ [\d.]+/g).map((s) => { const [x, y] = s.split(' ').map(Number); return { x, y }; }); return [[a, b], [b, c]]; });
ok(rl && !hotSegs.some(([p, q]) => M.segHitsBox(p, q, rl.box)), 'a name plate does not sit across a lit trace');
// segHitsBox itself
ok(M.segHitsBox({ x: 0, y: 5 }, { x: 20, y: 5 }, { x0: 5, y0: 0, x1: 10, y1: 10 }) && !M.segHitsBox({ x: 0, y: 20 }, { x: 20, y: 20 }, { x0: 5, y0: 0, x1: 10, y1: 10 }), 'segment-vs-box test');
// placeLabels avoids a lit trace when there is room
const pl = M.placeLabels([{ id: 'x', name: 'Someone Long', x: 300, y: 200, r: 6 }], [], [[{ x: 300, y: 200 }, { x: 500, y: 200 }]]);
ok(!M.segHitsBox({ x: 300, y: 200 }, { x: 500, y: 200 }, pl[0].box), 'labels move off a lit trace');
const hi = M.mapView({ pcs: PCN.map((n) => ({ id: 'a-' + n, name: n, initials: n[0] })), contacts, hi: ['c0', 'c10'], framed: ['c0', 'c10'] });
ok(hi.nodes.filter((n) => n.framePts).length === 2 && hi.labels.length === 2, 'a group highlight frames + names its members');
ok(M.mapView({ pcs: [], contacts }).nodes.length === 0, 'no characters → nothing on the map');

// ═══ 4. Context builder (contactsMap.js) over a mocked world ═══
const { buildMapContext, MAP_ZOOMS, stepZoom, clampZoom, anchorScroll, MAP_ZOOM_MAX } = await imp('scripts/ui/AdminPanel/tabs/contactsMap.js');
const pcs = PCN.map((n) => ({ actorId: 'a-' + n, name: n, player: 'P' + n, initials: n.slice(0, 2).toUpperCase(), img: '' }));
const world = contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, organization: '', trust: 3, email: `${c.id}@x.net`, knowsIds: c.knows, relationships: c.id === 'c0' ? { 'a-Brick': { trust: 1 } } : {} }));
const kx = { knows: (c, aid) => c.knowsIds.includes(aid) };
const groups = [{ id: 'crew', name: 'The Crew', members: [{ hint: { contactId: 'c0' } }, { email: 'c10@x.net' }, { hint: { contactId: 'c9' } }] }];
const mail = { byContact: new Map([['c0', { waiting: 2, recent: [{ sent: false, subject: 'Tonight', ts: '2045-03-02T21:10:00Z' }] }]]) };
const tab = { _mapSel: 'c0', _mapHi: '', _mapPanelFor: null, scopeId: (n) => `app:contacts:${n}`, _roleLabel: (r) => r };
const ctx = buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups });
ok(ctx.on && ctx.uid === 'app-contacts-map', 'the context is on and its pattern id is safe for url(#…)');
ok(ctx.dark.length === 3 && ctx.readout.dark === 3, 'the dock lists the three contacts nobody knows');
ok(ctx.panel.isContact && ctx.panel.who.length === 5 && ctx.panel.who.every((w) => w.cid === 'c0'), 'contact panel: one row per character, each row carries the contact id');
ok(ctx.panel.who.find((w) => w.actorId === 'a-Brick').own && ctx.panel.who.find((w) => w.actorId === 'a-Brick').trust === 'Suspicious', "a character's own trust shows and is marked");
ok(ctx.panel.waiting === 2 && ctx.panel.last.subject === 'Tonight' && ctx.panel.groups[0].name === 'The Crew', 'contact panel: waiting, last mail, groups');
ok(ctx.panel.fresh === true, 'the panel slides in when the pick changes…');
ok(buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups }).panel.fresh === false, '…and not on a re-render of the same pick');
tab._mapSel = 'a-Rache';
const pctx = buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups });
ok(pctx.panel.isPc && pctx.panel.player === 'PRache' && pctx.panel.only.some((o) => o.name === 'Anders Hellman'), 'character panel: player + only-them');
ok(pctx.panel.missing.length === 1 && pctx.panel.missing[0].actorId === 'a-Rache' && pctx.panel.missing[0].n === 1 && pctx.panel.missing[0].names === 'Hiromi Sato', 'character panel: group members they are missing, with the actor on the row');
tab._mapSel = null; tab._mapHi = 'group:crew';
const gctx = buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups });
ok(gctx.panel.legend && gctx.view.nodes.filter((n) => n.framePts).length === 2, 'no pick → legend; a group chip frames the members on the map');
ok(gctx.groupOn && gctx.groupOn.n === 3 && !gctx.chips.some((c) => c.group), 'the lit group counts its members; groups are no longer chips');
ok(/data-scope-btn="app:contacts:maphi"/.test(gctx.groupPicker) && /The Crew|crew/i.test(gctx.groupPicker), 'groups are ONE picker, showing the lit group');
{ // the picker calls back on EVERY change, opening included: an unchanged pick must not re-render (that closed the list)
  const { ScopePicker } = await imp('scripts/utils/scopePicker.js');
  const real = ScopePicker.on; let cb = null; ScopePicker.on = (id, fn) => { if (id === 'app:contacts:maphi') cb = fn; return real.call(ScopePicker, id, fn); };
  let renders = 0; const t2 = { ...tab, _mapHi: 'group:crew', _mapSel: null, render: () => { renders++; } };
  buildMapContext(t2, { all: world, npcs: world, pcs, kx, mail, groups });
  ScopePicker.on = real;
  cb(['crew']);
  ok(renders === 0 && t2._mapHi === 'group:crew', 'opening the Group picker (value unchanged) does not re-render or close it');
  cb([]);
  ok(renders === 1 && t2._mapHi === '', 'clearing the group re-renders once with no highlight');
}
ok(stepZoom(1, 1) === 1.25 && stepZoom(1.3, 1) === 1.5 && stepZoom(1.3, -1) === 1.25 && stepZoom(MAP_ZOOM_MAX, 1) === MAP_ZOOM_MAX && stepZoom(1, -1) === 1, 'buttons step from any in-between zoom to the next level');
ok(clampZoom(9) === MAP_ZOOM_MAX && clampZoom(0.2) === 1, 'zoom clamps between Fit and the max');
{ const a = anchorScroll({ scrollLeft: 50, scrollTop: 20, px: 100, py: 40, from: 1, to: 2 }); ok(a.left === 200 && a.top === 80, 'the point under the cursor stays under it when zooming'); }
const mapJs = read('scripts/ui/AdminPanel/tabs/contactsMap.js');
ok(mapJs.includes("addEventListener('wheel'") && mapJs.includes("addEventListener('pointermove'") && mapJs.includes("addEventListener('dblclick'") && mapJs.includes("addEventListener('keydown'") && mapJs.includes('if (swallow)'), 'wheel zoom, drag pan (a drag never picks), double-click, keys');
ok(Array.isArray(MAP_ZOOMS) && MAP_ZOOMS[0] === 1 && MAP_ZOOMS.every((z, i) => !i || z > MAP_ZOOMS[i - 1]), 'zoom steps start at Fit and rise');

// ═══ 5. REAL render through Handlebars ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
const tplSrc = read('templates/admin-panel/partials/contacts-map.hbs');
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars.create();
  const { registerTagHueHelper } = await imp('scripts/utils/tagHue.js');
  registerTagHueHelper(H);
  const tpl = H.compile(tplSrc, { strict: false });
  tab._mapSel = 'c0'; tab._mapHi = '';
  const html = tpl({ map: buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups }) });
  ok(/data-op="mxMode" data-mode="table"/.test(html), 'Map | Table switch renders');
  ok((html.match(/data-map-node="/g) || []).length === onMap.length + PCN.length, 'one clickable node per contact on the map and per character');
  ok(/class="tr is-hot"/.test(html) && /class="bus /.test(html) && /×\d+/.test(html), 'lit traces, a bus and its count badge render');
  ok(/data-op="whoToggle" data-id="c0" data-actor="a-V"/.test(html), 'share / take back rows wire whoToggle with the contact + character');
  ok(/data-op="replyAs" data-id="c0"/.test(html) && /data-op="pOpenContact" data-id="c0"/.test(html) && !/data-op="mapShareAll"/.test(html), 'contact actions: Reply as (mail waiting), Open; no Share-with-the-rest when everyone knows them');
  { tab._mapSel = 'c1'; const h1 = tpl({ map: buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups }) }); ok(/data-op="sendAs" data-id="c1"/.test(h1) && /data-op="mapShareAll" data-id="c1"[^>]*>.*other 3/.test(h1), 'nothing waiting → Write as; Share with the other 3'); }
  ok(/class="ncm-ct2-map__scroll" data-ct2-scroll="mapzoom"/.test(html) && /data-map-zoom="fit"/.test(html), 'the map sits in its own scroller with zoom controls');
  ok(!/NaN|undefined|\[object Object\]/.test(html), 'no NaN / undefined / [object Object] in the markup');
  const htmlPc = (() => { tab._mapSel = 'a-Rache'; return tpl({ map: buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups }) }); })();
  ok(/data-op="pGroupUpdate" data-group-id="crew" data-actor="a-Rache"/.test(htmlPc) && /data-op="pInbox" data-actor="a-Rache"/.test(htmlPc), 'character actions: share the group, open inbox');
  const htmlLeg = (() => { tab._mapSel = null; return tpl({ map: buildMapContext(tab, { all: world, npcs: world, pcs, kx, mail, groups }) }); })();
  ok(/How to read the map/.test(htmlLeg), 'nothing picked → the legend');
  ok(!/data-op="mapPick"[^>]*>[^<]*<\/table>/.test(tpl({ map: { on: false } })) && !/ncm-ct2-map__svg/.test(tpl({ map: { on: false } })), 'table mode renders only the switch');
}

// ═══ 6. Wiring guards ═══
ok(/ADMIN_CONTACTS_MAP:\s*`\$\{T\}\/admin-panel\/partials\/contacts-map\.hbs`/.test(read('scripts/utils/constants.js')), 'the partial is in TEMPLATES (preloaded by registerTemplates)');
ok(/@import url\('\.\/admin-panel\/contacts-map\.css'\);/.test(read('styles/components/admin-panel.css')), 'the stylesheet is imported');
const tabSrc = read('scripts/ui/AdminPanel/tabs/ContactsTab.js'), hbs = read('templates/admin-panel/tab-contacts.hbs');
for (const op of ['mxMode', 'mapPick', 'mapHi', 'mapShareAll', 'whoToggle', 'replyAs', 'sendAs', 'pOpenContact', 'pInbox', 'pMessage', 'pContacts', 'pGroupUpdate']) ok(tabSrc.includes(`case '${op}'`), `ContactsTab handles op ${op}`);
const usedOps = [...tplSrc.matchAll(/data-op="([a-zA-Z]+)"/g)].map((m) => m[1]);
ok(usedOps.every((op) => tabSrc.includes(`case '${op}'`)), 'every op the partial uses is handled');
ok(/contacts-map\.hbs" map=ct2\.mxMap/.test(hbs) && /{{#unless ct2\.mxMap\.on}}/.test(hbs), 'tab-contacts includes the partial and keeps the table behind the switch');
ok(/_mxMode = 'map'/.test(tabSrc) && /wireContactsMap\(root\)/.test(tabSrc), 'Map is the default view; hover + zoom wired in onRender');
const css = read('styles/components/admin-panel/contacts-map.css');
ok(/\.ncm-ct2-map \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden/.test(css), 'the Who-knows-whom view scrolls as a whole when the panel is short');
ok(/\.ncm-ct2-map__scroll \{[^}]*overflow: auto;[^}]*max-height:/.test(css), 'the map has its own scroller with a max height');
ok(/cubic-bezier\(\.22,1,\.36,1\)/.test(css) && /prefers-reduced-motion/.test(css), 'panel slide uses the house easing; reduced motion vetoes it');
const cls = new Set([...tplSrc.matchAll(/class="([^"{]+)/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith('ncm-ct2-map') || c.startsWith('ncm-ct2-mode')));
ok([...cls].every((c) => css.includes(`.${c}`)), `every ncm-ct2-map/mode class is styled (${[...cls].filter((c) => !css.includes(`.${c}`)).join(', ') || 'all'})`);
ok(!/#[0-9a-f]{6}\b/i.test(css.replace(/var\([^)]*#[0-9a-f]{3,6}\)/gi, '').replace(/\/\*[\s\S]*?\*\//g, '')), 'no literal hex outside var() fallbacks (tokens only)');
const helpers = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'and', 'or', 'not', 'add', 'sub', 'letter', 'join', 'lower', 'upper', 'truncate', 'substring', 'concat'];
ok(!helpers.some((h) => new RegExp(`{{#?(if )?${h}}}`).test(tplSrc)), 'no field named like a helper');
ok(!/\.\.\//.test(tplSrc), 'no ../ in the partial');
for (const src of ['scripts/ui/AdminPanel/tabs/contactsMapModel.js']) ok(!/\b(game|ui|Hooks|foundry|document)\./.test(read(src).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${src} is pure`);

console.log(`test-contacts-map: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
