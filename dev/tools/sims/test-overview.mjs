// Sim: Admin → OVERVIEW redesign (2026-10-26, dev-approved mock
// dev/mockups/admin-overview-redesign-mock.html). Drives the pure rules
// (utils/overviewModel.js), renders the REAL tab template through Handlebars
// over a full view-model, and guards the wiring (actions registered, every
// class styled, every context key read, the player-network hello).
// Run: node dev/tools/sims/test-overview.mjs
import fs from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/').replace(/\/+$/, '');
let pass = 0, fail = 0;
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)); };
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const imp = (p) => import(pathToFileURL(`${ROOT}/${p}`).href);

// ═══ 1. Pure rules ═══
const M = await imp('scripts/utils/overviewModel.js');
const items = [
  { kind: 'setup', key: 'noemail-a', ts: 5 },
  { kind: 'mail', key: 'mail-x', sig: 'm1|2', count: 2, ts: 10 },
  { kind: 'mail', key: 'mail-y', sig: 'm2|5', count: 5, ts: 1 },
  { kind: 'burned', key: 'heat-1', sig: 'burned', ts: 1 },
  { kind: 'bricked', key: 'bricked-s', ts: 3 },
  { kind: 'nonsense', key: 'zzz' },
  { kind: 'countdown', key: 'cd-1', ts: 2 },
];
const ranked = M.rankNeeds(items);
ok(ranked.map((n) => n.key).join() === 'heat-1,cd-1,mail-y,mail-x,bricked-s,noemail-a', 'ranked by weight, count breaks ties within a kind; unknown kinds dropped');
ok(ranked.every((n) => n.group), 'every ranked item carries its filter group');
const dismissed = new Set([M.dismissKey(items[1])]);
ok(!M.rankNeeds(items, dismissed).some((n) => n.key === 'mail-x'), 'a dismissed item is dropped');
ok(M.rankNeeds([{ ...items[1], sig: 'm3|3' }], dismissed).length === 1, 'a dismissed item comes back when its signature changes');
const counts = M.needCounts(ranked);
ok(counts.all === 6 && counts.mail === 2 && counts.sec === 2 && counts.money === 1 && counts.setup === 1, 'chip counts per group');
ok(M.filterNeeds(ranked, 'mail').every((n) => n.group === 'mail') && M.filterNeeds(ranked, 'all').length === 6, 'filterNeeds');
ok(M.NEED_GROUPS.every((g) => Object.values(M.NEED_KINDS).some((k) => k.group === g)), 'every group has at least one kind');
ok(M.agoLabel(1000, 1000) === 'now' && M.agoLabel(0, 12 * 60000) === '12m' && M.agoLabel(0, 3 * 3600000) === '3h' && M.agoLabel(0, 50 * 3600000) === '2d', 'agoLabel');
ok(M.agoLabel(5000, 0) === 'now', 'agoLabel never goes negative');
ok(M.untilLabel(0, 1) === 'due' && M.untilLabel(14 * 60000 + 32000, 0) === '14:32' && M.untilLabel(22 * 3600000, 0) === '22h' && M.untilLabel(60 * 3600000, 0) === '2d', 'untilLabel');
const feed = M.mergeActivity([[{ ts: 1, group: 'mail' }, { ts: 9, group: 'hack' }], [{ ts: 5, group: 'shard' }], [null]], 2);
ok(feed.length === 2 && feed[0].ts === 9 && feed[1].ts === 5, 'mergeActivity: newest first, capped, nulls dropped');
ok(M.filterFeed(feed, 'hack').length === 1 && M.filterFeed(feed, 'all').length === 2, 'filterFeed');

// ═══ 2. OverviewTab: every need kind it emits is a known kind; every context key is read ═══
const tab = read('scripts/ui/AdminPanel/tabs/OverviewTab.js');
const emitted = [...tab.matchAll(/kind: (?:burned \? 'burned' : 'hot'|'([a-z]+)')/g)].map((m) => m[1]).filter(Boolean);
for (const k of new Set(emitted)) if (!['mail', 'hack', 'shard', 'trace', 'imp', 'other'].includes(k)) ok(k in M.NEED_KINDS, `need kind "${k}" is in NEED_KINDS`);
const tpl = read('templates/admin-panel/tab-overview.hbs');
const ctxBlock = tab.slice(tab.indexOf('ov: {'), tab.indexOf('},', tab.indexOf('npcs: this._gatherNpcs')));
const ctxKeys = [...ctxBlock.matchAll(/^\s+([a-zA-Z]+)[:,]/gm)].map((m) => m[1]);
ok(ctxKeys.length >= 15, `found the ov keys (${ctxKeys.length})`);
for (const k of ctxKeys) ok(tpl.includes(`ov.${k}`), `template reads ov.${k}`);
ok(/\.\.\.this\.tabs\.overview\.prepareContext\(/.test(read('scripts/ui/AdminPanel/AdminPanelApp.js')), 'the panel SPREADS the overview context');
ok(/_activeTab !== 'overview'\) return \{ ov: null \}/.test(tab), 'the scan only runs while the Overview is open');

// ═══ 3. Actions: everything the tab or its needs fire is registered on the panel ═══
const app = read('scripts/ui/AdminPanel/AdminPanelApp.js');
const actions = new Set([...tpl.matchAll(/data-action="([a-zA-Z]+)"/g)].map((m) => m[1]).concat([...tab.matchAll(/action: '([a-zA-Z]+)'/g)].map((m) => m[1])));
for (const a of actions) ok(new RegExp(`^\\s+${a}: AdminPanelApp\\._on`, 'm').test(app), `action "${a}" is registered`);
for (const a of ['ovReplyAs', 'ovOpenInboxOf', 'ovWriteTo', 'ovSetEmail', 'ovNeedFilter', 'ovFeedFilter']) {
  ok(app.includes(`this.tabs.overview.on${a.slice(2)}(event, target)`), `${a} delegates to the tab`);
  ok(new RegExp(`\\n  (async )?on${a.slice(2)}\\(`).test(tab), `OverviewTab implements on${a.slice(2)}`);
}
ok(/onBroadcast\(\) \{\s*this\.app\._activeTab = 'networks'/.test(tab), 'Broadcast goes to the Networks tab (where Network Broadcast lives)');

// ═══ 4. CSS: every class used is styled; tokens only; long lists scroll ═══
const css = read('styles/components/admin-panel/tab-overview.css');
const used = new Set([...(tpl + tab).matchAll(/ncm-ov2-[a-z0-9_-]+/g)].map((m) => m[0]).filter((c) => !c.endsWith('-')));
for (const c of used) {
  if (/^ncm-ov2-k--/.test(c)) continue;
  ok(css.includes(`.${c}`), `.${c} is styled`);
}
for (const k of new Set(Object.keys(M.NEED_KINDS).concat(['hack', 'shard', 'trace', 'other']))) ok(css.includes(`.ncm-ov2-k--${k}`), `kind accent .ncm-ov2-k--${k}`);
for (const s of ['needs', 'feed', 'soon', 'pcs', 'npcs']) {
  ok(tpl.includes(`ncm-ov2-scroll--${s}`), `${s} list is wrapped in a scroller`);
  ok(new RegExp(`\\.ncm-ov2-scroll--${s}\\s*\\{[^}]*max-height`).test(css), `${s} scroller has a max-height`);
}
ok(/\.ncm-ov2-scroll \{[^}]*overflow-y: auto;[^}]*overflow-x: hidden/.test(css), 'scrollers pair overflow-y with overflow-x:hidden');
const hexes = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter((h) => h.toLowerCase() !== '#fff');
ok(hexes.length === 0, `no literal colours besides #fff on the red badge (${hexes.join(',')})`);
ok(!/border-radius:\s*(?:[3-9]|\d\d)px/.test(css.replace(/border-radius: 50%|border-radius: 10px|border-radius: 3px; background: var\(--ncm-bg-elevated\)/g, '')), 'chrome radius stays 1–2px (avatars/badge/heat bar excepted)');
ok(!/\.ncm-ov2-(?!.*:not)/.test(read('styles/components/admin-panel/tab-security.css')), 'prefix ncm-ov2 is not used by another stylesheet');
ok(['ncm-ov-hl--cyan', 'ncm-ov-hl--green', 'ncm-ov-hl--purple'].every((c) => css.includes(c)), 'logActivity highlight spans are still styled');

// ═══ 5. Player network hello (the "At the table" network column) ═══
const net = read('scripts/init/registerNetworkSystem.js');
ok(/case 'hello':[\s\S]{0,400}playerNetworks[\s\S]{0,40}\.set\(sender/.test(net), 'GM records a player hello by socket sender');
const helloAt = net.indexOf("case 'hello':");
ok(!/NETWORK_CHANGED/.test(net.slice(helloAt, net.indexOf('break;', helloAt)).replace(/\/\/.*$/gm, '')),'a hello never emits NETWORK_CHANGED (auto-spam would fire on every login)');
ok(/case 'helloRequest':[\s\S]{0,300}type: 'hello'/.test(net), 'a player answers a GM helloRequest');
ok(/case 'switch':[\s\S]{0,400}playerNetworks/.test(net), 'switches update the record too');
ok(/register\('postReady', 40, 'Network hello/.test(net), 'the hello task is registered');
ok(/_gatherTable[\s\S]{0,800}playerNetworks/.test(tab), 'the table reads the record');

// ═══ 6. REAL render through Handlebars ═══
let Handlebars = null;
for (const p of ['C:/Program Files/Foundry Virtual Tabletop/resources/app/package.json', 'C:/Program Files (x86)/Foundry Virtual Tabletop/resources/app/package.json']) {
  if (!fs.existsSync(p)) continue;
  try { Handlebars = createRequire(p)('handlebars'); break; } catch { /* keep looking */ }
}
if (!Handlebars) { fail++; console.error('FAIL: could not load Handlebars from a Foundry install — render checks did not run'); }
else {
  const H = Handlebars;
  H.registerHelper('eq', (a, b) => String(a) === String(b));
  const render = H.compile(tpl);
  const need = (kind, extra = {}) => ({ kind, icon: 'fa-bell', dismissKey: `${kind}-k|s`, html: `<b>${kind}</b> thing`, subline: 'sub line', actions: [{ label: 'Go', action: 'switchTab', primary: true, dataAttrs: [{ k: 'tab', v: 'messages' }] }, { label: 'Stop', action: 'securityDefuse', danger: true, dataAttrs: [{ k: 'item-id', v: 'I1' }, { k: 'resident-id', v: 'R1' }] }], ...extra });
  const ov = {
    clock: '2045-08-14 21:04', sceneName: 'Afterlife', sceneDead: true,
    needs: [need('mail'), need('burned')], needCounts: { all: 2, mail: 1, sec: 1, money: 0, setup: 0 }, needFilter: 'all', hasNeeds: true,
    table: [{ name: 'V', userName: 'Sam', online: true, network: 'CitiNet', unread: 3, initials: 'V', color: 'var(--ncm-secondary)' }, { name: 'Jackie', userName: 'Ana', online: false, network: '', unread: 0, img: 'a.png' }],
    tiles: [{ tab: 'messages', icon: 'fa-envelope', color: 'var(--ncm-secondary)', label: 'Messages', n: 12, lines: ['<b>3</b> unread'], bad: '' }, { tab: 'shards', icon: 'fa-microchip', label: 'Shards', n: 4, lines: ['x'], bad: '1 bricked' }],
    feed: [{ kind: 'imp', icon: 'fa-user-secret', html: '<b>V</b> wrote as Kiroshi', tag: 'impersonation', subline: 'to Rogue', ago: '3m' }], hasFeed: true, feedFilter: 'all',
    soon: [{ when: '14:32', hot: true, title: 'Trace — Arasaka on V', subline: 'on game time', cancel: { action: 'securityCountdownCancel', key: 'countdown-id', id: 'C1' } }, { when: '2d', title: 'Backdoor expires', subline: 'WS-7' }],
    pcs: [{ actorId: 'A1', name: 'V', playerName: 'Sam', online: true, unread: 2, hasEmail: true, last: { from: 'Rogue', subject: 'Job', ago: '1h' } }, { actorId: 'A2', name: 'Jackie', online: false, unread: 0, hasEmail: false, last: null }],
    npcs: [{ name: 'Rogue', aliases: 2, waiting: 3, last: '5m', latestId: 'M9', ownerId: 'C7' }, { name: 'Dex', aliases: 1, waiting: 0, last: '2d', latestId: 'M2', ownerId: 'C8' }],
  };
  const html = render({ activeTab: 'overview', ov });
  ok(render({ activeTab: 'messages', ov }).trim() === '', 'renders nothing on another tab');
  ok(render({ activeTab: 'overview', ov: null }).trim() === '', 'renders nothing when the context is null');
  ok((html.match(/class="ncm-ov2-need /g) || []).length === 2, 'two needs rendered');
  ok(html.includes('data-alert-key="mail-k|s"'), 'need carries its dismiss key');
  ok(html.includes('data-item-id="I1" data-resident-id="R1"'), 'need action data attributes are written');
  ok(html.includes('ncm-ov2-btn--danger') && html.includes('ncm-ov2-btn--pri'), 'action button variants');
  ok(html.includes('ncm-ov2-k--burned'), 'need kind class');
  ok(html.includes('<b>mail</b> thing'), 'need html is rendered raw');
  ok(/data-filter="mail">[\s\S]*?<b>1<\/b>/.test(html), 'chip counts show');
  ok(html.includes('ncm-ov2-who is-off') && html.includes('<img src="a.png"'), 'offline player dimmed; portrait used');
  ok(html.includes('ncm-ov2-mono">CitiNet'), 'network shown');
  ok(html.includes('data-tab="shards"') && html.includes('is-bad">1 bricked'), 'tiles link to their tab and show the bad line');
  ok(html.includes('ncm-ov2-tag">impersonation'), 'feed tag');
  ok(html.includes('data-countdown-id="C1"') && (html.match(/ncm-ov2-soon__when/g) || []).length === 2 && !/2d<\/span>[\s\S]{0,200}data-action="securityCountdownCancel"/.test(html), 'soon cancel only where one exists');
  ok(html.includes('No email address yet') && html.includes('Last: <b>Rogue</b>'), 'pc last-mail / no-email line');
  ok(html.includes('data-message-id="M9" data-inbox-id="C7"'), 'NPC Reply as carries message + inbox');
  ok(html.includes('+2 aliases') && html.includes('+1 alias<'), 'alias plural');
  ok(html.includes('3 waiting') && html.includes('nothing waiting'), 'npc waiting line');
  const empty = render({ activeTab: 'overview', ov: { ...ov, needs: [], hasNeeds: false, feed: [], hasFeed: false, soon: [], pcs: [], npcs: [], table: [] } });
  ok(empty.includes('Nothing needs you right now') && empty.includes('No timers running') && empty.includes('No player characters yet') && empty.includes('No player has written'), 'empty states');
  ok(!empty.includes('ovClearAlerts'), 'no "Dismiss all" with nothing to dismiss');
  const bal = (s) => (s.match(/<div\b/g) || []).length === (s.match(/<\/div>/g) || []).length;
  ok(bal(html) && bal(empty), 'div tags balance in the render');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
